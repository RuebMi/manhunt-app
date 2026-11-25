// Text für "Ergebnis teilen" auf dem Endbildschirm.
// Start: node test/share.js (läuft auch in npm test)
import assert from 'node:assert/strict';
import { buildResultText } from '../public/share-text.js';

const MIN = 60_000;
const start = Date.UTC(2026, 10, 24, 17, 0); // 24.11.2026
const base = {
  timers: { startedAt: start, huntStartAt: start + 5 * MIN },
  result: { winner: 'hunters', reason: 'Alle Hider wurden gefangen!', at: start + 62 * MIN, trophies: [{ id: 'm', name: 'Michael', why: 'hunter' }] },
  players: [
    { id: 'm', name: 'Michael', startRole: 'hunter', status: 'alive' },
    { id: 't', name: 'Tom', startRole: 'hunter', status: 'alive' },
    { id: 'l', name: 'Lea', startRole: 'hider', status: 'caught', caughtBy: 'Michael', caughtAt: start + 46 * MIN },
    { id: 'x', name: 'Max', startRole: 'hider', status: 'caught', caughtBy: 'Tom', caughtAt: start + 23 * MIN },
    { id: 'k', name: 'Kim', startRole: 'hider', status: 'caught', caughtBy: 'Michael', caughtAt: start + 30 * MIN },
  ],
};
const dist = new Map([['l', 2412], ['m', 1800], ['x', 900]]);

function normalTests() {
  const text = buildResultText(base, dist);
  assert.equal(
    text,
    [
      '🏆 Jäger gewinnen! Manhunt · 24.11. · 62 min',
      'Alle Hider wurden gefangen!',
      '',
      '🎯 Jäger',
      'Michael: 2 gefangen 🏆',
      'Tom: 1 gefangen',
      '',
      '🏃 Hider',
      'Lea: gefangen von Michael nach 41 min',
      'Kim: gefangen von Michael nach 25 min',
      'Max: gefangen von Tom nach 18 min',
      '',
      '🥇 Am meisten gelaufen: Lea (2,4 km)',
    ].join('\n'),
  );
  assert.doesNotMatch(text, /https?:\/\//, 'kein Link');
  // Mit Gruppe: Name in der ersten Zeile, Unterstriche als Leerzeichen
  const grouped = buildResultText({ ...base, groupName: 'Neu_Ulm' }, dist);
  assert.match(grouped, /^🏆 Jäger gewinnen! Manhunt · Gruppe Neu Ulm · 24\.11\. · 62 min\n/);
  console.log('✓ Ergebnis teilen: normale Runde');
}

function abortedAndSurvivorTests() {
  const v = structuredClone(base);
  v.result = { winner: null, reason: 'Der Spielleiter hat die Runde beendet.', at: start + 20 * MIN, trophies: [] };
  v.players[2] = { id: 'l', name: 'Lea', startRole: 'hider', status: 'alive' };
  const text = buildResultText(v, new Map());
  assert.match(text, /^🏁 Runde beendet · Manhunt · 24\.11\. · 20 min\n/);
  assert.match(text, /\nLea: überlebt\n/);
  assert.match(text, /\nTom: 1 gefangen\n/);
  assert.doesNotMatch(text, /Am meisten gelaufen/, 'ohne Routen keine Strecke');
  assert.doesNotMatch(text, /🏆/, 'kein Pokal');
  // Hider gewinnen
  v.result.winner = 'hiders';
  assert.match(buildResultText(v, new Map()), /^🏆 Hider gewinnen!/);
  console.log('✓ Ergebnis teilen: abgebrochen, Überlebende');
}

function bigRoundTests() {
  const v = structuredClone(base);
  v.players = [
    ...['A', 'B', 'C', 'D'].map((n, i) => ({ id: n, name: n, startRole: 'hunter', status: 'alive', _catches: 4 - i })),
    ...Array.from({ length: 10 }, (_, i) => ({ id: `h${i}`, name: `Hider${i}`, startRole: 'hider', status: i < 2 ? 'alive' : 'caught' })),
  ];
  // Fänge verteilen: A 4, B 3, C 1, D 0
  const catchers = ['A', 'A', 'A', 'A', 'B', 'B', 'B', 'C'];
  v.players.filter((p) => p.status === 'caught').forEach((p, i) => {
    p.caughtBy = catchers[i];
    p.caughtAt = start + (10 + i) * MIN;
  });
  v.players.forEach((p) => delete p._catches);
  const text = buildResultText(v, new Map());
  assert.match(text, /\nA: 4 gefangen\nB: 3 gefangen\nC: 1 gefangen\n… und 1 weiterer Jäger\n/);
  assert.match(text, /\n🏃 Hider\nHider0: überlebt\nHider1: überlebt\n8 gefangen$/);
  assert.doesNotMatch(text, /Hider5/, 'Gefangene werden bei großen Runden nicht einzeln aufgezählt');
  console.log('✓ Ergebnis teilen: große Runde gekürzt');
}

normalTests();
abortedAndSurvivorTests();
bigRoundTests();
