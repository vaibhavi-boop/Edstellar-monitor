import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/server/auth/token";

/**
 * Optimistic route protection: checks only the session signature so it stays
 * fast. Pages and server actions re-validate the user against the database.
 */
// /api/cron authenticates with its own bearer token (CRON_SECRET), not a session.
const PUBLIC_PATHS = ["/login", "/api/health", "/api/cron"];

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);

  if (!session && !isPublic) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }
  // Signed-in users are sent away from /login by the page itself, after a
  // database check. Doing it here could loop for deactivated accounts whose
  // cookie is still correctly signed.
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)"],
};
