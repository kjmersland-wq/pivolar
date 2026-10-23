import { NextResponse } from "next/server";
import { SESSION_COOKIE, authConfigured, createSession, safeEqual, sessionMaxAge } from "@/lib/auth";

export async function POST(request: Request) {
  if (!authConfigured()) {
    return NextResponse.json({ error: "Innlogging er ikke satt opp (APP_PASSWORD og APP_SECRET mangler)." }, { status: 500 });
  }
  const { email, password } = (await request.json().catch(() => ({}))) as { email?: string; password?: string };
  // Both checks always run, so a wrong e-mail is not distinguishable from a wrong password.
  const wantEmail = process.env.APP_EMAIL?.trim().toLowerCase();
  const emailOk = !wantEmail || (typeof email === "string" && safeEqual(email.trim().toLowerCase(), wantEmail));
  const passwordOk = typeof password === "string" && safeEqual(password, process.env.APP_PASSWORD!);
  if (!emailOk || !passwordOk) {
    return NextResponse.json({ error: wantEmail ? "Feil e-post eller passord." : "Feil passord." }, { status: 401 });
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
