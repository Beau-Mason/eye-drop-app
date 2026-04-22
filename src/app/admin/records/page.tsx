// 研究者向け記録閲覧ページ（サーバーコンポーネント）。
// このページへのアクセスは src/middleware.ts の Basic 認証で保護されている。

import { listAllSnapMeta } from "@/lib/db-server";
import { listAllParticipants } from "@/lib/participants-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminRecordsPage() {
  const participants = listAllParticipants();
  const displayMap = new Map<string, string>();
  participants.forEach((p, i) => {
    displayMap.set(p.participantId, `P${String(i + 1).padStart(2, "0")}`);
  });

  const rows = await listAllSnapMeta();

  return (
    <main className="min-h-dvh p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">点眼記録一覧（研究者用）</h1>
      <p className="text-sm opacity-70 mb-6">
        表示されるのは撮影日時・笑顔スコア・フィードバック文のみです。顔写真は端末外に送信されません。
      </p>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">参加者別件数</h2>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b">
              <th className="text-left py-2 pr-4">参加者</th>
              <th className="text-right py-2">件数</th>
            </tr>
          </thead>
          <tbody>
            {participants.map((p, i) => {
              const count = rows.filter(
                (r) => r.participantId === p.participantId,
              ).length;
              return (
                <tr key={p.participantId} className="border-b">
                  <td className="py-1.5 pr-4">
                    P{String(i + 1).padStart(2, "0")}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{count}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">記録 ({rows.length} 件)</h2>
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b">
              <th className="text-left py-2 pr-2">参加者</th>
              <th className="text-left py-2 pr-2">撮影日時</th>
              <th className="text-left py-2 pr-2">眼</th>
              <th className="text-right py-2 pr-2">笑顔</th>
              <th className="text-left py-2 pr-2">フィードバック</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.snapId} className="border-b">
                <td className="py-1 pr-2">
                  {displayMap.get(r.participantId) ?? "P??"}
                </td>
                <td className="py-1 pr-2 tabular-nums">
                  {new Date(r.takenAt).toLocaleString("ja-JP")}
                </td>
                <td className="py-1 pr-2">{r.eye}</td>
                <td className="py-1 pr-2 text-right tabular-nums">
                  {r.smileScore?.toFixed(2) ?? "-"}
                </td>
                <td className="py-1 pr-2">{r.feedbackText ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
