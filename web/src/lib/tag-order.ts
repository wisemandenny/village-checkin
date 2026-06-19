// Canonical display order for roles and instruments. Wherever these values are
// listed (admin table, recovery flow, onboarding buttons), they appear in this
// order. Values not in the canonical list are appended afterwards, sorted
// alphabetically, so display stays stable regardless of storage order.

// Canonical roles a villager can pick during onboarding. "Just Vibing" is
// mutually exclusive with the active-participation roles (see the onboarding
// form): picking it clears the others, and picking any other role clears it.
export enum Role {
  Producer = "Producer",
  Vocalist = "Vocalist",
  Musician = "Musician",
  JustVibing = "Just Vibing",
}

export const ROLE_ORDER = [Role.Producer, Role.Vocalist, Role.Musician, Role.JustVibing] as const;

export const INSTRUMENT_ORDER = [
  "Keys",
  "Guitar",
  "Bass",
  "Percussion",
  "Saxophone",
  "Violin",
  "Other",
] as const;

function sortByCanonicalOrder(
  values: string[],
  order: readonly string[]
): string[] {
  const rank = new Map(order.map((value, index) => [value.toLowerCase(), index]));
  return [...values].sort((a, b) => {
    const ra = rank.get(a.toLowerCase());
    const rb = rank.get(b.toLowerCase());
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return a.localeCompare(b);
  });
}

export function sortRoles(roles: string[]): string[] {
  return sortByCanonicalOrder(roles, ROLE_ORDER);
}

export function sortInstruments(instruments: string[]): string[] {
  return sortByCanonicalOrder(instruments, INSTRUMENT_ORDER);
}
