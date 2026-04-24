// 参加者個別の点眼記録ページ。
// URL 例: /admin/records/P01
// src/middleware.ts の Basic 認証で保護されている。

import Link from "next/link";
import { notFound } from "next/navigation";
import { listAllSnapMeta } from "@/lib/db-server";
import {
  listAllParticipants,
  type ParticipantEntry,
} from "@/lib/participants-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { displayId: string };

export default async function ParticipantRecordsPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { displayId } = await params;

  const participants = listAllParticipants();
  const index = participants.findIndex(
    (_: ParticipantEntry, i: number) =>
      `P${String(i + 1).padStart(2, "0")}` === displayId,
  );
  if (index < 0) notFound();
  const target = participants[index];

  const allRows = await listAllSnapMeta();
  const rows = allRows
    .filter((r) => r.participantId === target.participantId)
    .sort((a, b) => b.takenAt.localeCompare(a.takenAt));

  return (
    <main className="min-h-dvh p-6 max-w-4xl mx-auto">
      <div className="mb-4">
        <Link
          href="/admin/records"
          className="text-sm opacity-70 hover:opacity-100"
        >
          ← 参加者一覧に戻る
        </Link>
      </div>

      <h1 className="text-2xl font-semibold mb-2">{displayId} の点眼記録</h1>
      <p className="text-sm opacity-70 mb-6">
        {rows.length} 件。撮影日時が新しい順に表示。
      </p>

      {rows.length === 0 ? (
        <p className="text-sm opacity-60">まだ記録がありません。</p>
      ) : (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b">
              <th className="text-left py-2 pr-3">撮影日時</th>
              <th className="text-left py-2 pr-3">眼</th>
              <th className="text-right py-2 pr-3">笑顔スコア</th>
              <th className="text-left py-2 pr-3">フィードバック</th>
              <th className="text-left py-2 pr-3 opacity-60">受信時刻</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.snapId} className="border-b">
                <td className="py-2 pr-3 tabular-nums">
                  {new Date(r.takenAt).toLocaleString("ja-JP")}
                </td>
                <td className="py-2 pr-3">{r.eye}</td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {r.smileScore?.toFixed(2) ?? "-"}
                </td>
                <td className="py-2 pr-3">{r.feedbackText ?? ""}</td>
                <td className="py-2 pr-3 text-xs opacity-60 tabular-nums">
                  {new Date(r.receivedAt).toLocaleString("ja-JP")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
