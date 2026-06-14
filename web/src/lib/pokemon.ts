// Curated avatar pool for Pokemon Infinite Fusion sprites.
//
// IMPORTANT: ids are Infinite Fusion Pokedex IDs, which equal the National Dex
// only for Gen 1-2 (1-251). Gen 3+ diverge (e.g. Blaziken = 281, Lucario = 296,
// Rayquaza = 342), so these are hardcoded to the correct IF IDs. Sprite
// filenames on the CDN use the same IF IDs.
//
// `prefix`/`suffix` are the name fragments used to build a fused name the way
// Infinite Fusion does: head's prefix + body's suffix (e.g. Psyduck + Machamp =
// "Psy" + "champ" = "Psychamp"). They're cached here so naming works fully
// offline with no per-fusion network lookup.

export interface PoolPokemon {
  id: number;
  name: string;
  // Used when this Pokemon is the head (start of the fused name).
  prefix: string;
  // Used when this Pokemon is the body (end of the fused name).
  suffix: string;
}

export const POOL: PoolPokemon[] = [
  // Gen 1
  { id: 1, name: "Bulbasaur", prefix: "Bulba", suffix: "saur" },
  { id: 3, name: "Venusaur", prefix: "Venu", suffix: "saur" },
  { id: 4, name: "Charmander", prefix: "Char", suffix: "mander" },
  { id: 6, name: "Charizard", prefix: "Chari", suffix: "zard" },
  { id: 7, name: "Squirtle", prefix: "Squir", suffix: "tle" },
  { id: 9, name: "Blastoise", prefix: "Blast", suffix: "toise" },
  { id: 25, name: "Pikachu", prefix: "Pika", suffix: "chu" },
  { id: 26, name: "Raichu", prefix: "Rai", suffix: "chu" },
  { id: 38, name: "Ninetales", prefix: "Nine", suffix: "tales" },
  { id: 39, name: "Jigglypuff", prefix: "Jiggly", suffix: "puff" },
  { id: 52, name: "Meowth", prefix: "Meow", suffix: "owth" },
  { id: 54, name: "Psyduck", prefix: "Psy", suffix: "duck" },
  { id: 59, name: "Arcanine", prefix: "Arca", suffix: "canine" },
  { id: 65, name: "Alakazam", prefix: "Ala", suffix: "kazam" },
  { id: 68, name: "Machamp", prefix: "Ma", suffix: "champ" },
  { id: 94, name: "Gengar", prefix: "Gen", suffix: "gar" },
  { id: 95, name: "Onix", prefix: "On", suffix: "nix" },
  { id: 112, name: "Rhydon", prefix: "Rhy", suffix: "don" },
  { id: 115, name: "Kangaskhan", prefix: "Kanga", suffix: "khan" },
  { id: 122, name: "Mr. Mime", prefix: "Mime", suffix: "mime" },
  { id: 130, name: "Gyarados", prefix: "Gyara", suffix: "rados" },
  { id: 131, name: "Lapras", prefix: "Lap", suffix: "pras" },
  { id: 132, name: "Ditto", prefix: "Dit", suffix: "tto" },
  { id: 133, name: "Eevee", prefix: "Eev", suffix: "vee" },
  { id: 134, name: "Vaporeon", prefix: "Vapor", suffix: "eon" },
  { id: 135, name: "Jolteon", prefix: "Jolt", suffix: "eon" },
  { id: 136, name: "Flareon", prefix: "Flare", suffix: "eon" },
  { id: 137, name: "Porygon", prefix: "Pory", suffix: "gon" },
  { id: 142, name: "Aerodactyl", prefix: "Aero", suffix: "dactyl" },
  { id: 143, name: "Snorlax", prefix: "Snor", suffix: "lax" },
  { id: 144, name: "Articuno", prefix: "Arti", suffix: "cuno" },
  { id: 145, name: "Zapdos", prefix: "Zap", suffix: "dos" },
  { id: 146, name: "Moltres", prefix: "Mol", suffix: "tres" },
  { id: 149, name: "Dragonite", prefix: "Drago", suffix: "nite" },
  { id: 150, name: "Mewtwo", prefix: "Mew", suffix: "two" },
  { id: 151, name: "Mew", prefix: "Mew", suffix: "mew" },
  // Gen 2 (IF IDs match National Dex)
  { id: 154, name: "Meganium", prefix: "Mega", suffix: "nium" },
  { id: 157, name: "Typhlosion", prefix: "Typhlo", suffix: "sion" },
  { id: 160, name: "Feraligatr", prefix: "Fera", suffix: "gatr" },
  { id: 169, name: "Crobat", prefix: "Cro", suffix: "bat" },
  { id: 196, name: "Espeon", prefix: "Esp", suffix: "eon" },
  { id: 197, name: "Umbreon", prefix: "Umbre", suffix: "eon" },
  { id: 212, name: "Scizor", prefix: "Sci", suffix: "zor" },
  { id: 214, name: "Heracross", prefix: "Hera", suffix: "cross" },
  { id: 248, name: "Tyranitar", prefix: "Tyra", suffix: "nitar" },
  { id: 249, name: "Lugia", prefix: "Lu", suffix: "gia" },
  { id: 250, name: "Ho-Oh", prefix: "Ho", suffix: "oh" },
  { id: 251, name: "Celebi", prefix: "Cele", suffix: "bi" },
  // Gen 3 (Infinite Fusion IDs)
  { id: 278, name: "Sceptile", prefix: "Scep", suffix: "tile" },
  { id: 281, name: "Blaziken", prefix: "Blazi", suffix: "ken" },
  { id: 284, name: "Swampert", prefix: "Swam", suffix: "pert" },
  { id: 287, name: "Gardevoir", prefix: "Garde", suffix: "voir" },
  { id: 293, name: "Metagross", prefix: "Meta", suffix: "gross" },
  { id: 310, name: "Absol", prefix: "Ab", suffix: "sol" },
  { id: 334, name: "Flygon", prefix: "Fly", suffix: "gon" },
  { id: 335, name: "Milotic", prefix: "Milo", suffix: "tic" },
  { id: 336, name: "Salamence", prefix: "Sala", suffix: "mence" },
  { id: 342, name: "Rayquaza", prefix: "Ray", suffix: "quaza" },
  { id: 380, name: "Deoxys", prefix: "Deo", suffix: "xys" },
  { id: 381, name: "Jirachi", prefix: "Jira", suffix: "chi" },
  // Gen 4 (Infinite Fusion IDs)
  { id: 269, name: "Togekiss", prefix: "Toge", suffix: "kiss" },
  { id: 271, name: "Leafeon", prefix: "Leaf", suffix: "eon" },
  { id: 272, name: "Glaceon", prefix: "Glace", suffix: "eon" },
  { id: 296, name: "Lucario", prefix: "Luca", suffix: "rio" },
  { id: 299, name: "Garchomp", prefix: "Gar", suffix: "chomp" },
  { id: 318, name: "Torterra", prefix: "Tor", suffix: "terra" },
  { id: 321, name: "Infernape", prefix: "Infern", suffix: "nape" },
  { id: 324, name: "Empoleon", prefix: "Empo", suffix: "leon" },
  { id: 343, name: "Dialga", prefix: "Dia", suffix: "ga" },
  { id: 344, name: "Palkia", prefix: "Pal", suffix: "kia" },
  { id: 345, name: "Giratina", prefix: "Gira", suffix: "tina" },
  { id: 347, name: "Darkrai", prefix: "Dark", suffix: "krai" },
];

export const POOL_IDS: ReadonlySet<number> = new Set(POOL.map((p) => p.id));

const POKE_BY_ID = new Map(POOL.map((p) => [p.id, p]));

export function pokemonName(id: number): string | null {
  return POKE_BY_ID.get(id)?.name ?? null;
}

export function isPoolId(id: unknown): id is number {
  return typeof id === "number" && Number.isInteger(id) && POOL_IDS.has(id);
}

export function randomPoolId(): number {
  return POOL[Math.floor(Math.random() * POOL.length)].id;
}

// The Infinite Fusion-style portmanteau for a fusion: head's prefix joined to
// the body's suffix (Psyduck + Machamp -> "Psychamp"). A self-fusion keeps the
// Pokemon's own name. Returns null if either id isn't in the pool.
export function fusedName(head: number, body: number): string | null {
  const h = POKE_BY_ID.get(head);
  const b = POKE_BY_ID.get(body);
  if (!h || !b) return null;
  if (head === body) return h.name;

  const prefix = h.prefix;
  let suffix = b.suffix;
  // Collapse a duplicated letter at the seam so e.g. Mr. Mime + Vaporeon reads
  // "Mimeon" rather than "Mimeeon".
  if (prefix[prefix.length - 1].toLowerCase() === suffix[0]?.toLowerCase()) {
    suffix = suffix.slice(1);
  }
  return prefix + suffix;
}

// Fused sprite served through our proxy (which fetches + caches the Infinite
// Fusion CDN and falls back gracefully). head/body follow the IF convention.
export function fusionSpriteUrl(head: number, body: number): string {
  return `/api/fusion-sprite?head=${head}&body=${body}`;
}

// A single Pokemon's sprite for reels/grid thumbnails. Uses the self-fusion
// ({id}.{id}) through the same proxy so it stays consistent with IF IDs
// (PokeAPI would be wrong for Gen 3+).
export function pokemonSpriteUrl(id: number): string {
  return fusionSpriteUrl(id, id);
}
