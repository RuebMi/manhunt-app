// Testet die Spiellogik direkt und danach den echten Server mit 30 Spielern.
// Start: npm test
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { io } from 'socket.io-client';
import { Game, distanceM, planZoneStages, DEFAULT_SETTINGS, eventCount, planEvents, pingIntervalMs } from '../server/game.js';
import { parseGuestPasswords, createAccess } from '../server/access.js';
import { FIRST_TIME_SETTINGS, firstTimeUpdate, isFirstTime } from '../public/first-time.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const VS = { lat: 48.0603, lng: 8.4586 };
const near = (m = 300) => ({ lat: VS.lat + (Math.random() - 0.5) * (m / 55660), lng: VS.lng + (Math.random() - 0.5) * (m / 37200), acc: 10 });

function logicTests() {
  const g = new Game('TEST');
  const host = g.addPlayer('Host');
  const hunter = host;
  const h1 = g.addPlayer('Hider1');
  const h2 = g.addPlayer('Hider2');
  assert.throws(() => g.addPlayer('host'), /vergeben/);
  g.setRole(host.id, host.id, 'hunter');
  g.updateSettings(host.id, { headStartMin: 1, pingIntervalMin: 2, durationMin: 10, hiderJokers: 3 });
  for (const p of [host, h1, h2]) g.updatePos(p.id, near());
  g.start(host.id);
  assert.equal(g.phase, 'headstart');

  // Während des Vorsprungs sieht der Jäger keine Hider
  let v = g.view(hunter.id);
  assert.ok(v.players.filter((p) => p.role === 'hider').every((p) => p.pos === null), 'Jäger darf Hider vor dem Ping nicht sehen');
  assert.equal(v.me.catchCode, null);
  assert.match(g.view(h1.id).me.catchCode, /^\d{4}$/);
  assert.equal(g.view(h1.id).me.jokers.length, 3);
  // Hider sehen keine Jäger
  assert.equal(g.view(h1.id).players.find((p) => p.id === hunter.id).pos, null);

  // Tarnkappe für Hider2
  g.useJoker(h2.id, 'cloak');
  assert.throws(() => g.useJoker(h2.id, 'decoy'), /schon ein Joker/);

  // Jagd beginnt -> erster Ping
  const t1 = g.timers.huntStartAt;
  g.tick(t1);
  assert.equal(g.phase, 'hunt');
  v = g.view(hunter.id, t1);
  const vh1 = v.players.find((p) => p.id === h1.id);
  const vh2 = v.players.find((p) => p.id === h2.id);
  assert.equal(vh1.kind, 'ping');
  assert.ok(vh1.pos);
  assert.equal(vh2.kind, 'cloaked');
  assert.equal(vh2.pos, null);

  // Hider bewegt sich -> Jäger sieht weiterhin nur den alten Ping
  const before = { ...vh1.pos };
  g.updatePos(h1.id, { lat: VS.lat + 0.003, lng: VS.lng, acc: 5 });
  const again = g.view(hunter.id).players.find((p) => p.id === h1.id);
  assert.deepEqual({ lat: again.pos.lat, lng: again.pos.lng }, { lat: before.lat, lng: before.lng });

  // Doppelgänger verschiebt den nächsten Ping
  g.useJoker(h1.id, 'decoy');
  const realPos = g.players.get(h1.id).pos;
  g.tick(g.timers.nextPingAt);
  const decoyed = g.lastPing.entries.find((e) => e.id === h1.id);
  const off = distanceM(realPos, decoyed);
  assert.ok(off >= 290 && off <= 610, `Doppelgänger-Versatz ${off}`);

  // Außerhalb der Zone -> nach Schonfrist live sichtbar
  const t2 = Date.now();
  g.updatePos(h2.id, { lat: VS.lat + 0.05, lng: VS.lng, acc: 5 });
  g.tick(t2);
  assert.notEqual(g.players.get(h2.id).outSince, null);
  g.tick(t2 + g.settings.outGraceSec * 1000 + 10);
  assert.equal(g.view(hunter.id).players.find((p) => p.id === h2.id).kind, 'exposed');
  g.updatePos(h2.id, near(100));
  g.tick(t2 + g.settings.outGraceSec * 1000 + 20);
  assert.notEqual(g.view(hunter.id).players.find((p) => p.id === h2.id).kind, 'exposed');

  // Falscher Code, dann richtig fangen
  assert.throws(() => g.catchHider(hunter.id, '0000'), /Falscher Code/);
  assert.throws(() => g.catchHider(h1.id, g.players.get(h2.id).catchCode), /Nur Jäger/);
  g.catchHider(hunter.id, g.players.get(h1.id).catchCode);
  assert.equal(g.players.get(h1.id).status, 'caught');
  // Gefangener Hider sieht wie ein Jäger
  assert.equal(g.view(h1.id).players.find((p) => p.id === hunter.id).kind, 'ally');
  assert.equal(g.phase, 'hunt');
  g.catchHider(hunter.id, g.players.get(h2.id).catchCode);
  assert.equal(g.phase, 'ended');
  assert.equal(g.result.winner, 'hunters');

  // Neue Runde, Hider gewinnen durch Zeitablauf
  g.backToLobby(host.id);
  assert.equal(g.phase, 'lobby');
  g.updateSettings(host.id, { headStartMin: 0, infection: true });
  g.start(host.id);
  g.tick(g.timers.endAt);
  assert.equal(g.result.winner, 'hiders');

  // Infektion: Gefangene werden Jäger
  g.backToLobby(host.id);
  g.start(host.id);
  g.tick(Date.now());
  g.catchHider(hunter.id, g.players.get(h1.id).catchCode);
  assert.equal(g.players.get(h1.id).role, 'hunter');
  g.catchHider(h1.id, g.players.get(h2.id).catchCode); // infizierter Spieler fängt mit
  assert.equal(g.result.winner, 'hunters');

  // Speichern & Laden
  const restored = Game.fromJSON(JSON.parse(JSON.stringify(g)));
  assert.equal(restored.players.size, 3);
  assert.equal(restored.phase, 'ended');
  console.log('✓ Spiellogik');
}

function zoneTests() {
  const MIN = 60_000;
  const g = new Game('ZONE');
  const host = g.addPlayer('Host');
  const hider = g.addPlayer('Hider');
  g.setRole(host.id, host.id, 'hunter');
  g.updateSettings(host.id, { headStartMin: 0, durationMin: 60, shrinkSteps: 3, finalRadius: 600, shrinkWarnMin: 1, zone: { ...VS, radius: 1200 } });
  g.updatePos(hider.id, { ...VS, acc: 5 });
  g.start(host.id);
  const t0 = g.timers.huntStartAt;
  assert.deepEqual(g.zoneStages.map((st) => [Math.round((st.at - t0) / MIN), st.radius]), [[15, 1000], [30, 800], [45, 600]]);

  g.tick(t0 + 14 * MIN - 1);
  assert.equal(g.view(hider.id, t0 + 14 * MIN - 1).nextZone, null);
  g.events.length = 0;
  g.tick(t0 + 14 * MIN);
  assert.ok(g.events.some((e) => e.text.includes('in 1 Minute kleiner')), 'Vorwarnung');
  assert.equal(g.view(hider.id, t0 + 14 * MIN).nextZone.radius, 1000);
  assert.equal(g.currentZone(t0 + 14 * MIN).radius, 1200);
  g.tick(t0 + 15 * MIN);
  assert.equal(g.currentZone(t0 + 15 * MIN).radius, 1000);
  assert.ok(g.events.some((e) => e.text.includes('Stufe 1 von 3')));

  // Hider steht nach der Stufe außerhalb -> Warnung
  g.updatePos(hider.id, { lat: VS.lat + 950 / 111320, lng: VS.lng, acc: 5 });
  g.tick(t0 + 31 * MIN);
  assert.notEqual(g.players.get(hider.id).outSince, null, 'außerhalb der verkleinerten Zone');

  // Verschobene Zonen liegen immer komplett in der vorherigen
  for (let i = 0; i < 200; i++) {
    const st = planZoneStages({ ...DEFAULT_SETTINGS, shrinkSteps: 5, finalRadius: 360, finalMode: 'random' }, 0, 60 * MIN);
    let prev = DEFAULT_SETTINGS.zone;
    for (const z of st) {
      assert.ok(distanceM(prev, z) + z.radius <= prev.radius + 1, 'neue Zone liegt in der alten');
      prev = z;
    }
  }
  assert.deepEqual(planZoneStages({ ...DEFAULT_SETTINGS, shrink: false }, 0, MIN), []);
  endZoneTests();
  console.log('✓ Zonen-Stufen');
}

// Selbst festgelegte Endzone: Größe in Metern, Mitte frei wählbar und geheim
function endZoneTests() {
  const north = (m) => ({ lat: VS.lat + m / 111320, lng: VS.lng });
  const near = (a, b, msg) => assert.ok(Math.abs(a - b) <= 2, `${msg}: ${a} statt ${b}`);

  // Stufen wandern gleichmäßig zur Endzone – auch wenn sie außerhalb der Startzone liegt
  const s = { ...DEFAULT_SETTINGS, zone: { ...VS, radius: 1200 }, shrinkSteps: 3, finalRadius: 600, finalMode: 'custom', finalCenter: north(1500) };
  const st = planZoneStages(s, 0, 60 * 60_000);
  assert.deepEqual(st.map((z) => z.radius), [1000, 800, 600]);
  st.forEach((z, i) => near(distanceM(VS, z), distanceM(VS, north(500 * (i + 1))), `Mitte von Stufe ${i + 1}`));

  const g = new Game('ENDE');
  const host = g.addPlayer('Host');
  const hider = g.addPlayer('Hider');
  g.updateSettings(host.id, { zone: { ...VS, radius: 1200 }, finalRadius: 600 });

  // "Selbst wählen" ohne Mitte -> startet in der Mitte der Startzone
  g.updateSettings(host.id, { finalMode: 'custom' });
  assert.deepEqual(g.settings.finalCenter, { lat: VS.lat, lng: VS.lng });
  g.updateSettings(host.id, { finalCenter: north(2000) });

  // Startzone ändern: Endgröße wächst mit, die Mitte der Endzone bleibt
  g.updateSettings(host.id, { zone: { lat: VS.lat + 0.01, lng: VS.lng, radius: 2400 } });
  assert.equal(g.settings.finalRadius, 1200);
  near(distanceM(VS, g.settings.finalCenter), distanceM(VS, north(2000)), 'Endzone bleibt am Ort');

  // Endzone darf nicht größer als die Startzone sein
  g.updateSettings(host.id, { finalRadius: 99999 });
  assert.equal(g.settings.finalRadius, 2400);
  g.updateSettings(host.id, { finalRadius: 10 });
  assert.equal(g.settings.finalRadius, 100);

  // Geheim: nur der Spielleiter bekommt die Position
  assert.ok(g.view(host.id).settings.finalCenter, 'Spielleiter sieht die Endzone');
  assert.equal(g.view(hider.id).settings.finalCenter, null, 'Mitspieler sehen keine Koordinaten');
  assert.equal(g.view(hider.id).settings.finalMode, 'custom');
  assert.ok(g.settings.finalCenter, 'die Ansicht darf die echten Einstellungen nicht verändern');

  // Alte Spielstände (Prozent + Schalter) werden umgerechnet
  const old = JSON.parse(JSON.stringify(new Game('ALT')));
  old.settings = { ...old.settings, zone: { ...VS, radius: 1200 }, shrinkFinalPct: 40, shrinkMove: true };
  delete old.settings.finalRadius;
  delete old.settings.finalMode;
  const restored = Game.fromJSON(old);
  assert.equal(restored.settings.finalRadius, 480);
  assert.equal(restored.settings.finalMode, 'random');
  // ... und alte Clients mit Prozentwert funktionieren weiter
  g.updateSettings(host.id, { shrinkFinalPct: 25 });
  assert.equal(g.settings.finalRadius, 600);
}

// Pokal: wer glänzt, bekommt in der nächsten Runde der Lobby einen besonderen Joker
function trophyTests() {
  const MIN = 60_000;
  const north = (m) => ({ lat: VS.lat + m / 111320, lng: VS.lng, acc: 5 });
  const g = new Game('POKL');
  const host = g.addPlayer('Host');
  const j2 = g.addPlayer('Jäger2');
  const a = g.addPlayer('Anna');
  const b = g.addPlayer('Ben');
  const c = g.addPlayer('Cleo');
  g.setRole(host.id, host.id, 'hunter');
  g.setRole(host.id, j2.id, 'hunter');
  g.updateSettings(host.id, { headStartMin: 0, durationMin: 30, hiderJokers: 3, eventsMode: 'off' });
  for (const p of [host, j2, a, b, c]) g.updatePos(p.id, north(0));

  // Runde 1: Host fängt 2, Jäger2 keinen, Cleo bleibt als Einzige übrig
  g.start(host.id);
  for (const p of g.players.values()) {
    assert.ok(!p.jokers.includes('shield') && !p.jokers.includes('spotlight'), 'Pokal-Joker gibt es nie zufällig');
  }
  g.catchHider(host.id, g.players.get(a.id).catchCode);
  g.catchHider(host.id, g.players.get(b.id).catchCode);
  g.tick(g.timers.endAt);
  assert.equal(g.result.winner, 'hiders');
  assert.deepEqual(g.result.trophies.map((t) => t.name).sort(), ['Cleo', 'Host']);
  assert.ok(g.view(a.id).players.find((p) => p.id === c.id).trophy, 'alle sehen den Pokal');
  assert.ok(!g.view(a.id).players.find((p) => p.id === j2.id).trophy);

  // Runde 2: Pokal wird zum Joker passend zur neuen Rolle, dann ist er weg
  g.backToLobby(host.id);
  g.setRole(host.id, host.id, 'hider'); // bester Jäger ist jetzt Hider
  g.setRole(host.id, a.id, 'hunter');
  g.start(host.id);
  assert.ok(g.players.get(host.id).jokers.includes('shield'), 'Ex-Jäger als Hider bekommt den Schutzschild');
  assert.ok(g.players.get(c.id).jokers.includes('shield'), 'Cleo bekommt den Schutzschild');
  assert.equal(g.players.get(host.id).trophy, null, 'Pokal ist eingelöst');
  assert.ok(!g.players.get(j2.id).jokers.length, 'ohne Pokal kein persönlicher Joker');

  // Schutzschild: nicht fangbar, aber für Jäger live sichtbar
  g.updatePos(c.id, north(800));
  g.useJoker(c.id, 'shield');
  assert.throws(() => g.useJoker(c.id, 'shield'), /nicht/);
  assert.throws(() => g.catchHider(j2.id, g.players.get(c.id).catchCode), /Schutzschild/);
  assert.throws(() => g.reportDispute(j2.id, c.id), /Schutzschild/);
  const seen = g.view(j2.id).players.find((p) => p.id === c.id);
  assert.equal(seen.kind, 'shield');
  assert.ok(seen.pos, 'Jäger sieht den Schild-Träger live');
  g.players.get(c.id).shieldUntil = Date.now() - 1;
  g.events.length = 0;
  g.tick(Date.now());
  assert.ok(g.events.some((e) => e.to === c.id && e.text.includes('Schutzschild ist vorbei')));
  assert.notEqual(g.view(j2.id).players.find((p) => p.id === c.id).kind, 'shield', 'nach dem Schild nicht mehr live');
  g.catchHider(j2.id, g.players.get(c.id).catchCode);

  // Runde 3: Scheinwerfer zeigt nur Hider im Umkreis von 300 m
  g.forceEnd(host.id);
  g.backToLobby(host.id);
  for (const p of g.players.values()) p.trophy = null;
  g.setRole(host.id, host.id, 'hunter');
  g.setRole(host.id, a.id, 'hider');
  g.players.get(j2.id).trophy = { round: g.round, why: 'hunter' };
  g.start(host.id);
  assert.deepEqual(g.players.get(j2.id).jokers, ['spotlight']);
  g.updatePos(j2.id, north(0));
  g.updatePos(a.id, north(200));
  g.updatePos(b.id, north(900));
  g.updatePos(c.id, north(250));
  g.players.get(c.id).protectedUntil = Date.now() + MIN; // Rollentausch-Schutz bleibt unsichtbar
  assert.throws(() => g.useJoker(host.id, 'spotlight'), /hast du nicht/);
  const r = g.useJoker(j2.id, 'spotlight');
  assert.equal(r.found, 1);
  const hv = g.view(host.id).players;
  assert.equal(hv.find((p) => p.id === a.id).kind, 'spot', 'nahe Hider sind für alle Jäger sichtbar');
  assert.notEqual(hv.find((p) => p.id === b.id).kind, 'spot', 'weit entfernte nicht');
  assert.notEqual(hv.find((p) => p.id === c.id).kind, 'spot', 'geschützte nicht');
  assert.deepEqual(g.players.get(j2.id).jokers, [], 'Scheinwerfer ist verbraucht');

  // Wer am meisten fängt, bekommt den Pokal (bei Gleichstand alle mit den meisten Fängen)
  g.catchHider(host.id, g.players.get(a.id).catchCode);
  g.players.get(c.id).protectedUntil = 0;
  g.catchHider(j2.id, g.players.get(c.id).catchCode);
  g.catchHider(host.id, g.players.get(b.id).catchCode);
  assert.equal(g.result.winner, 'hunters');
  assert.deepEqual(g.result.trophies.map((t) => t.name), ['Host']);

  // Abgebrochene Runde vergibt keinen Pokal
  g.backToLobby(host.id);
  for (const p of g.players.values()) p.trophy = null;
  g.start(host.id);
  g.forceEnd(host.id);
  assert.deepEqual(g.result.trophies, []);

  // Gleichstand: beide Jäger mit je einem Fang bekommen den Pokal, dazu die letzte Hiderin
  const t = new Game('GLCH');
  const [x, y, h1, h2, h3] = ['X', 'Y', 'H1', 'H2', 'H3'].map((n) => t.addPlayer(n));
  t.setRole(x.id, x.id, 'hunter');
  t.setRole(x.id, y.id, 'hunter');
  t.updateSettings(x.id, { headStartMin: 0 });
  t.start(x.id);
  t.catchHider(x.id, t.players.get(h1.id).catchCode);
  t.catchHider(y.id, t.players.get(h2.id).catchCode);
  t.tick(t.timers.endAt);
  assert.deepEqual(t.result.trophies.map((r) => `${r.name}:${r.why}`).sort(), ['H3:hider', 'X:hunter', 'Y:hunter']);
  console.log('✓ Pokal-Joker');
}

// Crush: ein geheimes Paar sieht sich immer und kann sich nicht gegenseitig fangen
// Gast-Zugang (zweites Spielleiter-Passwort): Crush gibt es dort nicht
function guestTests() {
  const g = new Game('GAST');
  const host = g.addPlayer('Host');
  const a = g.addPlayer('Anna');
  const b = g.addPlayer('Ben');
  assert.equal(g.guest, false, 'neue Spiele sind Vollzugang');
  assert.equal(g.view(host.id).features.crush, true);
  g.guest = true;
  assert.equal(g.view(host.id).features.crush, false, 'Gast-Spiel meldet: kein Crush');
  assert.equal(g.view(a.id).features.crush, false);
  assert.throws(() => g.setCrush(host.id, a.id, b.id), /Crush gibt es in diesem Spiel nicht/);
  assert.equal(g.crush, null);
  // Spielleitung wechselt: bleibt ein Gast-Spiel
  g.removePlayer(host.id);
  assert.throws(() => g.setCrush(a.id, a.id, b.id), /Crush gibt es in diesem Spiel nicht/);
  // Alte Spielstände ohne Merker gelten als Vollzugang, Gast-Merker übersteht Speichern & Laden
  const old = JSON.parse(JSON.stringify(new Game('ALT1')));
  delete old.guest;
  assert.equal(Game.fromJSON(old).guest, false);
  assert.equal(Game.fromJSON(JSON.parse(JSON.stringify(g))).guest, true);

  // Gruppe: alter Gast-Spielstand (vor den Gruppen) gehört zu REHE, Hauptpasswort hat keine Gruppe
  const legacy = JSON.parse(JSON.stringify(g));
  delete legacy.group;
  assert.equal(Game.fromJSON(legacy).group, 'REHE');
  assert.equal(new Game('HAUP').group, null);

  // Gruppe landet im Datensatz der Runde
  const r = new Game('GRUP');
  const rh = r.addPlayer('Host');
  const rx = r.addPlayer('Hider');
  r.group = 'NEU_ULM';
  r.guest = true;
  r.setRole(rh.id, rh.id, 'hunter');
  r.updateSettings(rh.id, { headStartMin: 0 });
  r.start(rh.id);
  r.timers.startedAt -= 21 * 60_000;
  r.catchHider(rh.id, r.players.get(rx.id).catchCode);
  assert.equal(r.pendingArchive.summary.group, 'NEU_ULM');
  assert.equal(r.pendingArchive.data.group, 'NEU_ULM');
  console.log('✓ Gast-Zugang');
}

// Spannung: Ping-Spur, schnellere Pings, Finale, Bonus-Joker für die letzten Hider
function tensionTests() {
  const MIN = 60_000;
  const north = (m) => ({ lat: VS.lat + m / 111320, lng: VS.lng, acc: 5 });

  // Standardwerte und Grenzen
  const d = new Game('DEFS');
  assert.equal(d.settings.pingTrail, 3);
  assert.equal(d.settings.pingSpeedup, true);
  assert.equal(d.settings.finaleSec, 90);
  assert.equal(d.settings.comebackAt, 2);
  const dh = d.addPlayer('Host');
  d.updateSettings(dh.id, { pingTrail: 9, finaleSec: 9999, comebackAt: -3 });
  assert.equal(d.settings.pingTrail, 4);
  assert.equal(d.settings.finaleSec, 300);
  assert.equal(d.settings.comebackAt, 0);

  // Schnellere Pings: mit jeder Zonenstufe kürzer, höchstens auf die Hälfte (aufgerundet)
  const iv = (min, done, total, speedup = true) => pingIntervalMs({ pingIntervalMin: min, pingSpeedup: speedup }, done, total) / MIN;
  assert.deepEqual([0, 1, 2, 3, 4].map((k) => iv(5, k, 4)), [5, 4.5, 4, 3.5, 3]);
  assert.deepEqual([0, 1, 2, 3, 4].map((k) => iv(4, k, 4)), [4, 3.5, 3, 2.5, 2]);
  assert.equal(iv(1, 3, 3), 1, '1 Minute bleibt 1 Minute');
  assert.equal(iv(5, 4, 4, false), 5, 'ausgeschaltet: immer gleich');
  assert.equal(iv(5, 0, 0), 5, 'ohne Zonenstufen: immer gleich');

  // Im Spiel: nach Stufe 1 von 2 kommt der nächste Ping schneller
  const g = new Game('SPAN');
  const host = g.addPlayer('Host');
  const a = g.addPlayer('Anna');
  const b = g.addPlayer('Ben');
  const c = g.addPlayer('Cleo');
  const e = g.addPlayer('Emil');
  g.setRole(host.id, host.id, 'hunter');
  g.updateSettings(host.id, { headStartMin: 0, durationMin: 60, pingIntervalMin: 4, shrinkSteps: 2, comebackAt: 2, finaleSec: 90, pingTrail: 3 });
  for (const p of [host, a, b, c, e]) g.updatePos(p.id, north(0));
  g.start(host.id);
  const t0 = g.timers.huntStartAt;
  g.tick(t0); // erster Ping zu Beginn
  assert.equal(g.timers.nextPingAt - t0, 4 * MIN);
  g.tick(g.zoneStages[0].at); // Stufe 1 von 2
  const afterStage = g.zoneStages[0].at;
  g.tick(g.timers.nextPingAt);
  const pingAt = g.lastPing.at;
  assert.equal(g.timers.nextPingAt - pingAt, 3 * MIN, 'nach Stufe 1 von 2: 3 statt 4 Minuten');
  assert.ok(afterStage <= pingAt);

  // Ping-Spur: Jäger sehen die früheren Ping-Punkte, ältester zuerst, höchstens pingTrail - 1
  g.updatePos(a.id, north(100));
  g.ping(g.lastPing.at + 1000);
  g.updatePos(a.id, north(200));
  g.ping(g.lastPing.at + 1000);
  g.updatePos(a.id, north(300));
  g.ping(g.lastPing.at + 1000);
  g.players.get(a.id).signalLost = false; // der Test ist zeitlich vorgesprungen, Anna sendet aber
  const seenA = g.view(host.id).players.find((p) => p.id === a.id);
  assert.equal(seenA.kind, 'ping');
  assert.equal(seenA.pingTrail.length, 2, 'bei 3: aktueller Ping + 2 frühere');
  assert.ok(seenA.pingTrail[0][0] < seenA.pingTrail[1][0] && seenA.pingTrail[1][0] < seenA.pos.lat, 'ältester zuerst, dann der aktuelle Punkt');
  assert.equal(g.view(b.id).players.find((p) => p.id === a.id).pingTrail, undefined, 'Hider sehen keine Ping-Spur');
  g.settings.pingTrail = 0;
  assert.equal(g.view(host.id).players.find((p) => p.id === a.id).pingTrail, undefined, 'ausgeschaltet');
  g.settings.pingTrail = 3;

  // Bonus-Joker: sobald nur noch 2 Hider frei sind, bekommt jeder einmal Tarnkappe oder Doppelgänger
  const jokersBefore = new Map([a, b, c, e].map((p) => [p.id, g.players.get(p.id).jokers.length]));
  g.catchHider(host.id, g.players.get(a.id).catchCode);
  g.tick(Date.now());
  assert.equal(g.players.get(b.id).jokers.length, jokersBefore.get(b.id), 'bei 3 freien Hidern noch nichts');
  g.catchHider(host.id, g.players.get(b.id).catchCode);
  g.events.length = 0;
  g.tick(Date.now());
  for (const p of [c, e]) {
    const pj = g.players.get(p.id).jokers;
    assert.equal(pj.length, jokersBefore.get(p.id) + 1, `${p.name} bekommt einen Bonus-Joker`);
    assert.ok(['cloak', 'decoy'].includes(pj.at(-1)));
  }
  assert.ok(g.events.some((ev) => ev.to === 'all' && /Bonus-Joker/.test(ev.text)));
  g.tick(Date.now());
  assert.equal(g.players.get(c.id).jokers.length, jokersBefore.get(c.id) + 1, 'nur einmal pro Runde');

  // Finale: in den letzten 90 s sind alle freien Hider für die Jäger live sichtbar
  g.updatePos(c.id, north(700));
  g.updatePos(e.id, north(800));
  const before = g.timers.endAt - 91_000;
  g.tick(before);
  assert.notEqual(g.view(host.id, before).players.find((p) => p.id === c.id).kind, 'finale');
  g.events.length = 0;
  const fin = g.timers.endAt - 90_000;
  g.tick(fin);
  assert.ok(g.events.some((ev) => ev.to === 'all' && /Finale/.test(ev.text)));
  for (const p of [c, e]) {
    const seen = g.view(host.id, fin).players.find((x) => x.id === p.id);
    assert.equal(seen.kind, 'finale', `${p.name} ist live sichtbar`);
    assert.ok(seen.pos && Math.abs(distanceM(VS, seen.pos) - distanceM(VS, north(p.id === c.id ? 700 : 800))) < 2);
  }

  // Ausgeschaltet: kein Finale, keine Bonus-Joker
  const off = new Game('AUSS');
  const oh = off.addPlayer('Host');
  const ox = ['X1', 'X2', 'X3'].map((n) => off.addPlayer(n));
  off.setRole(oh.id, oh.id, 'hunter');
  off.updateSettings(oh.id, { headStartMin: 0, finaleSec: 0, comebackAt: 0 });
  off.start(oh.id);
  const jx = off.players.get(ox[1].id).jokers.length;
  off.catchHider(oh.id, off.players.get(ox[0].id).catchCode);
  off.tick(off.timers.endAt - 30_000);
  assert.equal(off.players.get(ox[1].id).jokers.length, jx);
  assert.notEqual(off.view(oh.id, off.timers.endAt - 30_000).players.find((p) => p.id === ox[1].id).kind, 'finale');

  // Startet die Runde schon mit höchstens 2 Hidern, gibt es keinen Bonus
  const small = new Game('KLEI');
  const sh = small.addPlayer('Host');
  const s1 = small.addPlayer('S1');
  small.addPlayer('S2');
  small.setRole(sh.id, sh.id, 'hunter');
  small.updateSettings(sh.id, { headStartMin: 0, hiderJokers: 0 });
  small.start(sh.id);
  small.tick(Date.now());
  assert.equal(small.players.get(s1.id).jokers.length, 0);
  console.log('✓ Ping-Spur, schnellere Pings, Finale, Bonus-Joker');
}

// "Ich spiele zum ersten Mal": der Server übernimmt die empfohlenen Werte unverändert
function firstTimeTests() {
  const g = new Game('ERST');
  const host = g.addPlayer('Host');
  const center = { lat: 48.3953, lng: 10.0005, radius: 2500 };
  g.updateSettings(host.id, { zone: center, finalMode: 'custom', eventsMode: 'often', infection: false });
  assert.equal(isFirstTime(g.settings), false);
  g.updateSettings(host.id, firstTimeUpdate(g.settings.zone));
  for (const [k, v] of Object.entries(FIRST_TIME_SETTINGS)) assert.deepEqual(g.settings[k], v, `Einstellung ${k}`);
  assert.deepEqual(g.settings.zone, { lat: center.lat, lng: center.lng, radius: 1200 }, 'Mitte bleibt, Größe 1,2 km');
  assert.equal(isFirstTime(g.settings), true);
  // Gestartete Runde: 4 Stufen von 1200 m auf 300 m, Endzone zufällig innerhalb
  const p = g.addPlayer('Hider');
  g.setRole(host.id, host.id, 'hunter');
  g.start(host.id);
  assert.equal(g.zoneStages.length, 4);
  assert.deepEqual(g.zoneStages.map((z) => z.radius), [975, 750, 525, 300]);
  void p;
  console.log('✓ Ich spiele zum ersten Mal');
}

// "Andere Jäger als letzte Runde": möglichst niemand, der zuletzt Jäger war
function rerollTests() {
  const g = new Game('NEUJ');
  const [host, b, c, d, e] = ['Host', 'B', 'C', 'D', 'E'].map((n) => g.addPlayer(n));
  assert.equal(g.view(host.id).canAvoidLastHunters, false, 'vor der ersten Runde gibt es keine letzten Jäger');
  g.setRole(host.id, host.id, 'hunter');
  g.setRole(host.id, b.id, 'hunter');
  g.updateSettings(host.id, { headStartMin: 0 });
  g.start(host.id);
  g.forceEnd(host.id);
  g.backToLobby(host.id);
  assert.equal(g.view(host.id).canAvoidLastHunters, true);
  assert.equal(g.view(c.id).canAvoidLastHunters, false, 'nur der Spielleiter bekommt den Knopf');
  for (let i = 0; i < 30; i++) {
    g.randomizeRoles(host.id, 2, { avoidLast: true });
    const hunters = [...g.players.values()].filter((p) => p.role === 'hunter').map((p) => p.name).sort();
    assert.equal(hunters.length, 2);
    assert.ok(!hunters.includes('Host') && !hunters.includes('B'), `wieder dieselben Jäger: ${hunters}`);
  }
  // Mehr Jäger als "neue" Spieler: alle neuen werden Jäger, der Rest aus den letzten
  g.randomizeRoles(host.id, 4, { avoidLast: true });
  const hunters = [...g.players.values()].filter((p) => p.role === 'hunter').map((p) => p.name);
  for (const n of ['C', 'D', 'E']) assert.ok(hunters.includes(n));
  assert.equal(hunters.length, 4);
  // Merker der letzten Jäger bleibt beim Auslosen gleich (bezieht sich auf die gespielte Runde)
  g.randomizeRoles(host.id, 2, { avoidLast: true });
  assert.ok(![...g.players.values()].some((p) => p.role === 'hunter' && ['Host', 'B'].includes(p.name)));
  void d;
  void e;
  console.log('✓ Andere Jäger als letzte Runde');
}

// Gruppen-Passwörter: Liste aus GUEST_PASSWORDS lesen und Passwörter zuordnen
function accessTests() {
  assert.deepEqual(parseGuestPasswords(''), []);
  assert.deepEqual(parseGuestPasswords(' A : eins ,B:zwei:drei, kaputt, :leer, C: ,'), [
    { name: 'A', password: 'eins' },
    { name: 'B', password: 'zwei:drei' },
  ]);
  const access = createAccess({ mainPassword: 'Haupt-Test', guestPasswords: parseGuestPasswords('REHE:rehe-test, NEU_ULM:neuulm>test, DOPPELT:haupt-test') });
  assert.deepEqual(access.check(' haupt-test '), { kind: 'main' }, 'Hauptpasswort gewinnt bei Gleichheit');
  assert.deepEqual(access.check('Rehe-Test'), { kind: 'guest', group: 'REHE' });
  assert.deepEqual(access.check('neuulm>TEST'), { kind: 'guest', group: 'NEU_ULM' });
  assert.equal(access.check('falsch'), null);
  assert.equal(access.check(''), null);
  assert.equal(access.check(undefined), null);
  console.log('✓ Gruppen-Passwörter');
}

function crushTests() {
  const north = (m) => ({ lat: VS.lat + m / 111320, lng: VS.lng, acc: 5 });
  const g = new Game('LOVE');
  const host = g.addPlayer('Host');
  const romeo = g.addPlayer('Romeo');
  const julia = g.addPlayer('Julia');
  const other = g.addPlayer('Tybalt');
  g.setRole(host.id, host.id, 'hunter');
  g.setRole(host.id, romeo.id, 'hunter');
  g.updateSettings(host.id, { headStartMin: 0, pingIntervalMin: 30 });

  assert.throws(() => g.setCrush(romeo.id, romeo.id, julia.id), /Spielleiter/);
  assert.throws(() => g.setCrush(host.id, romeo.id, romeo.id), /zwei verschiedene/);
  assert.throws(() => g.setCrush(host.id, romeo.id, 'gibtsnicht'), /nicht gefunden/);
  g.setCrush(host.id, romeo.id, julia.id);

  // Geheim: nur das Paar und der Spielleiter wissen davon
  assert.equal(g.view(romeo.id).crush.partnerName, 'Julia');
  assert.equal(g.view(julia.id).crush.partnerName, 'Romeo');
  assert.deepEqual(g.view(host.id).crushPair, [romeo.id, julia.id]);
  assert.equal(g.view(other.id).crush, null);
  assert.equal(g.view(other.id).crushPair, null);
  assert.equal(g.view(romeo.id).crushPair, null, 'nur der Spielleiter sieht das Paar als Einstellung');

  for (const [p, m] of [[host, 0], [romeo, 0], [julia, 900], [other, 900]]) g.updatePos(p.id, north(m));
  g.start(host.id);
  assert.ok(g.events.some((e) => e.to === romeo.id && e.text.includes('Julia')), 'Romeo erfährt vom Crush');
  g.tick(Date.now());
  g.updatePos(julia.id, north(950)); // nach dem Ping bewegt

  // Jäger-Romeo sieht Hider-Julia live, die Jägerin Host nur den alten Ping
  const rj = g.view(romeo.id).players.find((p) => p.id === julia.id);
  assert.equal(rj.kind, 'crush');
  assert.ok(Math.abs(distanceM(VS, rj.pos) - distanceM(VS, north(950))) < 2, 'live, nicht der Ping');
  const hj = g.view(host.id).players.find((p) => p.id === julia.id);
  assert.notEqual(hj.kind, 'crush');
  // Hider-Julia sieht Jäger-Romeo live, aber keinen anderen Jäger
  const jv = g.view(julia.id).players;
  assert.equal(jv.find((p) => p.id === romeo.id).kind, 'crush');
  assert.equal(jv.find((p) => p.id === host.id).pos, null);

  // Fangschutz: Romeo kann Julia weder per Code noch per Streitfall fangen
  assert.throws(() => g.catchHider(romeo.id, g.players.get(julia.id).catchCode), /Crush/);
  assert.throws(() => g.reportDispute(romeo.id, julia.id), /Crush/);
  // ... andere Jäger schon
  g.catchHider(romeo.id, g.players.get(other.id).catchCode);
  g.catchHider(host.id, g.players.get(julia.id).catchCode);
  assert.equal(g.result.winner, 'hunters');

  // Paar bleibt für die nächste Runde, lässt sich entfernen, verschwindet wenn jemand geht
  g.backToLobby(host.id);
  assert.deepEqual(g.crush, [romeo.id, julia.id]);
  g.setCrush(host.id, null, null);
  assert.equal(g.crush, null);
  g.setCrush(host.id, romeo.id, julia.id);
  g.kick(host.id, julia.id);
  assert.equal(g.crush, null);
  g.setCrush(host.id, romeo.id, other.id);
  g.start(host.id);
  assert.throws(() => g.setCrush(host.id, romeo.id, host.id), /Lobby/);
  console.log('✓ Crush');
}

function disputeTests() {
  const g = new Game('STRT');
  const host = g.addPlayer('Leiter');
  const j = g.addPlayer('Jaeger');
  const h1 = g.addPlayer('Lea');
  const h2 = g.addPlayer('Tom');
  g.setRole(host.id, host.id, 'hunter');
  g.setRole(host.id, j.id, 'hunter');
  // Fangregel
  assert.equal(g.settings.catchRule, 'touch');
  g.updateSettings(host.id, { catchRule: 'arm' });
  assert.equal(g.settings.catchRule, 'arm');
  g.updateSettings(host.id, { catchRule: 'quatsch' });
  assert.equal(g.settings.catchRule, 'arm', 'ungültige Regel wird ignoriert');
  g.updateSettings(host.id, { headStartMin: 0 });
  for (const p of [host, j, h1, h2]) g.updatePos(p.id, near(50));
  g.start(host.id);
  g.tick(Date.now());

  assert.throws(() => g.reportDispute(h2.id, h1.id), /Nur Jäger/);
  g.reportDispute(j.id, h1.id);
  assert.throws(() => g.reportDispute(host.id, h1.id), /schon ein Streitfall/);
  assert.throws(() => g.reportDispute(j.id, h2.id), /schon einen offenen/);
  // Sichtbarkeit: Spielleiter sieht Streitfall mit Abstand, Beteiligte ohne, Unbeteiligte gar nicht
  const hv = g.view(host.id).disputes;
  assert.equal(hv.length, 1);
  assert.equal(typeof hv[0].distance, 'number');
  assert.equal(g.view(h1.id).disputes[0].mine, 'hider');
  assert.equal(g.view(h1.id).disputes[0].distance, null);
  assert.equal(g.view(h2.id).disputes.length, 0);
  // nur der Spielleiter entscheidet
  assert.throws(() => g.resolveDispute(j.id, hv[0].id, true), /Spielleiter/);
  g.resolveDispute(host.id, hv[0].id, false);
  assert.equal(g.players.get(h1.id).status, 'alive', 'Nein = spielt weiter');

  g.reportDispute(j.id, h1.id);
  g.resolveDispute(host.id, g.view(host.id).disputes[0].id, true);
  assert.equal(g.players.get(h1.id).status, 'caught', 'Ja = gefangen');
  assert.equal(g.players.get(h1.id).caughtBy, 'Jaeger');

  // ohne Entscheidung läuft der Streitfall nach 2 Minuten ab
  g.reportDispute(host.id, h2.id);
  g.tick(Date.now() + 2 * 60_000 + 1000);
  assert.equal(g.view(host.id).disputes.length, 0);
  assert.equal(g.players.get(h2.id).status, 'alive');

  // Fangen per Code räumt einen offenen Streitfall weg
  g.reportDispute(host.id, h2.id);
  g.catchHider(j.id, g.players.get(h2.id).catchCode);
  assert.equal(g.disputes.length, 0);
  assert.equal(g.result.winner, 'hunters');
  console.log('✓ Fangregel & Streitfälle');
}

function eventTests() {
  const MIN = 60_000;
  // Anzahl und Zeitplan
  const S = (o) => ({ ...DEFAULT_SETTINGS, ...o });
  assert.equal(eventCount(S({ eventsMode: 'off' })), 0);
  assert.equal(eventCount(S({ eventsMode: 'rare', durationMin: 60 })), 2);
  assert.equal(eventCount(S({ eventsMode: 'often', durationMin: 60 })), 4);
  assert.equal(eventCount(S({ eventsMode: 'often', durationMin: 120 })), 5);
  assert.equal(eventCount(S({ eventsMode: 'rare', durationMin: 20 })), 1);
  for (let i = 0; i < 100; i++) {
    const plan = planEvents(S({ eventsMode: 'often', durationMin: 60 }), 0, 60 * MIN);
    assert.equal(new Set(plan.map((e) => e.type)).size, plan.length, 'kein Event doppelt');
    for (const e of plan) assert.ok(e.at >= 10 * MIN && e.at <= 55 * MIN, 'nicht in den ersten 10 / letzten 5 min');
    for (let k = 1; k < plan.length; k++) assert.ok(plan[k].at - plan[k - 1].at >= 6 * MIN - 1, 'mind. 6 min Abstand');
  }

  const setup = (hunters = 2) => {
    const g = new Game('EVNT');
    const ps = ['Leiter', 'J2', 'Lea', 'Tom', 'Mia'].map((n) => g.addPlayer(n));
    for (let i = 0; i < hunters; i++) g.setRole(ps[0].id, ps[i].id, 'hunter');
    g.updateSettings(ps[0].id, { headStartMin: 0, pingIntervalMin: 4, eventsMode: 'often', hiderJokers: 0 });
    for (const p of ps) g.updatePos(p.id, near(200));
    g.start(ps[0].id);
    g.eventPlan = []; // Zeitplan im Test selbst steuern
    g.tick(Date.now());
    return { g, ps, host: ps[0], hiders: ps.filter((p) => p.role === 'hider') };
  };

  // Joker-Regen
  {
    const { g, hiders } = setup();
    const pool = Object.values(g.hunterPool).reduce((a, b) => a + b, 0);
    g.runEvent('jokerRain');
    assert.ok(hiders.every((h) => g.players.get(h.id).jokers.length === 1), 'jeder Hider +1 Joker');
    assert.equal(Object.values(g.hunterPool).reduce((a, b) => a + b, 0), pool + 1, 'Jäger +1 Team-Joker');
    assert.equal(g.lastEvent.type, 'jokerRain');
  }
  // Jagdfieber
  {
    const { g } = setup();
    const now = Date.now();
    g.runEvent('fever', now);
    assert.ok(g.timers.nextPingAt <= now + 30_000, 'nächster Ping vorgezogen');
    g.tick(g.timers.nextPingAt);
    const after = g.timers.nextPingAt - g.lastPing.at;
    assert.equal(after, 2 * MIN, 'Ping-Abstand halbiert (4 → 2 min)');
  }
  // Nebel
  {
    const { g, host, hiders } = setup();
    g.runEvent('fog');
    g.ping(Date.now());
    const v = g.view(host.id).players.find((p) => p.id === hiders[0].id);
    assert.equal(v.fog, 100, 'Ping ist ein Kreis');
    assert.ok(distanceM(v.pos, g.players.get(hiders[0].id).pos) <= 80, 'echter Ort liegt im Kreis');
    g.ping(Date.now());
    assert.equal(g.view(host.id).players.find((p) => p.id === hiders[0].id).fog, undefined, 'nur ein Ping');
  }
  // Kopfgeld: gefangen → Jäger bekommen Joker; überlebt → Hider bekommt Joker
  {
    const { g, host } = setup();
    g.runEvent('bounty');
    const target = g.players.get(g.bounty.targetId);
    assert.equal(g.view(host.id).players.find((p) => p.id === target.id).kind, 'bounty');
    const pool = Object.values(g.hunterPool).reduce((a, b) => a + b, 0);
    g.catchHider(host.id, target.catchCode);
    assert.equal(Object.values(g.hunterPool).reduce((a, b) => a + b, 0), pool + 1);
    assert.equal(g.bounty, null);
  }
  {
    const { g } = setup();
    g.runEvent('bounty');
    const target = g.players.get(g.bounty.targetId);
    g.tick(g.bounty.until + 1);
    assert.equal(target.jokers.length, 1, 'überlebt → Joker');
  }
  // Rollentausch mit Schutz
  {
    const { g, host } = setup(2);
    g.runEvent('swap');
    const swapped = [...g.players.values()].find((p) => p.protectedUntil > 0);
    assert.ok(swapped && swapped.role === 'hider' && /^\d{4}$/.test(swapped.catchCode));
    assert.equal(swapped.startRole, 'hunter', 'Auswertung: war Jäger');
    const catcher = [...g.players.values()].find((p) => p.role === 'hunter');
    assert.throws(() => g.catchHider(catcher.id, swapped.catchCode), /geschützt/);
    g.ping(Date.now());
    assert.equal(g.view(catcher.id).players.find((p) => p.id === swapped.id).kind, 'protected');
    g.tick(swapped.protectedUntil + 1);
    assert.equal(swapped.protectedUntil, 0);
    g.catchHider(catcher.id, swapped.catchCode);
    assert.equal(swapped.status, 'caught');
    g.end(null, 'Test');
    g.backToLobby(host.id);
    assert.equal(swapped.role, 'hunter', 'nächste Runde wieder Jäger');
  }
  // Rollentausch mit nur einem Jäger → anderes Event
  {
    const { g } = setup(1);
    g.runEvent('swap');
    assert.notEqual(g.lastEvent.type, 'swap');
    assert.ok([...g.players.values()].filter((p) => p.role === 'hunter').length === 1);
  }
  // Events laufen automatisch zum geplanten Zeitpunkt
  {
    const { g } = setup();
    const at = Date.now() + 1000;
    g.eventPlan = [{ type: 'jokerRain', at, done: false }];
    g.emit('all', 'irgendeine Meldung');
    g.events.splice(0); // wie der Server, der jede Sekunde die Meldungen verschickt
    g.tick(at - 10);
    assert.equal(g.lastEvent, null);
    g.tick(at);
    assert.equal(g.lastEvent.type, 'jokerRain');
  }
  console.log('✓ Special Events');
}

function client(port) {
  const s = io(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
  s.state = null;
  s.toasts = [];
  s.on('state', (v) => (s.state = v));
  s.on('toast', (t) => s.toasts.push(t.text));
  s.call = (ev, data = {}) => new Promise((res) => s.emit(ev, data, res));
  return s;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 5000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (fn()) return;
    await wait(50);
  }
  throw new Error('Timeout beim Warten');
}

async function serverTest() {
  const port = 3999;
  const srv = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), CREATE_PASSWORD: 'Haupt-Test', DATA_FILE: path.join(os.tmpdir(), `manhunt-test-${process.pid}.json`) }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((res) => srv.stdout.on('data', (d) => String(d).includes('läuft') && res()));
  const clients = [];
  try {
    const host = client(port);
    clients.push(host);
    const pw = 'Haupt-Test';
    let r = await host.call('create', { name: 'Spielleiter' });
    assert.ok(!r.ok && /Passwort/.test(r.error), 'ohne Passwort darf kein Spiel entstehen');
    r = await host.call('create', { name: 'Spielleiter', password: 'falsch' });
    assert.ok(!r.ok && /Passwort/.test(r.error), 'falsches Passwort muss abgelehnt werden');
    r = await host.call('create', { name: 'Spielleiter', password: ` ${pw.toLowerCase()} ` });
    assert.ok(r.ok, r.error);
    await until(() => host.state);
    const code = host.state.code;

    for (let i = 1; i < 30; i++) {
      const c = client(port);
      clients.push(c);
      const jr = await c.call('join', { code, name: `Spieler ${i}` });
      assert.ok(jr.ok, jr.error);
    }
    await until(() => host.state.players.length === 30);
    const bad = client(port);
    clients.push(bad);
    assert.equal((await bad.call('join', { code: 'ZZZZ', name: 'x' })).ok, false);
    assert.equal((await clients[1].call('start')).ok, false, 'Nicht-Host darf nicht starten');

    assert.ok((await host.call('settings', { headStartMin: 0, pingIntervalMin: 1 })).ok);
    assert.ok((await host.call('randomize', { hunters: 6 })).ok);
    for (const c of clients.slice(0, 30)) c.emit('pos', near());
    await wait(300);
    assert.ok((await host.call('start')).ok);
    await until(() => clients.slice(0, 30).every((c) => c.state?.phase === 'hunt'));
    await until(() => host.state.lastPingAt != null, 3000);
    await wait(300);

    const hunters = clients.slice(0, 30).filter((c) => c.state.me.role === 'hunter');
    const hiders = clients.slice(0, 30).filter((c) => c.state.me.role === 'hider');
    assert.equal(hunters.length, 6);
    assert.equal(hiders.length, 24);
    const hv = hunters[0].state.players.filter((p) => p.role === 'hider');
    assert.ok(hv.every((p) => p.kind === 'ping' && p.pos), 'Jäger sieht alle Hider beim Ping');
    assert.ok(hv.every((p) => !('catchCode' in p)), 'Fang-Codes werden nicht verraten');
    const sv = hiders[0].state.players.filter((p) => p.role === 'hunter');
    assert.ok(sv.every((p) => p.pos === null), 'Hider sehen keine Jäger');

    // Alle Hider fangen
    for (const h of hiders) {
      const res = await hunters[0].call('catch', { code: h.state.me.catchCode });
      assert.ok(res.ok, res.error);
    }
    await until(() => host.state.phase === 'ended');
    assert.equal(host.state.result.winner, 'hunters');
    const trails = await host.call('trails');
    assert.ok(trails.ok && trails.players.length === 30);

    // Chat: Team-Kanäle
    assert.ok((await host.call('lobby')).ok);
    const got = [];
    clients[2].on('chat', (m) => got.push(m));
    assert.ok((await clients[1].call('chat', { channel: 'all', text: 'Hallo' })).ok);
    await until(() => got.length === 1);

    // Wiederverbinden mit Sitzung
    let session;
    const c = client(port);
    c.on('session', (s) => (session = s));
    await c.call('join', { code, name: 'Wiederkehrer' });
    await until(() => session);
    c.close();
    const c2 = client(port);
    clients.push(c2);
    assert.ok((await c2.call('resume', session)).ok);
    assert.equal((await c2.call('resume', { ...session, token: 'falsch' })).ok, false);

    // Eine alte, nur erneut gesendete Position darf nicht als frisch gelten:
    // das Handy schickt mit, wie alt die Messung ist.
    c2.emit('pos', { lat: 48.07, lng: 8.46, acc: 10, age: 180_000, background: true });
    await until(() => c2.state?.players.find((p) => p.id === session.playerId)?.pos?.lat === 48.07);
    const stalePos = c2.state.players.find((p) => p.id === session.playerId);
    assert.ok(Date.now() - stalePos.pos.t > 170_000, `Alter der Position wird übernommen (war ${Date.now() - stalePos.pos.t} ms)`);
    assert.equal(stalePos.hasGps, false, '3 Minuten alte Position zählt nicht als GPS');
    assert.equal(stalePos.background, false, 'Hintergrund-Flag kann nicht über den Browser gesetzt werden');
    await wait(1100); // Server nimmt höchstens eine Position pro Sekunde an
    c2.emit('pos', { lat: 48.071, lng: 8.46, acc: 10, age: 500 });
    await until(() => c2.state?.players.find((p) => p.id === session.playerId)?.pos?.lat === 48.071);
    assert.ok(Date.now() - c2.state.players.find((p) => p.id === session.playerId).pos.t < 5000, 'frische Position gilt als frisch');
    // Hintergrund-Ortung über OwnTracks (HTTP-Modus mit Basic-Auth)
    const ot = (user, pass, body) =>
      fetch(`http://localhost:${port}/owntracks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` },
        body: JSON.stringify(body),
      });
    const otPos = { _type: 'location', lat: 48.061, lon: 8.459, acc: 12, tst: Math.floor(Date.now() / 1000), tid: 'WK' };
    const wrongAuth = await ot(session.playerId, 'falsch', { ...otPos, lat: 10 });
    assert.equal(wrongAuth.status, 200);
    assert.deepEqual(await wrongAuth.json(), []);
    assert.equal((await ot(session.playerId, session.token, otPos)).status, 200);
    await until(() => c2.state?.players.find((p) => p.id === session.playerId)?.background);
    const mePos = c2.state.players.find((p) => p.id === session.playerId).pos;
    assert.equal(mePos.lat, 48.061, 'OwnTracks-Position übernommen');
    // ältere, nachgelieferte Position überschreibt die neuere nicht
    await ot(session.playerId, session.token, { ...otPos, lat: 48.0, tst: otPos.tst - 600 });
    await wait(300);
    assert.equal(c2.state.players.find((p) => p.id === session.playerId).pos.lat, 48.061);
    // leerer Body und kaputtes JSON werden still ignoriert
    assert.equal((await fetch(`http://localhost:${port}/owntracks`, { method: 'POST', body: '' })).status, 200);
    assert.equal((await fetch(`http://localhost:${port}/owntracks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{kaputt' })).status, 200);
    console.log('✓ Hintergrund-Ortung (OwnTracks)');
    console.log('✓ Server mit 30 Spielern');
  } finally {
    clients.forEach((c) => c.close());
    srv.kill();
  }
}

logicTests();
zoneTests();
disputeTests();
eventTests();
trophyTests();
crushTests();
guestTests();
accessTests();
rerollTests();
firstTimeTests();
tensionTests();
await serverTest();
console.log('Alle Tests bestanden.');
process.exit(0);
