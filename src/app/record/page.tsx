"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { db } from "@/lib/db";
import { v4 as uuid } from "uuid";

// MediaPipe (CDNのWASM/モデルを利用：ローカル配置派は後述の注釈参照)
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

type Eye = "left" | "right" | "both";

// 笑顔スコアの段階化用（お好みで微調整）
const TIER1 = 0.5;
const TIER2 = 0.7;
const TIER3 = 0.9;

// 記録ウィンドウ（カウントダウン）秒数
const ARM_SECONDS = 10;

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
  // ベストフレーム保持
  const bestBlobRef = useRef<Blob | null>(null);
  const bestScoreRef = useRef<number>(-Infinity);
  const snapshotBusyRef = useRef(false);
  // 瞬き/選定用
  const prevMinOpenRef = useRef<number>(1);
  const blinkSuppressUntilRef = useRef<number>(0);
  const selEmaRef = useRef<number>(0);
  // 撮影後のメッセージ中間部分（バリエーション）
  const midPhrases: string[] = [
    "素敵な笑顔ですね！",
    "ナイススマイル！",
    "いい表情です！",
    "スマイル全開です！",
    "晴れやかな表情ですね！",
    "すごく良い表情です！",
    "とても映えてます！",
    "その笑顔，最高です！",
    "とっても爽やかです！",
    "自然で素敵な笑顔です！",
    "パーフェクトスマイルです！",
    "とびきりの笑顔ですね！",
    "今日一番の笑顔ですね！",
    "元気をもらえる笑顔ですね！",
    "とても魅力的な笑顔です！",
    "満点の笑顔！",
    "ばっちりの笑顔！",
    "とてもチャーミングです！",
    "すごく素敵！",
    "見惚れてしまう笑顔です！",
    "最高のワンショットです！",
    "元気いっぱいですね！",
    "とてもいい表情です！",
    "気持ちの良い笑顔ですね！",
    "とても輝いています！",
    "弾ける笑顔が素敵です！",
    "爽やかなスマイルですね！",
  ];
  const MID_PHRASE_INDEX_KEY = "midPhraseIndex_v1";
  const chooseMiddle = () => {
    try {
      const raw =
        typeof window !== "undefined"
          ? window.localStorage.getItem(MID_PHRASE_INDEX_KEY)
          : null;
      let idx = raw ? parseInt(raw, 10) : 0;
      if (!Number.isFinite(idx) || idx < 0 || idx >= midPhrases.length) idx = 0;
      const phrase = midPhrases[idx] ?? midPhrases[0];
      const next = (idx + 1) % midPhrases.length;
      if (typeof window !== "undefined")
        window.localStorage.setItem(MID_PHRASE_INDEX_KEY, String(next));
      return phrase;
    } catch {
      return midPhrases[0];
    }
  };
  // 😊 パーティクル（視覚フィードバック）
  type EmojiParticle = {
    id: number;
    x: number; // % (0-100)
    y: number; // % (0-100)
    size: number; // px
    duration: number; // ms
    emoji: string;
    dxStart: number; // px
    dxEnd: number; // px
  };
  const [particles, setParticles] = useState<EmojiParticle[]>([]);
  const particleIdRef = useRef(0);
  const lastSpawnRef = useRef(0);
  const reduceMotionRef = useRef(false);

  // blob URL 解放
  useEffect(() => {
    return () => {
      if (snapUrl && snapUrl.startsWith("blob:")) {
        URL.revokeObjectURL(snapUrl);
      }
    };
  }, [snapUrl]);

  // 低モーション設定の検出
  useEffect(() => {
    try {
      reduceMotionRef.current =
        typeof window !== "undefined" &&
        window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {}
  }, []);

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
            setMsg("点眼後の写真を撮ります。カメラに顔を写してください。");
            setBadgeText("ゆったりどうぞ");

            // MediaPipe 初期化 → ウォッチ開始
            await initSmileModel();
            startSmileWatch();
            startArm();
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

      // ---- 候補フィルタ：瞬き/大口あけを除外 ----
      const nowTs = performance.now();
      const minOpen = Math.min(P_open_L, P_open_R);
      // 瞬き急落検知（2フレーム以内の急落を想定）
      if (prevMinOpenRef.current > 0.6 && minOpen < 0.15) {
        blinkSuppressUntilRef.current = nowTs + 220; // 約200ms除外
      }
      prevMinOpenRef.current = minOpen;

      // 口の開き具合（比率）計算と jawOpen
      let mouthOpenRatio = 0;
      if (face) {
        const PL = face[MOUTH_LEFT_IDX];
        const PR = face[MOUTH_RIGHT_IDX];
        const PB = face[MOUTH_BOTTOM_CENTER_IDX];
        if (PL && PR && PB) {
          const midX = (PL.x + PR.x) / 2;
          const midY = (PL.y + PR.y) / 2;
          const mouthWidth = Math.hypot(PR.x - PL.x, PR.y - PL.y);
          const mouthHeight = Math.hypot(PB.x - midX, PB.y - midY);
          if (mouthWidth > 1e-6) mouthOpenRatio = mouthHeight / mouthWidth;
        }
      }
      const jawOpen = bs?.find((c) => c.categoryName === "jawOpen")?.score ?? 0;

      const notBlinkWindow = nowTs >= blinkSuppressUntilRef.current;
      const eyesOk = minOpen >= 0.25;
      const mouthShapeOk = s_mouth >= 0.3;
      const mouthOpenOk = mouthOpenRatio <= 0.45 && jawOpen <= 0.6;
      const candidateAllowed =
        notBlinkWindow && eyesOk && mouthShapeOk && mouthOpenOk;

      // 選定用のEMAスコア（瞬間スパイク抑制）
      const selScore = selEmaRef.current * 0.6 + S * 0.4;
      selEmaRef.current = selScore;

      // ベスト更新時スナップショットを記録（フィルタ通過＋少し上回ったら）
      if (candidateAllowed && selScore > bestScoreRef.current + 0.01) {
        const vEl = videoRef.current;
        const c = canvasRef.current;
        if (vEl && c && !snapshotBusyRef.current && vEl.videoWidth > 0) {
          snapshotBusyRef.current = true;
          c.width = vEl.videoWidth;
          c.height = vEl.videoHeight;
          const ctx = c.getContext("2d");
          if (ctx) {
            ctx.drawImage(vEl, 0, 0, c.width, c.height);
            c.toBlob(
              (b) => {
                if (b) {
                  bestBlobRef.current = b;
                  bestScoreRef.current = selScore;
                }
                snapshotBusyRef.current = false;
              },
              "image/jpeg",
              0.9
            );
          } else {
            snapshotBusyRef.current = false;
          }
        }
      }

      // 段階（tier）更新＆メッセージ（カウントダウンとは独立）
      const nextTier: 0 | 1 | 2 | 3 =
        S >= TIER3 ? 3 : S >= TIER2 ? 2 : S >= TIER1 ? 1 : 0;
      if (nextTier !== tier) {
        setTier(nextTier);
        if (nextTier === 3) {
          setMsg("最高！");
          setBadgeText("最高！✨");
          spawnEmoji(3);
        } else if (nextTier === 2) {
          setMsg("すごくいいです！");
          setBadgeText("すごくいい！😁");
          spawnEmoji(2);
        } else if (nextTier === 1) {
          setMsg("その調子！");
          setBadgeText("いいですね😊");
          spawnEmoji(1);
        } else {
          setMsg("ゆったりどうぞ。");
          setBadgeText("ゆったりどうぞ");
        }
      }

      // スコアに応じて定期的に少数スポーン（控えめ）
      const nowTs2 = performance.now();
      const baseInterval = 1600; // ms
      const minInterval = 450; // ms
      const interval = Math.max(minInterval, baseInterval - S * 1100);
      if (
        !reduceMotionRef.current &&
        nowTs2 - lastSpawnRef.current > interval
      ) {
        const count = S > 0.85 ? 2 : 1;
        spawnEmoji(count);
        lastSpawnRef.current = nowTs2;
      }
    }, 120); // だいたい ~8fps 程度
  }

  function stopSmileWatch() {
    if (smileTimerRef.current) {
      clearInterval(smileTimerRef.current);
      smileTimerRef.current = null;
    }
  }

  // ---- 😊 エフェクト生成 ----
  function spawnEmoji(count: number) {
    if (reduceMotionRef.current || count <= 0) return;
    setParticles((prev) => {
      const next = prev.slice(-18); // 上限に向けて抑制
      for (let i = 0; i < count; i++) {
        const id = ++particleIdRef.current;
        // 画面の周囲に散らす：中央帯(30-70%)を避けて左右寄りを優先
        const x =
          Math.random() < 0.5
            ? 5 + Math.random() * 25
            : 70 + Math.random() * 25; // 5–30% or 70–95%
        const y = 10 + Math.random() * 80; // 10–90%
        const size = 18 + Math.random() * 10;
        const duration = 800 + Math.random() * 700;
        const emoji = Math.random() < 0.2 ? "✨" : "😊";
        // ほんの少し左右に流す
        const dxStart = (Math.random() - 0.5) * 10; // -5〜5px
        const dxEnd = dxStart + (Math.random() - 0.5) * 24; // 終端でさらに広がる
        next.push({ id, x, y, size, duration, emoji, dxStart, dxEnd });
        setTimeout(() => {
          setParticles((p) => p.filter((e) => e.id !== id));
        }, duration + 60);
      }
      return next.slice(-20);
    });
  }

  // ---- 記録ウィンドウのカウント ----
  function startArm() {
    if (armTimerRef.current) return;
    setArmed(true);
    setArmCount(ARM_SECONDS);
    bestBlobRef.current = null;
    bestScoreRef.current = -Infinity;

    armTimerRef.current = setInterval(() => {
      setArmCount((prev) => {
        if (prev <= 1) {
          clearInterval(armTimerRef.current!);
          armTimerRef.current = null;
          setArmed(false);
          // ベストで撮影へ
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

  // ---- 撮影処理（10秒間でのベストフレームを保存） ----
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

    // ベストがなければ現在フレームを取得
    let blob: Blob | null = bestBlobRef.current;
    if (!blob) {
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      const ctx = c.getContext("2d");
      if (!ctx) {
        capturedRef.current = false;
        startSmileWatch();
        return;
      }
      ctx.drawImage(v, 0, 0, c.width, c.height);
      blob = await new Promise((resolve, reject) => {
        c.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
          "image/jpeg",
          0.9
        );
      });
    }

    // 表示
    if (!blob) {
      setIsSaving(false);
      setMsg("画像の生成に失敗しました。もう一度お試しください。");
      capturedRef.current = false;
      return;
    }
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

    const finalScore =
      bestScoreRef.current === -Infinity ? smileScore : bestScoreRef.current;
    const middle = chooseMiddle();

    await db.snaps.put({
      id,
      takenAt: nowIso,
      eye,
      blob: blob!,
      smileScore: finalScore,
      note: middle, // 中間部分を保存
    });

    setIsSaving(false);
    setMsg(`記録しました。${middle} 今日も点眼頑張ってて偉い！👏`);
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
    setMsg("点眼後の写真を撮ります。カメラに顔を写してください。");
    setBadgeText("");
    capturedRef.current = false;

    // 再開
    const v = videoRef.current;
    if (v) {
      try {
        await new Promise((r) => setTimeout(r, 50));
        await v.play();
        startSmileWatch();
        startArm();
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
    <main className="min-h-dvh flex flex-col items-center gap-5 p-6">
      <h1 className="text-2xl md:text-3xl font-semibold">点眼記録をつける</h1>

      {/* カウントダウン（フレーム外上部に表示） */}
      {!showImage && armed && (
        <div className="w-full max-w-sm flex justify-center">
          <div
            className="relative h-28 w-28 text-black dark:text-white"
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
            <div className="absolute inset-[6px] rounded-full bg-white/80 dark:bg-black/60 backdrop-blur grid place-items-center shadow">
              <span className="text-4xl md:text-5xl font-bold tabular-nums">
                {armCount}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* カメラと画像を同じ枠内で切り替え（リッチなフレーム） */}
      <div className="gradient-border w-full max-w-sm">
        <div className="inner relative aspect-video overflow-hidden rounded-2xl shadow">
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
            <Image
              src={snapUrl}
              alt="撮影結果"
              fill
              sizes="(max-width: 640px) 100vw, 640px"
              unoptimized
              className={`object-cover transition-opacity duration-200 ${
                showImage ? "opacity-100" : "opacity-0"
              }`}
            />
          )}

          {/* 笑顔フィードバック（軽いバッジ） */}
          {!showImage && badgeText && (
            <div className="pointer-events-none absolute inset-0 grid place-items-start p-3">
              <div
                className={`rounded-full px-3 py-1 text-sm md:text-base font-semibold bg-white/90 dark:bg-black/60 text-black dark:text-white backdrop-blur shadow animate-pop`}
              >
                {badgeText}
              </div>
            </div>
          )}

          {/* 笑顔スコアのリアルタイム表示 */}
          {!showImage && (
            <div className="pointer-events-none absolute top-0 right-0 p-3">
              <div className="rounded-full px-3 py-1 text-sm md:text-base font-semibold bg-white/90 dark:bg-black/60 text-black dark:text-white backdrop-blur shadow">
                笑顔スコア: {smileScore.toFixed(2)}
              </div>
            </div>
          )}

          {/* 😊 エフェクト（スコア連動） */}
          {!showImage && particles.length > 0 && (
            <div className="pointer-events-none absolute inset-0">
              {particles.map((p) => (
                <span
                  key={p.id}
                  className="emoji-pop absolute select-none"
                  style={
                    {
                      left: `${p.x}%`,
                      top: `${p.y}%`,
                      fontSize: `${p.size}px`,
                      animationDuration: `${p.duration}ms`,
                      "--dx-start": `${p.dxStart}px`,
                      "--dx-end": `${p.dxEnd}px`,
                    } as React.CSSProperties & Record<string, string>
                  }
                >
                  {p.emoji}
                </span>
              ))}
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
      </div>

      {/* メッセージ（読み上げ対応） */}
      <p
        className="text-base md:text-lg text-gray-800 dark:text-gray-200"
        aria-live="polite"
        role="status"
      >
        {msg}
      </p>

      <div className="mt-2 flex gap-3">
        {!snapUrl ? (
          <button
            onClick={handleCancel}
            className="px-5 py-3 rounded-2xl border text-base md:text-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          >
            キャンセル
          </button>
        ) : (
          <>
            <button
              onClick={handleRetake}
              disabled={isSaving}
              className="px-5 py-3 rounded-2xl border text-base md:text-lg disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
            >
              撮り直す
            </button>
            <button
              onClick={() => router.push("/")}
              className="px-5 py-3 rounded-2xl bg-black text-white text-base md:text-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
            >
              はじめのページへ戻る
            </button>
            <button
              onClick={() => router.push("/history")}
              className="px-5 py-3 rounded-2xl border text-base md:text-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
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

        /* 😊 バブル（ふわっと浮かぶ） */
        @keyframes float-up {
          0% {
            transform: translate(var(--dx-start, 0px), 6px) scale(0.9);
            opacity: 0;
          }
          15% {
            opacity: 1;
          }
          100% {
            transform: translate(var(--dx-end, 0px), -28px) scale(1.08);
            opacity: 0;
          }
        }
        .emoji-pop {
          animation-name: float-up;
          animation-timing-function: ease-out;
          animation-fill-mode: both;
          text-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
          will-change: transform, opacity;
        }
      `}</style>
    </main>
  );
}
