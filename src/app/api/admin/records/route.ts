// 研究者向け記録閲覧 API。Basic 認証で保護。
//
// 返却するのは takenAt / eye / smileScore / feedbackText / participantId のみ。
// 画像関連フィールドは DB スキーマにも存在しないため、ここで漏れる経路は無い。
//
// 参加者は displayId (P01, P02, ...) にエイリアスして返す。
// 生の participantId ハッシュはクエリパラメータ ?raw=1 を指定した場合のみ同封する。

// Basic 認証は src/middleware.ts で一元的に保護している。

import { NextRequest } from "next/server";
import { listAllSnapMeta } from "@/lib/db-server";
import { listAllParticipants } from "@/lib/participants-server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const wantRaw = req.nextUrl.searchParams.get("raw") === "1";

  // participantId -> displayId のマップを作る
  const participants = listAllParticipants();
  const displayMap = new Map<string, string>();
  participants.forEach((p, i) => {
    displayMap.set(p.participantId, `P${String(i + 1).padStart(2, "0")}`);
  });

  const rows = await listAllSnapMeta();

  const records = rows.map((r) => ({
    displayId: displayMap.get(r.participantId) ?? "P??",
    participantId: wantRaw ? r.participantId : undefined,
    takenAt: r.takenAt,
    eye: r.eye,
    smileScore: r.smileScore,
    feedbackText: r.feedbackText,
    receivedAt: r.receivedAt,
  }));

  // 参加者別の件数サマリ
  const summary = participants.map((p, i) => ({
    displayId: `P${String(i + 1).padStart(2, "0")}`,
    participantId: wantRaw ? p.participantId : undefined,
    count: rows.filter((r) => r.participantId === p.participantId).length,
  }));

  return Response.json({ summary, records });
}
