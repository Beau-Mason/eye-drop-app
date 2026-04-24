// app/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { isRegistered } from "@/lib/settings";

export default function Home() {
  const router = useRouter();
  const [registered, setRegistered] = useState<boolean | null>(null);

  useEffect(() => {
    isRegistered().then(setRegistered).catch(() => setRegistered(false));
  }, []);

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center gap-8 p-6">
      <h1 className="text-3xl md:text-4xl font-semibold">点眼記録アプリ</h1>

      {registered === false && (
        <div className="w-full max-w-xs rounded-xl border px-4 py-3 bg-amber-50 text-amber-900 dark:bg-amber-900/20 dark:text-amber-100 text-sm">
          まず参加登録をしてください。登録後に点眼記録をつけられるようになります。
        </div>
      )}

      <div className="flex flex-col gap-4 w-full max-w-xs">
        <button
          onClick={() => router.push("/record")}
          disabled={!registered}
          className="px-5 py-3 rounded-2xl btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          点眼記録をつける
        </button>
        <button
          onClick={() => router.push("/history")}
          disabled={!registered}
          className="px-5 py-3 rounded-2xl btn-outline disabled:opacity-50 disabled:cursor-not-allowed"
        >
          記録を閲覧
        </button>
        <button
          onClick={() => router.push("/register")}
          className="px-5 py-3 rounded-2xl btn-outline"
        >
          参加登録（招待コード）
        </button>
      </div>
    </main>
  );
}
