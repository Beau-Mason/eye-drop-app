"use client";
import { db, type Settings } from "@/lib/db";
import { v4 as uuid } from "uuid";

export async function ensureSettings(): Promise<Settings> {
  let cur = await db.settings.get("settings"); // IndexedDBのsettingsテーブルから"settings"キーを検索
  if (!cur) {
    // もし存在しなければ新しく作る．
    cur = { id: "settings", deviceId: uuid() }; // uuid()でデバイスを認識するランダムなIDを生成
    await db.settings.put(cur); // 端末ごとに登録
  }
  return cur;
}

// 例
// cur = {
//   id: "settings",
//   deviceId: "abc-111",
//   participantId: "p_123",
//   token: "old-token"
// }

export async function updateSettings(
  partial: Partial<Settings>,
): Promise<Settings> {
  const cur = await ensureSettings();
  const next: Settings = { ...cur, ...partial } as Settings;
  await db.settings.put(next);
  return next;
}

export async function getParticipantId(): Promise<string | undefined> {
  const s = await ensureSettings();
  return s.participantId;
}

// 一度登録した participantId は以降上書きしない
export async function registerIfEmpty(input: {
  participantId: string;
  inviteCode?: string;
  token?: string;
}): Promise<Settings> {
  const cur = await ensureSettings();
  if (cur.participantId) {
    return cur;
  }
  const next: Settings = {
    ...cur,
    participantId: input.participantId,
    inviteCode: input.inviteCode ?? cur.inviteCode,
    token: input.token ?? cur.token,
  } as Settings;
  await db.settings.put(next);
  return next;
}

export async function isRegistered(): Promise<boolean> {
  const s = await ensureSettings();
  return Boolean(s.participantId);
}
