"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

export function LogOutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        await fetch("/api/login", { method: "DELETE" });
        router.replace("/login");
        router.refresh();
      }}
      className="grid size-9 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-fg"
      aria-label="Logg ut"
      title="Logg ut"
    >
      <LogOut className="size-[18px]" />
    </button>
  );
}
