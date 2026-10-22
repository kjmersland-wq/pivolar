import { jwtVerify, SignJWT } from "jose";

export const SESSION_COOKIE = "atelier_session";
const THIRTY_DAYS = 60 * 60 * 24 * 30;

function secret() {
  const value = process.env.APP_SECRET;
  if (!value || value.length < 16) throw new Error("APP_SECRET must be set (at least 16 characters)");
  return new TextEncoder().encode(value);
}

export function authConfigured() {
  return Boolean(process.env.APP_PASSWORD && process.env.APP_SECRET && process.env.APP_SECRET.length >= 16);
}

export async function createSession() {
  return new SignJWT({ sub: "owner" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${THIRTY_DAYS}s`)
    .sign(secret());
}

export async function verifySession(token: string | undefined) {
  if (!token) return false;
  try {
    await jwtVerify(token, secret());
    return true;
  } catch {
    return false;
  }
}

export const sessionMaxAge = THIRTY_DAYS;

/** Constant-time comparison so the password check does not leak its length or content. */
export function safeEqual(a: string, b: string) {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
