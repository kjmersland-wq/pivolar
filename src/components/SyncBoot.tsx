"use client";

import { useEffect } from "react";
import { startSync } from "@/lib/sync";

/**
 * Keeps projects mirrored to the account while the app is open. Does nothing on the login page.
 * The path is read in the effect rather than with usePathname(), which would block prerendering of every route.
 */
export function SyncBoot() {
  useEffect(() => (window.location.pathname.startsWith("/login") ? undefined : startSync()), []);
  return null;
}
