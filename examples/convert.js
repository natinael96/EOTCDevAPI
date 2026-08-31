/**
 * Converting between the Ethiopian and Gregorian calendars.
 *
 * Run: node examples/convert.js
 */
const API = process.env.EOTC_API ?? 'https://eotcdev-api.natinael-96.workers.dev';

async function get(path) {
  const response = await fetch(`${API}${path}`);
  if (!response.ok) throw new Error(`EOTC API returned ${response.status} for ${path}`);
  return response.json();
}

// Gregorian in, Ethiopian out. Input is Gregorian unless told otherwise.
const forward = await get('/v1/convert/2026-04-12');
console.log(`${forward.gregorian.date}  ->  ${forward.ethiopic.date} EC (${forward.weekday.english})`);

// Ethiopian in, Gregorian out. Ethiopian years are Amete Mihret, and the year
// has 13 months: Pagumen, month 13, has 5 days, or 6 before a leap year. Code
// that loops over months must go 1..13, not 1..12.
const back = await get('/v1/convert/2018-13-05?calendar=ethiopian');
console.log(`${back.ethiopic.date} EC  ->  ${back.gregorian.date} (${back.weekday.english})`);

// A list of dates converts in one round trip, up to 366 per request. Individual
// bad dates come back as per-item errors rather than failing the whole batch.
const batch = await fetch(`${API}/v1/calendar/convert/batch`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ dates: ['2026-01-07', '2026-09-11', '2026-02-31'] }),
});
for (const result of (await batch.json()).results) {
  console.log(result.error ? `${result.input}  ->  ${result.error}`
                           : `${result.input}  ->  ${result.ethiopic.date} EC`);
}
