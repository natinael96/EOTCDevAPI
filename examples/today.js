/**
 * Today's screen: the Ethiopian date, whether it is a fast, who is
 * commemorated, and the readings appointed for the day -- in one request.
 *
 * Run: node examples/today.js
 */
const API = process.env.EOTC_API ?? 'https://eotcdev-api.natinael-96.workers.dev';

// Ask the API what "today" is. Do not build this from the device clock: a phone
// in Toronto at 9pm is already on the next Ethiopian day in Addis Ababa, so a
// locally computed date shows the wrong commemorations. Name the timezone the
// day should be reckoned in and let the server resolve it.
//
// `include` is opt-in. Without it this returns just the date and fasting status;
// with it, one request fills the whole screen.
const url = `${API}/v1/today?tz=Africa/Addis_Ababa&include=readings,sinksar`;
const response = await fetch(url);
if (!response.ok) throw new Error(`EOTC API returned ${response.status}`);
const day = await response.json();

console.log(`${day.ethiopic.monthName.amharic} ${day.ethiopic.day}, ${day.ethiopic.year} ዓ.ም.`);
console.log(`${day.weekday.amharic} · ${day.gregorian.date} · ${day.ethiopic.date} EC`);
console.log(day.fasting.isFasting ? `ጾም · ${day.fasting.reason}` : 'Not a fasting day.');

// Who is commemorated. `annual` is kept once a year; `monthly` recurs on this
// day of every month, so both lists belong on the screen.
for (const [label, names] of [['ዓመታዊ · annual', day.sinksar.annual],
                              ['ወርኀዊ · monthly', day.sinksar.monthly]]) {
  if (!names.length) continue;
  console.log(`\n${label}`);
  for (const name of names) console.log(`  ${name}`);
}

/**
 * Render one reading. `canonicalReference` is the linkable form: its chapter and
 * verse numbers follow the Hebrew numbering used by ordinary Bible editions, not
 * the Ge'ez psalter numbering printed in the Gitsawe, so a Psalm reference here
 * can legitimately differ by one from the printed citation. It is null when the
 * printed citation could not be resolved, and `sourceCitation` always survives.
 */
function reference(reading) {
  const ref = reading.canonicalReference;
  if (!ref) return `${reading.sourceBook} ${reading.sourceCitation} (unresolved)`;
  const verses = ref.verseStart
    ? `:${ref.verseStart}${ref.verseEnd && ref.verseEnd !== ref.verseStart ? `-${ref.verseEnd}` : ''}`
    : '';
  return `${ref.book} ${ref.chapter}${verses}`;
}

const liturgy = day.readings.services.liturgy;
console.log('\nቅዳሴ · liturgy');
for (const psalm of liturgy.psalms) console.log(`  ምስባክ  ${reference(psalm)}`);
for (const epistle of liturgy.epistles) console.log(`  ንባብ   ${reference(epistle)}`);
for (const gospel of liturgy.gospels) console.log(`  ወንጌል  ${reference(gospel)}`);
if (liturgy.anaphora) console.log(`  ቅዳሴ   ${liturgy.anaphora}`);
