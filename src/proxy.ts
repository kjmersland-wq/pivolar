import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authConfigured, isOwner } from "@/lib/auth";

// Pivolar is a private tool: everything except the login page needs a Supabase session for an owner address.
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/login") || pathname.startsWith("/api/login")) return NextResponse.next();
  // Published sites report page views here. The route validates everything itself and the database accepts nothing but record_hit.
  if (pathname === "/api/collect") return NextResponse.next();

  let response = NextResponse.next({ request });

  if (authConfigured()) {
    const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(items) {
          for (const { name, value } of items) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of items) response.cookies.set(name, value, options);
        },
      },
    });
    const { data } = await supabase.auth.getClaims();
    if (isOwner(data?.claims?.email as string | undefined)) return response;
  }

  if (pathname.startsWith("/api/")) return new NextResponse("Unauthorized", { status: 401 });
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\.(?:png|jpg|svg|ico|webp)$).*)"],
};
