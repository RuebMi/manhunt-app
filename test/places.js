// Vorschläge für Checkpoints (Overpass über den eigenen Server) – ohne echte Anfragen ins Internet.
// Start: node test/places.js (läuft auch in npm test)
import assert from 'node:assert/strict';
import { createPlaceFinder } from '../server/places.js';

const VS = { lat: 48.0603, lng: 8.4586 };
const north = (m) => ({ lat: VS.lat + m / 111320, lon: VS.lng });

const REPLY = {
  elements: [
    { type: 'node', ...north(300), tags: { leisure: 'playground' } },
    { type: 'way', center: north(100), tags: { place: 'square', name: 'Marktplatz' } },
    { type: 'node', ...north(200), tags: { amenity: 'fountain', name: 'Löwenbrunnen' } },
    { type: 'node', ...north(220), tags: { amenity: 'fountain', name: 'Löwenbrunnen' } }, // doppelt, 20 m daneben
    { type: 'node', ...north(900), tags: { amenity: 'fountain', name: 'Löwenbrunnen' } }, // gleicher Name, aber weit weg
    { type: 'node', ...north(150), tags: { amenity: 'place_of_worship', name: 'Münster' } },
    { type: 'node', ...north(160), tags: { historic: 'memorial' } },
    { type: 'node', ...north(30), tags: { historic: 'memorial', memorial: 'stolperstein', name: 'Stolperstein A' } },
    { type: 'node', ...north(40), tags: { historic: 'memorial', memorial: 'plaque', name: 'Gedenktafel B' } },
    { type: 'way', center: north(400), tags: { leisure: 'park', name: 'Kurpark' } },
    { type: 'node', ...north(50), tags: { leisure: 'playground', name: 'Privat', access: 'private' } },
    { type: 'node', ...north(60), tags: { leisure: 'playground', name: 'Gesperrt', access: 'no' } },
    { type: 'way', tags: { leisure: 'park', name: 'Ohne Mitte' } },
  ],
};

function fakeFetch(reply = REPLY) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url: String(url), opts });
    if (reply instanceof Error) throw reply;
    return { ok: true, status: 200, json: async () => reply };
  };
  fn.calls = calls;
  return fn;
}

async function findTests() {
  const fetchImpl = fakeFetch();
  const places = createPlaceFinder({ fetchImpl, minIntervalMs: 0 });
  const list = await places.find({ lat: VS.lat, lng: VS.lng, radius: 1000 });

  const call = fetchImpl.calls[0];
  assert.equal(call.url, 'https://overpass-api.de/api/interpreter');
  assert.equal(call.opts.method, 'POST');
  assert.match(call.opts.headers['User-Agent'], /Manhunt/);
  const query = new URLSearchParams(call.opts.body).get('data');
  assert.ok(query.includes(`around:1000,${VS.lat},${VS.lng}`), query);
  assert.ok(!/out center tags 200;/.test(query), 'kein knappes Limit, sonst fallen Plätze und Parks weg');
  assert.ok(query.includes('"memorial"!~"^(stolperstein|plaque|stele)$"'), 'kleine Gedenktafeln ausgeschlossen');
  for (const f of ['"place"="square"', '"leisure"="playground"', '"amenity"="place_of_worship"', '"amenity"="fountain"', '"historic"~"^(monument|memorial)$"', '"leisure"="park"']) {
    assert.ok(query.includes(f), `Merkmal ${f}`);
  }

  assert.deepEqual(
    list.map((p) => [p.name, p.kind]),
    [
      ['Marktplatz', 'Platz'],
      ['Münster', 'Kirche'],
      ['Denkmal', 'Denkmal'],
      ['Löwenbrunnen', 'Brunnen'],
      ['Spielplatz', 'Spielplatz'],
      ['Kurpark', 'Park'],
      ['Löwenbrunnen', 'Brunnen'],
    ],
    'nach Abstand sortiert, ohne private, ohne Doppelte in 50 m, ohne Namen → Art',
  );
  assert.ok(Math.abs(list[0].lat - north(100).lat) < 1e-9 && list[0].lng === VS.lng, 'Wege: Mittelpunkt');

  // Gleiche Anfrage kommt aus dem Zwischenspeicher
  await places.find({ lat: VS.lat + 0.00001, lng: VS.lng, radius: 1000 });
  assert.equal(fetchImpl.calls.length, 1, 'zweite gleiche Anfrage fragt nicht erneut');
  await places.find({ lat: VS.lat, lng: VS.lng, radius: 1500 });
  assert.equal(fetchImpl.calls.length, 2, 'anderer Radius fragt neu');

  // Höchstens 30, die nächsten zuerst
  const many = { elements: Array.from({ length: 50 }, (_, i) => ({ type: 'node', ...north(1000 - i * 10), tags: { amenity: 'fountain', name: `B${i}` } })) };
  const list2 = await createPlaceFinder({ fetchImpl: fakeFetch(many), minIntervalMs: 0 }).find({ lat: VS.lat, lng: VS.lng, radius: 1200 });
  assert.equal(list2.length, 30);
  assert.equal(list2[0].name, 'B49');

  // Fehler werden weitergegeben, nicht gespeichert
  const failing = fakeFetch(new Error('offline'));
  const p3 = createPlaceFinder({ fetchImpl: failing, minIntervalMs: 0 });
  await assert.rejects(() => p3.find({ lat: VS.lat, lng: VS.lng, radius: 1000 }));
  await assert.rejects(() => p3.find({ lat: VS.lat, lng: VS.lng, radius: 1000 }));
  assert.equal(failing.calls.length, 2);
  const bad = async () => ({ ok: false, status: 504, json: async () => ({}) });
  await assert.rejects(() => createPlaceFinder({ fetchImpl: bad, minIntervalMs: 0 }).find({ lat: VS.lat, lng: VS.lng, radius: 1000 }), /504/);
  console.log('✓ Checkpoint-Vorschläge');
}

await findTests();
