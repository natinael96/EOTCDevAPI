/**
 * On which day is a saint commemorated?
 *
 * Run: node examples/saint.js [name]
 */
const API = process.env.EOTC_API ?? 'https://eotcdev-api.natinael-96.workers.dev';

const query = process.argv[2] ?? 'ተክለ ሃይማኖት';
const year = 2018; // Ethiopian year; resolves each match to a real date.

// Matching is homophone-folded, so a name spelled with any of the Ge'ez letters
// that share a sound still matches -- ሃይማኖት and ሓይማኖት find the same entry.
const url = `${API}/v1/sinksar/search?q=${encodeURIComponent(query)}&year=${year}`;
const response = await fetch(url);
if (!response.ok) throw new Error(`EOTC API returned ${response.status}`);
const { totalMatches, truncated, matches } = await response.json();

console.log(`${totalMatches} match(es) for "${query}"${truncated ? ' (truncated)' : ''}\n`);
for (const match of matches) {
  // A monthly commemoration recurs on this day of every month, so one saint
  // legitimately appears many times; an annual one is kept on a single day.
  const recurrence = match.kind === 'monthly' ? 'monthly' : 'annual ';
  console.log(`${recurrence}  ${match.monthName.amharic} ${match.ethiopianDay}`
    + `  ${match.date.gregorian}  ${match.title}`);
}
