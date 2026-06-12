// Maintenance-mode lookup used by the proxy (and anywhere else that needs to
// know whether the site is locked down).
//
// The flag lives in `studio_settings.maintenance_mode` and is readable with the
// anon key (RLS allows anon SELECT on settings), so we hit Supabase's REST API
// directly instead of pulling the service-role client into the proxy bundle.
//
// Reads are cached in-process for a few seconds to avoid a DB round-trip on
// every request. The cache is a best-effort optimization only: on any failure
// we fail OPEN (treat the site as available) so a transient Supabase blip can
// never accidentally lock everyone out. The MAINTENANCE_MODE env var is a hard
// override that always wins and requires no DB access.

const CACHE_TTL_MS = 10_000;

let cache: { value: boolean; at: number } | null = null;

function envOverride(): boolean | null {
  const flag = process.env.MAINTENANCE_MODE?.toLowerCase();
  if (flag === "true" || flag === "1" || flag === "on") return true;
  if (flag === "false" || flag === "0" || flag === "off") return false;
  return null;
}

export async function isMaintenanceMode(): Promise<boolean> {
  const override = envOverride();
  if (override !== null) return override;

  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.value;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return cache?.value ?? false;

  try {
    const res = await fetch(
      `${url}/rest/v1/studio_settings?key=eq.maintenance_mode&select=value`,
      {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        cache: "no-store",
      }
    );
    if (!res.ok) return cache?.value ?? false;

    const rows = (await res.json()) as { value: unknown }[];
    const value = rows[0]?.value === true;
    cache = { value, at: Date.now() };
    return value;
  } catch {
    // Network/parse error: keep the site available.
    return cache?.value ?? false;
  }
}
