import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

function apiOrigin(request: NextRequest) {
  const configured =
    process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL;
  return (configured?.trim() || request.nextUrl.origin).replace(/\/$/, "");
}

export async function proxy(request: NextRequest) {
  const slug = request.nextUrl.pathname.slice("/blog/".length);
  if (!slug || slug.includes("/")) return NextResponse.next();

  try {
    const response = await fetch(
      `${apiOrigin(request)}/api/seo/redirects/${encodeURIComponent(slug)}`,
      {
        cache: "no-store",
        headers: { Accept: "application/json" },
      },
    );
    if (!response.ok) return NextResponse.next();
    const result = (await response.json()) as { redirectTo?: unknown };
    if (typeof result.redirectTo !== "string" || !result.redirectTo) {
      return NextResponse.next();
    }
    const destination = request.nextUrl.clone();
    destination.pathname = `/blog/${result.redirectTo}`;
    return NextResponse.redirect(destination, 301);
  } catch {
    return NextResponse.next();
  }
}

export const config = {
  matcher: "/blog/:slug",
};
