# Gruppen-Passwörter – Umsetzungsplan

**Spec:** `docs/superpowers/specs/2026-11-24-gruppen-passwoerter-design.md` · Ausführung: in dieser Sitzung (inline)

1. **Tests zuerst** – `test/smoke.js`: `accessTests()` (parse + check), Ergänzung in `guestTests()` (Gruppe im Datensatz, alter Gast-Spielstand → REHE). `test/archive.js` `httpTests()`: Gast-Teil auf Gruppen umstellen (REHE- und NEU_ULM-Runde erstellen und beenden; Sichtbarkeit, 404, kein `group` für Gäste, Hauptpasswort sieht alle mit `group`). Laufen lassen → rot.
2. **`server/access.js`** mit `parseGuestPasswords` und `createAccess`; Standardliste als Konstante `DEFAULT_GUEST_PASSWORDS`.
3. **`server/game.js`**: `group` im Konstruktor, `fromJSON`-Zuordnung, `summary.group`.
4. **`server/index.js`**: `createAccess` statt `passwordOk`/`accessFor`; Erstellen, `requirePassword`, beide Routen wie in der Spec.
5. **`public/history.js`** + `style.css`: gruppierte Liste mit Überschrift „Hauptpasswort“ / Gruppenname und Anzahl.
6. **`public/datenschutz.html`** Abschnitt 5 und **`README.md`** (Spielleiter-Tabelle, Bisherige Spiele, Render-Hinweis, Umgebungsvariablen).
7. **Prüfen**: `npm test` grün; Browser: Haupt- und Gast-Ansicht.
