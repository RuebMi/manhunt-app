// Speicher für "Bisherige Spiele": Postgres (z. B. Neon) wenn databaseUrl gesetzt, sonst JSON-Datei.
import fs from 'node:fs/promises';
import path from 'node:path';

const byNewest = (a, b) => b.endedAt - a.endedAt;

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
  return {
    kind: 'file',
    insert(record) {
      const run = chain.then(async () => {
        const all = await read();
        if (all.some((r) => r.summary.id === record.summary.id)) return;
        all.push(record);
        await fs.mkdir(path.dirname(file), { recursive: true });
        const tmp = `${file}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(all));
        await fs.rename(tmp, file);
      });
      chain = run.catch(() => {});
      return run;
    },
    async list() {
      await chain;
      return (await read()).map((r) => r.summary).sort(byNewest);
    },
    async get(id) {
      await chain;
      return (await read()).find((r) => r.summary.id === id)?.data ?? null;
    },
    remove(id) {
      const run = chain.then(async () => {
        const all = await read();
        const rest = all.filter((r) => r.summary.id !== id);
        if (rest.length === all.length) return false;
        const tmp = `${file}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(rest));
        await fs.rename(tmp, file);
        return true;
      });
      chain = run.catch(() => {});
      return run;
    },
    async close() {
      await chain;
    },
  };
}

async function postgresBackend(databaseUrl) {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 10_000, query_timeout: 15_000 });
  // Neon schließt ruhende Verbindungen; ohne Listener würde das den Prozess beenden.
  pool.on('error', (e) => console.error('Archiv: Pool-Fehler', e));
  // Tabelle erst bei der ersten Nutzung anlegen; bei Fehler beim nächsten Mal erneut versuchen.
  let ready = null;
  const ensureTable = () => {
    ready ??= pool
      .query(
        `create table if not exists rounds (
           id text primary key,
           ended_at timestamptz not null,
           summary jsonb not null,
           data jsonb not null
         )`,
      )
      .catch((e) => {
        ready = null;
        throw e;
      });
    return ready;
  };
  return {
    kind: 'postgres',
    async insert({ summary, data }) {
      await ensureTable();
      await pool.query(
        'insert into rounds (id, ended_at, summary, data) values ($1, to_timestamp($2 / 1000.0), $3, $4) on conflict (id) do nothing',
        [summary.id, summary.endedAt, JSON.stringify(summary), JSON.stringify(data)],
      );
    },
    async list() {
      await ensureTable();
      const { rows } = await pool.query('select summary from rounds order by ended_at desc');
      return rows.map((r) => r.summary);
    },
    async get(id) {
      await ensureTable();
      const { rows } = await pool.query('select data from rounds where id = $1', [id]);
      return rows[0]?.data ?? null;
    },
    async remove(id) {
      await ensureTable();
      const { rowCount } = await pool.query('delete from rounds where id = $1', [id]);
      return rowCount > 0;
    },
    async close() {
      await pool.end();
    },
  };
}

export async function createArchive({ databaseUrl, file, retryMs = 60_000, maxRetries = 60 }) {
  const backend = databaseUrl ? await postgresBackend(databaseUrl) : fileBackend(file);
  const queue = new Set(); // noch nicht gespeicherte Datensätze
  const timers = new Set();
  let closed = false;

  function attempt(entry) {
    backend.insert(entry.record).then(
      () => queue.delete(entry),
      (err) => {
        if (closed) return;
        if (entry.retries >= maxRetries) {
          queue.delete(entry);
          console.error(`Archiv: Runde ${entry.record?.summary?.id} konnte nicht gespeichert werden`, err);
          return;
        }
        entry.retries++;
        const t = setTimeout(() => {
          timers.delete(t);
          attempt(entry);
        }, retryMs);
        t.unref();
        timers.add(t);
      },
    );
  }

  return {
    kind: backend.kind,
    save(record) {
      try {
        const entry = { record, retries: 0 };
        queue.add(entry);
        attempt(entry);
      } catch (err) {
        console.error('Archiv: save fehlgeschlagen', err);
      }
    },
    list: () => backend.list(),
    get: (id) => backend.get(id),
    // Runde endgültig löschen -> true, wenn es sie gab
    remove: (id) => backend.remove(id),
    pending: () => queue.size,
    async close() {
      closed = true;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      await backend.close();
    },
  };
}
