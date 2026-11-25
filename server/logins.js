// Anmelde-Liste: Wer hat sich wann mit welchem Spielleiter-Passwort angemeldet
// (Spiel erstellt oder "Bisherige Spiele" geöffnet)? Sehen kann sie nur das Hauptpasswort.
// Gespeichert werden: Zeit, Passwort (Hauptpasswort oder Gruppenname), was gemacht wurde,
// der Name (nur beim Erstellen), die Geräte-Nummer (zufällig, von der App auf dem Handy erzeugt),
// die Art des Geräts (aus der Browser-Kennung) und die gekürzte IP-Adresse.
// Einträge werden nach keepDays Tagen automatisch gelöscht.
// Postgres (Tabelle "logins") wenn databaseUrl gesetzt, sonst JSON-Datei.
import fs from 'node:fs/promises';
import path from 'node:path';

const DAY = 24 * 60 * 60 * 1000;

// IP-Adresse kürzen: bei IPv4 fällt der letzte Teil weg, bei IPv6 bleiben die ersten drei Blöcke.
// So sieht man noch Anbieter und ungefähre Gegend, aber nicht mehr den einzelnen Anschluss.
export function shortIp(ip) {
  const s = String(ip ?? '').trim().replace(/^::ffff:/i, '');
  if (!s) return null;
  if (s === '::1' || s.startsWith('127.')) return 'lokal';
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return `${s.split('.').slice(0, 3).join('.')}.x`;
  if (s.includes(':')) return `${s.split(':').slice(0, 3).join(':')}:…`;
  return null;
}

// Browser-Kennung -> "iPhone · Safari". Mehr (z. B. das genaue Modell) verraten Handys heute nicht.
export function deviceName(ua) {
  const s = String(ua ?? '');
  const os = /iPhone/.test(s)
    ? 'iPhone'
    : /iPad/.test(s)
      ? 'iPad'
      : /Android/.test(s)
        ? 'Android'
        : /Windows/.test(s)
          ? 'Windows'
          : /Macintosh|Mac OS X/.test(s)
            ? 'Mac'
            : /CrOS/.test(s)
              ? 'Chromebook'
              : /Linux/.test(s)
                ? 'Linux'
                : null;
  const browser = /SamsungBrowser/.test(s)
    ? 'Samsung Internet'
    : /EdgA?\/|EdgiOS/.test(s)
      ? 'Edge'
      : /OPR\/|OPiOS/.test(s)
        ? 'Opera'
        : /Firefox\/|FxiOS/.test(s)
          ? 'Firefox'
          : /Chrome\/|CriOS/.test(s)
            ? 'Chrome'
            : /Safari\//.test(s)
              ? 'Safari'
              : null;
  return [os, browser].filter(Boolean).join(' · ') || 'Unbekanntes Gerät';
}

// Geräte-Nummer von der App: nur Buchstaben, Ziffern und Bindestriche, sonst verwerfen
export const cleanDevice = (id) => (typeof id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(id) ? id : null);

function fileBackend(file) {
  let chain = Promise.resolve(); // Schreibvorgänge nacheinander
  const read = async () => {
    try {
      return JSON.parse(await fs.readFile(file, 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') return [];
      throw e;
    }
  };
  const write = async (all) => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(all));
    await fs.rename(tmp, file);
  };
  const queue = (fn) => {
    const run = chain.then(fn);
    chain = run.catch(() => {});
    return run;
  };
  return {
    add: (entry) => queue(async () => write([...(await read()), entry])),
    async list(since) {
      await chain;
      return (await read()).filter((e) => e.at >= since).sort((a, b) => b.at - a.at);
    },
    prune: (before) =>
      queue(async () => {
        const all = await read();
        const rest = all.filter((e) => e.at >= before);
        if (rest.length !== all.length) await write(rest);
      }),
    async close() {
      await chain;
    },
  };
}

async function postgresBackend(databaseUrl) {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 10_000, query_timeout: 15_000 });
  pool.on('error', (e) => console.error('Anmelde-Liste: Pool-Fehler', e));
  let ready = null;
  const ensureTable = () => {
    ready ??= pool
      .query(
        `create table if not exists logins (
           id bigserial primary key,
           at timestamptz not null,
           entry jsonb not null
         )`,
      )
      .catch((e) => {
        ready = null;
        throw e;
      });
    return ready;
  };
  return {
    async add(entry) {
      await ensureTable();
      await pool.query('insert into logins (at, entry) values (to_timestamp($1 / 1000.0), $2)', [entry.at, JSON.stringify(entry)]);
    },
    async list(since) {
      await ensureTable();
      const { rows } = await pool.query('select entry from logins where at >= to_timestamp($1 / 1000.0) order by at desc', [since]);
      return rows.map((r) => r.entry);
    },
    async prune(before) {
      await ensureTable();
      await pool.query('delete from logins where at < to_timestamp($1 / 1000.0)', [before]);
    },
    async close() {
      await pool.end();
    },
  };
}

export async function createLoginLog({ databaseUrl, file, keepDays = 30, repeatMs = 30 * 60_000, now = Date.now }) {
  const backend = databaseUrl ? await postgresBackend(databaseUrl) : fileBackend(file);
  // Dasselbe Gerät mit demselben Passwort und derselben Aktion nur alle repeatMs neu notieren
  // (sonst landet jedes Zurück zur Liste in "Bisherige Spiele" als eigener Eintrag).
  const lastSeen = new Map();
  const prune = () =>
    backend.prune(now() - keepDays * DAY).catch((e) => console.error('Anmelde-Liste: Aufräumen fehlgeschlagen:', e.message));
  prune();
  const timer = setInterval(() => {
    prune();
    for (const [k, t] of lastSeen) if (now() - t >= repeatMs) lastSeen.delete(k);
  }, 60 * 60_000);
  timer.unref();

  return {
    keepDays,
    // Fehler werden nur protokolliert: Die Anmeldung selbst darf daran nie scheitern.
    async record({ access, action, name = null, device, userAgent, ip }) {
      const entry = {
        at: now(),
        group: access.kind === 'guest' ? access.group : null, // null = Hauptpasswort
        action, // 'create' | 'history'
        name: name ? String(name).slice(0, 40) : null,
        device: cleanDevice(device),
        deviceName: deviceName(userAgent),
        ip: shortIp(ip),
      };
      const key = [entry.device ?? `${entry.ip}|${entry.deviceName}`, entry.group, action, entry.name].join('|');
      if (now() - (lastSeen.get(key) ?? -Infinity) < repeatMs) return;
      lastSeen.set(key, entry.at);
      try {
        await backend.add(entry);
      } catch (e) {
        console.error('Anmelde-Liste: Speichern fehlgeschlagen:', e.message);
      }
    },
    list: () => backend.list(now() - keepDays * DAY),
    async close() {
      clearInterval(timer);
      await backend.close();
    },
  };
}
