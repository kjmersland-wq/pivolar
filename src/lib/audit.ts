import type { SupabaseClient } from "@supabase/supabase-js";

/** The actions that may be recorded. The database function accepts the same list. */
export type AuditAction = "import_owner_confirmed" | "domain_purchase_attempt" | "domain_purchase";

/**
 * Records a sensitive action for the signed-in user (readable by them in their history). The
 * record is an extra: if the database function is missing or fails, the action itself is not
 * stopped, and the answer says whether it was written. Text values are cut short.
 */
export async function audit(db: Pick<SupabaseClient, "rpc">, action: AuditAction, detail: Record<string, string | number | boolean>): Promise<boolean> {
  const small = Object.fromEntries(Object.entries(detail).slice(0, 10).map(([key, value]) => [key.slice(0, 40), typeof value === "string" ? value.slice(0, 300) : value]));
  try {
    const { error } = await db.rpc("log_audit", { p_action: action, p_detail: small });
    return !error;
  } catch {
    return false;
  }
}
