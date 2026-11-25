// Ortssuche (Nominatim über den eigenen Server) – ohne echte Anfragen ins Internet.
// Start: node test/geocode.js (läuft auch in npm test)
import assert from 'node:assert/strict';
import { createGeocoder } from '../server/geocode.js';

const NEU_ULM = [
  { display_name: 'Neu-Ulm, Landkreis Neu-Ulm, Bayern, Deutschland', lat: '48.3925', lon: '10.0112' },
  { display_name: 'Neu-Ulmer Straße, Senden, Landkreis Neu-Ulm, Bayern, Deutschland', lat: '48.3260', lon: '10.0450' },
];

function fakeFetch(reply = NEU_ULM) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url: String(url), opts, at: Date.now() });
    if (reply instanceof Error) throw reply;
    return { ok: true, status: 200, json: async () => reply };
  };
  fn.calls = calls;
  return fn;
}

async function searchTests() {
  const fetchImpl = fakeFetch();
  const geo = createGeocoder({ fetchImpl, minIntervalMs: 0 });
  const hits = await geo.search('  Neu Ulm ');
  assert.deepEqual(hits, [
    { name: 'Neu-Ulm, Landkreis Neu-Ulm, Bayern', lat: 48.3925, lng: 10.0112 },
    { name: 'Neu-Ulmer Straße, Senden, Landkreis Neu-Ulm', lat: 48.326, lng: 10.045 },
  ]);
  const url = new URL(fetchImpl.calls[0].url);
  assert.equal(url.origin + url.pathname, 'https://nominatim.openstreetmap.org/search');
  assert.equal(url.searchParams.get('q'), 'Neu Ulm');
  assert.equal(url.searchParams.get('format'), 'jsonv2');
  assert.equal(url.searchParams.get('limit'), '5');
  assert.equal(url.searchParams.get('accept-language'), 'de');
  assert.match(fetchImpl.calls[0].opts.headers['User-Agent'], /Manhunt/);

  // Gleiche Suche (Groß-/Kleinschreibung egal) kommt aus dem Zwischenspeicher
  await geo.search('neu ulm');
  assert.equal(fetchImpl.calls.length, 1, 'zweite gleiche Suche fragt nicht erneut');

  // Kaputte Einträge werden übersprungen, leere Suche wird abgelehnt
  const geo2 = createGeocoder({ fetchImpl: fakeFetch([{ display_name: 'X', lat: 'abc', lon: '1' }, ...NEU_ULM.slice(0, 1)]), minIntervalMs: 0 });
  assert.equal((await geo2.search('x')).length, 1);
  await assert.rejects(() => geo.search('  '), /leer/);

  // Gleicher Kurzname zweimal: nur der erste (bessere) Treffer bleibt
  const dup = [
    { display_name: 'Neustadt, Bezirk, Stadt, Land', lat: '1', lon: '1' },
    { display_name: 'Neustadt, Bezirk, Stadt, Anderes', lat: '2', lon: '2' },
    { display_name: 'Neustadt am See, Kreis, Land', lat: '3', lon: '3' },
  ];
  const geo4 = createGeocoder({ fetchImpl: fakeFetch(dup), minIntervalMs: 0 });
  assert.deepEqual((await geo4.search('Neustadt')).map((x) => x.lat), [1, 3]);

  // Fehler von Nominatim werden weitergegeben, nicht zwischengespeichert
  const failing = fakeFetch(new Error('offline'));
  const geo3 = createGeocoder({ fetchImpl: failing, minIntervalMs: 0 });
  await assert.rejects(() => geo3.search('Ulm'));
  await assert.rejects(() => geo3.search('Ulm'));
  assert.equal(failing.calls.length, 2);
  console.log('✓ Ortssuche');
}

async function throttleTests() {
  // Höchstens eine Anfrage pro Intervall an Nominatim, auch bei gleichzeitigen Suchen
  const fetchImpl = fakeFetch();
  const geo = createGeocoder({ fetchImpl, minIntervalMs: 120 });
  await Promise.all([geo.search('a1'), geo.search('a2'), geo.search('a3')]);
  const gaps = fetchImpl.calls.slice(1).map((c, i) => c.at - fetchImpl.calls[i].at);
  assert.equal(fetchImpl.calls.length, 3);
  assert.ok(gaps.every((g) => g >= 110), `Abstände ${gaps}`);
  console.log('✓ Ortssuche: Abstand zwischen Anfragen');
}

await searchTests();
await throttleTests();
