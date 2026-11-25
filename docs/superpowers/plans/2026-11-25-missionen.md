# Missionen (Checkpoints) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hider bekommen ab und zu ein freiwilliges Checkpoint-Angebot; Jäger sehen das Ziel; 30 s im Kreis = Joker, Zeit um = Strafe-Ping.

**Architecture:** Die Missionslogik liegt in einem eigenen Modul `server/missions.js` (reine Rechenfunktionen plus Funktionen, die auf einem `Game` arbeiten); `server/game.js` ruft sie an wenigen Stellen auf (tick, Zonenstufe, Fangen, Start, View, Archiv). Vorschläge für Ziele holt `server/places.js` über die Overpass-API (wie `server/geocode.js` für Nominatim). Im Browser kommt ein Auswahlfenster `public/checkpoints.js` dazu; Anzeige im Spiel in `public/app.js`.

**Tech Stack:** Node ≥ 20 (ES-Module), Express 5, Socket.IO 4, Leaflet im Browser ohne Build, Tests mit `node:assert` (`npm test`).

**Spec:** `docs/superpowers/specs/2026-11-25-missionen-design.md`

## Global Constraints

- Texte für Nutzer auf Deutsch, einfach, ohne Fachjargon; Emojis in Server-Texten sind okay (`public/icons.js` ersetzt sie beim Anzeigen durch Symbole).
- Missionen-Einstellung: `missionsMode` = `'off' | 'rare' | 'often'`, Standard `'off'`; bei „Ich spiele zum ersten Mal“ `'off'`.
- Rhythmus: `rare` = alle 12 min ein Angebot, `often` = alle 6 min; erstes Angebot frühestens 5 min nach Jagdbeginn; keine neuen Angebote, wenn < 10 min übrig.
- Höchstens 2 Missionen gleichzeitig (offene Angebote zählen mit); nie zwei am selben Checkpoint; eine pro Hider.
- Angebot: 60 s Bedenkzeit; Ziel 300–900 m vom Hider; abgelehnt/keine Antwort → neues Angebot an anderen Hider, höchstens 3 Angebote pro Platz; wer ablehnt, 5 min kein neues Angebot.
- Zeitlimit: `(3 + ceil(Entfernung / 150)) * 1 min` (650 m → 8 min).
- Geschafft: 30 s am Stück im Kreis mit Radius 35 m. Belohnung: < 500 m `decoy`, ab 500 m zufällig `cloak` oder `radar`.
- Zeit um: Strafe-Ping mit echtem Standort (Tarnkappe/Doppelgänger wirken nicht), erscheint in der Ping-Spur; entfällt bei `protectedUntil > now` oder `shieldUntil > now`.
- Ziel fällt bei Ankündigung (oder Anwendung) einer Zonenstufe aus der neuen Zone → Angebot/Mission ohne Strafe abbrechen, Meldung „Ziel liegt bald außerhalb der Zone, Mission ohne Strafe beendet“.
- Checkpoints: höchstens 20 pro Spiel; Missionen brauchen mindestens 3 Checkpoints in der Zone; Liste nur für den Spielleiter sichtbar (wie `finalCenter`).
- Overpass wird nur vom Server abgefragt; höchstens ~30 Vorschläge, nächste zuerst, `access=private|no` ausgeschlossen, Treffer 1 Tag gemerkt.
- Schriften/Symbole nur lokal; nichts von Google. Neue Symbole nur, wenn sie schon in `public/icons.svg` sind.
- **Kein Commit ohne „Commit und Push“ des Nutzers.** Dann beide Repos (siehe Memory `beide-repos-pushen`).
- README, Anleitung in der App (`#howTpl`, Regeltexte) und `public/datenschutz.html` mitpflegen.

## Review Focus

- Hintergrund-Ortung (OwnTracks) schickt Positionen nur alle ~20 s oder bei Bewegung: Wer still im Kreis steht, muss die Mission trotzdem schaffen können (Test in Task 2).
- Hider mit offenem Angebot oder laufender Mission verlässt das Spiel / wird entfernt: Angebot geht weiter bzw. Kreis verschwindet bei den Jägern (Test in Task 2).
- Spielleiter wählt Checkpoints und verschiebt danach die Zone: Checkpoints außerhalb der Zone werden nie angeboten und zählen nicht zu den nötigen 3 (Test in Task 1 und 2).
- Runde endet oder „Zurück zur Lobby“ mitten in einer Mission: In der nächsten Runde ist nichts davon übrig (Test in Task 2).
- Viele Hider (25) und wenige Checkpoints: nie zwei Missionen am selben Ort, kein Absturz, wenn kein Ziel passt (Test in Task 2).

---

### Task 1: Einstellungen und Rechenregeln

**Files:**
- Create: `server/missions.js`
- Modify: `server/game.js` (`DEFAULT_SETTINGS`, `sanitizeSettings`, `start`, `view` → `settings`)
- Modify: `public/first-time.js` (`missionsMode: 'off'`)
- Test: `test/smoke.js` (neue Funktion `missionRuleTests()`, im Ablauf vor `serverTest` aufrufen)

**Interfaces:**
- Produces (in `server/missions.js`):
  - `export const MISSION_MODES = ['off', 'rare', 'often']`
  - `export const MISSION = { everyMs: { rare: 12*MIN, often: 6*MIN }, firstAfterMs: 5*MIN, quietBeforeEndMs: 10*MIN, offerMs: 60_000, holdMs: 30_000, radiusM: 35, minDistM: 300, maxDistM: 900, maxActive: 2, maxOffersPerSlot: 3, declineCooldownMs: 5*MIN, maxCheckpoints: 20, minCheckpoints: 3, staleMs: 45_000 }`
  - `export function missionTimeMs(distanceM: number): number`
  - `export function missionReward(distanceM: number, rand = Math.random): 'decoy'|'cloak'|'radar'`
  - `export function sanitizeCheckpoints(list: unknown, zone: {lat,lng,radius}): Array<{id: string, name: string, lat: number, lng: number}>` – verwirft Einträge ohne gültige Koordinaten oder außerhalb der Zone, Name getrimmt auf 40 Zeichen (leer → „Checkpoint“), `id` aus Eingabe behalten wenn `/^[\w-]{1,40}$/`, sonst neu erzeugen; höchstens 20; doppelte `id` raus.
  - `export function checkpointsInZone(settings): Array<...>` – die Checkpoints, die in `settings.zone` liegen.
- Produces (Settings): `DEFAULT_SETTINGS.missionsMode = 'off'`, `DEFAULT_SETTINGS.checkpoints = []`.

- [ ] **Step 1: Write the failing test** `missionRuleTests()` in `test/smoke.js`:

```js
assert.equal(missionTimeMs(650), 8 * MIN);
assert.equal(missionTimeMs(300), 5 * MIN);
assert.equal(missionTimeMs(900), 9 * MIN);
assert.equal(missionReward(499, () => 0), 'decoy');
assert.ok(['cloak', 'radar'].includes(missionReward(500, () => 0)));
assert.ok(['cloak', 'radar'].includes(missionReward(800, () => 0.99)));
const zone = { lat: VS.lat, lng: VS.lng, radius: 1000 };
const far = { lat: VS.lat + 0.05, lng: VS.lng, name: 'weit weg' };
const cps = sanitizeCheckpoints([{ id: 'a', name: '  Marktplatz ', lat: VS.lat, lng: VS.lng }, far, { lat: 'x' }, { id: 'a', lat: VS.lat, lng: VS.lng }], zone);
assert.deepEqual(cps.map((c) => [c.id, c.name]), [['a', 'Marktplatz']]);
assert.equal(sanitizeCheckpoints(Array.from({ length: 30 }, (_, i) => ({ lat: VS.lat, lng: VS.lng, name: `P${i}` })), zone).length, 20);
// Settings
const g = new Game('MISS'); const host = g.addPlayer('Leiter'); const lea = g.addPlayer('Lea');
g.updateSettings(host.id, { missionsMode: 'often', checkpoints: cps });
assert.equal(g.settings.missionsMode, 'often');
g.updateSettings(host.id, { missionsMode: 'quatsch' });
assert.equal(g.settings.missionsMode, 'often');
assert.deepEqual(g.view(lea.id).settings.checkpoints, [], 'Mitspieler sehen die Checkpoints nicht');
assert.equal(g.view(host.id).settings.checkpoints.length, 1);
// Start braucht 3 Checkpoints in der Zone
g.setRole(host.id, host.id, 'hunter');
assert.throws(() => g.start(host.id), /mindestens 3 Checkpoints/);
g.updateSettings(host.id, { missionsMode: 'off' });
g.start(host.id); // ohne Missionen egal
```

- [ ] **Step 2: Run** `node test/smoke.js` — Expected: FAIL (Import von `server/missions.js` fehlt).
- [ ] **Step 3: Implement** `server/missions.js` (Interfaces oben; Entfernung mit `distanceM` aus `server/game.js` – falls Zirkel-Import stört, die Haversine-Funktion in `missions.js` definieren und von `game.js` importieren lassen). In `sanitizeSettings`: `missionsMode` nur aus `MISSION_MODES`; `checkpoints` nur wenn `input.checkpoints !== undefined`, dann `sanitizeCheckpoints(input.checkpoints, s.zone)` (nach der Zonen-Verarbeitung). In `start()`: wenn `missionsMode !== 'off'` und `checkpointsInZone(s).length < 3` → `throw new GameError('Für Missionen braucht es mindestens 3 Checkpoints im Spielfeld. Wähle sie in Schritt 3 aus oder stell Missionen aus.')`. In `view()`: für Nicht-Spielleiter `checkpoints: []` (neben `finalCenter: null`). `public/first-time.js`: `missionsMode: 'off'` in `FIRST_TIME_SETTINGS` (der vorhandene Test für erstmalige Einstellungen prüft alle Schlüssel – dort ergänzen).
- [ ] **Step 4: Run** `npm test` — Expected: alle Tests grün, neu „✓ Missionen: Regeln“.
- [ ] **Step 5:** Kein Commit (erst auf Ansage des Nutzers).

### Task 2: Missionen im Spiel (Server)

**Files:**
- Modify: `server/missions.js`
- Modify: `server/game.js` (Konstruktor, `start`, `backToLobby`, `removePlayer`, `tick`, `markCaught`, `view`, `archiveRecord`, `runEvent` 'swap' nicht nötig)
- Modify: `server/index.js` (Socket-Handler `'mission'`)
- Test: `test/smoke.js` (neue Funktion `missionFlowTests()`), `test/archive.js` (Archiv-Feld)

**Interfaces:**
- Consumes: alles aus Task 1.
- Produces (in `server/missions.js`, alle mit `game: Game`, `now: number`):
  - `resetMissions(game, now)` – setzt `game.missions = { nextAt, offers: [], active: [], cooldown: {} }`; `nextAt = huntStartAt + firstAfterMs` (bei `off`: `Infinity`).
  - `missionsTick(game, now)` – Rhythmus, Angebote ablaufen lassen/weitergeben, Kreis-Zeit messen, Erfolg, Zeit um.
  - `respondMission(game, playerId, offerId, accept, now)` → `{}` oder `throw GameError`.
  - `missionsZoneChange(game, zone: {lat,lng,radius}, now)` – bricht Angebote/Missionen mit Ziel außerhalb `zone` ohne Strafe ab.
  - `missionsDropPlayer(game, playerId, reason: 'caught'|'left', now)`.
  - `missionsView(game, me, now)` → `{ offer, mission, targets }` (siehe unten).
  - `penaltyPing(game, p, now)` – siehe Step 3.
- Datenform: Angebot `{ id, hiderId, checkpointId, distanceM, timeMs, reward, until, slot }`; Mission `{ id, hiderId, checkpointId, reward, until, inSince: number|null }`; `slot` zählt die Angebote eines Platzes (1–3).
- Socket: `handle(socket, 'mission', ({ id, accept }) => respondMission(game, player.id, id, Boolean(accept), Date.now()))`.
- View: `view.me.missionOffer = { id, name, distanceM, timeMs, reward, until } | null`; `view.me.mission = { id, name, lat, lng, radius, until, reward, inMs } | null` (`inMs` = Zeit im Kreis bisher); `view.missions = [{ id, name, lat, lng, radius, until, hider? }]` nur für `seesAsHunter(me)` (Zuschauer zusätzlich `hider: name`), sonst `[]`.
- Archiv: `archiveRecord().data.missions = [{ name, checkpoint, result: 'done'|'failed'|'caught'|'cancelled'|'left', atMin }]`, `data.settings.missionsMode`; `roundLog`-Einträge `{ kind: 'mission', name, checkpoint, result, at }` beim Ende jeder angenommenen Mission.

- [ ] **Step 1: Write the failing tests** `missionFlowTests()` mit einem Aufbau wie `eventTests().setup` (5 Spieler, 2 Jäger, `headStartMin: 0`, `missionsMode: 'often'`, 4 Checkpoints in 300–900 m, `pingTrail: 3`), Zeit über `g.tick(t)` und `respondMission(..., t)` steuern. Fälle mit diesen Assertions:
  1. Vor `huntStartAt + 5 min` kein Angebot; bei `+5 min` genau ein `missionOffer` bei einem Hider, `until = t + 60 s`; Jäger sehen `missions = []`.
  2. Annehmen → `missionOffer` weg, `mission` da, `until = t + missionTimeMs(distanceM)`; Jäger-View `missions.length === 1` ohne `hider`; anderer Hider sieht `missions = []`.
  3. Position im Kreis bei `t`, Tick bei `t + 29 s` → noch läuft; Tick bei `t + 30 s` (Position unverändert, `pos.t = t`) → Mission weg, Hider hat Belohnungs-Joker, `roundLog` enthält `result: 'done'`. (Deckt OwnTracks-Lücken ab: keine neue Position nötig, solange die letzte ≤ 45 s alt und im Kreis ist.)
  4. Position im Kreis, dann außerhalb, dann wieder im Kreis → Zählung beginnt neu.
  5. Zeit um mit `cloakNext = true` → neuer Eintrag in `g.pings` mit echter Position und `penalty: true`, Jäger-View zeigt den Hider als `kind: 'ping'`, `cloakNext` bleibt `true`; mit `shieldUntil > t` → kein Strafe-Ping.
  6. Ablehnen → neues Angebot an einen **anderen** Hider (`slot: 2`); der Ablehnende bekommt 5 min lang keins; nach 3 abgelehnten Angeboten verfällt der Platz.
  7. Zwei Plätze voll (2 Missionen/Angebote) → kein drittes Angebot; nie zwei mit derselben `checkpointId` (Schleife über 50 Runden mit nur 2 passenden Checkpoints).
  8. Keine neuen Angebote, wenn `endAt - t < 10 min`.
  9. Zonenstufe angekündigt, Ziel liegt außerhalb des neuen Kreises → Mission weg ohne Strafe-Ping, Meldung „Ziel liegt bald außerhalb der Zone, Mission ohne Strafe beendet“ an den Hider; `shrinkWarnMin: 0` → Abbruch beim Anwenden der Stufe.
  10. Hider mit Mission wird gefangen (`markCaught`) → Jäger-`missions` leer, `roundLog` `result: 'caught'`; Hider mit Angebot verlässt das Spiel (`removePlayer`) → Angebot geht an anderen Hider.
  11. Checkpoint außerhalb der Zone (Zone nach Auswahl verschoben) wird nie angeboten.
  12. Kein passender Checkpoint für irgendeinen Hider → kein Angebot, kein Fehler, `nextAt` rückt weiter.
  13. `backToLobby` und neuer `start` → `missions.offers/active` leer.
  14. `respondMission` mit fremder/abgelaufener `id` → `GameError('Dieses Angebot gilt nicht mehr.')`.
  In `test/archive.js` (`recordTests`): eine geschaffte Mission erscheint in `data.missions` mit `result: 'done'`.
- [ ] **Step 2: Run** `node test/smoke.js` — Expected: FAIL.
- [ ] **Step 3: Implement.** Hinweise zu dem, was Tests nicht festlegen:
  - Rhythmus: bei `now >= nextAt` immer `nextAt += everyMs[mode]`; nur wenn `offers.length + active.length < 2` und `endAt - now >= 10 min` einen neuen Platz mit `slot: 1` öffnen.
  - Angebot wählen: Hider zufällig mischen; Kandidat = frei, Rolle hider, `pos` jünger als 45 s, kein Angebot/keine Mission, nicht im Cooldown, nicht schon in diesem Platz gefragt. Ziel = zufällig aus Checkpoints in `currentZone(now)` **und** (falls angekündigt) `nextZone(now)`, nicht belegt, 300–900 m entfernt. Erster Hider mit Ziel bekommt das Angebot. Für „nicht schon gefragt“ trägt das Angebot `asked: [ids]` weiter.
  - Kreis-Zeit: `inside = pos && now - pos.t <= 45 s && distanceM(pos, cp) <= 35`; beim ersten `inside` `inSince = pos.t`; nicht `inside` → `inSince = null`; Erfolg bei `now - inSince >= 30 s`.
  - `penaltyPing(game, p, now)`: Eintrag `{ id, lat, lng, t }` aus `p.pos`; `game.pings.push({ at: now, penalty: true, entries: [entry] })`; `game.lastPing = { ...(game.lastPing ?? { at: now, byName: null }), entries: [...(alte Einträge ohne p), entry] }` (neues Objekt, das alte in `pings` bleibt unverändert, damit die Spur stimmt). `cloakNext`/`decoyNext` nicht verbrauchen.
  - Meldungen (über `game.emit`): Angebot an Hider `🎯 Neue Mission für dich! …` mit `sound: 'event'`; angenommen an Jäger `🎯 Ein Hider hat eine Mission zum Checkpoint „<Name>“ angenommen!`; geschafft an alle `🎯 Mission geschafft! Ein Hider hat „<Name>“ erreicht.` und an den Hider die Belohnung; Zeit um an Hider `⏱️ Zeit um! Du wurdest zur Strafe angepingt.`, an Jäger `⏱️ Mission gescheitert – Strafe-Ping!`.
  - `tick`: `missionsTick` nur in Phase `hunt`; bei `st.warned = true` und bei `st.applied = true` `missionsZoneChange(game, st, now)` aufrufen. `markCaught` → `missionsDropPlayer(..., 'caught')`; `removePlayer` → `'left'`. `start` → `resetMissions`.
- [ ] **Step 4: Run** `npm test` — Expected: grün, neu „✓ Missionen: Ablauf“.
- [ ] **Step 5:** Kein Commit.

### Task 3: Vorschläge aus OpenStreetMap (Overpass)

**Files:**
- Create: `server/places.js`
- Modify: `server/index.js` (Route `GET /api/places`)
- Create: `test/places.js`; Modify: `package.json` (`npm test` um `node test/places.js` ergänzen)
- Modify: `public/datenschutz.html` (Abschnitt 7 „Ortssuche“ um Overpass ergänzen), README (Aufbau)

**Interfaces:**
- Produces: `export function createPlaceFinder({ fetchImpl = fetch, minIntervalMs = 1000, cacheMs = 24*60*60*1000 } = {})` → `{ find({ lat, lng, radius }): Promise<Array<{ name: string, kind: string, lat: number, lng: number }>> }` – höchstens 30, nach Abstand zum Mittelpunkt sortiert.
- Route: `GET /api/places?lat=&lng=&radius=` → 200 JSON-Liste; 400 bei ungültigen Zahlen oder `radius` außerhalb 100–6000; 429 bei mehr als 10 Anfragen pro Minute und IP (dieselbe Zählung wie `/api/geocode` wiederverwenden); 502 wenn Overpass nicht antwortet.

- [ ] **Step 1: Write the failing test** `test/places.js` mit `fakeFetch` wie in `test/geocode.js`. Assertions:
  - Anfrage geht per `POST` an `https://overpass-api.de/api/interpreter`, `User-Agent` enthält `Manhunt`, Abfrage enthält `around:<radius>,<lat>,<lng>` und die Merkmale `place=square`, `leisure=playground`, `amenity=place_of_worship`, `amenity=fountain`, `historic=monument|memorial`, `leisure=park`.
  - Antwort mit Knoten (`lat/lon`) und Wegen (`center.lat/lon`) wird zu `{ name, kind, lat, lng }`; ohne Namen → Name = Art auf Deutsch („Spielplatz“, „Brunnen“, „Kirche“, „Platz“, „Denkmal“, „Park“); `access=private` und `access=no` fallen raus; gleicher Name innerhalb 50 m nur einmal; Ergebnis nach Abstand sortiert, höchstens 30.
  - Zweite gleiche Anfrage (gleiche gerundete Mitte und Radius) kommt aus dem Zwischenspeicher.
  - Fehler von Overpass wird als Fehler weitergegeben und nicht gespeichert.
  - In `test/archive.js` `httpTests`: `/api/places` ohne Zahlen → 400, `radius=50` → 400 (ohne Anfrage ins Internet).
- [ ] **Step 2: Run** `node test/places.js` — Expected: FAIL.
- [ ] **Step 3: Implement** nach dem Muster von `server/geocode.js` (Warteschlange, Mindestabstand, Cache-Schlüssel aus Mitte auf 3 Nachkommastellen + Radius, `AbortSignal.timeout(15000)`). Abfrage: `[out:json][timeout:15];( nwr[...](around:R,LAT,LNG); … );out center tags 200;`. Datenschutz-Text: Suchdienst Overpass (betrieben von der FOSSGIS e. V., Deutschland), Anfrage kommt vom Server, keine IP-Adressen der Spieler, Treffer bis 1 Tag gemerkt.
- [ ] **Step 4: Run** `npm test` — Expected: grün.
- [ ] **Step 5:** Kein Commit.

### Task 4: Checkpoints auswählen beim Einrichten

**Files:**
- Create: `public/checkpoints.js`
- Modify: `public/index.html` (Karte „Missionen“ in Schritt 3 nach „Special Events“), `public/app.js` (Segment, Knopf, Regel-Zusammenfassung `renderRules`, Speicher), `public/style.css`

**Interfaces:**
- Consumes: `GET /api/places` (Task 3), `settings.missionsMode/checkpoints` (Task 1), `saveSettings`, `makeMap`, `openModal`/`closeModal`, `store` aus `public/app.js`.
- Produces: `export function openCheckpointPicker({ zone, chosen, makeMap, openModal, closeModal, onSave })` in `public/checkpoints.js`; `onSave(list)` bekommt `[{ id, name, lat, lng }]`. Speicher-Schlüssel `manhunt-checkpoints` = `{ "<lat 3 Stellen>,<lng 3 Stellen>,<radius>": [...] }`.

- [ ] **Step 1: Karte in Schritt 3:** Segment `#missionsSeg` (`data-missions="off|rare|often"`, Untertitel „keine“, „ca. alle 12 min“, „ca. alle 6 min“), Hinweis „Ein Hider bekommt ab und zu ein Angebot: zu einem Checkpoint laufen und 30 s dort bleiben. Die Jäger sehen das Ziel. Geschafft = Joker, Zeit um = Strafe-Ping.“, darunter Knopf `#checkpointsBtn` „Checkpoints auswählen (N gewählt)“ nur wenn nicht `off`; bei N < 3 als Warnung „Noch mindestens 3 Checkpoints auswählen“. Wählt der Spielleiter `rare/often` und `settings.checkpoints` ist leer, aber für diese Zone liegt eine gespeicherte Liste vor → mit `saveSettings({ missionsMode, checkpoints })` übernehmen; ist keine gespeichert → Auswahlfenster direkt öffnen.
- [ ] **Step 2: Auswahlfenster** `openCheckpointPicker`: großes Modal mit Karte (Zone eingezeichnet), lädt `/api/places`, Vorschläge grau, gewählte grün, Liste darunter mit Name, Art, Häkchen; Tippen auf Punkt oder Listeneintrag schaltet um. „Eigenen Punkt setzen“: nächster Tipp auf die Karte setzt einen Punkt, Name per Eingabefeld (Standard „Eigener Punkt N“), eigene Punkte lassen sich wieder entfernen. Bei Fehler der Suche: Hinweis „Vorschläge gerade nicht verfügbar – du kannst eigene Punkte setzen.“ Höchstens 20 gewählte (weiteres Antippen → kurzer Hinweis). „Fertig“ → `onSave`, Liste unter dem Zonen-Schlüssel speichern, `closeModal`.
- [ ] **Step 3: Regel-Zusammenfassung** (`renderRules`): Zeile „Missionen: selten (alle ~12 min), 6 Checkpoints“ bzw. „oft“; bei `off` keine Zeile.
- [ ] **Step 4: Prüfen im Browser** (`preview_start` „manhunt-dev“, Handygröße 375×812): Missionen auf „oft“ → Fenster öffnet, Vorschläge erscheinen (oder Hinweis bei Fehler), 3 wählen + 1 eigener Punkt, Fertig → Knopf zeigt „(4 gewählt)“; neu laden, neues Spiel, gleiche Zone, „oft“ → Auswahl ist wieder da; Mitspieler-Handy (zweiter Tab) sieht keine Checkpoints; Start mit 2 Checkpoints → Fehlermeldung aus Task 1. Konsole ohne Fehler. `npm test` grün.
- [ ] **Step 5:** Kein Commit.

### Task 5: Missionen im Spiel anzeigen, Bisherige Spiele, Anleitung

**Files:**
- Modify: `public/app.js` (Angebotskarte, eigene Mission, Kreise für Jäger, Banner, Klick-Aktionen), `public/style.css`, `public/index.html` (`#howTpl`), `public/history.js` (Details), `README.md`

**Interfaces:**
- Consumes: `view.me.missionOffer`, `view.me.mission`, `view.missions` (Task 2); Socket `'mission'` `{ id, accept }`.

- [ ] **Step 1: Hider – Angebot:** Karte über dem Dock (wie Streitfall-Hinweise) mit Ziel, Entfernung, Zeitlimit, Belohnung (Joker-Name), Hinweis „Die Jäger sehen das Ziel!“, Countdown bis `until`, Knöpfe „Annehmen“ / „Ablehnen“ → `send('mission', { id, accept })`, Fehler als Toast.
- [ ] **Step 2: Hider – eigene Mission:** Zielmarker + Kreis (Radius aus View) auf der Spielkarte, Banner „Mission: <Name> · noch m:ss · im Kreis 0:12 / 0:30“ (Priorität über normalen Hinweisen, höchstens 2 Kurzmeldungen bleiben), Pfeil/Entfernung zum Ziel wie beim Kompass, falls einfach möglich.
- [ ] **Step 3: Jäger/Zuschauer:** Für jedes `view.missions` ein Kreis in Ping-Gelb mit Label „Mission · m:ss“ (Zuschauer zusätzlich Name); verschwindet, wenn die Mission aus der View fällt.
- [ ] **Step 4: Bisherige Spiele:** in `history.js` Karte „Missionen“ mit Zeilen „<Name> → <Checkpoint>: geschafft/gescheitert/gefangen/abgebrochen/verlassen · <atMin> min“ (nur wenn `d.missions?.length`); `rulesLine` ergänzt „Missionen: selten/oft“.
- [ ] **Step 5: Anleitung und README:** `#howTpl` und Regeltexte um einen kurzen Absatz Missionen; README: Abschnitt „Missionen“ unter Spielregeln (Ablauf, Einstellungen, Checkpoints auswählen) und Aufbau (`server/missions.js`, `server/places.js`, `public/checkpoints.js`).
- [ ] **Step 6: Prüfen im Browser** mit Dev-Server und Testhelfer (Spiel per Skript erstellen, Tester als Hider, Missionen „oft“, `headStartMin: 0`; für die Prüfung Zeit verkürzen, z. B. über `ALLOW_SIM` und Position per Klick setzen): Angebot erscheint, Annehmen → Kreis auf eigener Karte, im Jäger-Tab Kreis ohne Namen; Position in den Kreis setzen → nach 30 s „Mission geschafft!“ und neuer Joker; zweites Angebot ablehnen → verschwindet; Handygröße 375×812, Konsole ohne Fehler. `npm test` grün.
- [ ] **Step 7:** Kein Commit; dem Nutzer berichten und auf „Commit und Push“ warten (dann beide Repos).
