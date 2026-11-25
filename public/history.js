/* global L */
// Seite „Bisherige Spiele“: Passwort, Liste, Details mit Routen-Karte.
import { groupLabel } from './share-text.js';
import { addBaseLayer } from './basemap.js';
import { deviceId } from './device.js';

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const PW_KEY = 'manhunt-host-pw';

const JOKERS = {
  cloak: ['👻', 'Tarnkappe'],
  decoy: ['🎭', 'Doppelgänger'],
  radar: ['📡', 'Radar'],
  extraPing: ['🛰️', 'Sonder-Ping'],
  drone: ['🚁', 'Drohne'],
  sniff: ['🐕', 'Spürnase'],
  shield: ['🛡️', 'Schutzschild'],
  spotlight: ['🔦', 'Scheinwerfer'],
};
const EVENTS = {
  jokerRain: ['🌧️', 'Joker-Regen'],
  fever: ['🔥', 'Jagdfieber'],
  fog: ['🌫️', 'Nebel'],
  bounty: ['💰', 'Kopfgeld'],
  swap: ['🔄', 'Rollentausch'],
};
const ROLES = { hunter: '🎯 Jäger', hider: '🏃 Hider' };
const roleName = (r) => ROLES[r] || String(r ?? '');
const CATCH = { touch: 'Abklatschen', arm: 'Armlänge' };
const EVENTS_MODE = { rare: 'selten', often: 'oft' };
const MISSION_RESULT = { done: 'geschafft', failed: 'gescheitert (Strafe-Ping)', caught: 'unterwegs gefangen', cancelled: 'abgebrochen (Zone)', left: 'Spiel verlassen' };
const min = (n) => Number(n ?? 0).toLocaleString('de-DE', { maximumFractionDigits: 1 });
const named = (table, key) => (table[key] ? `${table[key][0]} ${table[key][1]}` : String(key));

const body = () => $('#historyBody');
let password = '';
let access = null; // { group, main } zum eingegebenen Passwort
let map = null;

function readPw() {
  try {
    const v = JSON.parse(localStorage.getItem(PW_KEY));
    return typeof v === 'string' ? v : '';
  } catch {
    return '';
  }
}
function savePw(pw) {
  try {
    localStorage.setItem(PW_KEY, JSON.stringify(pw));
  } catch {
    /* privater Modus o. ä. */
  }
}

function destroyMap() {
  if (map) {
    map.remove();
    map = null;
  }
}

function formatDistance(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m)} m`;
}
function formatDate(ts) {
  return new Date(ts).toLocaleString('de-DE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function resultLabel(winner) {
  return winner === 'hunters' ? '🎯 Jäger gewinnen' : winner === 'hiders' ? '🏃 Hider gewinnen' : '🏁 Abgebrochen';
}

function show(open) {
  $('#home').classList.toggle('active', !open);
  $('#history').classList.toggle('active', open);
  window.scrollTo(0, 0);
}
function openHistory() {
  show(true);
  password = readPw();
  if (password) loadList();
  else showPassword();
}
function closeHistory() {
  destroyMap();
  show(false);
}

// ------------------------------------------------------------ Passwort
function showPassword(msg = '') {
  destroyMap();
  body().innerHTML = `<form class="card" id="historyPwForm">
      <label>Passwort
        <input type="password" id="historyPw" autocomplete="current-password" value="${esc(readPw())}" />
      </label>
      <p class="history-err" id="historyErr">${esc(msg)}</p>
      <button class="btn primary" type="submit">Anzeigen</button>
    </form>`;
  $('#historyPwForm').addEventListener('submit', (e) => {
    e.preventDefault();
    password = $('#historyPw').value;
    loadList();
  });
}

async function api(path, method = 'GET') {
  const res = await fetch(path, { method, headers: { 'X-Password': password, 'X-Device': deviceId() } });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* keine JSON-Antwort */
  }
  if (!res.ok) {
    const err = new Error(data?.error || 'Fehler beim Laden.');
    err.status = res.status;
    throw err;
  }
  return data;
}

function handleError(err, retry) {
  if (err.status === 401) {
    // Gemerktes Passwort bleibt: mit dem Gast-Passwort kann man weiter Spiele erstellen,
    // nur diese Seite ist gesperrt.
    password = '';
    showPassword('Falsches Passwort.');
  } else if (err.status === 429) {
    showPassword(err.message);
  } else {
    destroyMap();
    body().innerHTML = `<div class="card"><p class="history-err">${esc(err.status ? err.message || 'Fehler beim Laden.' : 'Keine Verbindung zum Server.')}</p>
      <button class="btn" id="historyRetry">Nochmal versuchen</button></div>`;
    $('#historyRetry').addEventListener('click', retry);
  }
}

// ------------------------------------------------------------ Liste
async function loadList() {
  destroyMap();
  body().innerHTML = '<p class="hint">Lade …</p>';
  try {
    const rounds = await api('/api/rounds');
    savePw(password);
    // Zu welcher Gruppe gehört das Passwort? (für Begrüßung und den Namen der Hauptgruppe)
    access = await api('/api/access').catch(() => null);
    renderList(rounds);
  } catch (err) {
    handleError(err, loadList);
  }
}

function renderList(rounds) {
  const greeting = access?.group ? `<p class="group-hello">Hallo Gruppe ${esc(groupLabel(access.group))} 👋 Willkommen bei Manhunt!</p>` : '';
  // Nur das Hauptpasswort sieht die Anmelde-Liste
  const hello = access?.main ? `${greeting}<button type="button" class="btn logins-open" id="historyLogins">📱 Anmeldungen ansehen</button>` : greeting;
  if (!rounds.length) {
    body().innerHTML = `${hello}<div class="card"><p class="hint">Noch keine Runden gespeichert. Runden ab 20 Minuten landen automatisch hier.</p></div>`;
    $('#historyLogins')?.addEventListener('click', loadLogins);
    return;
  }
  const row = (r) => `<button class="history-row" data-id="${esc(r.id)}">
        ${esc(formatDate(r.startedAt))} · ${esc(min(r.durationMin))} min · ${resultLabel(r.winner)} · ${esc(r.playerCount)} Spieler
        <small>Code ${esc(r.code)}</small></button>`;
  // Nur das Hauptpasswort bekommt den Gruppennamen: dann nach Gruppen ordnen,
  // "Hauptpasswort" zuerst, danach die Gruppen alphabetisch. Die Liste kommt schon neueste zuerst.
  if (!('group' in rounds[0])) {
    body().innerHTML = hello + rounds.map(row).join('');
  } else {
    const groups = new Map();
    for (const r of rounds) {
      const key = r.group ?? '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    const keys = [...groups.keys()].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b, 'de')));
    body().innerHTML =
      hello +
      keys
      .map((k) => {
        const list = groups.get(k);
        const title = k === '' ? (access?.main ? groupLabel(access.group) : 'Hauptpasswort') : groupLabel(k);
        return `<h3 class="history-group">${esc(title)} <span class="muted">(${list.length})</span></h3>${list.map(row).join('')}`;
      })
      .join('');
  }
  body().querySelectorAll('.history-row').forEach((b) => b.addEventListener('click', () => loadDetail(b.dataset.id)));
  $('#historyLogins')?.addEventListener('click', loadLogins);
}

// ------------------------------------------------------------ Anmelde-Liste (nur Hauptpasswort)
// Wer hat sich mit welchem Spielleiter-Passwort angemeldet? Je Passwort die Geräte,
// erkannt an der Geräte-Nummer (siehe device.js).
async function loadLogins() {
  destroyMap();
  body().innerHTML = '<p class="hint">Lade …</p>';
  try {
    renderLogins(await api('/api/logins'));
  } catch (err) {
    handleError(err, loadLogins);
  }
}

const ACTIONS = { create: 'Spiel erstellt', history: 'Bisherige Spiele' };
const times = (n) => `${n}×`;

function renderLogins({ keepDays = 30, entries = [] }) {
  const me = deviceId();
  // Passwort -> Gerät -> Zusammenfassung. Die Einträge kommen neueste zuerst.
  const groups = new Map();
  for (const e of entries) {
    const g = e.group ?? '';
    if (!groups.has(g)) groups.set(g, new Map());
    const devices = groups.get(g);
    const key = e.device ?? `${e.ip}|${e.deviceName}`;
    if (!devices.has(key)) devices.set(key, { ...e, names: new Set(), ips: new Set(), actions: {} });
    const d = devices.get(key);
    if (e.name) d.names.add(e.name);
    if (e.ip) d.ips.add(e.ip);
    d.actions[e.action] = (d.actions[e.action] ?? 0) + 1;
  }
  const keys = [...groups.keys()].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b, 'de')));
  const deviceLine = (d) => {
    const bits = [];
    if (d.names.size) bits.push(`Name: ${[...d.names].join(', ')}`);
    for (const [a, n] of Object.entries(d.actions)) bits.push(`${ACTIONS[a] ?? a} ${times(n)}`);
    if (d.ips.size) bits.push(`IP ${[...d.ips].join(', ')}`);
    if (!d.device) bits.push('ohne Geräte-Nummer');
    const mine = d.device && d.device === me ? ' <span class="muted">(dieses Gerät)</span>' : '';
    return `<li class="login-row"><b>${esc(d.deviceName)}</b>${mine}<small>zuletzt ${esc(formatDate(d.at))}</small>
      <small>${esc(bits.join(' · '))}</small></li>`;
  };
  const list = keys
    .map((k) => {
      const devices = [...groups.get(k).values()];
      const title = k === '' ? groupLabel(access?.group) || 'Hauptpasswort' : groupLabel(k);
      const count = devices.length === 1 ? '1 Gerät' : `${devices.length} Geräte`;
      return `<h3 class="history-group">${esc(title)} <span class="muted">(${count})</span></h3>
        <div class="card"><ul class="stats">${devices.map(deviceLine).join('')}</ul></div>`;
    })
    .join('');
  body().innerHTML = `<button type="button" class="back-link" id="historyToList">‹ Zurück zur Liste</button>
    <h3 class="history-group">Anmeldungen der letzten ${esc(keepDays)} Tage</h3>
    ${list || `<div class="card"><p class="hint">In den letzten ${esc(keepDays)} Tagen hat sich niemand mit einem Spielleiter-Passwort angemeldet.</p></div>`}
    <p class="hint">Gezählt wird, wer ein Spiel erstellt oder „Bisherige Spiele“ öffnet. Ein Gerät erkennt die App an einer
      zufälligen Geräte-Nummer. Wer die Browser-Daten löscht oder einen anderen Browser nimmt, zählt als neues Gerät.
      Die IP-Adresse ist gekürzt, am Handy wechselt sie oft. Einträge werden nach ${esc(keepDays)} Tagen gelöscht.</p>`;
  $('#historyToList').addEventListener('click', loadList);
}

// ------------------------------------------------------------ Details
async function loadDetail(id) {
  destroyMap();
  body().innerHTML = '<p class="hint">Lade …</p>';
  try {
    renderDetail(await api(`/api/rounds/${encodeURIComponent(id)}`));
  } catch (err) {
    handleError(err, () => loadDetail(id));
  }
}

function rulesLine(s) {
  const bits = [
    `${min(s.durationMin)} min Spielzeit`,
    `${min(s.headStartMin)} min Vorsprung`,
    `Ping alle ${min(s.pingIntervalMin)} min`,
    `Zone ${formatDistance(s.zone?.radius ?? 0)}`,
  ];
  if (s.shrink) bits.push('schrumpfende Zone');
  if (s.catchRule) bits.push(`Fangen: ${CATCH[s.catchRule] || s.catchRule}`);
  if (EVENTS_MODE[s.eventsMode]) bits.push(`Events: ${EVENTS_MODE[s.eventsMode]}`);
  if (EVENTS_MODE[s.missionsMode]) bits.push(`Missionen: ${EVENTS_MODE[s.missionsMode]}`);
  if (s.infection) bits.push('Infektion');
  return bits.map(esc).join(' · ');
}

const TROPHY_WHY = { hunter: 'meiste Fänge', hider: 'einzige(r) Überlebende(r)' };

function playerLine(p, all) {
  const role = p.endRole && p.endRole !== p.startRole ? `${roleName(p.startRole)} → ${roleName(p.endRole)}` : roleName(p.startRole);
  const caught = all.filter((q) => q.caughtBy === p.name).length;
  const bits = [];
  if (caught) bits.push(`${caught} gefangen`);
  if (p.caughtBy) bits.push(`gefangen von ${p.caughtBy} nach ${min(p.caughtAfterMin)} min`);
  if (!bits.length) bits.push(p.startRole === 'hunter' ? 'keinen gefangen' : 'überlebt');
  const fate = bits.join(' · ');
  const trophy = p.trophy ? ' 🏆' : '';
  return `<li><span><b>${esc(p.name)}</b>${trophy}<br><small>${esc(role)} · ${esc(fate)}</small></span><span>${esc(formatDistance(p.distanceM || 0))}</span></li>`;
}

function renderDetail(d) {
  const jokers = (d.jokersUsed || [])
    .map((j) => `<li><span>${esc(j.name)}: ${esc(named(JOKERS, j.type))}</span><small>${esc(min(j.atMin))} min</small></li>`)
    .join('');
  const events = (d.events || [])
    .map((e) => `<li><span>${esc(named(EVENTS, e.type))}</span><small>${esc(min(e.atMin))} min</small></li>`)
    .join('');
  const missions = (d.missions || [])
    .map((m) => `<li><span>${esc(m.name)} → ${esc(m.checkpoint)}<br><small>${esc(MISSION_RESULT[m.result] || m.result)}</small></span><small>${esc(min(m.atMin))} min</small></li>`)
    .join('');
  const trophies = (d.trophies || []).map((t) => `<li><span>🏆 ${esc(t.name)}</span><small>${esc(TROPHY_WHY[t.why] || t.why)}</small></li>`).join('');

  body().innerHTML = `<button type="button" class="back-link" id="historyToList">‹ Zurück zur Liste</button>
    <div class="card">
      <h3>${resultLabel(d.winner)}</h3>
      <p class="hint">${esc(d.reason)}</p>
      <p class="hint">${esc(formatDate(d.startedAt))} · ${esc(min(d.durationMin))} min · Code ${esc(d.code)}</p>
      <p class="hint">${rulesLine(d.settings || {})}</p>
    </div>
    <div class="card"><h3>Spieler</h3><ul class="stats">${(d.players || []).map((p, _i, all) => playerLine(p, all)).join('')}</ul></div>
    ${trophies ? `<div class="card"><h3>Auszeichnungen</h3><ul class="stats">${trophies}</ul></div>` : ''}
    ${jokers ? `<div class="card"><h3>Eingesetzte Joker</h3><ul class="stats">${jokers}</ul></div>` : ''}
    ${events ? `<div class="card"><h3>Events</h3><ul class="stats">${events}</ul></div>` : ''}
    ${missions ? `<div class="card"><h3>Missionen</h3><ul class="stats">${missions}</ul></div>` : ''}
    <div class="card">
      <h3>Routen</h3>
      <div class="route-picker" id="historyPicker"></div>
      <div id="historyMap" class="history-map"></div>
      <p class="hint" id="historyRouteInfo"></p>
    </div>
    ${
      // Nur das Hauptpasswort bekommt den Gruppennamen mitgeschickt – und nur das darf löschen.
      'group' in d
        ? `<div class="card history-delete"><button class="btn" id="historyDelete">🗑️ Runde löschen</button>
           <p class="hint" id="historyDeleteHint">Löscht die Runde endgültig, zum Beispiel wenn ein Spieler das verlangt.</p></div>`
        : ''
    }`;
  $('#historyToList').addEventListener('click', loadList);
  $('#historyDelete')?.addEventListener('click', () => deleteRound(d.id));
  setupMap(d);
}

// Zweimal tippen: erst nachfragen, dann endgültig löschen.
async function deleteRound(id) {
  const btn = $('#historyDelete');
  if (!btn.dataset.confirm) {
    btn.dataset.confirm = '1';
    btn.textContent = '⚠️ Wirklich löschen? Nochmal tippen';
    btn.classList.add('danger');
    $('#historyDeleteHint').textContent = 'Das lässt sich nicht rückgängig machen.';
    return;
  }
  btn.disabled = true;
  try {
    await api(`/api/rounds/${encodeURIComponent(id)}`, 'DELETE');
    loadList();
  } catch (err) {
    btn.disabled = false;
    $('#historyDeleteHint').textContent = err.status ? err.message : 'Keine Verbindung zum Server.';
  }
}

function setupMap(d) {
  if (typeof L === 'undefined') {
    $('#historyRouteInfo').textContent = 'Karte konnte nicht geladen werden.';
    $('#historyMap').remove();
    return;
  }
  const trails = d.trails || {};
  const players = d.players || [];
  const roleOf = (name) => players.find((p) => p.name === name)?.startRole;
  const dist = (name) => players.find((p) => p.name === name)?.distanceM ?? 0;
  const names = Object.keys(trails).sort((a, b) => dist(b) - dist(a));
  let current = names[0];

  const z = d.settings?.zone || { lat: 48.0603, lng: 8.4586, radius: 1200 };
  map = L.map('historyMap', { zoomControl: false }).setView([z.lat, z.lng], 14);
  addBaseLayer(map);
  const m = map;
  let layer = null;

  const draw = () => {
    layer?.remove();
    layer = L.layerGroup().addTo(m);
    L.circle([z.lat, z.lng], { radius: z.radius, color: '#ff3b4e', weight: 1, fillOpacity: 0.04 }).addTo(layer);
    let bounds = L.latLng(z.lat, z.lng).toBounds(z.radius * 2);
    const pts = (trails[current] || []).map(([lat, lng]) => [lat, lng]);
    const color = roleOf(current) === 'hunter' ? '#ff3b4e' : '#22d67e';
    if (pts.length) {
      L.polyline(pts, { color, weight: 4, opacity: 0.9 }).addTo(layer);
      L.circleMarker(pts[0], { radius: 6, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 }).addTo(layer).bindTooltip('Start');
      L.circleMarker(pts.at(-1), { radius: 7, color, fillOpacity: 1 }).addTo(layer).bindTooltip('Ende');
      bounds = L.latLngBounds(pts);
    }
    $('#historyRouteInfo').textContent = current
      ? pts.length
        ? `${current}: ${formatDistance(dist(current))} gelaufen. Weißer Kreis = Start.`
        : `Für ${current} gibt es keine Route.`
      : 'Keine Routen gespeichert.';
    setTimeout(() => {
      if (map !== m) return;
      m.invalidateSize();
      m.fitBounds(bounds, { padding: [20, 20], maxZoom: 17 });
    }, 80);
  };

  const picker = $('#historyPicker');
  picker.innerHTML = names
    .map(
      (n) => `<button class="route-chip" data-name="${esc(n)}">
        <span class="dot" style="background:${roleOf(n) === 'hunter' ? 'var(--hunter)' : 'var(--hider)'}"></span>${esc(n)}
        <small>${esc(formatDistance(dist(n)))}</small></button>`,
    )
    .join('');
  const mark = () => picker.querySelectorAll('.route-chip').forEach((b) => b.classList.toggle('active', b.dataset.name === current));
  picker.querySelectorAll('.route-chip').forEach((b) =>
    b.addEventListener('click', () => {
      current = b.dataset.name;
      mark();
      draw();
    }),
  );
  mark();
  draw();
}

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-open="history"]')) openHistory();
});
$('#historyBack').addEventListener('click', closeHistory);
