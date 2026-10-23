"use client";

import { useEffect, useState } from "react";
import type { Summary } from "@/lib/usage/summary";

export type UsageState = { summary: Summary | null; error: string | null; loading: boolean };

const EVENT = "pivolar:usage-changed";
const FRESH_MS = 20_000;
/** Approximate exchange rate for the "ca. kr" figures. The meter works in dollars, because that is what the providers bill. */
export const NOK_PER_USD = 10.5;

let cache: { at: number; summary: Summary } | null = null;
let pending: Promise<Summary | null> | null = null;
let lastError: string | null = null;

/** Latest usage. Cached for a few seconds so several components and every send share one request. */
export async function fetchUsage(force = false): Promise<Summary | null> {
  if (!force && cache && Date.now() - cache.at < FRESH_MS) return cache.summary;
  if (pending) return pending;
  pending = (async () => {
    try {
      const response = await fetch("/api/usage", { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as Summary & { error?: string };
      if (!response.ok) {
        lastError = body.error ?? "Kunne ikke hente forbruket.";
        return null;
      }
      lastError = null;
      cache = { at: Date.now(), summary: body };
      return body;
    } catch {
      lastError = "Kunne ikke hente forbruket.";
      return null;
    } finally {
      pending = null;
    }
  })();
  return pending;
}

/** Call after something that costs money, or after the budget was changed. */
export function invalidateUsage(delayMs = 0) {
  cache = null;
  window.setTimeout(() => window.dispatchEvent(new Event(EVENT)), delayMs);
}

export function useUsage(): UsageState & { refresh: () => void } {
  const [state, setState] = useState<UsageState>({ summary: cache?.summary ?? null, error: null, loading: !cache });
  useEffect(() => {
    let alive = true;
    const load = async (force: boolean) => {
      const summary = await fetchUsage(force);
      if (alive) setState({ summary, error: summary ? null : lastError, loading: false });
    };
    void load(false);
    const onChange = () => void load(true);
    window.addEventListener(EVENT, onChange);
    const timer = window.setInterval(() => void load(true), 60_000);
    return () => {
      alive = false;
      window.removeEventListener(EVENT, onChange);
      window.clearInterval(timer);
    };
  }, []);
  return { ...state, refresh: () => invalidateUsage() };
}

export const money = (usd: number) => `$${Math.abs(usd) >= 100 ? usd.toFixed(0) : usd.toFixed(2)}`;
export const kroner = (usd: number) => `ca. ${Math.round(usd * NOK_PER_USD).toLocaleString("nb-NO")} kr`;
