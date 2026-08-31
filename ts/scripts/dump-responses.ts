/**
 * Dumps the Hono app's response for every route in spec/routes.json to
 * spec/responses.json. The Python parity test replays the same routes and
 * asserts identical JSON, which is what keeps the two services interchangeable.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import app from '../src/index.ts';

const specDir = resolve(import.meta.dirname, '../../spec');
const routes: string[] = JSON.parse(readFileSync(resolve(specDir, 'routes.json'), 'utf-8'));

const out: Record<string, { status: number; body: unknown }> = {};
for (const route of routes) {
  const res = await app.request(`http://localhost${route}`);
  out[route] = { status: res.status, body: await res.json() };
}

// POST /v1/calendar/convert/batch cases, keyed as "POST <route> <n>".
const batches: Array<Record<string, unknown>> = JSON.parse(
  readFileSync(resolve(specDir, 'batch-cases.json'), 'utf-8'),
);
for (let i = 0; i < batches.length; i++) {
  const res = await app.request('http://localhost/v1/calendar/convert/batch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(batches[i]),
  });
  out[`POST /v1/calendar/convert/batch #${i}`] = { status: res.status, body: await res.json() };
}

writeFileSync(resolve(specDir, 'responses.json'), JSON.stringify(out, null, 1) + '\n');

// The .ics feeds are compared as raw text, not JSON.
const ics: Record<string, { status: number; body: string }> = {};
for (const year of [2015, 2018]) {
  for (const type of ['fasting', 'feasts', 'all', 'readings']) {
    const res = await app.request(`http://localhost/v1/calendar/ics?year=${year}&type=${type}`);
    ics[`/v1/calendar/ics?year=${year}&type=${type}`] = { status: res.status, body: await res.text() };
  }
}
writeFileSync(resolve(specDir, 'responses-ics.json'), JSON.stringify(ics, null, 1) + '\n');
console.log(`dumped ${routes.length} GET + ${batches.length} POST + ${Object.keys(ics).length} ics -> spec/`);
