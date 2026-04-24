"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ensureSettings, registerIfEmpty } from "@/lib/settings";

export default function RegisterPage() {
  const router = useRouter();
  const [code, setCode] = useState(""); // ユーザーが打った文字列
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alreadyRegistered, setAlreadyRegistered] = useState(false);
  const [currentInvite, setCurrentInvite] = useState<string | null>(null);

  // 既に登録済みなら上書きできないようにする
  useEffect(() => {
    (async () => {
      // IndexedDBがなんらかの理由で読めない時もページ全体が落ちないように
      try {
        const s = await ensureSettings();
        // participantIDが存在するなら登録済みと判断
        if (s.participantId) {
          setAlreadyRegistered(true);
          setCurrentInvite(s.inviteCode ?? null); // inviteCodeがあったらそれをcurrentInviteに設定し，なかったらnullに設定
        }
      } catch {
        // noop
      }
    })();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (alreadyRegistered) {
      setError("この端末は既に登録済みです");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await ensureSettings();
      // サーバーで招待コードを検証
      const res = await fetch("/api/participants/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode: code.trim() }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as {
        participantId: string;
        token?: string;
      };
      await registerIfEmpty({
        participantId: data.participantId,
        inviteCode: code.trim(),
        token: data.token,
      });
      router.push("/");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "登録に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">参加登録</h1>
      {alreadyRegistered && (
        <div className="rounded-xl border px-4 py-3 bg-emerald-50 text-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-100">
          この端末は既に登録済みです。
          {currentInvite && (
            <span className="ml-1 opacity-80">招待コード: {currentInvite}</span>
          )}
        </div>
      )}
      <div className="w-full max-w-sm rounded-xl border px-4 py-3 text-sm leading-relaxed bg-white/60 dark:bg-black/40">
        <p className="font-semibold mb-1">研究者に送られる情報について</p>
        <p className="opacity-80">
          研究者に送信されるのは
          <span className="font-semibold">撮影日時・笑顔スコア・表示されたメッセージ</span>
          のみです。撮影した
          <span className="font-semibold">顔写真はこの端末内にのみ保存され、外部に送信されません</span>
          。
        </p>
      </div>
      <form onSubmit={submit} className="w-full max-w-sm flex flex-col gap-3">
        <label className="text-sm opacity-80">招待コード</label>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
          disabled={alreadyRegistered} // 登録済みなら入力できないように
          className="w-full rounded-2xl border px-3 py-2 bg-white/90 dark:bg-black/60"
          placeholder="例: ABCD-1234"
          inputMode="text"
          autoCapitalize="characters"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={loading || alreadyRegistered}
          className="px-5 py-3 rounded-2xl btn-primary disabled:opacity-50"
        >
          {alreadyRegistered ? "登録済み" : loading ? "登録中…" : "登録する"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/")}
          className="px-5 py-3 rounded-2xl btn-outline"
        >
          はじめのページへ戻る
        </button>
      </form>
    </main>
  );
}
