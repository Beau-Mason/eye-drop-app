"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { db } from "@/lib/db";
import { getParticipantId } from "@/lib/settings";
import { syncPendingSnaps } from "@/lib/sync";
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
  const [tip, setTip] = useState<string>("");
  const [snapUrl, setSnapUrl] = useState<string | null>(null);
  const [showImage, setShowImage] = useState(false); // ライブ→静止画の切替
  const [shutter, setShutter] = useState(false); // 白フラッシュ
  const [eye] = useState<Eye>("both");

  // 笑顔関連
  const [smileScore, setSmileScore] = useState<number>(0);
  const [tier, setTier] = useState<0 | 1 | 2 | 3>(0);
  // 動作確認用に画面に出すベストスコア。-Infinity の代わりに null。
  const [bestDisplay, setBestDisplay] = useState<number | null>(null);

  // アーム（撮影直前の3秒カウント）
  const [armed, setArmed] = useState(false);
  const [armCount, setArmCount] = useState(ARM_SECONDS);

  const [isSaving, setIsSaving] = useState(false);
  const [participantId, setParticipantId] = useState<string | undefined>(
    undefined,
  );
  // ベストフレーム保持。
  // ピーク検出時には bestCanvas に drawImage するだけ（GPU で高速）。
  // toBlob は撮影完了時に1回だけ実行する。
  // こうすることで、スマホで toBlob が遅くて peak をスキップしてしまう問題を回避する。
  const bestCanvasRef = useRef<HTMLCanvasElement>(null);
  const bestScoreRef = useRef<number>(-Infinity);
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

  // 撮影ごとに順番に表示する点眼 tips。
  const tipPhrases: string[] = [
    "毎日きちんと続けると視野の進行を抑えられます。継続が一番の力になります。",
    "複数の目薬は5分以上あけて点眼しましょう。間隔が短いと前の薬が洗い流されてしまいます。",
    "点眼後はしばらく目を閉じましょう。瞬きすると薬液が流れ、効果が出にくくなります。",
    "目の周りにこぼれた点眼はやさしく拭き取りましょう。かゆみや色素沈着を防げます。",
    "自己判断で点眼回数を増減するのはやめましょう。緑内障の治療は継続が大切で、即効性は感じにくいものです。",
    "容器の先がまぶたやまつ毛に触れないようにしましょう。雑菌が入ると感染症の原因になります。",
    "開封後の使用期限は守るようにしましょう。",
    "点眼は1回1滴で十分です。2滴以上さしても溢れるだけで、まぶたの副作用につながることがあります。",
    "痛み・充血・見え方の変化に気づいたら、自己判断せず受診しましょう。",
    "毎日の習慣とセットにすると忘れにくくなります。「朝の洗顔後」「夜の歯磨き後」などがおすすめです。",
    "目薬は日の当たらない涼しい場所に保管しましょう。毎日目にするところにするとさし忘れづらくなります。冷蔵保存が必要なものは医師の指示に従ってください。",
  ];
  const TIP_PHRASE_INDEX_KEY = "tipPhraseIndex_v1";
  const chooseTip = () => {
    try {
      const raw =
        typeof window !== "undefined"
          ? window.localStorage.getItem(TIP_PHRASE_INDEX_KEY)
          : null;
      let idx = raw ? parseInt(raw, 10) : 0;
      if (!Number.isFinite(idx) || idx < 0 || idx >= tipPhrases.length) idx = 0;
      const phrase = tipPhrases[idx] ?? tipPhrases[0];
      const next = (idx + 1) % tipPhrases.length;
      if (typeof window !== "undefined")
        window.localStorage.setItem(TIP_PHRASE_INDEX_KEY, String(next));
      return phrase;
    } catch {
      return tipPhrases[0];
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

  // 参加者IDロード（未登録なら /register へリダイレクト）
  useEffect(() => {
    (async () => {
      try {
        const pid = await getParticipantId();
        if (!pid) {
          router.replace("/register");
          return;
        }
        setParticipantId(pid);
      } catch {
        router.replace("/register");
      }
    })();
  }, [router]);

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
              "動画の再生に失敗しました。別のブラウザ／端末でお試しください。",
            );
          }
        };
      } catch (e) {
        console.error(e);
        setMsg(
          "カメラにアクセスできません。権限やHTTPS（またはlocalhost）をご確認ください。",
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
            const ALPHA = 1.4;
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

      // 候補フィルタは瞬き直後と完全閉眼時だけ除外する最小構成。
      // スマホで MediaPipe の landmarks が一部欠落して s_mouth=0 のまま
      // ベストフレームが一度も更新されない事象に対処するため、
      // 口関連のフィルタは全て外し、最終的な S の大きさだけで判定する。
      const notBlinkWindow = nowTs >= blinkSuppressUntilRef.current;
      const eyesOk = minOpen >= 0.15;
      const candidateAllowed = notBlinkWindow && eyesOk && S >= 0.05;

      // 選定用のEMAスコア（瞬間スパイク抑制）
      const selScore = selEmaRef.current * 0.6 + S * 0.4;
      selEmaRef.current = selScore;

      // ベスト更新時は bestCanvas に drawImage するだけ（GPU 高速）。
      // toBlob は撮影完了時に1回だけ実行する。
      // これにより「スマホで toBlob が遅すぎて次の peak をスキップしてしまう」
      // 問題を回避できる。
      if (candidateAllowed && selScore > bestScoreRef.current + 0.01) {
        const vEl = videoRef.current;
        const bestCanvas = bestCanvasRef.current;
        if (vEl && bestCanvas && vEl.videoWidth > 0) {
          // スマホでも余裕で動くよう短辺/長辺ともに 720px に収める。
          const SNAPSHOT_MAX_DIM = 720;
          const scale = Math.min(
            1,
            SNAPSHOT_MAX_DIM /
              Math.max(vEl.videoWidth, vEl.videoHeight),
          );
          const targetW = Math.round(vEl.videoWidth * scale);
          const targetH = Math.round(vEl.videoHeight * scale);
          if (
            bestCanvas.width !== targetW ||
            bestCanvas.height !== targetH
          ) {
            bestCanvas.width = targetW;
            bestCanvas.height = targetH;
          }
          const ctx = bestCanvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(vEl, 0, 0, targetW, targetH);
            bestScoreRef.current = selScore;
            setBestDisplay(selScore);
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
    bestScoreRef.current = -Infinity;
    setBestDisplay(null);
    // 前回のベストフレームをクリア
    if (bestCanvasRef.current) {
      const ctx = bestCanvasRef.current.getContext("2d");
      if (ctx) {
        ctx.clearRect(
          0,
          0,
          bestCanvasRef.current.width,
          bestCanvasRef.current.height,
        );
      }
    }

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

    // 監視中にピーク検出されていれば bestCanvas にそのフレームが保持されている。
    // そこから 1 回だけ toBlob して JPEG にする。
    // ピーク未検出なら現在の映像フレームをフォールバックで取得。
    let blob: Blob | null = null;
    const bestCanvas = bestCanvasRef.current;
    if (bestCanvas && bestScoreRef.current !== -Infinity) {
      try {
        blob = await new Promise<Blob>((resolve, reject) => {
          bestCanvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
            "image/jpeg",
            0.85,
          );
        });
      } catch {
        blob = null;
      }
    }
    if (!blob) {
      // フォールバック: 現在の映像フレーム
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      const ctx = c.getContext("2d");
      if (!ctx) {
        capturedRef.current = false;
        startSmileWatch();
        return;
      }
      ctx.drawImage(v, 0, 0, c.width, c.height);
      try {
        blob = await new Promise<Blob>((resolve, reject) => {
          c.toBlob(
            (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
            "image/jpeg",
            0.85,
          );
        });
      } catch {
        blob = null;
      }
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
    const tip = chooseTip();

    await db.snaps.put({
      id,
      takenAt: nowIso,
      eye,
      blob: blob!,
      smileScore: finalScore,
      // 笑顔フィードバックと点眼 tip を改行区切りで保存。
      // 管理画面ではそのまま表示され、研究者は participants に出した内容を再現できる。
      note: `${middle}\n${tip}`,
      participantId,
    });

    setIsSaving(false);
    setMsg(`記録しました。${middle} 今日も点眼頑張ってて偉い！👏`);
    setTip(tip);
    setTimeout(() => setShutter(false), 200);

    // メタデータ（顔写真は含まれない）をサーバーへ fire-and-forget 送信。
    // 失敗しても syncedAt が付かないだけで、次回の送信時にまとめて再試行される。
    void syncPendingSnaps().catch(() => {});
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
    setTip("");
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
            <div className="pointer-events-none absolute top-0 right-0 p-3 flex flex-col items-end gap-1">
              <div className="rounded-full px-3 py-1 text-sm md:text-base font-semibold bg-white/90 dark:bg-black/60 text-black dark:text-white backdrop-blur shadow">
                笑顔スコア: {smileScore.toFixed(2)}
              </div>
              <div className="rounded-full px-3 py-1 text-xs md:text-sm font-semibold bg-emerald-100/90 dark:bg-emerald-900/60 text-emerald-900 dark:text-emerald-100 backdrop-blur shadow">
                ベスト: {bestDisplay === null ? "—" : bestDisplay.toFixed(2)}
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

      {/* 点眼 tip（撮影成功時のみ表示） */}
      {tip && (
        <div
          className="w-full max-w-sm rounded-2xl border border-amber-200/80 bg-amber-50/90 dark:bg-amber-900/20 dark:border-amber-400/30 px-4 py-3 text-sm md:text-base text-amber-900 dark:text-amber-100 shadow"
          aria-live="polite"
        >
          <span className="font-semibold mr-1">💡 ヒント:</span>
          {tip}
        </div>
      )}

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
              onClick={() =>
                lastSnapIdRef.current &&
                router.push(`/survey/${lastSnapIdRef.current}`)
              }
              disabled={isSaving || !lastSnapIdRef.current}
              className="px-5 py-3 rounded-2xl btn-primary text-base md:text-lg disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
            >
              アンケートに進む
            </button>
          </>
        )}
      </div>

      <canvas ref={canvasRef} className="hidden" />
      <canvas ref={bestCanvasRef} className="hidden" />

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
