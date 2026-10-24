"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Check, Crown, ExternalLink, Globe, Link2, Loader2, Search, ShoppingCart, Sparkles, X } from "lucide-react";
import type { Ranked } from "@/lib/domains/rank";
import type { ConnectResult } from "@/lib/domains/connect";
import type { Registration } from "@/lib/domains/cloudflare";
import type { FileMap } from "@/lib/files";
import { loadPublish } from "@/lib/projects";
import { readBrand } from "@/lib/publish/brand";
import { slugify } from "@/lib/publish/project";
import { NOK_PER_USD } from "@/lib/usage/client";
import { cn } from "@/lib/utils";

type Host = "cloudflare" | "netlify" | "vercel";
const HOSTS: Record<Host, string> = { cloudflare: "Cloudflare Pages", netlify: "Netlify", vercel: "Vercel" };

const input = "w-full rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-[14px] text-fg outline-none transition focus:border-line-strong";
const usd = (value: number | undefined) => (value === undefined ? "?" : `$${value.toFixed(2)}`);
const nok = (value: number | undefined) => (value === undefined ? "" : ` (ca. ${Math.round(value * NOK_PER_USD)} kr)`);

async function post<T>(body: object): Promise<T> {
  const response = await fetch("/api/domains", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? (response.status === 429 ? "For mange forsøk. Vent litt." : "Noe gikk galt."));
  return data;
}

/**
 * Find a domain that fits the project, buy it and connect it to the site. The list is ranked, best first.
 * Buying asks for the domain to be typed out, shows the price and that it cannot be refunded, and
 * nothing is bought before that button is pressed. See lib/domains for the rules.
 */
export function DomainDialog({ open, onClose, projectId, projectName, files }: { open: boolean; onClose: () => void; projectId: string; projectName: string; files: FileMap }) {
  const brand = useMemo(() => readBrand(files, projectName), [files, projectName]);
  const [typed, setTyped] = useState("");
  const [extra, setExtra] = useState<string[]>([]);
  const [results, setResults] = useState<Ranked[] | null>(null);
  const [buying, setBuying] = useState<{ enabled: boolean; maxUsd: number } | null>(null);
  const [busy, setBusy] = useState<"search" | "ideas" | "buy" | "connect" | null>(null);
  const [error, setError] = useState("");
  const [choice, setChoice] = useState<Ranked | null>(null);
  const [confirm, setConfirm] = useState("");
  const [registration, setRegistration] = useState<(Registration & { domain: string; priceUsd?: number }) | null>(null);
  const [host, setHost] = useState<Host>("cloudflare");
  const [site, setSite] = useState("");
  const [elsewhere, setElsewhere] = useState(false);
  const [connected, setConnected] = useState<ConnectResult | null>(null);
  const [owned, setOwned] = useState("");
  const polling = useRef(0);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- the dialog starts fresh each time it opens */
    setResults(null);
    setChoice(null);
    setConfirm("");
    setRegistration(null);
    setConnected(null);
    setError("");
    setExtra([]);
    setTyped("");
    setOwned("");
    setSite(loadPublish(projectId)?.name ?? slugify(projectName));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, projectId, projectName]);

  useEffect(() => () => void (polling.current += 1), []);

  const context = { brand: brand.name, title: projectName, description: brand.description, norwegian: true, shop: /shop|butikk|store/i.test(`${projectName} ${brand.name}`), tech: Object.keys(files).some((p) => /dashboard|\/api\//i.test(p)) };

  async function search(names?: string[], labels = extra) {
    setError("");
    setBusy("search");
    setChoice(null);
    try {
      const data = await post<{ results: Ranked[]; buying: boolean; maxUsd: number }>({ action: "search", brand: context.brand, title: context.title, description: context.description, extra: labels, norwegian: true, shop: context.shop, tech: context.tech, ...(names ? { names } : {}) });
      setResults(data.results);
      setBuying({ enabled: data.buying, maxUsd: data.maxUsd });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Noe gikk galt.");
    }
    setBusy(null);
  }

  async function moreIdeas() {
    setError("");
    setBusy("ideas");
    try {
      const response = await fetch("/api/domains/ideas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brand: brand.name, description: `${brand.description || projectName}`.slice(0, 500), language: "nb" }) });
      const data = (await response.json().catch(() => ({}))) as { names?: string[]; error?: string };
      if (!response.ok || !data.names) throw new Error(data.error ?? "Fikk ikke noen ideer.");
      setExtra(data.names);
      await search(undefined, data.names);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Noe gikk galt.");
      setBusy(null);
    }
  }

  async function buy() {
    if (!choice || choice.price === undefined) return;
    setError("");
    setBusy("buy");
    try {
      const data = await post<{ registration: Registration; priceUsd: number }>({ action: "buy", domain: choice.name, seenPrice: choice.price, confirm });
      setRegistration({ ...data.registration, domain: choice.name, priceUsd: data.priceUsd });
      setOwned(choice.name);
      if (!data.registration.done && data.registration.state === "in_progress") void poll(choice.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Noe gikk galt.");
    }
    setBusy(null);
  }

  /** Asks how the purchase is going every few seconds, for up to two minutes. It never sends the purchase again. */
  async function poll(domain: string) {
    const token = ++polling.current;
    for (let i = 0; i < 40 && polling.current === token; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      if (polling.current !== token) return;
      try {
        const data = await post<{ registration: Registration }>({ action: "status", domain });
        setRegistration((current) => (current ? { ...current, ...data.registration } : current));
        if (data.registration.done || data.registration.state !== "in_progress") return;
      } catch {
        return;
      }
    }
  }

  async function connect() {
    const domain = (registration?.done ? registration.domain : owned || typed).trim().toLowerCase();
    setError("");
    setBusy("connect");
    try {
      const data = await post<{ connected: ConnectResult }>({ action: "connect", domain, host, site: slugify(site), ...(elsewhere ? { addZone: true } : {}) });
      setConnected(data.connected);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Noe gikk galt.");
    }
    setBusy(null);
  }

  const best = results?.find((r) => r.rank === 1);
  const bought = registration?.done === true;
  const canConnect = bought || owned.length > 0 || typed.includes(".");

  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-3 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && busy === null && onClose()}>
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }} role="dialog" aria-modal="true" aria-label="Domene" className="card flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl">
            <div className="flex items-start justify-between gap-3 border-b border-line px-6 py-4">
              <div>
                <h2 className="flex items-center gap-2 text-[18px] font-semibold tracking-tight">
                  <Globe className="size-[18px] text-accent" />
                  Domene
                </h2>
                <p className="mt-1 text-[13px] text-muted">Finn et domene som passer til «{brand.name || projectName}», kjøp det hos Cloudflare og koble det til siden.</p>
              </div>
              <button type="button" onClick={onClose} aria-label="Lukk" className="grid size-8 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-fg">
                <X className="size-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
              <div className="space-y-2">
                <p className="text-[13.5px] font-medium">1. Finn</p>
                <div className="flex gap-2">
                  <input value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === "Enter" && typed.trim() && void search([typed.trim()])} placeholder="Skriv et eget forslag, for eksempel kaffebar.no" aria-label="Eget domeneforslag" className={input} />
                  <button type="button" onClick={() => void search([typed.trim()])} disabled={busy !== null || !typed.includes(".")} className="shrink-0 rounded-xl border border-line px-3.5 text-[13px] transition enabled:hover:border-line-strong disabled:opacity-50">
                    Sjekk
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => void search()} disabled={busy !== null} className="bg-brand flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13.5px] font-medium text-white transition enabled:hover:brightness-110 disabled:opacity-60">
                    {busy === "search" ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                    Finn forslag til prosjektet
                  </button>
                  <button type="button" onClick={() => void moreIdeas()} disabled={busy !== null} className="flex items-center gap-2 rounded-xl border border-line px-3.5 py-2.5 text-[13px] transition enabled:hover:border-line-strong disabled:opacity-50">
                    {busy === "ideas" ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                    Flere ideer med AI
                  </button>
                </div>
              </div>

              {error && (
                <p className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-[12.5px] text-red-400">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  {error}
                </p>
              )}

              {results && (
                <ul className="space-y-2" aria-label="Forslag, best først">
                  {results.map((item) => (
                    <li key={item.name} className={cn("rounded-xl border p-3", item.rank === 1 ? "border-accent/50 bg-accent/5" : "border-line bg-surface-2", !item.registrable && "opacity-60")}>
                      <div className="flex items-center gap-3">
                        <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg text-[12px] font-semibold", item.rank === 1 ? "bg-accent text-white" : "bg-surface text-muted")}>{item.rank ?? "–"}</span>
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-2 text-[14px] font-medium">
                            {item.name}
                            {item.rank === 1 && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] text-accent">
                                <Crown className="size-3" />
                                Beste forslag
                              </span>
                            )}
                          </p>
                          {item.registrable ? (
                            <p className="text-[12px] text-muted">
                              {usd(item.price)} første år{nok(item.price)} · fornyes til {usd(item.renewal)} · poeng {item.score}
                            </p>
                          ) : (
                            <p className="text-[12px] text-muted">{item.reason}</p>
                          )}
                          {item.reasons.length > 0 && <p className="mt-0.5 text-[11.5px] text-faint">{item.reasons.join(" · ")}</p>}
                        </div>
                        {item.registrable && (
                          <button type="button" onClick={() => (setChoice(item), setConfirm(""), setRegistration(null), setError(""))} disabled={busy !== null || !buying?.enabled} title={buying?.enabled ? "Gå videre til kjøp" : "Kjøp er slått av"} className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12.5px] transition enabled:hover:border-line-strong disabled:opacity-40">
                            <ShoppingCart className="size-3.5" />
                            Velg
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {results && buying && !buying.enabled && (
                <p className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-[12.5px] text-muted">
                  Kjøp herfra er slått av. Sett <span className="font-mono text-fg">DOMAIN_BUY_ENABLED=true</span> i miljøvariablene (og eventuelt <span className="font-mono text-fg">DOMAIN_MAX_USD</span> som tak per domene) når du vil kunne kjøpe. Du kan fortsatt søke, kjøpe hos Cloudflare selv, og koble domenet under.
                </p>
              )}
              {best && !choice && buying?.enabled && <p className="text-[12px] text-faint">Prisene er fra Cloudflare nå, og sjekkes på nytt rett før et kjøp.</p>}

              {choice && !bought && (
                <div className="space-y-3 rounded-xl border border-line bg-surface-2 p-4">
                  <p className="text-[13.5px] font-medium">2. Kjøp {choice.name}</p>
                  <ul className="list-disc space-y-1 pl-5 text-[12.5px] text-muted">
                    <li>
                      Første år: <span className="text-fg">{usd(choice.price)}</span>
                      {nok(choice.price)}. Fornyelse: {usd(choice.renewal)} per år. Det fornyes ikke av seg selv.
                    </li>
                    <li>Betales med betalingsmetoden på Cloudflare-kontoen din. Kjøpet kan ikke refunderes.</li>
                    <li>Prisen sjekkes mot registeret rett før kjøpet. Har den endret seg, kjøpes ingenting.</li>
                    <li>Taket per domene er {buying?.maxUsd ?? 30} USD.</li>
                  </ul>
                  <label className="block text-[12.5px] text-muted">
                    Skriv <span className="font-mono text-fg">{choice.name}</span> for å bekrefte
                    <input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" spellCheck={false} className={cn(input, "mt-1")} />
                  </label>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setChoice(null)} disabled={busy === "buy"} className="rounded-xl border border-line px-3.5 py-2.5 text-[13px] disabled:opacity-50">
                      Avbryt
                    </button>
                    <button type="button" onClick={() => void buy()} disabled={busy !== null || confirm.trim().toLowerCase() !== choice.name} className="bg-brand ml-auto flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13.5px] font-medium text-white transition enabled:hover:brightness-110 disabled:opacity-50">
                      {busy === "buy" ? <Loader2 className="size-4 animate-spin" /> : <ShoppingCart className="size-4" />}
                      Kjøp for {usd(choice.price)}
                    </button>
                  </div>
                </div>
              )}

              {registration && (
                <p className={cn("flex items-start gap-2 rounded-xl border p-3 text-[12.5px]", bought ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-400" : registration.state === "in_progress" || registration.state === "unknown" ? "border-amber-500/30 bg-amber-500/5 text-amber-400" : "border-red-500/30 bg-red-500/5 text-red-400")}>
                  {bought ? <Check className="mt-0.5 size-4 shrink-0" /> : registration.state === "in_progress" ? <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" />}
                  <span>
                    {bought
                      ? `${registration.domain} er kjøpt${registration.priceUsd ? ` for ${usd(registration.priceUsd)}` : ""}.`
                      : registration.state === "in_progress"
                        ? `Cloudflare behandler kjøpet av ${registration.domain} …`
                        : registration.state === "action_required"
                          ? `Cloudflare trenger noe av deg for ${registration.domain}. Åpne Cloudflare og se Registrar.`
                          : (registration.message ?? `Kjøpet av ${registration.domain} ble ikke fullført (${registration.state}).`)}
                  </span>
                </p>
              )}

              <div className="space-y-3 border-t border-line pt-4">
                <p className="text-[13.5px] font-medium">{choice ? "3." : "2."} Koble til siden</p>
                <p className="text-[12.5px] text-muted">{bought ? `Koble ${registration?.domain} til siden din.` : "Har du allerede et domene i Cloudflare-kontoen din, eller et du har kjøpt et annet sted, kan du skrive det over og koble det her."}</p>
                {!bought && <input value={owned} onChange={(e) => setOwned(e.target.value)} placeholder="ditt-domene.no" aria-label="Domene som skal kobles" className={input} />}
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-[12.5px] text-muted">
                    Hvor ligger siden?
                    <select value={host} onChange={(e) => setHost(e.target.value as Host)} className={cn(input, "mt-1")}>
                      {(Object.keys(HOSTS) as Host[]).map((key) => (
                        <option key={key} value={key}>
                          {HOSTS[key]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-[12.5px] text-muted">
                    Navnet på siden hos verten
                    <input value={site} onChange={(e) => setSite(e.target.value)} className={cn(input, "mt-1 font-mono")} />
                  </label>
                </div>
                <label className="flex cursor-pointer items-start gap-2.5 text-[12.5px] text-muted">
                  <input type="checkbox" checked={elsewhere} onChange={(e) => setElsewhere(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
                  <span>Domenet er kjøpt et annet sted (for eksempel et .no-domene). Legg det til i Cloudflare, så skriver Pivolar oppføringene, og du bytter navnetjenere hos den som har domenet.</span>
                </label>
                <button type="button" onClick={() => void connect()} disabled={busy !== null || !canConnect || !slugify(site)} className="flex items-center gap-2 rounded-xl border border-line px-4 py-2.5 text-[13.5px] font-medium transition enabled:hover:border-line-strong disabled:opacity-50">
                  {busy === "connect" ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
                  Koble til
                </button>
              </div>

              {connected && (
                <div className="space-y-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-[12.5px]">
                  <p className="flex items-center gap-2 font-medium text-emerald-400">
                    <Check className="size-4" />
                    {connected.domain} er koblet til {HOSTS[connected.host]}
                  </p>
                  <ul className="list-disc space-y-1 pl-5 text-muted">
                    {connected.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ul>
                  {connected.nameservers && connected.nameservers.length > 0 && (
                    <p className="font-mono text-fg">{connected.nameservers.join("  ")}</p>
                  )}
                  <table className="w-full text-left text-[12px] text-muted">
                    <tbody>
                      {connected.records.map((r) => (
                        <tr key={`${r.type}-${r.name}`}>
                          <td className="py-0.5 pr-3 font-mono text-fg">{r.type}</td>
                          <td className="py-0.5 pr-3 font-mono">{r.name}</td>
                          <td className="py-0.5 font-mono">{r.content}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <a href={`https://${connected.domain}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                    Åpne {connected.domain}
                    <ExternalLink className="size-3" />
                  </a>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
