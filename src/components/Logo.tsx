import Link from "next/link";
import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  // A "P" whose bowl swings around a pivot point: stem, bowl, and a small dot on an orbit arc.
  return (
    <span className={cn("bg-brand relative grid size-8 place-items-center rounded-[10px] shadow-[0_6px_20px_-6px_var(--accent)] ring-1 ring-inset ring-white/20", className)}>
      <svg viewBox="0 0 24 24" className="size-[19px] text-white" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M8.5 19.5v-15h4.6a4.1 4.1 0 0 1 0 8.2H8.5" />
        <path d="M12.8 19.3a6.4 6.4 0 0 0 6.4-6.2" strokeWidth="1.6" opacity="0.55" />
        <circle cx="18.6" cy="17.6" r="1.7" fill="currentColor" stroke="none" />
      </svg>
    </span>
  );
}

export function Logo({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={cn("flex items-center gap-2.5", className)} aria-label="Pivolar">
      <LogoMark />
      <span className="text-[14px] font-semibold tracking-[0.2em]">PIVOLAR</span>
    </Link>
  );
}
