#!/usr/bin/env node
// 参加コード一括生成スクリプト。
//
// 使い方:
//   AUTH_SECRET=xxxx node scripts/generate-participants.mjs 30
//
// 仕様:
//   - 第1引数で参加者人数 N を指定（デフォルト 30）
//   - Crockford Base32 から紛らわしい文字（0/O, 1/I/L）を除いた 32 文字セットで
//     EYE-XXXX-XXXX 形式のコードを N 個生成
//   - 生コードは標準出力（研究者はこれを印刷して配布）
//   - data/participants.json には codeHash（HMAC-SHA256(code, AUTH_SECRET)）のみを書き出す
//     → リポジトリが漏れても未配布コードは使えない
//
// 重要: AUTH_SECRET が変わるとハッシュが一致しなくなるため、実験期間中は固定すること。

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const outPath = path.join(repoRoot, "data", "participants.json");

const secret = process.env.AUTH_SECRET;
if (!secret) {
  console.error("ERROR: AUTH_SECRET environment variable is required.");
  process.exit(1);
}

const n = Number(process.argv[2] ?? 30);
if (!Number.isFinite(n) || n <= 0 || n > 1000) {
  console.error("ERROR: participant count must be 1..1000");
  process.exit(1);
}

// 紛らわしい文字（0, O, 1, I, L）を除いた 32 文字セット
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ#"; // 32 文字 (# は未使用, 直後に除外)
const SAFE = ALPHABET.replace("#", "");
if (SAFE.length !== 31) {
  // 安全側: 実際は 31 文字。以下でバイト→index 変換する際に modulo を取るので OK
}

function randomChunk(len) {
  const buf = crypto.randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) {
    out += SAFE[buf[i] % SAFE.length];
  }
  return out;
}

function generateCode() {
  return `EYE-${randomChunk(4)}-${randomChunk(4)}`;
}

function hashCode(code) {
  return crypto.createHmac("sha256", secret).update(code).digest("hex");
}

const nowIso = new Date().toISOString();
const participants = [];
const rawCodes = [];
const seen = new Set();

for (let i = 0; i < n; i++) {
  let code;
  do {
    code = generateCode();
  } while (seen.has(code));
  seen.add(code);

  const participantId = `p_${crypto.randomBytes(8).toString("hex")}`;
  participants.push({
    participantId,
    codeHash: hashCode(code),
    issuedAt: nowIso,
  });
  rawCodes.push({ displayId: `P${String(i + 1).padStart(2, "0")}`, participantId, code });
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify({ participants }, null, 2) + "\n");

console.log(`Wrote ${participants.length} participants to ${path.relative(repoRoot, outPath)}`);
console.log("");
console.log("=== DISTRIBUTE THESE CODES (they are NOT stored anywhere else) ===");
console.log("");
for (const r of rawCodes) {
  console.log(`${r.displayId}\t${r.code}\t(${r.participantId})`);
}
console.log("");
console.log("Save this output securely. Re-running will generate new codes.");
