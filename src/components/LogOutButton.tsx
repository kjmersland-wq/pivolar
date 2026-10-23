"use client";

import { LogOut } from "lucide-react";

export function LogOutButton() {
  return (
    <button
      type="button"
      onClick={async () => {
        await fetch("/api/login", { method: "DELETE" });
        window.location.assign("/login");
      }}
      className="grid size-9 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-fg"
      aria-label="Logg ut"
      title="Logg ut"
    >
      <LogOut className="size-[18px]" />
    </button>
  );
}
