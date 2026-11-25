import crypto from 'node:crypto';

// Gast-Passwörter für andere Gruppen: stehen nur in der Umgebungsvariable GUEST_PASSWORDS
// (bei Render, lokal in der Datei .env), Format "NAME:passwort, NAME2:passwort2".

// "NAME:passwort, ..." -> [{ name, password }]. Kaputte Einträge (ohne Doppelpunkt,
// ohne Name oder ohne Passwort) werden übersprungen. Getrennt wird am ersten Doppelpunkt.
export function parseGuestPasswords(text) {
  return String(text ?? '')
    .split(',')
    .map((entry) => {
      const i = entry.indexOf(':');
      if (i < 0) return null;
      const name = entry.slice(0, i).trim();
      const password = entry.slice(i + 1).trim();
      return name && password ? { name, password } : null;
    })
    .filter(Boolean);
}

// Groß-/Kleinschreibung egal: Handys schreiben den ersten Buchstaben oft automatisch groß oder klein.
const digest = (s) => crypto.createHash('sha256').update(String(s ?? '').trim().toUpperCase()).digest();
const matches = (input, secret) => crypto.timingSafeEqual(digest(input), digest(secret));

// check(input) -> { kind: 'main' } | { kind: 'guest', group } | null.
// Das Hauptpasswort gewinnt, falls ein Gast-Passwort zufällig gleich lautet.
export function createAccess({ mainPassword, guestPasswords }) {
  return {
    check(input) {
      if (!String(input ?? '').trim()) return null;
      if (matches(input, mainPassword)) return { kind: 'main' };
      const hit = guestPasswords.find((g) => matches(input, g.password));
      return hit ? { kind: 'guest', group: hit.name } : null;
    },
  };
}
