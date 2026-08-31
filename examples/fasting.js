/**
 * Is it a fasting day, and why?
 *
 * Run: node examples/fasting.js [YYYY-MM-DD]
 */
const API = process.env.EOTC_API ?? 'https://eotcdev-api.natinael-96.workers.dev';

// A date given on the command line is Gregorian; with no argument the API's own
// "today" is used, reckoned in Addis Ababa. Deriving the date from the device
// clock would put users west of Addis on the wrong day for part of every day.
const date = process.argv[2];
const url = date
  ? `${API}/v1/fasting/${date}`
  : `${API}/v1/today?tz=Africa/Addis_Ababa`;

const response = await fetch(url);
if (!response.ok) throw new Error(`EOTC API returned ${response.status}`);
const body = await response.json();

// /v1/today nests the same information under `fasting`; /v1/fasting spreads it.
const fasting = body.fasting ?? body;
const on = body.gregorian?.date ?? body.gregorian;

console.log(`${on}: ${fasting.isFasting ? 'ጾም · fasting' : 'not a fasting day'}`);
console.log(`  ${fasting.reason}`);

// `periods` names the fasts the day falls inside, which is what a UI should
// label the day with. A day can sit inside a period and still not be a fast:
// the weekly Wednesday and Friday fast is suspended for the fifty days after
// Fasika and on the great feasts of the Lord, and `reason` says so.
for (const period of fasting.periods ?? []) {
  console.log(`  in ${period.amharic} · ${period.english}`);
}
