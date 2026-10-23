"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

export function LoginForm({ configured, emailRequired }: { configured: boolean; emailRequired: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (response.ok) {
      router.replace("/");
      router.refresh();
      return;
    }
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    setError(body.error ?? "Noe gikk galt.");
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="mt-7 space-y-3">
      {!configured && (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-[13px] text-amber-400">
          Innloggingen er ikke satt opp. Legg inn <code className="font-mono">NEXT_PUBLIC_SUPABASE_URL</code>, <code className="font-mono">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> og <code className="font-mono">APP_EMAIL</code> i miljøvariablene.
        </p>
      )}
      {emailRequired && (
        <input
          type="email"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="E-post"
          autoComplete="username"
          className="w-full rounded-xl border border-line bg-surface-2 px-3.5 py-3 text-[15px] outline-none transition placeholder:text-faint focus:border-line-strong"
        />
      )}
      <input
        type="password"
        autoFocus={!emailRequired}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Passord"
        autoComplete="current-password"
        className="w-full rounded-xl border border-line bg-surface-2 px-3.5 py-3 text-[15px] outline-none transition placeholder:text-faint focus:border-line-strong"
      />
      {error && <p className="text-[13px] text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={busy || !password || (emailRequired && !email)}
        className="bg-brand flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[15px] font-medium text-white shadow-[0_8px_24px_-10px_var(--accent)] transition enabled:hover:brightness-110 disabled:opacity-50"
      >
        {busy && <Loader2 className="size-4 animate-spin" />}
        Logg inn
      </button>
    </form>
  );
}
