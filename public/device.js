// Geräte-Nummer: eine zufällige Nummer, die die App einmal erzeugt und im Browser speichert.
// Sie wird nur bei Anmeldungen mit einem Spielleiter-Passwort mitgeschickt (Anmelde-Liste,
// siehe server/logins.js). Daraus lässt sich nicht ablesen, wem das Handy gehört.
const KEY = 'manhunt-device';

export function deviceId() {
  try {
    let id = localStorage.getItem(KEY);
    if (!/^[A-Za-z0-9-]{8,64}$/.test(id ?? '')) {
      const bytes = crypto.getRandomValues(new Uint8Array(12));
      id = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return ''; // privater Modus o. ä.: dann ohne Geräte-Nummer
  }
}
