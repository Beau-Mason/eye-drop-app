"use client";
import { useEffect, useRef, useState } from "react";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

type Point = { x: number; y: number };
type MouthKeypoints = {
  leftCorner: Point; // 左口角（正規化座標0..1）
  rightCorner: Point; // 右口角（正規化座標0..1）
  lowerLipUpperCenter: Point; // 下唇の上辺中心（正規化座標0..1）
  pixels: {
    leftCorner: Point;
    rightCorner: Point;
    lowerLipUpperCenter: Point;
  };
};

// MediaPipe FaceMesh の一般的なランドマーク番号
// - 左口角: 61
// - 右口角: 291
// - 下唇の上辺中心（inner 下唇の上端）: 14
const LM_MOUTH_LEFT = 61;
const LM_MOUTH_RIGHT = 291;
const LM_LOWER_LIP_UPPER_CENTER = 14;

export function useFaceSmile() {
  const lmRef = useRef<FaceLandmarker | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const wasmBase =
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.12/wasm";
        const fileset = await FilesetResolver.forVisionTasks(wasmBase);
        const modelUrl =
          "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

        const lm = await FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: modelUrl },
          runningMode: "VIDEO",
          outputFaceBlendshapes: true,
          numFaces: 1,
        });
        if (!cancelled) {
          lmRef.current = lm;
          setReady(true);
        }
      } catch (e) {
        console.error("FaceLandmarker init failed", e);
      }
    })();
    return () => {
      cancelled = true;
      lmRef.current?.close();
      lmRef.current = null;
      setReady(false);
    };
  }, []);

  // 将来 ML Kit に差し替えるためのインターフェイス。
  // いまは Web なので MediaPipe で同等の3点を返す。
  function detectMouthKeypointsForVideo(
    video: HTMLVideoElement
  ): MouthKeypoints | null {
    const lm = lmRef.current;
    if (!lm || video.readyState < 2 || video.paused) return null;
    const ts = performance.now();
    const res = lm.detectForVideo(video, ts);
    const face = res?.faceLandmarks?.[0];
    if (!face) return null;

    const W = video.videoWidth || 1;
    const H = video.videoHeight || 1;

    const pLeft = face[LM_MOUTH_LEFT];
    const pRight = face[LM_MOUTH_RIGHT];
    const pCenter = face[LM_LOWER_LIP_UPPER_CENTER];
    if (!pLeft || !pRight || !pCenter) return null;

    const toPix = (p: any): Point => ({ x: p.x * W, y: p.y * H });
    const leftCorner = { x: pLeft.x, y: pLeft.y };
    const rightCorner = { x: pRight.x, y: pRight.y };
    const lowerLipUpperCenter = { x: pCenter.x, y: pCenter.y };

    return {
      leftCorner,
      rightCorner,
      lowerLipUpperCenter,
      pixels: {
        leftCorner: toPix(pLeft),
        rightCorner: toPix(pRight),
        lowerLipUpperCenter: toPix(pCenter),
      },
    };
  }

  return { ready, detectMouthKeypointsForVideo };
}
