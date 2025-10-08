"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { db } from "@/lib/db";
import { v4 as uuid } from "uuid";

// MediaPipe (CDNのWASM/モデルを利用：ローカル配置派は後述の注釈参照)
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

type Eye = "left" | "right" | "both";

// 笑顔スコアの段階化用（お好みで微調整）
const TIER1 = 0.4;
const TIER2 = 0.6;
const TIER3 = 0.8;

// 撮影前の短いアーム（カウントダウン）秒数
const ARM_SECONDS = 3;

export default function RecordPage() {
  const router = useRouter();

  // DOM / 外部ハンドル
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // タイマー
  const smileTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const armTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 直前の保存ID（撮り直しで削除するため）
  const lastSnapIdRef = useRef<string | null>(null);

  // 二重撮影防止
  const capturedRef = useRef(false);

  // MediaPipe モデル
  const faceLmRef = useRef<FaceLandmarker | null>(null);

  // UI状態
  const [msg, setMsg] = useState("カメラを起動しています…");
  const [badgeText, setBadgeText] = useState<string>("");
  const [snapUrl, setSnapUrl] = useState<string | null>(null);
  const [showImage, setShowImage] = useState(false); // ライブ→静止画の切替
  const [shutter, setShutter] = useState(false); // 白フラッシュ
  const [eye] = useState<Eye>("both");

  // 笑顔関連
  const [smileScore, setSmileScore] = useState<number>(0);
  const [tier, setTier] = useState<0 | 1 | 2 | 3>(0);

  // アーム（撮影直前の3秒カウント）
  const [armed, setArmed] = useState(false);
  const [armCount, setArmCount] = useState(ARM_SECONDS);

  const [isSaving, setIsSaving] = useState(false);

  // blob URL 解放
  useEffect(() => {
    return () => {
      if (snapUrl && snapUrl.startsWith("blob:")) {
        URL.revokeObjectURL(snapUrl);
      }
    };
  }, [snapUrl]);

  // カメラ起動＆笑顔ウォッチ開始
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
          audio: false,
        });
        if (cancelled) return;

        streamRef.current = stream;
        const v = videoRef.current;
        if (!v) return;

        v.srcObject = stream;
        v.onloadedmetadata = async () => {
          if (cancelled) return;
          try {
            // iOS安定化：小休止→play
            await new Promise((r) => setTimeout(r, 50));
            await v.play();
            setMsg("笑顔を検出中です。良い表情になったら3秒で撮影します。");
            setBadgeText("笑顔を検出中…");

            // MediaPipe 初期化 → ウォッチ開始
            await initSmileModel();
            startSmileWatch();
          } catch {
            setMsg(
              "動画の再生に失敗しました。別のブラウザ／端末でお試しください。"
            );
          }
        };
      } catch (e) {
        console.error(e);
        setMsg(
          "カメラにアクセスできません。権限やHTTPS（またはlocalhost）をご確認ください。"
        );
        setBadgeText("");
      }
    })();

    return () => {
      cancelled = true;
      cleanupAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- MediaPipe 初期化 ----
  async function initSmileModel() {
    if (faceLmRef.current) return;
    // CDN版（バージョンは手元の package に合わせてもOK）
    const wasmBase =
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.12/wasm";
    const fileset = await FilesetResolver.forVisionTasks(wasmBase);
    const modelUrl =
      "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

    faceLmRef.current = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: modelUrl },
      runningMode: "VIDEO", // ← リアルタイム推論
      outputFaceBlendshapes: true,
      numFaces: 1,
    });
  }

  // ---- 笑顔スコアのリアルタイム推定ループ ----
  function startSmileWatch() {
    if (smileTimerRef.current) return;
    smileTimerRef.current = setInterval(() => {
      const v = videoRef.current;
      const lm = faceLmRef.current;
      if (!v || !lm || v.paused || v.readyState < 2) return;

      const now = performance.now();
      const res = lm.detectForVideo(v, now);
      const bs = res?.faceBlendshapes?.[0]?.categories;
      // ---- 新スコア計算 ----
      // 口: 左右口角と下唇の中心から角度を計算し s_mouth = α - β * θ
      const face = res?.faceLandmarks?.[0];
      const MOUTH_LEFT_IDX = 61; // 左口角
      const MOUTH_RIGHT_IDX = 291; // 右口角
      const MOUTH_BOTTOM_CENTER_IDX = 14; // 下唇の内側・下中心（近似）

      let s_mouth = 0;
      if (face) {
        const PL = face[MOUTH_LEFT_IDX];
        const PR = face[MOUTH_RIGHT_IDX];
        const PB = face[MOUTH_BOTTOM_CENTER_IDX];
        if (PL && PR && PB) {
          const vLx = PL.x - PB.x;
          const vLy = PL.y - PB.y;
          const vRx = PR.x - PB.x;
          const vRy = PR.y - PB.y;
          const dot = vLx * vRx + vLy * vRy;
          const magL = Math.hypot(vLx, vLy);
          const magR = Math.hypot(vRx, vRy);
          if (magL > 1e-6 && magR > 1e-6) {
            let cosTheta = dot / (magL * magR);
            // 数値誤差ガード
            cosTheta = Math.max(-1, Math.min(1, cosTheta));
            const thetaDeg = (Math.acos(cosTheta) * 180) / Math.PI; // 度
            const ALPHA = 1.8;
            const BETA = 0.01;
            s_mouth = ALPHA - BETA * thetaDeg;
          }
        }
      }

      // 目: ブレンドシェイプの eyeBlink を用いて開眼確率を近似
      const blinkL =
        bs?.find((c) => c.categoryName === "eyeBlinkLeft")?.score ?? 0;
      const blinkR =
        bs?.find((c) => c.categoryName === "eyeBlinkRight")?.score ?? 0;
      // 開眼確率を 1 - blink として近似し、[0,1]へクリップ
      const P_open_L = Math.max(0, Math.min(1, 1 - blinkL));
      const P_open_R = Math.max(0, Math.min(1, 1 - blinkR));
      const s_eye = 1 - P_open_L * P_open_R; // 指定式

      // 最終スコア: S = clamp(s_mouth + s_eye, 0, 1)
      const S = Math.max(0, Math.min(1, s_mouth + s_eye));

      // 簡易スムージング（1フレームぶれ対策）
      setSmileScore((prev) => prev * 0.6 + S * 0.4);

      // 段階（tier）更新＆メッセージ
      const nextTier: 0 | 1 | 2 | 3 =
        S >= TIER3 ? 3 : S >= TIER2 ? 2 : S >= TIER1 ? 1 : 0;

      // setInterval のクロージャで state が古くなるのを避けるため、
      // カウントダウン中かどうかは armTimerRef の有無で判定する
      const isArming = Boolean(armTimerRef.current);

      // カウントダウン中に笑顔がしきい値未満になったら中断
      let didCancelArm = false;
      if (isArming && nextTier < 2) {
        cancelArm();
        setMsg("笑顔を絶やさないで！");
        setBadgeText("笑顔を絶やさないで！");
        didCancelArm = true;
      }

      if (nextTier !== tier) {
        setTier(nextTier);
        if (!didCancelArm) {
          if (nextTier === 3) {
            setMsg("最高の笑顔！そのままキープで3秒カウント開始！");
            setBadgeText("最高の笑顔！✨");
          } else if (nextTier === 2) {
            setMsg("すごくいい表情です！");
            setBadgeText("すごくいい！😁");
          } else if (nextTier === 1) {
            setMsg("いいですね、その調子！");
            setBadgeText("いいですね😊");
          } else {
            setMsg("リラックスしていきましょう。");
            setBadgeText("リラックスしてどうぞ");
          }
        }
      }

      // しきい値に達したらアーム（未アームのときのみ）
      if (!isArming && nextTier >= 2) {
        startArm();
      }
    }, 120); // だいたい ~8fps 程度
  }

  function stopSmileWatch() {
    if (smileTimerRef.current) {
      clearInterval(smileTimerRef.current);
      smileTimerRef.current = null;
    }
  }

  // ---- 撮影前の3秒カウント ----
  function startArm() {
    if (armTimerRef.current) return;
    setArmed(true);
    setArmCount(ARM_SECONDS);

    armTimerRef.current = setInterval(() => {
      setArmCount((prev) => {
        if (prev <= 1) {
          clearInterval(armTimerRef.current!);
          armTimerRef.current = null;
          setArmed(false);
          // 撮影へ
          void capture();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  function cancelArm() {
    if (armTimerRef.current) {
      clearInterval(armTimerRef.current);
      armTimerRef.current = null;
    }
    setArmed(false);
    setArmCount(ARM_SECONDS);
  }

  // ---- お片付け ----
  function cleanupAll() {
    stopSmileWatch();
    cancelArm();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }

  // ---- 撮影処理 ----
  const capture = async () => {
    if (capturedRef.current) return;
    capturedRef.current = true;

    // 笑顔ウォッチは一旦止める
    stopSmileWatch();

    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c || v.videoWidth === 0) {
      setMsg("カメラの準備ができていません。もう一度お試しください。");
      setBadgeText("");
      capturedRef.current = false;
      startSmileWatch(); // 復帰
      return;
    }

    // シャッター演出
    setShutter(true);

    // フレームをキャンバスへ
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const ctx = c.getContext("2d");
    if (!ctx) {
      capturedRef.current = false;
      startSmileWatch();
      return;
    }
    ctx.drawImage(v, 0, 0, c.width, c.height);

    // Blob へ
    const blob: Blob = await new Promise((resolve, reject) => {
      c.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
        "image/jpeg",
        0.9
      );
    });

    // 表示
    const url = URL.createObjectURL(blob);
    setSnapUrl(url);
    setShowImage(true);

    // ライブ停止（stream自体は保持）
    try {
      v.pause();
    } catch {}

    // 保存
    setIsSaving(true);
    const nowIso = new Date().toISOString();
    const id = uuid();
    lastSnapIdRef.current = id;

    await db.snaps.put({
      id,
      takenAt: nowIso,
      eye,
      blob,
      smileScore, // 直近のスムージング済みスコア
    });

    setIsSaving(false);
    setMsg("撮影しました。記録しました！");
    setTimeout(() => setShutter(false), 200);
  };

  // ---- キャンセル／撮り直し ----
  const handleCancel = () => {
    cleanupAll();
    router.push("/");
  };

  const handleRetake = async () => {
    const ok = window.confirm("撮り直しますか？この写真は削除されます。");
    if (!ok) return;

    // 直前レコード削除
    if (lastSnapIdRef.current) {
      try {
        await db.snaps.delete(lastSnapIdRef.current);
      } finally {
        lastSnapIdRef.current = null;
      }
    }

    // UIリセット
    setShowImage(false);
    setSnapUrl(null);
    setMsg("笑顔を検出中です。良い表情になったら3秒で撮影します。");
    setBadgeText("笑顔を検出中…");
    capturedRef.current = false;

    // 再開
    const v = videoRef.current;
    if (v) {
      try {
        await new Promise((r) => setTimeout(r, 50));
        await v.play();
        startSmileWatch();
      } catch {
        setMsg("動画の再生に失敗しました。もう一度お試しください。");
        setBadgeText("");
      }
    } else {
      setMsg("カメラが見つかりません。ページを再読み込みしてください。");
      setBadgeText("");
    }
  };

  return (
    <main className="min-h-dvh flex flex-col items-center gap-4 p-6">
      <h1 className="text-xl font-semibold">点眼記録をつける</h1>

      {/* カメラと画像を同じ枠内で切り替え */}
      <div className="relative w-full max-w-sm aspect-video overflow-hidden rounded-2xl shadow">
        {/* ライブ映像 */}
        <video
          ref={videoRef}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${
            showImage ? "opacity-0" : "opacity-100"
          }`}
          playsInline
          muted
          autoPlay
        />

        {/* 撮影画像 */}
        {snapUrl && (
          <img
            src={snapUrl}
            alt="撮影結果"
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${
              showImage ? "opacity-100" : "opacity-0"
            }`}
          />
        )}

        {/* 笑顔フィードバック（軽いバッジ） */}
        {!showImage && badgeText && (
          <div className="pointer-events-none absolute inset-0 grid place-items-start p-3">
            <div
              className={`rounded-full px-3 py-1 text-xs font-semibold bg-white/90 backdrop-blur shadow animate-pop`}
            >
              {badgeText}
            </div>
          </div>
        )}

        {/* 笑顔スコアのリアルタイム表示 */}
        {!showImage && (
          <div className="pointer-events-none absolute top-0 right-0 p-3">
            <div className="rounded-full px-3 py-1 text-xs font-semibold bg-white/90 backdrop-blur shadow">
              S: {smileScore.toFixed(2)}
            </div>
          </div>
        )}

        {/* 撮影前の3秒カウント（armed時のみ） */}
        {!showImage && armed && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div
              className="relative h-28 w-28 text-black"
              role="img"
              aria-label={`撮影まであと${armCount}秒`}
            >
              <div
                className="absolute inset-0 rounded-full"
                style={{
                  background: `conic-gradient(currentColor ${
                    ((ARM_SECONDS - armCount) / ARM_SECONDS) * 360
                  }deg, #e5e7eb 0deg)`,
                }}
              />
              <div className="absolute inset-[6px] rounded-full bg-white/80 backdrop-blur grid place-items-center shadow">
                <span className="text-4xl font-bold tabular-nums">
                  {armCount}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* シャッター幕 */}
        <div className="pointer-events-none absolute inset-0">
          <div
            className={`absolute inset-0 bg-white transition-opacity duration-150 ${
              shutter ? "opacity-100" : "opacity-0"
            }`}
          />
        </div>
      </div>

      {/* メッセージ（読み上げ対応） */}
      <p className="text-sm text-gray-700" aria-live="polite" role="status">
        {msg}
      </p>

      <div className="mt-2 flex gap-3">
        {!snapUrl ? (
          <button
            onClick={handleCancel}
            className="px-4 py-2 rounded-xl border"
          >
            キャンセル
          </button>
        ) : (
          <>
            <button
              onClick={handleRetake}
              disabled={isSaving}
              className="px-4 py-2 rounded-xl border disabled:opacity-50 disabled:cursor-not-allowed"
            >
              撮り直す
            </button>
            <button
              onClick={() => router.push("/")}
              className="px-4 py-2 rounded-xl bg-black text-white"
            >
              はじめのページへ戻る
            </button>
            <button
              onClick={() => router.push("/history")}
              className="px-4 py-2 rounded-xl border"
            >
              記録を閲覧
            </button>
          </>
        )}
      </div>

      <canvas ref={canvasRef} className="hidden" />

      <style jsx>{`
        @keyframes pop {
          0% {
            transform: scale(0.8);
            opacity: 0;
          }
          20% {
            transform: scale(1.05);
            opacity: 1;
          }
          100% {
            transform: scale(1);
            opacity: 1;
          }
        }
        .animate-pop {
          animation: pop 300ms ease-out;
        }

        @keyframes flash {
          0% {
            opacity: 0;
          }
          10% {
            opacity: 1;
          }
          100% {
            opacity: 0;
          }
        }
        .shutter {
          animation: flash 180ms ease-in-out;
        }
      `}</style>
    </main>
  );
}
