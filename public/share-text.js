// Text für "📤 Ergebnis teilen" auf dem Endbildschirm (z. B. für die WhatsApp-Gruppe).
// Nur Namen und Zahlen, die ohnehin alle sehen: keine Standorte, Routen, Codes, kein Crush.
// v: Spielansicht (result, players, timers), dist: Map spielerId -> gelaufene Meter.
const MIN = 60_000;
const BIG_ROUND = 10; // ab mehr Spielern wird der Text gekürzt

// Gruppenname zum Anzeigen: Unterstriche als Leerzeichen ("Neu_Ulm" -> "Neu Ulm").
export const groupLabel = (name) => String(name ?? '').replace(/_/g, ' ').trim();

const km = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m)} m`);

export function buildResultText(v, dist = new Map()) {
  const res = v.result ?? {};
  const start = v.timers?.startedAt ?? res.at;
  const huntStart = v.timers?.huntStartAt ?? start;
  const date = new Date(start).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  const duration = Math.max(0, Math.round((res.at - start) / MIN));
  const head =
    res.winner === 'hunters' ? '🏆 Jäger gewinnen!' : res.winner === 'hiders' ? '🏆 Hider gewinnen!' : '🏁 Runde beendet ·';
  const trophy = new Set((res.trophies ?? []).map((t) => t.name));
  const mark = (p) => (trophy.has(p.name) ? ' 🏆' : '');

  const catches = new Map();
  for (const p of v.players) if (p.caughtBy) catches.set(p.caughtBy, (catches.get(p.caughtBy) ?? 0) + 1);
  const big = v.players.length > BIG_ROUND;

  const hunters = v.players.filter((p) => p.startRole === 'hunter').sort((a, b) => (catches.get(b.name) ?? 0) - (catches.get(a.name) ?? 0));
  const shownHunters = big ? hunters.slice(0, 3) : hunters;
  const hunterLines = shownHunters.map((p) => `${p.name}: ${catches.get(p.name) ?? 0} gefangen${mark(p)}`);
  const rest = hunters.length - shownHunters.length;
  if (rest > 0) hunterLines.push(`… und ${rest} ${rest === 1 ? 'weiterer Jäger' : 'weitere Jäger'}`);

  const hiders = v.players.filter((p) => p.startRole === 'hider');
  const survivors = hiders.filter((p) => !p.caughtAt);
  const caught = hiders.filter((p) => p.caughtAt).sort((a, b) => b.caughtAt - a.caughtAt);
  const caughtExtra = (p) => (catches.get(p.name) ? ` · ${catches.get(p.name)} gefangen` : ''); // z. B. bei Infektion
  const hiderLines = [
    ...survivors.map((p) => `${p.name}: überlebt${caughtExtra(p)}${mark(p)}`),
    ...(big
      ? caught.length
        ? [`${caught.length} gefangen`]
        : []
      : caught.map((p) => `${p.name}: gefangen von ${p.caughtBy} nach ${Math.max(0, Math.round((p.caughtAt - huntStart) / MIN))} min${caughtExtra(p)}`)),
  ];

  const group = v.groupName ? ` · Gruppe ${groupLabel(v.groupName)}` : '';
  const lines = [`${head} Manhunt${group} · ${date} · ${duration} min`];
  if (res.reason) lines.push(res.reason);
  if (hunterLines.length) lines.push('', '🎯 Jäger', ...hunterLines);
  if (hiderLines.length) lines.push('', '🏃 Hider', ...hiderLines);
  const top = [...dist.entries()].sort((a, b) => b[1] - a[1])[0];
  const topPlayer = top && top[1] > 0 ? v.players.find((p) => p.id === top[0]) : null;
  if (topPlayer) lines.push('', `🥇 Am meisten gelaufen: ${topPlayer.name} (${km(top[1])})`);
  return lines.join('\n');
}
