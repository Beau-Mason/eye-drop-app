// /admin と /api/admin 以下を Basic 認証で保護する。
//
// Next.js のサーバーコンポーネントから直接 401 を返すのは難しいため、
// ページとルートハンドラの両方を middleware で一元的に保護する。
//
// middleware は Edge ランタイムで動くので Node の crypto が使えない。
// ここでは atob + 単純比較のみ行う（タイミング攻撃の脅威モデル外）。

import { NextRequest, NextResponse } from "next/server";

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};

export function middleware(req: NextRequest) {
  const expectedUser = process.env.ADMIN_USER;
  const expectedPass = process.env.ADMIN_PASS;
  if (!expectedUser || !expectedPass) {
    return new NextResponse("admin auth not configured", { status: 503 });
  }

  const auth = req.headers.get("authorization");
  const m = auth?.match(/^Basic\s+(.+)$/i);
  if (m) {
    try {
      const decoded = atob(m[1]);
      const idx = decoded.indexOf(":");
      if (idx >= 0) {
        const user = decoded.slice(0, idx);
        const pass = decoded.slice(idx + 1);
        if (user === expectedUser && pass === expectedPass) {
          return NextResponse.next();
        }
      }
    } catch {
      // fallthrough
    }
  }

  return new NextResponse("unauthorized", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="eye-drop-admin", charset="UTF-8"',
    },
  });
}
