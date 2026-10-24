/**
 * OAuth for Google: the sign-in step that lets a published site use the owner's Gmail, Sheets,
 * Drive or Calendar. The long-lived refresh token is encrypted before it is stored and never
 * sent to the browser; the publish step reads it on the server and hands it to the site as an
 * environment variable.
 */

export type GoogleService = "gmail" | "sheets" | "drive" | "calendar";

/** The narrowest scope that does the job. */
export const GOOGLE_SCOPES: Record<GoogleService, string> = {
  gmail: "https://www.googleapis.com/auth/gmail.send",
  sheets: "https://www.googleapis.com/auth/spreadsheets",
  drive: "https://www.googleapis.com/auth/drive.file",
  calendar: "https://www.googleapis.com/auth/calendar.events",
};

export const isGoogleService = (value: unknown): value is GoogleService => typeof value === "string" && value in GOOGLE_SCOPES;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

const encoder = new TextEncoder();
const b64 = (bytes: ArrayBuffer | Uint8Array) => Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString("base64url");
const unb64 = (text: string) => new Uint8Array(Buffer.from(text, "base64url"));

async function hmacKey(secret: string) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export type State = { project: string; service: GoogleService; user: string; exp: number; nonce: string };

/** The value Google sends back unchanged. It is signed, so a forged or altered one is refused, and it expires after ten minutes. */
export async function signState(payload: Omit<State, "exp" | "nonce">, secret: string, now = Date.now()): Promise<string> {
  const body: State = { ...payload, exp: now + 10 * 60_000, nonce: b64(crypto.getRandomValues(new Uint8Array(12))) };
  const data = b64(encoder.encode(JSON.stringify(body)));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(data));
  return `${data}.${b64(signature)}`;
}

export async function verifyState(value: string, secret: string, now = Date.now()): Promise<State | null> {
  const [data, signature] = value.split(".");
  if (!data || !signature) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), unb64(signature), encoder.encode(data));
    if (!ok) return null;
    const state = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as State;
    if (typeof state.exp !== "number" || state.exp < now || !isUuid(state.project) || !isGoogleService(state.service) || typeof state.user !== "string") return null;
    return state;
  } catch {
    return null;
  }
}

async function aesKey(secret: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`pivolar-oauth|${secret}`));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** AES-GCM with a fresh random value for every encryption. The result is `v1.<iv>.<ciphertext>`. */
export async function encryptToken(plain: string, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(secret), encoder.encode(plain));
  return `v1.${b64(iv)}.${b64(cipher)}`;
}

export async function decryptToken(value: string, secret: string): Promise<string | null> {
  const [version, iv, cipher] = value.split(".");
  if (version !== "v1" || !iv || !cipher) return null;
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await aesKey(secret), unb64(cipher));
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

export function authorizeUrl(options: { clientId: string; redirectUri: string; service: GoogleService; state: string }): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", options.clientId);
  url.searchParams.set("redirect_uri", options.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", `openid email ${GOOGLE_SCOPES[options.service]}`);
  // offline + consent is what makes Google hand out a refresh token
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "false");
  url.searchParams.set("state", options.state);
  return url.toString();
}

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** Trades the one-time code for tokens. Only the refresh token and the account's address are kept. */
export async function exchangeCode(options: { code: string; clientId: string; clientSecret: string; redirectUri: string }, fetcher: Fetcher = fetch): Promise<{ refreshToken: string; email: string | null }> {
  const response = await fetcher("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code: options.code, client_id: options.clientId, client_secret: options.clientSecret, redirect_uri: options.redirectUri, grant_type: "authorization_code" }),
  });
  const data = (await response.json().catch(() => ({}))) as { refresh_token?: string; id_token?: string; error?: string };
  if (!response.ok || !data.refresh_token) throw new Error(data.error === "invalid_grant" ? "Koden var brukt eller utløpt. Prøv å koble til på nytt." : "Google ga ikke tilgang. Prøv igjen, og velg «Tillat».");
  return { refreshToken: data.refresh_token, email: emailFromIdToken(data.id_token) };
}

/** The e-mail address in the id token. Read, not verified: it is only shown to the owner so they can see which account is connected. */
export function emailFromIdToken(token: string | undefined): string | null {
  try {
    const payload = JSON.parse(Buffer.from(token?.split(".")[1] ?? "", "base64url").toString("utf8")) as { email?: unknown };
    return typeof payload.email === "string" && payload.email.length < 200 ? payload.email : null;
  } catch {
    return null;
  }
}
