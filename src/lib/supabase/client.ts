import { createBrowserClient } from "@supabase/ssr";

/** Supabase client for the browser. It uses the signed-in user's own session, so storage rules apply as for that user. */
export const createBrowser = () => createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
