// 点眼記録メタデータ送信 API
//
// 重要な設計上の制約:
//   - このエンドポイントは画像バイナリを一切受け付けない（Content-Type は application/json のみ）
//   - participantId はトークンから取り出す。リクエストボディの participantId は受け付けない
//   - 同じ snapId での再送信は upsert で冪等化（クライアント側の再試行を安全にする）

import { NextRequest } from "next/server";
import { verifyAuthHeader, isWithinStudyPeriod } from "@/lib/auth-server";
import { upsertSnapMeta } from "@/lib/db-server";

export const runtime = "nodejs";

type IncomingSnap = {
  snapId?: unknown;
  takenAt?: unknown;
  eye?: unknown;
  smileScore?: unknown;
  feedbackText?: unknown;
};

function isEye(v: unknown): v is "left" | "right" | "both" {
  return v === "left" || v === "right" || v === "both";
}

export async function POST(req: NextRequest) {
  // 認証
  const payload = verifyAuthHeader(req.headers.get("authorization"));
  if (!payload) {
    return new Response("unauthorized", { status: 401 });
  }

  // 実験期間外のデータは受け付けない
  if (!isWithinStudyPeriod()) {
    return new Response("study period is closed", { status: 403 });
  }

  // 明示的に JSON のみ許可（multipart など画像の混入を拒否）
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.toLowerCase().includes("application/json")) {
    return new Response("unsupported content-type", { status: 415 });
  }

  let body: IncomingSnap;
  try {
    body = (await req.json()) as IncomingSnap;
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  // バリデーション
  if (typeof body.snapId !== "string" || body.snapId.length === 0) {
    return new Response("invalid snapId", { status: 400 });
  }
  if (typeof body.takenAt !== "string" || Number.isNaN(Date.parse(body.takenAt))) {
    return new Response("invalid takenAt", { status: 400 });
  }
  if (!isEye(body.eye)) {
    return new Response("invalid eye", { status: 400 });
  }
  if (
    body.smileScore !== undefined &&
    body.smileScore !== null &&
    typeof body.smileScore !== "number"
  ) {
    return new Response("invalid smileScore", { status: 400 });
  }
  if (
    body.feedbackText !== undefined &&
    body.feedbackText !== null &&
    typeof body.feedbackText !== "string"
  ) {
    return new Response("invalid feedbackText", { status: 400 });
  }

  try {
    await upsertSnapMeta({
      snapId: body.snapId,
      participantId: payload.participantId, // ← ボディではなくトークン由来
      takenAt: body.takenAt,
      eye: body.eye,
      smileScore: (body.smileScore as number | undefined) ?? null,
      feedbackText: (body.feedbackText as string | undefined) ?? null,
    });
  } catch (e) {
    console.error("upsertSnapMeta error", e);
    return new Response("server error", { status: 500 });
  }

  return Response.json({ ok: true, syncedAt: new Date().toISOString() });
}
