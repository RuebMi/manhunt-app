import express from 'express';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAccess, parseGuestPasswords } from './access.js';
import { Server } from 'socket.io';
import { Game, GameError, makeGameCode } from './game.js';
import { respondMission } from './missions.js';
import { createArchive } from './archive.js';
import { createLoginLog } from './logins.js';
import { createGeocoder } from './geocode.js';
import { createPlaceFinder } from './places.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA_FILE = process.env.DATA_FILE || path.join(ROOT, 'data', 'games.json');
const PORT = Number(process.env.PORT) || 3000;
// Testmodus: Position per Klick auf die Karte setzen. Nur lokal einschalten!
const ALLOW_SIM = process.env.ALLOW_SIM === '1';
const GAME_TTL_MS = 12 * 60 * 60 * 1000;
// Nur wer eines dieser Passwörter kennt, kann ein neues Spiel erstellen. Beitreten geht ohne.
// CREATE_PASSWORD (Hauptpasswort): alles, auch Crush, und alle bisherigen Spiele.
// GUEST_PASSWORDS (Gruppen, siehe server/access.js): Spiele ohne Crush, in "Bisherige Spiele"
// nur die Runden der eigenen Gruppe. Die Passwörter stehen nie im Code, sondern nur bei Render
// (Environment) und lokal in der Datei .env (Vorlage: .env.example).
const CREATE_PASSWORD = process.env.CREATE_PASSWORD || '';
if (!CREATE_PASSWORD) console.log('⚠️ Kein CREATE_PASSWORD gesetzt: Mit dem Hauptpasswort kann niemand ein Spiel erstellen.');
const access = createAccess({
  mainPassword: CREATE_PASSWORD,
  guestPasswords: parseGuestPasswords(process.env.GUEST_PASSWORDS),
});
const CREATE_FAIL_LIMIT = 5; // falsche Versuche pro Minute und Verbindung
// So heißt die Gruppe des Hauptpassworts in der App ("Gruppe Jugend Villingen"). Auf Render änderbar.
const MAIN_GROUP_NAME = process.env.MAIN_GROUP_NAME || 'Jugend Villingen';

const app = express();
app.set('trust proxy', 1);
// no-cache: Handys fragen immer kurz nach, ob es eine neue Version gibt.
app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'], setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));
app.get('/healthz', (_req, res) => res.send('ok'));

// Bisherige Spiele: nur mit dem Spielleiter-Passwort (Header X-Password) abrufbar.
const archiveFails = new Map(); // ip -> Zeitstempel der Fehlversuche in der letzten Minute
function requirePassword(req, res, next) {
  res.setHeader('Cache-Control', 'no-store');
  const now = Date.now();
  const fails = (archiveFails.get(req.ip) ?? []).filter((t) => now - t < 60_000);
  if (fails.length >= CREATE_FAIL_LIMIT) {
    archiveFails.set(req.ip, fails);
    return res.status(429).json({ error: 'Zu viele falsche Versuche. Warte eine Minute.' });
  }
  req.access = access.check(req.get('X-Password'));
  if (!req.access) {
    fails.push(now);
    archiveFails.set(req.ip, fails);
    return res.status(401).json({ error: 'Falsches Passwort.' });
  }
  next();
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, fails] of archiveFails) if (!fails.some((t) => now - t < 60_000)) archiveFails.delete(ip);
}, 60_000).unref();

const LOAD_ERROR = { error: 'Bisherige Spiele konnten nicht geladen werden.' };
// Hauptpasswort: alle Runden mit Gruppenname (null = Hauptpasswort).
// Gast-Passwort: nur Runden der eigenen Gruppe, ohne Gruppenname.
const visibleTo = (acc, round) => acc.kind === 'main' || (round.group ?? null) === acc.group;
const forViewer = (acc, round) => {
  const { group = null, ...rest } = round;
  return acc.kind === 'main' ? { ...rest, group } : rest;
};
app.get('/api/rounds', requirePassword, async (req, res) => {
  try {
    const rounds = await archive.list();
    res.json(rounds.filter((r) => visibleTo(req.access, r)).map((r) => forViewer(req.access, r)));
  } catch (e) {
    console.error('Bisherige Spiele: Liste fehlgeschlagen:', e.message);
    res.status(500).json(LOAD_ERROR);
  }
});
app.get('/api/rounds/:id', requirePassword, async (req, res) => {
  try {
    const data = await archive.get(req.params.id);
    if (!data || !visibleTo(req.access, data)) return res.status(404).json({ error: 'Runde nicht gefunden.' });
    res.json(forViewer(req.access, data));
  } catch (e) {
    console.error('Bisherige Spiele: Abruf fehlgeschlagen:', e.message);
    res.status(500).json(LOAD_ERROR);
  }
});

// Für die Push-Sperre (scripts/check-live.mjs): läuft gerade ein Spiel? Nur Zahlen, nur Hauptpasswort.
// Zu welcher Gruppe gehört das Passwort? Für die Begrüßung auf "Bisherige Spiele".
// Wird beim Öffnen von "Bisherige Spiele" abgefragt: zählt als Anmeldung für die Anmelde-Liste.
app.get('/api/access', requirePassword, (req, res) => {
  loginLog.record({ access: req.access, action: 'history', device: req.get('X-Device'), userAgent: req.get('User-Agent'), ip: req.ip });
  res.json({ group: req.access.kind === 'main' ? MAIN_GROUP_NAME : req.access.group, main: req.access.kind === 'main' });
});

app.get('/api/status', requirePassword, (req, res) => {
  if (req.access.kind !== 'main') return res.status(404).json({ error: 'Nicht gefunden.' });
  const running = [...games.values()].filter((g) => g.running);
  res.json({ running: running.length, players: running.reduce((n, g) => n + g.players.size, 0) });
});

// Anmelde-Liste (siehe server/logins.js): nur für das Hauptpasswort, Gruppen bekommen 404.
app.get('/api/logins', requirePassword, async (req, res) => {
  if (req.access.kind !== 'main') return res.status(404).json({ error: 'Nicht gefunden.' });
  try {
    res.json({ keepDays: loginLog.keepDays, entries: await loginLog.list() });
  } catch (e) {
    console.error('Anmelde-Liste: Abruf fehlgeschlagen:', e.message);
    res.status(500).json({ error: 'Die Anmelde-Liste konnte nicht geladen werden.' });
  }
});

// Runde löschen: nur mit dem Hauptpasswort (z. B. wenn ein Spieler die Löschung seiner Daten verlangt).
// Gruppen bekommen 404, damit nicht einmal verraten wird, ob es die Runde gibt.
app.delete('/api/rounds/:id', requirePassword, async (req, res) => {
  if (req.access.kind !== 'main') return res.status(404).json({ error: 'Runde nicht gefunden.' });
  try {
    if (!(await archive.remove(req.params.id))) return res.status(404).json({ error: 'Runde nicht gefunden.' });
    res.json({ ok: true });
  } catch (e) {
    console.error('Bisherige Spiele: Löschen fehlgeschlagen:', e.message);
    res.status(500).json({ error: 'Die Runde konnte nicht gelöscht werden.' });
  }
});

// Ortssuche für die Spielfeld-Auswahl (Schritt 2), siehe server/geocode.js.
// Pro Gerät höchstens 10 Suchen pro Minute.
const geocoder = createGeocoder();
const SEARCH_LIMIT = 10;
const searches = new Map(); // ip -> Zeitstempel der Suchen in der letzten Minute
setInterval(() => {
  const now = Date.now();
  for (const [ip, list] of searches) if (!list.some((t) => now - t < 60_000)) searches.delete(ip);
}, 60_000).unref();
app.get('/api/geocode', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (!q || q.length > 100) return res.status(400).json({ error: 'Bitte einen Ort eingeben.' });
  const now = Date.now();
  const recent = (searches.get(req.ip) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= SEARCH_LIMIT) return res.status(429).json({ error: 'Zu viele Suchen. Warte kurz.' });
  recent.push(now);
  searches.set(req.ip, recent);
  try {
    res.json(await geocoder.search(q));
  } catch (e) {
    console.error('Ortssuche fehlgeschlagen:', e.message);
    res.status(502).json({ error: 'Die Ortssuche ist gerade nicht erreichbar.' });
  }
});

// Vorschläge für Checkpoints (Missionen), siehe server/places.js. Zählt bei den 10 Suchen pro Minute mit.
const placeFinder = createPlaceFinder();
app.get('/api/places', async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const radius = Number(req.query.radius);
  const ok = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && radius >= 100 && radius <= 6000;
  if (!req.query.lat || !req.query.lng || !ok) return res.status(400).json({ error: 'Ungültiges Spielfeld.' });
  const now = Date.now();
  const recent = (searches.get(req.ip) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= SEARCH_LIMIT) return res.status(429).json({ error: 'Zu viele Suchen. Warte kurz.' });
  recent.push(now);
  searches.set(req.ip, recent);
  try {
    res.json(await placeFinder.find({ lat, lng, radius }));
  } catch (e) {
    console.error('Checkpoint-Vorschläge fehlgeschlagen:', e.message);
    res.status(502).json({ error: 'Vorschläge gerade nicht verfügbar.' });
  }
});

// Hintergrund-Ortung über die App OwnTracks (HTTP-Modus). Die App schickt
// Positionen auch bei gesperrtem Handy. Anmeldung per Basic-Auth mit
// Spieler-ID und geheimem Token aus dem Einrichtungslink.
app.post('/owntracks', express.json({ limit: '100kb', type: () => true }), (req, res) => {
  const [user, pass] = Buffer.from(String(req.headers.authorization ?? '').replace(/^Basic\s+/i, ''), 'base64')
    .toString()
    .split(':');
  const msg = req.body;
  if (msg?._type === 'location') {
    for (const game of games.values()) {
      const p = game.playerByToken(user, pass);
      if (!p) continue;
      game.updatePos(p.id, { lat: msg.lat, lng: msg.lon, acc: msg.acc, t: Number(msg.tst) * 1000, background: true });
      break;
    }
  }
  // Immer 200 + leere Liste: sonst speichert die App die Nachricht und schickt sie endlos erneut.
  res.json([]);
});
app.use((err, _req, res, next) => (err.type === 'entity.parse.failed' ? res.json([]) : next(err)));

const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10_000, pingTimeout: 20_000 });

const games = new Map();
let changedSinceSave = false;
const socketsByPlayer = new Map(); // playerId -> Set<Socket>

async function loadGames() {
  try {
    const list = JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
    for (const o of list) games.set(o.code, Game.fromJSON(o));
    console.log(`${games.size} Spiel(e) geladen.`);
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('Konnte Spielstände nicht laden:', e.message);
  }
}

let saving = false;
async function saveGames() {
  if (saving) return;
  saving = true;
  try {
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    const tmp = `${DATA_FILE}.tmp`;
    await fs.writeFile(tmp, JSON.stringify([...games.values()]));
    await fs.rename(tmp, DATA_FILE);
  } catch (e) {
    console.error('Konnte Spielstände nicht speichern:', e.message);
  } finally {
    saving = false;
  }
}

function socketsOf(playerId) {
  return socketsByPlayer.get(playerId) ?? new Set();
}

function attach(socket, game, player) {
  detach(socket);
  socket.data.code = game.code;
  socket.data.playerId = player.id;
  if (!socketsByPlayer.has(player.id)) socketsByPlayer.set(player.id, new Set());
  socketsByPlayer.get(player.id).add(socket);
  player.connected = true;
  game.touch();
  socket.emit('session', { code: game.code, playerId: player.id, token: player.token });
  socket.emit('chatHistory', game.chatFor(player));
}

function detach(socket) {
  const { code, playerId } = socket.data;
  if (!playerId) return;
  const set = socketsByPlayer.get(playerId);
  set?.delete(socket);
  if (!set?.size) {
    socketsByPlayer.delete(playerId);
    const game = games.get(code);
    const p = game?.players.get(playerId);
    if (p) {
      p.connected = false;
      game.touch();
    }
  }
  socket.data.code = null;
  socket.data.playerId = null;
}

function context(socket) {
  const game = games.get(socket.data.code);
  const player = game?.players.get(socket.data.playerId);
  if (!game || !player) throw new GameError('Du bist in keinem Spiel.');
  return { game, player };
}

function flush(game, now = Date.now()) {
  if (game.pendingArchive) {
    archive.save(game.pendingArchive);
    game.pendingArchive = null;
    changedSinceSave = true;
  }
  for (const ev of game.events.splice(0)) {
    for (const p of game.players.values()) {
      const hit =
        ev.to === 'all' ||
        ev.to === p.id ||
        (ev.to === 'hunter' && game.seesAsHunter(p)) ||
        (ev.to === 'hider' && p.role === 'hider' && p.status === 'alive');
      if (!hit) continue;
      for (const s of socketsOf(p.id)) s.emit('toast', { text: ev.text, kind: ev.kind ?? 'info', sound: ev.sound ?? null });
    }
  }
  if (!game.dirty) return;
  game.dirty = false;
  changedSinceSave = true;
  for (const p of game.players.values()) {
    const set = socketsOf(p.id);
    if (!set.size) continue;
    const view = game.view(p.id, now);
    view.allowSim = ALLOW_SIM;
    view.groupName = game.group ?? MAIN_GROUP_NAME; // sehen alle im Spiel
    for (const s of set) s.emit('state', view);
  }
}

function handle(socket, name, fn) {
  socket.on(name, (data, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    let touched = null;
    try {
      const result = fn(data ?? {}, (g) => (touched = g));
      reply({ ok: true, ...(result ?? {}) });
    } catch (e) {
      if (!(e instanceof GameError)) console.error(`Fehler bei "${name}":`, e);
      reply({ ok: false, error: e instanceof GameError ? e.message : 'Unerwarteter Serverfehler.' });
    }
    // Sofort senden statt auf den nächsten Tick zu warten – fühlt sich direkter an.
    const game = touched ?? games.get(socket.data.code);
    if (game) flush(game);
  });
}

// IP-Adresse wie bei Express mit "trust proxy 1": der letzte Eintrag, den der Proxy von Render anhängt.
function socketIp(socket) {
  const forwarded = String(socket.handshake.headers['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return forwarded.at(-1) ?? socket.handshake.address;
}

io.on('connection', (socket) => {
  socket.data = { code: null, playerId: null };

  let createFails = [];
  handle(socket, 'create', ({ name, password, device }, use) => {
    const now = Date.now();
    createFails = createFails.filter((t) => now - t < 60_000);
    if (createFails.length >= CREATE_FAIL_LIMIT) throw new GameError('Zu viele falsche Versuche. Warte eine Minute.');
    const acc = access.check(password);
    if (!acc) {
      createFails.push(now);
      throw new GameError('Falsches Passwort. Nur der Spielleiter kann ein Spiel erstellen.');
    }
    const game = new Game(makeGameCode(games));
    game.guest = acc.kind === 'guest';
    game.group = acc.kind === 'guest' ? acc.group : null;
    const player = game.addPlayer(name);
    games.set(game.code, game);
    attach(socket, game, player);
    use(game);
    console.log(`Spiel ${game.code} erstellt von ${player.name}`);
    loginLog.record({ access: acc, action: 'create', name: player.name, device, userAgent: socket.handshake.headers['user-agent'], ip: socketIp(socket) });
  });

  handle(socket, 'join', ({ code, name }, use) => {
    const game = games.get(String(code ?? '').trim().toUpperCase());
    if (!game) throw new GameError('Kein Spiel mit diesem Code gefunden.');
    const player = game.addPlayer(name);
    attach(socket, game, player);
    use(game);
  });

  handle(socket, 'resume', ({ code, playerId, token }, use) => {
    const game = games.get(String(code ?? '').toUpperCase());
    const player = game?.players.get(playerId);
    if (!game || !player || player.token !== token) throw new GameError('Spiel nicht mehr gefunden.');
    attach(socket, game, player);
    use(game);
  });

  handle(socket, 'leave', (_d, use) => {
    const { game, player } = context(socket);
    detach(socket);
    for (const s of socketsOf(player.id)) detach(s);
    game.removePlayer(player.id);
    game.emit('all', `${player.name} hat das Spiel verlassen.`);
    use(game);
  });

  let lastPos = 0;
  socket.on('pos', (data) => {
    const now = Date.now();
    if (now - lastPos < 1000) return;
    lastPos = now;
    try {
      const { game, player } = context(socket);
      // age = wie alt die Messung auf dem Handy ist. So zählt eine nur erneut
      // gesendete, alte Position nicht als frisch (Handy-GPS kann still hängen).
      const age = Math.min(10 * 60_000, Math.max(0, Number(data?.age) || 0));
      game.updatePos(player.id, { lat: data?.lat, lng: data?.lng, acc: data?.acc, t: now - age });
    } catch {
      /* nicht im Spiel – ignorieren */
    }
  });

  handle(socket, 'settings', (data) => {
    const { game, player } = context(socket);
    game.updateSettings(player.id, data);
  });

  handle(socket, 'setRole', ({ playerId, role }) => {
    const { game, player } = context(socket);
    game.setRole(player.id, playerId, role);
  });

  handle(socket, 'randomize', ({ hunters, avoidLast }) => {
    const { game, player } = context(socket);
    game.randomizeRoles(player.id, hunters, { avoidLast: Boolean(avoidLast) });
  });

  handle(socket, 'crush', ({ a, b }) => {
    const { game, player } = context(socket);
    game.setCrush(player.id, a ?? null, b ?? null);
  });

  handle(socket, 'kick', ({ playerId }) => {
    const { game, player } = context(socket);
    const targets = [...socketsOf(playerId)];
    game.kick(player.id, playerId);
    for (const s of targets) {
      s.emit('kicked');
      detach(s);
    }
  });

  handle(socket, 'start', () => {
    const { game, player } = context(socket);
    game.start(player.id);
  });

  handle(socket, 'end', () => {
    const { game, player } = context(socket);
    game.forceEnd(player.id);
  });

  handle(socket, 'lobby', () => {
    const { game, player } = context(socket);
    game.backToLobby(player.id);
  });

  handle(socket, 'catch', ({ code }) => {
    const { game, player } = context(socket);
    return game.catchHider(player.id, code);
  });

  handle(socket, 'dispute', ({ hiderId }) => {
    const { game, player } = context(socket);
    return game.reportDispute(player.id, hiderId);
  });

  handle(socket, 'resolveDispute', ({ id, accept }) => {
    const { game, player } = context(socket);
    return game.resolveDispute(player.id, id, Boolean(accept));
  });

  handle(socket, 'mission', ({ id, accept }) => {
    const { game, player } = context(socket);
    return respondMission(game, player.id, String(id ?? ''), Boolean(accept), Date.now());
  });

  handle(socket, 'joker', ({ type }) => {
    const { game, player } = context(socket);
    return game.useJoker(player.id, type);
  });

  handle(socket, 'chat', ({ channel, text }) => {
    const { game, player } = context(socket);
    const msg = game.addChat(player.id, channel, text);
    for (const p of game.players.values()) {
      if (!game.chatChannels(p).includes(msg.channel)) continue;
      for (const s of socketsOf(p.id)) s.emit('chat', msg);
    }
  });

  handle(socket, 'chatHistory', () => {
    const { game, player } = context(socket);
    socket.emit('chatHistory', game.chatFor(player));
  });

  handle(socket, 'trails', () => {
    const { game } = context(socket);
    return game.trails();
  });

  socket.on('disconnect', () => {
    const game = games.get(socket.data.code);
    detach(socket);
    if (game) flush(game);
  });
});

// Erst laden, dann die Timer starten: sonst läuft flush() evtl. vor der Archiv-Initialisierung.
await loadGames();
const archiveFile = process.env.ARCHIVE_FILE || path.join(ROOT, 'data', 'archive.json');
const archive = await createArchive({ databaseUrl: process.env.DATABASE_URL, file: archiveFile });
if (archive.kind === 'file') console.log(`⚠️ Keine DATABASE_URL: bisherige Spiele werden nur lokal in ${archiveFile} gespeichert.`);
else console.log('Bisherige Spiele werden in der Datenbank gespeichert.');
const loginLog = await createLoginLog({
  databaseUrl: process.env.DATABASE_URL,
  file: process.env.LOGINS_FILE || path.join(path.dirname(archiveFile), 'logins.json'),
});

setInterval(() => {
  const now = Date.now();
  for (const game of games.values()) {
    game.tick(now);
    flush(game, now);
    const anyoneOnline = [...game.players.values()].some((p) => p.connected);
    if (!anyoneOnline && now - game.lastActivity > GAME_TTL_MS) games.delete(game.code);
  }
}, 1000);

setInterval(() => {
  if (!changedSinceSave) return;
  changedSinceSave = false;
  saveGames();
}, 5000);

server.listen(PORT, () => {
  console.log(`Manhunt läuft auf http://localhost:${PORT}${ALLOW_SIM ? '  (Testmodus an)' : ''}`);
});
