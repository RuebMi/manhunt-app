// Ortssuche für die Spielfeld-Auswahl über Nominatim (OpenStreetMap).
// Der Server fragt an, nicht das Handy: so geht die IP-Adresse der Spieler nicht an
// Nominatim, und die Nutzungsregeln (höchstens 1 Anfrage pro Sekunde, App erkennbar,
// Ergebnisse zwischenspeichern) lassen sich an einer Stelle einhalten.
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'Manhunt/1.0 (Spielfeld-Suche)';

export function createGeocoder({ fetchImpl = fetch, minIntervalMs = 1000, cacheMs = 24 * 60 * 60 * 1000 } = {}) {
  const cache = new Map(); // suchbegriff -> { at, hits }
  let queue = Promise.resolve(); // Anfragen nacheinander, mit Abstand
  let lastCall = 0;

  async function ask(q) {
    const wait = lastCall + minIntervalMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    const url = new URL(NOMINATIM);
    url.searchParams.set('q', q);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '5');
    url.searchParams.set('accept-language', 'de');
    const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Nominatim antwortet mit ${res.status}`);
    const list = await res.json();
    return (Array.isArray(list) ? list : [])
      .map((x) => ({
        // "Neu-Ulm, Landkreis Neu-Ulm, Bayern, Deutschland" -> die ersten drei Teile reichen
        name: String(x.display_name ?? '').split(', ').slice(0, 3).join(', '),
        lat: Number(x.lat),
        lng: Number(x.lon),
      }))
      .filter((x) => x.name && Number.isFinite(x.lat) && Number.isFinite(x.lng))
      // gleicher Kurzname (z. B. Ort und gleichnamiger Bezirk): nur den besseren Treffer zeigen
      .filter((x, i, all) => all.findIndex((y) => y.name === x.name) === i);
  }

  return {
    // -> [{ name, lat, lng }] (höchstens 5, bester Treffer zuerst)
    async search(raw) {
      const q = String(raw ?? '').trim().slice(0, 100);
      if (!q) throw new Error('Suchbegriff ist leer.');
      const key = q.toLowerCase();
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < cacheMs) return hit.hits;
      const job = queue.then(() => ask(q));
      queue = job.catch(() => {}); // ein Fehler blockiert nicht die nächsten Suchen
      const hits = await job;
      cache.set(key, { at: Date.now(), hits });
      if (cache.size > 500) cache.delete(cache.keys().next().value);
      return hits;
    },
  };
}
