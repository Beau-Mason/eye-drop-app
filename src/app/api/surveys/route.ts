// アンケート（自己効力感 + 任意の自由記述）送信 API

import { NextRequest } from "next/server";
import { verifyAuthHeader, isWithinStudyPeriod } from "@/lib/auth-server";
import { upsertSurveyMeta } from "@/lib/db-server";
import { COMMENT_MAX_LENGTH } from "@/lib/survey-items";

export const runtime = "nodejs";

type IncomingSurvey = {
  surveyId?: unknown;
  snapId?: unknown;
  takenAt?: unknown;
  answeredAt?: unknown;
  selfEfficacy?: unknown;
  comment?: unknown;
};

function isSelfEfficacy(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 7;
}

export async function POST(req: NextRequest) {
  const payload = verifyAuthHeader(req.headers.get("authorization"));
  if (!payload) return new Response("unauthorized", { status: 401 });
  if (!isWithinStudyPeriod()) {
    return new Response("study period is closed", { status: 403 });
  }

  const ct = req.headers.get("content-type") ?? "";
  if (!ct.toLowerCase().includes("application/json")) {
    return new Response("unsupported content-type", { status: 415 });
  }

  let body: IncomingSurvey;
  try {
    body = (await req.json()) as IncomingSurvey;
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  if (typeof body.snapId !== "string" || body.snapId.length === 0) {
    return new Response("invalid snapId", { status: 400 });
  }
  if (
    typeof body.takenAt !== "string" ||
    Number.isNaN(Date.parse(body.takenAt))
  ) {
    return new Response("invalid takenAt", { status: 400 });
  }
  if (
    typeof body.answeredAt !== "string" ||
    Number.isNaN(Date.parse(body.answeredAt))
  ) {
    return new Response("invalid answeredAt", { status: 400 });
  }
  if (!isSelfEfficacy(body.selfEfficacy)) {
    return new Response("invalid selfEfficacy", { status: 400 });
  }
  let comment: string | null = null;
  if (body.comment !== undefined && body.comment !== null) {
    if (typeof body.comment !== "string") {
      return new Response("invalid comment", { status: 400 });
    }
    if (body.comment.length > COMMENT_MAX_LENGTH) {
      return new Response("comment too long", { status: 400 });
    }
    const trimmed = body.comment.trim();
    comment = trimmed.length === 0 ? null : trimmed;
  }

  try {
    await upsertSurveyMeta({
      snapId: body.snapId,
      participantId: payload.participantId,
      takenAt: body.takenAt,
      answeredAt: body.answeredAt,
      selfEfficacy: body.selfEfficacy as number,
      comment,
    });
  } catch (e) {
    console.error("upsertSurveyMeta error", e);
    return new Response("server error", { status: 500 });
  }

  return Response.json({ ok: true, syncedAt: new Date().toISOString() });
}
