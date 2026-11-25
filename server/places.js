// Vorschläge für Checkpoints (Missionen) aus OpenStreetMap über die Overpass-API.
// Wie bei der Ortssuche fragt der Server an, nicht das Handy: so geht die IP-Adresse
// der Spieler nicht an Overpass, und Anfragen lassen sich drosseln und zwischenspeichern.
import { distanceM } from './game.js';

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const USER_AGENT = 'Manhunt/1.0 (Checkpoint-Vorschläge)';
const MAX_PLACES = 30;
const SAME_NAME_M = 50; // gleicher Name so nah beieinander: nur einmal zeigen
const SMALL_MEMORIALS = new Set(['stolperstein', 'plaque', 'stele']);

// Öffentliche, gut erkennbare Orte. Reihenfolge = Vorrang bei mehreren Merkmalen.
const KINDS = [
  { filter: '["place"="square"]', kind: 'Platz', test: (t) => t.place === 'square' },
  { filter: '["amenity"="place_of_worship"]', kind: 'Kirche', test: (t) => t.amenity === 'place_of_worship' },
  { filter: '["amenity"="fountain"]', kind: 'Brunnen', test: (t) => t.amenity === 'fountain' },
  // ohne Stolpersteine und kleine Gedenktafeln: davon gibt es in Städten Tausende, sie würden alles andere verdrängen
  {
    filter: '["historic"~"^(monument|memorial)$"]["memorial"!~"^(stolperstein|plaque|stele)$"]',
    kind: 'Denkmal',
    test: (t) => (t.historic === 'monument' || t.historic === 'memorial') && !SMALL_MEMORIALS.has(t.memorial),
  },
  { filter: '["leisure"="playground"]', kind: 'Spielplatz', test: (t) => t.leisure === 'playground' },
  { filter: '["leisure"="park"]', kind: 'Park', test: (t) => t.leisure === 'park' },
];

export function createPlaceFinder({ fetchImpl = fetch, minIntervalMs = 1000, cacheMs = 24 * 60 * 60 * 1000 } = {}) {
  const cache = new Map(); // "lat,lng,radius" -> { at, places }
  let queue = Promise.resolve(); // Anfragen nacheinander, mit Abstand
  let lastCall = 0;

  async function ask({ lat, lng, radius }) {
    const wait = lastCall + minIntervalMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    const around = `(around:${radius},${lat},${lng})`;
    // Ohne knappes Limit: Overpass gibt nach Art und Nummer sortiert aus, ein Limit würde Wege (Plätze, Parks) abschneiden.
    const query = `[out:json][timeout:15];(${KINDS.map((k) => `nwr${k.filter}${around};`).join('')});out center tags 2000;`;
    const res = await fetchImpl(OVERPASS, {
      method: 'POST',
      headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ data: query }).toString(),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Overpass antwortet mit ${res.status}`);
    const json = await res.json();
    const center = { lat, lng };
    const found = [];
    for (const el of Array.isArray(json?.elements) ? json.elements : []) {
      const tags = el.tags ?? {};
      if (tags.access === 'private' || tags.access === 'no') continue;
      const k = KINDS.find((x) => x.test(tags));
      const p = { lat: Number(el.lat ?? el.center?.lat), lng: Number(el.lon ?? el.center?.lon) };
      if (!k || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
      const name = String(tags.name ?? '').trim().slice(0, 40) || k.kind;
      found.push({ name, kind: k.kind, lat: p.lat, lng: p.lng, d: distanceM(center, p) });
    }
    found.sort((a, b) => a.d - b.d);
    const out = [];
    for (const p of found) {
      if (out.length >= MAX_PLACES) break;
      if (out.some((q) => q.name === p.name && distanceM(q, p) < SAME_NAME_M)) continue;
      out.push({ name: p.name, kind: p.kind, lat: p.lat, lng: p.lng });
    }
    return out;
  }

  return {
    // -> [{ name, kind, lat, lng }] (höchstens 30, nächste am Mittelpunkt zuerst)
    async find({ lat, lng, radius }) {
      const z = { lat: Number(lat), lng: Number(lng), radius: Math.round(Number(radius)) };
      if (![z.lat, z.lng, z.radius].every(Number.isFinite)) throw new Error('Ungültige Zone.');
      const key = `${z.lat.toFixed(3)},${z.lng.toFixed(3)},${z.radius}`;
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < cacheMs) return hit.places;
      const job = queue.then(() => ask(z));
      queue = job.catch(() => {}); // ein Fehler blockiert nicht die nächsten Anfragen
      const places = await job;
      cache.set(key, { at: Date.now(), places });
      if (cache.size > 200) cache.delete(cache.keys().next().value);
      return places;
    },
  };
}
