import Link from "next/link";
import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <span className={cn("bg-brand relative grid size-8 place-items-center rounded-[10px] shadow-[0_6px_20px_-6px_var(--accent)]", className)}>
      <svg viewBox="0 0 24 24" className="size-[18px] text-white" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3 5 20" />
        <path d="m12 3 7 17" />
        <path d="M8 14h8" />
      </svg>
    </span>
  );
}

export function Logo({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={cn("flex items-center gap-2.5", className)} aria-label="Atelier">
      <LogoMark />
      <span className="text-[15px] font-semibold tracking-tight">Atelier</span>
    </Link>
  );
}
