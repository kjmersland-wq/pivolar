import { NextResponse } from "next/server";
import { SESSION_COOKIE, authConfigured, createSession, safeEqual, sessionMaxAge } from "@/lib/auth";

export async function POST(request: Request) {
  if (!authConfigured()) {
    return NextResponse.json({ error: "Innlogging er ikke satt opp (APP_PASSWORD og APP_SECRET mangler)." }, { status: 500 });
  }
  const { password } = (await request.json().catch(() => ({}))) as { password?: string };
  if (typeof password !== "string" || !safeEqual(password, process.env.APP_PASSWORD!)) {
    return NextResponse.json({ error: "Feil passord." }, { status: 401 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, await createSession(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: sessionMaxAge,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
