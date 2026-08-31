/**
 * What is coming up: feasts and fasts within the next 30 days.
 *
 * Run: node examples/upcoming.js
 */
const API = process.env.EOTC_API ?? 'https://eotcdev-api.natinael-96.workers.dev';

// `days` is capped at 30. Omitting `from` anchors the window to the API's own
// today, which is what a widget wants; pass `from=YYYY-MM-DD` to look ahead from
// a fixed date instead. Note the cache difference: the anchored form is
// revalidated every 60 seconds, the dated form is cacheable for a day.
const response = await fetch(`${API}/v1/upcoming?days=30&type=all`);
if (!response.ok) throw new Error(`EOTC API returned ${response.status}`);
const { from, count, items } = await response.json();

console.log(`${count} occasions in the 30 days from ${from.gregorian}\n`);
for (const item of items) {
  // Each item is either a feast day or the first day of a fasting period, and
  // carries the matching object. A movable fast can open on the same day as the
  // feast that names it, so both appear -- `kind` is what tells them apart.
  const occasion = item.feast ?? item.fast;
  const label = item.kind === 'fast_begins'
    ? `${occasion.amharic} begins (${occasion.days} days)`
    : occasion.amharic;
  const away = item.daysAway === 0 ? 'today'
    : item.daysAway === 1 ? 'tomorrow'
    : `in ${item.daysAway} days`;
  console.log(`${item.gregorian}  ${label} · ${occasion.english} — ${away}`);
}
