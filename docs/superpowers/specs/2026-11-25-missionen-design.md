# Missionen (Checkpoints) – Design

Stand: 25.11.2026 · Status: freigegeben

## Wozu

Hider sollen sich freiwillig auf ein Wagnis einlassen können: mehr Risiko gegen eine Belohnung („high risk, high reward“). Das bringt zusätzliche Spannung in die Jagd.

Verstecken verhindern ist **kein** Ziel. In der letzten großen Runde (rund 40 Spieler) waren die Hider weit verteilt und ohnehin mit Wegrennen beschäftigt.

## Ziele

- Ein Hider bekommt ab und zu ein **persönliches Angebot**. Er entscheidet selbst, ob er das Risiko eingeht.
- Das Risiko entsteht dadurch, dass **die Jäger das Ziel kennen** und dort einen Hinterhalt legen können. Wer kommt, wissen sie nicht.
- Wer annimmt und scheitert, wird bestraft. Annehmen kostet also wirklich etwas.
- Es soll sich mit 10 Spielern genauso gut spielen wie mit 40.
- Die Ziele sind sichere, öffentliche Orte, die der Spielleiter freigegeben hat.

## Nicht-Ziele (erst in einer späteren Etappe)

- Mutproben in der Nähe von Jägern (unter 150 m bleiben, Jäger folgen).
- Eine Kette aus 3 Checkpoints mit dem Pokal-Joker als Belohnung.
- Missionen für Jäger.
- Checkpoints auf dem Server speichern oder zwischen Spielleitern teilen.

## Was es auf keinen Fall werden darf

- Ziele an gefährlichen Orten: Gleise, Privatgrundstücke, Orte mitten auf großen Straßen. Jedes Ziel hat der Spielleiter selbst freigegeben.
- Ein Durcheinander aus vielen Kreisen auf der Karte der Jäger. Deshalb laufen **höchstens 2 Missionen gleichzeitig**.
- Pflichtaufgaben. Ablehnen hat keine Folgen.
- Mehr Aufwand für Runden ohne Missionen. Wer sie aus lässt, sieht beim Einrichten nichts davon.

## Ablauf im Spiel (entschieden)

1. **Angebot:** Ab und zu wird ein zufälliger freier Hider ausgewählt. Er bekommt ein Angebot nur für sich: Ziel mit Name und Entfernung, Zeitlimit, Belohnung und den Hinweis „Die Jäger sehen das Ziel!“. Er hat **60 Sekunden** Bedenkzeit.
2. **Ablehnen oder keine Antwort:** Das Angebot geht an einen anderen zufälligen Hider.
3. **Angenommen:** Alle Jäger sehen auf der Karte einen **Kreis am Ziel mit Countdown**, aber nicht, welcher Hider kommt. Andere Hider sehen die Mission nicht. Der Hider selbst sieht sein Ziel, den Countdown und wie lange er schon im Kreis ist.
4. **Geschafft:** Der Hider bleibt **30 Sekunden am Stück** im Kreis (Radius etwa 35 m, wegen der GPS-Ungenauigkeit). Er bekommt einen Hider-Joker, und je weiter das Ziel, desto besser der Joker. Bei den Jägern verschwindet der Kreis mit der Meldung „Mission geschafft!“.
5. **Zeit abgelaufen:** Der Hider wird **einmal für alle Jäger angepingt** (Strafe). Der Kreis verschwindet.
6. **Unterwegs gefangen:** Die Mission ist vorbei, der Kreis verschwindet. Durch die Infektion ist der Hider dann Jäger.
7. **Ziel fällt aus der Zone:** Sobald eine neue Zonenstufe angekündigt wird und das Ziel außerhalb liegt, wird die Mission **ohne Strafe abgebrochen**. Der Hider bekommt die Meldung „Ziel liegt bald außerhalb der Zone, Mission ohne Strafe beendet“, und bei den Jägern verschwindet der Kreis. Das gilt auch für offene Angebote. (Entschieden, damit niemand doppelt bestraft wird: einmal durch die Zone, einmal durch den Strafe-Ping.)

Weitere Regeln:
- **Höchstens 2 Missionen gleichzeitig.** Offene Angebote zählen mit.
- Nie zwei Missionen am selben Ziel.
- Keine neuen Angebote, wenn weniger als 10 Minuten übrig sind.
- Einstellbar wie die Special Events: **aus / selten / oft**. Bei „Ich spiele zum ersten Mal“ bleiben Missionen aus.
- Nur der Missionstyp **Checkpoint**.

## Ziele auswählen beim Einrichten (entschieden: Weg B)

- In Schritt 3 „Regeln“ gibt es „Missionen: aus / selten / oft“. Steht es nicht auf „aus“, erscheint darunter **„Checkpoints auswählen (N gewählt)“**.
- Das öffnet ein eigenes Fenster mit großer Karte (Zone eingezeichnet) und einer Liste darunter.
- **Vorschläge:** Die App sucht öffentliche Orte in der Zone aus OpenStreetMap, zum Beispiel Plätze, Spielplätze, Kirchen, Brunnen und Denkmäler. Auf der Karte sind sie grau. Antippen auf der Karte oder in der Liste schaltet zwischen „ja“ (grün) und „nein“ (grau).
- **Eigene Punkte:** Mit „Eigenen Punkt setzen“ tippt der Spielleiter einen Ort auf die Karte und kann ihm einen Namen geben.
- **Gespeichert** wird auf dem Handy des Spielleiters, pro Spielfeld, so wie „Wie letztes Mal“. Kommt er mit demselben Spielfeld wieder, sind seine Ziele schon ausgewählt.
- Die gewählten Ziele gehören zu den Spiel-Einstellungen und gehen mit dem Start an den Server.

## Ansätze, die wir abgewogen haben

**Woher kommt das Risiko?**
- **A (gewählt):** Die Jäger sehen das Ziel. Das schafft echte Begegnungen zwischen den Teams, also Hinterhalt gegen Wagnis. Das gibt es bisher in der App nicht.
- B: Der Hider ist während der Mission live sichtbar. Das ist zu nah am vorhandenen Kopfgeld-Event.
- C: Der Hider muss in die Nähe von Jägern. Das kommt vielleicht später als Mutprobe.

**Woher kommen die Ziele?**
- **Vorschläge aus OpenStreetMap plus eigene Punkte, der Spielleiter hakt ab (gewählt).** Das ist sicher und trotzdem schnell eingerichtet.
- Nur von Hand: am sichersten, aber jedes neue Spielfeld kostet Zeit.
- Nur automatisch zufällige Punkte: zu riskant, weil sie auch in Gärten, auf Gleisen oder in Flüssen landen.

**Wer bekommt Missionen?**
- **Persönliche Angebote, höchstens 2 gleichzeitig (gewählt).** Jedes Angebot fühlt sich besonders an, und die Jäger behalten den Überblick.
- Ein Angebot an alle mit Wettlauf: Es ist oft nach einer Sekunde weg, und Rennende sehen es nie.
- Jeder hat immer eine Mission: Bei 25 Hidern wären das zu viele Kreise.

**Wo wird ausgewählt?**
- **Eigenes Fenster aus Schritt 3 (gewählt).** Es stört niemanden ohne Missionen, und die Karte ist groß genug für genaues Tippen.
- Direkt in Schritt 2: Dort ist es zu voll, und das Antippen kollidiert mit dem Setzen der Zone.
- Nur eine Liste: Man sieht nicht, wo die Orte liegen.

## Rahmenbedingungen

- Bis zu 40 Spieler, also bis zu etwa 25 Hider gleichzeitig.
- Es wird immer mit Infektion gespielt. Gefangene werden zu Jägern.
- Der Server entscheidet alles und gibt den Jägern nie preis, welcher Hider eine Mission hat.
- Die Zone kann schrumpfen. Ziele außerhalb der aktuellen Zone oder der angekündigten nächsten Stufe werden nicht mehr angeboten. Angebote berücksichtigen **nicht**, wohin die Zone später schrumpft, denn sonst würde jedes Angebot das verraten.
- Die Suche in OpenStreetMap läuft **über den Manhunt-Server**, wie die Ortssuche über Nominatim. Die IP-Adressen der Spieler gehen nicht an den Dienst. Das muss in die Datenschutz-Seite.
- Bestehende Bausteine nutzen: Special Events (Planung und Einstellung aus/selten/oft), die Ping-Logik, die Hider-Joker und die Kurzmeldungen.
- README, Anleitung in der App und Datenschutz werden mitgepflegt.

## Vorschläge, die ich festgelegt habe (änderbar)

- **Wie oft:** „selten“ heißt etwa alle 12 Minuten ein neues Angebot, „oft“ etwa alle 6 Minuten. Das erste Angebot kommt frühestens 5 Minuten nach Jagdbeginn.
- **Entfernung:** Angeboten wird ein Ziel, das 300 bis 900 m vom Hider entfernt liegt. Passt für ihn keins, wird ein anderer Hider gewählt. Passt für niemanden eins, fällt das Angebot aus.
- **Zeitlimit:** 3 Minuten plus 1 Minute je angefangene 150 m, aufgerundet. Für 650 m sind das 8 Minuten.
- **Belohnung je Entfernung:** unter 500 m ein Doppelgänger, ab 500 m zufällig Tarnkappe oder Radar.
- **Strafe:** Der Strafe-Ping zeigt den **echten** Standort. Tarnkappe und Doppelgänger schützen davor nicht, und er erscheint in der Ping-Spur. Ist der Hider gerade geschützt (Rollentausch-Schutz oder Schutzschild), entfällt die Strafe.
- **Weitergeben:** Lehnt ein Hider ab oder antwortet nicht, bekommt ein anderer zufälliger Hider ein **neues** Angebot mit einem Ziel, das zu ihm passt (300 bis 900 m). Zeitlimit und Belohnung werden für ihn neu berechnet. Das geht höchstens 3 Mal hintereinander, danach verfällt der Platz bis zum nächsten Termin im Rhythmus. Solange angeboten wird, belegt das einen der 2 Plätze. Das Weitergeben verschiebt den Rhythmus nicht. Wer ein Angebot ablehnt, bekommt die nächsten 5 Minuten kein neues.
- **Ziele geheim:** Die Liste aller Checkpoints sieht nur der Spielleiter, so wie heute die selbst gesetzte Mitte der Endzone. Andere Spieler bekommen sie in der Lobby nicht. Jäger sehen ein Ziel erst, wenn eine Mission dazu angenommen ist.
- **Suchdienst:** Die Vorschläge kommen von der Overpass-API (OpenStreetMap), abgefragt vom Server. Die Datenschutz-Seite nennt Overpass.
- **30 Sekunden im Kreis:** Weil Positionen manchmal nur alle 15 bis 20 Sekunden kommen (Hintergrund-Ortung), zählt die Zeit zwischen zwei Positionen im Kreis mit. Eine Position außerhalb setzt die Zeit zurück.
- **Eine Mission pro Hider** gleichzeitig.
- **Jäger** sehen nicht, ob gerade jemand im Kreis steht. Sie sehen nur Kreis und Countdown.
- **Zuschauer** sehen alles, auch wer die Mission hat.
- **Bisherige Spiele:** Die Runde vermerkt Missionen (angenommen, geschafft, gescheitert, mit Name und Ziel) und zeigt sie in den Details.
- **Gespeicherte Ziele** pro Spielfeld: Schlüssel aus gerundetem Mittelpunkt und Radius. Höchstens 20 Ziele pro Spiel.
- **Vorschläge:** höchstens etwa 30, die nächsten am Mittelpunkt zuerst. Orte mit Zugang „privat“ sind ausgeschlossen. Treffer werden einen Tag gemerkt, wie bei der Ortssuche.

## Was der Baumeister selbst entscheidet

- Genaue Gestaltung von Angebotskarte, Kreis, Countdown und Fortschrittsanzeige im vorhandenen Stil (Symbole, Farben, Bausteine).
- Wie die Abfrage an OpenStreetMap genau aussieht: welche Merkmale, Flächen als Mittelpunkt und so weiter.
- Wie ein Spiel ohne Ziele behandelt wird. Mein Vorschlag: Missionen lassen sich ohne mindestens 3 Ziele nicht einschalten, mit kurzem Hinweis.
- Töne und Vibration für Angebot, Erfolg und Strafe.
- Tests: Spielablauf mit vorgespielter Zeit wie bei den Events, Prüfung der Einstellungen, Suchdienst mit nachgebauter Antwort wie bei der Ortssuche.
