"use client";

// 点眼記録直後のアンケートページ。
// 自己効力感（必須、0-7）と自由記述（任意）の2項目のみ。

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { db } from "@/lib/db";
import { getParticipantId } from "@/lib/settings";
import { syncPendingSurveys } from "@/lib/sync";
import {
  SELF_EFFICACY_ITEM,
  SELF_EFFICACY_MIN,
  SELF_EFFICACY_MAX,
  SELF_EFFICACY_LABELS,
  COMMENT_ITEM,
  COMMENT_MAX_LENGTH,
} from "@/lib/survey-items";

export default function SurveyPage({
  params,
}: {
  params: Promise<{ snapId: string }>;
}) {
  const { snapId } = use(params);
  const router = useRouter();

  const [selfEfficacy, setSelfEfficacy] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alreadyAnswered, setAlreadyAnswered] = useState(false);
  const [snapFound, setSnapFound] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      const snap = await db.snaps.get(snapId);
      if (!snap) {
        setSnapFound(false);
        return;
      }
      setSnapFound(true);
      const existing = await db.surveys.get(snapId);
      if (existing) setAlreadyAnswered(true);
    })();
  }, [snapId]);

  const submit = async () => {
    if (selfEfficacy === null) {
      setError("自己効力感の項目にご回答ください。");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const snap = await db.snaps.get(snapId);
      if (!snap) {
        setError("対応する記録が見つかりません。");
        return;
      }
      const pid = await getParticipantId();
      const trimmed = comment.trim();
      await db.surveys.put({
        id: snapId,
        snapId,
        takenAt: snap.takenAt,
        answeredAt: new Date().toISOString(),
        participantId: pid,
        selfEfficacy,
        comment: trimmed.length > 0 ? trimmed : undefined,
      });
      void syncPendingSurveys().catch(() => {});
      router.push("/");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "送信に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  if (snapFound === false) {
    return (
      <main className="min-h-dvh flex flex-col items-center justify-center p-6 gap-4">
        <p>対象の記録が見つかりませんでした。</p>
        <button
          onClick={() => router.push("/")}
          className="px-5 py-3 rounded-2xl btn-outline"
        >
          はじめのページへ
        </button>
      </main>
    );
  }

  if (alreadyAnswered) {
    return (
      <main className="min-h-dvh flex flex-col items-center justify-center p-6 gap-4">
        <p>この記録についてはすでにご回答いただいています。</p>
        <button
          onClick={() => router.push("/")}
          className="px-5 py-3 rounded-2xl btn-primary"
        >
          はじめのページへ
        </button>
      </main>
    );
  }

  return (
    <main className="min-h-dvh p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-semibold mb-2">アンケート</h1>
      <p className="text-sm opacity-70 mb-6">
        今の気持ちにもっとも近いものをお選びください。
      </p>

      <ol className="space-y-6">
        {/* Q1: 自己効力感 (0-7) */}
        <li className="rounded-2xl border p-4 bg-white/60 dark:bg-black/40">
          <p className="text-base mb-3">
            <span className="font-semibold mr-2">Q1.</span>
            {SELF_EFFICACY_ITEM.text}
          </p>
          <div className="flex items-center justify-between text-xs opacity-70 mb-2 px-1">
            <span>0: {SELF_EFFICACY_LABELS.min}</span>
            <span>7: {SELF_EFFICACY_LABELS.max}</span>
          </div>
          <div className="grid grid-cols-8 gap-2">
            {Array.from(
              { length: SELF_EFFICACY_MAX - SELF_EFFICACY_MIN + 1 },
              (_, i) => i + SELF_EFFICACY_MIN,
            ).map((v) => {
              const active = selfEfficacy === v;
              return (
                <button
                  type="button"
                  key={v}
                  onClick={() => setSelfEfficacy(v)}
                  className={`py-2 rounded-xl border text-sm font-semibold transition-all ${
                    active
                      ? "bg-sky-600 text-white border-sky-600 shadow"
                      : "bg-white/80 dark:bg-black/60 hover:shadow"
                  }`}
                >
                  {v}
                </button>
              );
            })}
          </div>
        </li>

        {/* Q2: 自由記述 (任意) */}
        <li className="rounded-2xl border p-4 bg-white/60 dark:bg-black/40">
          <p className="text-base mb-3">
            <span className="font-semibold mr-2">Q2.</span>
            {COMMENT_ITEM.text}
          </p>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={COMMENT_MAX_LENGTH}
            rows={4}
            placeholder="（任意）"
            className="w-full rounded-xl border px-3 py-2 bg-white/90 dark:bg-black/60 text-sm"
          />
          <div className="text-right text-xs opacity-60 mt-1 tabular-nums">
            {comment.length} / {COMMENT_MAX_LENGTH}
          </div>
        </li>
      </ol>

      {error && <p className="text-sm text-red-600 mt-4">{error}</p>}

      <div className="mt-8 flex justify-end">
        <button
          type="button"
          onClick={submit}
          disabled={selfEfficacy === null || loading}
          className="px-6 py-3 rounded-2xl btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "送信中…" : "回答を送信"}
        </button>
      </div>
    </main>
  );
}
