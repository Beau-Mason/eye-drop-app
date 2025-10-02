"use client";
import { useEffect, useRef } from "react";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

export function useFaceSmile() {
  const lmRef = useRef<FaceLandmarker | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // ❶ WASM一式をCDNから読み込む（バージョンはプロジェクトに合わせて固定してOK）
      const wasmBase =
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.12/wasm";
      const fileset = await FilesetResolver.forVisionTasks(wasmBase);

      // ❷ 顔モデル（.task）もCDN/公式ストレージから
      const modelUrl =
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

      const lm = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: modelUrl },
        runningMode: "IMAGE",
        outputFaceBlendshapes: true,
        numFaces: 1,
      });
      if (!cancelled) lmRef.current = lm;
    })();
    return () => {
      cancelled = true;
      lmRef.current?.close();
      lmRef.current = null;
    };
  }, []);

  async function scoreSmileFromCanvas(
    canvas: HTMLCanvasElement
  ): Promise<number | null> {
    const lm = lmRef.current;
    if (!lm) return null;
    const res = lm.detect(canvas);
    const bs = res?.faceBlendshapes?.[0]?.categories;
    if (!bs) return 0;
    const L = bs.find((c) => c.categoryName === "mouthSmileLeft")?.score ?? 0;
    const R = bs.find((c) => c.categoryName === "mouthSmileRight")?.score ?? 0;
    return (L + R) / 2;
  }

  return { scoreSmileFromCanvas };
}
