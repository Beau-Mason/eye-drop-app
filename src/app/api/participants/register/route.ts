// 参加者登録 API
//
// 処理フロー:
//   1. クライアントから送られた招待コードを HMAC でハッシュ化
//   2. data/participants.json の台帳から該当する participantId を引く
//   3. 実験期間外 / 未登録 / revoke 済み なら拒否
//   4. 有効期限付きトークンを発行して返却
//
// 台帳には codeHash しか書かれていないため、リポジトリが漏れても未配布コードは使えない。

import { NextRequest } from "next/server";
import {
  issueToken,
  isWithinStudyPeriod,
} from "@/lib/auth-server";
import { findParticipantByCode } from "@/lib/participants-server";

export const runtime = "nodejs"; // crypto / fs を使うため edge 不可

export async function POST(req: NextRequest) {
  try {
    if (!isWithinStudyPeriod()) {
      return new Response("study period is closed", { status: 403 });
    }

    const body = (await req.json()) as { inviteCode?: string };
    const inviteCode = body.inviteCode?.trim();
    if (!inviteCode || typeof inviteCode !== "string") {
      return new Response("invalid inviteCode", { status: 400 });
    }

    const participant = findParticipantByCode(inviteCode);
    if (!participant) {
      return new Response("invite code not allowed", { status: 403 });
    }

    const token = issueToken(participant.participantId);
    return Response.json({
      participantId: participant.participantId,
      token,
    });
  } catch (e) {
    console.error("register error", e);
    return new Response("server error", { status: 500 });
  }
}
