// Finds credentials in text and files so they are never exported. The patterns are for well-known
// token formats plus a cautious generic rule; they reduce risk and do not prove a project is clean.

const PATTERNS: { name: string; re: RegExp }[] = [
  { name: "privat nøkkel", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY(?: BLOCK)?-----|$)/g },
  { name: "Stripe-nøkkel", re: /\b(?:sk|rk)_(?:live|test)_[0-9a-zA-Z]{16,}\b/g },
  { name: "Stripe-webhook", re: /\bwhsec_[0-9a-zA-Z]{16,}\b/g },
  { name: "Anthropic-nøkkel", re: /\bsk-ant-[\w-]{20,}\b/g },
  { name: "OpenAI-nøkkel", re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/g },
  { name: "GitHub-token", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/g },
  { name: "AWS-nøkkel", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "Slack-token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: "Google API-nøkkel", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: "Paddle-nøkkel", re: /\bpdl_(?:live|sdbx)_(?:apikey|ntfset)_[0-9a-z]{20,}\w*\b/g },
  { name: "JWT med hemmelig innhold", re: /\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{20,}\b/g },
];

// NAME = "value" where NAME suggests a secret. Placeholders are ignored.
const GENERIC = /\b([A-Za-z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY)[A-Za-z0-9_]*)\s*[:=]\s*(["'])([^"'\n]{12,})\2/gi;
const PLACEHOLDER = /your|xxx|example|changeme|change-me|placeholder|<|>|\$\{|process\.env|import\.meta|\*{3,}|todo|dummy|sample/i;

export type SecretHit = { kind: string; line: number };

export const REDACTED = "REDACTED_BY_PIVOLAR";

const lineOf = (text: string, index: number) => text.slice(0, index).split("\n").length;

export function scanSecrets(text: string): SecretHit[] {
  const hits: SecretHit[] = [];
  for (const { name, re } of PATTERNS) {
    for (const m of text.matchAll(re)) hits.push({ kind: name, line: lineOf(text, m.index!) });
  }
  for (const m of text.matchAll(GENERIC)) {
    if (!PLACEHOLDER.test(m[3]!)) hits.push({ kind: `verdi for ${m[1]}`, line: lineOf(text, m.index!) });
  }
  return hits;
}

export function redactSecrets(text: string): { text: string; count: number } {
  let count = 0;
  let out = text;
  for (const { re } of PATTERNS) {
    out = out.replace(re, () => (count++, REDACTED));
  }
  out = out.replace(GENERIC, (whole, name: string, quote: string, value: string) => {
    if (PLACEHOLDER.test(value)) return whole;
    count++;
    return `${name}=${quote}${REDACTED}${quote}`;
  });
  return { text: out, count };
}

/** `.env` and `.env.production` hold real values; `.env.example` and friends are templates. */
export function isSecretFile(path: string) {
  const name = path.split("/").pop()!.toLowerCase();
  if (/^\.env(\.|$)/.test(name)) return !/\.(example|sample|template|dist)$/.test(name);
  return /^(id_rsa|id_ed25519|.*\.pem|.*\.p12|.*\.pfx|.*\.keystore|\.npmrc|\.netrc|credentials\.json|service-account.*\.json)$/.test(name);
}
