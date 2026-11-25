// "🌱 Ich spiele zum ersten Mal": empfohlene Einstellungen von Michael.
// Die Mitte der Zone bleibt, wo der Spielleiter sie in Schritt 2 gesetzt hat; nur die Größe wird gesetzt.
export const FIRST_TIME_ZONE_RADIUS = 1200; // m

export const FIRST_TIME_SETTINGS = {
  finalRadius: 300, // Endzone 300 m Radius
  finalMode: 'random', // zufällige Endzone
  durationMin: 60,
  catchRule: 'touch', // abklatschen
  eventsMode: 'off', // Special Events aus
  headStartMin: 5,
  pingIntervalMin: 4,
  outGraceSec: 30,
  shrink: true,
  shrinkSteps: 4,
  shrinkWarnMin: 1,
  hidersSeeEachOther: true,
  infection: true, // Gefangene werden Jäger
  hiderJokers: 2,
  hunterExtraPings: 3,
  hunterDrones: 2,
  hunterSniffs: 4,
  // Spannung
  pingTrail: 3, // Ping-Spur: letzte 3 Pings (beim Antippen)
  pingSpeedup: false, // Pings werden mit den Zonenstufen nicht schneller
  finaleSec: 0, // kein Finale (Hider am Ende nicht live sichtbar)
  comebackAt: 1, // Bonus-Joker, wenn nur noch 1 Hider frei ist
};

// Ganze Einstellung, wie sie an den Server geht (Zone mit der aktuellen Mitte)
export const firstTimeUpdate = (zone) => ({ ...FIRST_TIME_SETTINGS, zone: { lat: zone.lat, lng: zone.lng, radius: FIRST_TIME_ZONE_RADIUS } });

// Sind die empfohlenen Einstellungen gerade aktiv?
export const isFirstTime = (s) =>
  s.zone?.radius === FIRST_TIME_ZONE_RADIUS && Object.entries(FIRST_TIME_SETTINGS).every(([k, v]) => s[k] === v);
