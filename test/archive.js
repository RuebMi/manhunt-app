// Testet den Datensatz einer Runde für "Bisherige Spiele".
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';
import { createArchive } from '../server/archive.js';
import { createLoginLog, shortIp, deviceName, cleanDevice } from '../server/logins.js';
import { Game, simplifyTrail, trailDistanceM, distanceM } from '../server/game.js';

const VS = { lat: 48.0603, lng: 8.4586 };
const north = (m) => ({ lat: VS.lat + m / 111320, lng: VS.lng });

function newRound({ minutes }) {
  const g = new Game('ARCH');
  const host = g.addPlayer('Host');
  const lea = g.addPlayer('Lea');
  const max = g.addPlayer('Max');
  g.setRole(host.id, host.id, 'hunter');
  g.setCrush(host.id, host.id, lea.id);
  g.start(host.id);
  g.timers.startedAt -= minutes * 60_000;
  return { g, host, lea, max };
}

function recordTests() {
  const { g, host, lea, max } = newRound({ minutes: 21 });
  const now = Date.now();
  [0, 5, 400].forEach((m, i) => g.updatePos(lea.id, { ...north(m), acc: 5, t: now - (3 - i) * 60_000 }));
  g.hunterPool.extraPing = 1;
  g.phase = 'hunt';
  g.useJoker(host.id, 'extraPing');
  g.runEvent('fog');
  g.markCaught(host, max, Date.now());
  g.forceEnd(host.id);

  const rec = g.pendingArchive;
  assert.ok(rec);
  const { summary, data } = rec;
  assert.equal(summary.winner, null);
  assert.ok(summary.durationMin >= 21);
  assert.equal(summary.hiderCount, 2);
  assert.equal(summary.hunterCount, 1);
  assert.equal(summary.id, `ARCH-1-${g.timers?.startedAt ?? summary.startedAt}`);

  const json = JSON.stringify(rec);
  for (const p of g.players.values()) {
    assert.ok(!json.includes(p.id), 'keine Spieler-IDs');
    if (p.catchCode) assert.ok(!json.includes(`"${p.catchCode}"`), 'kein Fangcode');
  }
  assert.ok(!/crush/i.test(json), 'kein Crush');

  const m = data.players.find((p) => p.name === 'Max');
  assert.equal(m.status, 'caught');
  assert.equal(m.caughtBy, 'Host');
  assert.equal(m.distanceM, 0);
  assert.deepEqual(data.trails.Max, []);

  const trail = data.trails.Lea;
  assert.ok(trail.length >= 2);
  for (let i = 1; i < trail.length - 1; i++) {
    const d = distanceM({ lat: trail[i - 1][0], lng: trail[i - 1][1] }, { lat: trail[i][0], lng: trail[i][1] });
    assert.ok(d >= 10, `Punkt ${i} nur ${d} m vom vorigen`);
  }
  const last = trail.at(-1);
  assert.ok(distanceM({ lat: last[0], lng: last[1] }, north(400)) < 3);
  for (const [lat, lng, t] of trail) {
    assert.ok(String(lat).split('.')[1].length <= 5 && String(lng).split('.')[1].length <= 5);
    assert.ok(Number.isInteger(t));
  }
  assert.ok(trail.at(-1)[2] >= 21 * 60, 'Zeit in Sekunden seit Start');

  assert.ok(data.jokersUsed.some((j) => j.name === 'Host' && j.type === 'extraPing'));
  assert.ok(data.events.some((e) => e.type === 'fog'));
  assert.equal(data.players.find((p) => p.name === 'Lea').trophy, null);
  console.log('✓ Datensatz');
}

function hunterWinTests() {
  const g = new Game('ARCH');
  const host = g.addPlayer('Host');
  const lea = g.addPlayer('Lea');
  const max = g.addPlayer('Max');
  g.setRole(host.id, host.id, 'hunter');
  g.start(host.id);
  g.phase = 'hunt';
  g.timers.startedAt -= 21 * 60_000;
  g.catchHider(host.id, lea.catchCode);
  g.catchHider(host.id, max.catchCode);
  assert.equal(g.phase, 'ended');
  const { data } = g.pendingArchive;
  assert.equal(data.winner, 'hunters');
  assert.equal(data.players.find((p) => p.name === 'Host').trophy, 'hunter');
  assert.ok(data.trophies.some((t) => t.name === 'Host' && t.why === 'hunter'));
  const after = data.players.find((p) => p.name === 'Lea').caughtAfterMin;
  assert.equal(typeof after, 'number');
  assert.ok(after >= 0 && /^\d+(\.\d)?$/.test(String(after)), `caughtAfterMin ${after}`);
  console.log('✓ Jäger gewinnen');
}

function shortRoundTests() {
  const { g, host } = newRound({ minutes: 19 });
  g.forceEnd(host.id);
  assert.equal(g.pendingArchive, null);
  console.log('✓ Kurze Runde');
}

function oldSaveTests() {
  const { g, host } = newRound({ minutes: 0 });
  const restored = Game.fromJSON(JSON.parse(JSON.stringify(g)));
  delete restored.roundLog;
  restored.timers.startedAt -= 21 * 60_000;
  restored.forceEnd(host.id);
  assert.ok(restored.pendingArchive);
  assert.deepEqual(restored.pendingArchive.data.jokersUsed, []);
  assert.deepEqual(restored.pendingArchive.data.events, []);
  console.log('✓ Alter Spielstand');
}

function distanceTests() {
  const t0 = 1_000_000;
  assert.equal(trailDistanceM([[VS.lat, VS.lng, t0], [north(1000).lat, VS.lng, t0 + 10_000]]), 0);
  assert.equal(trailDistanceM([[VS.lat, VS.lng, t0], [north(100).lat, VS.lng, t0 + 60_000]]), 100);
  assert.deepEqual(simplifyTrail([], t0), []);
  const pt = (m, t) => [north(m).lat, VS.lng, t0 + t * 1000];
  // stehender Hider: erster und letzter Punkt bleiben
  const still = simplifyTrail([pt(0, 0), pt(3, 60)], t0);
  assert.equal(still.length, 2);
  assert.ok(distanceM({ lat: still[1][0], lng: still[1][1] }, north(3)) < 1);
  assert.equal(still[1][2], 60);
  // 0 / 12 / 9 m: Stützpunkte bleiben, Endpunkt wird angehängt
  const three = simplifyTrail([pt(0, 0), pt(12, 30), pt(9, 60)], t0);
  assert.equal(three.length, 3);
  assert.ok(distanceM({ lat: three[1][0], lng: three[1][1] }, north(12)) < 1);
  assert.ok(distanceM({ lat: three[2][0], lng: three[2][1] }, north(9)) < 1);
  assert.equal(three[2][2], 60);
  console.log('✓ Strecke');
}

recordTests();
hunterWinTests();
shortRoundTests();
oldSaveTests();
distanceTests();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function storageTests() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manhunt-archive-'));
  const file = path.join(dir, 'archive.json');
  const rec = (id, endedAt) => {
    const summary = { id, endedAt };
    return { summary, data: { ...summary, settings: {}, players: [], jokersUsed: [], events: [], trophies: [], trails: { a: [[1, 2, 3]] } } };
  };
  try {
    const a = await createArchive({ file });
    assert.equal(a.kind, 'file');
    a.save(rec('alt', 1000));
    a.save(rec('neu', 2000));
    await sleep(200);
    let list = await a.list();
    assert.equal(list.length, 2);
    assert.deepEqual(list.map((s) => s.id), ['neu', 'alt']);
    assert.equal('trails' in list[0], false);
    assert.deepEqual((await a.get('alt')).trails, { a: [[1, 2, 3]] });
    assert.equal(await a.get('gibtsnicht'), null);
    a.save(rec('neu', 2000));
    await sleep(200);
    assert.equal((await a.list()).length, 2);
    await a.close();

    const b = await createArchive({ file });
    list = await b.list();
    assert.equal(list.length, 2);
    // Löschen: true wenn es die Runde gab, false sonst; übersteht einen Neustart
    assert.equal(await b.remove('alt'), true);
    assert.equal(await b.remove('alt'), false);
    assert.deepEqual((await b.list()).map((s) => s.id), ['neu']);
    assert.equal(await b.get('alt'), null);
    await b.close();
    const b2 = await createArchive({ file });
    assert.deepEqual((await b2.list()).map((s) => s.id), ['neu']);
    await b2.close();

    const blocker = path.join(dir, 'datei.txt');
    fs.writeFileSync(blocker, 'x');
    const c = await createArchive({ file: path.join(blocker, 'archive.json'), retryMs: 50, maxRetries: 2 });
    const origError = console.error;
    console.error = () => {};
    try {
      c.save(rec('x', 1));
      assert.equal(c.pending(), 1);
      await sleep(300);
      assert.equal(c.pending(), 0);
    } finally {
      console.error = origError;
    }
    await c.close();

    // Postgres nicht erreichbar: createArchive darf nicht ablehnen, Speichern landet in der Warteschlange.
    const origErr = console.error;
    console.error = () => {};
    try {
      const d = await createArchive({ databaseUrl: 'postgres://u:p@127.0.0.1:1/x', file, retryMs: 50, maxRetries: 1 });
      assert.equal(d.kind, 'postgres');
      d.save(rec('y', 1));
      assert.equal(d.pending(), 1);
      await assert.rejects(d.list());
      await sleep(300);
      assert.equal(d.pending(), 0);
      await d.close();
    } finally {
      console.error = origErr;
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('✓ Speicher');
}

async function loginTests() {
  assert.equal(shortIp('84.163.12.201'), '84.163.12.x');
  assert.equal(shortIp('::ffff:127.0.0.1'), 'lokal');
  assert.equal(shortIp('::ffff:91.42.7.13'), '91.42.7.x');
  assert.equal(shortIp('2a02:810d:4b3f:1200:aaaa:bbbb:cccc:dddd'), '2a02:810d:4b3f:…');
  assert.equal(shortIp(''), null);
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  const ANDROID = 'Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
  const SAMSUNG = 'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36';
  assert.equal(deviceName(IPHONE), 'iPhone · Safari');
  assert.equal(deviceName(ANDROID), 'Android · Chrome');
  assert.equal(deviceName(SAMSUNG), 'Android · Samsung Internet');
  assert.equal(deviceName(''), 'Unbekanntes Gerät');
  assert.equal(cleanDevice('abc12345'), 'abc12345');
  assert.equal(cleanDevice('<script>'), null);
  assert.equal(cleanDevice(42), null);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manhunt-logins-'));
  let t = Date.now();
  const log = await createLoginLog({ file: path.join(dir, 'logins.json'), now: () => t });
  try {
    const main = { kind: 'main' };
    const rehe = { kind: 'guest', group: 'REHE' };
    await log.record({ access: rehe, action: 'create', name: 'Lea', device: 'geraet-1', userAgent: IPHONE, ip: '84.163.12.201' });
    await log.record({ access: rehe, action: 'create', name: 'Lea', device: 'geraet-1', userAgent: IPHONE, ip: '84.163.12.9' });
    let list = await log.list();
    assert.equal(list.length, 1, 'gleiches Gerät innerhalb von 30 Minuten nur einmal');
    assert.deepEqual(
      { ...list[0], at: 0 },
      { at: 0, group: 'REHE', action: 'create', name: 'Lea', device: 'geraet-1', deviceName: 'iPhone · Safari', ip: '84.163.12.x' },
    );
    await log.record({ access: rehe, action: 'history', device: 'geraet-1', userAgent: IPHONE, ip: '84.163.12.9' });
    await log.record({ access: main, action: 'create', name: 'Michael', device: 'bad id!', userAgent: ANDROID, ip: '1.2.3.4' });
    t += 31 * 60_000;
    await log.record({ access: rehe, action: 'create', name: 'Lea', device: 'geraet-1', userAgent: IPHONE, ip: '84.163.12.9' });
    list = await log.list();
    assert.equal(list.length, 4, 'nach 30 Minuten wieder notiert');
    assert.equal(list[0].at, t, 'neueste zuerst');
    const michael = list.find((e) => e.name === 'Michael');
    assert.equal(michael.group, null);
    assert.equal(michael.device, null, 'kaputte Geräte-Nummer wird verworfen');
    t += 30 * 24 * 3600_000 - 60_000; // die ersten drei sind jetzt älter als 30 Tage, der vierte nicht
    await log.record({ access: main, action: 'history', device: 'geraet-2', userAgent: ANDROID, ip: '1.2.3.4' });
    list = await log.list();
    assert.equal(list.length, 2, 'nach 30 Tagen nicht mehr in der Liste');
  } finally {
    await log.close();
  }
  // Beim Start werden alte Einträge aus der Datei gelöscht
  const log2 = await createLoginLog({ file: path.join(dir, 'logins.json'), now: () => t });
  await log2.close();
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'logins.json'), 'utf8')).length, 2);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('✓ Anmelde-Liste');
}

async function httpTests() {
  const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const port = 3998;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manhunt-http-'));
  const env = { ...process.env, PORT: String(port), DATABASE_URL: '', DATA_FILE: path.join(dir, 'games.json'), ARCHIVE_FILE: path.join(dir, 'archive.json'), ARCHIVE_MIN_MINUTES: '0', CREATE_PASSWORD: 'Haupt-Test', GUEST_PASSWORDS: 'REHE:rehe-test, NEU_ULM:neuulm>test', MAIN_GROUP_NAME: '' };
  const srv = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'inherit'] });
  let out = '';
  await new Promise((res) =>
    srv.stdout.on('data', (d) => {
      out += d;
      if (String(d).includes('läuft')) res();
    }),
  );
  const clients = [];
  const mk = () => {
    const s = io(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
    s.state = null;
    s.on('state', (v) => (s.state = v));
    s.call = (ev, data = {}) => new Promise((res) => s.emit(ev, data, res));
    clients.push(s);
    return s;
  };
  const get = (p, pw) => fetch(`http://localhost:${port}${p}`, { headers: pw === undefined ? {} : { 'X-Password': pw } });
  try {
    assert.match(out, /Keine DATABASE_URL/);
    const host = mk();
    assert.ok((await host.call('create', { name: 'Host', password: 'Haupt-Test' })).ok);
    await sleep(200);
    const guest = mk();
    assert.ok((await guest.call('join', { code: host.state.code, name: 'Gast' })).ok);
    await sleep(200);
    assert.ok((await host.call('setRole', { playerId: host.state.me.id, role: 'hunter' })).ok);
    assert.ok((await host.call('setRole', { playerId: guest.state.me.id, role: 'hider' })).ok);
    for (const c of [host, guest]) c.emit('pos', { ...VS, acc: 10 });
    await sleep(300);
    const st = await host.call('start');
    assert.ok(st.ok, st.error);
    const en = await host.call('end');
    assert.ok(en.ok, en.error);
    await sleep(300);

    assert.equal((await get('/api/rounds')).status, 401);
    assert.equal((await get('/api/rounds', 'falsch')).status, 401);
    const res = await get('/api/rounds', 'haupt-test');
    assert.equal(res.status, 200);
    const list = await res.json();
    assert.equal(list.length, 1);
    assert.equal(list[0].winner, null);
    const one = await get(`/api/rounds/${list[0].id}`, 'haupt-test');
    assert.equal(one.status, 200);
    const data = await one.json();
    assert.ok(data.players && data.trails);
    assert.equal((await get('/api/rounds/xyz', 'haupt-test')).status, 404);

    // Gast-Passwörter (Gruppen): Spiel ohne Crush, „Bisherige Spiele“ nur mit eigenen Runden
    const playRound = async (password) => {
      const lead = mk();
      const r = await lead.call('create', { name: 'Leitung', password });
      assert.ok(r.ok, r.error);
      await sleep(200);
      const other = mk();
      assert.ok((await other.call('join', { code: lead.state.code, name: 'Mitspieler' })).ok);
      await sleep(200);
      assert.ok((await lead.call('setRole', { playerId: lead.state.me.id, role: 'hunter' })).ok);
      for (const c of [lead, other]) c.emit('pos', { ...VS, acc: 10 });
      await sleep(200);
      return { lead, other, code: lead.state.code };
    };
    const rehe = await playRound(' Rehe-Test ');
    assert.equal(rehe.lead.state.features.crush, false);
    assert.equal(host.state.features.crush, true, 'Hauptpasswort behält den Crush');

    // Gruppenname: alle im Spiel sehen ihn, beim Hauptpasswort "Jugend Villingen"
    assert.equal(host.state.groupName, 'Jugend Villingen');
    assert.equal(rehe.lead.state.groupName, 'REHE');
    assert.equal(rehe.other.state.groupName, 'REHE', 'auch Mitspieler sehen den Gruppennamen');
    const accessOf = async (pw) => (await get('/api/access', pw)).json();
    assert.deepEqual(await accessOf('Haupt-Test'), { group: 'Jugend Villingen', main: true });
    assert.deepEqual(await accessOf('REHE-TEST'), { group: 'REHE', main: false });
    assert.equal((await get('/api/access', 'falsch')).status, 401);
    const cr = await rehe.lead.call('crush', { a: rehe.lead.state.me.id, b: rehe.other.state.me.id });
    assert.ok(!cr.ok && /Crush/.test(cr.error), 'Crush im Gast-Spiel abgelehnt');
    assert.ok((await rehe.lead.call('start')).ok);
    assert.ok((await rehe.lead.call('end')).ok);
    const ulm = await playRound('neuulm>test');
    assert.ok((await ulm.lead.call('start')).ok);
    assert.ok((await ulm.lead.call('end')).ok);
    await sleep(300);

    const reheList = await (await get('/api/rounds', 'rehe-test')).json();
    assert.deepEqual(reheList.map((x) => x.code), [rehe.code], 'REHE sieht nur die eigene Runde');
    assert.ok(!('group' in reheList[0]), 'Gäste bekommen den Gruppennamen nicht');
    const ulmList = await (await get('/api/rounds', 'NEUULM>TEST')).json();
    assert.deepEqual(ulmList.map((x) => x.code), [ulm.code], 'NEU_ULM sieht nur die eigene Runde');
    const mainList = await (await get('/api/rounds', 'Haupt-Test')).json();
    assert.equal(mainList.length, 3, 'Hauptpasswort sieht alle Runden');
    assert.deepEqual(mainList.map((x) => x.group).sort(), [null, 'NEU_ULM', 'REHE'].sort());
    const own = await get(`/api/rounds/${reheList[0].id}`, 'rehe-test');
    assert.equal(own.status, 200);
    assert.ok(!('group' in (await own.json())), 'auch in den Details kein Gruppenname');
    assert.equal((await get(`/api/rounds/${ulmList[0].id}`, 'rehe-test')).status, 404, 'fremde Runde bleibt verborgen');
    assert.equal((await get(`/api/rounds/${list[0].id}`, 'neuulm>test')).status, 404, 'Runden des Hauptpassworts bleiben verborgen');
    assert.equal((await get(`/api/rounds/${ulmList[0].id}`, 'haupt-test')).status, 200, 'Hauptpasswort sieht jede Runde');

    // Status für die Push-Sperre: nur Zahlen, nur mit dem Hauptpasswort
    assert.equal((await get('/api/status', 'rehe-test')).status, 404);
    const idle = await (await get('/api/status', 'Haupt-Test')).json();
    assert.deepEqual(idle, { running: 0, players: 0 }, 'gerade läuft kein Spiel');
    const live = await playRound('Haupt-Test');
    assert.ok((await live.lead.call('start')).ok);
    await sleep(200);
    assert.deepEqual(await (await get('/api/status', 'Haupt-Test')).json(), { running: 1, players: 2 });
    // Push-Sperre: blockiert bei laufendem Spiel, außer mit MANHUNT_FORCE_PUSH=1
    const checkLive = (extra = {}) =>
      new Promise((res) =>
        execFile(process.execPath, ['scripts/check-live.mjs'], { cwd: ROOT, env: { ...process.env, MANHUNT_URL: `http://localhost:${port}`, CREATE_PASSWORD: 'Haupt-Test', ...extra } }, (err, stdout, stderr) =>
          res({ code: err ? err.code : 0, out: stdout + stderr }),
        ),
      );
    let chk = await checkLive();
    assert.equal(chk.code, 1, chk.out);
    assert.match(chk.out, /1 Spiel mit 2 Spielern/);
    assert.equal((await checkLive({ MANHUNT_FORCE_PUSH: '1' })).code, 0);
    assert.ok((await live.lead.call('end')).ok);
    await sleep(300);
    chk = await checkLive();
    assert.equal(chk.code, 0, chk.out);
    assert.match(chk.out, /Kein laufendes Spiel/);
    chk = await checkLive({ MANHUNT_URL: 'http://localhost:1', MANHUNT_CHECK_TIMEOUT_MS: '1000' });
    assert.equal(chk.code, 0, 'nicht erreichbar -> Push erlaubt');

    // Anmelde-Liste: Spiel erstellen und „Bisherige Spiele“ öffnen werden notiert, sehen darf sie nur das Hauptpasswort
    const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
    assert.ok((await mk().call('create', { name: 'Lea', password: 'rehe-test', device: 'geraet-1234' })).ok);
    const openHistory = () =>
      fetch(`http://localhost:${port}/api/access`, { headers: { 'X-Password': 'rehe-test', 'X-Device': 'geraet-1234', 'User-Agent': IPHONE } });
    assert.equal((await openHistory()).status, 200);
    assert.equal((await openHistory()).status, 200);
    await sleep(100);
    assert.equal((await get('/api/logins')).status, 401);
    assert.equal((await get('/api/logins', 'rehe-test')).status, 404, 'Gruppen sehen die Liste nicht');
    const logins = await (await get('/api/logins', 'Haupt-Test')).json();
    assert.equal(logins.keepDays, 30);
    const lea = logins.entries.filter((e) => e.device === 'geraet-1234');
    assert.deepEqual(lea.map((e) => e.action).sort(), ['create', 'history'], 'zweimal öffnen = ein Eintrag');
    assert.ok(lea.every((e) => e.group === 'REHE' && e.ip));
    assert.equal(lea.find((e) => e.action === 'create').name, 'Lea');
    assert.equal(lea.find((e) => e.action === 'history').deviceName, 'iPhone · Safari');
    assert.ok(logins.entries.some((e) => e.group === null && e.action === 'create' && e.name === 'Host'), 'Hauptpasswort wird auch notiert');
    assert.ok(!logins.entries.some((e) => e.name === 'Gast' || e.name === 'Mitspieler'), 'Mitspieler ohne Passwort nie');

    // Runde löschen: nur mit dem Hauptpasswort, Gruppen bekommen 404
    const del = (id, pw) => fetch(`http://localhost:${port}/api/rounds/${id}`, { method: 'DELETE', headers: { 'X-Password': pw } });
    assert.equal((await del(reheList[0].id, 'rehe-test')).status, 404, 'Gruppe darf nicht löschen');
    assert.equal((await get(`/api/rounds/${reheList[0].id}`, 'rehe-test')).status, 200, 'Runde ist noch da');
    assert.equal((await del(reheList[0].id, 'Haupt-Test')).status, 200);
    assert.equal((await get(`/api/rounds/${reheList[0].id}`, 'Haupt-Test')).status, 404, 'Runde ist weg');
    assert.equal((await del(reheList[0].id, 'Haupt-Test')).status, 404, 'zweimal löschen geht nicht');
    assert.equal((await (await get('/api/rounds', 'Haupt-Test')).json()).length, 3, 'Haupt, NEU_ULM und die Status-Runde bleiben');

    // Impressum und Datenschutz sind erreichbar, die Startseite lädt nichts mehr von Google
    const imp = await get('/impressum');
    assert.equal(imp.status, 200);
    assert.match(await imp.text(), /§ 5 DDG[\s\S]*Michael Rüb/);
    const ds = await get('/datenschutz');
    assert.equal(ds.status, 200);
    assert.match(await ds.text(), /Datenschutz/);
    const home = await (await get('/')).text();
    assert.match(home, /href="\/impressum"/);
    assert.match(home, /href="\/datenschutz"/);
    assert.doesNotMatch(home, /fonts\.(googleapis|gstatic)\.com/);
    assert.equal((await get('/fonts/inter-latin.woff2')).status, 200);

    // Ortssuche: leere oder zu lange Suche wird abgelehnt (ohne Anfrage ins Internet)
    assert.equal((await get('/api/geocode')).status, 400);
    assert.equal((await get('/api/geocode?q=%20%20')).status, 400);
    assert.equal((await get(`/api/geocode?q=${'x'.repeat(101)}`)).status, 400);

    for (let i = 0; i < 5; i++) await get('/api/rounds', 'falsch');
    assert.equal((await get('/api/rounds', 'haupt-test')).status, 429);
  } finally {
    clients.forEach((c) => c.close());
    srv.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('✓ HTTP');
}

async function restartTest() {
  const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const port = 3997;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manhunt-restart-'));
  const g = new Game('REST');
  const host = g.addPlayer('Host');
  const lea = g.addPlayer('Lea');
  g.setRole(host.id, host.id, 'hunter');
  g.setRole(host.id, lea.id, 'hider');
  g.updatePos(host.id, { ...VS, acc: 10 });
  g.updatePos(lea.id, { ...VS, acc: 10 });
  g.start(host.id);
  const back = 3 * 3600_000;
  g.timers.startedAt -= back;
  g.timers.huntStartAt -= back;
  g.timers.endAt -= back;
  fs.writeFileSync(path.join(dir, 'games.json'), JSON.stringify([g]));
  const env = { ...process.env, PORT: String(port), DATABASE_URL: '', DATA_FILE: path.join(dir, 'games.json'), ARCHIVE_FILE: path.join(dir, 'archive.json'), ARCHIVE_MIN_MINUTES: '0', CREATE_PASSWORD: 'Haupt-Test', GUEST_PASSWORDS: 'REHE:rehe-test, NEU_ULM:neuulm>test', MAIN_GROUP_NAME: '' };
  const srv = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let exited = false;
  let err = '';
  srv.on('exit', () => (exited = true));
  srv.stderr.on('data', (d) => (err += d));
  try {
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('Server startet nicht: ' + err)), 8000);
      srv.on('exit', () => rej(new Error('Server abgestürzt: ' + err)));
      srv.stdout.on('data', (d) => String(d).includes('läuft') && (clearTimeout(t), res()));
    });
    await sleep(2500);
    assert.equal(exited, false, 'Server darf nach Neustart nicht abstürzen: ' + err);
    const res = await fetch(`http://localhost:${port}/api/rounds`, { headers: { 'X-Password': 'Haupt-Test' } });
    assert.equal(res.status, 200);
    const list = await res.json();
    assert.equal(list.length, 1);
  } finally {
    srv.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('✓ Neustart mit abgelaufener Runde');
}

await storageTests();
await loginTests();
await httpTests();
await restartTest();
