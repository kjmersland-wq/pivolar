"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { startSync } from "@/lib/sync";

/** Keeps projects mirrored to the account while the app is open. Does nothing on the login page. */
export function SyncBoot() {
  const pathname = usePathname();
  const onLogin = pathname.startsWith("/login");
  useEffect(() => (onLogin ? undefined : startSync()), [onLogin]);
  return null;
}
