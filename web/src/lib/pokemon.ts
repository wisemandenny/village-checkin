// Curated avatar pool for Pokemon Infinite Fusion sprites.
//
// IMPORTANT: ids are Infinite Fusion Pokedex IDs, which equal the National Dex
// only for Gen 1-2 (1-251). Gen 3+ diverge (e.g. Blaziken = 281, Lucario = 296,
// Rayquaza = 342), so these are hardcoded to the correct IF IDs. Sprite
// filenames on the CDN use the same IF IDs.

export interface PoolPokemon {
  id: number;
  name: string;
}

export const POOL: PoolPokemon[] = [
  // Gen 1
  { id: 1, name: "Bulbasaur" },
  { id: 3, name: "Venusaur" },
  { id: 4, name: "Charmander" },
  { id: 6, name: "Charizard" },
  { id: 7, name: "Squirtle" },
  { id: 9, name: "Blastoise" },
  { id: 25, name: "Pikachu" },
  { id: 26, name: "Raichu" },
  { id: 38, name: "Ninetales" },
  { id: 39, name: "Jigglypuff" },
  { id: 52, name: "Meowth" },
  { id: 54, name: "Psyduck" },
  { id: 59, name: "Arcanine" },
  { id: 65, name: "Alakazam" },
  { id: 68, name: "Machamp" },
  { id: 94, name: "Gengar" },
  { id: 95, name: "Onix" },
  { id: 112, name: "Rhydon" },
  { id: 115, name: "Kangaskhan" },
  { id: 122, name: "Mr. Mime" },
  { id: 130, name: "Gyarados" },
  { id: 131, name: "Lapras" },
  { id: 132, name: "Ditto" },
  { id: 133, name: "Eevee" },
  { id: 134, name: "Vaporeon" },
  { id: 135, name: "Jolteon" },
  { id: 136, name: "Flareon" },
  { id: 137, name: "Porygon" },
  { id: 142, name: "Aerodactyl" },
  { id: 143, name: "Snorlax" },
  { id: 144, name: "Articuno" },
  { id: 145, name: "Zapdos" },
  { id: 146, name: "Moltres" },
  { id: 149, name: "Dragonite" },
  { id: 150, name: "Mewtwo" },
  { id: 151, name: "Mew" },
  // Gen 2 (IF IDs match National Dex)
  { id: 154, name: "Meganium" },
  { id: 157, name: "Typhlosion" },
  { id: 160, name: "Feraligatr" },
  { id: 169, name: "Crobat" },
  { id: 196, name: "Espeon" },
  { id: 197, name: "Umbreon" },
  { id: 212, name: "Scizor" },
  { id: 214, name: "Heracross" },
  { id: 248, name: "Tyranitar" },
  { id: 249, name: "Lugia" },
  { id: 250, name: "Ho-Oh" },
  { id: 251, name: "Celebi" },
  // Gen 3 (Infinite Fusion IDs)
  { id: 278, name: "Sceptile" },
  { id: 281, name: "Blaziken" },
  { id: 284, name: "Swampert" },
  { id: 287, name: "Gardevoir" },
  { id: 293, name: "Metagross" },
  { id: 310, name: "Absol" },
  { id: 334, name: "Flygon" },
  { id: 335, name: "Milotic" },
  { id: 336, name: "Salamence" },
  { id: 342, name: "Rayquaza" },
  { id: 380, name: "Deoxys" },
  { id: 381, name: "Jirachi" },
  // Gen 4 (Infinite Fusion IDs)
  { id: 269, name: "Togekiss" },
  { id: 271, name: "Leafeon" },
  { id: 272, name: "Glaceon" },
  { id: 296, name: "Lucario" },
  { id: 299, name: "Garchomp" },
  { id: 318, name: "Torterra" },
  { id: 321, name: "Infernape" },
  { id: 324, name: "Empoleon" },
  { id: 343, name: "Dialga" },
  { id: 344, name: "Palkia" },
  { id: 345, name: "Giratina" },
  { id: 347, name: "Darkrai" },
];

export const POOL_IDS: ReadonlySet<number> = new Set(POOL.map((p) => p.id));

const NAME_BY_ID = new Map(POOL.map((p) => [p.id, p.name]));

export function pokemonName(id: number): string | null {
  return NAME_BY_ID.get(id) ?? null;
}

export function isPoolId(id: unknown): id is number {
  return typeof id === "number" && Number.isInteger(id) && POOL_IDS.has(id);
}

export function randomPoolId(): number {
  return POOL[Math.floor(Math.random() * POOL.length)].id;
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
