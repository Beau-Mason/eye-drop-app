"use client";

// サーバーへの送信レイヤー。
//
// 研究倫理上、顔写真（Blob）は端末外に一切出してはいけない。
// そのためサーバーへ送るデータは Snap から blob を取り除いた SnapRecord に限定し、
// 型レベルでも誤送信を防ぐ。
//
// - 画像は IndexedDB にのみ残る
// - メタデータ（撮影日時・笑顔スコア・表示したフィードバック文）だけを /api/snaps に送る

import { db, type Snap } from "@/lib/db";
import { ensureSettings } from "@/lib/settings";

// サーバーに送ってよいフィールドだけを列挙した型。blob は意図的に含めない。
export type SnapRecord = {
  snapId: string;
  takenAt: string;
  eye: "left" | "right" | "both";
  smileScore?: number;
  feedbackText?: string;
};

// Snap → SnapRecord 変換。blob は Omit で型から落とし、かつ実体も参照しない。
export function toSnapRecord(snap: Snap): SnapRecord {
  return {
    snapId: snap.id,
    takenAt: snap.takenAt,
    eye: snap.eye,
    smileScore: snap.smileScore,
    feedbackText: snap.note,
  };
}

// 未同期の Snap を取り出して一括送信する。
// - 認証トークンがなければ何もしない（未登録参加者）
// - ネットワーク失敗時は syncedAt を更新しないだけで、次回再試行される
// - 成功したレコードには syncedAt を記録する
export async function syncPendingSnaps(): Promise<{
  sent: number;
  failed: number;
}> {
  const settings = await ensureSettings();
  const token = settings.token;
  if (!token) return { sent: 0, failed: 0 };

  // syncedAt を持たないレコードを対象にする
  const all = await db.snaps.toArray();
  const pending = all.filter((s) => !s.syncedAt);
  if (pending.length === 0) return { sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;

  for (const snap of pending) {
    const record = toSnapRecord(snap);
    try {
      const res = await fetch("/api/snaps", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(record),
      });
      if (!res.ok) {
        // 401/403 は再試行しても無駄なので、ここでは単に失敗カウントにする
        failed += 1;
        continue;
      }
      await db.snaps.update(snap.id, { syncedAt: new Date().toISOString() });
      sent += 1;
    } catch {
      failed += 1;
    }
  }

  return { sent, failed };
}
