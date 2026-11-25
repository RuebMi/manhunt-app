// Füllt ein Spiel mit Test-Bots, die in der Zone herumlaufen.
// Aufruf: node test/bots.js <SPIELCODE> [Anzahl] [Server-URL]
import { io } from 'socket.io-client';

const [code, countArg = '5', url = 'http://localhost:3000'] = process.argv.slice(2);
if (!code) {
  console.log('Aufruf: node test/bots.js <SPIELCODE> [Anzahl] [Server-URL]');
  process.exit(1);
}

const NAMES = ['Anna', 'Ben', 'Clara', 'David', 'Emma', 'Finn', 'Greta', 'Hannes', 'Ida', 'Jonas', 'Kira', 'Leon', 'Mia', 'Noah', 'Ole'];

for (let i = 0; i < Number(countArg); i++) {
  const name = `${NAMES[i % NAMES.length]}-Bot${i >= NAMES.length ? i : ''}`;
  const s = io(url, { transports: ['websocket'], forceNew: true });
  let state = null;
  let pos = null;
  let lastCode = null;
  s.on('state', (v) => {
    state = v;
    if (v.me.catchCode && v.me.catchCode !== lastCode) {
      lastCode = v.me.catchCode;
      console.log(`${name}: Hider, Fang-Code ${lastCode}`);
    }
  });
  s.emit('join', { code: code.toUpperCase(), name }, (r) => {
    if (!r.ok) console.log(`${name}: ${r.error}`);
    else console.log(`${name} ist beigetreten`);
  });
  setInterval(() => {
    if (!state) return;
    const z = state.settings.zone;
    if (!pos) {
      const r = z.radius * 0.6 * Math.sqrt(Math.random());
      const a = Math.random() * 2 * Math.PI;
      pos = { lat: z.lat + (r * Math.cos(a)) / 111320, lng: z.lng + (r * Math.sin(a)) / 74500 };
    }
    // kleiner Zufallsschritt (~10 m)
    pos.lat += (Math.random() - 0.5) / 5000;
    pos.lng += (Math.random() - 0.5) / 3500;
    s.emit('pos', { ...pos, acc: 8 });
  }, 3000);
}
