// サーバー専用。クライアントから import してはいけない。
// 認証トークンの発行・検証と、参加コードのハッシュ化を行う。
//
// トークン形式: base64url(payload).base64url(sig)
//   payload = { participantId, iat, exp }
//   sig     = HMAC-SHA256(payload, AUTH_SECRET)
//
// 簡易 JWT 互換（3 セグメントの標準 JWT ではない）。
// jose などの重い依存を入れずに実験用途で必要十分な強度を確保する。

import crypto from "node:crypto";

export type TokenPayload = {
  participantId: string;
  iat: number; // 発行時刻 (ms)
  exp: number; // 有効期限 (ms)
};

function getSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) {
    throw new Error("AUTH_SECRET is not set or too short (min 16 chars)");
  }
  return s;
}

function b64urlEncode(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf) : buf;
  return b.toString("base64url");
}

function b64urlDecode(str: string): Buffer {
  return Buffer.from(str, "base64url");
}

function sign(payload: string): string {
  return crypto
    .createHmac("sha256", getSecret())
    .update(payload)
    .digest("base64url");
}

// 参加コード→内部保管用ハッシュ。参加コード生成スクリプトと同じ式。
export function hashInviteCode(code: string): string {
  return crypto.createHmac("sha256", getSecret()).update(code).digest("hex");
}

export function issueToken(
  participantId: string,
  ttlMs: number = 1000 * 60 * 60 * 24 * 45, // 既定 45 日（1ヶ月実験+余裕）
): string {
  const iat = Date.now();
  const exp = iat + ttlMs;
  const payloadJson = JSON.stringify({ participantId, iat, exp });
  const payload = b64urlEncode(payloadJson);
  const sig = sign(payload);
  return `${payload}.${sig}`;
}

export function verifyToken(token: string): TokenPayload | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;

  // 定数時間比較で署名検証
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;

  let parsed: TokenPayload;
  try {
    parsed = JSON.parse(b64urlDecode(payload).toString("utf8"));
  } catch {
    return null;
  }
  if (
    !parsed ||
    typeof parsed.participantId !== "string" ||
    typeof parsed.exp !== "number"
  ) {
    return null;
  }
  if (Date.now() > parsed.exp) return null;
  return parsed;
}

// Authorization ヘッダからトークンを取り出して検証するユーティリティ
export function verifyAuthHeader(
  authHeader: string | null,
): TokenPayload | null {
  if (!authHeader) return null;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  return verifyToken(m[1]);
}

// 実験期間チェック。STUDY_START/STUDY_END 環境変数（ISO 文字列）が設定されていれば
// その範囲内かどうかを判定する。未設定なら常に true。
export function isWithinStudyPeriod(now: Date = new Date()): boolean {
  const start = process.env.STUDY_START;
  const end = process.env.STUDY_END;
  if (start && now < new Date(start)) return false;
  if (end && now > new Date(end)) return false;
  return true;
}
