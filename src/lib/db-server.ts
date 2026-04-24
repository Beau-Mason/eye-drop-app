// サーバー専用 Postgres クライアント。
// DATABASE_URL を環境変数から読み、Vercel Postgres / Supabase / Neon / 任意の Postgres に接続する。
//
// 重要: このファイルにクライアントから import してはいけない（Node 専用）。
//
// テーブル構造:
//   snaps_meta (
//     snap_id        text primary key,   -- 端末側 uuid
//     participant_id text not null,      -- トークンから取得（クライアント入力を信用しない）
//     taken_at       timestamptz not null,
//     eye            text not null,
//     smile_score    double precision,
//     feedback_text  text,
//     received_at    timestamptz not null default now()
//   )
//
// 重要: 画像関連カラムは意図的に一切持たない。「研究者は顔写真を見ない」という
// 研究倫理方針を型とスキーマの両方で担保する。

import postgres from "postgres";

type SnapMetaRow = {
  snap_id: string;
  participant_id: string;
  taken_at: Date;
  eye: string;
  smile_score: number | null;
  feedback_text: string | null;
  received_at: Date;
};

let sql: ReturnType<typeof postgres> | null = null;

function getClient() {
  if (sql) return sql;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  sql = postgres(url, {
    // Supabase/Neon/Vercel Postgres いずれも SSL 必須
    ssl: "require",
    // サーバーレスでもコネクションを使い回せるよう小さめ
    max: 5,
    idle_timeout: 20,
  });
  return sql;
}

// 初回 import 時にテーブルが無ければ作成する簡易マイグレーション。
// 実験規模（参加者数十名）なら起動時の一度きりの冪等実行で十分。
let migratedOnce = false;
async function ensureSchema() {
  if (migratedOnce) return;
  const client = getClient();
  await client`
    CREATE TABLE IF NOT EXISTS snaps_meta (
      snap_id text PRIMARY KEY,
      participant_id text NOT NULL,
      taken_at timestamptz NOT NULL,
      eye text NOT NULL,
      smile_score double precision,
      feedback_text text,
      received_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await client`
    CREATE INDEX IF NOT EXISTS snaps_meta_participant_taken_idx
      ON snaps_meta (participant_id, taken_at)
  `;
  migratedOnce = true;
}

export type SnapMetaInsert = {
  snapId: string;
  participantId: string;
  takenAt: string; // ISO
  eye: "left" | "right" | "both";
  smileScore?: number | null;
  feedbackText?: string | null;
};

// snapId で upsert。再送信しても重複しない（冪等）。
export async function upsertSnapMeta(row: SnapMetaInsert): Promise<void> {
  await ensureSchema();
  const client = getClient();
  await client`
    INSERT INTO snaps_meta (
      snap_id, participant_id, taken_at, eye, smile_score, feedback_text
    ) VALUES (
      ${row.snapId},
      ${row.participantId},
      ${row.takenAt},
      ${row.eye},
      ${row.smileScore ?? null},
      ${row.feedbackText ?? null}
    )
    ON CONFLICT (snap_id) DO UPDATE SET
      taken_at = EXCLUDED.taken_at,
      eye = EXCLUDED.eye,
      smile_score = EXCLUDED.smile_score,
      feedback_text = EXCLUDED.feedback_text
  `;
}

export type SnapMetaView = {
  snapId: string;
  participantId: string;
  takenAt: string;
  eye: string;
  smileScore: number | null;
  feedbackText: string | null;
  receivedAt: string;
};

function rowToView(r: SnapMetaRow): SnapMetaView {
  return {
    snapId: r.snap_id,
    participantId: r.participant_id,
    takenAt: r.taken_at.toISOString(),
    eye: r.eye,
    smileScore: r.smile_score,
    feedbackText: r.feedback_text,
    receivedAt: r.received_at.toISOString(),
  };
}

// 管理画面向け: 全記録を participant_id, taken_at 順で取得
export async function listAllSnapMeta(): Promise<SnapMetaView[]> {
  await ensureSchema();
  const client = getClient();
  const rows = await client<SnapMetaRow[]>`
    SELECT snap_id, participant_id, taken_at, eye, smile_score, feedback_text, received_at
    FROM snaps_meta
    ORDER BY participant_id ASC, taken_at ASC
  `;
  return rows.map(rowToView);
}
