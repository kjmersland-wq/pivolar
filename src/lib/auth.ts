/** Supabase Auth holds the session; this file only says who may use the app and whether it is set up. */

export function authConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && ownerEmails().length > 0,
  );
}

/**
 * Pivolar is still a private tool. Even if sign-ups were open in Supabase, only these addresses get in.
 * `APP_EMAIL` takes a comma-separated list.
 */
export function ownerEmails(): string[] {
  return (process.env.APP_EMAIL ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export function isOwner(email: string | undefined | null) {
  return Boolean(email) && ownerEmails().includes(email!.trim().toLowerCase());
}
