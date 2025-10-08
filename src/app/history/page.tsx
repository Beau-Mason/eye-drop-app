"use client";

import { useEffect, useRef, useState } from "react";
import { db, type Snap } from "@/lib/db";
import { useRouter } from "next/navigation";
import Image from "next/image";

export default function HistoryPage() {
  const router = useRouter();
  const [items, setItems] = useState<Array<{ snap: Snap; url: string }>>([]);
  // 生成した blob: URL を追跡して確実に解放（Safari 安定化）
  const createdUrlsRef = useRef<string[]>([]);

  const ensureJpegBlob = (b: Blob): Blob => {
    if (b.type && b.type.startsWith("image/")) return b;
    return new Blob([b], { type: "image/jpeg" });
  };

  const blobToDataUrl = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });

  useEffect(() => {
    let mounted = true;
    (async () => {
      const snaps = await db.snaps.orderBy("takenAt").reverse().toArray();
      if (!mounted) return;
      const withUrl = snaps.map((s) => {
        const typed = ensureJpegBlob(s.blob);
        const url = URL.createObjectURL(typed);
        createdUrlsRef.current.push(url);
        return { snap: s, url };
      });
      setItems(withUrl);
    })();
    return () => {
      mounted = false;
      // 生成した blob: URL を確実に解放
      for (const u of createdUrlsRef.current) {
        try {
          URL.revokeObjectURL(u);
        } catch {}
      }
      createdUrlsRef.current = [];
    };
  }, []);

  const remove = async (id: string) => {
    await db.snaps.delete(id);
    setItems((prev) => {
      const target = prev.find((i) => i.snap.id === id);
      if (target && target.url.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(target.url);
        } catch {}
      }
      return prev.filter((i) => i.snap.id !== id);
    });
  };

  // Safari で blob: URL の表示に失敗した場合のフォールバック
  const handleImageError = async (id: string) => {
    try {
      const snap = await db.snaps.get(id);
      if (!snap) return;
      const typed = ensureJpegBlob(snap.blob);
      const dataUrl = await blobToDataUrl(typed);
      setItems((prev) =>
        prev.map((i) => {
          if (i.snap.id !== id) return i;
          if (i.url.startsWith("blob:")) {
            try {
              URL.revokeObjectURL(i.url);
            } catch {}
          }
          return { ...i, url: dataUrl };
        })
      );
    } catch {}
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
            <div className="relative w-full aspect-video">
              <Image
                src={url}
                alt="記録写真"
                fill
                sizes="(max-width: 768px) 50vw, 33vw"
                unoptimized
                className="object-cover"
                onError={() => handleImageError(snap.id)}
              />
            </div>
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
