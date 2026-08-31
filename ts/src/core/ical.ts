/**
 * iCalendar (RFC 5545) feed of an Ethiopian year's fasts and feasts.
 *
 * Determinism matters here: DTSTAMP is required by the RFC but must not be
 * "now", or every request would produce different bytes -- breaking both HTTP
 * caching and the byte-parity contract with the Python implementation. Each
 * event's DTSTAMP is derived from its own date instead.
 *
 * Fasting periods become one all-day spanning event each (a 55-day Lent event,
 * not 55 single-day events); feasts become single all-day events.
 */
import { jdnToGregorian, ethiopicToJDN, daysInEthiopicMonth, MONTHS } from './ethiopic.ts';
import { movableFeasts } from './bahirehasab.ts';
import { fastPeriods } from './fasts.ts';
import { fixedFeasts } from './feasts.ts';
import { fixedGitsaweOn } from './gitsawe.ts';
import { bibleBook } from './bible.ts';

const pad = (n: number) => String(n).padStart(2, '0');

/** JDN -> RFC 5545 DATE value (YYYYMMDD). */
const icsDate = (jdn: number): string => {
  const g = jdnToGregorian(jdn);
  return `${String(g.year).padStart(4, '0')}${pad(g.month)}${pad(g.day)}`;
};

/** Escape TEXT per RFC 5545 §3.3.11. */
const esc = (s: string): string =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

/** Fold lines longer than 75 octets (RFC 5545 §3.1). Folds on characters,
 * conservatively at 60, so multi-byte Ge'ez text never splits mid-codepoint. */
const fold = (line: string): string => {
  const out: string[] = [];
  let rest = line;
  while ([...rest].length > 60) {
    const chars = [...rest];
    out.push(out.length ? ' ' + chars.slice(0, 59).join('') : chars.slice(0, 60).join(''));
    rest = chars.slice(out.length === 1 ? 60 : 59).join('');
  }
  out.push(out.length ? ' ' + rest : rest);
  return out.join('\r\n');
};

interface IcsEvent {
  uid: string;
  startJDN: number;
  /** Inclusive; DTEND is exclusive per the RFC, so +1 is applied at render. */
  endJDN: number;
  summary: string;
  description: string;
  categories: string;
}

function render(events: IcsEvent[], calName: string): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//EOTCDev//EOTCDev API 0.1.0//AM',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    fold(`X-WR-CALNAME:${esc(calName)}`),
    'X-WR-TIMEZONE:Africa/Addis_Ababa',
  ];
  for (const ev of events) {
    lines.push(
      'BEGIN:VEVENT',
      fold(`UID:${ev.uid}@eotcdev`),
      // Deterministic: derived from the event's own date, not from "now".
      `DTSTAMP:${icsDate(ev.startJDN)}T000000Z`,
      `DTSTART;VALUE=DATE:${icsDate(ev.startJDN)}`,
      `DTEND;VALUE=DATE:${icsDate(ev.endJDN + 1)}`,
      fold(`SUMMARY:${esc(ev.summary)}`),
      fold(`DESCRIPTION:${esc(ev.description)}`),
      `CATEGORIES:${ev.categories}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

/**
 * One reading rendered for a calendar description: the Amharic book
 * abbreviation with chapter and verses, falling back to the printed label when
 * the citation could not be resolved to a canonical reference.
 */
function referenceLabel(reading: any): string {
  const ref = reading.canonicalReference;
  if (ref?.chapter) {
    const name = bibleBook(ref.book)?.names.amharicAbbreviation ?? ref.book;
    let out = `${name} ${ref.chapter}`;
    if (ref.verseStart) {
      out += `:${ref.verseStart}`;
      if (ref.verseEnd && ref.verseEnd !== ref.verseStart) out += `-${ref.verseEnd}`;
      else if (ref.toEndOfChapter) out += '-';
    }
    return out;
  }
  return [reading.sourceBook, reading.sourceCitation].filter(Boolean).join(' ').trim();
}

const SERVICE_LABELS: [string, string][] = [
  ['matins', 'ዘነግህ'], ['liturgy', 'ዘቅዳሴ'], ['vespers', 'ዘሠርክ'],
];

/** The day's services as description lines, in service order. */
function readingsDescription(services: Record<string, any>): string {
  const lines: string[] = [];
  for (const [name, label] of SERVICE_LABELS) {
    const service = services[name];
    if (!service) continue;
    const parts: string[] = [];
    for (const reading of service.psalms ?? []) parts.push(`ምስባክ ${referenceLabel(reading)}`);
    for (const reading of service.epistlesAndActs ?? []) parts.push(`ንባብ ${referenceLabel(reading)}`);
    for (const reading of service.gospels ?? []) parts.push(`ወንጌል ${referenceLabel(reading)}`);
    if (service.anaphora) parts.push(`ቅዳሴ ${String(service.anaphora).replace(/\s*[።፡]\s*$/, '')}`);
    if (parts.length) lines.push(`${label}: ${parts.join(' · ')}`);
  }
  return lines.join('\n');
}

/** Build the .ics text for an Ethiopian year. */
export function buildIcs(year: number, type: 'fasting' | 'feasts' | 'all' | 'readings'): string {
  const events: IcsEvent[] = [];

  // The daily lectionary is its own subscription: one all-day event per day
  // carrying that day's appointed readings, not the year's fasts and feasts.
  if (type === 'readings') {
    for (let month = 1; month <= 13; month++) {
      for (let day = 1; day <= daysInEthiopicMonth(year, month); day++) {
        const fixed = fixedGitsaweOn(month, day);
        if (!fixed) continue;
        const gitsawe = fixed.gitsawe as { commemoration?: string; services: Record<string, any> };
        const description = readingsDescription(gitsawe.services);
        if (!description) continue;
        const jdn = ethiopicToJDN(year, month, day);
        const commemoration = (gitsawe.commemoration ?? '').replace(/\s*[።፡]\s*$/, '').trim();
        events.push({
          uid: `readings-${year}-${month}-${day}`,
          startJDN: jdn, endJDN: jdn,
          summary: `${MONTHS[month - 1].amharic} ${day} · ${commemoration || 'ግጻዌ'}`,
          description,
          categories: 'READING',
        });
      }
    }
    return render(events, `EOTC ግጻዌ · Daily Readings · ${year} EC`);
  }

  if (type !== 'feasts') {
    for (const p of fastPeriods(year)) {
      events.push({
        uid: `fast-${p.key}-${year}`, startJDN: p.startJDN, endJDN: p.endJDN,
        summary: `${p.amharic} · ${p.english}`,
        description: p.description, categories: 'FASTING',
      });
    }
  }
  if (type !== 'fasting') {
    for (const f of movableFeasts(year)) {
      // The three fast-opening entries are periods, not feast days.
      if (f.key === 'nineveh' || f.key === 'tsome_hawaryat' || f.key === 'tsome_dihnet') continue;
      events.push({
        uid: `feast-${f.key}-${year}`, startJDN: f.jdn, endJDN: f.jdn,
        summary: `${f.amharic} · ${f.english}`,
        description: `Movable feast of the Ethiopian Orthodox Tewahedo Church (EC ${year}).`,
        categories: 'FEAST',
      });
    }
    for (const f of fixedFeasts(year)) {
      events.push({
        uid: `feast-${f.key}-${year}`, startJDN: f.jdn, endJDN: f.jdn,
        summary: `${f.amharic} · ${f.english}`,
        description: `Fixed feast of the Ethiopian Orthodox Tewahedo Church (EC ${year}).`,
        categories: f.major ? 'FEAST,MAJOR' : 'FEAST',
      });
    }
  }

  events.sort((a, b) => a.startJDN - b.startJDN || (a.uid < b.uid ? -1 : 1));
  const label = { fasting: 'Fasts', feasts: 'Feasts', all: 'Fasts & Feasts', readings: 'Readings' }[type];
  return render(events, `EOTC ${label} · ${year} EC`);
}
