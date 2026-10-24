import { createHash } from "node:crypto";

/**
 * Two rules for the throwaway VMs that run imported projects: a VM belongs to one user, and it can
 * only live for so long. Without them a name could be guessed to stop someone else's run, and a
 * run could be kept alive for ever by sending files to it.
 */

/** The VM's name carries a short fingerprint of the user, so only the user's own session can reach it. */
export function sandboxName(userId: string, projectId: string): string {
  const owner = createHash("sha256").update(`pivolar-runner|${userId}`).digest("hex").slice(0, 10);
  return `pv-${owner}-${projectId}`;
}

export type Extension = { action: "stop" } | { action: "extend"; ms: number } | { action: "keep" };

/**
 * What to do with a VM when files are sent to it. It is kept alive for `wantMs` from now, but never
 * past `maxMs` from when it was created, and it is not extended over and over by small amounts.
 */
export function extensionFor(options: { now: number; createdAt: number; expiresAt: number | null; maxMs: number; wantMs: number }): Extension {
  const { now, createdAt, expiresAt, maxMs, wantMs } = options;
  if (now - createdAt >= maxMs) return { action: "stop" };
  const target = Math.min(now + wantMs, createdAt + maxMs);
  const current = expiresAt ?? now;
  if (target <= current + 30_000) return { action: "keep" };
  return { action: "extend", ms: Math.round(target - current) };
}

/** A VM that has lived past the limit is not reused when the preview is opened again. */
export const isPastLimit = (createdAt: number, now: number, maxMs: number) => now - createdAt >= maxMs;
