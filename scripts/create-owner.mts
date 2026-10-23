// Creates (or updates the password of) the owner account in Supabase Auth.
// Run: node --env-file=.env.local scripts/create-owner.mts
// Uses APP_EMAIL (first address) and APP_PASSWORD. Neither is printed.
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.APP_EMAIL?.split(",")[0]?.trim().toLowerCase();
const password = process.env.APP_PASSWORD;
if (!url || !key || !email || !password) {
  console.error("Mangler NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, APP_EMAIL eller APP_PASSWORD.");
  process.exit(1);
}

const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
const { data: list, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 });
if (listError) throw listError;
const existing = list.users.find((user) => user.email?.toLowerCase() === email);

if (existing) {
  const { error } = await admin.auth.admin.updateUserById(existing.id, { password, email_confirm: true });
  if (error) throw error;
  console.log("Eier oppdatert (passord satt på nytt).");
} else {
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  console.log("Eier opprettet.");
}
