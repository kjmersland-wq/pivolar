import type { FileMap } from "../files.ts";
import type { Finding } from "./quality.ts";

/**
 * Checks for Supabase edge functions (`/supabase/functions/<name>/…`), which imported projects bring along.
 * They are public addresses: a webhook that does not check the sender's signature accepts forged payments, and
 * a function that is open (`verify_jwt = false`) and never looks at who calls it can be used by anyone.
 * Like the other checks it only reads the code.
 */

const MAX = 300_000;
const functionNames = (files: FileMap) => [...new Set(Object.keys(files).flatMap((p) => /^\/supabase\/functions\/([^/_][^/]*)\//.exec(p)?.[1] ?? []))].sort();

/** What proves a payment or webhook call came from the service. */
const SIGNATURE = /constructEvent(?:Async)?\s*\(|webhooks\.unmarshal\s*\(|svix|timingSafeEqual|crypto\.subtle\.verify|createHmac\s*\(|HMAC|verifySignature|verify_signature/i;
/** What shows the function looks at who is calling. */
const IDENTITY = /auth\.getUser\s*\(|getClaims\s*\(|jwtVerify|authorization["']?\s*\)|\.get\(\s*["']authorization["']\s*\)|x-api-key|cron[_-]?secret|CRON_SECRET|SECRET\b[^;\n]{0,60}(?:===|!==|==|!=)|(?:===|!==|==|!=)[^;\n]{0,60}SECRET\b/i;

export function edgeSecurityFindings(files: FileMap): Finding[] {
  const out: Finding[] = [];
  const config = (files["/supabase/config.toml"] ?? "").slice(0, MAX);
  for (const name of functionNames(files)) {
    const prefix = `/supabase/functions/${name}/`;
    const entry = Object.keys(files).filter((p) => p.startsWith(prefix) && /\.(ts|js|mjs)$/.test(p)).sort();
    const code = entry.map((p) => (files[p] ?? "").slice(0, MAX)).join("\n");
    const path = entry.find((p) => /\/index\.(ts|js|mjs)$/.test(p)) ?? entry[0] ?? prefix;
    const verify = new RegExp(`\\[functions\\.${name.replace(/[-.]/g, "\\$&")}\\][^\\[]*?verify_jwt\\s*=\\s*(true|false)`, "i").exec(config)?.[1];
    const open = verify === "false";
    const signed = SIGNATURE.test(code);
    const paymentHook = /paddle-signature|stripe-signature|paddle|stripe/i.test(code) && /webhook|events?\b|event_type|eventType/i.test(name + code.slice(0, 4000));
    const identity = IDENTITY.test(code);

    if (paymentHook && !signed) {
      out.push({
        id: `edge-unsigned:${name}`,
        severity: "high",
        title: `Webhooken «${name}» sjekker ikke signaturen`,
        detail: "Adressen er offentlig. Uten signatursjekk kan hvem som helst sende falske betalinger og gi seg selv abonnement.",
        path,
        fix: `Sjekk signaturen til hver forespørsel i ${path} mot webhook-hemmeligheten (Stripe: constructEventAsync på rå tekst med stripe-signature, Paddle: paddle-signature), og svar 400 uten å gjøre noe hvis den ikke stemmer. Les kroppen som tekst før den tolkes.`,
      });
    } else if (open && !signed && !identity) {
      out.push({
        id: `edge-open:${name}`,
        severity: "high",
        title: `Funksjonen «${name}» er åpen for alle og sjekker ikke hvem som kaller`,
        detail: "I supabase/config.toml står verify_jwt = false, og koden leser verken innlogging eller en delt hemmelighet. Hvem som helst på nettet kan kjøre den, og bruker den service_role, omgår den også radnivå-sikkerheten.",
        path,
        fix: `Slå på verify_jwt for ${name} i supabase/config.toml, eller sjekk innloggingen (auth.getUser med Authorization-headeren) eller en delt hemmelighet i starten av ${path}, og avvis med 401 ellers.`,
      });
    }

    if (/SUPABASE_SERVICE_ROLE_KEY/.test(code) && !identity && !signed && verify !== "false") {
      out.push({
        id: `edge-service-role:${name}`,
        severity: "medium",
        title: `Funksjonen «${name}» bruker service_role uten å lese hvem som kaller`,
        detail: "service_role omgår alle databaseregler. Alle med en gyldig innlogging kan da få funksjonen til å lese eller skrive hva som helst den har tilgang til.",
        path,
        fix: `I ${path}: hent brukeren med auth.getUser fra Authorization-headeren, og filtrer alle spørringer på brukerens id. Bruk service_role bare til det som må omgå reglene.`,
      });
    }
  }
  return out;
}
