import { createClient } from "@/lib/supabase/server";
import { quotaConfig, type RateRoute } from "./config";
import { DENIALS, type Denial } from "./decide";
import { checkRate } from "./gate";

// The pages that call these routes read { error } from the answer, so the message is sent that way.
const text = (denial: Denial) => Response.json({ error: denial.message }, { status: denial.status });

/** The id of the signed-in user, or null. */
export async function signedInUserId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/**
 * For routes that do not use the model but are still heavy (imports, runs, publishing): counts the
 * request against the signed-in user's allowance. Returns the answer to send when it must stop,
 * or null when the request may go on.
 *
 *   const stop = await limit("import");
 *   if (stop) return stop;
 */
export async function limit(route: RateRoute): Promise<Response | null> {
  const config = quotaConfig();
  if (route === "import" && config.importDisabled) return text(DENIALS.importDisabled);
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return text(DENIALS.signedOut);
  const result = await checkRate(supabase, route, config);
  return result.ok ? null : text(result);
}
