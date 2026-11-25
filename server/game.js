import crypto from 'node:crypto';

const MIN = 60_000;
const STALE_MS = 2 * MIN;      // ohne GPS-Update so lange -> "Signal verloren"
const BACKGROUND_ACTIVE_MS = 5 * MIN; // so lange gilt die Hintergrund-Ortung als aktiv
const RADAR_MS = 30_000;
const DRONE_MS = 60_000;
const TRAIL_EVERY_MS = 15_000; // Abstand der Punkte für die Routen-Auswertung
const CATCH_FAIL_LIMIT = 5;    // falsche Codes pro Minute
const DISPUTE_MS = 2 * MIN;    // so lange hat der Spielleiter Zeit, einen Streitfall zu entscheiden
const SHIELD_MS = 2 * MIN;     // Schutzschild: so lange nicht fangbar (aber live sichtbar)
const SPOTLIGHT_MS = 30_000;   // Scheinwerfer: so lange sind die entdeckten Hider live sichtbar
const SPOTLIGHT_RANGE = 300;   // Scheinwerfer: Umkreis in Metern
export const CATCH_RULES = ['touch', 'arm']; // Abklatschen oder Armlänge
export const MAX_PLAYERS = 40;

export const JOKERS = {
  cloak: { side: 'hider', name: 'Tarnkappe', icon: '👻', desc: 'Du tauchst im nächsten Ping nicht auf.' },
  decoy: { side: 'hider', name: 'Doppelgänger', icon: '🎭', desc: 'Der nächste Ping zeigt dich 300–600 m neben deinem echten Standort.' },
  radar: { side: 'hider', name: 'Radar', icon: '📡', desc: 'Du siehst 30 Sekunden lang alle Jäger live. (Die Jäger merken es!)' },
  extraPing: { side: 'hunter', name: 'Sonder-Ping', icon: '🛰️', desc: 'Sofort einen zusätzlichen Ping aller Hider auslösen.' },
  drone: { side: 'hunter', name: 'Drohne', icon: '🚁', desc: 'Ein zufälliger Hider wird 60 Sekunden lang live verfolgt.' },
  sniff: { side: 'hunter', name: 'Spürnase', icon: '🐕', desc: 'Zeigt dir, wie weit der nächste Hider von dir entfernt ist.' },
  // Pokal-Joker: gibt es nie zufällig, nur als Belohnung aus der letzten Runde (siehe end())
  shield: { side: 'hider', trophy: true, name: 'Schutzschild', icon: '🛡️', desc: '2 Minuten lang kann dich niemand fangen. Aber alle Jäger sehen dich so lange live!' },
  spotlight: { side: 'hunter', trophy: true, name: 'Scheinwerfer', icon: '🔦', desc: 'Alle Hider im Umkreis von 300 m um dich sind 30 Sekunden lang für alle Jäger live sichtbar.' },
};
const HIDER_JOKERS = Object.keys(JOKERS).filter((k) => JOKERS[k].side === 'hider' && !JOKERS[k].trophy);
const HUNTER_JOKERS = Object.keys(JOKERS).filter((k) => JOKERS[k].side === 'hunter' && !JOKERS[k].trophy);

// Special Events: unvorhersehbare Überraschungen während der Jagd
export const EVENTS = {
  jokerRain: { icon: '🌧️', name: 'Joker-Regen', desc: 'Jeder freie Hider bekommt einen Joker, die Jäger bekommen einen Team-Joker.' },
  fever: { icon: '🔥', name: 'Jagdfieber', desc: '10 Minuten lang kommen die Pings doppelt so oft.' },
  fog: { icon: '🌫️', name: 'Nebel', desc: 'Beim nächsten Ping sehen die Jäger nur einen groben Kreis statt eines genauen Punkts.' },
  bounty: { icon: '💰', name: 'Kopfgeld', desc: 'Ein Hider ist 2 Minuten live sichtbar. Wer durchhält, bekommt einen Joker – sonst bekommen die Jäger einen.' },
  swap: { icon: '🔄', name: 'Rollentausch', desc: 'Ein Jäger wird zum Hider – mit 2 Minuten Schutz zum Weglaufen.' },
};
export const EVENT_MODES = ['off', 'rare', 'often'];
// Mitte der Endzone: wie die Startzone, zufällig (jede Stufe liegt in der vorherigen)
// oder vom Spielleiter auf der Karte gesetzt (darf überall liegen).
export const FINAL_MODES = ['same', 'random', 'custom'];
const FEVER_MS = 10 * MIN;
const BOUNTY_MS = 2 * MIN;
const PROTECT_MS = 2 * MIN;
const FOG_RADIUS = 100; // Kreis mit 200 m Durchmesser

export const DEFAULT_SETTINGS = {
  durationMin: 60,
  headStartMin: 5,
  pingIntervalMin: 5,
  zone: { lat: 48.0603, lng: 8.4586, radius: 1200 }, // Villingen Innenstadt
  shrink: true,           // Zone wird in Stufen kleiner
  shrinkSteps: 3,         // Anzahl der Stufen, gleichmäßig über die Jagd verteilt
  finalRadius: 600,       // Radius der Endzone in Metern (höchstens so groß wie die Startzone)
  shrinkWarnMin: 1,       // so lange vorher wird die neue Zone schon angezeigt
  finalMode: 'same',      // Mitte der Endzone, siehe FINAL_MODES
  finalCenter: null,      // nur bei 'custom': vom Spielleiter gesetzte Mitte (geheim)
  outGraceSec: 30,        // so lange darf man außerhalb sein, bevor man live geortet wird
  hidersSeeEachOther: true,
  infection: false,       // Gefangene werden zu Jägern
  catchRule: 'touch',     // wann jemand als gefangen gilt (siehe CATCH_RULES)
  eventsMode: 'off',      // Special Events: off | rare | often
  hiderJokers: 2,
  hunterExtraPings: 2,
  hunterDrones: 1,
  hunterSniffs: 3,
  // Spannung
  pingTrail: 3,           // Jäger sehen die letzten N Pings jedes Hiders als Spur (0 = aus)
  pingSpeedup: true,      // mit jeder Zonenstufe kommen die Pings schneller, höchstens doppelt so oft
  finaleSec: 90,          // in den letzten N Sekunden sind alle freien Hider live sichtbar (0 = aus)
  comebackAt: 2,          // sind nur noch N Hider frei, bekommt jeder einmal Tarnkappe oder Doppelgänger (0 = aus)
};

export class GameError extends Error {}

// Runden unter dieser Dauer landen nicht in "Bisherige Spiele".
const archiveMinMinutes = process.env.ARCHIVE_MIN_MINUTES?.trim() ? Number(process.env.ARCHIVE_MIN_MINUTES) : NaN;
export const ARCHIVE_MIN_MS = (Number.isFinite(archiveMinMinutes) && archiveMinMinutes >= 0 ? archiveMinMinutes : 20) * 60_000;
const ARCHIVE_STEP_M = 10; // Route fürs Archiv: Punkte näher als 10 m werden weggelassen

// Strecke einer Route in Metern. Sprünge schneller als 8 m/s (Auto, GPS-Ausreißer) zählen nicht.
// Gleiche Logik wie trailDistance in public/app.js.
export function trailDistanceM(trail) {
  let d = 0;
  for (let i = 1; i < trail.length; i++) {
    const [lat1, lng1, t1] = trail[i - 1];
    const [lat2, lng2, t2] = trail[i];
    const seg = distanceM({ lat: lat1, lng: lng1 }, { lat: lat2, lng: lng2 });
    if (seg / Math.max(1, (t2 - t1) / 1000) <= 8) d += seg;
  }
  return Math.round(d);
}

// Route fürs Archiv: Punkte unter 10 m Abstand weg, Koordinaten auf 5 Stellen (~1 m),
// Zeit in Sekunden seit Rundenstart. Der letzte Punkt wird immer angehängt.
export function simplifyTrail(trail, startedAt) {
  const kept = [];
  for (const [lat, lng, t] of trail) {
    const pt = { lat, lng, t };
    if (!kept.length || distanceM(kept.at(-1), pt) >= ARCHIVE_STEP_M) kept.push(pt);
  }
  // Endpunkt immer anhängen (die 10-m-Regel gilt nicht für das letzte Stück)
  if (trail.length) {
    const [lat, lng, t] = trail.at(-1);
    if (kept.at(-1).t !== t || kept.at(-1).lat !== lat || kept.at(-1).lng !== lng) kept.push({ lat, lng, t });
  }
  return kept.map((p) => [Number(p.lat.toFixed(5)), Number(p.lng.toFixed(5)), Math.round((p.t - startedAt) / 1000)]);
}

const round1 = (n) => Math.round(n * 10) / 10;

const fmtMinutes = (ms) => `${String(Math.round((ms / MIN) * 10) / 10).replace('.', ',')} min`;
const minutes = (n) => `${n} ${n === 1 ? 'Minute' : 'Minuten'}`;

export function distanceM(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function offsetPos(pos, meters, bearing) {
  const dLat = (meters * Math.cos(bearing)) / 111320;
  const dLng = (meters * Math.sin(bearing)) / (111320 * Math.cos((pos.lat * Math.PI) / 180));
  return { lat: pos.lat + dLat, lng: pos.lng + dLng };
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const clampNum = (v, min, max, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

export function sanitizeSettings(input = {}, current = DEFAULT_SETTINGS) {
  const s = structuredClone(current);
  const int = (key, min, max) => {
    if (input[key] !== undefined) s[key] = Math.round(clampNum(input[key], min, max, s[key]));
  };
  const bool = (key) => {
    if (input[key] !== undefined) s[key] = Boolean(input[key]);
  };
  int('durationMin', 5, 240);
  int('headStartMin', 0, 30);
  int('pingIntervalMin', 1, 30);
  int('shrinkSteps', 1, 6);
  int('shrinkWarnMin', 0, 10);
  int('outGraceSec', 0, 300);
  int('hiderJokers', 0, HIDER_JOKERS.length);
  int('hunterExtraPings', 0, 10);
  int('hunterDrones', 0, 10);
  int('hunterSniffs', 0, 10);
  int('pingTrail', 0, 4);
  int('finaleSec', 0, 300);
  int('comebackAt', 0, 5);
  if (CATCH_RULES.includes(input.catchRule)) s.catchRule = input.catchRule;
  if (EVENT_MODES.includes(input.eventsMode)) s.eventsMode = input.eventsMode;
  bool('shrink');
  bool('hidersSeeEachOther');
  bool('infection');
  bool('pingSpeedup');
  const oldRadius = s.zone.radius;
  if (input.zone) {
    s.zone = {
      lat: clampNum(input.zone.lat, -90, 90, s.zone.lat),
      lng: clampNum(input.zone.lng, -180, 180, s.zone.lng),
      radius: Math.round(clampNum(input.zone.radius, 100, 15000, s.zone.radius)),
    };
  }

  // Endzone: Größe in Metern. Ändert sich nur die Startzone, wächst/schrumpft sie im gleichen Verhältnis mit.
  if (input.finalRadius !== undefined) s.finalRadius = clampNum(input.finalRadius, 0, 15000, s.finalRadius);
  else if (input.shrinkFinalPct !== undefined) s.finalRadius = (s.zone.radius * clampNum(input.shrinkFinalPct, 0, 100, 50)) / 100; // alte Clients/Spielstände
  else if (s.finalRadius == null) s.finalRadius = s.zone.radius / 2;
  else s.finalRadius *= s.zone.radius / oldRadius;
  s.finalRadius = Math.round(Math.min(s.zone.radius, Math.max(Math.min(100, s.zone.radius), s.finalRadius)));
  delete s.shrinkFinalPct;

  if (FINAL_MODES.includes(input.finalMode)) s.finalMode = input.finalMode;
  else if (input.shrinkMove !== undefined) s.finalMode = input.shrinkMove ? 'random' : 'same'; // alte Spielstände
  if (!FINAL_MODES.includes(s.finalMode)) s.finalMode = 'same';
  delete s.shrinkMove;
  if (input.finalCenter) {
    s.finalCenter = {
      lat: clampNum(input.finalCenter.lat, -90, 90, s.zone.lat),
      lng: clampNum(input.finalCenter.lng, -180, 180, s.zone.lng),
    };
  }
  if (s.finalMode === 'custom' && !s.finalCenter) s.finalCenter = { lat: s.zone.lat, lng: s.zone.lng };
  return s;
}

// Die Zone wird in Stufen kleiner, gleichmäßig über die Jagd verteilt:
// 60 min und 3 Stufen -> bei Minute 15, 30 und 45. Radius (und bei eigener
// Endzone auch die Mitte) wandern gleichmäßig von der Start- zur Endzone.
// Gleiche Formeln stehen für die Vorschau in der Lobby auch in public/app.js.
export function planZoneStages(settings, huntStartAt, endAt, rand = Math.random) {
  if (!settings.shrink || settings.shrinkSteps < 1) return [];
  const { zone, shrinkSteps: n, finalRadius, shrinkWarnMin, finalMode, finalCenter } = settings;
  const stages = [];
  let prev = zone;
  for (let k = 1; k <= n; k++) {
    const at = Math.round(huntStartAt + ((endAt - huntStartAt) * k) / (n + 1));
    const radius = Math.round(zone.radius + ((finalRadius - zone.radius) * k) / n);
    let center = { lat: prev.lat, lng: prev.lng };
    if (finalMode === 'custom' && finalCenter) {
      center = { lat: zone.lat + ((finalCenter.lat - zone.lat) * k) / n, lng: zone.lng + ((finalCenter.lng - zone.lng) * k) / n };
    } else if (finalMode === 'random') {
      // Neue Mitte so wählen, dass der neue Kreis komplett im alten liegt.
      const maxShift = Math.max(0, prev.radius - radius);
      center = offsetPos(prev, maxShift * Math.sqrt(rand()), rand() * 2 * Math.PI);
    }
    const stage = {
      k,
      at,
      warnAt: Math.max(huntStartAt, at - shrinkWarnMin * MIN),
      lat: center.lat,
      lng: center.lng,
      radius,
      warned: false,
      applied: false,
    };
    stages.push(stage);
    prev = stage;
  }
  return stages;
}

// Wie viele Events: "Selten" etwa 2, "Oft" etwa 4 pro Stunde, höchstens 5.
// Abstand zwischen zwei Pings in ms. Mit "pingSpeedup" wird er mit jeder angewandten
// Zonenstufe kürzer, bis höchstens auf die Hälfte (aufgerundet auf ganze Minuten):
// 5 min -> 3 min, 4 min -> 2 min. Ohne Zonenstufen bleibt er gleich.
export function pingIntervalMs(settings, stagesDone, stagesTotal) {
  const base = settings.pingIntervalMin * MIN;
  if (!settings.pingSpeedup || !stagesTotal) return base;
  const min = Math.ceil(settings.pingIntervalMin / 2) * MIN;
  return Math.round(base - ((base - min) * Math.min(stagesDone, stagesTotal)) / stagesTotal);
}

export function eventCount(settings) {
  if (!EVENT_MODES.includes(settings.eventsMode) || settings.eventsMode === 'off') return 0;
  const perHour = settings.eventsMode === 'often' ? 4 : 2;
  return Math.max(1, Math.min(5, Math.round((settings.durationMin / 60) * perHour)));
}

// Zufällige Zeitpunkte: frühestens 10 min nach Jagdbeginn, spätestens 5 min vor
// Schluss (bei kurzen Spielen anteilig), mit Abstand zwischen den Events.
export function planEvents(settings, huntStartAt, endAt, rand = Math.random) {
  const n = eventCount(settings);
  if (!n) return [];
  const dur = endAt - huntStartAt;
  const from = huntStartAt + Math.min(10 * MIN, dur * 0.2);
  const to = endAt - Math.min(5 * MIN, dur * 0.1);
  const slot = (to - from) / n;
  const gap = Math.min(6 * MIN, slot * 0.8); // bei kurzen Spielen fast gleichmäßig verteilt
  const types = shuffle(Object.keys(EVENTS)).slice(0, n);
  return types.map((type, i) => ({ type, at: Math.round(from + slot * i + rand() * (slot - gap)), done: false }));
}

export function makeGameCode(taken) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (;;) {
    let code = '';
    for (let i = 0; i < 4; i++) code += chars[crypto.randomInt(chars.length)];
    if (!taken.has(code)) return code;
  }
}

export class Game {
  constructor(code) {
    this.code = code;
    this.createdAt = Date.now();
    this.lastActivity = Date.now();
    this.phase = 'lobby'; // lobby | headstart | hunt | ended
    this.settings = structuredClone(DEFAULT_SETTINGS);
    this.players = new Map();
    this.hostId = null;
    this.round = 0;
    this.timers = null;
    this.lastPing = null;
    this.pings = [];
    this.zoneStages = [];
    this.hunterPool = {};
    this.drone = null;
    this.result = null;
    this.chat = [];
    this.events = [];
    this.catchFails = new Map();
    this.disputes = [];
    this.eventPlan = []; // geplante Special Events (nicht verwechseln mit this.events = Meldungen)
    this.lastEvent = null;
    this.feverUntil = 0;
    this.fogNext = false;
    this.bounty = null;
    this.crush = null; // [id, id]: geheimes Paar, das sich immer sieht und nicht fangen kann
    this.guest = false; // mit einem Gast-Passwort erstellt: ohne Crush
    this.group = null; // Name des Gast-Passworts (null = Hauptpasswort), für "Bisherige Spiele"
    this.lastHunters = []; // Jäger der zuletzt gestarteten Runde (für "Andere Jäger als letzte Runde")
    this.roundLog = []; // Joker und Events der laufenden Runde, fürs Archiv
    this.pendingArchive = null; // Datensatz der beendeten Runde, wartet aufs Speichern
    this.dirty = true;
  }

  toJSON() {
    const { events, catchFails, dirty, players, ...rest } = this;
    return { ...rest, players: [...players.values()] };
  }

  static fromJSON(o) {
    const g = new Game(o.code);
    const { players, ...rest } = o;
    Object.assign(g, rest);
    g.settings = sanitizeSettings(o.settings ?? {}, { ...DEFAULT_SETTINGS, zone: o.settings?.zone ?? DEFAULT_SETTINGS.zone, finalRadius: null });
    g.players = new Map(players.map((p) => [p.id, { ...p, connected: false }]));
    g.roundLog ??= [];
    // Vor den Gruppen gab es nur ein Gast-Passwort, das heißt jetzt REHE.
    if (g.guest && !g.group) g.group = 'REHE';
    return g;
  }

  emit(to, text, opts = {}) {
    this.events.push({ to, text, ...opts });
  }

  touch() {
    this.dirty = true;
    this.lastActivity = Date.now();
  }

  get running() {
    return this.phase === 'headstart' || this.phase === 'hunt';
  }

  player(id) {
    const p = this.players.get(id);
    if (!p) throw new GameError('Spieler nicht gefunden.');
    return p;
  }

  requireHost(id) {
    if (id !== this.hostId) throw new GameError('Nur der Spielleiter kann das.');
  }

  requireLobby() {
    if (this.phase !== 'lobby') throw new GameError('Das geht nur in der Lobby.');
  }

  aliveHiders() {
    return [...this.players.values()].filter((p) => p.role === 'hider' && p.status === 'alive');
  }

  // Wer darf wie ein Jäger sehen? Jäger und gefangene Hider (Zuschauer).
  seesAsHunter(p) {
    return p.role === 'hunter' || p.status === 'caught';
  }

  addPlayer(rawName) {
    const name = String(rawName ?? '').trim().replace(/\s+/g, ' ').slice(0, 20);
    if (!name) throw new GameError('Bitte gib einen Namen ein.');
    if (this.players.size >= MAX_PLAYERS) throw new GameError(`Das Spiel ist voll (max. ${MAX_PLAYERS}).`);
    if (this.phase === 'ended') throw new GameError('Diese Runde ist schon vorbei. Warte, bis der Spielleiter eine neue startet.');
    for (const p of this.players.values()) {
      if (p.name.toLowerCase() === name.toLowerCase()) throw new GameError('Dieser Name ist schon vergeben.');
    }
    const p = {
      id: crypto.randomUUID(),
      token: crypto.randomBytes(16).toString('hex'),
      name,
      role: this.running ? 'hunter' : 'hider', // wer mitten im Spiel dazukommt, jagt mit
      startRole: null,
      status: 'alive',
      catchCode: null,
      jokers: [],
      pos: null,
      trail: [],
      connected: false,
      joinedAt: Date.now(),
    };
    p.startRole = p.role;
    this.players.set(p.id, p);
    if (!this.hostId) this.hostId = p.id;
    if (this.running) this.emit('all', `${name} ist als Jäger eingestiegen.`);
    this.touch();
    return p;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    if (this.crush?.includes(id)) this.crush = null;
    this.disputes = (this.disputes ?? []).filter((d) => d.hunterId !== id && d.hiderId !== id);
    if (this.hostId === id) {
      const next = [...this.players.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0];
      this.hostId = next?.id ?? null;
      if (next) this.emit('all', `${next.name} ist jetzt Spielleiter.`);
    }
    if (this.drone?.targetId === id) this.drone = null;
    if (this.phase === 'hunt' && p.role === 'hider' && this.aliveHiders().length === 0) {
      this.end('hunters', 'Es sind keine Hider mehr im Spiel.');
    }
    this.touch();
  }

  updateSettings(id, input) {
    this.requireHost(id);
    this.requireLobby();
    this.settings = sanitizeSettings(input, this.settings);
    this.touch();
  }

  setRole(id, targetId, role) {
    this.requireHost(id);
    this.requireLobby();
    if (role !== 'hunter' && role !== 'hider') throw new GameError('Unbekannte Rolle.');
    const t = this.player(targetId);
    t.role = role;
    t.startRole = role;
    this.touch();
  }

  // avoidLast: möglichst niemand wird Jäger, der in der letzten Runde Jäger war.
  randomizeRoles(id, hunterCount, { avoidLast = false } = {}) {
    this.requireHost(id);
    this.requireLobby();
    const last = new Set(avoidLast ? (this.lastHunters ?? []) : []);
    const all = shuffle([...this.players.values()]);
    const list = [...all.filter((p) => !last.has(p.id)), ...all.filter((p) => last.has(p.id))];
    const n = Math.round(clampNum(hunterCount, 1, Math.max(1, list.length - 1), 1));
    list.forEach((p, i) => {
      p.role = i < n ? 'hunter' : 'hider';
      p.startRole = p.role;
    });
    this.emit(
      'all',
      avoidLast
        ? `🔄 Neue Jäger ausgelost (möglichst nicht dieselben wie letzte Runde): ${n} Jäger, ${list.length - n} Hider.`
        : `🎲 Rollen wurden zufällig verteilt: ${n} Jäger, ${list.length - n} Hider.`,
    );
    this.touch();
  }

  // Crush: der Spielleiter wählt (optional) zwei Spieler. Ohne a/b wird das Paar entfernt.
  setCrush(id, a, b) {
    this.requireHost(id);
    if (this.guest) throw new GameError('Den Crush gibt es in diesem Spiel nicht.');
    this.requireLobby();
    if (!a && !b) {
      this.crush = null;
      this.touch();
      return;
    }
    if (a === b) throw new GameError('Wähle zwei verschiedene Spieler.');
    this.player(a);
    this.player(b);
    this.crush = [a, b];
    this.touch();
  }

  crushPartner(id) {
    if (!this.crush?.includes(id)) return null;
    return this.players.get(this.crush[0] === id ? this.crush[1] : this.crush[0]) ?? null;
  }

  isCrush(a, b) {
    return Boolean(this.crush?.includes(a) && this.crush.includes(b) && a !== b);
  }

  kick(id, targetId) {
    this.requireHost(id);
    if (id === targetId) throw new GameError('Du kannst dich nicht selbst entfernen.');
    const t = this.player(targetId);
    this.removePlayer(targetId);
    this.emit('all', `${t.name} wurde aus dem Spiel entfernt.`);
  }

  start(id) {
    this.requireHost(id);
    this.requireLobby();
    const all = [...this.players.values()];
    const hiders = all.filter((p) => p.role === 'hider');
    if (!all.some((p) => p.role === 'hunter')) throw new GameError('Es braucht mindestens einen Jäger.');
    if (!hiders.length) throw new GameError('Es braucht mindestens einen Hider.');

    const now = Date.now();
    const s = this.settings;
    this.round += 1;
    this.timers = {
      startedAt: now,
      huntStartAt: now + s.headStartMin * MIN,
      endAt: now + (s.headStartMin + s.durationMin) * MIN,
      nextPingAt: now + s.headStartMin * MIN,
    };

    const codes = shuffle([...Array(9000).keys()]).slice(0, hiders.length).map((n) => String(n + 1000));
    for (const p of all) {
      Object.assign(p, {
        startRole: p.role,
        status: 'alive',
        caughtAt: null,
        caughtBy: null,
        caughtById: null,
        catchCode: p.role === 'hider' ? codes.pop() : null,
        // Pokal aus der letzten Runde -> Pokal-Joker passend zur neuen Rolle
        jokers: [
          ...(p.role === 'hider' ? shuffle(HIDER_JOKERS).slice(0, s.hiderJokers) : []),
          ...(p.trophy ? [p.role === 'hider' ? 'shield' : 'spotlight'] : []),
        ],
        trophy: null,
        shieldUntil: 0,
        spotUntil: 0,
        trail: p.pos ? [[p.pos.lat, p.pos.lng, now]] : [],
        outSince: null,
        exposed: false,
        signalLost: false,
        cloakNext: false,
        decoyNext: false,
        radarUntil: 0,
      });
    }
    this.hunterPool = { extraPing: s.hunterExtraPings, drone: s.hunterDrones, sniff: s.hunterSniffs };
    this.lastHunters = all.filter((p) => p.role === 'hunter').map((p) => p.id);
    this.startHiderCount = all.filter((p) => p.role === 'hider').length;
    this.finaleOn = false;
    this.comebackGiven = false;
    this.zoneStages = planZoneStages(s, this.timers.huntStartAt, this.timers.endAt);
    this.eventPlan = planEvents(s, this.timers.huntStartAt, this.timers.endAt);
    this.lastEvent = null;
    this.feverUntil = 0;
    this.fogNext = false;
    this.bounty = null;
    for (const p of all) p.protectedUntil = 0;
    this.drone = null;
    this.lastPing = null;
    this.pings = [];
    this.result = null;
    this.roundLog = [];
    this.pendingArchive = null;
    this.catchFails.clear();
    this.disputes = [];

    for (const id of this.crush ?? []) {
      const partner = this.crushPartner(id);
      if (partner) {
        this.emit(id, `💘 Crush! Du siehst ${partner.name} die ganze Runde auf der Karte, und ihr könnt euch nicht gegenseitig fangen. Psst, das ist geheim!`, {
          kind: 'warn',
        });
      }
    }
    for (const p of all) {
      const t = p.jokers.find((j) => JOKERS[j].trophy);
      if (t) this.emit(p.id, `🏆 Dein Pokal aus der letzten Runde: Du hast einen ${JOKERS[t].icon} ${JOKERS[t].name}!`);
    }

    if (s.headStartMin > 0) {
      this.phase = 'headstart';
      this.emit('hider', `🏃 Lauf! Du hast ${minutes(s.headStartMin)} Vorsprung.`, { sound: 'start' });
      this.emit('hunter', `⏳ Die Hider haben ${minutes(s.headStartMin)} Vorsprung. Bleibt am Startpunkt!`, { sound: 'start' });
    } else {
      this.phase = 'hunt';
      this.emit('all', '🚨 Die Jagd beginnt!', { sound: 'start' });
    }
    this.touch();
  }

  forceEnd(id) {
    this.requireHost(id);
    if (!this.running) throw new GameError('Es läuft gerade keine Runde.');
    this.end(null, 'Der Spielleiter hat die Runde beendet.');
  }

  end(winner, reason) {
    const now = Date.now();
    this.phase = 'ended';
    this.disputes = [];
    for (const p of this.players.values()) {
      if (p.pos) p.trail.push([p.pos.lat, p.pos.lng, now]);
    }
    this.result = {
      winner,
      reason,
      at: now,
      survivors: this.aliveHiders().map((p) => p.name),
      trophies: winner ? this.awardTrophies(winner) : [],
    };
    try {
      this.pendingArchive = now - this.timers.startedAt >= ARCHIVE_MIN_MS ? this.archiveRecord(now) : null;
    } catch (e) {
      console.error('Archiv: Datensatz konnte nicht erstellt werden', e);
      this.pendingArchive = null;
    }
    const msg =
      winner === 'hunters' ? '🏆 Die Jäger haben gewonnen!' : winner === 'hiders' ? '🏆 Die Hider haben gewonnen!' : '🏁 Runde beendet.';
    this.emit('all', `${msg} ${reason}`, { sound: 'end' });
    this.touch();
  }

  // Datensatz der Runde fürs Archiv. Enthält bewusst keine IDs, Fangcodes oder Crush-Paare.
  archiveRecord(now) {
    const { startedAt, huntStartAt } = this.timers;
    const s = this.settings;
    const all = [...this.players.values()];
    const summary = {
      id: `${this.code}-${this.round}-${startedAt}`,
      code: this.code,
      round: this.round,
      startedAt,
      endedAt: now,
      durationMin: Math.round((now - startedAt) / MIN),
      winner: this.result.winner,
      reason: this.result.reason,
      playerCount: all.length,
      hunterCount: all.filter((p) => p.startRole === 'hunter').length,
      hiderCount: all.filter((p) => p.startRole === 'hider').length,
      group: this.group ?? null,
    };
    const trophyById = new Map(this.result.trophies.map((t) => [t.id, t.why]));
    const atMin = (at) => round1(Math.max(0, at - startedAt) / MIN);
    const log = this.roundLog ?? [];
    return {
      summary,
      data: {
        ...summary,
        settings: {
          durationMin: s.durationMin,
          headStartMin: s.headStartMin,
          pingIntervalMin: s.pingIntervalMin,
          outGraceSec: s.outGraceSec,
          zone: s.zone,
          shrink: s.shrink,
          shrinkSteps: s.shrinkSteps,
          finalRadius: s.finalRadius,
          finalMode: s.finalMode,
          finalCenter: s.finalCenter,
          catchRule: s.catchRule,
          eventsMode: s.eventsMode,
          infection: s.infection,
          hiderJokers: s.hiderJokers,
          hunterExtraPings: s.hunterExtraPings,
          hunterDrones: s.hunterDrones,
          hunterSniffs: s.hunterSniffs,
        },
        players: all.map((p) => ({
          name: p.name,
          startRole: p.startRole,
          endRole: p.role,
          status: p.status,
          caughtBy: p.caughtBy ?? null,
          caughtAfterMin: p.caughtAt ? round1(Math.max(0, p.caughtAt - huntStartAt) / MIN) : null,
          distanceM: trailDistanceM(p.trail ?? []),
          trophy: trophyById.get(p.id) ?? null,
        })),
        jokersUsed: log.filter((e) => e.kind === 'joker').map((e) => ({ name: e.name, type: e.type, atMin: atMin(e.at) })),
        events: log.filter((e) => e.kind === 'event').map((e) => ({ type: e.type, atMin: atMin(e.at) })),
        trophies: this.result.trophies.map((t) => ({ name: t.name, why: t.why })),
        trails: Object.fromEntries(all.map((p) => [p.name, simplifyTrail(p.trail ?? [], startedAt)])),
      },
    };
  }

  // Pokal für die nächste Runde in dieser Lobby: wer am meisten gefangen hat
  // (bei Gleichstand alle) und der Hider, der als Einziger übrig bleibt und gewinnt.
  awardTrophies(winner) {
    const counts = new Map();
    for (const p of this.players.values()) {
      if (p.status === 'caught' && p.caughtById) counts.set(p.caughtById, (counts.get(p.caughtById) ?? 0) + 1);
    }
    const best = Math.max(0, ...counts.values());
    const won = new Map();
    if (best > 0) for (const [id, n] of counts) if (n === best) won.set(id, 'hunter');
    const alive = this.aliveHiders();
    if (winner === 'hiders' && alive.length === 1) won.set(alive[0].id, 'hider');
    const out = [];
    for (const [id, why] of won) {
      const p = this.players.get(id);
      if (!p) continue;
      p.trophy = { round: this.round, why };
      out.push({ id, name: p.name, why });
      this.emit(id, why === 'hider'
        ? '🏆 Du hast als Einzige(r) überlebt! Dafür bekommst du in der nächsten Runde einen Pokal-Joker.'
        : `🏆 Du hast am meisten gefangen (${best})! Dafür bekommst du in der nächsten Runde einen Pokal-Joker.`);
    }
    return out;
  }

  backToLobby(id) {
    this.requireHost(id);
    if (this.running) throw new GameError('Beende zuerst die laufende Runde.');
    this.phase = 'lobby';
    this.finaleOn = false;
    this.comebackGiven = false;
    this.eventPlan = [];
    this.lastEvent = null;
    this.bounty = null;
    this.feverUntil = 0;
    this.fogNext = false;
    this.timers = null;
    this.lastPing = null;
    this.drone = null;
    this.zoneStages = [];
    for (const p of this.players.values()) {
      p.role = p.startRole ?? p.role;
      p.status = 'alive';
      p.catchCode = null;
      p.jokers = [];
    }
    this.emit('all', 'Zurück in der Lobby. Der Spielleiter bereitet die nächste Runde vor.');
    this.touch();
  }

  currentZone(now = Date.now()) {
    let z = this.settings.zone;
    for (const st of this.zoneStages ?? []) if (now >= st.at) z = st;
    return { lat: z.lat, lng: z.lng, radius: z.radius };
  }

  // Die angekündigte nächste Zone (sichtbar ab warnAt bis sie gilt)
  nextZone(now = Date.now()) {
    const st = (this.zoneStages ?? []).find((x) => now < x.at && now >= x.warnAt);
    return st ? { lat: st.lat, lng: st.lng, radius: st.radius, at: st.at, k: st.k } : null;
  }

  // data.t: Zeitpunkt der Messung (z. B. von OwnTracks, das bei schlechtem
  // Netz auch ältere Positionen nachliefert). Ohne t gilt "jetzt".
  // data.background: Position kam aus der Hintergrund-App (OwnTracks).
  updatePos(id, data) {
    const p = this.player(id);
    const lat = Number(data?.lat);
    const lng = Number(data?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
    const now = Date.now();
    const t = Number.isFinite(Number(data.t)) && data.t ? Math.min(now, Number(data.t)) : now;
    if (data.background) p.bgAt = now;
    if (p.pos && t < p.pos.t) return; // nachgelieferte, ältere Position
    p.pos = { lat, lng, acc: Math.round(clampNum(data.acc, 0, 10000, 0)), t };
    if (this.running) {
      const last = p.trail.at(-1);
      if (!last || t - last[2] >= TRAIL_EVERY_MS) p.trail.push([lat, lng, t]);
    }
    this.dirty = true;
  }

  // Für die Hintergrund-Ortung: Spieler über ID und geheimen Token finden
  playerByToken(id, token) {
    const p = this.players.get(id);
    return p && token && p.token === token ? p : null;
  }

  tick(now = Date.now()) {
    if (this.phase === 'headstart' && now >= this.timers.huntStartAt) {
      this.phase = 'hunt';
      this.emit('all', '🚨 Die Jagd beginnt! Die Jäger dürfen los.', { sound: 'start' });
      this.touch();
    }
    if (!this.running) return;
    const hunt = this.phase === 'hunt';
    const s = this.settings;

    if (hunt) {
      const total = this.zoneStages?.length ?? 0;
      for (const st of this.zoneStages ?? []) {
        if (!st.warned && now >= st.warnAt && now < st.at) {
          st.warned = true;
          const mins = Math.max(1, Math.round((st.at - now) / MIN));
          this.emit('all', `🟡 Die Zone wird in ${minutes(mins)} kleiner! Die neue Zone ist gelb markiert.`, { sound: 'warn' });
          this.touch();
        }
        if (!st.applied && now >= st.at) {
          st.applied = st.warned = true;
          const tail = st.k === total ? ' Das ist die letzte Stufe.' : ` (Stufe ${st.k} von ${total})`;
          const iv = pingIntervalMs(s, st.k, total);
          const faster = s.pingSpeedup && iv < s.pingIntervalMin * MIN ? ` Pings jetzt alle ${fmtMinutes(iv)}.` : '';
          this.emit('all', `🔴 Die Zone ist jetzt kleiner: ${st.radius} m Radius.${tail}${faster}`, { sound: 'warn' });
          this.touch();
        }
      }
    }
    const zone = this.currentZone(now);

    for (const p of this.aliveHiders()) {
      const outside = p.pos ? distanceM(p.pos, zone) > zone.radius : false;
      if (outside) {
        if (p.outSince == null) {
          p.outSince = now;
          this.emit(p.id, `⚠️ Du bist außerhalb der Zone! Du hast ${s.outGraceSec} s, sonst wirst du live geortet.`, {
            kind: 'warn',
            sound: 'warn',
          });
          this.dirty = true;
        }
        if (hunt && !p.exposed && !(p.protectedUntil > now) && now - p.outSince >= s.outGraceSec * 1000) {
          p.exposed = true;
          this.emit('hunter', `📍 ${p.name} ist außerhalb der Zone und wird live geortet!`, { sound: 'ping' });
          this.emit(p.id, '🔴 Du wirst jetzt live geortet, bis du zurück in der Zone bist!', { kind: 'warn', sound: 'warn' });
          this.dirty = true;
        }
      } else if (p.outSince != null) {
        p.outSince = null;
        if (p.exposed) this.emit('hunter', `${p.name} ist zurück in der Zone.`);
        p.exposed = false;
        this.emit(p.id, '✅ Du bist zurück in der Zone.');
        this.dirty = true;
      }

      if (hunt) {
        const stale = !p.pos || now - p.pos.t > STALE_MS;
        if (stale && !p.signalLost) {
          p.signalLost = true;
          this.emit('all', `📵 ${p.name} sendet kein GPS mehr – den Jägern wird der letzte Standort gezeigt.`);
          this.emit(p.id, '📵 Dein Handy sendet keinen Standort! Lass die App offen und den Bildschirm an.', {
            kind: 'warn',
            sound: 'warn',
          });
          this.dirty = true;
        } else if (!stale && p.signalLost) {
          p.signalLost = false;
          this.dirty = true;
        }
      }
      if (p.radarUntil && now > p.radarUntil) {
        p.radarUntil = 0;
        this.dirty = true;
      }
    }

    if (this.drone && now > this.drone.until) {
      this.drone = null;
      this.emit('hunter', '🚁 Die Drohne ist gelandet.');
      this.dirty = true;
    }

    for (const d of [...(this.disputes ?? [])]) {
      if (now <= d.until) continue;
      this.disputes = this.disputes.filter((x) => x !== d);
      const hider = this.players.get(d.hiderId);
      for (const id of [d.hunterId, d.hiderId]) {
        this.emit(id, `⚖️ Keine Entscheidung zum Streitfall – ${hider?.name ?? 'der Hider'} spielt weiter.`);
      }
      this.dirty = true;
    }

    if (hunt) {
      for (const e of this.eventPlan ?? []) {
        if (!e.done && now >= e.at) {
          e.done = true;
          this.runEvent(e.type, now);
        }
      }
      if (this.bounty && now > this.bounty.until) {
        const t = this.players.get(this.bounty.targetId);
        this.bounty = null;
        if (t?.status === 'alive' && t.role === 'hider') {
          const j = shuffle(HIDER_JOKERS)[0];
          t.jokers.push(j);
          this.emit('all', `💰 ${t.name} hat das Kopfgeld überlebt und bekommt einen Joker!`);
        }
        this.touch();
      }
      for (const p of this.players.values()) {
        if (p.protectedUntil && now > p.protectedUntil) {
          p.protectedUntil = 0;
          this.emit(p.id, '🛡️ Dein Schutz ist vorbei – ab jetzt kannst du gefangen werden.', { kind: 'warn', sound: 'warn' });
          this.emit('hunter', `🛡️ ${p.name} ist nicht mehr geschützt und kann gefangen werden.`);
          this.touch();
        }
      }
    }

    for (const p of this.players.values()) {
      if (p.shieldUntil && now > p.shieldUntil) {
        p.shieldUntil = 0;
        if (p.role === 'hider' && p.status === 'alive') {
          this.emit(p.id, '🛡️ Dein Schutzschild ist vorbei – ab jetzt kannst du gefangen werden.', { kind: 'warn', sound: 'warn' });
          this.emit('hunter', `🛡️ ${p.name} hat keinen Schutzschild mehr und ist nicht mehr live sichtbar.`);
        }
        this.touch();
      }
      if (p.spotUntil && now > p.spotUntil) {
        p.spotUntil = 0;
        this.touch();
      }
    }

    if (hunt && now >= this.timers.nextPingAt) {
      this.ping(now);
      const stages = this.zoneStages ?? [];
      const iv = pingIntervalMs(s, stages.filter((st) => st.applied).length, stages.length) * (this.feverUntil > now ? 0.5 : 1);
      while (this.timers.nextPingAt <= now) this.timers.nextPingAt += iv;
    }

    // Ausgleich: sind nur noch wenige Hider frei, bekommt jeder einmal Tarnkappe oder Doppelgänger
    if (hunt && s.comebackAt > 0 && !this.comebackGiven && (this.startHiderCount ?? 0) > s.comebackAt) {
      const alive = this.aliveHiders();
      if (alive.length > 0 && alive.length <= s.comebackAt) {
        this.comebackGiven = true;
        for (const p of alive) {
          const j = crypto.randomInt(2) === 0 ? 'cloak' : 'decoy';
          p.jokers.push(j);
          this.emit(p.id, `🎁 Nur noch ${alive.length} Hider frei: Du bekommst ${JOKERS[j].icon} ${JOKERS[j].name}!`, { sound: 'event' });
        }
        this.emit('all', `🎁 Nur noch ${alive.length} Hider frei – sie bekommen je einen Bonus-Joker.`);
        this.touch();
      }
    }

    // Finale: in den letzten Sekunden sind alle freien Hider live sichtbar
    if (hunt && s.finaleSec > 0 && !this.finaleOn && now >= this.timers.endAt - s.finaleSec * 1000) {
      this.finaleOn = true;
      this.emit('all', '🔥 Finale! Bis zum Schluss sind alle Hider live sichtbar.', { kind: 'warn', sound: 'warn' });
      this.touch();
    }

    if (hunt && now >= this.timers.endAt) {
      this.end('hiders', 'Die Zeit ist abgelaufen!');
    }
  }

  ping(now, byName = null) {
    const entries = [];
    const fog = this.fogNext;
    this.fogNext = false;
    for (const p of this.aliveHiders()) {
      if (p.protectedUntil > now) {
        entries.push({ id: p.id, protected: true });
        this.emit(p.id, '🛡️ Ping! Du bist noch geschützt – die Jäger sehen dich nicht.', { sound: 'ping' });
        continue;
      }
      if (p.cloakNext) {
        p.cloakNext = false;
        entries.push({ id: p.id, cloaked: true });
        this.emit(p.id, '👻 Ping! Dank Tarnkappe haben die Jäger dich nicht gesehen.', { sound: 'ping' });
        continue;
      }
      if (!p.pos) {
        entries.push({ id: p.id, none: true });
        continue;
      }
      let { lat, lng } = p.pos;
      if (p.decoyNext) {
        p.decoyNext = false;
        ({ lat, lng } = offsetPos(p.pos, 300 + Math.random() * 300, Math.random() * 2 * Math.PI));
        this.emit(p.id, '🎭 Ping! Die Jäger sehen deinen Doppelgänger.', { sound: 'ping' });
      } else {
        this.emit(p.id, '🛰️ Ping! Dein Standort wurde an die Jäger gesendet.', { sound: 'ping' });
      }
      if (fog) {
        // Kreis um einen verschobenen Mittelpunkt – der Hider ist irgendwo darin
        ({ lat, lng } = offsetPos({ lat, lng }, Math.random() * FOG_RADIUS * 0.8, Math.random() * 2 * Math.PI));
        entries.push({ id: p.id, lat, lng, t: p.pos.t, fog: FOG_RADIUS });
        continue;
      }
      entries.push({ id: p.id, lat, lng, t: p.pos.t });
    }
    this.lastPing = { at: now, byName, entries };
    this.pings.push(this.lastPing);
    this.emit('hunter', byName ? `🛰️ Sonder-Ping von ${byName}! Neue Standorte.` : '🛰️ Ping! Neue Standorte der Hider.', {
      sound: 'ping',
    });
    this.touch();
  }

  catchHider(id, rawCode) {
    const me = this.player(id);
    if (me.role !== 'hunter') throw new GameError('Nur Jäger können fangen.');
    if (this.phase !== 'hunt') throw new GameError('Fangen geht erst, wenn die Jagd läuft.');
    const now = Date.now();
    const fails = (this.catchFails.get(id) ?? []).filter((t) => now - t < MIN);
    if (fails.length >= CATCH_FAIL_LIMIT) throw new GameError('Zu viele falsche Codes. Warte eine Minute.');
    const code = String(rawCode ?? '').replace(/\D/g, '');
    const target = this.aliveHiders().find((p) => p.catchCode === code);
    if (target?.protectedUntil > now) throw new GameError(`${target.name} ist noch geschützt (Rollentausch).`);
    if (target?.shieldUntil > now) throw new GameError(`${target.name} hat gerade einen Schutzschild und kann nicht gefangen werden.`);
    if (target && this.isCrush(id, target.id)) throw new GameError(`💘 ${target.name} ist dein Crush – den kannst du nicht fangen.`);
    if (!target) {
      fails.push(now);
      this.catchFails.set(id, fails);
      throw new GameError(`Falscher Code. (${CATCH_FAIL_LIMIT - fails.length} Versuche übrig)`);
    }
    this.markCaught(me, target, now);
    return { name: target.name };
  }

  markCaught(me, target, now, viaReferee = false) {
    target.status = 'caught';
    target.caughtAt = now;
    target.caughtBy = me.name;
    target.caughtById = me.id;
    target.exposed = false;
    target.outSince = null;
    if (this.drone?.targetId === target.id) this.drone = null;
    if (this.bounty?.targetId === target.id) {
      this.bounty = null;
      const j = shuffle(HUNTER_JOKERS)[0];
      this.hunterPool[j] = (this.hunterPool[j] ?? 0) + 1;
      this.emit('hunter', `💰 Kopfgeld kassiert! Ihr bekommt einen ${JOKERS[j].icon} ${JOKERS[j].name}.`);
    }
    this.disputes = (this.disputes ?? []).filter((d) => d.hiderId !== target.id);
    this.emit('all', `🎯 ${me.name} hat ${target.name} gefangen!${viaReferee ? ' (Entscheidung des Spielleiters)' : ''}`, { sound: 'catch' });
    if (this.settings.infection) {
      target.role = 'hunter';
      this.emit(target.id, '🔄 Du wurdest gefangen und jagst jetzt mit den Jägern!', { kind: 'warn' });
    } else {
      this.emit(target.id, '😵 Du wurdest gefangen. Du kannst jetzt zuschauen.', { kind: 'warn' });
    }
    if (this.aliveHiders().length === 0) this.end('hunters', 'Alle Hider wurden gefangen!');
    this.touch();
  }

  // Hider gibt den Code nicht her: der Jäger meldet einen Streitfall, der
  // Spielleiter entscheidet. Der GPS-Abstand ist nur ein Hinweis.
  reportDispute(id, hiderId) {
    const me = this.player(id);
    if (me.role !== 'hunter') throw new GameError('Nur Jäger können einen Streitfall melden.');
    if (this.phase !== 'hunt') throw new GameError('Streitfälle gibt es erst, wenn die Jagd läuft.');
    const hider = this.players.get(hiderId);
    if (!hider || hider.role !== 'hider' || hider.status !== 'alive') throw new GameError('Dieser Spieler ist kein freier Hider.');
    if (hider.protectedUntil > Date.now()) throw new GameError(`${hider.name} ist noch geschützt (Rollentausch).`);
    if (hider.shieldUntil > Date.now()) throw new GameError(`${hider.name} hat gerade einen Schutzschild und kann nicht gefangen werden.`);
    if (this.isCrush(id, hiderId)) throw new GameError(`💘 ${hider.name} ist dein Crush – den kannst du nicht fangen.`);
    if (this.disputes.some((d) => d.hiderId === hiderId)) throw new GameError(`Zu ${hider.name} läuft schon ein Streitfall.`);
    if (this.disputes.some((d) => d.hunterId === id)) throw new GameError('Du hast schon einen offenen Streitfall.');
    const now = Date.now();
    const distance = me.pos && hider.pos ? Math.round(distanceM(me.pos, hider.pos) / 5) * 5 : null;
    const d = { id: crypto.randomUUID(), hunterId: id, hiderId, at: now, until: now + DISPUTE_MS, distance };
    this.disputes.push(d);
    const host = this.players.get(this.hostId);
    this.emit(this.hostId, `⚖️ Streitfall: ${me.name} meldet ${hider.name} als gefangen. Bitte entscheiden!`, { kind: 'warn', sound: 'warn' });
    this.emit(hiderId, `⚖️ ${me.name} meldet dich als gefangen. Bleib kurz stehen – ${host?.name ?? 'der Spielleiter'} entscheidet.`, {
      kind: 'warn',
      sound: 'warn',
    });
    if (id !== this.hostId) this.emit(id, `⚖️ Streitfall gemeldet. Bleibt kurz stehen – ${host?.name ?? 'der Spielleiter'} entscheidet.`);
    this.touch();
    return {};
  }

  resolveDispute(id, disputeId, accept) {
    this.requireHost(id);
    const d = this.disputes.find((x) => x.id === disputeId);
    if (!d) throw new GameError('Dieser Streitfall ist schon erledigt.');
    this.disputes = this.disputes.filter((x) => x !== d);
    const hunter = this.players.get(d.hunterId);
    const hider = this.players.get(d.hiderId);
    if (accept && hunter && hider?.status === 'alive' && this.phase === 'hunt') {
      this.markCaught(hunter, hider, Date.now(), true);
    } else {
      for (const pid of [d.hunterId, d.hiderId]) {
        this.emit(pid, `⚖️ Entscheidung: nicht gefangen – ${hider?.name ?? 'der Hider'} spielt weiter.`);
      }
      this.touch();
    }
    return {};
  }

  canRunEvent(type, now) {
    const hunters = [...this.players.values()].filter((p) => p.role === 'hunter');
    if (type === 'swap') return hunters.length >= 2;
    if (type === 'bounty') return !this.bounty && this.aliveHiders().some((p) => p.pos && !(p.protectedUntil > now));
    if (type === 'fever') return !(this.feverUntil > now);
    if (type === 'fog') return !this.fogNext;
    return true;
  }

  runEvent(type, now = Date.now()) {
    if (!this.canRunEvent(type, now)) {
      // passt gerade nicht (z. B. nur ein Jäger): ein anderes, noch unbenutztes Event nehmen
      const used = new Set((this.eventPlan ?? []).map((e) => e.type));
      const alt = shuffle(Object.keys(EVENTS)).find((t) => !used.has(t) && this.canRunEvent(t, now));
      if (!alt) return;
      type = alt;
    }
    const ev = EVENTS[type];
    let detail = '';
    if (type === 'jokerRain') {
      for (const p of this.aliveHiders()) p.jokers.push(shuffle(HIDER_JOKERS)[0]);
      const j = shuffle(HUNTER_JOKERS)[0];
      this.hunterPool[j] = (this.hunterPool[j] ?? 0) + 1;
      detail = `Die Jäger bekommen ${JOKERS[j].icon} ${JOKERS[j].name}.`;
    } else if (type === 'fever') {
      this.feverUntil = now + FEVER_MS;
      this.timers.nextPingAt = Math.min(this.timers.nextPingAt, now + 30_000);
      detail = 'Der nächste Ping kommt in 30 Sekunden.';
    } else if (type === 'fog') {
      this.fogNext = true;
    } else if (type === 'bounty') {
      const candidates = this.aliveHiders().filter((p) => p.pos && !(p.protectedUntil > now));
      const t = candidates[crypto.randomInt(candidates.length)];
      this.bounty = { targetId: t.id, until: now + BOUNTY_MS };
      detail = `Kopfgeld auf ${t.name}!`;
    } else if (type === 'swap') {
      const hunters = [...this.players.values()].filter((p) => p.role === 'hunter');
      const p = hunters[crypto.randomInt(hunters.length)];
      const used = new Set([...this.players.values()].map((x) => x.catchCode).filter(Boolean));
      let code;
      do code = String(1000 + crypto.randomInt(9000));
      while (used.has(code));
      Object.assign(p, {
        role: 'hider',
        status: 'alive',
        catchCode: code,
        jokers: [shuffle(HIDER_JOKERS)[0]],
        protectedUntil: now + PROTECT_MS,
        outSince: null,
        exposed: false,
        signalLost: false,
        cloakNext: false,
        decoyNext: false,
        radarUntil: 0,
      });
      detail = `${p.name} ist jetzt Hider und 2 Minuten geschützt.`;
      this.emit(p.id, '🔄 Du bist jetzt HIDER! Du hast 2 Minuten Schutz – lauf los!', { kind: 'warn', sound: 'start' });
    }
    this.lastEvent = { type, at: now, detail };
    this.roundLog.push({ kind: 'event', type, at: now });
    this.emit('all', `${ev.icon} ${ev.name}! ${detail || ev.desc}`, { sound: 'event' });
    this.touch();
  }

  useJoker(id, type) {
    const res = this.applyJoker(id, type);
    this.roundLog.push({ kind: 'joker', name: this.player(id).name, type, at: Date.now() });
    return res;
  }

  applyJoker(id, type) {
    const me = this.player(id);
    const j = JOKERS[type];
    if (!j) throw new GameError('Unbekannter Joker.');
    const now = Date.now();

    if (j.side === 'hider') {
      if (me.role !== 'hider' || me.status !== 'alive') throw new GameError('Nur Hider im Spiel können diesen Joker nutzen.');
      if (!this.running) throw new GameError('Die Runde läuft nicht.');
      const idx = me.jokers.indexOf(type);
      if (idx < 0) throw new GameError('Diesen Joker hast du nicht.');
      if ((type === 'cloak' || type === 'decoy') && (me.cloakNext || me.decoyNext)) {
        throw new GameError('Für den nächsten Ping ist schon ein Joker aktiv.');
      }
      if (type === 'shield' && this.phase !== 'hunt') throw new GameError('Der Schutzschild geht erst, wenn die Jagd läuft.');
      me.jokers.splice(idx, 1);
      if (type === 'shield') {
        me.shieldUntil = now + SHIELD_MS;
        this.emit(id, '🛡️ Schutzschild an: 2 Minuten kann dich niemand fangen – aber alle Jäger sehen dich live!', { sound: 'start' });
        this.emit('hunter', `🛡️ ${me.name} hat einen Schutzschild: 2 Minuten nicht fangbar, aber live sichtbar!`, { kind: 'warn', sound: 'ping' });
      } else if (type === 'cloak') {
        me.cloakNext = true;
        this.emit(id, '👻 Tarnkappe aktiv: Du fehlst im nächsten Ping.');
      } else if (type === 'decoy') {
        me.decoyNext = true;
        this.emit(id, '🎭 Doppelgänger aktiv: Der nächste Ping zeigt einen falschen Standort.');
      } else {
        me.radarUntil = now + RADAR_MS;
        this.emit(id, '📡 Radar aktiv: Du siehst die Jäger 30 Sekunden lang.');
        this.emit('hunter', '📡 Ein Hider scannt gerade eure Positionen!', { kind: 'warn' });
      }
      this.touch();
      return {};
    }

    if (me.role !== 'hunter') throw new GameError('Nur Jäger können diesen Joker nutzen.');
    if (this.phase !== 'hunt') throw new GameError('Jäger-Joker gehen erst, wenn die Jagd läuft.');

    if (type === 'spotlight') {
      const idx = me.jokers.indexOf(type);
      if (idx < 0) throw new GameError('Diesen Joker hast du nicht.');
      if (!me.pos || now - me.pos.t > STALE_MS) throw new GameError('Dafür brauchst du ein aktuelles GPS-Signal.');
      me.jokers.splice(idx, 1);
      const found = this.aliveHiders().filter((p) => p.pos && !(p.protectedUntil > now) && distanceM(me.pos, p.pos) <= SPOTLIGHT_RANGE);
      for (const p of found) {
        p.spotUntil = now + SPOTLIGHT_MS;
        this.emit(p.id, '🔦 Ein Jäger hat dich mit dem Scheinwerfer entdeckt! Alle Jäger sehen dich 30 Sekunden live.', { kind: 'warn', sound: 'warn' });
      }
      this.emit(
        'hunter',
        found.length
          ? `🔦 ${me.name} hat den Scheinwerfer eingeschaltet: ${found.map((p) => p.name).join(', ')} 30 s live sichtbar!`
          : `🔦 ${me.name} hat den Scheinwerfer eingeschaltet – kein Hider im Umkreis von ${SPOTLIGHT_RANGE} m.`,
        { sound: 'ping' },
      );
      this.touch();
      return { found: found.length };
    }
    if (!(this.hunterPool[type] > 0)) throw new GameError('Von diesem Joker ist keiner mehr übrig.');

    if (type === 'extraPing') {
      this.hunterPool[type] -= 1;
      this.ping(now, me.name);
      return {};
    }
    if (type === 'drone') {
      if (this.drone) throw new GameError('Es fliegt schon eine Drohne.');
      const candidates = this.aliveHiders().filter((p) => p.pos && !(p.protectedUntil > now));
      if (!candidates.length) throw new GameError('Kein Hider mit GPS-Signal gefunden.');
      const t = candidates[crypto.randomInt(candidates.length)];
      this.hunterPool[type] -= 1;
      this.drone = { targetId: t.id, until: now + DRONE_MS, by: me.name };
      this.emit('hunter', `🚁 ${me.name} hat eine Drohne gestartet: ${t.name} wird 60 s live verfolgt!`, { sound: 'ping' });
      this.emit(t.id, '🚁 Eine Drohne verfolgt dich 60 Sekunden lang live!', { kind: 'warn', sound: 'warn' });
      this.touch();
      return {};
    }
    // sniff
    if (!me.pos || now - me.pos.t > STALE_MS) throw new GameError('Dafür brauchst du ein aktuelles GPS-Signal.');
    let best = null;
    for (const p of this.aliveHiders()) {
      if (!p.pos) continue;
      const d = distanceM(me.pos, p.pos);
      if (!best || d < best.d) best = { d, p };
    }
    if (!best) throw new GameError('Kein Hider mit GPS-Signal gefunden.');
    this.hunterPool[type] -= 1;
    const meters = Math.max(50, Math.round(best.d / 50) * 50);
    this.emit(id, `🐕 Der nächste Hider ist ca. ${meters} m von dir entfernt.`, { sound: 'ping' });
    this.emit('hunter', `🐕 ${me.name} hat die Spürnase benutzt.`);
    this.emit(best.p.id, '🐕 Ein Jäger hat deine Fährte aufgenommen!', { kind: 'warn' });
    this.touch();
    return { meters };
  }

  chatChannels(p) {
    if (!this.running) return ['all'];
    if (p.role === 'hunter') return ['hunter', 'all'];
    if (p.status === 'alive') return ['hider', 'all'];
    return ['all'];
  }

  addChat(id, channel, rawText) {
    const p = this.player(id);
    const text = String(rawText ?? '').trim().slice(0, 300);
    if (!text) throw new GameError('Leere Nachricht.');
    if (!this.chatChannels(p).includes(channel)) throw new GameError('In diesen Chat kannst du nicht schreiben.');
    const msg = { id: crypto.randomUUID(), ts: Date.now(), from: p.id, name: p.name, channel, text };
    this.chat.push(msg);
    if (this.chat.length > 300) this.chat.splice(0, this.chat.length - 300);
    this.lastActivity = Date.now();
    return msg;
  }

  chatFor(p) {
    const ch = this.chatChannels(p);
    return this.chat.filter((m) => ch.includes(m.channel));
  }

  trails() {
    if (this.phase !== 'ended') throw new GameError('Die Routen gibt es erst nach der Runde.');
    return {
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        role: p.startRole,
        status: p.status,
        caughtBy: p.caughtBy,
        caughtAt: p.caughtAt,
        trail: p.trail,
      })),
      pings: this.pings.length,
    };
  }

  // Was ein bestimmter Spieler sehen darf. Positionen der Hider gehen nur
  // beim Ping (oder bei Strafen/Jokern) an die Jäger raus – nie vorher.
  view(id, now = Date.now()) {
    const me = this.player(id);
    const ended = this.phase === 'ended';
    const asHunter = this.seesAsHunter(me);
    const radarOn = me.role === 'hider' && me.status === 'alive' && me.radarUntil > now;
    const pingById = new Map((this.lastPing?.entries ?? []).map((e) => [e.id, e]));
    const crush = this.crushPartner(me.id);

    const players = [...this.players.values()].map((p) => {
      const o = {
        id: p.id,
        name: p.name,
        role: p.role,
        startRole: p.startRole,
        status: p.status,
        caughtBy: p.caughtBy ?? null,
        caughtAt: p.caughtAt ?? null,
        connected: p.connected,
        hasGps: Boolean(p.pos && now - p.pos.t < STALE_MS),
        signalLost: Boolean(p.signalLost),
        background: Boolean(p.bgAt && now - p.bgAt < BACKGROUND_ACTIVE_MS),
        trophy: Boolean(p.trophy),
        pos: null,
        kind: null,
      };
      const live = p.pos ? { lat: p.pos.lat, lng: p.pos.lng, t: p.pos.t, acc: p.pos.acc } : null;
      if (p.id === me.id) {
        o.pos = live;
        o.kind = 'self';
      } else if (ended) {
        o.pos = live;
        o.kind = 'final';
      } else if (!this.running) {
        // Lobby: keine Positionen
      } else if (asHunter) {
        if (p.role === 'hunter') {
          o.pos = live;
          o.kind = 'ally';
        } else if (p.status === 'alive') {
          if (p.protectedUntil > now) {
            o.kind = 'protected';
          } else if (p.shieldUntil > now && live) {
            o.pos = live;
            o.kind = 'shield';
          } else if (this.finaleOn && live) {
            o.pos = live;
            o.kind = 'finale';
          } else if (p.spotUntil > now && live) {
            o.pos = live;
            o.kind = 'spot';
          } else if (this.bounty?.targetId === p.id && live) {
            o.pos = live;
            o.kind = 'bounty';
          } else if ((p.exposed || this.drone?.targetId === p.id) && live) {
            o.pos = live;
            o.kind = p.exposed ? 'exposed' : 'drone';
          } else if (p.signalLost && live) {
            o.pos = live;
            o.kind = 'lost';
          } else {
            const e = pingById.get(p.id);
            if (e?.cloaked) o.kind = 'cloaked';
            else if (e?.protected) o.kind = 'protected';
            else if (e?.lat != null) {
              o.pos = { lat: e.lat, lng: e.lng, t: e.t };
              o.kind = 'ping';
              if (e.fog) o.fog = e.fog;
            }
          }
        }
      } else if (p.role === 'hider' && p.status === 'alive' && this.settings.hidersSeeEachOther) {
        o.pos = live;
        o.kind = 'ally';
      } else if (p.role === 'hunter' && radarOn) {
        o.pos = live;
        o.kind = 'radar';
      }
      // Ping-Spur: frühere Ping-Punkte eines freien Hiders, ältester zuerst (nur für Jäger)
      if (asHunter && this.running && p.role === 'hider' && p.status === 'alive' && this.settings.pingTrail > 0) {
        const pts = [];
        for (const ping of this.pings ?? []) {
          const e = ping.entries.find((x) => x.id === p.id);
          if (e?.lat != null) pts.push([e.lat, e.lng]);
        }
        const trail = pts.slice(-this.settings.pingTrail).slice(0, -1);
        if (trail.length) o.pingTrail = trail;
      }
      // Crush sieht sich immer live, egal in welchem Team
      if (crush?.id === p.id && this.running && live) {
        o.pos = live;
        o.kind = 'crush';
      }
      return o;
    });

    return {
      serverNow: now,
      code: this.code,
      phase: this.phase,
      round: this.round,
      hostId: this.hostId,
      // Die Mitte einer selbst gesetzten Endzone kennt nur der Spielleiter.
      settings: me.id === this.hostId ? this.settings : { ...this.settings, finalCenter: null },
      timers: this.timers,
      lastPingAt: this.lastPing?.at ?? null,
      zone: this.currentZone(now),
      nextZone: this.running ? this.nextZone(now) : null,
      zoneStage: { done: (this.zoneStages ?? []).filter((x) => now >= x.at).length, total: this.zoneStages?.length ?? 0 },
      result: this.result,
      players,
      chatChannels: this.chatChannels(me),
      me: {
        id: me.id,
        name: me.name,
        role: me.role,
        startRole: me.startRole,
        status: me.status,
        isHost: me.id === this.hostId,
        catchCode: me.catchCode,
        jokers: me.jokers,
        cloakNext: Boolean(me.cloakNext),
        decoyNext: Boolean(me.decoyNext),
        radarUntil: me.radarUntil || 0,
        shieldUntil: me.shieldUntil > now ? me.shieldUntil : 0,
        outSince: me.outSince ?? null,
        exposed: Boolean(me.exposed),
        droneTracked: this.drone?.targetId === me.id ? this.drone.until : 0,
        bgAt: me.bgAt ?? 0,
        protectedUntil: me.protectedUntil > now ? me.protectedUntil : 0,
        spectator: me.role === 'hider' && me.status === 'caught',
      },
      hunterPool: asHunter ? this.hunterPool : null,
      // Geheim: das Paar kennt nur sich selbst, der Spielleiter sieht die Einstellung
      crush: crush ? { partnerId: crush.id, partnerName: crush.name } : null,
      crushPair: me.id === this.hostId ? this.crush : null,
      // Was dieses Spiel kann (Gast-Spiele ohne Crush)
      features: { crush: !this.guest },
      canAvoidLastHunters: me.id === this.hostId && (this.lastHunters ?? []).some((pid) => this.players.has(pid)),
      // Streitfälle: der Spielleiter sieht alle, Beteiligte nur ihren eigenen
      disputes: (this.disputes ?? [])
        .filter((d) => me.id === this.hostId || d.hunterId === me.id || d.hiderId === me.id)
        .map((d) => ({
          id: d.id,
          until: d.until,
          distance: me.id === this.hostId ? d.distance : null,
          hunter: this.players.get(d.hunterId)?.name,
          hider: this.players.get(d.hiderId)?.name,
          mine: d.hunterId === me.id ? 'hunter' : d.hiderId === me.id ? 'hider' : null,
        })),
      drone: asHunter && this.drone ? { name: this.players.get(this.drone.targetId)?.name, until: this.drone.until } : null,
      jokerInfo: JOKERS,
      eventInfo: EVENTS,
      events: {
        last: this.lastEvent,
        feverUntil: this.feverUntil > now ? this.feverUntil : 0,
        fogNext: Boolean(this.fogNext),
        bounty: this.bounty
          ? {
              name: this.players.get(this.bounty.targetId)?.name,
              until: this.bounty.until,
              me: this.bounty.targetId === me.id,
            }
          : null,
      },
    };
  }
}
