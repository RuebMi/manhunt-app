// Push-Sperre: Fragt Render, ob gerade ein Spiel läuft. Ein Push startet die App neu
// und würde laufende Spiele beenden. Läuft eins, bricht der Push ab (Exit-Code 1).
//
// Aufruf: npm run check-live   (läuft auch automatisch vor jedem git push, siehe .githooks/pre-push)
// Trotzdem pushen:  MANHUNT_FORCE_PUSH=1 git push
//
// Ist Render nicht erreichbar oder schläft (dann läuft sicher kein Spiel), wird der Push erlaubt.
// Das Hauptpasswort kommt aus der Umgebung oder aus der Datei .env (nicht im Repo, Vorlage: .env.example).
try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch {
  /* keine .env */
}
const URL_BASE = process.env.MANHUNT_URL || 'https://manhunt-ia08.onrender.com';
const PASSWORD = process.env.CREATE_PASSWORD;

if (process.env.MANHUNT_FORCE_PUSH === '1') {
  console.log('⚠️  Push-Sperre übersprungen (MANHUNT_FORCE_PUSH=1).');
  process.exit(0);
}

if (!PASSWORD) {
  console.log('ℹ️  Kein CREATE_PASSWORD (Datei .env fehlt?) – kann nicht prüfen, ob ein Spiel läuft. Push erlaubt.');
  process.exit(0);
}

let status;
try {
  const res = await fetch(`${URL_BASE}/api/status`, {
    headers: { 'X-Password': PASSWORD },
    signal: AbortSignal.timeout(Number(process.env.MANHUNT_CHECK_TIMEOUT_MS) || 8000),
  });
  if (res.status === 404) {
    console.log('ℹ️  Die Version auf Render kennt die Status-Abfrage noch nicht – Push erlaubt.');
    process.exit(0);
  }
  if (!res.ok) throw new Error(`Antwort ${res.status}`);
  status = await res.json();
} catch (e) {
  console.log(`ℹ️  Konnte nicht prüfen, ob ein Spiel läuft (${e.message}). Server schläft oder ist nicht erreichbar – Push erlaubt.`);
  process.exit(0);
}

if (status.running > 0) {
  const spiele = status.running === 1 ? '1 Spiel' : `${status.running} Spiele`;
  console.error(`⛔ Gerade läuft ${spiele} mit ${status.players} Spielern auf Render.`);
  console.error('   Ein Push startet die App neu und beendet das Spiel. Push abgebrochen.');
  console.error('   Trotzdem pushen: MANHUNT_FORCE_PUSH=1 git push');
  process.exit(1);
}
console.log('✅ Kein laufendes Spiel auf Render – Push okay.');
