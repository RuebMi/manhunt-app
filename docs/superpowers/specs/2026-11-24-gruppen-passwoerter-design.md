# Gruppen-Passwörter für Bisherige Spiele – Design

Stand: 24.11.2026 · Status: vom Nutzer im Chat freigegeben

## Ziel

Jedes Spielleiter-Passwort öffnet „Bisherige Spiele“. Gast-Passwörter sehen nur die Runden, die mit ihrem eigenen Passwort erstellt wurden. Das Hauptpasswort sieht alle Runden, gruppiert nach Passwort. Neue Gast-Passwörter legt der Nutzer bei Render an; sie funktionieren automatisch genauso.

## Entscheidungen

| Frage | Entscheidung |
|---|---|
| Wie werden Passwörter angelegt? | Umgebungsvariable `GUEST_PASSWORDS` bei Render, Format `NAME:passwort, NAME2:passwort2` |
| Standard ohne Variable | keine Gruppen (Passwörter stehen nie im Code) |
| Variable gesetzt | ersetzt den Standard vollständig (alle Gruppen müssen drinstehen) |
| `GUEST_PASSWORD` (alt) | fällt weg |
| Groß-/Kleinschreibung | egal (wie bisher); Kommas und Doppelpunkte im Passwort nicht erlaubt; Leerzeichen um Einträge werden ignoriert |
| Gleiches Passwort wie Hauptpasswort | Hauptpasswort gewinnt |
| Crush | alle Gast-Gruppen ohne Crush (wie bisher) |
| Gruppen-Schlüssel | der Name; Passwort ändern bei gleichem Namen behält die alten Runden |
| Laufende alte Gast-Spiele (`guest` ohne `group`) | gehören zu `REHE` |
| Bereits gespeicherte Runden ohne Gruppe | gehören zum Hauptpasswort |
| Hauptpasswort-Ansicht | Abschnitte: „Hauptpasswort“ zuerst, dann Gruppen alphabetisch; in jeder Gruppe neueste Runde zuerst; Überschrift mit Anzahl |
| Gast-Ansicht | nur eigene Runden, ohne Überschrift; der Gruppenname wird nie an Gäste geschickt |
| Fremde Runde per Adresse | 404 „Runde nicht gefunden.“ |
| Gespeichert wird | nur der Gruppenname (`summary.group`), nie das Passwort |

## Bausteine

- `server/access.js` (neu): `parseGuestPasswords(text)` → `[{ name, password }]`; `createAccess({ mainPassword, guestPasswords })` → `check(input)` liefert `{ kind: 'main' }`, `{ kind: 'guest', group }` oder `null`. Vergleich wie bisher per SHA-256 + `timingSafeEqual`, getrimmt, Großbuchstaben.
- `server/game.js`: `Game#group` (`null` = Hauptpasswort), `guest` bleibt als Boolean für den Crush; `fromJSON`: `guest && !group` → `group = 'REHE'`; `archiveRecord().summary.group`.
- `server/index.js`: Erstellen setzt `game.group`/`game.guest`; `requirePassword` hängt `req.access` an; `/api/rounds` filtert für Gäste nach Gruppe und entfernt das Feld `group`; Hauptpasswort bekommt jede Runde mit `group` (fehlend → `null`); `/api/rounds/:id` liefert Gästen 404 für fremde Runden und entfernt `group`.
- `public/history.js`: hat die Liste ein Feld `group`, wird nach Gruppen gruppiert angezeigt, sonst flach.
- `public/datenschutz.html` Abschnitt 5, `README.md`: angepasst.

## Tests

- `parseGuestPasswords`: Standard, Leerzeichen, Passwort mit `>`, kaputte Einträge werden übersprungen.
- `check`: Haupt- und Gastpasswörter, Groß-/Kleinschreibung, falsches Passwort → `null`, Hauptpasswort gewinnt bei Gleichheit.
- Spiel: Gruppe landet im Datensatz; alter Gast-Spielstand → `REHE`; alte Runde ohne Gruppe → Hauptpasswort.
- HTTP: REHE sieht nur REHE-Runden ohne `group`-Feld, NEU_ULM nur seine, Hauptpasswort alle mit `group`; fremde Runde → 404; Gast-Spiele ohne Crush.
