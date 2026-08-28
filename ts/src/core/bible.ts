/**
 * The Bible metadata catalog: canon order, book identity, localized names,
 * chapter and verse counts (am-1980 versification), and the editions
 * registry. Verse text is not part of the catalog; see the license boundary
 * recorded in data/sinq-gitsawe/manifest.json and the editions registry.
 */
import catalogJson from '../../../py/eotc/bible_catalog.js';
import { foldEthiopic } from './citations.ts';

export interface BibleBook {
  id: string;
  order: number;
  slug: string;
  testament: string | null;
  section: string | null;
  names: { english: string | null; amharic: string | null; amharicAbbreviation: string | null };
  chapters: number;
  verseCounts: number[];
  textEditions: Record<string, boolean>;
}

export interface BibleEdition {
  id: string;
  title: string;
  titleEnglish: string;
  language: string;
  script: string;
  year: number;
  era: string;
  canon: string;
  publisher: string | null;
  license: string;
  source: string;
  note: string;
}

type BibleCatalog = {
  version: number;
  versification: string;
  canonNote: string;
  books: BibleBook[];
  editions: BibleEdition[];
};

const catalog = catalogJson as BibleCatalog;

export function bibleVersification(): string {
  return catalog.versification;
}

export function bibleCanonNote(): string {
  return catalog.canonNote;
}

export function bibleBooks(): BibleBook[] {
  return catalog.books;
}

export function bibleEditions(): BibleEdition[] {
  return catalog.editions;
}

export function bibleBook(idOrSlug: string): BibleBook | null {
  const wanted = (idOrSlug || '').trim().toLowerCase();
  return catalog.books.find(
    (book) => book.id.toLowerCase() === wanted || book.slug === wanted,
  ) ?? null;
}

// Folded lookup index: every name a book is known by, folded, mapping to the
// book. Built once; exact folded matches are 'exact', unique substring
// matches are 'partial'.
type IndexEntry = { book: BibleBook; label: string };
let foldedIndex: Map<string, IndexEntry> | null = null;
function index(): Map<string, IndexEntry> {
  if (foldedIndex) return foldedIndex;
  foldedIndex = new Map();
  const add = (key: string | null, book: BibleBook, label: string) => {
    if (!key) return;
    const folded = foldEthiopic(key);
    if (folded && !foldedIndex!.has(folded)) foldedIndex!.set(folded, { book, label });
  };
  for (const book of catalog.books) {
    add(book.id, book, 'id');
    add(book.slug, book, 'slug');
    add(book.names.english, book, 'english');
    add(book.names.amharic, book, 'amharic');
    add(book.names.amharicAbbreviation, book, 'amharicAbbreviation');
    // The bare title without its genre prefix (ኦሪት ዘፍጥረት -> ዘፍጥረት,
    // መጽሐፈ ኢዮብ -> ኢዮብ, የማርቆስ ወንጌል -> ማርቆስ ወንጌል).
    if (book.names.amharic) {
      const stripped = book.names.amharic
        .replace(/^(ኦሪት|መጽሐፈ|መልእክተ|የ)\s*/, '')
        .replace(/^የ/, '');
      add(stripped, book, 'amharicStripped');
    }
  }
  return foldedIndex;
}

export interface BookMatch {
  book: BibleBook;
  matchedOn: string;
  confidence: 'exact' | 'partial';
}

/** Resolve a book label (any script, any of its names) to a catalog book. */
export function resolveBook(label: string): BookMatch | null {
  const folded = foldEthiopic(label);
  if (!folded) return null;
  const exact = index().get(folded);
  if (exact) return { book: exact.book, matchedOn: exact.label, confidence: 'exact' };
  // Unique substring match in either direction.
  const hits: IndexEntry[] = [];
  for (const [key, entry] of index()) {
    if (key.includes(folded) || folded.includes(key)) {
      if (!hits.some((hit) => hit.book.id === entry.book.id)) hits.push(entry);
    }
  }
  if (hits.length === 1) return { book: hits[0].book, matchedOn: hits[0].label, confidence: 'partial' };
  return null;
}
