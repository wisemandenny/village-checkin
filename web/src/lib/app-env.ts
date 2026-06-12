// Logical deployment environment ("local" | "staging" | "production" | ...).
//
// Local dev and production currently share the same Supabase project, so any
// per-environment state stored in studio_settings must be namespaced by this
// value to avoid leaking across environments. Prod safely defaults to
// "production" when APP_ENV is unset; local and staging set it explicitly.
export function appEnv(): string {
  return process.env.APP_ENV?.trim().toLowerCase() || "production";
}

// studio_settings key that holds the maintenance flag for THIS environment.
export function maintenanceKey(): string {
  return `maintenance_mode:${appEnv()}`;
}
