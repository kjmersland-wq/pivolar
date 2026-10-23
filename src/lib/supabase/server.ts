import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Supabase client for route handlers and server components. It reads and writes the session cookie. */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(items) {
        try {
          for (const { name, value, options } of items) cookieStore.set(name, value, options);
        } catch {
          /* called from a server component, where cookies are read-only; the proxy refreshes the session */
        }
      },
    },
  });
}
