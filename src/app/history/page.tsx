"use client";

import { useEffect, useState } from "react";
import { db, type Snap } from "@/lib/db";
import { useRouter } from "next/navigation";

export default function HistoryPage() {
  const router = useRouter();
  const [items, setItems] = useState<Array<{ snap: Snap; url: string }>>([]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const snaps = await db.snaps.orderBy("takenAt").reverse().toArray();
      if (!mounted) return;
      const withUrl = snaps.map((s) => ({
        snap: s,
        url: URL.createObjectURL(s.blob),
      }));
      setItems(withUrl);
    })();
    return () => {
      mounted = false;
      // 生成した URL を解放
      items.forEach((i) => URL.revokeObjectURL(i.url));
    };
  }, []);

  const remove = async (id: string) => {
    await db.snaps.delete(id);
    setItems((prev) => prev.filter((i) => i.snap.id !== id));
  };

  return (
    <main className="mx-auto max-w-xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">記録履歴</h1>
        <button
          onClick={() => router.push("/")}
          className="inline-flex items-center gap-1 rounded-xl border px-3 py-2"
          aria-label="はじめのページへ戻る"
        >
          ← はじめのページへ
        </button>
      </div>

      <ul className="grid grid-cols-2 gap-3">
        {items.map(({ snap, url }) => (
          <li key={snap.id} className="rounded-xl overflow-hidden border">
            <img
              src={url}
              alt="記録写真"
              className="w-full aspect-video object-cover"
            />
            <div className="p-2 text-xs opacity-70">
              {new Date(snap.takenAt).toLocaleString()}（
              {snap.eye === "both" ? "両" : snap.eye === "left" ? "左" : "右"}）
            </div>
            <button
              onClick={() => remove(snap.id)}
              className="m-2 text-xs underline"
            >
              削除
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
