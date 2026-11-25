/* global L */
// Fenster "Checkpoints auswählen" (Missionen): große Karte mit der Zone und eine Liste darunter.
// Vorschläge kommen vom eigenen Server (/api/places, OpenStreetMap). Antippen schaltet zwischen
// "ja" (grün) und "nein" (grau). Eigene Punkte setzt der Spielleiter per Tipp auf die Karte.

const MAX = 20;
const COLORS = { on: '#22d67e', off: '#8c99a8', zone: '#ff3b4e' };

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function distanceM(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Gleicher Ort = gleiche ID, auch nach dem Neuladen der Vorschläge
const placeId = (p) => `p${Math.round(p.lat * 1e5)}_${Math.round(p.lng * 1e5)}`;

// Speicher auf dem Handy des Spielleiters: pro Spielfeld (gerundete Mitte und Radius)
export const CHECKPOINTS_KEY = 'manhunt-checkpoints';
export const zoneKey = (z) => `${z.lat.toFixed(3)},${z.lng.toFixed(3)},${z.radius}`;

export function openCheckpointPicker({ zone, chosen, makeMap, openModal, closeModal, onSave }) {
  // items: alles, was auf Karte und Liste steht
  const items = (chosen ?? []).map((c) => ({ id: c.id, name: c.name, lat: c.lat, lng: c.lng, kind: null, own: true, on: true }));
  let ownCount = items.length;
  let placing = false;
  let map = null;
  const markers = new Map();

  openModal(
    `<div class="cp-picker">
      <h2>Checkpoints</h2>
      <p class="muted">Tippe sichere, öffentliche Orte an, die als Ziel für Missionen in Frage kommen. Grün = dabei.</p>
      <div id="cpMap" class="cp-map"></div>
      <div class="cp-tools">
        <button type="button" class="btn small" id="cpOwn">📍 Eigenen Punkt setzen</button>
        <b id="cpCount"></b>
      </div>
      <p class="hint" id="cpHint">Suche Orte im Spielfeld …</p>
      <ul class="cp-list" id="cpList"></ul>
      <div class="row cp-actions">
        <button type="button" class="btn" id="cpCancel">Abbrechen</button>
        <button type="button" class="btn primary" id="cpDone">Fertig</button>
      </div>
    </div>`,
    (m) => {
      m.firstElementChild.classList.add('cp-box');
      const $ = (sel) => m.querySelector(sel);
      const root = $('.cp-picker');
      const open = () => root.isConnected; // Fenster kann auch über den Hintergrund geschlossen werden
      const hint = (text) => open() && ($('#cpHint').textContent = text);
      const close = () => {
        map?.remove();
        closeModal();
      };

      map = makeMap($('#cpMap'), { scrollWheelZoom: 'center' });
      L.circle([zone.lat, zone.lng], { radius: zone.radius, color: COLORS.zone, weight: 2, fillOpacity: 0.05, interactive: false }).addTo(map);
      map.fitBounds(L.latLng(zone.lat, zone.lng).toBounds(zone.radius * 2), { padding: [8, 8] });
      setTimeout(() => map?.invalidateSize(), 250); // nach der Einblend-Animation

      const countOn = () => items.filter((x) => x.on).length;

      function toggle(item) {
        if (!item.on && countOn() >= MAX) return hint(`Höchstens ${MAX} Checkpoints pro Spiel.`);
        item.on = !item.on;
        draw();
      }

      function draw() {
        for (const it of items) {
          let mk = markers.get(it.id);
          if (!mk) {
            mk = L.circleMarker([it.lat, it.lng], { radius: 9, weight: 2, fillOpacity: 0.85, bubblingMouseEvents: false }).addTo(map);
            mk.on('click', () => {
              const cur = items.find((x) => x.id === it.id);
              if (cur) toggle(cur);
            });
            markers.set(it.id, mk);
          }
          const color = it.on ? COLORS.on : COLORS.off;
          mk.setStyle({ color: it.own ? '#e9eef4' : color, fillColor: color });
          mk.bindTooltip(esc(it.name));
        }
        for (const [id, mk] of markers) {
          if (!items.some((x) => x.id === id)) {
            mk.remove();
            markers.delete(id);
          }
        }
        const n = countOn();
        $('#cpCount').textContent = `${n} gewählt`;
        $('#cpCount').classList.toggle('warn', n < 3);
        $('#cpOwn').classList.toggle('active', placing);
        $('#cpList').innerHTML = items
          .map((it) => {
            const check = `<span class="cp-check">${it.on ? '✓' : ''}</span>`;
            if (it.own) {
              return `<li class="cp-row own ${it.on ? 'on' : ''}" data-id="${it.id}">
                <button type="button" class="cp-tog" data-cp="toggle" aria-label="Auswählen">${check}</button>
                <input class="cp-name" data-cp="name" value="${esc(it.name)}" maxlength="40" aria-label="Name des Punkts" />
                <button type="button" class="cp-del" data-cp="del" aria-label="Punkt entfernen">✕</button>
              </li>`;
            }
            return `<li class="cp-row ${it.on ? 'on' : ''}" data-id="${it.id}">
              <button type="button" class="cp-tog wide" data-cp="toggle">${check}<span class="cp-text"><b>${esc(it.name)}</b><small>${esc(it.kind ?? '')}</small></span></button>
            </li>`;
          })
          .join('');
      }

      $('#cpList').addEventListener('click', (e) => {
        const row = e.target.closest('[data-id]');
        const btn = e.target.closest('[data-cp]');
        const it = row && items.find((x) => x.id === row.dataset.id);
        if (!it || !btn) return;
        if (btn.dataset.cp === 'toggle') toggle(it);
        else if (btn.dataset.cp === 'del') {
          items.splice(items.indexOf(it), 1);
          draw();
        }
      });
      $('#cpList').addEventListener('input', (e) => {
        const row = e.target.closest('[data-id]');
        const it = row && items.find((x) => x.id === row.dataset.id);
        if (it && e.target.dataset.cp === 'name') {
          it.name = e.target.value;
          markers.get(it.id)?.setTooltipContent(esc(it.name));
        }
      });

      $('#cpOwn').addEventListener('click', () => {
        placing = !placing;
        hint(placing ? 'Tippe jetzt auf die Karte, wo der Punkt hin soll.' : '');
        draw();
      });
      map.on('click', (e) => {
        if (!placing) return;
        const pos = { lat: e.latlng.lat, lng: e.latlng.lng };
        if (distanceM(pos, zone) > zone.radius) return hint('Der Punkt liegt außerhalb der Zone.');
        if (countOn() >= MAX) return hint(`Höchstens ${MAX} Checkpoints pro Spiel.`);
        placing = false;
        ownCount += 1;
        items.unshift({ id: placeId(pos), name: `Eigener Punkt ${ownCount}`, lat: pos.lat, lng: pos.lng, kind: null, own: true, on: true });
        hint('Punkt gesetzt. Du kannst ihm unten in der Liste einen Namen geben.');
        draw();
      });

      $('#cpCancel').addEventListener('click', close);
      $('#cpDone').addEventListener('click', () => {
        const list = items
          .filter((x) => x.on)
          .map((x) => ({ id: x.id, name: x.name.trim().slice(0, 40) || 'Checkpoint', lat: x.lat, lng: x.lng }));
        onSave(list);
        close();
      });

      draw();

      // Vorschläge laden (höchstens 6 km Umkreis, mehr erlaubt der Server nicht)
      const q = new URLSearchParams({ lat: zone.lat.toFixed(5), lng: zone.lng.toFixed(5), radius: Math.min(6000, Math.round(zone.radius)) });
      fetch(`/api/places?${q}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
        .then((places) => {
          if (!open()) return map?.remove();
          for (const p of places) {
            if (distanceM(p, zone) > zone.radius) continue;
            // Schon gewählt (z. B. vom letzten Mal)? Dann nur die Art ergänzen.
            const same = items.find((x) => x.name === p.name && distanceM(x, p) < 15);
            if (same) {
              same.kind = p.kind;
              same.own = false;
              continue;
            }
            items.push({ id: placeId(p), name: p.name, lat: p.lat, lng: p.lng, kind: p.kind, own: false, on: false });
          }
          hint(places.length ? 'Tippe auf einen Punkt oder in der Liste, um ihn auszuwählen.' : 'Keine Vorschläge gefunden – du kannst eigene Punkte setzen.');
          draw();
        })
        .catch(() => hint('Vorschläge gerade nicht verfügbar – du kannst eigene Punkte setzen.'));
    },
  );
}
