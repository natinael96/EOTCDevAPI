/**
 * Feast lookup by key or by name, with homophone-aware matching.
 *
 * Every feast is searchable under its key, its three canonical names, and a
 * curated alias list of the other names it is commonly known by (ትንሣኤ and
 * ፋሲካ and Easter are one feast). Matching folds Ethiopic homophones, so
 * ትንሳኤ finds ትንሣኤ and ፆም finds ጾም. The alias table and matching rules are
 * mirrored in py/eotc/feast_search.py and held identical by shared fixtures.
 */
import { MOVABLE_FEASTS } from './bahirehasab.ts';
import { FIXED_FEASTS } from './feasts.ts';
import { foldEthiopic } from './citations.ts';

/** Other names each feast is commonly known by (any script). */
export const FEAST_ALIASES: Record<string, readonly string[]> = {
  enkutatash: ['አዲስ ዓመት', 'ርዕሰ ዓውደ ዓመት', 'ቅዱስ ዮሐንስ', 'New Year', 'Kudus Yohannes'],
  meskel: ['ደመራ', 'Demera', 'Meskel'],
  gena: ['ልደት', 'Lidet', 'Genna', 'Christmas', 'Nativity'],
  timket: ['ጥምቀት', 'Timkat', 'Epiphany', 'Theophany', 'አስተርእዮ', 'Astereyo'],
  kana_zegelila: ['Cana', 'ቃና'],
  kidane_mihret: ['Kidane Mehret'],
  giyorgis: ['ጊዮርጊስ', 'St George', 'Giorgis'],
  lideta: ['ልደታ', 'Lideta'],
  petros_pawlos: ['ጴጥሮስ እና ጳውሎስ', 'Peter and Paul'],
  gabriel: ['ገብርኤል', 'Gabriel'],
  buhe: ['ደብረ ታቦር', 'Debre Tabor', 'Transfiguration'],
  filseta: ['ፍልሰታ', 'ጾመ ፍልሰታ', 'Filseta', 'Assumption'],
  nineveh: ['ነነዌ', 'ጾመ ነነዌ', 'Nineveh', 'Tsome Nenewe'],
  abiy_tsome: ['ሁዳዴ', 'ዐቢይ ጾም', 'Hudade', 'Great Lent', 'Lent', 'Abiy Tsom'],
  debre_zeit: ['ደብረ ዘይት', 'Debre Zeyt', 'Mid-Lent'],
  hosanna: ['ሆሣዕና', 'Hosaena', 'Palm Sunday'],
  siklet: ['ስቅለት', 'Good Friday', 'Crucifixion', 'Siqlet'],
  fasika: ['ፋሲካ', 'ትንሣኤ', 'Tinsae', 'Easter', 'Pascha', 'Resurrection'],
  rikbe_kahnat: ['ርክበ ካህናት', 'Rikbe Kahinat'],
  erget: ['ዕርገት', 'Ascension'],
  peraklitos: ['ጰራቅሊጦስ', 'ጴንጤቆስጤ', 'Pentecost', 'Paraclete'],
  tsome_hawaryat: ['ጾመ ሐዋርያት', "Apostles' Fast", 'Tsome Hawariyat'],
  tsome_dihnet: ['ጾመ ድኅነት', 'Fast of Salvation'],
};

export interface FeastDefinition {
  key: string;
  amharic: string;
  translit: string;
  english: string;
  movable: boolean;
  major: boolean | null;
  aliases: readonly string[];
}

/** Every feast the API models, movable then fixed, in canonical order. */
export function feastDefinitions(): FeastDefinition[] {
  const movable = MOVABLE_FEASTS.map((feast) => ({
    key: feast.key, amharic: feast.amharic, translit: feast.translit,
    english: feast.english, movable: true, major: null,
    aliases: FEAST_ALIASES[feast.key] ?? [],
  }));
  const fixed = FIXED_FEASTS.map((feast) => ({
    key: feast.key, amharic: feast.amharic, translit: feast.translit,
    english: feast.english, movable: false, major: feast.major,
    aliases: FEAST_ALIASES[feast.key] ?? [],
  }));
  return [...movable, ...fixed];
}

export interface FeastMatch {
  definition: FeastDefinition;
  matchedOn: string;
  matchedValue: string;
  confidence: 'exact' | 'partial';
}

/** Find a single feast by key or alias (exact folded match only). */
export function feastByKey(keyOrAlias: string): FeastDefinition | null {
  const folded = foldEthiopic(keyOrAlias);
  if (!folded) return null;
  for (const definition of feastDefinitions()) {
    if (foldEthiopic(definition.key) === folded) return definition;
    const names = [definition.amharic, definition.translit, definition.english, ...definition.aliases];
    if (names.some((name) => foldEthiopic(name) === folded)) return definition;
  }
  return null;
}

/** Homophone-aware search across all names and aliases. */
export function searchFeasts(query: string): FeastMatch[] {
  const folded = foldEthiopic(query);
  if (!folded) return [];
  const matches: FeastMatch[] = [];
  for (const definition of feastDefinitions()) {
    const candidates: [string, string][] = [
      ['key', definition.key],
      ['amharic', definition.amharic],
      ['translit', definition.translit],
      ['english', definition.english],
      ...definition.aliases.map((alias): [string, string] => ['alias', alias]),
    ];
    let best: FeastMatch | null = null;
    for (const [label, value] of candidates) {
      const foldedValue = foldEthiopic(value);
      if (!foldedValue) continue;
      let confidence: 'exact' | 'partial' | null = null;
      if (foldedValue === folded) confidence = 'exact';
      else if (foldedValue.includes(folded) || folded.includes(foldedValue)) confidence = 'partial';
      if (!confidence) continue;
      const candidate: FeastMatch = { definition, matchedOn: label, matchedValue: value, confidence };
      if (!best || (best.confidence === 'partial' && confidence === 'exact')) best = candidate;
      if (best.confidence === 'exact') break;
    }
    if (best) matches.push(best);
  }
  matches.sort((a, b) => a.confidence === b.confidence
    ? 0
    : a.confidence === 'exact' ? -1 : 1);
  return matches;
}
