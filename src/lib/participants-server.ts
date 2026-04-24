// サーバー専用。data/participants.json を読み、招待コードのハッシュから participantId を引く。

import fs from "node:fs";
import path from "node:path";
import { hashInviteCode } from "@/lib/auth-server";

export type ParticipantEntry = {
  participantId: string;
  codeHash: string;
  issuedAt: string;
  revoked?: boolean;
};

type ParticipantsFile = {
  participants: ParticipantEntry[];
};

let cached: ParticipantsFile | null = null;

function loadFile(): ParticipantsFile {
  if (cached) return cached;
  const p = path.join(process.cwd(), "data", "participants.json");
  const raw = fs.readFileSync(p, "utf8");
  const parsed = JSON.parse(raw) as ParticipantsFile;
  cached = parsed;
  return parsed;
}

// 招待コードから参加者を検索。revoked は除外する。
export function findParticipantByCode(
  code: string,
): ParticipantEntry | null {
  const file = loadFile();
  const hash = hashInviteCode(code);
  const match = file.participants.find(
    (p) => p.codeHash === hash && !p.revoked,
  );
  return match ?? null;
}

// 全参加者 ID 一覧（管理画面で連番表示するため）
export function listAllParticipants(): ParticipantEntry[] {
  return loadFile().participants;
}
