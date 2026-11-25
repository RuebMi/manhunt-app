# Bisherige Spiele – Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Runden ab 20 Minuten werden dauerhaft gespeichert und sind über die Seite „📜 Bisherige Spiele“ mit dem Spielleiter-Passwort samt Routen-Karte abrufbar.

**Architecture:** `Game.end()` erzeugt einen fertigen Datensatz (`pendingArchive`). `server/index.js` reicht ihn in `flush()` an einen neuen Speicher-Baustein `server/archive.js` weiter, der online Neon-Postgres (`pg`) und lokal eine JSON-Datei nutzt. Zwei passwortgeschützte HTTP-Adressen liefern Liste und Details an die neue Seite `public/history.js`.

**Tech Stack:** Node ≥ 20 (ES-Module), Express 5, Socket.IO 4, `pg`, Leaflet 1.9.4, Tests mit `node:assert` ohne Testframework.

**Spec:** `docs/superpowers/specs/2026-11-10-bisherige-spiele-design.md`

## Global Constraints

- Mindestdauer: 20 Minuten ab `timers.startedAt` (inklusive Vorsprung); per `ARCHIVE_MIN_MINUTES` überschreibbar (nur für Tests/Entwicklung, Standard `20`).
- Abgebrochene Runden (`end(null, …)`) zählen, wenn lang genug.
- Nie im Datensatz: Crush, Fang-Codes, Spieler-IDs, Tokens, Chat.
- Routen: Koordinaten auf 5 Nachkommastellen, Zeit in Sekunden ab `startedAt`, Punkte < 10 m zum zuletzt behaltenen weglassen, letzter Punkt bleibt immer.
- Strecke: wie bisher `trailDistance` im Client – Segmente mit mehr als 8 m/s werden ignoriert; aus den **unvereinfachten** Punkten berechnet.
- Passwort: dieselbe Prüfung wie beim Erstellen (`CREATE_PASSWORD`, Groß-/Kleinschreibung egal). Header `X-Password`. Höchstens 5 Fehlversuche pro Minute und IP, dann 429.
- Online-Speicher nur, wenn `DATABASE_URL` gesetzt ist; sonst Datei `ARCHIVE_FILE` (Standard `data/archive.json`) und beim Start der Log-Hinweis `⚠️ Keine DATABASE_URL: bisherige Spiele werden nur lokal in <Pfad> gespeichert.`
- Alle Texte auf Deutsch, Stil wie im Rest der App.

## Review Focus

1. **Datenbank nicht erreichbar:** Speichern darf den Server nie zum Absturz bringen; der Datensatz bleibt in der Warteschlange und wird wiederholt → Test in Task 2 (`save` auf unbeschreibbaren Pfad).
2. **Spieler ohne GPS:** leere Route → `distanceM: 0`, `trails[name]: []`, kein Fehler → Test in Task 1.
3. **Alter Spielstand nach Update:** Ein Spiel aus `data/games.json` ohne `roundLog` endet nach dem Update → Datensatz trotzdem erzeugt, `jokersUsed: []` → Test in Task 1.
4. **Namen mit HTML-Zeichen** (z. B. `<b>Lea</b>`) erscheinen auf der Seite als Text, nicht als HTML → Prüfschritt im Browser in Task 4.
5. **Passwort im Handy veraltet** (z. B. nach Änderung von `CREATE_PASSWORD`): Seite zeigt wieder das Passwortfeld mit Fehlermeldung statt einer leeren Liste → Prüfschritt im Browser in Task 4.

---

### Task 1: Datensatz einer Runde in `Game`

**Files:**
- Modify: `server/game.js` (Konstruktor, `start()`, `end()`, `useJoker()`, `runEvent()`, neue Funktionen)
- Create: `test/archive.js`
- Modify: `package.json` (`"test": "node test/smoke.js && node test/archive.js"`)

**Interfaces:**
- Produces:
  - `export const ARCHIVE_MIN_MS: number` – `Number(process.env.ARCHIVE_MIN_MINUTES ?? 20) * 60_000`
  - `export function simplifyTrail(trail: [lat, lng, tMs][], startedAt: number): [lat, lng, tSec][]`
  - `export function trailDistanceM(trail: [lat, lng, tMs][]): number` (gerundet auf ganze Meter)
  - `Game#archiveRecord(now: number): { summary, data }` mit
    - `summary = { id, code, round, startedAt, endedAt, durationMin, winner, reason, playerCount, hunterCount, hiderCount }`, `id = \`${code}-${round}-${startedAt}\``, `durationMin` auf ganze Minuten gerundet, Zählung nach `startRole`
    - `data = { ...summary, settings, players, jokersUsed, events, trophies, trails }`
    - `settings`: `durationMin, headStartMin, pingIntervalMin, outGraceSec, zone, shrink, shrinkSteps, finalRadius, finalMode, finalCenter, catchRule, eventsMode, infection, hiderJokers, hunterExtraPings, hunterDrones, hunterSniffs`
    - `players: [{ name, startRole, endRole, status, caughtBy, caughtAfterMin, distanceM, trophy }]` – `caughtAfterMin` ab `huntStartAt`, 1 Nachkommastelle, sonst `null`; `trophy` = `'hunter' | 'hider' | null` aus `result.trophies`
    - `jokersUsed: [{ name, type, atMin }]`, `events: [{ type, atMin }]` – `atMin` ab `startedAt`, 1 Nachkommastelle
    - `trophies: [{ name, why }]`, `trails: { [name]: simplifyTrail(...) }`
  - `Game#pendingArchive: { summary, data } | null` – in `end()` gesetzt, wenn `now - timers.startedAt >= ARCHIVE_MIN_MS`
  - `Game#roundLog: { kind: 'joker' | 'event', name?, type, at }[]` – in `start()` geleert

- [ ] **Step 1: Tests schreiben** in `test/archive.js` (Stil wie `test/smoke.js`: Funktionen mit `assert`, am Ende aufrufen, `console.log('✓ …')`):
  - `recordTests()`: Spiel mit Host (Jäger), Hider `Lea`, Hider `Max` ohne GPS; Crush Host+Lea; `start()`; `g.timers.startedAt -= 21 * 60_000`; Lea bekommt drei Positionen (0 m, 5 m, 400 m nördlich, je 60 s auseinander, über `updatePos` mit `t`); Host setzt `extraPing`; `g.runEvent('fog')`; Host fängt Max; `forceEnd`.
    - `assert.ok(g.pendingArchive)`; `summary.winner === null`; `summary.durationMin >= 21`; `summary.hiderCount === 2`
    - `JSON.stringify(g.pendingArchive)` enthält weder `catchCode`-Werte noch Spieler-IDs noch `crush`
    - `data.players.find(p => p.name === 'Max')`: `status === 'caught'`, `caughtBy === 'Host'`, `distanceM === 0`; `data.trails.Max` ist `[]`
    - `data.trails.Lea`: kein Punkt < 10 m zum vorherigen, letzter Punkt ≈ 400 m nördlich, Koordinaten mit ≤ 5 Nachkommastellen, Zeit in Sekunden
    - `data.jokersUsed` enthält `{ name: 'Host', type: 'extraPing' }`; `data.events` enthält `{ type: 'fog' }`
  - `shortRoundTests()`: Runde, die nach 19 Minuten endet → `pendingArchive` ist `null`.
  - `oldSaveTests()`: laufendes Spiel → `Game.fromJSON(JSON.parse(JSON.stringify(g)))`, `delete restored.roundLog`, `startedAt` 21 min zurück, `forceEnd` → Datensatz mit `jokersUsed: []`.
  - `distanceTests()`: `trailDistanceM` ignoriert einen 1-km-Sprung in 10 s, zählt 100 m in 60 s.
- [ ] **Step 2:** `node test/archive.js` → schlägt fehl (`archiveRecord`/`simplifyTrail` nicht definiert).
- [ ] **Step 3: Umsetzen** in `server/game.js`:
  - `roundLog` im Konstruktor `[]`, in `start()` leeren; in `fromJSON` fehlendes `roundLog` als `[]`.
  - `useJoker` in `applyJoker(id, type)` umbenennen; neues `useJoker` ruft es auf und hängt danach `{ kind: 'joker', name, type, at }` an (nur bei Erfolg).
  - `runEvent`: nach erfolgreichem Auslösen `{ kind: 'event', type, at }` anhängen.
  - `end()`: nach `this.result = …` den Datensatz setzen, sonst `pendingArchive = null`.
  - `trailDistanceM`: Logik aus `trailDistance` in `public/app.js` übernehmen (Client bleibt unverändert).
- [ ] **Step 4:** `npm test` → alles grün, inklusive `✓ Datensatz`, `✓ Kurze Runde`, `✓ Alter Spielstand`, `✓ Strecke`.
- [ ] **Step 5: Commit** `git add server/game.js test/archive.js package.json && git commit -m "Datensatz für bisherige Spiele am Rundenende"`

### Task 2: Speicher-Baustein `server/archive.js`

**Files:**
- Create: `server/archive.js`
- Modify: `test/archive.js`, `package.json` (Abhängigkeit `pg`)

**Interfaces:**
- Consumes: Datensatz `{ summary, data }` aus Task 1
- Produces: `export async function createArchive({ databaseUrl?: string, file: string, retryMs = 60_000, maxRetries = 60 }): Promise<Archive>` mit
  - `save(record): void` – wirft nie; bei Fehler in Warteschlange, Wiederholung alle `retryMs`, höchstens `maxRetries`-mal, dann `console.error`
  - `list(): Promise<summary[]>` – neueste zuerst (`endedAt` absteigend), ohne `trails`
  - `get(id: string): Promise<data | null>`
  - `pending(): number` – Länge der Warteschlange (für Tests)
  - `close(): Promise<void>`
  - `kind: 'postgres' | 'file'`
- Postgres: `pg` per dynamischem `import('pg')`, `Pool` mit `ssl: { rejectUnauthorized: false }` wenn die URL `sslmode=require` enthält oder auf `neon.tech` zeigt; beim Start `create table if not exists rounds (id text primary key, ended_at timestamptz not null, summary jsonb not null, data jsonb not null)`; `insert … on conflict (id) do nothing`.
- Datei: JSON-Array vollständiger Datensätze `{ summary, data }`, atomar schreiben (temporäre Datei + `rename`), Schreibvorgänge nacheinander (Promise-Kette), doppelte `id` ignorieren.

- [ ] **Step 1: Tests** in `test/archive.js`, Funktion `storageTests()` (async):
  - Datei-Archiv in `os.tmpdir()`: zwei Datensätze speichern (ältere zuerst), kurz warten bis geschrieben; `list()` → Länge 2, neueste zuerst, `'trails' in list()[0] === false`; `get(id)` liefert `trails`; `get('gibtsnicht') === null`; gleiche `id` nochmal speichern → weiterhin 2.
  - Neues Archiv auf derselben Datei → `list()` liefert dieselben 2 (übersteht Neustart).
  - Unbeschreibbarer Pfad (eine Datei als Verzeichnis benutzen, z. B. `<tmp>/datei.txt/archive.json`) mit `retryMs: 50, maxRetries: 2`: `save()` wirft nicht, `pending() === 1` direkt danach, nach ~300 ms `pending() === 0` und kein ungefangener Fehler.
- [ ] **Step 2:** `node test/archive.js` → schlägt fehl (`createArchive` fehlt).
- [ ] **Step 3: Umsetzen** `server/archive.js` wie oben; `npm install pg` (fügt `pg` zu `dependencies` hinzu).
- [ ] **Step 4:** `npm test` → grün inklusive `✓ Speicher`.
- [ ] **Step 5: Commit** `git add server/archive.js test/archive.js package.json package-lock.json && git commit -m "Speicher für bisherige Spiele (Neon oder Datei)"`

### Task 3: Server-Anbindung und HTTP-Adressen

**Files:**
- Modify: `server/index.js`
- Modify: `test/archive.js`

**Interfaces:**
- Consumes: `createArchive` (Task 2), `Game#pendingArchive` (Task 1), vorhandenes `passwordOk(input)` in `server/index.js`
- Produces:
  - `GET /api/rounds` → `200 summary[]` | `401 { error }` | `429 { error }`
  - `GET /api/rounds/:id` → `200 data` | `404 { error }` | `401` | `429`
  - Fehlermeldungen: 401 `Falsches Passwort.`, 429 `Zu viele falsche Versuche. Warte eine Minute.`, 404 `Runde nicht gefunden.`

- [ ] **Step 1: Tests** in `test/archive.js`, Funktion `httpTests()` (async), Server wie in `test/smoke.js` per `spawn` starten, mit `PORT` 3998, eigenem `DATA_FILE`, eigenem `ARCHIVE_FILE` und `ARCHIVE_MIN_MINUTES=0`, ohne `DATABASE_URL`:
  - Über `socket.io-client` Spiel erstellen (Hauptpasswort aus `CREATE_PASSWORD`), zweiten Spieler beitreten lassen, Rollen setzen, `start`, `end`.
  - `fetch('/api/rounds')` ohne Header → 401; mit `X-Password: falsch` → 401; mit dem Hauptpasswort (klein geschrieben) → 200, Länge 1, `winner === null`.
  - `/api/rounds/<id>` → 200 mit `players` und `trails`; `/api/rounds/xyz` → 404.
  - Danach 5× falsches Passwort, dann richtiges → 429.
  - Server-Ausgabe enthält den Hinweis `Keine DATABASE_URL`.
- [ ] **Step 2:** `node test/archive.js` → schlägt fehl (404 auf `/api/rounds`).
- [ ] **Step 3: Umsetzen** in `server/index.js`:
  - `app.set('trust proxy', 1)`; `const archive = await createArchive({ databaseUrl: process.env.DATABASE_URL, file: process.env.ARCHIVE_FILE || path.join(ROOT, 'data', 'archive.json') })` vor `server.listen`; Log je nach `archive.kind` (Hinweistext aus Global Constraints).
  - In `flush(game)` ganz am Anfang: `if (game.pendingArchive) { archive.save(game.pendingArchive); game.pendingArchive = null; changedSinceSave = true; }`.
  - Middleware `requirePassword(req, res, next)` mit Fehlversuch-Zählung pro `req.ip` (Map ip → Zeitstempel der letzten Minute) vor beiden Routen.
- [ ] **Step 4:** `npm test` → grün inklusive `✓ HTTP`.
- [ ] **Step 5: Commit** `git add server/index.js test/archive.js && git commit -m "Bisherige Spiele: Speichern am Rundenende und passwortgeschützte Abfrage"`

### Task 4: Seite „Bisherige Spiele“

**Files:**
- Create: `public/history.js`
- Modify: `public/index.html` (Knopf in `#homeMenu`, neuer Abschnitt `<section id="history" hidden>`, `<script src="/history.js" type="module">`)
- Modify: `public/style.css`
- Modify: `.claude/launch.json` (zweite Konfiguration zum Testen)
- `public/app.js` bleibt unverändert.

**Interfaces:**
- Consumes: HTTP-Adressen aus Task 3; gespeichertes Passwort `localStorage['manhunt-host-pw']` (JSON-String, wie in `app.js`)
- Produces: `history.js` exportiert nichts; hängt selbst einen Klick-Listener für `[data-open="history"]` und `[data-history-back]` an.

- [ ] **Step 1: Umsetzen**
  - Knopf in `#homeMenu` nach „Neues Spiel erstellen“ mit `data-open="history"` (nicht `data-home`, das würde `showHomeStep()` in `app.js` auslösen): Icon `📜`, Titel „Bisherige Spiele“, Untertitel „Runden ab 20 Minuten ansehen“.
  - Öffnen versteckt `#home` und zeigt `#history`; „‹ Zurück“ macht das Umgekehrte.
  - Abschnitt `#history` mit „‹ Zurück“ (zur Startseite) und drei Zuständen:
    1. Passwort: Feld + „Anzeigen“; vorausgefüllt; bei 401 Meldung „Falsches Passwort.“ und gespeichertes Passwort löschen; bei 429 die Server-Meldung.
    2. Liste: Zeile „<Datum, Uhrzeit> · <Dauer> min · <🎯 Jäger gewinnen | 🏃 Hider gewinnen | 🏁 Abgebrochen> · <n> Spieler“, Datum mit `toLocaleString('de-DE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })`. Leer: „Noch keine Runden gespeichert. Runden ab 20 Minuten landen automatisch hier.“
    3. Details: Ergebnis + Grund, Lobby-Code, Regeln in einer Zeile, Liste der Spieler (Rolle, gefangen von … nach … min oder überlebt, Strecke, 🏆), eingesetzte Joker, Events, Leaflet-Karte (Kacheln wie `TILE_URL` in `app.js`, dunkel per vorhandener CSS-Klasse) mit Namens-Chips; Tipp auf einen Namen zeigt dessen Route, Start ist die längste Route. „‹ Zurück zur Liste“.
  - Alle Namen und Texte aus den Daten mit einer `esc()`-Funktion wie in `app.js` ausgeben.
  - Joker- und Event-Namen über eine kleine Tabelle in `history.js` (Icons und Namen wie `JOKERS`/`EVENTS` in `server/game.js`).
- [ ] **Step 2: Im Browser prüfen.** In `.claude/launch.json` eine zweite Konfiguration `manhunt-dev-archiv` anlegen: `runtimeExecutable` `/usr/bin/env`, `runtimeArgs` `["PORT=3001", "ALLOW_SIM=1", "ARCHIVE_MIN_MINUTES=0", "ARCHIVE_FILE=/tmp/manhunt-archiv-dev.json", "node", "--watch", "server/index.js"]`, `port` 3001. Mit `preview_start` starten, Bots mit `node test/bots.js <CODE> 1 http://localhost:3001`:
  - Runde mit Bot spielen und beenden → Liste zeigt sie.
  - Details: Spieler, Strecke, Joker, Karte mit wechselbarer Route.
  - Spieler mit Namen `<b>Lea</b>` erscheint als Text.
  - Falsches gespeichertes Passwort → Passwortfeld mit „Falsches Passwort.“.
  - Breite 375 px: nichts läuft seitlich über.
- [ ] **Step 3:** `npm test` → weiterhin grün.
- [ ] **Step 4: Commit** `git add public/history.js public/index.html public/style.css .claude/launch.json && git commit -m "Seite Bisherige Spiele mit Routen-Karte"`

### Task 5: Doku und Einrichtung

**Files:**
- Modify: `README.md`, `render.yaml`

- [ ] **Step 1:** README: neuer Abschnitt „Bisherige Spiele“ (was gespeichert wird, ab 20 Minuten, Passwort, Crush nie) und Unterabschnitt „Neon einrichten“ (Konto anlegen, Projekt in Region Frankfurt, Verbindungs-URL kopieren, bei Render unter Environment `DATABASE_URL` eintragen). Tabelle der Umgebungsvariablen um `DATABASE_URL`, `ARCHIVE_FILE`, `ARCHIVE_MIN_MINUTES` ergänzen. `npm test`-Beschreibung um „bisherige Spiele“ ergänzen.
- [ ] **Step 2:** `render.yaml`: `envVars` um `- key: DATABASE_URL` mit `sync: false` ergänzen (Wert wird im Dashboard gesetzt).
- [ ] **Step 3:** `npm test` → grün.
- [ ] **Step 4: Commit** `git add README.md render.yaml && git commit -m "Doku: bisherige Spiele und Neon"`

### Nach dem Plan (mit dem Nutzer)

- Nutzer richtet Neon ein und trägt `DATABASE_URL` bei Render ein; danach `git push`.
- Gemeinsam prüfen: Render-Log zeigt Postgres statt des Datei-Hinweises; eine echte Runde ≥ 20 min erscheint in der Liste.
