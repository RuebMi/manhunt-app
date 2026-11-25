// Missionen (Checkpoints): Ein Hider bekommt ab und zu ein freiwilliges Angebot,
// zu einem Checkpoint zu laufen und 30 s dort zu bleiben. Die Jäger sehen das Ziel.
// Geschafft = Joker, Zeit um = Strafe-Ping. Siehe docs/superpowers/specs/2026-11-25-missionen-design.md
import crypto from 'node:crypto';
import { distanceM, GameError, JOKERS } from './game.js';

const MIN = 60_000;

export const MISSION_MODES = ['off', 'rare', 'often'];

export const MISSION = {
  everyMs: { rare: 12 * MIN, often: 6 * MIN }, // Rhythmus der Angebote
  firstAfterMs: 5 * MIN, // erstes Angebot frühestens so lange nach Jagdbeginn
  quietBeforeEndMs: 10 * MIN, // keine neuen Angebote, wenn weniger übrig ist
  offerMs: 60_000, // Bedenkzeit
  holdMs: 30_000, // so lange am Stück im Kreis bleiben
  radiusM: 35, // Kreis um den Checkpoint (GPS ist ungenau)
  minDistM: 300,
  maxDistM: 900,
  maxActive: 2, // Missionen und offene Angebote zusammen
  maxOffersPerSlot: 3, // so oft wird ein Platz weitergegeben
  declineCooldownMs: 5 * MIN, // wer ablehnt, bekommt so lange kein neues Angebot
  maxCheckpoints: 20,
  minCheckpoints: 3,
  staleMs: 45_000, // ältere Positionen zählen nicht (Hintergrund-Ortung schickt etwa alle 20 s)
  graceMs: 20_000, // so lange über die letzte Position im Kreis hinaus zählt die Zeit weiter
};

// 3 Minuten plus 1 Minute je angefangene 150 m: 650 m -> 8 min
export function missionTimeMs(distanceM) {
  return (3 + Math.ceil(distanceM / 150)) * MIN;
}

// Je weiter das Ziel, desto besser der Joker
export function missionReward(distanceM, rand = Math.random) {
  if (distanceM < 500) return 'decoy';
  return rand() < 0.5 ? 'cloak' : 'radar';
}

const validCoord = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

// Liste vom Spielleiter prüfen: nur gültige Punkte in der Zone, höchstens 20, keine doppelten IDs.
export function sanitizeCheckpoints(list, zone) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const ids = new Set();
  for (const c of list) {
    if (out.length >= MISSION.maxCheckpoints) break;
    if (!c || typeof c !== 'object') continue;
    const lat = Number(c.lat);
    const lng = Number(c.lng);
    if (typeof c.lat === 'string' && !c.lat.trim()) continue;
    if (!validCoord(lat, lng)) continue;
    if (distanceM({ lat, lng }, zone) > zone.radius) continue;
    const id = typeof c.id === 'string' && /^[\w-]{1,40}$/.test(c.id) ? c.id : crypto.randomBytes(6).toString('hex');
    if (ids.has(id)) continue;
    ids.add(id);
    const name = String(c.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 40) || 'Checkpoint';
    out.push({ id, name, lat, lng });
  }
  return out;
}

// Die Checkpoints, die in der Zone liegen (Standard: Startzone aus den Einstellungen)
export function checkpointsInZone(settings, zone = settings.zone) {
  return (settings.checkpoints ?? []).filter((c) => distanceM(c, zone) <= zone.radius);
}

// ---------------------------------------------------------------------------
// Ablauf im Spiel. Alle Funktionen arbeiten auf einem Game und bekommen die Zeit
// von außen (für Tests). Die Jäger erfahren nie, welcher Hider eine Mission hat.

const CANCEL_TEXT = '🎯 Ziel liegt bald außerhalb der Zone, Mission ohne Strafe beendet.';

function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const newId = () => crypto.randomBytes(8).toString('hex');
const checkpoint = (game, id) => (game.settings.checkpoints ?? []).find((c) => c.id === id) ?? null;
const fmtDist = (m) => (m >= 1000 ? `${String(Math.round(m / 100) / 10).replace('.', ',')} km` : `${Math.round(m / 10) * 10} m`);

// Neue Runde: alles leer, erstes Angebot frühestens 5 min nach Jagdbeginn.
export function resetMissions(game, now) {
  game.missions = {
    nextAt: (game.timers?.huntStartAt ?? now) + MISSION.firstAfterMs,
    offers: [],
    active: [],
    cooldown: {},
  };
}

// Ende der Runde: offene Angebote und Missionen verschwinden.
export function clearMissions(game) {
  if (!game.missions) return;
  game.missions.offers = [];
  game.missions.active = [];
}

function logMission(game, m, result, now) {
  const p = game.players.get(m.hiderId);
  const cp = checkpoint(game, m.checkpointId);
  game.roundLog.push({ kind: 'mission', name: p?.name ?? m.hiderName ?? '?', checkpoint: cp?.name ?? '?', result, at: now });
}

const timeLeftOk = (game, now) => game.timers.endAt - now >= MISSION.quietBeforeEndMs;

// Ziele, die gerade angeboten werden dürfen: in der Zone (und in der angekündigten nächsten), nicht belegt.
function freeCheckpoints(game, now) {
  const busy = new Set([...game.missions.offers, ...game.missions.active].map((m) => m.checkpointId));
  const zone = game.currentZone(now);
  const next = game.nextZone(now);
  return checkpointsInZone(game.settings, zone).filter((c) => !busy.has(c.id) && (!next || distanceM(c, next) <= next.radius));
}

// Ein Angebot an einen zufälligen passenden Hider. Gibt das Angebot zurück oder null.
function makeOffer(game, now, slot, asked) {
  const m = game.missions;
  if (slot > MISSION.maxOffersPerSlot || !timeLeftOk(game, now)) return null;
  if (m.offers.length + m.active.length >= MISSION.maxActive) return null;
  const taken = new Set([...m.offers, ...m.active].map((x) => x.hiderId));
  const free = freeCheckpoints(game, now);
  if (!free.length) return null;
  const candidates = game
    .aliveHiders()
    .filter((p) => p.pos && now - p.pos.t <= MISSION.staleMs && !taken.has(p.id) && !(m.cooldown[p.id] > now) && !asked.includes(p.id));
  for (const p of shuffled(candidates)) {
    const fits = free.filter((c) => {
      const d = distanceM(p.pos, c);
      return d >= MISSION.minDistM && d <= MISSION.maxDistM;
    });
    if (!fits.length) continue;
    const cp = fits[crypto.randomInt(fits.length)];
    const dist = Math.round(distanceM(p.pos, cp));
    const offer = {
      id: newId(),
      hiderId: p.id,
      checkpointId: cp.id,
      distanceM: dist,
      timeMs: missionTimeMs(dist),
      reward: missionReward(dist),
      until: now + MISSION.offerMs,
      slot,
      asked: [...asked, p.id],
    };
    m.offers.push(offer);
    const j = JOKERS[offer.reward];
    game.emit(
      p.id,
      `🎯 Neue Mission für dich! Lauf zu „${cp.name}“ (${fmtDist(dist)}) und bleib 30 s dort. Zeit: ${Math.round(offer.timeMs / MIN)} min. Belohnung: ${j.icon} ${j.name}. Die Jäger sehen das Ziel!`,
      { sound: 'event' },
    );
    game.touch();
    return offer;
  }
  return null;
}

// Angebot weg (abgelehnt, keine Antwort, Hider weg): an den nächsten Hider weitergeben.
function passOn(game, offer, now) {
  game.missions.offers = game.missions.offers.filter((o) => o !== offer);
  makeOffer(game, now, offer.slot + 1, offer.asked);
  game.touch();
}

function finish(game, mission, result, now) {
  game.missions.active = game.missions.active.filter((m) => m !== mission);
  logMission(game, mission, result, now);
  game.touch();
}

// Strafe: einmaliger Ping mit dem echten Standort, nur für diesen Hider.
// Tarnkappe und Doppelgänger bleiben für den nächsten normalen Ping erhalten.
export function penaltyPing(game, p, now) {
  if (!p.pos) return false;
  const entry = { id: p.id, lat: p.pos.lat, lng: p.pos.lng, t: p.pos.t };
  game.pings.push({ at: now, byName: null, penalty: true, entries: [entry] });
  const old = game.lastPing ?? { at: now, byName: null, entries: [] };
  game.lastPing = { ...old, entries: [...old.entries.filter((e) => e.id !== p.id), entry] };
  game.touch();
  return true;
}

export function missionsTick(game, now) {
  if (!game.missions) resetMissions(game, now);
  const m = game.missions;

  // Angebote ohne Antwort oder ohne passenden Hider weitergeben
  for (const o of [...m.offers]) {
    const p = game.players.get(o.hiderId);
    if (now > o.until || !p || p.role !== 'hider' || p.status !== 'alive') {
      if (p && now > o.until) game.emit(p.id, '🎯 Das Missions-Angebot ist verfallen.');
      passOn(game, o, now);
    }
  }

  // Laufende Missionen: Zeit im Kreis messen, Erfolg oder Zeit um
  for (const mission of [...m.active]) {
    const p = game.players.get(mission.hiderId);
    const cp = checkpoint(game, mission.checkpointId);
    if (!p || p.role !== 'hider' || p.status !== 'alive' || !cp) {
      finish(game, mission, 'cancelled', now);
      continue;
    }
    const inside = p.pos && now - p.pos.t <= MISSION.staleMs && distanceM(p.pos, cp) <= MISSION.radiusM;
    if (inside) {
      if (mission.inSince == null) {
        mission.inSince = Math.min(now, p.pos.t);
        game.dirty = true;
      }
    } else if (mission.inSince != null) {
      mission.inSince = null;
      game.dirty = true;
    }
    // Gezählt wird nur bis kurz nach der letzten Position im Kreis: Wer reinläuft, das Handy
    // sperrt und weggeht, schafft es nicht. Es braucht eine zweite Position im Kreis.
    const counted = mission.inSince != null ? Math.min(now, p.pos.t + MISSION.graceMs) - mission.inSince : 0;
    if (mission.inSince != null && counted >= MISSION.holdMs) {
      p.jokers.push(mission.reward);
      const j = JOKERS[mission.reward];
      game.emit(p.id, `🎉 Mission geschafft! Du bekommst ${j.icon} ${j.name}.`, { sound: 'event' });
      game.emit('hunter', `🎯 Mission geschafft! Ein Hider hat „${cp.name}“ erreicht.`);
      finish(game, mission, 'done', now);
    } else if (now >= mission.until) {
      if (p.protectedUntil > now || p.shieldUntil > now) {
        game.emit(p.id, '⏱️ Zeit um! Weil du gerade geschützt bist, gibt es keine Strafe.');
        game.emit('hunter', `⏱️ Die Mission zu „${cp.name}“ ist gescheitert.`);
      } else {
        penaltyPing(game, p, now);
        game.emit(p.id, '⏱️ Zeit um! Du wurdest zur Strafe angepingt.', { kind: 'warn', sound: 'warn' });
        game.emit('hunter', '⏱️ Mission gescheitert – Strafe-Ping!', { sound: 'ping' });
      }
      finish(game, mission, 'failed', now);
    }
  }

  // Rhythmus: neuer Platz alle 6 bzw. 12 min (Weitergeben verschiebt ihn nicht)
  const every = MISSION.everyMs[game.settings.missionsMode];
  if (every && now >= m.nextAt) {
    while (m.nextAt <= now) m.nextAt += every;
    makeOffer(game, now, 1, []);
    game.dirty = true;
  }
}

export function respondMission(game, playerId, offerId, accept, now) {
  const m = game.missions;
  const offer = m?.offers.find((o) => o.id === offerId && o.hiderId === playerId);
  if (!offer || now > offer.until || game.phase !== 'hunt') throw new GameError('Dieses Angebot gilt nicht mehr.');
  const p = game.player(playerId);
  if (accept) {
    m.offers = m.offers.filter((o) => o !== offer);
    const cp = checkpoint(game, offer.checkpointId);
    m.active.push({ id: offer.id, hiderId: p.id, hiderName: p.name, checkpointId: offer.checkpointId, reward: offer.reward, until: now + offer.timeMs, inSince: null });
    game.emit(p.id, `🎯 Mission angenommen: Lauf zu „${cp?.name}“! Du hast ${Math.round(offer.timeMs / MIN)} min.`);
    game.emit('hunter', `🎯 Ein Hider hat eine Mission zum Checkpoint „${cp?.name}“ angenommen!`, { kind: 'warn', sound: 'event' });
  } else {
    m.cooldown[p.id] = now + MISSION.declineCooldownMs;
    passOn(game, offer, now);
  }
  game.touch();
  return {};
}

// Neue Zonenstufe (angekündigt oder angewandt): Ziele außerhalb werden ohne Strafe abgebrochen.
export function missionsZoneChange(game, zone, now) {
  const m = game.missions;
  if (!m) return;
  const outside = (x) => {
    const cp = checkpoint(game, x.checkpointId);
    return !cp || distanceM(cp, zone) > zone.radius;
  };
  for (const o of m.offers.filter(outside)) {
    m.offers = m.offers.filter((x) => x !== o);
    game.emit(o.hiderId, CANCEL_TEXT, { kind: 'warn' });
    game.touch();
  }
  for (const mission of m.active.filter(outside)) {
    const cp = checkpoint(game, mission.checkpointId);
    game.emit(mission.hiderId, CANCEL_TEXT, { kind: 'warn' });
    game.emit('hunter', `🎯 Die Mission zu „${cp?.name ?? 'Checkpoint'}“ ist abgebrochen – das Ziel liegt außerhalb der neuen Zone.`);
    finish(game, mission, 'cancelled', now);
  }
}

// Hider gefangen oder weg: Angebot weitergeben, Mission beenden.
export function missionsDropPlayer(game, playerId, reason, now) {
  const m = game.missions;
  if (!m) return;
  for (const o of m.offers.filter((x) => x.hiderId === playerId)) passOn(game, o, now);
  for (const mission of m.active.filter((x) => x.hiderId === playerId)) {
    const cp = checkpoint(game, mission.checkpointId);
    game.emit('hunter', `🎯 Die Mission zu „${cp?.name ?? 'Checkpoint'}“ ist vorbei.`);
    finish(game, mission, reason, now);
  }
}

// Was ein Spieler von den Missionen sieht
export function missionsView(game, me, now) {
  const m = game.missions;
  const empty = { offer: null, mission: null, targets: [] };
  if (!m || game.phase !== 'hunt') return empty;
  const mineOffer = m.offers.find((o) => o.hiderId === me.id && now <= o.until);
  const mine = m.active.find((x) => x.hiderId === me.id);
  const cpOf = (x) => checkpoint(game, x.checkpointId);
  const offer = mineOffer && cpOf(mineOffer)
    ? { id: mineOffer.id, name: cpOf(mineOffer).name, distanceM: mineOffer.distanceM, timeMs: mineOffer.timeMs, reward: mineOffer.reward, until: mineOffer.until }
    : null;
  const mission = mine && cpOf(mine)
    ? {
        id: mine.id,
        name: cpOf(mine).name,
        lat: cpOf(mine).lat,
        lng: cpOf(mine).lng,
        radius: MISSION.radiusM,
        until: mine.until,
        reward: mine.reward,
        inMs: mine.inSince != null ? Math.max(0, now - mine.inSince) : 0,
        inSince: mine.inSince ?? null, // Serverzeit; das Handy zählt damit selbst weiter
      }
    : null;
  let targets = [];
  if (game.seesAsHunter(me)) {
    const spectator = me.role === 'hider' && me.status === 'caught';
    targets = m.active
      .filter((x) => cpOf(x))
      .map((x) => {
        const cp = cpOf(x);
        const t = { id: x.id, name: cp.name, lat: cp.lat, lng: cp.lng, radius: MISSION.radiusM, until: x.until };
        if (spectator) t.hider = game.players.get(x.hiderId)?.name ?? x.hiderName;
        return t;
      });
  }
  return { offer, mission, targets };
}
