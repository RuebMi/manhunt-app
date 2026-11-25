/* global L */
// Kartenhintergrund: dunkle Vektorkarte von OpenFreeMap in Manhunt-Farben (über MapLibre).
// Ohne WebGL, ohne MapLibre oder wenn OpenFreeMap nicht erreichbar ist: OpenStreetMap-Kacheln,
// per CSS-Filter dunkel gemacht (so wie früher).

const STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';
const OSM_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

// Farben der Vorlage "Dark" an Manhunt anpassen: Hintergrund wie die App, Straßen heller,
// damit sie auch draußen gut zu sehen sind. Schlüssel = Layer-ID im Stil.
const COLORS = {
  background: '#0f1318',
  water: '#0d2130',
  waterway: '#0d2130',
  landuse_residential: '#12171d',
  landcover_wood: '#0f1f18',
  landuse_park: '#0f1f18',
  building: '#1b222b',
  highway_path: '#2b3440',
  highway_minor: '#303a47',
  highway_major_casing: '#4a5666',
  highway_major_inner: '#3a4554',
  highway_major_subtle: '#3a4554',
  highway_motorway_casing: '#56637a',
  highway_motorway_subtle: '#3a4554',
  railway: '#2c343e',
  railway_minor: '#2c343e',
  railway_transit: '#2c343e',
};

function tune(style) {
  for (const layer of style.layers ?? []) {
    const color = COLORS[layer.id];
    layer.paint ??= {};
    if (color) {
      const prop = layer.type === 'background' ? 'background-color' : layer.type === 'line' ? 'line-color' : 'fill-color';
      layer.paint[prop] = color;
    }
    if (layer.type === 'symbol' && layer.layout?.['text-field']) {
      layer.paint['text-color'] = layer.id.startsWith('place') ? '#aab4c0' : '#8c99a8';
      layer.paint['text-halo-color'] = '#0b0d10';
    }
  }
  return style;
}

function webglOk() {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

// Der Stil wird nur einmal geladen und dann für alle Karten benutzt
let stylePromise = null;
function loadStyle() {
  stylePromise ??= fetch(STYLE_URL)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then(tune)
    .catch((err) => {
      stylePromise = null; // beim nächsten Mal neu versuchen
      throw err;
    });
  return stylePromise;
}

function addRaster(map) {
  map.getContainer().classList.add('raster-dark');
  L.tileLayer(OSM_URL, { attribution: OSM_ATTR, maxZoom: 19 }).addTo(map);
}

export function addBaseLayer(map) {
  if (!L.maplibreGL || !window.maplibregl || !webglOk()) return addRaster(map);
  loadStyle()
    .then((style) => {
      // structuredClone: jede Karte bekommt ihre eigene Kopie des Stils
      L.maplibreGL({ style: structuredClone(style), interactive: false }).addTo(map);
    })
    .catch(() => addRaster(map));
}
