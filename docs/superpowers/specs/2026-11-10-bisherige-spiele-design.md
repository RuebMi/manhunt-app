# Bisherige Spiele – Design

Stand: 10.11.2026 · Status: vom Nutzer im Chat freigegeben, wartet auf Review dieses Dokuments

## Ziel

Der Spielleiter kann sich über die Website alle früheren Runden ansehen, die mindestens 20 Minuten liefen: Ergebnis, Fänge, Strecken, Pokale, Joker, Events und die Karte mit den Routen. Ohne Spielerprofile. Die Daten sollen später als Grundlage für Profil-Statistiken dienen (siehe Idee „Spielerprofile“).

## Entscheidungen

| Frage | Entscheidung |
|---|---|
| Wer darf die Seite sehen? | Nur mit dem Spielleiter-Passwort (`CREATE_PASSWORD`) |
| Routen speichern? | Ja, leicht vereinfacht, mit Karte in den Details |
| Ab wann zählt eine Runde? | Mindestens 20 Minuten ab „Spiel starten“ (inklusive Vorsprung) |
| Abgebrochene Runden? | Zählen, wenn sie mindestens 20 Minuten liefen |
| Crush speichern? | Nein, bleibt geheim |
| Speicher online | Neon (kostenlose Postgres-Datenbank) über das Paket `pg` |
| Speicher lokal / Tests | Datei `data/archive.json` |
| Alte Runden | Nicht nachholbar, die Liste beginnt leer |

Verworfen: Neons eigenes Paket (kein Vorteil auf einem dauerhaft laufenden Server); Runden als Dateien ins GitHub-Repo schreiben (jeder Commit löst bei Render einen Neubau aus und beendet laufende Spiele); Render-Festplatte (kostet Geld).

## Bausteine

### 1. `server/archive.js` (neu)

Ein Baustein mit genau drei Funktionen, unabhängig vom Spiel:

- `save(record)` – speichert eine Runde
- `list()` – kurze Zusammenfassungen aller Runden, neueste zuerst (ohne Routen)
- `get(id)` – eine Runde komplett, inklusive Routen

Zwei Umsetzungen hinter derselben Schnittstelle:

- **Postgres**, wenn `DATABASE_URL` gesetzt ist. Eine Tabelle, beim Start automatisch angelegt:
  `rounds (id text primary key, ended_at timestamptz, summary jsonb, data jsonb)`.
  `list()` liest nur `summary`, `get()` liest `data`.
- **Datei**, sonst. Schreibt atomar (temporäre Datei + Umbenennen), wie heute `saveGames()`.

Fehler beim Speichern: Der Datensatz kommt in eine Warteschlange im Arbeitsspeicher und wird jede Minute erneut versucht, höchstens 60-mal. Ein Neustart des Servers leert die Warteschlange; das ist akzeptiert.

### 2. Datensatz einer Runde (`Game.archiveRecord()`, neu in `server/game.js`)

Wird in `end()` erzeugt, wenn `end - timers.startedAt >= 20 min`, und als `this.pendingArchive` abgelegt. Jede Runde nur einmal (`id = <Code>-<Runde>-<startedAt>`).

```text
summary:  id, code, round, startedAt, endedAt, durationMin, winner, reason,
          playerCount, hunterCount, hiderCount
data:     summary + settings (Dauer, Vorsprung, Ping-Takt, Zone, Stufen,
          Fangregel, Events-Modus, Joker-Anzahlen, Endzone)
          players: [{ name, startRole, endRole, status, caughtBy, caughtAfterMin,
                      distanceM, trophy }]
          jokersUsed: [{ name, type, atMin }]
          events: [{ type, atMin }]
          trophies: [{ name, why }]
          trails: { <name>: [[lat, lng, tSek], ...] }
```

- Die Endzonen-Mitte darf gespeichert werden; die Seite ist ohnehin nur für den Spielleiter.
- **Neu zu erfassen:** eingesetzte Joker und ausgelöste Events. Beides wird heute nicht als Liste geführt. `useJoker()` und `runEvent()` hängen je einen Eintrag an `this.roundLog` an; `start()` leert die Liste.
- **Strecke:** gleiche Rechnung wie heute im Client (`trailDistance`, Sprünge über 8 m/s werden ignoriert), auf den Server verschoben.
- **Routen vereinfacht:** Koordinaten auf 5 Nachkommastellen (~1 m), Zeit in Sekunden ab Start, Punkte weniger als 10 m vom vorherigen weggelassen (der letzte Punkt bleibt immer).
- **Nicht gespeichert:** Crush, Fang-Codes, Spieler-IDs/Tokens, Chat.

### 3. Server-Anbindung (`server/index.js`)

- Nach jedem `flush()` und Tick: Hat ein Spiel einen `pendingArchive`, wird er an `archive.save()` übergeben und am Spiel gelöscht.
- Neue HTTP-Adressen, beide mit Passwort im Header `X-Password`:
  - `GET /api/rounds` → Liste der Zusammenfassungen
  - `GET /api/rounds/:id` → eine Runde
- Falsches Passwort → 401. Höchstens 5 falsche Versuche pro Minute und IP-Adresse (hinter Render: erste Adresse aus `X-Forwarded-For`), danach 429.
- Die Passwort-Prüfung (`passwordOk`) wird gemeinsam mit dem Erstellen eines Spiels genutzt.

### 4. Seite „Bisherige Spiele“ (`public/history.js` neu, `index.html`, `style.css`)

- Startseite: neuer Knopf **„📜 Bisherige Spiele“** unter den beiden bisherigen.
- Neuer Bildschirm mit drei Zuständen:
  1. **Passwort** – vorausgefüllt aus dem gespeicherten Spielleiter-Passwort; bei Erfolg direkt weiter.
  2. **Liste** – neueste zuerst, eine Zeile pro Runde: „12. Nov, 18:40 · 62 min · 🎯 Jäger gewinnen · 9 Spieler“. Leere Liste: freundlicher Hinweis, dass Runden ab 20 Minuten hier landen.
  3. **Details** – Ergebnis, Fänge, Strecken, Pokale, Joker, Events, Regeln und Karte mit den Routen (Tipp auf einen Namen wechselt die Route, wie auf dem Endbildschirm). „‹ Zurück“ zur Liste.
- Eigene Datei `public/history.js`, damit `app.js` nicht weiter wächst. Leaflet und die Kartenkacheln werden wie bisher genutzt.

### 5. Abhängigkeiten und Einrichtung

- Neue Abhängigkeit: `pg`.
- Render: Umgebungsvariable `DATABASE_URL` (aus Neon). Ohne sie läuft alles weiter, online gehen gespeicherte Runden dann aber bei jedem Update verloren; der Server schreibt beim Start einen deutlichen Hinweis ins Log.
- README: Abschnitt „Bisherige Spiele“ und Einrichtung von Neon.

## Tests

Automatisch (`npm test`, ohne Datenbank, mit Datei-Speicher):

- Runde unter 20 Minuten → kein Datensatz; ab 20 Minuten → genau ein Datensatz
- abgebrochene Runde ab 20 Minuten → Datensatz
- Datensatz enthält keinen Crush, keine Fang-Codes, keine IDs/Tokens
- Routen sind vereinfacht (gerundet, nahe Punkte entfernt, letzter Punkt bleibt)
- eingesetzte Joker und Events landen im Datensatz
- Datei-Speicher: speichern, Liste (neueste zuerst, ohne Routen), einzeln holen
- HTTP: ohne/falsches Passwort 401, richtiges Passwort liefert Liste und Details, Sperre nach 5 Fehlversuchen

Manuell: einmal mit echter Neon-Datenbank (nach Einrichtung durch den Nutzer) eine Runde speichern und auf der Seite ansehen; im Browser Passwort, Liste, Details und Karte prüfen.

## Nicht Teil davon

Spielerprofile, Statistiken über mehrere Runden, Löschen oder Bearbeiten von Runden, Export.
