/**
 * Server functions for the published site that use the owner's Google account. They are written
 * here, not by the model, so they can be tested. Each one carries its own small token helper: it
 * trades the refresh token for a short-lived access token, so nothing long-lived is ever sent to Google's APIs.
 */

const TOKEN_HELPER = (service: string) => `async function accessToken(): Promise<string> {
  const refresh = process.env.GOOGLE_REFRESH_TOKEN_${service.toUpperCase()};
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!refresh || !id || !secret) throw new Error("not-configured");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refresh, grant_type: "refresh_token" }),
  });
  const data = (await response.json().catch(() => ({}))) as { access_token?: string };
  if (!response.ok || !data.access_token) throw new Error("denied");
  return data.access_token;
}
`;

/** The same checks for both: type, length, address and the hidden field for bots. Returns the clean values or a reply. */
const FORM_HELPER = `const EMAIL = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/;

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function readForm(request: Request): Promise<{ name: string; email: string; message: string } | Response> {
  const body = (await request.json().catch(() => null)) as { name?: unknown; email?: unknown; message?: unknown; website?: unknown } | null;
  // The hidden "website" field is for bots: people never see it, so they never fill it in.
  if (body?.website) return reply(200, { ok: true });
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!name || name.length > 100) return reply(400, { error: "Skriv inn navnet ditt." });
  if (!EMAIL.test(email) || email.length > 200) return reply(400, { error: "Skriv inn en gyldig e-postadresse." });
  if (!message || message.length > 3000) return reply(400, { error: "Skriv en melding på under 3000 tegn." });
  return { name, email, message };
}
`;

/** A contact form that e-mails the connected Gmail account. Only the gmail.send permission is used. */
export const CONTACT_FUNCTION = `${FORM_HELPER}
${TOKEN_HELPER("gmail")}
// Line breaks in a header would let a visitor add headers of their own, so they are removed.
const oneLine = (text: string) => text.replace(/[\\r\\n]+/g, " ").trim();
const encodeWord = (text: string) => "=?UTF-8?B?" + Buffer.from(oneLine(text), "utf8").toString("base64") + "?=";

export async function POST(request: Request): Promise<Response> {
  const form = await readForm(request);
  if (form instanceof Response) return form;
  const to = process.env.GOOGLE_ACCOUNT_EMAIL;
  if (!to) return reply(500, { error: "Kontaktskjemaet er ikke satt opp ennå." });
  try {
    const raw = [
      "To: " + oneLine(to),
      "Reply-To: " + oneLine(form.email),
      "Subject: " + encodeWord("Ny melding fra " + form.name),
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(form.name + " (" + form.email + ")\\n\\n" + form.message, "utf8").toString("base64"),
    ].join("\\r\\n");
    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: "Bearer " + (await accessToken()), "Content-Type": "application/json" },
      body: JSON.stringify({ raw: Buffer.from(raw, "utf8").toString("base64url") }),
    });
    if (!response.ok) return reply(502, { error: "Kunne ikke sende meldingen akkurat nå. Prøv igjen senere." });
    return reply(200, { ok: true });
  } catch {
    return reply(502, { error: "Kunne ikke sende meldingen akkurat nå. Prøv igjen senere." });
  }
}
`;

/** A form that adds a row to a Google Sheet. Only the spreadsheets permission is used. */
export const SHEET_FUNCTION = `${FORM_HELPER}
${TOKEN_HELPER("sheets")}
// A cell that starts with = + - or @ would be run as a formula by the sheet, so it is stored as text.
const cell = (text: string) => (/^[=+\\-@]/.test(text) ? "'" + text : text);

export async function POST(request: Request): Promise<Response> {
  const form = await readForm(request);
  if (form instanceof Response) return form;
  const sheet = process.env.GOOGLE_SHEET_ID;
  if (!sheet || !/^[\\w-]{20,}$/.test(sheet)) return reply(500, { error: "Skjemaet er ikke satt opp ennå." });
  try {
    const url = "https://sheets.googleapis.com/v4/spreadsheets/" + sheet + "/values/A:D:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS";
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: "Bearer " + (await accessToken()), "Content-Type": "application/json" },
      body: JSON.stringify({ values: [[new Date().toISOString(), cell(form.name), cell(form.email), cell(form.message)]] }),
    });
    if (!response.ok) return reply(502, { error: "Kunne ikke lagre akkurat nå. Prøv igjen senere." });
    return reply(200, { ok: true });
  } catch {
    return reply(502, { error: "Kunne ikke lagre akkurat nå. Prøv igjen senere." });
  }
}
`;
