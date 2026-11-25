/* global L, io, qrcode */
import { buildResultText, groupLabel } from './share-text.js';
import { firstTimeUpdate, isFirstTime } from './first-time.js';
import { iconize, observeEmojis } from './icons.js';
import { addBaseLayer } from './basemap.js';
import { deviceId } from './device.js';

// Emojis in allen angezeigten Texten durch einheitliche Symbole ersetzen (siehe icons.js)
observeEmojis(document.body);

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pad = (n) => String(n).padStart(2, '0');

const ZONES = {
  villingen: { lat: 48.0603, lng: 8.4586, radius: 1200 },
  schwenningen: { lat: 48.0627, lng: 8.5353, radius: 1200 },
  vs: { lat: 48.0605, lng: 8.496, radius: 4500 },
};
const CHANNEL_NAMES = { all: 'Alle', hunter: 'Jäger-Team', hider: 'Hider-Team' };

const store = {
  get(key) {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* privater Modus o. ä. */
    }
  },
};

const S = {
  view: null,
  offset: 0,
  session: store.get('manhunt-session'),
  gps: { watchId: null, last: null, status: 'off', lastSent: 0 },
  wakeLock: null,
  wakeLockFailed: false,
  chat: { msgs: [], channel: null, unread: 0, channelsKey: '' },
  tab: 'map',
  sim: false,
  maps: {},
  markers: new Map(),
  codeVisible: false,
  fittedRound: null,
  trails: null,
  everConnected: false,
  step: 1,
  hunterCount: null,
};

const now = () => Date.now() + S.offset;

// ---------------------------------------------------------------- Verbindung
const socket = io({ transports: ['websocket', 'polling'] });

function send(event, data = {}) {
  return new Promise((resolve) => {
    socket.timeout(10000).emit(event, data, (err, res) => resolve(err ? { ok: false, error: 'Keine Antwort vom Server.' } : res));
  });
}

socket.on('connect', async () => {
  S.everConnected = true;
  $('#connLost').hidden = true;
  if (S.session) {
    const r = await send('resume', S.session);
    if (!r.ok) {
      setSession(null);
      S.view = null;
      render();
    }
  }
});
socket.on('disconnect', () => {
  if (S.everConnected) $('#connLost').hidden = false;
});
socket.on('session', (s) => setSession(s));
socket.on('state', (v) => {
  const prev = S.view;
  S.view = v;
  S.offset = v.serverNow - Date.now();
  onState(prev, v);
});
socket.on('toast', (t) => {
  toast(t.text, t.kind);
  if (t.sound) sound(t.sound);
});
socket.on('chat', (m) => addChatMsg(m));
socket.on('chatHistory', (list) => {
  S.chat.msgs = list;
  renderChats();
});
socket.on('kicked', () => {
  setSession(null);
  S.view = null;
  render();
  toast('Du wurdest aus dem Spiel entfernt.', 'warn');
});

function setSession(s) {
  S.session = s;
  store.set('manhunt-session', s);
}

function onState(prev, v) {
  document.body.classList.toggle('is-host', v.me.isHost);
  const last = v.events?.last;
  if (last && last.at !== S.shownEventAt) {
    S.shownEventAt = last.at;
    if ((v.phase === 'hunt' || v.phase === 'headstart') && now() - last.at < 20_000) showEventOverlay(last, v.eventInfo);
  }
  // Rollentausch: wer plötzlich Hider ist, bekommt die Erklärung neu
  if (prev && prev.round === v.round && prev.me.role !== v.me.role && v.phase === 'hunt' && !v.me.spectator) {
    S.roleHelpAfterEvent = true;
  }
  // Neuer Streitfall: dem Spielleiter einmal automatisch zur Entscheidung zeigen
  if (v.me.isHost) {
    S.seenDisputes ??= new Set();
    const fresh = (v.disputes ?? []).find((d) => !S.seenDisputes.has(d.id));
    if (fresh) {
      S.seenDisputes.add(fresh.id);
      setTimeout(() => openDisputeDecision(fresh.id), 200);
    }
  }
  if (S.disputeOpen && !(v.disputes ?? []).some((d) => d.id === S.disputeOpen)) {
    if ($('#disputeYes')) closeModal();
    S.disputeOpen = null;
  }
  if (!prev) sendPos(true);
  const key = v.chatChannels.join(',');
  if (key !== S.chat.channelsKey) {
    S.chat.channelsKey = key;
    S.chat.channel = v.chatChannels[0];
    if (prev) send('chatHistory');
  }
  if (prev?.phase !== v.phase || prev?.round !== v.round) {
    S.codeVisible = false;
    if (v.phase === 'ended') loadTrails();
    if (v.phase === 'headstart' || v.phase === 'hunt') {
      const introKey = `${v.code}-${v.round}`;
      if (store.get('manhunt-intro') !== introKey) {
        store.set('manhunt-intro', introKey);
        setTimeout(openRoleHelp, 300);
      }
      requestWakeLock().then(() => {
        if (S.wakeLockFailed && !bgActive(S.view)) toast('💡 Lass den Bildschirm an – sonst sendet dein Handy keinen Standort.', 'warn');
      });
      if (S.gps.status === 'off') startGps();
    }
  }
  render();
  if (prev && prev.round === v.round && (v.phase === 'hunt' || v.phase === 'headstart')) detectMoments(prev, v);
}

// ---------------------------------------------------------------- Momente: Fang und Ping
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function detectMoments(prev, v) {
  const before = new Map(prev.players.map((p) => [p.id, p.status]));
  const caught = v.players.filter((p) => p.status === 'caught' && before.has(p.id) && before.get(p.id) !== 'caught');
  if (caught.length) showCatchMoment(caught, v);
  if (v.phase === 'hunt' && v.lastPingAt && v.lastPingAt !== prev.lastPingAt) showPingWave(v);
}

const CROSSHAIR = `<svg class="mo-cross" viewBox="0 0 120 120" aria-hidden="true">
  <circle class="mo-ring" cx="60" cy="60" r="40"/>
  <path class="mo-line mo-l1" d="M60 4v30"/><path class="mo-line mo-l2" d="M60 86v30"/>
  <path class="mo-line mo-l3" d="M4 60h30"/><path class="mo-line mo-l4" d="M86 60h30"/>
  <circle class="mo-dot" cx="60" cy="60" r="9"/>
</svg>`;

// Kurze Vollbild-Animation: das Fadenkreuz zieht sich zu, das Handy vibriert.
function showCatchMoment(list, v) {
  const p = list[0];
  const me = v.me;
  const free = v.players.filter((x) => x.role === 'hider' && x.status === 'alive').length;
  const by = p.caughtBy ? esc(p.caughtBy) : 'Ein Jäger';
  let title = 'Gefangen';
  let line = `<b>${by}</b> hat <b>${esc(p.name)}</b> erwischt`;
  if (p.id === me.id) {
    title = 'Erwischt';
    line = `Du wurdest von <b>${by}</b> gefangen`;
  } else if (p.caughtBy === me.name) {
    line = `Du hast <b>${esc(p.name)}</b> erwischt`;
  }
  if (list.length > 1) line += ` <span class="muted">(+${list.length - 1} weitere)</span>`;
  const rest = free === 0 ? 'Kein Hider mehr frei' : free === 1 ? 'Noch 1 Hider frei' : `Noch ${free} Hider frei`;
  const el = $('#moment');
  el.className = 'moment catch';
  el.innerHTML = `<div class="mo-box">${CROSSHAIR}<div class="mo-title">${title}</div><p>${line}</p><small>${rest}</small></div>`;
  el.hidden = false;
  void el.offsetWidth; // Animation neu starten
  el.classList.add('play');
  try {
    navigator.vibrate?.([60, 40, 60, 40, 260]);
  } catch {
    /* nicht unterstützt */
  }
  clearTimeout(S.momentTimer);
  S.momentTimer = setTimeout(() => {
    el.classList.add('out');
    S.momentTimer = setTimeout(() => (el.hidden = true), 300);
  }, 2300);
}

// Radar-Welle über die Karte, dazu leuchten die neuen Ping-Punkte kurz auf.
function showPingWave(v) {
  const map = S.maps.game;
  if (!map) return;
  const box = $('#radarWaves');
  const size = map.getSize();
  let x = size.x / 2;
  let y = size.y / 2;
  const self = v.players.find((p) => p.id === v.me.id);
  if (v.me.role === 'hider' && self?.pos) {
    const pt = map.latLngToContainerPoint([self.pos.lat, self.pos.lng]);
    if (pt.x >= 0 && pt.y >= 0 && pt.x <= size.x && pt.y <= size.y) ({ x, y } = pt);
  }
  if (!reducedMotion()) {
    box.innerHTML = '<i></i><i></i><i></i>';
    box.style.setProperty('--wx', `${x}px`);
    box.style.setProperty('--wy', `${y}px`);
    box.classList.remove('play');
    void box.offsetWidth;
    box.classList.add('play');
    clearTimeout(S.waveTimer);
    S.waveTimer = setTimeout(() => {
      box.classList.remove('play');
      box.innerHTML = '';
    }, 2200);
  }
  for (const p of v.players) {
    if (p.kind !== 'ping') continue;
    const el = S.markers.get(p.id)?.marker.getElement()?.querySelector('.mk');
    if (!el) continue;
    el.classList.remove('fresh');
    void el.offsetWidth;
    el.classList.add('fresh');
    setTimeout(() => el.classList.remove('fresh'), 2600);
  }
}

// ---------------------------------------------------------------- Rendering
function currentScreen() {
  const v = S.view;
  if (!v) return 'home';
  if (v.phase === 'lobby') return 'lobby';
  if (v.phase === 'ended') return 'end';
  return 'game';
}

let shownScreen = null;
function render() {
  const screen = currentScreen();
  if (screen !== shownScreen) {
    $$('.screen').forEach((el) => el.classList.toggle('active', el.id === screen));
    document.body.classList.toggle('in-game', screen === 'game');
    if (screen === 'home') homeStep = null;
    shownScreen = screen;
    window.scrollTo(0, 0);
    setTimeout(() => Object.values(S.maps).forEach((m) => m.invalidateSize()), 60);
  }
  if (screen === 'home') renderHome();
  if (screen === 'lobby') renderLobby();
  if (screen === 'game') renderGame();
  if (screen === 'end') renderEnd();
  renderChats();
}

function initials(name) {
  return Array.from(
    String(name)
      .split(/\s+/)
      .map((w) => Array.from(w)[0] ?? '')
      .join(''),
  )
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function fmt(ms) {
  if (ms == null || !Number.isFinite(ms)) return '--:--';
  const s = Math.ceil(Math.max(0, ms) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

function ago(t) {
  const s = Math.max(0, Math.round((now() - t) / 1000));
  if (s < 60) return 'gerade eben';
  return `vor ${Math.floor(s / 60)} min`;
}

function distanceM(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

// Zeitplan der Zonen-Stufen – gleiche Formeln wie planZoneStages() in server/game.js
function shrinkPlan(s) {
  if (!s.shrink) return [];
  const n = s.shrinkSteps;
  return Array.from({ length: n }, (_, i) => {
    const k = i + 1;
    return {
      minute: (s.durationMin * k) / (n + 1),
      radius: Math.round(s.zone.radius + ((s.finalRadius - s.zone.radius) * k) / n),
    };
  });
}

const trophyMark = (p) => (p.trophy ? ' <span title="Pokal aus der letzten Runde">🏆</span>' : '');
const boundsOf = (z, radius = z.radius) => L.latLng(z.lat, z.lng).toBounds(radius * 2);

function makeMap(el, opts = {}) {
  // Leaflet braucht eine Startansicht, bevor Kreise gezeichnet werden können.
  const map = L.map(el, { zoomControl: false, ...opts }).setView([ZONES.villingen.lat, ZONES.villingen.lng], 14);
  addBaseLayer(map); // dunkle Manhunt-Karte, siehe basemap.js
  return map;
}

// ---------------------------------------------------------------- Start
let homeStep = null;
function showHomeStep(step) {
  homeStep = step;
  $('#homeMenu').hidden = step !== 'menu';
  $('#joinForm').hidden = step !== 'join';
  $('#createForm').hidden = step !== 'create';
  window.scrollTo(0, 0);
  const focus = step === 'join' ? ($('#joinCode').value.length === 4 ? '#joinName' : '#joinCode') : step === 'create' ? ($('#createName').value ? '#createPassword' : '#createName') : null;
  if (focus) setTimeout(() => $(focus).focus(), 50);
}

function renderHome() {
  const code = new URLSearchParams(location.search).get('code');
  if (code && !$('#joinCode').value) $('#joinCode').value = code.toUpperCase().slice(0, 4);
  const name = store.get('manhunt-name');
  if (name) {
    if (!$('#joinName').value) $('#joinName').value = name;
    if (!$('#createName').value) $('#createName').value = name;
  }
  // Das Passwort merkt sich das Handy nach dem ersten richtigen Versuch.
  const pw = store.get('manhunt-host-pw');
  if (pw && !$('#createPassword').value) $('#createPassword').value = pw;
  if (!homeStep) showHomeStep(code ? 'join' : 'menu');
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-home]');
  if (b) showHomeStep(b.dataset.home);
});

$('#joinForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  unlockAudio();
  const name = $('#joinName').value.trim();
  const r = await send('join', { code: $('#joinCode').value.trim().toUpperCase(), name });
  if (!r.ok) return toast(r.error, 'error');
  store.set('manhunt-name', name);
  history.replaceState(null, '', '/');
});

$('#createForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  unlockAudio();
  const name = $('#createName').value.trim();
  const password = $('#createPassword').value.trim();
  const r = await send('create', { name, password, device: deviceId() });
  if (!r.ok) {
    if (/Passwort/.test(r.error)) {
      store.set('manhunt-host-pw', null);
      $('#createPassword').select();
    }
    return toast(r.error, 'error');
  }
  store.set('manhunt-name', name);
  store.set('manhunt-host-pw', password);
  S.step = 1;
});

$('#joinCode').addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
});

// ---------------------------------------------------------------- Lobby
const PRESETS = {
  short: { durationMin: 30, headStartMin: 3, pingIntervalMin: 3, shrinkSteps: 2 },
  normal: { durationMin: 60, headStartMin: 5, pingIntervalMin: 5, shrinkSteps: 3 },
  long: { durationMin: 90, headStartMin: 10, pingIntervalMin: 7, shrinkSteps: 4 },
};

const SETTINGS_FIELDS = [
  { h: 'Zeit' },
  { key: 'durationMin', label: 'Spieldauer', options: [20, 30, 45, 60, 75, 90, 120], unit: 'min' },
  { key: 'headStartMin', label: 'Vorsprung', options: [0, 1, 2, 3, 5, 10, 15], unit: 'min' },
  { key: 'pingIntervalMin', label: 'Ping alle', options: [1, 2, 3, 4, 5, 7, 10, 15], unit: 'min' },
  { key: 'outGraceSec', label: 'Zeit außerhalb der Zone', options: [0, 15, 30, 60, 120], unit: 's' },
  { h: 'Zone' },
  { key: 'shrink', label: 'Zone wird in Stufen kleiner', toggle: true },
  { key: 'shrinkSteps', label: 'Anzahl Stufen', options: [1, 2, 3, 4, 5, 6], shrinkOnly: true },
  { key: 'shrinkWarnMin', label: 'Vorwarnung', options: [0, 1, 2, 3, 5], unit: 'min', shrinkOnly: true },
  { preview: true },
  { h: 'Spielmodus' },
  { key: 'hidersSeeEachOther', label: 'Hider sehen sich gegenseitig', toggle: true },
  { key: 'infection', label: 'Gefangene werden zu Jägern', toggle: true },
  { h: 'Joker' },
  { key: 'hiderJokers', label: 'Joker pro Hider', options: [0, 1, 2, 3] },
  { key: 'hunterExtraPings', label: '🛰️ Sonder-Pings (Jäger)', options: [0, 1, 2, 3, 4, 5] },
  { key: 'hunterDrones', label: '🚁 Drohnen (Jäger)', options: [0, 1, 2, 3] },
  { key: 'hunterSniffs', label: '🐕 Spürnasen (Jäger)', options: [0, 1, 2, 3, 4, 5] },
  { h: 'Spannung' },
  { key: 'pingTrail', label: 'Ping-Spur für Jäger', options: [0, 2, 3, 4], labels: { 0: 'aus', 2: 'letzte 2 Pings', 3: 'letzte 3 Pings', 4: 'letzte 4 Pings' } },
  { key: 'pingSpeedup', label: 'Pings mit jeder Zonenstufe schneller (bis doppelt so oft)', toggle: true },
  { key: 'finaleSec', label: 'Finale: alle Hider live in den letzten', options: [0, 60, 90, 120, 180], labels: { 0: 'aus', 60: '1 min', 90: '1,5 min', 120: '2 min', 180: '3 min' } },
  { key: 'comebackAt', label: 'Bonus-Joker, wenn nur noch … Hider frei', options: [0, 1, 2, 3], labels: { 0: 'aus', 1: '1 Hider', 2: '2 Hider', 3: '3 Hider' } },
];
const optionText = (f, o) => f.labels?.[o] ?? `${o}${f.unit ? ' ' + f.unit : ''}`;

function buildSettingsForm() {
  const form = $('#settingsForm');
  if (form.dataset.built) return;
  form.dataset.built = '1';
  form.innerHTML = SETTINGS_FIELDS.map((f) => {
    if (f.h) return `<h3>${f.h}</h3>`;
    if (f.preview) return '<p id="shrinkPreview" class="hint full"></p>';
    if (f.toggle) {
      return `<label class="toggle full">${f.label}<input type="checkbox" name="${f.key}" /></label>`;
    }
    const opts = f.options.map((o) => `<option value="${o}">${optionText(f, o)}</option>`).join('');
    return `<label>${f.label}<select name="${f.key}">${opts}</select></label>`;
  }).join('');
  form.addEventListener('change', (e) => {
    const el = e.target;
    const value = el.type === 'checkbox' ? el.checked : Number(el.value);
    saveSettings({ [el.name]: value });
  });
}

function saveSettings(data) {
  send('settings', data).then((r) => !r.ok && toast(r.error, 'error'));
}

function renderSettingsForm(v) {
  buildSettingsForm();
  const form = $('#settingsForm');
  for (const f of SETTINGS_FIELDS) {
    if (!f.key) continue;
    const el = form.elements[f.key];
    if (document.activeElement === el) continue;
    if (f.toggle) el.checked = Boolean(v.settings[f.key]);
    else {
      const val = String(v.settings[f.key]);
      if (![...el.options].some((o) => o.value === val)) el.add(new Option(optionText(f, Number(val)), val));
      el.value = val;
    }
    if (f.shrinkOnly) el.closest('label').style.display = v.settings.shrink ? '' : 'none';
  }
  const plan = shrinkPlan(v.settings);
  $('#shrinkPreview').innerHTML = plan.length
    ? `Die Zone schrumpft bei ${plan.map((p) => `<b>Minute ${formatMinute(p.minute)}</b> auf ${formatDistance(p.radius)}`).join(', ')} (gezählt ab Ende des Vorsprungs).`
    : 'Die Zone bleibt das ganze Spiel gleich groß.';
}

const minutesText = (n) => (n === 1 ? '1 Minute' : `${n} Minuten`);

// Die Regeln in einfachen Sätzen – für die Vorschau beim Spielleiter und für alle anderen.
const CATCH_RULE_TEXT = {
  touch: 'Gefangen ist, wen ein Jäger <b>berührt</b> (abklatschen).',
  arm: 'Gefangen ist, wem ein Jäger auf <b>Armlänge</b> (1–2 m) nahekommt und den Namen ruft.',
};
const catchRuleText = (s) => CATCH_RULE_TEXT[s.catchRule] ?? CATCH_RULE_TEXT.touch;

function eventCount(s) {
  if (!s.eventsMode || s.eventsMode === 'off') return 0;
  const perHour = s.eventsMode === 'often' ? 4 : 2;
  return Math.max(1, Math.min(5, Math.round((s.durationMin / 60) * perHour)));
}

function rulesSummary(s) {
  const plan = shrinkPlan(s);
  const hunterJokers = s.hunterExtraPings + s.hunterDrones + s.hunterSniffs;
  const out = [
    ['⏱️', `Das Spiel dauert <b>${minutesText(s.durationMin)}</b>.`],
    ['🏃', s.headStartMin ? `Die Hider haben <b>${minutesText(s.headStartMin)} Vorsprung</b>.` : 'Es gibt <b>keinen Vorsprung</b> – die Jagd beginnt sofort.'],
    [
      '📍',
      s.pingIntervalMin === 1
        ? '<b>Jede Minute</b> sehen die Jäger, wo die Hider gerade sind.'
        : `<b>Alle ${s.pingIntervalMin} Minuten</b> sehen die Jäger, wo die Hider gerade sind.`,
    ],
    [
      '🗺️',
      plan.length
        ? `Die Zone (${formatDistance(s.zone.radius)} Radius) wird <b>${plan.length}-mal kleiner</b>, am Ende ${formatDistance(plan.at(-1).radius)}.`
        : `Die Zone (${formatDistance(s.zone.radius)} Radius) bleibt gleich groß.`,
    ],
    ...(plan.length && s.finalMode === 'custom'
      ? [['🎯', 'Wo die Zone am Ende liegt, hat der Spielleiter festgelegt. Das bleibt <b>geheim</b>.']]
      : plan.length && s.finalMode === 'random'
        ? [['🔀', 'Bei jeder Stufe springt die Zone an eine <b>zufällige Stelle</b> innerhalb der alten.']]
        : []),
    ['🚫', s.outGraceSec ? `Wer die Zone länger als ${s.outGraceSec} Sekunden verlässt, wird live angezeigt.` : 'Wer die Zone verlässt, wird sofort live angezeigt.'],
  ];
  if (s.hiderJokers || hunterJokers) {
    out.push(['🃏', `Jeder Hider bekommt <b>${s.hiderJokers} Joker</b>, die Jäger haben zusammen <b>${hunterJokers}</b>.`]);
  }
  if (s.infection) out.push(['🔄', 'Wer gefangen wird, <b>wird zum Jäger</b>.']);
  if (plan.length && s.pingSpeedup && s.pingIntervalMin > 1) {
    out.push(['⏩', `Mit jeder Zonenstufe kommen die Pings schneller, am Ende <b>alle ${Math.ceil(s.pingIntervalMin / 2)} Minuten</b>.`]);
  }
  if (s.pingTrail > 0) out.push(['〰️', `Jäger sehen die <b>letzten ${s.pingTrail} Pings</b> eines Hiders als Spur, wenn sie seinen Punkt antippen.`]);
  if (s.comebackAt > 0) out.push(['🎁', `Sind nur noch <b>${s.comebackAt} Hider</b> frei, bekommt jeder einmal eine Tarnkappe oder einen Doppelgänger.`]);
  if (s.finaleSec > 0) out.push(['🔥', `<b>Finale:</b> In den letzten ${s.finaleSec % 60 ? (s.finaleSec / 60).toString().replace('.', ',') : s.finaleSec / 60} Minuten sind alle Hider live sichtbar.`]);
  const events = eventCount(s);
  if (events) {
    out.push(['🎲', `<b>Special Events:</b> ${events === 1 ? 'eine Überraschung' : `${events} Überraschungen`} während der Jagd – wann, weiß niemand.`]);
  }
  out.push(['✋', `${catchRuleText(s)} Dann sofort stehen bleiben und den Code zeigen.`]);
  out.push(['🏆', 'Sind alle Hider gefangen, gewinnen die Jäger – sonst die Hider.']);
  return out;
}

function renderRules(el, s) {
  let html = rulesSummary(s)
    .map(([icon, text]) => `<li><span class="r-icon">${icon}</span><span>${text}</span></li>`)
    .join('');
  html = iconize(html);
  if (el.innerHTML !== html) el.innerHTML = html;
}

function renderLobby() {
  const v = S.view;
  $('#lobbyCode').textContent = v.code;
  renderGpsCard();
  renderBgCard(v);
  if (v.me.isHost) renderHostSetup(v);
  else renderGuestWait(v);
}

function goStep(n) {
  S.step = Math.min(4, Math.max(1, n));
  renderLobby();
  window.scrollTo(0, 0);
  setTimeout(() => S.maps.zone?.invalidateSize(), 60);
}

$('#stepper').addEventListener('click', (e) => {
  const b = e.target.closest('[data-step]');
  if (b) goStep(Number(b.dataset.step));
});

function suggestedHunters(n) {
  return Math.max(1, Math.min(n - 1, Math.round(n / 5)));
}

function renderHostSetup(v) {
  $('#hostGroupHello').textContent = v.groupName ? `Hallo Gruppe ${groupLabel(v.groupName)} 👋 Willkommen bei Manhunt!` : '';
  $$('#stepper button').forEach((b) => {
    const n = Number(b.dataset.step);
    b.classList.toggle('active', n === S.step);
    b.classList.toggle('done', n < S.step);
  });
  $$('#lobby .step').forEach((el) => el.classList.toggle('show', Number(el.dataset.step) === S.step));
  const players = v.players;

  // 1 – Einladen
  $('#inviteCode').textContent = v.code;
  renderInviteQr(v.code);
  $('#shareLinkBtn').hidden = !navigator.share;
  $('#joinedCount').textContent = `(${players.length})`;
  $('#joinedList').innerHTML = players
    .map((p) => `<li class="${p.connected ? '' : 'offline'}"><span class="dot ${p.hasGps ? 'ok' : 'bad'}"></span>${esc(p.name)}${trophyMark(p)}${p.id === v.me.id ? ' (du)' : ''}</li>`)
    .join('');

  // 2 – Spielfeld
  if (S.step === 2) renderZoneMap(v);
  renderLastSettings(v);
  $$('#sizeSeg button').forEach((b) => b.classList.toggle('active', Number(b.dataset.size) === v.settings.zone.radius));

  // 3 – Regeln
  const preset = Object.entries(PRESETS).find(([, p]) => Object.entries(p).every(([k, val]) => v.settings[k] === val))?.[0];
  $$('#presets button').forEach((b) => b.classList.toggle('active', b.dataset.preset === preset));
  const firstTime = isFirstTime(v.settings);
  $('#firstTimeBtn').classList.toggle('active', firstTime);
  $('#firstTimeHint').textContent = firstTime
    ? '✓ Empfohlene Einstellungen sind aktiv. Unten kannst du trotzdem alles anpassen.'
    : 'Empfohlene Einstellungen: 60 min, Zone 1,2 km mit 4 Stufen bis 300 m, Ping alle 4 min, abklatschen, Gefangene werden Jäger.';
  renderRules($('#rulesSummary'), v.settings);
  $$('#catchSeg button').forEach((b) => b.classList.toggle('active', b.dataset.catch === (v.settings.catchRule ?? 'touch')));
  $$('#eventsSeg button').forEach((b) => b.classList.toggle('active', b.dataset.events === (v.settings.eventsMode ?? 'off')));
  renderSettingsForm(v);

  // 4 – Teams
  const n = players.length;
  S.hunterCount = Math.min(Math.max(1, n - 1), Math.max(1, S.hunterCount ?? suggestedHunters(n)));
  $('#hunterCount').textContent = S.hunterCount;
  $('#hunterTip').textContent =
    n < 2 ? 'Es braucht mindestens 2 Spieler.' : `Empfehlung: etwa 1 Jäger auf 5 Spieler – bei ${n} Spielern also ${suggestedHunters(n)}.`;
  const hunters = players.filter((p) => p.role === 'hunter');
  const hiders = players.filter((p) => p.role === 'hider');
  $('#teamCount').textContent = `🎯 ${hunters.length} Jäger · 🏃 ${hiders.length} Hider`;
  const sorted = [...hunters, ...hiders];
  const teamHtml = sorted
    .map((p) => {
      const me = p.id === v.me.id;
      const sub = [p.hasGps ? '📍 Standort ok' : '⚠️ kein Standort', p.background ? '📱 Hintergrund' : null, p.connected ? null : 'offline']
        .filter(Boolean)
        .join(' · ');
      return `<li>
        <div class="avatar ${p.role}">${esc(initials(p.name))}</div>
        <div class="p-name"><b>${esc(p.name)}${trophyMark(p)}${me ? ' (du)' : ''}</b><small>${sub}</small></div>
        <button class="role-toggle ${p.role}" data-action="toggleRole" data-id="${p.id}" title="Rolle tauschen">${p.role === 'hunter' ? '🎯 Jäger' : '🏃 Hider'}</button>
        ${me ? '' : `<button class="kick-btn" data-action="kick" data-id="${p.id}" aria-label="${esc(p.name)} entfernen">✕</button>`}
      </li>`;
    })
    .join('');
  const teamIcons = iconize(teamHtml);
  if ($('#teamList').innerHTML !== teamIcons) $('#teamList').innerHTML = teamIcons;

  renderCrushPicker(v);
  $('#rerollBtn').hidden = !v.canAvoidLastHunters;

  const noGps = players.filter((p) => !p.hasGps);
  const offline = players.filter((p) => !p.connected);
  const names = (list) => list.map((p) => esc(p.name)).join(', ');
  const checks = [
    [hunters.length ? 'ok' : 'bad', hunters.length ? 'Mindestens ein Jäger' : 'Es fehlt noch ein Jäger'],
    [hiders.length ? 'ok' : 'bad', hiders.length ? 'Mindestens ein Hider' : 'Es fehlt noch ein Hider'],
    [noGps.length ? 'warn' : 'ok', noGps.length ? `Ohne Standort: ${names(noGps)}` : 'Alle haben ihren Standort freigegeben'],
    [offline.length ? 'warn' : 'ok', offline.length ? `Gerade offline: ${names(offline)}` : 'Alle sind online'],
  ];
  const icon = { ok: '✅', bad: '❌', warn: '⚠️' };
  $('#startChecklist').innerHTML = checks.map(([st, text]) => `<li class="${st}"><span>${icon[st]}</span>${text}</li>`).join('');

  // Fußleiste
  $('#stepBack').hidden = S.step === 1;
  $('#stepNext').hidden = S.step === 4;
  $('#startBtn').hidden = S.step !== 4;
  $('#startBtn').disabled = !hunters.length || !hiders.length;
  $('#stepNext').textContent = ['', 'Weiter: Spielfeld ›', 'Weiter: Regeln ›', 'Weiter: Teams ›'][S.step] ?? 'Weiter ›';
}

// Crush: zwei Spieler auswählen. Erst wenn beide gewählt sind, geht es an den Server.
function renderCrushPicker(v) {
  // Gast-Spiele (zweites Spielleiter-Passwort) haben keinen Crush
  $('#crushCard').hidden = !v.features?.crush;
  if (!v.features?.crush) return;
  const pair = v.crushPair ?? S.crushDraft ?? ['', ''];
  const opts = ['<option value="">– niemand –</option>', ...v.players.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`)].join('');
  ['#crushA', '#crushB'].forEach((sel, i) => {
    const el = $(sel);
    if (el.dataset.opts !== opts) {
      el.innerHTML = opts;
      el.dataset.opts = opts;
    }
    if (document.activeElement !== el) el.value = pair[i] ?? '';
  });
  $('#crushClear').hidden = !v.crushPair && !S.crushDraft;
}

function onCrushChange() {
  const a = $('#crushA').value;
  const b = $('#crushB').value;
  if (a && b && a === b) {
    toast('Wähle zwei verschiedene Spieler.', 'error');
    return;
  }
  if (a && b) {
    S.crushDraft = null;
    send('crush', { a, b }).then((r) => !r.ok && toast(r.error, 'error'));
  } else {
    S.crushDraft = [a, b];
    if (S.view?.crushPair) send('crush', { a: null, b: null });
    else render();
  }
}
$('#crushA').addEventListener('change', onCrushChange);
$('#crushB').addEventListener('change', onCrushChange);

function renderGuestWait(v) {
  const group = v.groupName ? groupLabel(v.groupName) : '';
  $('#guestGroup').textContent = group ? `Gruppe ${group}` : '';
  $('#guestWelcome').textContent = group ? `Willkommen bei Manhunt, Gruppe ${group}!` : 'Du bist dabei!';
  const host = v.players.find((p) => p.id === v.hostId);
  $('#hostName').textContent = host?.name ?? 'der Spielleiter';
  const me = v.me;
  const ping = v.settings.pingIntervalMin === 1 ? 'jede Minute' : `alle ${v.settings.pingIntervalMin} Minuten`;
  const roleHtml =
    me.role === 'hunter'
      ? `<div class="role-big hunter">🎯</div><div><small>Deine Rolle – kann sich bis zum Start noch ändern</small><b class="t-hunter">Jäger</b><p>Du jagst die Hider. Du siehst ${ping}, wo sie gerade sind.</p></div>`
      : `<div class="role-big hider">🏃</div><div><small>Deine Rolle – kann sich bis zum Start noch ändern</small><b class="t-hider">Hider</b><p>Du versteckst dich. Lass dich nicht fangen, bis die Zeit um ist!</p></div>`;
  const roleIcons = iconize(roleHtml);
  if ($('#guestRole').innerHTML !== roleIcons) $('#guestRole').innerHTML = roleIcons;
  renderRules($('#guestRules'), v.settings);
  $('#guestCount').textContent = `(${v.players.length})`;
  $('#guestPlayers').innerHTML = v.players
    .map((p) => `<li class="${p.connected ? '' : 'offline'}">${p.id === v.hostId ? '👑 ' : ''}${esc(p.name)}${trophyMark(p)}${p.id === me.id ? ' (du)' : ''}</li>`)
    .join('');

  const z = v.settings.zone;
  if (!S.maps.guestZone) {
    S.maps.guestZone = makeMap('guestZoneMap', { scrollWheelZoom: false });
    S.guestCircle = L.circle([z.lat, z.lng], { radius: z.radius, color: '#ff3b4e', weight: 2, fillOpacity: 0.08 }).addTo(S.maps.guestZone);
    S.guestZoneKey = '';
  }
  const key = `${z.lat},${z.lng},${z.radius}`;
  if (key !== S.guestZoneKey) {
    S.guestZoneKey = key;
    S.guestCircle.setLatLng([z.lat, z.lng]).setRadius(z.radius);
    setTimeout(() => {
      S.maps.guestZone.invalidateSize();
      S.maps.guestZone.fitBounds(boundsOf(z), { padding: [10, 10] });
    }, 60);
  }
}

// ---------------------------------------------------------------- Hintergrund-Ortung (OwnTracks)
const OWNTRACKS_IOS = 'https://apps.apple.com/app/owntracks/id692424691';
const OWNTRACKS_ANDROID = 'https://play.google.com/store/apps/details?id=org.owntracks.android';

const bgActive = (v) => v.me.bgAt && now() - v.me.bgAt < 5 * 60_000;

// Einrichtungslink: OwnTracks übernimmt damit alle Einstellungen per Fingertipp.
function owntracksLink(v) {
  const tid = (initials(v.me.name).replace(/[^A-Za-z0-9]/g, '') + 'MH').slice(0, 2);
  const config = {
    _type: 'configuration',
    mode: 3, // HTTP
    url: `${location.origin}/owntracks`,
    auth: true,
    username: S.session.playerId,
    password: S.session.token,
    deviceId: 'manhunt',
    tid,
    monitoring: 2, // "Move": laufend orten, auch im Hintergrund
    locatorInterval: 20,
    locatorDisplacement: 15,
    downgrade: 0,
    ignoreInaccurateLocations: 0,
    extendedData: false,
  };
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(config))));
  return `owntracks:///config?inline=${encodeURIComponent(b64)}`;
}

function renderBgCard(v) {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (ua.includes('Mac') && 'ontouchend' in document);
  const android = /Android/.test(ua);
  let html;
  if (bgActive(v)) {
    const secs = Math.round((now() - v.me.bgAt) / 1000);
    html = `<div class="bg-head"><span class="bg-icon">📱</span><div><b>Hintergrund-Ortung aktiv ✅</b>
      <span class="hint">Letztes Signal ${secs < 10 ? 'gerade eben' : secs < 60 ? `vor ${secs} s` : `vor ${Math.floor(secs / 60)} min`}. Du kannst dein Handy jetzt auch sperren.</span></div></div>
      <p class="hint">Nach dem Spiel: In OwnTracks den Modus auf <b>„Ruhig“ (Quiet)</b> stellen oder die App löschen – dann ortet sie nicht mehr.</p>`;
  } else {
    const store = ios
      ? `<a class="btn" href="${OWNTRACKS_IOS}" target="_blank" rel="noopener">App Store öffnen</a>`
      : android
        ? `<a class="btn" href="${OWNTRACKS_ANDROID}" target="_blank" rel="noopener">Play Store öffnen</a>`
        : `<div class="row"><a class="btn" href="${OWNTRACKS_IOS}" target="_blank" rel="noopener">iPhone</a><a class="btn" href="${OWNTRACKS_ANDROID}" target="_blank" rel="noopener">Android</a></div>`;
    html = `<details ${S.bgOpen ? 'open' : ''}>
      <summary><span class="bg-icon">📱</span><div><b>Ortung bei gesperrtem Handy</b><span class="hint">Optional – damit du das Handy in die Tasche stecken kannst</span></div></summary>
      <ol class="bg-steps">
        <li><b>Kostenlose App „OwnTracks“ installieren</b>${store}</li>
        <li><b>In OwnTracks die Einrichtung per Link erlauben</b><span class="hint">${
          ios
            ? 'OwnTracks öffnen → unten <b>Settings</b> (Einstellungen) → <b>Remote Control</b> → <b>„Allow external configuration“</b> einschalten und bestätigen. Ohne diesen Schalter kommt der Fehler „URL is not allowed“.'
            : 'Falls OwnTracks beim nächsten Schritt meldet, dass die Konfiguration nicht erlaubt ist: im Menü unter <b>Einstellungen</b> die externe Konfiguration erlauben.'
        }</span></li>
        <li><b>Zurück hierher und mit Manhunt verbinden</b><span class="hint">Öffnet OwnTracks und stellt alles automatisch ein. Bestätige dort mit „Importieren“ bzw. „Install“.</span>
          <a class="btn primary" href="${owntracksLink(v)}">🔗 Mit Manhunt verbinden</a></li>
        <li><b>Standort auf „Immer“ erlauben</b><span class="hint">${
          ios
            ? 'Einstellungen → OwnTracks → Standort → <b>Immer</b> und <b>Genauer Standort</b> an.'
            : 'Bei der Frage nach dem Standort <b>„Immer zulassen“</b> wählen (Einstellungen → Apps → OwnTracks → Berechtigungen → Standort).'
        }</span></li>
        <li><b>Fertig!</b><span class="hint">Lauf ein paar Schritte – hier erscheint dann „Hintergrund-Ortung aktiv ✅“. Den Schalter aus Schritt 2 kannst du danach wieder ausschalten.</span></li>
      </ol>
      <details class="manual">
        <summary>Klappt nicht? Von Hand einrichten</summary>
        <p class="hint">In OwnTracks unter <b>Settings</b> eintragen:</p>
        <dl class="manual-values">
          <dt>Mode</dt><dd>HTTP</dd>
          <dt>URL</dt><dd>${esc(`${location.origin}/owntracks`)}</dd>
          <dt>Authentication</dt><dd>an</dd>
          <dt>UserID</dt><dd>${esc(S.session.playerId)}</dd>
          <dt>Password</dt><dd>${esc(S.session.token)}</dd>
          <dt>TrackerID</dt><dd>beliebig, z. B. deine Initialen</dd>
        </dl>
        <p class="hint">Dann auf der Karte oben den Modus <b>„Move“</b> wählen. Die Angaben sind nur für dich – nicht weitergeben.</p>
      </details>
    </details>`;
  }
  for (const card of $$('[data-bg-card]')) {
    if (card.dataset.html !== html) {
      card.innerHTML = html;
      card.dataset.html = html;
      card.querySelector('details')?.addEventListener('toggle', (e) => (S.bgOpen = e.target.open));
    }
  }
}

function inviteUrl() {
  return `${location.origin}/?code=${S.view.code}`;
}

function qrSvg(url) {
  try {
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    return qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  } catch {
    return '';
  }
}

function renderInviteQr(code) {
  if (S.qrFor === code) return;
  S.qrFor = code;
  $('#inviteQr').innerHTML = qrSvg(inviteUrl());
}

async function copyInvite() {
  try {
    await navigator.clipboard.writeText(inviteUrl());
    toast('Link kopiert – jetzt z. B. in WhatsApp einfügen.', 'good');
  } catch {
    toast('Kopieren nicht möglich – halte den Link gedrückt.', 'error');
  }
}

function shareInvite() {
  navigator.share?.({ title: 'Manhunt', text: `Spiel mit bei Manhunt! Code: ${S.view.code}`, url: inviteUrl() }).catch(() => {});
}

function renderZoneMap(v) {
  const z = v.settings.zone;
  if (!S.maps.zone) {
    const map = makeMap('zoneMap', { scrollWheelZoom: 'center' });
    S.maps.zone = map;
    S.zoneCircle = L.circle([z.lat, z.lng], { radius: z.radius, color: '#ff3b4e', weight: 2, fillOpacity: 0.08 }).addTo(map);
    S.zoneCenter = L.circleMarker([z.lat, z.lng], { radius: 5, color: '#ff3b4e', fillOpacity: 1 }).addTo(map);
    S.finalCircle = L.circle([z.lat, z.lng], { radius: 1, color: '#ffb020', weight: 3, dashArray: '2 8', fillOpacity: 0.06 });
    map.fitBounds(boundsOf(z), { padding: [10, 10] });
    map.on('click', (e) => {
      if (!S.view?.me.isHost) return;
      const s = S.view.settings;
      const pos = { lat: e.latlng.lat, lng: e.latlng.lng };
      if (S.tapTarget === 'final' && s.finalMode === 'custom') saveSettings({ finalCenter: pos });
      else setZone({ ...pos, radius: s.zone.radius });
    });
    S.zoneKey = '';
  }
  const s = v.settings;
  const custom = s.shrink && s.finalMode === 'custom' && s.finalCenter;
  const key = `${z.lat},${z.lng},${z.radius},${custom ? `${s.finalCenter.lat},${s.finalCenter.lng}` : ''}`;
  if (key !== S.zoneKey) {
    const bounds = boundsOf(z);
    if (custom) bounds.extend(boundsOf(s.finalCenter, s.finalRadius));
    const recenter = !S.zoneKey || !S.maps.zone.getBounds().contains(bounds);
    S.zoneKey = key;
    S.zoneCircle.setLatLng([z.lat, z.lng]).setRadius(z.radius);
    S.zoneCenter.setLatLng([z.lat, z.lng]);
    if (recenter) S.maps.zone.fitBounds(bounds, { padding: [10, 10] });
  }
  const radiusInput = $('#radiusInput');
  if (document.activeElement !== radiusInput) radiusInput.value = z.radius;
  $('#radiusLabel').textContent = formatDistance(z.radius);
  renderFinalZone(v);
}

// Endzone: Größe, Lage (gleich / zufällig / selbst gewählt) und gelber Kreis auf der Karte.
function renderFinalZone(v) {
  const s = v.settings;
  const custom = s.shrink && s.finalMode === 'custom' && s.finalCenter;
  $('#finalCard').hidden = !s.shrink;
  if (s.shrink && s.finalMode !== 'random') {
    const c = custom ? s.finalCenter : s.zone;
    S.finalCircle.setLatLng([c.lat, c.lng]).setRadius(s.finalRadius).addTo(S.maps.zone);
  } else S.finalCircle.remove();

  if (!custom) S.tapTarget = 'zone';
  $('#tapSeg').hidden = !custom;
  $$('#tapSeg button').forEach((b) => b.classList.toggle('active', b.dataset.tap === (S.tapTarget ?? 'zone')));
  $('#tapHint').textContent = !custom
    ? 'Tipp: Tippe auf die Karte, um die Mitte zu verschieben.'
    : S.tapTarget === 'final'
      ? 'Tippe auf die Karte, um die Endzone zu setzen. Sie darf auch außerhalb der Startzone liegen.'
      : 'Tippe auf die Karte, um die Startzone zu verschieben.';

  const input = $('#finalRadiusInput');
  input.max = s.zone.radius;
  if (document.activeElement !== input) input.value = s.finalRadius;
  $('#finalRadiusLabel').textContent = formatDistance(s.finalRadius);
  $$('#finalModeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.final === s.finalMode));
  $('#finalHint').innerHTML = finalHint(s);
}

const WALK_M_PER_MIN = 80; // zügiges Gehen, knapp 5 km/h

function finalHint(s) {
  if (s.finalMode === 'same') return 'Die Endzone hat dieselbe Mitte wie die Startzone.';
  if (s.finalMode === 'random') return 'Bei jeder Stufe springt die Zone an eine zufällige Stelle, immer komplett innerhalb der alten Zone.';
  const d = distanceM(s.zone, s.finalCenter);
  const parts = ['🔒 Nur du siehst, wo die Endzone liegt. Die anderen sehen jede Stufe erst bei der Vorwarnung.'];
  if (d + s.finalRadius > s.zone.radius + 1) parts.push('Die Endzone liegt teilweise außerhalb der Startzone.');
  const step = d / s.shrinkSteps;
  if (step >= 100) {
    const walk = Math.ceil(step / WALK_M_PER_MIN);
    let t = `Die Zone wandert pro Stufe etwa <b>${formatDistance(Math.round(step / 50) * 50)}</b>, zu Fuß rund ${minutesText(walk)}.`;
    if (walk > s.shrinkWarnMin) {
      const want = Math.min(10, walk);
      t += ` Die Vorwarnung steht auf ${minutesText(s.shrinkWarnMin)}.`;
      t +=
        walk <= 10
          ? ` Stell sie auf mindestens <b>${minutesText(want)}</b>, damit alle rechtzeitig hinkommen.`
          : ` Mehr als <b>10 Minuten</b> geht nicht. Setz die Endzone näher oder nimm mehr Stufen, damit alle rechtzeitig hinkommen.`;
      t += ` <button class="btn small" data-action="setWarn" data-min="${want}">Vorwarnung auf ${want} min</button>`;
    }
    parts.push(t);
  }
  return parts.join(' ');
}

function formatDistance(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m)} m`;
}

// 22.5 -> "22:30"
function formatMinute(m) {
  const sec = Math.round(m * 60);
  return sec % 60 ? `${Math.floor(sec / 60)}:${pad(sec % 60)}` : String(sec / 60);
}

function setZone(zone) {
  saveSettings({ zone });
}

// Startzone an einen anderen Ort setzen (Suche, Schnellwahl, "Hier, wo ich bin").
// Eine selbst gesetzte Endzone wandert mit und liegt danach genauso zur Startzone wie vorher.
function moveZoneTo(zone, label = null) {
  S.zoneLabel = label;
  const s = S.view.settings;
  const update = { zone };
  let bounds = boundsOf(zone);
  if (s.finalMode === 'custom' && s.finalCenter) {
    update.finalCenter = { lat: s.finalCenter.lat + (zone.lat - s.zone.lat), lng: s.finalCenter.lng + (zone.lng - s.zone.lng) };
    bounds = bounds.extend(boundsOf(update.finalCenter, (s.finalRadius * zone.radius) / s.zone.radius));
  }
  saveSettings(update);
  S.maps.zone?.fitBounds(bounds, { padding: [10, 10] });
}

// "Wie letztes Mal": Beim Start merkt sich das Handy des Spielleiters die Einstellungen
// (Zone, Endzone, Regeln, Joker; nicht Crush und Teams). Übernommen wird nur auf Tipp.
const LAST_KEY = 'manhunt-last-settings';

function rememberSettings(settings) {
  const zone = S.zoneLabel ?? S.lastSettingsLabel ?? null;
  store.set(LAST_KEY, { settings, label: zone, savedAt: Date.now() });
}

function lastSettingsLabel(saved) {
  const s = saved.settings;
  return [saved.label, `${s.durationMin} min`, `Zone ${formatDistance(s.zone.radius)}`].filter(Boolean).join(' · ');
}

function renderLastSettings(v) {
  const saved = store.get(LAST_KEY);
  const btn = $('#lastSettingsBtn');
  // Nur für neue Spiele (noch keine Runde gespielt) und nur, solange nicht schon übernommen
  const show = Boolean(saved?.settings?.zone) && v.round === 0 && S.lastAppliedFor !== v.code;
  btn.hidden = !show;
  if (show) {
    const text = `↩️ Wie letztes Mal (${lastSettingsLabel(saved)})`;
    if (btn.textContent !== text) btn.textContent = text;
  }
}

function applyLastSettings() {
  const saved = store.get(LAST_KEY);
  if (!saved?.settings) return;
  S.lastAppliedFor = S.view.code;
  S.lastSettingsLabel = saved.label;
  const { settings } = saved;
  saveSettings(settings);
  S.maps.zone?.fitBounds(boundsOf(settings.zone), { padding: [10, 10] });
  toast(`Einstellungen übernommen: ${lastSettingsLabel(saved)}`);
  render();
}

// Ortssuche über den eigenen Server (der fragt Nominatim/OpenStreetMap). Bester Treffer sofort,
// weitere Treffer zum Antippen darunter.
function renderPlaceHits(current) {
  const hits = S.placeHits ?? [];
  const others = hits.map((p, i) => [p, i]).filter(([, i]) => i !== current);
  $('#placeResults').innerHTML =
    `<p class="place-current">📍 ${esc(hits[current].name)}</p>` +
    (others.length
      ? `<div class="place-others"><small class="muted">Nicht der richtige Ort?</small>${others
          .map(([p, i]) => `<button type="button" class="chip" data-place="${i}">${esc(p.name)}</button>`)
          .join('')}</div>`
      : '');
}

function pickPlace(i) {
  const p = S.placeHits?.[i];
  if (!p) return;
  moveZoneTo({ lat: p.lat, lng: p.lng, radius: S.view.settings.zone.radius }, p.name.split(', ')[0]);
  renderPlaceHits(i);
}

$('#placeSearch').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $('#placeInput').value.trim();
  if (!q) return;
  $('#placeInput').blur(); // Tastatur auf dem Handy schließen
  const box = $('#placeResults');
  box.innerHTML = '<p class="hint">Suche …</p>';
  try {
    const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || 'Die Ortssuche ist gerade nicht erreichbar.');
    if (!data.length) {
      S.placeHits = [];
      box.innerHTML = '<p class="hint">Nichts gefunden – versuch es mit Ort und Bundesland.</p>';
      return;
    }
    S.placeHits = data;
    pickPlace(0);
  } catch (err) {
    const msg = err instanceof TypeError ? 'Keine Verbindung zum Server.' : err.message;
    box.innerHTML = `<p class="hint place-error">${esc(msg)}</p>`;
  }
});

$('#radiusInput').addEventListener('input', (e) => {
  const r = Number(e.target.value);
  $('#radiusLabel').textContent = formatDistance(r);
  S.zoneCircle?.setRadius(r);
});
$('#finalRadiusInput').addEventListener('input', (e) => {
  const r = Number(e.target.value);
  $('#finalRadiusLabel').textContent = formatDistance(r);
  S.finalCircle?.setRadius(r);
});
$('#finalRadiusInput').addEventListener('change', (e) => saveSettings({ finalRadius: Number(e.target.value) }));
$('#radiusInput').addEventListener('change', (e) => {
  const z = S.view.settings.zone;
  setZone({ ...z, radius: Number(e.target.value) });
});

document.addEventListener('click', (e) => {
  const chip = e.target.closest('[data-zone]');
  if (chip) {
    const which = chip.dataset.zone;
    if (which === 'me') {
      if (!S.gps.last) return toast('Gib zuerst deinen Standort frei (Schritt 1).', 'error');
      moveZoneTo({ lat: S.gps.last.lat, lng: S.gps.last.lng, radius: S.view.settings.zone.radius }, 'dein Standort');
    } else {
      moveZoneTo(ZONES[which], chip.textContent.trim());
    }
    $('#placeResults').innerHTML = '';
    return;
  }
  const place = e.target.closest('[data-place]');
  if (place) {
    pickPlace(Number(place.dataset.place));
    return;
  }
  const size = e.target.closest('[data-size]');
  if (size) {
    const z = S.view.settings.zone;
    setZone({ ...z, radius: Number(size.dataset.size) });
    S.maps.zone?.fitBounds(boundsOf({ ...z, radius: Number(size.dataset.size) }), { padding: [10, 10] });
    return;
  }
  const final = e.target.closest('[data-final]');
  if (final) {
    if (final.dataset.final === 'custom') S.tapTarget = 'final';
    saveSettings({ finalMode: final.dataset.final });
    return;
  }
  const tap = e.target.closest('[data-tap]');
  if (tap) {
    S.tapTarget = tap.dataset.tap;
    render();
    return;
  }
  const preset = e.target.closest('[data-preset]');
  if (preset) saveSettings({ ...PRESETS[preset.dataset.preset], shrink: true });
  const rule = e.target.closest('[data-catch]');
  if (rule) saveSettings({ catchRule: rule.dataset.catch });
  const evMode = e.target.closest('[data-events]');
  if (evMode) saveSettings({ eventsMode: evMode.dataset.events });
});

const GPS_HELP_BUTTONS =
  '<button class="btn small primary" data-action="gps">Nochmal versuchen</button><button class="btn small" data-action="gpsHelp">So geht’s</button>';

function renderGpsCard() {
  const st = S.gps.status;
  let icon = '📍';
  let title = 'Standort freigeben';
  let text = 'Damit das Spiel weiß, wo du bist. Ohne Standort kannst du nicht mitspielen.';
  let cls = 'bad';
  let btn = '<button class="btn primary" data-action="gps">📍 Standort freigeben</button>';
  if (st === 'ok') {
    icon = '✅';
    title = 'Standort freigegeben';
    text = S.sim ? 'Testmodus: Position per Klick.' : `Genauigkeit ca. ${Math.round(S.gps.last?.acc ?? 0)} m`;
    cls = 'ok';
    btn = '';
  } else if (st === 'waiting') {
    icon = '⏳';
    title = 'Suche Standort …';
    text = 'Tippe bei der Frage nach dem Standort auf „Erlauben“. Kommt keine Frage? Dann hilft „So geht’s“.';
    btn = GPS_HELP_BUTTONS;
  } else if (st === 'denied') {
    icon = '⛔';
    title = 'Standort blockiert';
    text = 'Dein Handy hat den Standort für diese Seite gesperrt. „So geht’s“ zeigt dir, wie du ihn freigibst.';
    btn = GPS_HELP_BUTTONS;
  } else if (st === 'unavailable') {
    icon = '📡';
    title = 'Kein GPS-Signal';
    text = 'Sind die Ortungsdienste an? Drinnen ist das Signal oft schwach – geh kurz ins Freie.';
    btn = GPS_HELP_BUTTONS;
  } else if (st === 'unsupported') {
    icon = '⛔';
    title = 'Kein GPS verfügbar';
    text = 'Dein Browser unterstützt keine Standortabfrage.';
    btn = '';
  }
  if (st !== 'ok' && S.view && bgActive(S.view)) {
    icon = '✅';
    title = 'Standort kommt über OwnTracks';
    text = 'Alles gut – du musst hier nichts mehr freigeben.';
    cls = 'ok';
    btn = '';
  }
  if (S.view?.allowSim && st !== 'ok') {
    btn += ' <button class="btn small" data-action="simLobby">🧪 Test-Position</button>';
  }
  const html = `<div class="gps-icon">${icon}</div><div class="gps-text"><b>${title}</b><span class="hint">${text}</span></div>${btn ? `<div class="gps-actions">${btn}</div>` : ''}`;
  for (const card of $$('[data-gps-card]')) {
    const withIcons = iconize(html);
    if (card.innerHTML !== withIcons) card.innerHTML = withIcons;
    card.className = `card gps-card ${cls}`;
  }
}

// ---------------------------------------------------------------- GPS & Wake Lock
// restart = true: laufende Abfrage verwerfen und neu anfragen (z. B. nach
// "Nochmal versuchen" oder wenn jemand aus den Einstellungen zurückkommt).
function startGps(restart = false) {
  if (!('geolocation' in navigator)) {
    S.gps.status = 'unsupported';
    return refreshGpsUi();
  }
  if (S.gps.watchId != null) {
    if (!restart) return;
    navigator.geolocation.clearWatch(S.gps.watchId);
    S.gps.watchId = null;
  }
  S.gps.status = S.gps.last && Date.now() - S.gps.last.t < 60_000 ? 'ok' : 'waiting';
  store.set('manhunt-gps', true);
  S.gps.watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, {
    enableHighAccuracy: true,
    maximumAge: 5000,
    timeout: 30000,
  });
  requestWakeLock();
  refreshGpsUi();
}

function onPosition(p) {
  S.gps.status = 'ok';
  if (S.sim) return refreshGpsUi();
  const c = p.coords;
  S.gps.last = { lat: c.latitude, lng: c.longitude, acc: c.accuracy, t: Date.now() };
  // Laufrichtung: vom GPS, wenn das Handy sie liefert und man sich bewegt …
  if (Number.isFinite(c.heading) && c.heading >= 0 && (c.speed ?? 1) > 0.5) setMoveHeading(c.heading);
  // … sonst aus den letzten Positionen berechnen
  else updateHeadingFromMove(S.gps.last);
  sendPos();
  refreshGpsUi();
}

// ---------------------------------------------------------------- Richtung (Pfeil)
// Der Kompass hat Vorrang (zeigt auch im Stehen), sonst gilt die Laufrichtung.
function bearing(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function setMoveHeading(deg) {
  S.moveHeading = deg;
  applyHeading();
}

function updateHeadingFromMove(pos) {
  const anchor = S.headingAnchor;
  if (!anchor) {
    S.headingAnchor = pos;
    return;
  }
  // erst ab 8 m Bewegung, sonst wackelt der Pfeil durch GPS-Ungenauigkeit
  if (distanceM(anchor, pos) < 8) return;
  S.headingAnchor = pos;
  setMoveHeading(bearing(anchor, pos));
}

const currentHeading = () => (S.compass && S.compassHeading != null ? S.compassHeading : S.moveHeading ?? null);

function applyHeading() {
  const el = S.markers.get(S.view?.me.id)?.marker.getElement()?.querySelector('.mk-arrow');
  const h = currentHeading();
  if (el && h != null) el.style.transform = `rotate(${Math.round(h)}deg)`;
  if (S.view && currentScreen() === 'game' && (h != null) !== Boolean(el)) renderMarkers(S.view);
}

function onOrientation(e) {
  let h = null;
  if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading; // iPhone
  else if (e.absolute && typeof e.alpha === 'number') h = (360 - e.alpha) % 360; // Android
  if (h == null) return;
  h = (h + (screen.orientation?.angle ?? 0)) % 360;
  S.compassHeading = h;
  const t = Date.now();
  if (t - (S.compassDrawn ?? 0) > 100) {
    S.compassDrawn = t;
    applyHeading();
  }
}

async function toggleCompass() {
  if (S.compass) {
    S.compass = false;
    S.compassHeading = null;
    window.removeEventListener('deviceorientation', onOrientation);
    window.removeEventListener('deviceorientationabsolute', onOrientation);
    $('#compassBtn')?.classList.remove('on');
    toast('Kompass aus – der Pfeil zeigt wieder die Laufrichtung.');
    return applyHeading();
  }
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      const r = await DeviceOrientationEvent.requestPermission();
      if (r !== 'granted') return toast('Ohne Erlaubnis geht der Kompass nicht – der Pfeil zeigt weiter die Laufrichtung.', 'error');
    }
  } catch {
    return toast('Kompass wird von diesem Handy nicht unterstützt.', 'error');
  }
  S.compass = true;
  window.addEventListener('deviceorientationabsolute', onOrientation);
  window.addEventListener('deviceorientation', onOrientation);
  $('#compassBtn')?.classList.add('on');
  toast('🧭 Kompass an – der Pfeil zeigt, wohin dein Handy zeigt.');
}

function onPositionError(err) {
  if (err.code === 1) {
    S.gps.status = 'denied';
    navigator.geolocation.clearWatch(S.gps.watchId);
    S.gps.watchId = null;
  } else if (err.code === 2) {
    // Ortungsdienste aus oder kein Signal – die Abfrage läuft weiter.
    if (!S.gps.last || Date.now() - S.gps.last.t > 60_000) S.gps.status = 'unavailable';
  }
  refreshGpsUi();
}

// Wird der Standort in den Einstellungen freigegeben, startet GPS von selbst –
// ohne Neuladen. (Chrome meldet das sofort, Safari spätestens beim Zurückkehren.)
async function initGpsPermission() {
  let status = null;
  try {
    status = await navigator.permissions?.query({ name: 'geolocation' });
  } catch {
    status = null;
  }
  if (status) {
    status.addEventListener('change', () => {
      if (status.state === 'granted') startGps(true);
      else if (status.state === 'denied') onPositionError({ code: 1 });
    });
    if (status.state === 'granted') return startGps();
    if (status.state === 'denied' && store.get('manhunt-gps')) {
      S.gps.status = 'denied';
      return refreshGpsUi();
    }
    // 'prompt': auf einen Tipp warten, damit die Frage sicher erscheint
    return;
  }
  if (store.get('manhunt-gps')) startGps();
}

function openGpsHelp() {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (ua.includes('Mac') && 'ontouchend' in document);
  const android = /Android/.test(ua);
  const steps = ios
    ? `<ol class="help">
        <li><b>Einstellungen</b> öffnen → <b>Datenschutz &amp; Sicherheit</b> → <b>Ortungsdienste</b>: oben <b>an</b>.</li>
        <li>In derselben Liste runter zu <b>Safari-Websites</b> (bzw. <b>Chrome</b>) → <b>Beim Verwenden der App</b> und <b>Genauer Standort</b> an.</li>
        <li>Zurück in Safari: links in der Adresszeile auf <b>aA</b> bzw. das Menü-Symbol → <b>Website-Einstellungen</b> → <b>Standort</b> → <b>Erlauben</b>.</li>
        <li>Hier auf <b>Nochmal versuchen</b> tippen.</li>
      </ol>`
    : android
      ? `<ol class="help">
          <li>Wisch von oben runter und schalte <b>Standort</b> ein.</li>
          <li>In Chrome links neben der Adresse auf das <b>Symbol</b> (Schloss/Regler) tippen → <b>Berechtigungen</b> → <b>Standort</b> → <b>Zulassen</b>.</li>
          <li>Hier auf <b>Nochmal versuchen</b> tippen. Neu laden ist nicht nötig.</li>
        </ol>`
      : `<ol class="help">
          <li>Klicke links neben der Adresse auf das <b>Schloss-Symbol</b> → <b>Standort</b> → <b>Erlauben</b>.</li>
          <li>Prüfe in den Systemeinstellungen, ob die Ortungsdienste für deinen Browser an sind.</li>
          <li>Dann auf <b>Nochmal versuchen</b> klicken.</li>
        </ol>`;
  openModal(
    `<h2>📍 Standort freigeben</h2>${steps}
     <p class="hint">Ohne Standort kannst du nicht mitspielen – die Jäger sehen dich nur beim Ping.</p>
     <div class="row"><button class="btn" data-action="closeModal">Schließen</button><button class="btn primary" id="gpsRetry">Nochmal versuchen</button></div>`,
    (m) =>
      $('#gpsRetry', m).addEventListener('click', () => {
        closeModal();
        startGps(true);
      }),
  );
}

function sendPos(force = false) {
  const t = Date.now();
  if (!S.gps.last || !S.view) return;
  if (!force && t - S.gps.lastSent < 3000) return;
  S.gps.lastSent = t;
  // age: wie alt die Messung ist – eine nur erneut gesendete Position gilt so nicht als frisch
  socket.emit('pos', { lat: S.gps.last.lat, lng: S.gps.last.lng, acc: S.gps.last.acc, age: t - S.gps.last.t });
}

// Herzschlag: auch wer still steht, meldet sich regelmäßig. Läuft nur, solange
// die Seite offen ist – genau so soll es sein.
setInterval(() => {
  const t = Date.now();
  if (S.sim && S.gps.last) S.gps.last.t = t; // Testmodus: Klick-Position gilt als aktuell
  if (S.gps.last && t - S.gps.last.t < 5 * 60_000 && t - S.gps.lastSent > 15_000) sendPos(true);
  // Wächter: Handys (vor allem iPhones nach Sperren oder App-Wechsel) liefern manchmal
  // still keine Positionen mehr. Dann die Ortung neu starten – wie ein Neuladen.
  if (
    !S.sim &&
    document.visibilityState === 'visible' &&
    S.gps.watchId != null &&
    S.gps.last &&
    t - S.gps.last.t > GPS_STALE_MS &&
    t - (S.gps.restartedAt ?? 0) > GPS_STALE_MS
  ) {
    S.gps.restartedAt = t;
    S.gps.restarts = (S.gps.restarts ?? 0) + 1;
    startGps(true);
  }
  refreshGpsUi();
}, 5000);

const GPS_STALE_MS = 20_000;
const gpsStale = () => !S.sim && S.gps.status === 'ok' && S.gps.last && Date.now() - S.gps.last.t > 30_000;

function refreshGpsUi() {
  if (currentScreen() === 'lobby') renderGpsCard();
  const dot = $('#gpsDot');
  dot.className = `gps-dot ${gpsStale() ? 'stale' : S.gps.status === 'ok' ? 'ok' : 'bad'}`;
}

async function requestWakeLock() {
  if (S.wakeLock || !('wakeLock' in navigator) || document.visibilityState !== 'visible') {
    if (!('wakeLock' in navigator)) S.wakeLockFailed = true;
    return;
  }
  try {
    S.wakeLock = await navigator.wakeLock.request('screen');
    S.wakeLockFailed = false;
    S.wakeLock.addEventListener('release', () => (S.wakeLock = null));
  } catch {
    S.wakeLockFailed = true;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (S.view && S.view.phase !== 'lobby') requestWakeLock();
  // Zurück aus den Einstellungen? Dann gleich nochmal versuchen.
  // Und nach dem Entsperren / App-Wechsel die Ortung frisch starten, falls sie hängt.
  if (['denied', 'unavailable', 'waiting'].includes(S.gps.status) || (S.gps.last && Date.now() - S.gps.last.t > 10_000)) startGps(true);
  sendPos(true);
  if (!socket.connected) socket.connect();
});

// ---------------------------------------------------------------- Spiel
function renderGame() {
  const v = S.view;
  const me = v.me;
  $('#rolePill').className = `pill ${me.spectator ? 'caught' : me.role}`;
  $('#rolePill').textContent = me.spectator ? 'Gefangen' : me.role === 'hunter' ? '🎯 Jäger' : '🏃 Hider';
  $('#phaseLabel').textContent =
    (v.phase === 'headstart' ? 'Vorsprung läuft' : 'Jagd läuft') + (v.groupName ? ` · Gruppe ${groupLabel(v.groupName)}` : '');
  const hiders = v.players.filter((p) => p.startRole === 'hider' || p.role === 'hider');
  $('#hidersValue').textContent = `${hiders.filter((p) => p.role === 'hider' && p.status === 'alive').length}/${hiders.length}`;
  $('#simToggle').classList.toggle('show', Boolean(v.allowSim));

  renderGameMap(v);
  renderDock(v);
  renderGamePlayers(v);
  tickGame();
  refreshGpsUi();
}

function renderGameMap(v) {
  if (!S.maps.game) {
    const map = makeMap('gameMap');
    S.maps.game = map;
    S.gameZoneOuter = L.circle([0, 0], { radius: 1, color: '#ff3b4e', weight: 1, opacity: 0.3, fill: false }).addTo(map);
    S.gameZone = L.circle([0, 0], { radius: 1, color: '#ff3b4e', weight: 2, dashArray: '6 6', fillOpacity: 0.05 }).addTo(map);
    S.nextZone = L.circle([0, 0], { radius: 1, color: '#ffb020', weight: 3, dashArray: '2 8', fill: false });
    // Bei weit herausgezoomter Karte überlappen die Namen – dann ausblenden.
    map.on('zoomend', () => map.getContainer().classList.toggle('hide-labels', map.getZoom() < 14));
    map.on('click', (e) => {
      // Tipp auf die leere Karte blendet eine angezeigte Ping-Spur wieder aus
      if (S.trailFor) {
        S.trailFor = null;
        renderMarkers(S.view);
      }
      if (!S.sim) return;
      setSimPosition(e.latlng.lat, e.latlng.lng);
    });
  }
  const z = v.settings.zone;
  S.gameZoneOuter.setLatLng([z.lat, z.lng]).setRadius(z.radius);
  S.gameZone.setLatLng([v.zone.lat, v.zone.lng]).setRadius(v.zone.radius);
  if (v.nextZone) S.nextZone.setLatLng([v.nextZone.lat, v.nextZone.lng]).setRadius(v.nextZone.radius).addTo(S.maps.game);
  else S.nextZone.remove();
  if (S.fittedRound !== v.round) {
    S.fittedRound = v.round;
    setTimeout(() => {
      S.maps.game.invalidateSize();
      S.maps.game.fitBounds(boundsOf(z), { padding: [20, 20] });
    }, 80);
  }
  renderMarkers(v);
}

function markerFor(p) {
  const v = S.view;
  let cls = p.role;
  let label = p.name;
  if (p.kind === 'self') {
    cls = `${v.me.spectator ? 'caught' : p.role} self`;
    label = 'Du';
    if (currentHeading() != null) cls += ' has-arrow';
  } else if (p.kind === 'ping') {
    cls = p.fog ? 'ping fog' : 'ping';
    label = `${p.name} · ${p.fog ? '🌫️ ungefähr · ' : ''}${ago(p.pos.t)}`;
  } else if (p.kind === 'exposed') {
    cls = 'exposed';
    label = `${p.name} · LIVE`;
  } else if (p.kind === 'drone') {
    cls = 'drone';
    label = `${p.name} · 🚁 LIVE`;
  } else if (p.kind === 'bounty') {
    cls = 'drone';
    label = `${p.name} · 💰 LIVE`;
  } else if (p.kind === 'shield') {
    cls = 'drone';
    label = `${p.name} · 🛡️ LIVE (Schild)`;
  } else if (p.kind === 'spot') {
    cls = 'drone';
    label = `${p.name} · 🔦 LIVE`;
  } else if (p.kind === 'lost') {
    cls = 'lost';
    label = `${p.name} · 📵 ${ago(p.pos.t)}`;
  } else if (p.kind === 'radar') {
    cls = 'hunter radar';
  } else if (p.kind === 'finale') {
    cls = 'drone';
    label = `${p.name} · 🔥 LIVE`;
  } else if (p.kind === 'crush') {
    cls = `${p.role} crush`;
    label = `💘 ${p.name}`;
  }
  return { cls, label, key: `${cls}|${label}` };
}

function applyHeadingOnly() {
  const el = S.markers.get(S.view?.me.id)?.marker.getElement()?.querySelector('.mk-arrow');
  const h = currentHeading();
  if (el && h != null) el.style.transform = `rotate(${Math.round(h)}deg)`;
}

// Ping-Spur eines Hiders zeigen oder wieder ausblenden (Tipp auf seinen Punkt)
function toggleTrail(id) {
  const v = S.view;
  const p = v?.players.find((x) => x.id === id);
  if (S.trailFor === id) S.trailFor = null;
  else if (p?.pingTrail?.length) S.trailFor = id;
  else if (p && v.settings.pingTrail > 0 && p.role === 'hider' && (v.me.role === 'hunter' || v.me.spectator)) {
    toast(`Von ${p.name} gibt es noch keine frühere Ping-Position.`);
    return;
  } else return;
  renderMarkers(v);
}

function renderMarkers(v) {
  const map = S.maps.game;
  // Nebel: statt eines Punkts ein Kreis, in dem der Hider irgendwo ist
  // Ping-Spur: frühere Ping-Punkte als verblassende Linie bis zum aktuellen Punkt.
  // Nur für den Hider, den der Jäger angetippt hat (S.trailFor) – bei vielen Spielern wäre die Karte sonst zu voll.
  S.trailLayer ??= L.layerGroup().addTo(map);
  S.trailLayer.clearLayers();
  for (const p of v.players) {
    if (p.id !== S.trailFor || !p.pingTrail?.length) continue;
    const pts = [...p.pingTrail, ...(p.pos ? [[p.pos.lat, p.pos.lng]] : [])];
    L.polyline(pts, { color: '#ffb020', weight: 2, opacity: 0.55, dashArray: '2 6', interactive: false }).addTo(S.trailLayer);
    p.pingTrail.forEach(([lat, lng], i) => {
      const fade = 0.25 + (0.5 * (i + 1)) / p.pingTrail.length;
      L.circleMarker([lat, lng], { radius: 5, color: '#ffb020', weight: 1, opacity: fade, fillColor: '#ffb020', fillOpacity: fade * 0.6, interactive: false }).addTo(S.trailLayer);
    });
  }
  S.fogLayer ??= L.layerGroup().addTo(map);
  S.fogLayer.clearLayers();
  for (const p of v.players) {
    if (p.fog && p.pos) {
      L.circle([p.pos.lat, p.pos.lng], { radius: p.fog, color: '#ffb020', weight: 2, dashArray: '4 6', fillOpacity: 0.12 }).addTo(S.fogLayer);
    }
  }
  const seen = new Set();
  for (const p of v.players) {
    if (!p.pos) continue;
    if (p.kind !== 'self' && p.status === 'caught' && p.role === 'hider') continue;
    seen.add(p.id);
    const m = markerFor(p);
    let entry = S.markers.get(p.id);
    const icon = () =>
      L.divIcon({
        className: '',
        html: m.cls.includes('has-arrow')
          ? `<div class="mk-self"><div class="mk-arrow"><svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 3 L33 35 L20 27 L7 35 Z"/></svg></div><span class="mk-label">${esc(m.label)}</span></div>`
          : `<div class="mk ${m.cls}">${esc(initials(p.name))}<span class="mk-label">${esc(m.label)}</span></div>`,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      });
    if (!entry) {
      entry = { marker: L.marker([p.pos.lat, p.pos.lng], { icon: icon(), zIndexOffset: p.kind === 'self' ? 1000 : 0 }).addTo(map), key: m.key };
      entry.marker.on('click', () => toggleTrail(p.id));
      S.markers.set(p.id, entry);
    } else {
      entry.marker.setLatLng([p.pos.lat, p.pos.lng]);
      if (entry.key !== m.key) {
        entry.marker.setIcon(icon());
        entry.key = m.key;
      }
    }
  }
  applyHeadingOnly();
  for (const [id, entry] of S.markers) {
    if (!seen.has(id)) {
      entry.marker.remove();
      S.markers.delete(id);
    }
  }
}

// Unteres Feld: eingeklappt nur die Hauptaktion (Fang-Knopf bzw. Fang-Code) und ein Joker-Knopf,
// hochgezogen zusätzlich alle Joker. So bleibt mehr Platz für die Karte.
const CHEVRON = '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6"></path></svg>';

function dockToggle(count, active) {
  return `<button class="dock-more ${active ? 'has-active' : ''}" data-action="toggleDock" aria-expanded="${S.dockOpen ? 'true' : 'false'}">
      <span>Joker</span>${count ? `<b>${count}</b>` : ''}${CHEVRON}
    </button>`;
}

function renderDock(v) {
  const me = v.me;
  const info = v.jokerInfo;
  let main = '';
  let extra = '';
  let count = 0;
  let active = false;
  if (me.spectator) {
    const p = v.players.find((x) => x.id === me.id);
    main = `<div class="note">😵 Gefangen${p?.caughtBy ? ` von <b>${esc(p.caughtBy)}</b>` : ''}. Du schaust jetzt zu und siehst, was die Jäger sehen.</div>`;
  } else if (me.role === 'hider') {
    const counts = {};
    me.jokers.forEach((j) => (counts[j] = (counts[j] ?? 0) + 1));
    const act = [];
    if (me.cloakNext) act.push('cloak');
    if (me.decoyNext) act.push('decoy');
    if (me.radarUntil > now()) act.push('radar');
    if (me.shieldUntil > now()) act.push('shield');
    const types = [...new Set([...Object.keys(counts), ...act])];
    count = me.jokers.length;
    active = act.length > 0;
    extra = types.length
      ? `<div class="dock-label">Deine Joker – antippen zum Einsetzen</div><div class="jokers">${types
          .map(
            (t) => `<button class="joker ${info[t].trophy ? 'trophy' : ''} ${act.includes(t) ? 'active' : ''}" data-action="joker" data-type="${t}" ${counts[t] ? '' : 'disabled'}>
              <span class="j-icon">${info[t].icon}</span>${info[t].name}${act.includes(t) ? ' ✓' : counts[t] > 1 ? ` <span class="j-count">×${counts[t]}</span>` : ''}
            </button>`,
          )
          .join('')}</div>`
      : '';
    main = `<button class="code-reveal ${S.codeVisible ? 'open' : ''}" data-action="toggleCode">
        <span class="cr-text"><small>${S.codeVisible ? 'Zeig ihn dem Jäger' : '🔒 Fang-Code'}</small>
        <small class="cr-hint">${S.codeVisible ? 'Antippen zum Verstecken' : 'Nur wenn gefangen'}</small></span>
        <b>${S.codeVisible ? esc(me.catchCode) : '••••'}</b>
      </button>`;
  } else {
    const pool = v.hunterPool ?? {};
    const canUse = v.phase === 'hunt';
    count = ['extraPing', 'drone', 'sniff'].reduce((n, t) => n + (pool[t] ?? 0), 0) + (me.jokers?.length ?? 0);
    main = `<button class="catch-btn" data-action="catch" ${canUse ? '' : 'disabled'}>${canUse ? '🎯 Gefangen!' : '⏳ Warte auf die Jagd'}</button>`;
    extra = `<div class="dock-label">Team-Joker – für alle Jäger zusammen</div>
      <div class="jokers">${['extraPing', 'drone', 'sniff']
        .map(
          (t) => `<button class="joker" data-action="joker" data-type="${t}" ${canUse && pool[t] > 0 ? '' : 'disabled'}>
            <span class="j-icon">${info[t].icon}</span>${info[t].name} <span class="j-count">${pool[t] ?? 0}</span>
          </button>`,
        )
        .join('')}</div>${
        me.jokers?.length
          ? `<div class="dock-label">🏆 Dein Pokal-Joker</div><div class="jokers">${[...new Set(me.jokers)]
              .map(
                (t) => `<button class="joker trophy" data-action="joker" data-type="${t}" ${canUse ? '' : 'disabled'}>
            <span class="j-icon">${info[t].icon}</span>${info[t].name}
          </button>`,
              )
              .join('')}</div>`
          : ''
      }`;
  }
  const hasExtra = Boolean(extra);
  if (!hasExtra) S.dockOpen = false;
  let html = `${hasExtra ? '<div class="dock-grab" data-action="toggleDock" aria-hidden="true"></div>' : ''}
    <div class="dock-row">${main}${hasExtra ? dockToggle(count, active) : ''}</div>
    ${hasExtra ? `<div class="dock-extra"><div>${extra}</div></div>` : ''}`;
  const dock = $('#dock');
  html = iconize(html);
  dock.classList.toggle('open', Boolean(S.dockOpen));
  dock.classList.toggle('has-extra', hasExtra);
  // Mit dem zuletzt gesetzten Text vergleichen (der Browser schreibt HTML leicht anders zurück)
  if (dock.dataset.html !== html) {
    dock.dataset.html = html;
    dock.innerHTML = html;
  }
}

function setDockOpen(open) {
  S.dockOpen = open;
  if (S.view && currentScreen() === 'game') renderDock(S.view);
}

// Hochziehen / Runterwischen am unteren Feld
{
  let startY = null;
  const dock = document.getElementById('dock');
  dock.addEventListener('touchstart', (e) => (startY = e.touches[0].clientY), { passive: true });
  dock.addEventListener('touchend', (e) => {
    if (startY == null) return;
    const dy = e.changedTouches[0].clientY - startY;
    startY = null;
    if (!dock.classList.contains('has-extra')) return;
    if (dy < -30 && !S.dockOpen) setDockOpen(true);
    else if (dy > 30 && S.dockOpen) setDockOpen(false);
  });
  // Die Kartenknöpfe rechts sitzen immer knapp über dem Feld
  const game = document.getElementById('game');
  const tabbar = game.querySelector('.tabbar');
  const ro = new ResizeObserver(() => {
    game.style.setProperty('--dock-h', `${dock.offsetHeight}px`);
    game.style.setProperty('--tab-h', `${tabbar.offsetHeight}px`);
  });
  ro.observe(dock);
  ro.observe(tabbar);
}

function hiderStatusFor(p, v) {
  if (p.status === 'caught') return `gefangen${p.caughtBy ? ` von ${esc(p.caughtBy)}` : ''}`;
  if (p.kind === 'cloaked') return '👻 beim letzten Ping getarnt';
  if (p.kind === 'protected') return '🛡️ geschützt (Rollentausch)';
  if (p.kind === 'bounty') return '💰 LIVE (Kopfgeld)';
  if (p.kind === 'crush') return '💘 dein Crush (live)';
  if (p.kind === 'finale') return '🔥 LIVE (Finale)';
  if (p.kind === 'shield') return '🛡️ LIVE (Schutzschild – nicht fangbar)';
  if (p.kind === 'spot') return '🔦 LIVE (Scheinwerfer)';
  if (p.kind === 'ping' && p.fog) return `🌫️ Ping ungefähr, ${ago(p.pos.t)}`;
  if (p.kind === 'ping') return `📍 Ping ${ago(p.pos.t)}`;
  if (p.kind === 'exposed') return '🔴 LIVE (außerhalb der Zone)';
  if (p.kind === 'drone') return '🚁 LIVE (Drohne)';
  if (p.kind === 'lost') return '📵 kein GPS';
  if (v.me.role === 'hunter' || v.me.spectator) return v.lastPingAt ? 'kein Standort' : 'noch kein Ping';
  return 'im Spiel';
}

function renderGamePlayers(v) {
  const order = (p) => (p.role === 'hider' && p.status === 'alive' ? 0 : p.startRole === 'hider' ? 1 : 2);
  const list = [...v.players].sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
  let html = list
    .map((p) => {
      const cls = p.status === 'caught' && p.role === 'hider' ? 'caught' : p.role;
      const sub =
        p.role === 'hunter' ? `${p.startRole === 'hider' ? 'Jäger (war Hider)' : 'Jäger'}${p.kind === 'crush' ? ' · 💘 dein Crush' : ''}` : hiderStatusFor(p, v);
      const conn = p.connected ? '' : ' · offline';
      const kick = v.me.isHost && p.id !== v.me.id ? `<div class="p-actions"><button data-action="kick" data-id="${p.id}">✕</button></div>` : '';
      return `<li><div class="avatar ${cls}">${esc(initials(p.name))}</div>
        <div class="p-name"><b>${esc(p.name)}${p.id === v.me.id ? ' (du)' : ''}</b><small>${sub}${conn}</small></div>${kick}</li>`;
    })
    .join('');
  const ul = $('#gamePlayers');
  html = iconize(html);
  if (ul.innerHTML !== html) ul.innerHTML = html;
}

// Hinweise für die Leiste oben: [Wichtigkeit, Art, Text]. Kleinere Zahl = wichtiger.
// Gezeigt wird nur der wichtigste; die anderen klappen über "+N" auf.
//  10er: Gefahr für mich (live geortet, außerhalb der Zone, Drohne, Kopfgeld, Schild)
//  20: Standort blockiert/aus · 30: Streitfall · 40: Finale · 50: Ping-Vorwarnung
//  55: außerhalb der neuen Zone · 60er: Schutz und Joker · 70er: Ereignisse, Zone wird kleiner
//  80: GPS wird gesucht/hängt · 90: Hintergrund-Ortung aktiv
function banners(v) {
  const me = v.me;
  const t = now();
  const out = [];
  const bg = bgActive(v);
  if (bg) out.push([90, 'good', '📱 Hintergrund-Ortung aktiv – du kannst das Handy sperren.']);
  else if (S.gps.status === 'denied') out.push([20, 'warn', '⛔ Standort blockiert. <button class="btn small" data-action="gpsHelp">So geht’s</button>']);
  else if (S.gps.status === 'off') out.push([20, 'warn', '📍 Kein Standort. <button class="btn small" data-action="gps">Aktivieren</button>']);
  else if (S.gps.status !== 'ok') out.push([80, 'warn', '📡 Suche GPS … <button class="btn small" data-action="gpsHelp">Hilfe</button>']);
  else if (gpsStale()) out.push([80, 'warn', '📡 GPS hängt – wird neu gestartet … <button class="btn small" data-action="gps">Jetzt neu starten</button>']);
  if (me.role === 'hider' && me.status === 'alive') {
    if (me.exposed) out.push([10, 'warn', '🔴 Du wirst LIVE geortet – zurück in die Zone!']);
    else if (me.outSince) {
      const left = v.settings.outGraceSec * 1000 - (t - me.outSince);
      out.push([11, 'warn', v.phase === 'hunt' ? `⚠️ Außerhalb der Zone! Live-Ortung in ${fmt(left)}` : '⚠️ Du bist außerhalb der Zone!']);
    }
    if (me.droneTracked > t) out.push([12, 'warn', `🚁 Eine Drohne verfolgt dich: ${fmt(me.droneTracked - t)}`]);
    if (me.shieldUntil > t) out.push([14, 'warn', `🛡️ Schutzschild: noch ${fmt(me.shieldUntil - t)} nicht fangbar – aber alle Jäger sehen dich live!`]);
    if (me.radarUntil > t) out.push([61, 'good', `📡 Radar aktiv: ${fmt(me.radarUntil - t)}`]);
    if (me.cloakNext) out.push([62, 'info', '👻 Tarnkappe aktiv – du fehlst im nächsten Ping.']);
    if (me.decoyNext) out.push([63, 'info', '🎭 Doppelgänger aktiv – der nächste Ping zeigt einen falschen Ort.']);
    if (pingSoon(v, t)) out.push([50, 'ping', `📍 Ping in ${fmt(v.timers.nextPingAt - t)} – geh in Deckung!`]);
    if (finaleOn(v, t)) out.push([40, 'warn', `🔥 Finale: Du bist bis zum Schluss live sichtbar! Noch ${fmt(v.timers.endAt - t)}`]);
  }
  if (v.nextZone && v.nextZone.at > t) {
    const self = v.players.find((p) => p.id === me.id);
    const outsideNext = me.role === 'hider' && me.status === 'alive' && self?.pos && distanceM(self.pos, v.nextZone) > v.nextZone.radius;
    out.push(
      outsideNext
        ? [55, 'warn', `🟡 Du bist außerhalb der neuen Zone – sie gilt in ${fmt(v.nextZone.at - t)}!`]
        : [74, 'info', `🟡 Zone wird kleiner in ${fmt(v.nextZone.at - t)} (gelber Kreis)`],
    );
  }
  for (const d of v.disputes ?? []) {
    if (d.until <= t) continue;
    if (v.me.isHost) {
      out.push([30, 'warn', `⚖️ Streitfall ${esc(d.hunter)} ↔ ${esc(d.hider)} (${fmt(d.until - t)}) <button class="btn small" data-action="disputeDecide" data-id="${d.id}">Entscheiden</button>`]);
    } else if (d.mine) {
      out.push([30, 'warn', `⚖️ Streitfall läuft – bleibt kurz stehen, der Spielleiter entscheidet (${fmt(d.until - t)})`]);
    }
  }
  const ev = v.events ?? {};
  if (finaleOn(v, t) && (me.role === 'hunter' || me.spectator)) out.push([40, 'good', `🔥 Finale: Alle Hider sind live sichtbar! Noch ${fmt(v.timers.endAt - t)}`]);
  if (me.protectedUntil > t) out.push([60, 'good', `🛡️ Du bist noch ${fmt(me.protectedUntil - t)} geschützt – lauf los!`]);
  if (ev.feverUntil > t) out.push([70, 'info', `🔥 Jagdfieber: Pings doppelt so oft (${fmt(ev.feverUntil - t)})`]);
  if (ev.fogNext) out.push([71, 'info', v.me.role === 'hunter' || v.me.spectator ? '🌫️ Nebel: Beim nächsten Ping seht ihr nur grobe Kreise.' : '🌫️ Nebel: Der nächste Ping ist ungenau.']);
  if (ev.bounty && ev.bounty.until > t) {
    out.push(
      ev.bounty.me
        ? [13, 'warn', `💰 Kopfgeld auf dich! Du bist live sichtbar – halte ${fmt(ev.bounty.until - t)} durch.`]
        : [72, 'info', `💰 Kopfgeld auf ${esc(ev.bounty.name)}: live sichtbar (${fmt(ev.bounty.until - t)})`],
    );
  }
  if (v.drone && v.drone.until > t) out.push([73, 'info', `🚁 Drohne verfolgt ${esc(v.drone.name)}: ${fmt(v.drone.until - t)}`]);
  return out.sort((x, y) => x[0] - y[0]).map(([, cls, text]) => [cls, text]);
}

// Leiste oben: nur der wichtigste Hinweis, die übrigen hinter "+N"
function bannerHtml(list) {
  if (!list.length) {
    S.bannersOpen = false;
    return '';
  }
  const more = list.length - 1;
  const toggle = more
    ? `<button class="banner-more" data-action="moreBanners" aria-label="${S.bannersOpen ? 'Weitere Hinweise ausblenden' : `${more} weitere Hinweise zeigen`}">${S.bannersOpen ? '–' : `+${more}`}</button>`
    : '';
  const shown = S.bannersOpen ? list : list.slice(0, 1);
  return shown.map(([cls, text], i) => `<div class="banner ${cls}"><span class="banner-text">${text}</span>${i === 0 ? toggle : ''}</div>`).join('');
}

// Finale läuft: die letzten finaleSec Sekunden der Jagd
const finaleOn = (v, t) => v.phase === 'hunt' && v.settings.finaleSec > 0 && v.timers.endAt - t <= v.settings.finaleSec * 1000;

// Freie Hider: der nächste Ping kommt in höchstens 30 Sekunden (ohne Tarnkappe und ohne Schutz).
function pingSoon(v, t) {
  const me = v.me;
  if (v.phase !== 'hunt' || me.role !== 'hider' || me.status !== 'alive') return false;
  if (me.cloakNext || me.protectedUntil > t) return false;
  const left = v.timers.nextPingAt - t;
  return left > 0 && left <= 30_000;
}

function tickGame() {
  const v = S.view;
  if (!v || currentScreen() !== 'game') return;
  const t = now();
  const tm = v.timers;
  const timerValue = $('#timerValue');
  const pingValue = $('#pingValue');
  if (v.phase === 'headstart') {
    $('#timerLabel').textContent = 'Vorsprung';
    timerValue.textContent = fmt(tm.huntStartAt - t);
    pingValue.textContent = fmt(tm.nextPingAt - t);
  } else {
    $('#timerLabel').textContent = 'Restzeit';
    timerValue.textContent = fmt(tm.endAt - t);
    pingValue.textContent = fmt(tm.nextPingAt - t);
  }
  pingValue.classList.toggle('urgent', v.phase === 'hunt' && tm.nextPingAt - t < 30_000);
  timerValue.classList.toggle('urgent', v.phase === 'hunt' && tm.endAt - t < 60_000);

  // Vorwarnung vor dem Ping: einmal kurz vibrieren, ohne Ton (ein Ton würde Hider verraten).
  // iPhones erlauben Websites kein Vibrieren, dort bleibt es beim Banner.
  if (pingSoon(v, t) && S.pingWarnedFor !== tm.nextPingAt) {
    S.pingWarnedFor = tm.nextPingAt;
    navigator.vibrate?.([120, 80, 120]);
  }

  const overlay = $('#headstartOverlay');
  const showOverlay = v.phase === 'headstart' && v.me.role === 'hunter';
  overlay.classList.toggle('show', showOverlay);
  if (showOverlay) {
    overlay.innerHTML = `<div><h2>Die Hider laufen los</h2><div class="big-count">${fmt(tm.huntStartAt - t)}</div><p class="hint">Bleibt am Startpunkt, bis die Jagd beginnt.</p></div>`;
  }

  const html = iconize(bannerHtml(banners(v)));
  const box = $('#banners');
  if (box.innerHTML !== html) box.innerHTML = html;

}

setInterval(tickGame, 500);
// Alters-Labels der Ping-Marker ("vor 3 min") aktuell halten
setInterval(() => {
  if (S.view && currentScreen() === 'game') {
    renderMarkers(S.view);
    renderGamePlayers(S.view);
  }
}, 10_000);

function setSimPosition(lat, lng) {
  S.gps.last = { lat, lng, acc: 5, t: Date.now() };
  updateHeadingFromMove(S.gps.last);
  S.gps.status = 'ok';
  sendPos(true);
  refreshGpsUi();
}

function randomPointInZone() {
  const z = S.view.settings.zone;
  const r = z.radius * 0.7 * Math.sqrt(Math.random());
  const a = Math.random() * 2 * Math.PI;
  return {
    lat: z.lat + (r * Math.cos(a)) / 111320,
    lng: z.lng + (r * Math.sin(a)) / (111320 * Math.cos((z.lat * Math.PI) / 180)),
  };
}

$('#simCheck').addEventListener('change', (e) => {
  S.sim = e.target.checked;
  if (S.sim) toast('🧪 Testmodus: Tippe auf die Karte, um deine Position zu setzen.');
  if (S.sim && !S.gps.last) {
    const p = randomPointInZone();
    setSimPosition(p.lat, p.lng);
  }
  tickGame();
});

// Tabs
document.addEventListener('click', (e) => {
  const tab = e.target.closest('[data-tab]');
  if (!tab) return;
  S.tab = tab.dataset.tab;
  $$('.tabbar button').forEach((b) => b.classList.toggle('active', b === tab));
  $('#panelPlayers').classList.toggle('show', S.tab === 'players');
  $('#panelChat').classList.toggle('show', S.tab === 'chat');
  document.body.classList.toggle('panel-open', S.tab !== 'map');
  if (S.tab === 'chat') {
    S.chat.unread = 0;
    updateBadge();
    const log = $('#panelChat .chat-log');
    if (log) log.scrollTop = log.scrollHeight;
  }
  if (S.tab === 'map') setTimeout(() => S.maps.game?.invalidateSize(), 50);
});

// ---------------------------------------------------------------- Ende
async function loadTrails() {
  S.trails = null;
  const r = await send('trails');
  if (r.ok) {
    S.trails = r;
    if (currentScreen() === 'end') renderEnd();
  }
}

// "📤 Ergebnis teilen": Teilen-Menü des Handys (WhatsApp usw.), sonst in die Zwischenablage.
async function shareResult() {
  const dist = new Map((S.trails?.players ?? []).map((p) => [p.id, trailDistance(p.trail)]));
  const text = buildResultText(S.view, dist);
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return;
    } catch (e) {
      if (e?.name === 'AbortError') return; // Menü geschlossen
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('Ergebnis kopiert – jetzt in den Chat einfügen.');
  } catch {
    // Ohne Zwischenablage: Text zum Markieren anzeigen
    openModal(
      `<h2>Ergebnis</h2><textarea class="share-text" readonly rows="12">${esc(text)}</textarea>
       <div class="row"><button class="btn" data-action="closeModal">Schließen</button></div>`,
      (m) => $('textarea', m).select(),
    );
  }
}

function renderEnd() {
  const v = S.view;
  const res = v.result ?? {};
  const title = $('#endTitle');
  title.className = res.winner ?? '';
  title.textContent = res.winner === 'hunters' ? 'Jäger gewinnen' : res.winner === 'hiders' ? 'Hider gewinnen' : 'Runde beendet';
  $('#endHero').className = `end-hero ${res.winner ?? 'none'}`;
  $('#endIcon').innerHTML = res.winner === 'hunters' ? END_ICON.hunters : res.winner === 'hiders' ? END_ICON.hiders : END_ICON.none;
  $('#endReason').textContent = res.reason ?? '';

  const start = v.timers?.huntStartAt ?? 0;
  const hiders = v.players.filter((p) => p.startRole === 'hider');
  const hunters = v.players.filter((p) => p.startRole === 'hunter');
  const catches = {};
  hiders.forEach((p) => p.caughtBy && (catches[p.caughtBy] = (catches[p.caughtBy] ?? 0) + 1));
  const rows = [
    ...hiders
      .sort((a, b) => (b.caughtAt ?? Infinity) - (a.caughtAt ?? Infinity))
      .map((p) =>
        p.caughtAt
          ? `<li><span>🏃 ${esc(p.name)}</span><span class="muted">gefangen von ${esc(p.caughtBy)} nach ${fmt(p.caughtAt - start)}</span></li>`
          : `<li><span>🏃 ${esc(p.name)}</span><span style="color:var(--hider)">✅ überlebt</span></li>`,
      ),
    ...hunters
      .sort((a, b) => (catches[b.name] ?? 0) - (catches[a.name] ?? 0))
      .map((p) => `<li><span>🎯 ${esc(p.name)}</span><span class="muted">${catches[p.name] ?? 0} gefangen</span></li>`),
  ];
  // Gelaufene Strecke (aus den Routen) als Statistik
  const dist = new Map((S.trails?.players ?? []).map((p) => [p.id, trailDistance(p.trail)]));
  const top = [...dist.entries()].sort((a, b) => b[1] - a[1])[0];
  const topPlayer = top && top[1] > 0 ? v.players.find((p) => p.id === top[0]) : null;
  const km = (p) => (dist.has(p.id) ? ` · ${formatDistance(dist.get(p.id))}` : '');
  const rowsWithDistance = rows.map((html, i) => {
    const p = [...hiders, ...hunters][i];
    return html.replace(/<\/span><\/li>$/, `${km(p)}</span></li>`);
  });
  const trophies = res.trophies ?? [];
  $('#endStats').innerHTML =
    (trophies.length
      ? `<li class="stat-top"><span>🏆 Pokal für die nächste Runde</span><span>${trophies
          .map((t) => `<b>${esc(t.name)}</b> (${t.why === 'hider' ? 'letzte(r) Überlebende(r)' : 'meiste Fänge'})`)
          .join(', ')}</span></li>`
      : '') +
    (topPlayer ? `<li class="stat-top"><span>🥇 Am meisten gelaufen</span><span><b>${esc(topPlayer.name)}</b> · ${formatDistance(top[1])}</span></li>` : '') +
    rowsWithDistance.join('');
  renderWinner(v, catches, dist);
  if (S.trails) drawEndMap(dist);
}

const END_ICON = {
  hunters: `<svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="40"/><path d="M60 4v30M60 86v30M4 60h30M86 60h30"/><circle class="fill" cx="60" cy="60" r="9"/></svg>`,
  hiders: `<svg viewBox="0 0 120 120" aria-hidden="true"><path d="M60 12 L98 28 V58 C98 82 82 100 60 108 C38 100 22 82 22 58 V28 Z"/><path d="M42 60 l12 12 l24 -26"/></svg>`,
  none: `<svg viewBox="0 0 120 120" aria-hidden="true"><path d="M34 108 V14"/><path d="M34 18 H92 L80 38 L92 58 H34"/></svg>`,
};

// Siegerbildschirm: Kopf in Teamfarbe, Siegertreppchen, eigene Zahlen, Konfetti beim ersten Anzeigen
function renderWinner(v, catches, dist) {
  const res = v.result ?? {};
  const start = v.timers?.huntStartAt ?? 0;
  const me = v.players.find((p) => p.id === v.me.id);
  const minutes = res.at && v.timers?.startedAt ? Math.max(0, Math.round((res.at - v.timers.startedAt) / 60_000)) : null;
  const myTeam = me?.startRole === 'hunter' ? 'hunters' : 'hiders';
  const won = res.winner && me && res.winner === myTeam;
  const sub = [`Runde ${v.round}`, minutes ? `${minutes} min` : null].filter(Boolean).join(' · ');
  const head = res.winner && me ? (won ? 'Dein Team hat gewonnen' : 'Diesmal nicht') : '';
  const kickerHtml = `${head ? `<span>${head}</span>` : ''}<small>${sub}</small>`;
  if ($('#endKicker').innerHTML !== kickerHtml) $('#endKicker').innerHTML = kickerHtml;

  // Treppchen: Jäger nach Fängen, Hider nach Überlebenszeit
  let podium = [];
  if (res.winner === 'hunters') {
    podium = v.players
      .filter((p) => p.startRole === 'hunter')
      .map((p) => ({ p, n: catches[p.name] ?? 0 }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 3)
      .map(({ p, n }) => ({ name: p.name, val: n === 1 ? '1 gefangen' : `${n} gefangen` }));
  } else if (res.winner === 'hiders') {
    podium = v.players
      .filter((p) => p.startRole === 'hider')
      .sort((a, b) => (b.caughtAt ?? Infinity) - (a.caughtAt ?? Infinity))
      .slice(0, 3)
      .map((p) => ({ name: p.name, val: p.caughtAt ? fmt(p.caughtAt - start) : 'überlebt' }));
  }
  // Gleichstand (z. B. alle überlebt) = gleicher Platz
  podium.forEach((x, i) => (x.rank = i > 0 && x.val === podium[i - 1].val ? podium[i - 1].rank : i + 1));
  const order = podium.length === 3 ? [1, 0, 2] : podium.length === 2 ? [1, 0] : [0];
  const podiumHtml = podium.length
    ? order
        .map((i) => {
          const x = podium[i];
          return `<div class="pod pod-${x.rank}" style="--d:${0.35 + (2 - i) * 0.12}s"><b>${esc(x.name)}</b><small>${esc(x.val)}</small><div class="pod-bar">${x.rank}</div></div>`;
        })
        .join('')
    : '';
  // Nur bei Änderung neu setzen, sonst wachsen die Balken bei jeder Aktualisierung neu
  if ($('#endPodium').innerHTML !== podiumHtml) $('#endPodium').innerHTML = podiumHtml;

  // Eigene Zahlen
  const mine = [];
  if (me) {
    if (me.startRole === 'hider') mine.push(me.caughtAt ? ['Du', `gefangen nach ${fmt(me.caughtAt - start)}`] : ['Du', 'überlebt']);
    else mine.push(['Du', `${catches[me.name] ?? 0} gefangen`]);
    if (dist.get(me.id) > 0) mine.push(['Gelaufen', formatDistance(dist.get(me.id))]);
  }
  const trophy = (res.trophies ?? [])[0];
  if (trophy) mine.push(['Pokal nächste Runde', trophy.name === me?.name ? 'Du 🏆' : trophy.name]);
  const mineHtml = iconize(mine.map(([k, val]) => `<div><small>${k}</small><b>${esc(val)}</b></div>`).join(''));
  if ($('#endMine').innerHTML !== mineHtml) $('#endMine').innerHTML = mineHtml;

  // Konfetti einmal pro Runde
  const key = `${v.code}-${v.round}`;
  if (res.winner && S.confettiFor !== key && !reducedMotion()) {
    S.confettiFor = key;
    const colors = res.winner === 'hunters' ? ['#ff3b4e', '#ff8a96', '#ffb020', '#fff'] : ['#22d67e', '#8cf0bd', '#ffb020', '#fff'];
    $('#endConfetti').innerHTML = Array.from({ length: 36 }, (_, i) => {
      const left = Math.round(Math.random() * 100);
      const delay = (Math.random() * 0.6).toFixed(2);
      const dur = (2.2 + Math.random() * 1.6).toFixed(2);
      const rot = Math.round(Math.random() * 720 - 360);
      return `<i style="left:${left}%;background:${colors[i % colors.length]};animation-delay:${delay}s;animation-duration:${dur}s;--r:${rot}deg"></i>`;
    }).join('');
    setTimeout(() => ($('#endConfetti').innerHTML = ''), 4500);
  }
}

// Strecke einer Route in Metern. Sprünge schneller als 8 m/s (Auto, GPS-Ausreißer) zählen nicht.
function trailDistance(trail) {
  let d = 0;
  for (let i = 1; i < trail.length; i++) {
    const [lat1, lng1, t1] = trail[i - 1];
    const [lat2, lng2, t2] = trail[i];
    const seg = distanceM({ lat: lat1, lng: lng1 }, { lat: lat2, lng: lng2 });
    if (seg / Math.max(1, (t2 - t1) / 1000) <= 8) d += seg;
  }
  return d;
}

function drawEndMap(dist = new Map()) {
  const v = S.view;
  const trails = S.trails.players;
  // Standard: die eigene Route, sonst die längste
  if (!trails.some((p) => p.id === S.routeId)) {
    const mine = trails.find((p) => p.id === v.me.id && (dist.get(p.id) ?? 0) > 20);
    S.routeId = mine?.id ?? [...trails].sort((a, b) => (dist.get(b.id) ?? 0) - (dist.get(a.id) ?? 0))[0]?.id;
  }
  const order = (p) => (p.role === 'hider' ? 0 : 1);
  const picker = [...trails]
    .sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name))
    .map(
      (p) => `<button class="route-chip ${p.id === S.routeId ? 'active' : ''}" data-action="route" data-id="${p.id}">
        <span class="dot" style="background:${p.role === 'hunter' ? 'var(--hunter)' : 'var(--hider)'}"></span>${esc(p.name)}
        <small>${dist.has(p.id) ? formatDistance(dist.get(p.id)) : ''}</small></button>`,
    )
    .join('');
  const pickerIcons = iconize(picker);
  if ($('#routePicker').innerHTML !== pickerIcons) $('#routePicker').innerHTML = pickerIcons;

  if (!S.maps.end) S.maps.end = makeMap('endMap');
  const map = S.maps.end;
  S.endLayer?.remove();
  const layer = L.layerGroup().addTo(map);
  S.endLayer = layer;
  const z = v.settings.zone;
  L.circle([z.lat, z.lng], { radius: z.radius, color: '#ff3b4e', weight: 1, fillOpacity: 0.04 }).addTo(layer);
  if (v.zone && v.zone.radius !== z.radius) {
    L.circle([v.zone.lat, v.zone.lng], { radius: v.zone.radius, color: '#ff3b4e', weight: 2, dashArray: '6 6', fill: false }).addTo(layer);
  }
  let bounds = boundsOf(z);
  const p = trails.find((x) => x.id === S.routeId);
  if (p && p.trail.length) {
    const color = p.role === 'hunter' ? '#ff3b4e' : '#22d67e';
    const line = p.trail.map(([lat, lng]) => [lat, lng]);
    L.polyline(line, { color, weight: 4, opacity: 0.9 }).addTo(layer);
    L.circleMarker(line[0], { radius: 6, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 }).addTo(layer).bindTooltip('Start');
    const last = p.trail.at(-1);
    if (p.caughtAt) {
      const at = p.trail.reduce((best, pt) => (Math.abs(pt[2] - p.caughtAt) < Math.abs(best[2] - p.caughtAt) ? pt : best), last);
      L.marker([at[0], at[1]], {
        icon: L.divIcon({ className: '', html: '<div style="font-size:22px;color:#fff;text-shadow:0 0 4px #000">✕</div>', iconSize: [22, 22], iconAnchor: [11, 11] }),
      })
        .addTo(layer)
        .bindTooltip(`Gefangen von ${p.caughtBy}`);
    } else {
      L.circleMarker([last[0], last[1]], { radius: 7, color, fillOpacity: 1 }).addTo(layer).bindTooltip('Ende');
    }
    bounds = L.latLngBounds(line);
    $('#routeInfo').textContent = `${p.name}: ${formatDistance(dist.get(p.id) ?? 0)} gelaufen${p.caughtAt ? ` · gefangen von ${p.caughtBy}` : ''}. Weißer Kreis = Start${p.caughtAt ? ', ✕ = gefangen' : ''}.`;
  } else {
    $('#routeInfo').textContent = p ? `Für ${p.name} gibt es keine Route (kein GPS während des Spiels).` : '';
  }
  setTimeout(() => {
    map.invalidateSize();
    map.fitBounds(bounds, { padding: [20, 20], maxZoom: 17 });
  }, 80);
}

// ---------------------------------------------------------------- Chat
function addChatMsg(m) {
  if (S.chat.msgs.some((x) => x.id === m.id)) return;
  S.chat.msgs.push(m);
  if (m.from !== S.view?.me.id && currentScreen() === 'game' && S.tab !== 'chat') {
    S.chat.unread += 1;
    updateBadge();
  }
  renderChats();
}

function updateBadge() {
  const b = $('#chatBadge');
  b.textContent = S.chat.unread > 9 ? '9+' : S.chat.unread;
  b.classList.toggle('show', S.chat.unread > 0);
}

function renderChats() {
  const v = S.view;
  if (!v) return;
  const screen = currentScreen();
  const el = $(`.screen.active [data-chat]`);
  if (!el || screen === 'home') return;
  if (!el.dataset.built) {
    el.dataset.built = '1';
    el.innerHTML = `<div class="chat-tabs"></div><div class="chat-log"></div>
      <form class="chat-form"><input maxlength="300" placeholder="Nachricht …" autocomplete="off" /><button class="btn small primary">Senden</button></form>`;
    el.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = e.target.querySelector('input');
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      const r = await send('chat', { channel: S.chat.channel, text });
      if (!r.ok) toast(r.error, 'error');
    });
    el.querySelector('.chat-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-ch]');
      if (!b) return;
      S.chat.channel = b.dataset.ch;
      renderChats();
    });
  }
  const channels = v.chatChannels;
  if (!channels.includes(S.chat.channel)) S.chat.channel = channels[0];
  const tabs = el.querySelector('.chat-tabs');
  tabs.style.display = channels.length > 1 ? '' : 'none';
  tabs.innerHTML = channels
    .map((c) => `<button type="button" data-ch="${c}" class="${c === S.chat.channel ? 'active' : ''}">${CHANNEL_NAMES[c]}</button>`)
    .join('');
  const msgs = S.chat.msgs.filter((m) => m.channel === S.chat.channel);
  const log = el.querySelector('.chat-log');
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  const html = msgs.length
    ? msgs
        .map((m) => {
          const time = new Date(m.ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
          return `<div class="chat-msg ${m.from === v.me.id ? 'mine' : ''}"><small>${esc(m.name)} · ${time}</small>${esc(m.text)}</div>`;
        })
        .join('')
    : '<div class="chat-empty">Noch keine Nachrichten.</div>';
  if (log.innerHTML !== html) {
    log.innerHTML = html;
    if (atBottom || msgs.at(-1)?.from === v.me.id) log.scrollTop = log.scrollHeight;
  }
}

// ---------------------------------------------------------------- Aktionen
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  unlockAudio();
  if (S.view?.phase && S.view.phase !== 'lobby') requestWakeLock();
  const v = S.view;
  const a = el.dataset.action;
  const check = (r) => {
    if (!r.ok) toast(r.error, 'error');
    return r;
  };

  if (a === 'gps') startGps(true);
  else if (a === 'setWarn') saveSettings({ shrinkWarnMin: Number(el.dataset.min) });
  else if (a === 'crushClear') {
    S.crushDraft = null;
    send('crush', { a: null, b: null }).then(() => render());
  }
  else if (a === 'gpsHelp') openGpsHelp();
  else if (a === 'simLobby') {
    S.sim = true;
    $('#simCheck').checked = true;
    const p = randomPointInZone();
    setSimPosition(p.lat, p.lng);
  } else if (a === 'share') openShare();
  else if (a === 'leave') {
    confirmModal('Spiel verlassen?', 'Du verlässt das Spiel und musst neu beitreten, um wieder mitzumachen.', 'Verlassen', async () => {
      await send('leave');
      setSession(null);
      S.view = null;
      S.chat = { msgs: [], channel: null, unread: 0, channelsKey: '' };
      render();
    });
  } else if (a === 'toggleRole') {
    const p = v.players.find((x) => x.id === el.dataset.id);
    if (p) check(await send('setRole', { playerId: p.id, role: p.role === 'hunter' ? 'hider' : 'hunter' }));
  } else if (a === 'stepNext') goStep(S.step + 1);
  else if (a === 'stepBack') goStep(S.step - 1);
  else if (a === 'huntersMinus' || a === 'huntersPlus') {
    S.hunterCount += a === 'huntersPlus' ? 1 : -1;
    renderLobby();
  } else if (a === 'copyLink') copyInvite();
  else if (a === 'shareLink') shareInvite();
  else if (a === 'help') openRoleHelp();
  else if (a === 'kick') {
    const p = v.players.find((x) => x.id === el.dataset.id);
    confirmModal(`${p?.name ?? 'Spieler'} entfernen?`, 'Der Spieler fliegt aus dem Spiel.', 'Entfernen', async () => check(await send('kick', { playerId: el.dataset.id })));
  } else if (a === 'randomize') check(await send('randomize', { hunters: S.hunterCount }));
  else if (a === 'randomizeNew') check(await send('randomize', { hunters: S.hunterCount, avoidLast: true }));
  else if (a === 'lastSettings') applyLastSettings();
  else if (a === 'shareResult') shareResult();
  else if (a === 'howTo') openModal(iconize($('#howTpl').innerHTML));
  else if (a === 'showRoutes') $('#endRoutes').scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  else if (a === 'firstTime') {
    const r = check(await send('settings', firstTimeUpdate(v.settings.zone)));
    if (r.ok) toast('🌱 Empfohlene Einstellungen übernommen.');
  }
  else if (a === 'start') {
    openModal(
      `<h2>Spiel starten?</h2>
       <p class="muted">Sind alle am Startpunkt? Nach dem Start laufen die Hider los.</p>
       <ul class="rules">${rulesSummary(v.settings)
         .filter(([icon]) => ['⏱️', '🏃', '📍', '✋'].includes(icon))
         .map(([i, t]) => `<li><span class="r-icon">${i}</span><span>${t}</span></li>`)
         .join('')}</ul>
       <div class="row"><button class="btn" data-action="closeModal">Noch nicht</button><button class="btn primary" id="modalOk">▶ Los geht’s!</button></div>`,
      (m) =>
        $('#modalOk', m).addEventListener('click', async () => {
          closeModal();
          const r = check(await send('start'));
          if (r.ok) rememberSettings(v.settings);
        }),
    );
  } else if (a === 'end') {
    confirmModal('Runde beenden?', 'Die Runde endet sofort ohne Sieger.', 'Beenden', async () => check(await send('end')));
  } else if (a === 'lobby') check(await send('lobby'));
  else if (a === 'toggleCode') {
    S.codeVisible = !S.codeVisible;
    renderDock(v);
  } else if (a === 'toggleDock') setDockOpen(!S.dockOpen);
  else if (a === 'moreBanners') {
    S.bannersOpen = !S.bannersOpen;
    tickGame();
  }
  else if (a === 'catch') openCatch();
  else if (a === 'joker') openJoker(el.dataset.type);
  else if (a === 'recenter') {
    const pos = S.gps.last;
    if (pos) S.maps.game?.setView([pos.lat, pos.lng], Math.max(S.maps.game.getZoom(), 16));
    else toast('Noch kein Standort.', 'error');
  } else if (a === 'fitAll') {
    if (S.maps.game) S.maps.game.fitBounds(boundsOf(v.settings.zone), { padding: [20, 20] });
  } else if (a === 'closeModal') closeModal();
  else if (a === 'disputeStart') openDisputeReport();
  else if (a === 'disputeDecide') openDisputeDecision(el.dataset.id);
  else if (a === 'compass') toggleCompass();
  else if (a === 'closeEvent') closeEventOverlay();
  else if (a === 'route') {
    S.routeId = el.dataset.id;
    renderEnd();
  }
});

// ---------------------------------------------------------------- Modals
function openModal(html, onMount) {
  const m = $('#modal');
  m.innerHTML = `<div class="modal-box">${html}</div>`;
  m.hidden = false;
  onMount?.(m);
}
function closeModal() {
  const m = $('#modal');
  m.hidden = true;
  m.innerHTML = '';
}
$('#modal').addEventListener('click', (e) => {
  if (e.target.id === 'modal') closeModal();
});

function confirmModal(title, text, okLabel, onOk) {
  openModal(
    `<h2>${esc(title)}</h2><p class="muted">${esc(text)}</p>
     <div class="row"><button class="btn" data-action="closeModal">Abbrechen</button><button class="btn primary" id="modalOk">${esc(okLabel)}</button></div>`,
    (m) => {
      $('#modalOk', m).addEventListener('click', async () => {
        closeModal();
        await onOk();
      });
    },
  );
}

function openShare() {
  const svg = qrSvg(inviteUrl());
  openModal(
    `<h2>Freunde einladen</h2>
     <p class="muted">Code <b style="color:var(--ping)">${S.view.code}</b> eingeben oder QR-Code scannen.</p>
     ${svg ? `<div class="qr">${svg}</div>` : ''}
     <div class="share-link">${esc(inviteUrl())}</div>
     <div class="row"><button class="btn" data-action="copyLink">🔗 Link kopieren</button>${navigator.share ? '<button class="btn primary" data-action="shareLink">📤 Teilen</button>' : ''}</div>`,
  );
}

// Erklärt die eigene Rolle – automatisch beim Start und jederzeit über den ?-Knopf.
function openRoleHelp() {
  const v = S.view;
  if (!v) return;
  const me = v.me;
  const ping = v.settings.pingIntervalMin === 1 ? 'Jede Minute' : `Alle ${v.settings.pingIntervalMin} Minuten`;
  let title;
  let items;
  if (me.spectator) {
    title = '😵 Du bist raus';
    items = ['Du wurdest gefangen. Du siehst jetzt die Karte der Jäger.', 'Verrate den Hidern nichts – das wäre unfair!'];
  } else if (me.role === 'hider') {
    title = '🏃 Du bist Hider';
    items = [
      'Lauf los und versteck dich <b>innerhalb der roten Zone</b>.',
      `${ping} sehen die Jäger, wo du gerade bist. Das nennt man <b>Ping</b>. Danach am besten den Ort wechseln!`,
      `${catchRuleText(v.settings)} Dann bleibst du stehen, tippst unten auf <b>Dein Fang-Code</b> und zeigst ihn dem Jäger.`,
      'Deine <b>Joker</b> unten kannst du je einmal einsetzen – einfach antippen.',
      'Lass die Seite offen und den Bildschirm an.',
    ];
  } else {
    title = '🎯 Du bist Jäger';
    items = [
      v.phase === 'headstart' ? 'Warte, bis der Vorsprung vorbei ist. Der Countdown steht oben.' : 'Die Jagd läuft – los geht’s!',
      `${ping} siehst du, wo die Hider gerade sind: die <b class="t-ping">orangen Punkte</b>.${
        v.settings.pingTrail > 0 ? ' Tippe auf einen Punkt, um zu sehen, wo der Hider vorher war.' : ''
      }`,
      `${catchRuleText(v.settings)} Dann lass dir den Code zeigen und tippe unten auf <b>Gefangen!</b>.`,
      'Gibt ein Hider seinen Code nicht her, melde im Fang-Fenster einen <b>Streitfall</b> – der Spielleiter entscheidet.',
      'Die <b>Team-Joker</b> unten teilt ihr euch – sprecht euch im Chat ab.',
    ];
  }
  openModal(
    `<h2>${title}</h2>
     <ol class="help">${items.map((i) => `<li>${i}</li>`).join('')}</ol>
     <div class="legend">
       <span><i class="lg self"></i>Du</span><span><i class="lg hunter"></i>Jäger</span><span><i class="lg hider"></i>Hider</span>
       <span><i class="lg ping"></i>Letzter Ping</span><span><i class="lg zone"></i>Zone</span><span><i class="lg next"></i>Neue Zone</span>
     </div>
     <div class="row"><button class="btn primary" data-action="closeModal">Verstanden</button></div>`,
  );
}

function openCatch() {
  openModal(
    `<h2>🎯 Hider gefangen?</h2>
     <p class="muted">Lass dir den 4-stelligen Fang-Code vom Handy des Hiders zeigen und tippe ihn hier ein.</p>
     <form id="catchForm">
       <input class="code-input" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" placeholder="0000" />
       <div class="row"><button type="button" class="btn" data-action="closeModal">Abbrechen</button><button class="btn primary">Gefangen!</button></div>
     </form>
     <button type="button" class="link-btn" data-action="disputeStart">⚖️ Hider gibt den Code nicht her? Streitfall melden</button>`,
    (m) => {
      const input = $('input', m);
      setTimeout(() => input.focus(), 50);
      input.addEventListener('input', () => (input.value = input.value.replace(/\D/g, '').slice(0, 4)));
      $('#catchForm', m).addEventListener('submit', async (e) => {
        e.preventDefault();
        const r = await send('catch', { code: input.value });
        if (!r.ok) {
          toast(r.error, 'error');
          input.select();
          return;
        }
        closeModal();
      });
    },
  );
}

// Jäger wählt den Hider aus, der den Code verweigert
function openDisputeReport() {
  const hiders = S.view.players
    .filter((p) => p.role === 'hider' && p.status === 'alive')
    .sort((a, b) => a.name.localeCompare(b.name));
  openModal(
    `<h2>⚖️ Streitfall melden</h2>
     <p class="muted">Wen hast du erwischt? Der Spielleiter bekommt eine Nachricht und entscheidet. Bleibt so lange stehen.</p>
     <div class="pick-list">${hiders.map((p) => `<button class="btn" data-dispute-hider="${p.id}">${esc(p.name)}</button>`).join('')}</div>
     <div class="row"><button class="btn" data-action="closeModal">Abbrechen</button></div>`,
    (m) =>
      m.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-dispute-hider]');
        if (!b) return;
        const r = await send('dispute', { hiderId: b.dataset.disputeHider });
        if (!r.ok) return toast(r.error, 'error');
        closeModal();
      }),
  );
}

// Spielleiter entscheidet einen Streitfall
function openDisputeDecision(id) {
  const d = S.view?.disputes?.find((x) => x.id === id);
  if (!d) return;
  S.disputeOpen = id;
  const dist =
    d.distance == null
      ? 'Für mindestens einen der beiden gibt es gerade keinen GPS-Standort.'
      : `Laut GPS waren die beiden etwa <b>${d.distance} m</b> auseinander. GPS kann 10–30 m danebenliegen – nimm das nur als Hinweis.`;
  openModal(
    `<h2>⚖️ Streitfall</h2>
     <p><b>${esc(d.hunter)}</b> meldet <b>${esc(d.hider)}</b> als gefangen, aber ${esc(d.hider)} gibt den Code nicht her.</p>
     <p class="muted">${dist}</p>
     <p class="muted">Regel: ${catchRuleText(S.view.settings)}</p>
     <div class="row"><button class="btn" id="disputeNo">Nein, weiterspielen</button><button class="btn primary" id="disputeYes">Ja, gefangen</button></div>`,
    (m) => {
      const decide = async (accept) => {
        closeModal();
        const r = await send('resolveDispute', { id, accept });
        if (!r.ok) toast(r.error, 'error');
      };
      $('#disputeYes', m).addEventListener('click', () => decide(true));
      $('#disputeNo', m).addEventListener('click', () => decide(false));
    },
  );
}

function showEventOverlay(ev, info) {
  const meta = info?.[ev.type];
  if (!meta) return;
  const el = $('#eventOverlay');
  el.innerHTML = `<div class="ev-card" role="alertdialog" aria-label="Special Event">
      <div class="ev-icon">${meta.icon}</div>
      <div class="ev-kicker">Special Event</div>
      <h2>${esc(meta.name)}</h2>
      <p>${esc(meta.desc)}</p>
      ${ev.detail ? `<p class="ev-detail">${esc(ev.detail)}</p>` : ''}
      <button class="btn primary" data-action="closeEvent">Verstanden</button>
    </div>`;
  el.hidden = false;
  sound('event');
  clearTimeout(S.eventTimer);
  S.eventTimer = setTimeout(closeEventOverlay, 9000);
}

function closeEventOverlay() {
  clearTimeout(S.eventTimer);
  $('#eventOverlay').hidden = true;
  if (S.roleHelpAfterEvent) {
    S.roleHelpAfterEvent = false;
    openRoleHelp();
  }
}

function openJoker(type) {
  const j = S.view.jokerInfo[type];
  openModal(
    `<h2>${j.icon} ${esc(j.name)}</h2><p class="joker-desc">${esc(j.desc)}</p>
     <div class="row"><button class="btn" data-action="closeModal">Abbrechen</button><button class="btn primary" id="useJoker">Einsetzen</button></div>`,
    (m) => {
      $('#useJoker', m).addEventListener('click', async () => {
        closeModal();
        const r = await send('joker', { type });
        if (!r.ok) toast(r.error, 'error');
        else setDockOpen(false);
      });
    },
  );
}

// ---------------------------------------------------------------- Toasts & Sound
function toast(text, kind = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = text;
  const box = $('#toasts');
  box.appendChild(el);
  // Im Spiel höchstens zwei Kurzmeldungen auf einmal, damit die Karte frei bleibt
  const max = document.body.classList.contains('in-game') ? 2 : 4;
  while (box.children.length > max) box.firstChild.remove();
  setTimeout(() => el.classList.add('out'), kind === 'warn' ? 6000 : 4000);
  setTimeout(() => el.remove(), kind === 'warn' ? 6500 : 4500);
}

let audio = null;
function unlockAudio() {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch {
    audio = null;
  }
}

const SOUNDS = {
  ping: { notes: [[880, 0, 0.12], [1320, 0.15, 0.18]], vibrate: [80, 60, 80] },
  catch: { notes: [[523, 0, 0.12], [659, 0.12, 0.12], [784, 0.24, 0.25]], vibrate: [200] },
  warn: { notes: [[330, 0, 0.25], [330, 0.35, 0.25]], vibrate: [300, 100, 300] },
  start: { notes: [[440, 0, 0.15], [660, 0.18, 0.15], [880, 0.36, 0.3]], vibrate: [150, 80, 150] },
  end: { notes: [[784, 0, 0.15], [659, 0.18, 0.15], [523, 0.36, 0.15], [1046, 0.54, 0.4]], vibrate: [400] },
  event: { notes: [[523, 0, 0.1], [784, 0.12, 0.1], [523, 0.24, 0.1], [1046, 0.36, 0.35]], vibrate: [100, 60, 100, 60, 300] },
};

function sound(kind) {
  const s = SOUNDS[kind];
  if (!s) return;
  try {
    navigator.vibrate?.(s.vibrate);
  } catch {
    /* nicht unterstützt */
  }
  if (!audio) return;
  const t0 = audio.currentTime + 0.02;
  for (const [freq, start, dur] of s.notes) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0 + start);
    gain.gain.exponentialRampToValueAtTime(0.15, t0 + start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
    osc.connect(gain).connect(audio.destination);
    osc.start(t0 + start);
    osc.stop(t0 + start + dur + 0.05);
  }
}

// ---------------------------------------------------------------- Start
initGpsPermission();
render();
