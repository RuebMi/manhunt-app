// Simuliert zwei Mini-Partien mit 6 Spielern gegen einen echten Server und
// prüft dabei jede Fähigkeit. Dauer: ca. 8 Minuten.
// Aufruf: node test/simulation.js
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { io } from 'socket.io-client';
import { distanceM } from '../server/game.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 3100;
const URL = `http://localhost:${PORT}`;
const VS = { lat: 48.0603, lng: 8.4586 };
const t0 = Date.now();
const results = [];

const stamp = () => {
  const s = Math.round((Date.now() - t0) / 1000);
  return `[${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}]`;
};
const log = (msg) => console.log(`${stamp()} ${msg}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${stamp()}   ${ok ? '✅' : '❌'} ${name}${detail ? ` – ${detail}` : ''}`);
}
const offset = (p, north, east) => ({ lat: p.lat + north / 111320, lng: p.lng + east / (111320 * Math.cos((p.lat * Math.PI) / 180)) });

class Player {
  constructor(name, pos) {
    this.name = name;
    this.pos = pos;
    this.sending = true;
    this.state = null;
    this.toasts = [];
    this.chat = [];
    this.s = io(URL, { transports: ['websocket'], forceNew: true });
    this.s.on('state', (v) => (this.state = v));
    this.s.on('toast', (t) => this.toasts.push({ at: Date.now(), text: t.text }));
    this.s.on('chat', (m) => this.chat.push(m));
    // wie ein Handy mit offener Seite: alle 2 s die Position senden
    this.timer = setInterval(() => this.sending && this.s.emit('pos', { ...this.pos, acc: 8 }), 2000);
  }
  call(ev, data = {}) {
    return new Promise((res) => this.s.emit(ev, data, res));
  }
  sendNow() {
    this.s.emit('pos', { ...this.pos, acc: 8 });
  }
  get me() {
    return this.state.me;
  }
  view(name) {
    return this.state.players.find((p) => p.name === name);
  }
  gotToast(re, since = 0) {
    return this.toasts.some((t) => t.at >= since && re.test(t.text));
  }
  async waitFor(fn, ms = 10000) {
    const start = Date.now();
    while (Date.now() - start < ms) {
      if (this.state && fn(this.state)) return true;
      await wait(100);
    }
    return false;
  }
  close() {
    clearInterval(this.timer);
    this.s.close();
  }
}

async function main() {
  const srv = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), CREATE_PASSWORD: 'Haupt-Test', DATA_FILE: path.join(os.tmpdir(), `manhunt-sim-${process.pid}.json`) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((res) => srv.stdout.on('data', (d) => String(d).includes('läuft') && res()));
  const all = [];
  try {
    // ---------------------------------------------------------------- Aufbau
    log('🎬 Aufbau: 2 Jäger, 4 Hider rund um die Villinger Innenstadt');
    const boss = new Player('Spielleiter', offset(VS, 0, 0));
    const j2 = new Player('Jäger2', offset(VS, 100, 0));
    const A = new Player('Hider-A', offset(VS, 300, 200));
    const B = new Player('Hider-B', offset(VS, -400, 100));
    const C = new Player('Hider-C', offset(VS, 200, -500));
    const D = new Player('Hider-D', offset(VS, -150, -250));
    all.push(boss, j2, A, B, C, D);
    const hiders = [A, B, C, D];
    await boss.call('create', { name: boss.name, password: 'Haupt-Test' });
    await boss.waitFor((v) => v.code);
    const code = boss.state.code;
    for (const p of [j2, ...hiders]) await p.call('join', { code, name: p.name });
    await boss.waitFor((v) => v.players.length === 6);
    for (const p of all) p.sendNow();
    await boss.call('setRole', { playerId: boss.me.id, role: 'hunter' });
    await boss.call('setRole', { playerId: boss.view('Jäger2').id, role: 'hunter' });
    await boss.call('settings', {
      durationMin: 5, headStartMin: 1, pingIntervalMin: 1, outGraceSec: 15,
      shrink: true, shrinkSteps: 3, finalRadius: 480, shrinkWarnMin: 1, finalMode: 'random',
      hiderJokers: 3, hunterExtraPings: 1, hunterDrones: 1, hunterSniffs: 1,
      zone: { ...VS, radius: 1200 }, infection: false,
    });
    check('Nicht-Spielleiter kann nicht starten', !(await A.call('start')).ok);
    await wait(500);
    check('Alle haben GPS in der Lobby', boss.state.players.every((p) => p.hasGps));

    // ---------------------------------------------------------------- Runde 1
    log('▶ RUNDE 1: 5 min, 1 min Vorsprung, Ping jede Minute, Zone 3 Stufen (verschiebt sich)');
    await boss.call('start');
    await boss.waitFor((v) => v.phase === 'headstart');
    check('Vorsprung läuft', boss.state.phase === 'headstart');
    check('Jäger sehen im Vorsprung keine Hider', hiders.every((h) => !boss.view(h.name).pos));
    check('Hider sehen keine Jäger', !A.view('Spielleiter').pos);
    check('Hider haben einen 4-stelligen Fang-Code', hiders.every((h) => /^\d{4}$/.test(h.me.catchCode)));
    check('Jäger sehen keine Fang-Codes', boss.me.catchCode === null && boss.state.players.every((p) => !('catchCode' in p)));
    check('Jeder Hider hat 3 Joker', hiders.every((h) => h.me.jokers.length === 3), A.me.jokers.join(', '));
    const early = await boss.call('catch', { code: A.me.catchCode });
    check('Fangen im Vorsprung ist gesperrt', !early.ok, early.error);
    check('Jäger-Joker im Vorsprung gesperrt', !(await boss.call('joker', { type: 'extraPing' })).ok);

    log('🃏 Hider-A setzt Tarnkappe, Hider-B Doppelgänger ein');
    check('Tarnkappe einsetzen', (await A.call('joker', { type: 'cloak' })).ok);
    check('Zweiter Joker für denselben Ping wird abgelehnt', !(await A.call('joker', { type: 'decoy' })).ok);
    check('Doppelgänger einsetzen', (await B.call('joker', { type: 'decoy' })).ok);

    log('⏳ Warte auf das Ende des Vorsprungs …');
    await boss.waitFor((v) => v.phase === 'hunt' && v.lastPingAt, 70000);
    const huntStart = boss.state.timers.huntStartAt;
    await wait(500);
    check('Jagd hat begonnen', boss.state.phase === 'hunt');
    check('Erster Ping kam beim Start der Jagd', Math.abs(boss.state.lastPingAt - huntStart) < 2000);
    check('Hider-A ist im Ping getarnt', boss.view('Hider-A').kind === 'cloaked' && !boss.view('Hider-A').pos);
    const bPing = boss.view('Hider-B').pos;
    const bOff = bPing ? distanceM(bPing, B.pos) : 0;
    check('Hider-B erscheint versetzt (Doppelgänger)', bOff >= 290 && bOff <= 610, `${Math.round(bOff)} m neben echtem Ort`);
    const cOff = distanceM(boss.view('Hider-C').pos, C.pos);
    check('Hider-C erscheint am echten Ort', cOff < 5, `${Math.round(cOff)} m Abweichung`);
    check('Hider bekommen eine Ping-Meldung', C.gotToast(/Ping/));

    log('🚶 Hider-C läuft 200 m – Jäger dürfen das bis zum nächsten Ping nicht sehen');
    C.pos = offset(C.pos, 200, 0);
    C.sendNow();
    await wait(2500);
    check('Jäger sehen weiter nur den alten Ping', distanceM(boss.view('Hider-C').pos, C.pos) > 150);

    log('📡 Hider-C setzt Radar ein');
    const radarSince = Date.now();
    check('Radar einsetzen', (await C.call('joker', { type: 'radar' })).ok);
    await C.waitFor((v) => v.players.some((p) => p.kind === 'radar'));
    check('Hider-C sieht die Jäger live', C.view('Spielleiter').kind === 'radar' && !!C.view('Spielleiter').pos);
    check('Hider-A sieht die Jäger nicht', !A.view('Spielleiter').pos);
    check('Jäger werden gewarnt', boss.gotToast(/scannt/, radarSince));

    log('🛰️ Spielleiter löst Sonder-Ping aus');
    const pingBefore = boss.state.lastPingAt;
    check('Sonder-Ping einsetzen', (await boss.call('joker', { type: 'extraPing' })).ok);
    await boss.waitFor((v) => v.lastPingAt !== pingBefore);
    check('Neuer Ping ist da', boss.state.lastPingAt !== pingBefore);
    check('Hider-A ist jetzt sichtbar (Tarnkappe verbraucht)', boss.view('Hider-A').kind === 'ping');
    check('Hider-C jetzt am neuen Ort', distanceM(boss.view('Hider-C').pos, C.pos) < 5);
    check('Sonder-Ping verbraucht', boss.state.hunterPool.extraPing === 0 && !(await j2.call('joker', { type: 'extraPing' })).ok);

    log('🚁 Jäger2 startet die Drohne');
    const droneSince = Date.now();
    check('Drohne einsetzen', (await j2.call('joker', { type: 'drone' })).ok);
    await boss.waitFor((v) => v.drone);
    const target = hiders.find((h) => h.name === boss.state.drone.name);
    check('Drohne verfolgt einen Hider', !!target, target?.name);
    check('Verfolgter Hider wird gewarnt', target?.gotToast(/Drohne/, droneSince));
    target.pos = offset(target.pos, 0, 150);
    target.sendNow();
    await wait(2500);
    check('Jäger sehen ihn live (auch nach Bewegung)', boss.view(target.name).kind === 'drone' && distanceM(boss.view(target.name).pos, target.pos) < 5);

    log('🐕 Spielleiter benutzt die Spürnase');
    const sniff = await boss.call('joker', { type: 'sniff' });
    const nearest = Math.min(...hiders.map((h) => distanceM(boss.pos, h.pos)));
    check('Spürnase meldet die richtige Entfernung', sniff.ok && Math.abs(sniff.meters - nearest) <= 50, `${sniff.meters} m (echt ${Math.round(nearest)} m)`);

    log('🏃 Hider-D verlässt die Zone');
    const outSince = Date.now();
    D.pos = offset(VS, -2000, 0);
    D.sendNow();
    await D.waitFor(() => D.gotToast(/außerhalb der Zone/, outSince), 5000);
    check('Hider-D wird gewarnt', D.gotToast(/außerhalb der Zone/, outSince));
    check('Noch nicht live sichtbar (15 s Schonfrist)', boss.view('Hider-D').kind !== 'exposed');
    await boss.waitFor((v) => v.players.find((p) => p.name === 'Hider-D').kind === 'exposed', 20000);
    check('Nach 15 s live für die Jäger sichtbar', boss.view('Hider-D').kind === 'exposed', `nach ${Math.round((Date.now() - outSince) / 1000)} s`);
    D.pos = offset(VS, -150, -250);
    D.sendNow();
    await boss.waitFor((v) => v.players.find((p) => p.name === 'Hider-D').kind !== 'exposed', 5000);
    check('Zurück in der Zone: nicht mehr live', boss.view('Hider-D').kind !== 'exposed');

    log('🟡 Prüfe die Zonen-Stufen');
    const firstStage = huntStart + 75_000;
    check('Vorwarnung für die neue Zone kam', A.gotToast(/Zone wird in 1 Minute kleiner/));
    check('Neue Zone ist angekündigt (gelber Kreis)', !!A.state.nextZone);
    const oldZone = A.state.zone;
    const announced = A.state.nextZone;
    if (Date.now() < firstStage) log(`   … warte ${Math.round((firstStage - Date.now()) / 1000)} s bis zur ersten Stufe`);
    await A.waitFor((v) => v.zone.radius < oldZone.radius, firstStage - Date.now() + 5000);
    const nz = A.state.zone;
    check('Zone ist geschrumpft', nz.radius < oldZone.radius, `${oldZone.radius} m → ${nz.radius} m`);
    check('Neue Zone liegt komplett in der alten', distanceM(oldZone, nz) + nz.radius <= oldZone.radius + 1, `Mitte um ${Math.round(distanceM(oldZone, nz))} m verschoben`);
    check('Neue Zone = angekündigte Zone', announced && Math.abs(announced.radius - nz.radius) < 1 && distanceM(announced, nz) < 1);
    check('Meldung „Zone ist jetzt kleiner“', A.gotToast(/Stufe 1 von 3/));
    // Hider zurück in die neue Zone holen, damit sie nicht live werden
    for (const h of hiders) {
      h.pos = offset(nz, (Math.random() - 0.5) * nz.radius * 0.5, (Math.random() - 0.5) * nz.radius * 0.5);
      h.sendNow();
    }

    log('💬 Team-Chat');
    await A.call('chat', { channel: 'hider', text: 'Treffen am Brunnen' });
    await wait(500);
    check('Hider-Nachricht kommt bei Hidern an', B.chat.some((m) => m.text === 'Treffen am Brunnen'));
    check('… aber nicht bei den Jägern', !boss.chat.some((m) => m.text === 'Treffen am Brunnen'));
    check('Jäger können nicht in den Hider-Chat schreiben', !(await boss.call('chat', { channel: 'hider', text: 'x' })).ok);

    log('🎯 Fangen');
    for (let i = 0; i < 5; i++) await j2.call('catch', { code: '0000' });
    const blocked = await j2.call('catch', { code: B.me.catchCode });
    check('Nach 5 falschen Codes kurz gesperrt', !blocked.ok && /Zu viele/.test(blocked.error), blocked.error);
    check('Hider kann nicht fangen', !(await C.call('catch', { code: B.me.catchCode })).ok);
    const catchA = await boss.call('catch', { code: A.me.catchCode });
    check('Spielleiter fängt Hider-A mit richtigem Code', catchA.ok);
    await A.waitFor((v) => v.me.status === 'caught');
    check('Hider-A ist Zuschauer und sieht die Jäger', A.me.spectator && A.view('Spielleiter').kind === 'ally');
    check('Alle bekommen die Fang-Meldung', C.gotToast(/hat Hider-A gefangen/));
    check('Hider-Zähler stimmt', boss.state.players.filter((p) => p.role === 'hider' && p.status === 'alive').length === 3);
    for (const h of [B, C, D]) await boss.call('catch', { code: h.me.catchCode });
    await boss.waitFor((v) => v.phase === 'ended');
    check('Alle gefangen → Jäger gewinnen', boss.state.result?.winner === 'hunters', boss.state.result?.reason);
    const trails = await boss.call('trails');
    check('Routen für die Auswertung vorhanden', trails.ok && trails.players.some((p) => p.trail.length > 1));

    // ---------------------------------------------------------------- Runde 2
    log('▶ RUNDE 2: Infektion an, kein Vorsprung, Zeit läuft ab (5 min), Hider-D verliert GPS');
    check('Zurück in die Lobby', (await boss.call('lobby')).ok);
    await boss.waitFor((v) => v.phase === 'lobby');
    check('Rollen sind wieder wie vorher', hiders.every((h) => h.me.role === 'hider'));
    await boss.call('settings', { headStartMin: 0, durationMin: 5, infection: true, shrink: false, outGraceSec: 300 });
    for (const h of hiders) {
      h.pos = offset(VS, (Math.random() - 0.5) * 800, (Math.random() - 0.5) * 800);
      h.sendNow();
    }
    await boss.call('start');
    await boss.waitFor((v) => v.phase === 'hunt');
    check('Ohne Vorsprung startet sofort die Jagd', boss.state.phase === 'hunt');
    D.sending = false;
    log('📵 Hider-D schaltet das Handy aus (sendet nichts mehr)');
    const lostSince = Date.now();

    await boss.call('catch', { code: A.me.catchCode });
    await A.waitFor((v) => v.me.role === 'hunter');
    check('Infektion: gefangener Hider-A wird Jäger', A.me.role === 'hunter');
    const infectedCatch = await A.call('catch', { code: B.me.catchCode });
    check('Infizierter Hider-A kann selbst fangen', infectedCatch.ok);

    log('⏳ Warte, bis Hider-D 2 Minuten kein GPS gesendet hat …');
    await boss.waitFor((v) => v.players.find((p) => p.name === 'Hider-D').kind === 'lost', 150000);
    check('Hider-D wird als „kein GPS“ markiert', boss.view('Hider-D').kind === 'lost', `nach ${Math.round((Date.now() - lostSince) / 1000)} s`);
    check('Jäger sehen den letzten Standort von Hider-D', !!boss.view('Hider-D').pos);
    check('Alle wurden informiert', C.gotToast(/sendet kein GPS/));

    log('⏳ Warte auf das Ende der Spielzeit …');
    await boss.waitFor((v) => v.phase === 'ended', boss.state.timers.endAt - Date.now() + 10000);
    check('Zeit abgelaufen → Hider gewinnen', boss.state.result?.winner === 'hiders', `Überlebt: ${boss.state.result?.survivors.join(', ')}`);
  } catch (e) {
    check('Simulation ohne Absturz', false, e.stack);
  } finally {
    all.forEach((p) => p.close());
    srv.kill();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} von ${results.length} Prüfungen bestanden.`);
  if (failed.length) console.log(`Fehlgeschlagen:\n${failed.map((f) => ` - ${f.name}`).join('\n')}`);
  process.exit(failed.length ? 1 : 0);
}

main();
