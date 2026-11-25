// Lasttest: N Spieler (Standard 33) spielen 90 Sekunden lang. Misst Datenmenge
// pro Handy, Reaktionszeit und CPU/Speicher des Servers.
// Aufruf: node test/load.js [Anzahl]
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { io } from 'socket.io-client';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 3200;
const N = Number(process.argv[2]) || 33;
const RUN_MS = 90_000;
const VS = { lat: 48.0603, lng: 8.4586 };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const srv = spawn(process.execPath, ['server/index.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), CREATE_PASSWORD: 'Haupt-Test', DATA_FILE: path.join(os.tmpdir(), `manhunt-load-${process.pid}.json`) },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((res) => srv.stdout.on('data', (d) => String(d).includes('läuft') && res()));

const serverStats = () => {
  const [cpu, rss] = execFileSync('ps', ['-o', '%cpu=,rss=', '-p', String(srv.pid)]).toString().trim().split(/\s+/);
  return { cpu: Number(cpu), mb: Math.round(Number(rss) / 1024) };
};

const clients = [];
for (let i = 0; i < N; i++) {
  const s = io(`http://localhost:${PORT}`, { transports: ['websocket'], forceNew: true });
  s.bytes = 0;
  s.states = 0;
  s.state = null;
  s.pos = { lat: VS.lat + (Math.random() - 0.5) * 0.01, lng: VS.lng + (Math.random() - 0.5) * 0.015 };
  s.on('state', (v) => {
    s.state = v;
    s.states += 1;
    if (s.measuring) s.bytes += JSON.stringify(v).length;
  });
  s.call = (ev, data = {}) => new Promise((res) => s.emit(ev, data, res));
  clients.push(s);
}
const host = clients[0];
await host.call('create', { name: 'Spieler 0', password: 'Haupt-Test' });
while (!host.state) await wait(50);
const code = host.state.code;
for (let i = 1; i < N; i++) await clients[i].call('join', { code, name: `Spieler ${i}` });
await host.call('settings', { headStartMin: 0, pingIntervalMin: 1, durationMin: 30 });
await host.call('randomize', { hunters: 7 });
for (const c of clients) c.emit('pos', { ...c.pos, acc: 10 });
await wait(500);
await host.call('start');
while (host.state.phase !== 'hunt') await wait(50);

// Jeder sendet alle 3 s seine Position (wie ein Handy mit offener Seite)
const walkers = clients.map((c) =>
  setInterval(() => {
    c.pos.lat += (Math.random() - 0.5) / 5000;
    c.pos.lng += (Math.random() - 0.5) / 3500;
    c.emit('pos', { ...c.pos, acc: 10 });
  }, 3000),
);

clients.forEach((c) => (c.measuring = true));
const samples = [];
const t0 = Date.now();
while (Date.now() - t0 < RUN_MS) {
  await wait(5000);
  samples.push(serverStats());
}
clients.forEach((c) => (c.measuring = false));

// Reaktionszeit einer Aktion: Chat-Nachricht bis zur Bestätigung
const lat = [];
for (let i = 0; i < 10; i++) {
  const t = Date.now();
  await host.call('chat', { channel: 'all', text: `ping ${i}` });
  lat.push(Date.now() - t);
}

const secs = RUN_MS / 1000;
const perClientKBs = clients.map((c) => c.bytes / 1024 / secs);
const avgKBs = perClientKBs.reduce((a, b) => a + b, 0) / N;
const stateSizeKB = clients[0].bytes / clients[0].states / 1024;
const avgCpu = samples.reduce((a, b) => a + b.cpu, 0) / samples.length;
const maxMb = Math.max(...samples.map((x) => x.mb));
console.log(`Spieler: ${N} (7 Jäger, ${N - 7} Hider), Messdauer ${secs} s`);
console.log(`Daten pro Handy: ${avgKBs.toFixed(1)} KB/s → ${((avgKBs * 90 * 60) / 1024).toFixed(0)} MB pro 90-Minuten-Spiel`);
console.log(`Größe eines Status-Pakets: ${stateSizeKB.toFixed(1)} KB`);
console.log(`Server gesamt: ${((avgKBs * N * 90 * 60) / 1024 / 1024).toFixed(2)} GB pro 90-Minuten-Spiel`);
console.log(`Server-CPU: Ø ${avgCpu.toFixed(1)} % eines Kerns, Speicher max ${maxMb} MB`);
console.log(`Reaktionszeit (lokal): Ø ${Math.round(lat.reduce((a, b) => a + b, 0) / lat.length)} ms`);
console.log(`Alle verbunden: ${clients.every((c) => c.connected)}`);

walkers.forEach(clearInterval);
clients.forEach((c) => c.close());
srv.kill();
process.exit(0);
