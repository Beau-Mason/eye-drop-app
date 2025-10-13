// app/page.tsx
"use client";

import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  return (
    <main className="min-h-dvh flex flex-col items-center justify-center gap-8 p-6">
      <h1 className="text-3xl md:text-4xl font-semibold">点眼記録アプリ</h1>
      <div className="flex flex-col gap-4 w-full max-w-xs">
        <button
          onClick={() => router.push("/record")}
          className="px-5 py-3 rounded-2xl btn-primary"
        >
          点眼記録をつける
        </button>
        <button
          onClick={() => router.push("/history")}
          className="px-5 py-3 rounded-2xl btn-outline"
        >
          記録を閲覧
        </button>
      </div>
    </main>
  );
}
