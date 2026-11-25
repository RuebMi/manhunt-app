// Einheitliche Linien-Symbole (Tabler Icons, siehe icons.svg) statt Emojis.
// Texte im Code (und vom Server) dürfen weiter Emojis enthalten: Sie werden hier beim Anzeigen
// durch das passende Symbol ersetzt. Ausnahmen: Chat, Eingabefelder und der Teilen-Text
// (dort bleiben Emojis, weil sie in WhatsApp & Co. landen).

// Emoji -> [Symbol-Name, Zusatzklasse für die Farbe]
const MAP = {
  '🎯': ['target'],
  '🏃': ['run'],
  '📍': ['map-pin'],
  '🛰': ['satellite'],
  '🚁': ['drone'],
  '🐕': ['dog'],
  '👻': ['ghost'],
  '🎭': ['masks-theater'],
  '📡': ['radar-2'],
  '🛡': ['shield'],
  '🔦': ['building-lighthouse'],
  '🌧': ['cloud-rain'],
  '🔥': ['flame'],
  '🌫': ['mist'],
  '💰': ['coin'],
  '🔄': ['arrows-exchange'],
  '🏆': ['trophy', 'c-gold'],
  '⚖': ['scale'],
  '⚠': ['alert-triangle'],
  '📱': ['device-mobile'],
  '📵': ['device-mobile-off'],
  '✕': ['x'],
  '⛔': ['ban'],
  '🚫': ['ban'],
  '💘': ['heart', 'c-crush'],
  '⏱': ['stopwatch'],
  '✋': ['hand-stop'],
  '✓': ['check'],
  '✅': ['circle-check', 'c-hider'],
  '❌': ['circle-x', 'c-hunter'],
  '🔗': ['link'],
  '🔒': ['lock'],
  '⏳': ['hourglass'],
  '🧪': ['flask'],
  '😵': ['mood-x'],
  '🔴': ['broadcast', 'c-hunter'],
  '🟡': ['circle-dashed', 'c-ping'],
  '📤': ['share'],
  '💡': ['bulb'],
  '🗺': ['map-2'],
  '🔀': ['arrows-shuffle'],
  '⏩': ['player-track-next'],
  '🎁': ['gift'],
  '🎲': ['dice-5'],
  '👋': ['hand-move'],
  '👑': ['crown', 'c-gold'],
  '↩': ['arrow-back-up'],
  '🧭': ['compass'],
  '🥇': ['medal', 'c-gold'],
  '🌱': ['plant-2'],
  '📜': ['history'],
  '🎮': ['device-gamepad-2'],
  '➕': ['plus'],
  '🔍': ['search'],
  '⚡': ['bolt'],
  '⭐': ['star'],
  '📏': ['ruler-2'],
  '⚙': ['settings'],
  '🎉': ['confetti'],
  '👥': ['users'],
  '💬': ['message-circle'],
  '🚨': ['bell-ringing'],
  '🏁': ['flag'],
  '🗑': ['trash'],
  '〰': ['route'],
  '◎': ['current-location'],
  '⤢': ['arrows-maximize'],
  '⤴': ['share'],
  '▶': ['player-play'],
};

// Ein Emoji, optional mit Variations-Zeichen (U+FE0F) und folgendem Leerzeichen nicht mitnehmen
const RE = new RegExp(`(${Object.keys(MAP).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\uFE0F?`, 'gu');

// Genau so, wie der Browser es als innerHTML zurückgibt – dann bleiben "innerHTML !== html"-Vergleiche stabil.
export const ic = (name, cls = '') => `<svg class="i${cls ? ` ${cls}` : ''}" aria-hidden="true"><use href="/icons.svg#${name}"></use></svg>`;

// Emojis in einem (schon escapten) HTML-Text durch Symbole ersetzen
export const iconize = (html) => String(html ?? '').replace(RE, (m, e) => ic(MAP[e][0], MAP[e][1]));

const SKIP = '.chat-log, textarea, input, select, option, script, style, [data-emoji]';
const NS = 'http://www.w3.org/2000/svg';

function svgFor(e) {
  const [name, cls] = MAP[e];
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', cls ? `i ${cls}` : 'i');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(NS, 'use');
  use.setAttribute('href', `/icons.svg#${name}`);
  svg.appendChild(use);
  return svg;
}

function convertText(node) {
  const text = node.nodeValue;
  RE.lastIndex = 0;
  if (!RE.test(text)) return;
  const parent = node.parentElement;
  if (!parent || parent.closest(SKIP) || parent.namespaceURI === NS) return;
  const frag = document.createDocumentFragment();
  let last = 0;
  RE.lastIndex = 0;
  for (const m of text.matchAll(RE)) {
    if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
    frag.appendChild(svgFor(m[1]));
    last = m.index + m[0].length;
  }
  if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
  node.replaceWith(frag);
}

function convertTree(root) {
  if (root.nodeType === Node.TEXT_NODE) return convertText(root);
  if (root.nodeType !== Node.ELEMENT_NODE || root.closest?.(SKIP)) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const list = [];
  while (walker.nextNode()) list.push(walker.currentNode);
  list.forEach(convertText);
}

// Alles, was irgendwo auf der Seite an Text auftaucht (Kurzmeldungen, Karte, Fenster, Bisherige Spiele …)
export function observeEmojis(root = document.body) {
  convertTree(root);
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'characterData') convertText(m.target);
      else m.addedNodes.forEach(convertTree);
    }
  }).observe(root, { childList: true, subtree: true, characterData: true });
}
