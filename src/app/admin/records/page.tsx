// 研究者向け参加者一覧ページ（サーバーコンポーネント）。
// 参加者ごとに件数を表示し、クリックで個別の記録ページに遷移する。
// このページへのアクセスは src/middleware.ts の Basic 認証で保護されている。

import Link from "next/link";
import { listAllSnapMeta } from "@/lib/db-server";
import {
  listAllParticipants,
  type ParticipantEntry,
} from "@/lib/participants-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminRecordsPage() {
  const participants = listAllParticipants();
  const rows = await listAllSnapMeta();

  const countMap = new Map<string, number>();
  for (const r of rows) {
    countMap.set(r.participantId, (countMap.get(r.participantId) ?? 0) + 1);
  }

  // 最終記録日時を参加者別に集計（活動状況の把握用）
  const lastMap = new Map<string, string>();
  for (const r of rows) {
    const prev = lastMap.get(r.participantId);
    if (!prev || r.takenAt > prev) {
      lastMap.set(r.participantId, r.takenAt);
    }
  }

  return (
    <main className="min-h-dvh p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold mb-2">参加者一覧（研究者用）</h1>
      <p className="text-sm opacity-70 mb-6">
        参加者をクリックすると、その方の点眼記録が表示されます。
        顔写真は端末外に送信されていません。
      </p>

      <ul className="divide-y rounded-xl border overflow-hidden">
        {participants.map((p: ParticipantEntry, i: number) => {
          const displayId = `P${String(i + 1).padStart(2, "0")}`;
          const count = countMap.get(p.participantId) ?? 0;
          const last = lastMap.get(p.participantId);
          return (
            <li key={p.participantId}>
              <Link
                href={`/admin/records/${displayId}`}
                className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-base">{displayId}</span>
                  {count === 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                      未使用
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4 text-sm opacity-80">
                  <span className="tabular-nums">{count} 件</span>
                  {last && (
                    <span className="tabular-nums text-xs opacity-60">
                      最終: {new Date(last).toLocaleString("ja-JP")}
                    </span>
                  )}
                  <span aria-hidden>›</span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      <p className="mt-6 text-xs opacity-60">合計 {rows.length} 件</p>
    </main>
  );
}
