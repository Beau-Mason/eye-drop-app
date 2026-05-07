// 参加者個別の点眼記録 + アンケート結果ページ。
// URL 例: /admin/records/P01
// src/middleware.ts の Basic 認証で保護されている。

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  listAllSnapMeta,
  listAllSurveyMeta,
  type SurveyMetaView,
} from "@/lib/db-server";
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

  const [allSnapRows, allSurveyRows] = await Promise.all([
    listAllSnapMeta(),
    listAllSurveyMeta(),
  ]);

  const snapRows = allSnapRows
    .filter((r) => r.participantId === target.participantId)
    .sort((a, b) => b.takenAt.localeCompare(a.takenAt));

  const surveyRows = allSurveyRows
    .filter((r) => r.participantId === target.participantId)
    .sort((a, b) => b.takenAt.localeCompare(a.takenAt));

  const surveyBySnapId = new Map<string, SurveyMetaView>();
  for (const s of surveyRows) surveyBySnapId.set(s.snapId, s);

  return (
    <main className="min-h-dvh p-6 max-w-5xl mx-auto">
      <div className="mb-4">
        <Link
          href="/admin/records"
          className="text-sm opacity-70 hover:opacity-100"
        >
          ← 参加者一覧に戻る
        </Link>
      </div>

      <h1 className="text-2xl font-semibold mb-2">{displayId} の記録</h1>
      <p className="text-sm opacity-70 mb-6">
        点眼記録 {snapRows.length} 件 / アンケート {surveyRows.length} 件
      </p>

      <section className="mb-10">
        <h2 className="text-lg font-semibold mb-2">点眼記録</h2>
        {snapRows.length === 0 ? (
          <p className="text-sm opacity-60">まだ記録がありません。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 pr-3">撮影日時</th>
                  <th className="text-left py-2 pr-3">眼</th>
                  <th className="text-right py-2 pr-3">笑顔</th>
                  <th className="text-left py-2 pr-3">フィードバック</th>
                  <th className="text-center py-2 pr-3">アンケート</th>
                </tr>
              </thead>
              <tbody>
                {snapRows.map((r) => (
                  <tr key={r.snapId} className="border-b">
                    <td className="py-2 pr-3 tabular-nums">
                      {new Date(r.takenAt).toLocaleString("ja-JP")}
                    </td>
                    <td className="py-2 pr-3">{r.eye}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {r.smileScore?.toFixed(2) ?? "-"}
                    </td>
                    <td className="py-2 pr-3 whitespace-pre-line">
                      {r.feedbackText ?? ""}
                    </td>
                    <td className="py-2 pr-3 text-center text-xs">
                      {surveyBySnapId.has(r.snapId) ? "✓" : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">アンケート回答</h2>
        {surveyRows.length === 0 ? (
          <p className="text-sm opacity-60">まだ回答がありません。</p>
        ) : (
          <div className="space-y-4">
            {surveyRows.map((s) => (
              <SurveyBlock key={s.snapId} survey={s} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function SurveyBlock({ survey }: { survey: SurveyMetaView }) {
  return (
    <article className="rounded-2xl border p-4">
      <header className="flex items-baseline justify-between gap-4 mb-3">
        <div className="text-sm">
          <div className="font-semibold tabular-nums">
            撮影: {new Date(survey.takenAt).toLocaleString("ja-JP")}
          </div>
          <div className="text-xs opacity-60 tabular-nums">
            回答: {new Date(survey.answeredAt).toLocaleString("ja-JP")}
          </div>
        </div>
      </header>

      <div className="grid md:grid-cols-[auto_1fr] gap-4">
        <div className="rounded-xl bg-sky-50 dark:bg-sky-900/20 p-3 text-sm min-w-[180px]">
          <div className="flex items-baseline justify-between">
            <span className="font-semibold">自己効力感</span>
            <span className="text-xs opacity-70">0–7</span>
          </div>
          <div className="mt-1 text-3xl font-bold tabular-nums">
            {survey.selfEfficacy}
          </div>
        </div>

        <div className="rounded-xl bg-black/5 dark:bg-white/5 p-3 text-sm">
          <div className="font-semibold mb-1">自由記述</div>
          {survey.comment ? (
            <p className="whitespace-pre-wrap leading-relaxed">
              {survey.comment}
            </p>
          ) : (
            <p className="opacity-50 text-xs">（記入なし）</p>
          )}
        </div>
      </div>
    </article>
  );
}
