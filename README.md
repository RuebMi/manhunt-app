# Manhunt – Real-Life-Jagd im Browser

Eine Web-App für Manhunt mit Freunden. Sie läuft direkt im Handy-Browser, ohne App Store und ohne Konto. Getestet ist sie mit 33 gleichzeitigen Spielern, möglich sind bis zu 40.

**Link: https://manhunt-ia08.onrender.com**

## Inhalt

- [Schnellstart](#schnellstart)
- [Spielregeln](#spielregeln)
- [Joker](#joker)
- [Special Events](#special-events)
- [Missionen](#missionen)
- [Ablauf in der App](#ablauf-in-der-app)
- [Bisherige Spiele](#bisherige-spiele)
- [Tipps fürs Handy](#tipps-fürs-handy)
- [Ortung bei gesperrtem Handy (OwnTracks)](#ortung-bei-gesperrtem-handy-owntracks-optional)
- [Online spielen (Render)](#online-spielen-render)
- [Entwicklung](#entwicklung)
- [Sicherheit](#sicherheit)

## Schnellstart

1. **Spielleiter** öffnet den Link, tippt auf „Neues Spiel erstellen“, gibt Namen und **Spielleiter-Passwort** ein und lädt die anderen per Code, QR-Code oder Link ein.
2. **Mitspieler** öffnen den Link, geben den 4-stelligen Code und ihren Namen ein und erlauben den Standort. Ein Passwort brauchen sie nicht.
3. Spielleiter wählt Spielfeld, Regeln und Teams und startet das Spiel.

Tipp: Den Link ein paar Minuten vor dem Treffen öffnen, damit der Server wach ist (siehe [Online spielen](#online-spielen-render)).

## Spielregeln

### Rollen

- Ein paar Spieler sind **Jäger**, alle anderen sind **Hider** und verstecken sich in der **Zone**.
- Die Hider bekommen einen **Vorsprung**. In dieser Zeit warten die Jäger am Startpunkt.

### Ping

Beim **Ping** (zum Beispiel alle 5 Minuten) sehen die Jäger, wo die Hider in diesem Moment waren. Zwischen zwei Pings sehen sie nichts Neues. Hider-Positionen gehen nie vor dem Ping an die Jäger, das entscheidet der Server.

### Fangen

- Je nach Einstellung ist ein Hider gefangen, wenn ein Jäger ihn **berührt** (Abklatschen) oder auf **Armlänge** (1–2 m) herankommt und den Namen ruft.
- Der Hider bleibt dann stehen und zeigt seinen geheimen **4-stelligen Code**. Der Jäger tippt ihn ein.
- **Streitfall:** Gibt ein Hider seinen Code nicht her, meldet der Jäger einen Streitfall. Der Spielleiter entscheidet mit „Ja, gefangen“ oder „Nein, weiterspielen“ und sieht dabei den GPS-Abstand als Hinweis. Ohne Entscheidung innerhalb von 2 Minuten spielt der Hider weiter.

### Zone

Die Zone wird in Stufen kleiner, gleichmäßig über die Jagd verteilt. Bei 60 Minuten mit 3 Stufen passiert das bei Minute 15, 30 und 45, zum Beispiel von 1200 m über 1000 m und 800 m auf 600 m.

- Vor jeder Stufe erscheint die neue Zone als gelber Kreis (Vorwarnung, Standard: 1 Minute).
- Die **Endzone** stellt der Spielleiter in Schritt 2 ein: die Größe in Metern und die Lage.
  - **Gleiche Mitte:** Die Zone schrumpft um die Mitte der Startzone.
  - **Zufällig:** Bei jeder Stufe springt die Zone an eine zufällige Stelle, liegt aber immer komplett in der alten.
  - **Selbst wählen:** Der Spielleiter setzt die Endzone auf der Karte, auch außerhalb der Startzone. Die Stufen wandern gleichmäßig dorthin. Wo sie liegt, sieht nur der Spielleiter. Die App zeigt ihm, wie weit die Zone pro Stufe wandert, und schlägt eine passende Vorwarnung vor, damit alle rechtzeitig hinkommen.

### Strafen

- Wer die Zone zu lange verlässt (Standard: 30 s), wird für die Jäger live sichtbar, bis er zurück ist.
- Wer länger als 2 Minuten kein GPS sendet, wird als „kein GPS“ markiert. Die Jäger sehen dann den letzten Standort.

### Spannung

Vier Mechaniken, die das Spiel zum Ende hin enger machen. Alle sind unter „Mehr Einstellungen“ → **Spannung** ein- und ausschaltbar und einstellbar (in Klammern der Standard):

- **Ping-Spur (letzte 3 Pings):** Tippt ein Jäger auf den Punkt eines Hiders, sieht er dessen frühere Ping-Punkte als gelbe, verblassende Linie bis zum aktuellen Punkt. So lässt sich die Laufrichtung erraten. Ein Tipp auf denselben Punkt oder auf die leere Karte blendet die Spur wieder aus. Damit bleibt die Karte auch bei vielen Spielern übersichtlich. Hider sehen die Spur nie.
- **Schnellere Pings (an):** Mit jeder Zonenstufe kommen die Pings schneller, bis höchstens doppelt so oft: aus 5 Minuten werden am Ende 3, aus 4 Minuten 2. Die Meldung zur Zonenstufe nennt das neue Tempo. Ohne schrumpfende Zone bleibt der Ping-Takt gleich.
- **Bonus-Joker (2 Hider):** Sind nur noch so viele Hider frei, bekommt jeder einmalig zufällig eine 👻 Tarnkappe oder einen 🎭 Doppelgänger. Startet die Runde schon mit so wenigen Hidern, gibt es keinen Bonus.
- **Finale (1,5 Minuten):** In den letzten Minuten der Jagd sind alle noch freien Hider für die Jäger live sichtbar. Hider mit Rollentausch-Schutz bleiben unsichtbar.

### Crush 💘 (optional)

Der Spielleiter kann in Schritt 4 (Teams) zwei Spieler als Crush-Paar auswählen. Die beiden sehen sich die ganze Runde live auf der Karte, egal in welchem Team, und **können sich nicht gegenseitig fangen**, weder per Code noch per Streitfall. Andere Jäger dürfen sie ganz normal fangen.

Geheim: Nur die beiden und der Spielleiter wissen davon. Das Paar erfährt es beim Start der Runde. Es bleibt für die folgenden Runden gesetzt, bis der Spielleiter es ändert oder entfernt. Verlässt einer das Spiel, ist das Paar aufgelöst.

### Spielende

Sind alle Hider gefangen, gewinnen die Jäger. Hält einer bis zum Schluss durch, gewinnen die Hider.

## Joker

| Joker | Für | Wirkung |
|---|---|---|
| 👻 Tarnkappe | Hider | Du fehlst im nächsten Ping. |
| 🎭 Doppelgänger | Hider | Der nächste Ping zeigt dich 300–600 m daneben. |
| 📡 Radar | Hider | Du siehst 30 s lang alle Jäger. Die Jäger bekommen das mit. |
| 🛰️ Sonder-Ping | Jäger | Sofort ein zusätzlicher Ping. |
| 🚁 Drohne | Jäger | Ein zufälliger Hider wird 60 s lang live verfolgt. |
| 🐕 Spürnase | Jäger | Entfernung zum nächsten Hider. |

Hider bekommen zufällige Joker. Die Jäger teilen sich einen gemeinsamen Vorrat. Die Anzahl stellt der Spielleiter ein.

### Pokal-Joker 🏆

Zwei Joker gibt es nie zufällig. Man muss sie sich in einer Runde verdienen:

- **Meiste Fänge:** Der Jäger, der am meisten Hider gefangen hat, bekommt einen Pokal. Bei Gleichstand bekommen ihn alle mit den meisten Fängen.
- **Letzte(r) Überlebende(r):** Gewinnen die Hider und ist nur noch einer übrig, bekommt er einen Pokal.

In der Lobby steht 🏆 neben dem Namen. In der **nächsten Runde derselben Lobby** wird der Pokal zum Joker, passend zur neuen Rolle. Wird er nicht eingesetzt, verfällt er am Ende der Runde. Wird eine Runde vom Spielleiter abgebrochen, gibt es keinen Pokal.

| Joker | Für | Wirkung |
|---|---|---|
| 🛡️ Schutzschild | Hider | 2 Minuten lang kann dich niemand fangen. Aber alle Jäger sehen dich so lange live. |
| 🔦 Scheinwerfer | Jäger | Alle Hider im Umkreis von 300 m um dich sind 30 Sekunden lang für alle Jäger live sichtbar. Hider mit Rollentausch-Schutz bleiben unsichtbar. |

## Special Events

Optional, in den Regeln auf „Selten“ (etwa 2 pro Stunde) oder „Oft“ (etwa 4 pro Stunde) einstellbar. Die Events kommen überraschend:

- frühestens 10 Minuten nach Beginn der Jagd,
- spätestens 5 Minuten vor Schluss,
- mit mindestens 6 Minuten Abstand,
- jedes Event höchstens einmal pro Spiel.

| Event | Wirkung |
|---|---|
| 🌧️ Joker-Regen | Jeder freie Hider bekommt einen Joker, die Jäger einen Team-Joker. |
| 🔥 Jagdfieber | 10 Minuten lang kommen die Pings doppelt so oft. |
| 🌫️ Nebel | Beim nächsten Ping sehen die Jäger nur einen Kreis (200 m), keinen genauen Punkt. |
| 💰 Kopfgeld | Ein Hider ist 2 Minuten live sichtbar. Wer durchhält, bekommt einen Joker, sonst bekommen die Jäger einen. |
| 🔄 Rollentausch | Ein Jäger wird Hider, mit 2 Minuten Schutz (unsichtbar und nicht fangbar). Gibt es nur einen Jäger, kommt stattdessen ein anderes Event. |

## Missionen

Optional, in Schritt 3 „Regeln“ auf „Selten“ (etwa alle 12 Minuten ein Angebot) oder „Oft“ (etwa alle 6 Minuten) einstellbar. Bei „Ich spiele zum ersten Mal“ sind Missionen aus.

**Ablauf:**

1. **Angebot:** Ab und zu bekommt ein zufälliger freier Hider ein Angebot nur für sich: ein Checkpoint 300 bis 900 m entfernt, Zeitlimit, Belohnung und der Hinweis „Die Jäger sehen das Ziel!“. Er hat 60 Sekunden Bedenkzeit. Das erste Angebot kommt frühestens 5 Minuten nach Beginn der Jagd, in den letzten 10 Minuten kommen keine neuen.
2. **Ablehnen oder keine Antwort:** Ein anderer Hider bekommt ein neues Angebot (höchstens 3 Mal hintereinander). Wer ablehnt, bekommt 5 Minuten lang keins. Ablehnen hat sonst keine Folgen.
3. **Angenommen:** Alle Jäger sehen am Ziel einen gelben Kreis mit Countdown, aber nicht, wer kommt. Andere Hider sehen nichts. Zuschauer sehen auch den Namen.
4. **Geschafft:** 30 Sekunden am Stück im Kreis (35 m Radius) bleiben. Belohnung: unter 500 m ein Doppelgänger, ab 500 m eine Tarnkappe oder ein Radar.
5. **Zeit um:** Ein Strafe-Ping zeigt den echten Standort allen Jägern (Tarnkappe und Doppelgänger helfen nicht, er erscheint auch in der Ping-Spur). Mit Rollentausch-Schutz oder Schutzschild gibt es keine Strafe.
6. **Gefangen oder Zone:** Wird der Hider unterwegs gefangen, ist die Mission vorbei. Liegt das Ziel außerhalb einer angekündigten neuen Zone, endet die Mission ohne Strafe.

Zeitlimit: 3 Minuten plus 1 Minute je angefangene 150 m (650 m → 8 Minuten). Höchstens 2 Missionen laufen gleichzeitig (offene Angebote zählen mit), nie zwei am selben Checkpoint, jeder Hider höchstens eine.

**Checkpoints auswählen:** Steht Missionen nicht auf „Aus“, erscheint „Checkpoints auswählen“. Das Fenster zeigt eine große Karte mit der Zone und eine Liste. Die App schlägt öffentliche Orte aus OpenStreetMap vor (Plätze, Kirchen, Brunnen, Denkmäler, Spielplätze, Parks; höchstens 30, private Orte nicht). Antippen schaltet zwischen grau (nein) und grün (ja). Mit „Eigenen Punkt setzen“ tippst du einen Ort auf die Karte und gibst ihm einen Namen. Nur sichere, öffentliche Orte wählen! Höchstens 20, für den Start mindestens 3 in der Zone. Die Auswahl sieht nur der Spielleiter, und sein Handy merkt sie sich pro Spielfeld: Mit derselben Zone sind sie beim nächsten Mal schon gewählt.

In „Bisherige Spiele“ stehen die Missionen einer Runde mit Name, Checkpoint und Ergebnis.

## Ablauf in der App

### Spielleiter

Nur wer ein **Spielleiter-Passwort** kennt, kann ein Spiel erstellen. Groß- und Kleinschreibung spielt keine Rolle. Nach dem ersten richtigen Versuch merkt sich das Handy das Passwort. Nach 5 falschen Versuchen muss man eine Minute warten.

Es gibt zwei Arten von Spielleiter-Passwörtern:

| Passwort | Für wen | Was geht |
|---|---|---|
| **Hauptpasswort** | dich und deine Gruppe, in der App „Gruppe Jugend Villingen“ | alles, auch [Crush](#crush--optional). In [Bisherige Spiele](#bisherige-spiele) siehst du **alle** Runden, nach Gruppen geordnet. |
| **Gruppen-Passwörter** | andere Gruppen, die die App nutzen wollen (jede Gruppe hat einen Namen, z. B. `REHE` oder `Neu_Ulm`) | alles außer Crush. Die Crush-Karte in Schritt 4 fehlt ganz. In „Bisherige Spiele“ sieht jede Gruppe **nur ihre eigenen** Runden. |

Ein Spiel bleibt bei der Gruppe, mit deren Passwort es erstellt wurde, auch wenn später jemand anderes die Spielleitung übernimmt.

**Gruppenname in der App:** Alle im Spiel sehen, zu welcher Gruppe es gehört. Der Spielleiter wird in der Lobby mit „Hallo Gruppe REHE 👋 Willkommen bei Manhunt!“ begrüßt, Mitspieler sehen „Willkommen bei Manhunt, Gruppe REHE!“ und den Namen oben in der Kopfzeile, im Spiel steht er in der Statuszeile („Jagd läuft · Gruppe REHE“) und im geteilten Ergebnis. Auf „Bisherige Spiele“ begrüßt die App ebenfalls mit dem Gruppennamen. Unterstriche werden als Leerzeichen angezeigt (`Neu_Ulm` → „Neu Ulm“). Spiele mit dem Hauptpasswort heißen „Gruppe Jugend Villingen“ (änderbar über `MAIN_GROUP_NAME`).

#### Neue Gruppe anlegen

Die Gruppen-Passwörter stehen bei Render in der Variable `GUEST_PASSWORDS`, im Format `NAME:passwort, NAME2:passwort2`:

1. Im Render-Dashboard den Service öffnen, dann **Environment**.
2. `GUEST_PASSWORDS` anlegen oder ändern. Wichtig: **Alle** Gruppen müssen drinstehen, auch die bisherigen. Im Code stehen keine Passwörter.
3. Speichern. Render startet den Server neu, also nicht während eines laufenden Spiels.

Regeln: Kommas trennen die Gruppen, der erste Doppelpunkt trennt Name und Passwort. Groß- und Kleinschreibung beim Passwort ist egal. Änderst du nur das Passwort einer Gruppe und behältst den Namen, sieht sie weiterhin ihre alten Runden. Lautet ein Gruppen-Passwort zufällig wie das Hauptpasswort, gilt das Hauptpasswort.

Nach „Neues Spiel erstellen“ geht es in 4 Schritten weiter:

1. **Einladen:** Code, QR-Code oder Link (zum Beispiel per WhatsApp).
2. **Spielfeld:** Ganz oben steht bei einem neuen Spiel **„↩️ Wie letztes Mal (…)“**: Ein Tipp übernimmt Zone, Endzone und Regeln deines letzten gestarteten Spiels (gemerkt auf deinem Handy, ohne Crush und Teams). Sonst einen beliebigen Ort suchen (zum Beispiel „Neu-Ulm“ oder „Glacis Neu-Ulm“), oder Villingen, Schwenningen, ganz VS bzw. „Hier, wo ich bin“ antippen. Die Startzone springt sofort zum besten Treffer, weitere Treffer stehen darunter zum Antippen. Eine selbst gesetzte Endzone wandert dabei mit. Größe Klein, Mittel oder Groß, mit dem Regler feiner einstellbar. Darunter die Endzone (siehe [Zone](#zone)).
3. **Regeln:** Ganz oben **„🌱 Ich spiele zum ersten Mal“**: Ein Tipp setzt die empfohlenen Einstellungen (siehe unten). Sonst Vorlage Kurz, Normal oder Lang, dazu Fangregel, Special Events und [Missionen](#missionen) mit „Checkpoints auswählen“. Alles Weitere steht unter „Mehr Einstellungen“.

   **Empfohlene Einstellungen („Ich spiele zum ersten Mal“):** Zone 1,2 km Radius (die Mitte bleibt, wo du sie gesetzt hast), Endzone 300 m und zufällig, 60 Minuten, 5 Minuten Vorsprung, Ping alle 4 Minuten, abklatschen, Special Events aus, 30 Sekunden außerhalb der Zone erlaubt, 4 Zonen-Stufen mit 1 Minute Vorwarnung, Hider sehen sich gegenseitig, Gefangene werden Jäger, 2 Joker pro Hider, für die Jäger 3 Sonder-Pings, 2 Drohnen und 4 Spürnasen, Ping-Spur der letzten 3 Pings, Pings werden nicht schneller, kein Finale, Bonus-Joker erst beim letzten freien Hider. Festgelegt in `public/first-time.js`.
4. **Teams:** Anzahl der Jäger wählen, Rollen auslosen. Ab der zweiten Runde gibt es zusätzlich **„🔄 Andere Jäger als letzte Runde“**: Das lost möglichst niemanden als Jäger aus, der zuletzt Jäger war. Auf Wunsch ein [Crush-Paar](#crush--optional) festlegen, Checkliste „Bereit?“, dann „Spiel starten“.

Verlässt der Spielleiter das Spiel, übernimmt der Spieler, der am längsten dabei ist.

### Startseite

Oben die drei Knöpfe (beitreten, erstellen, bisherige Spiele), darunter drei Bild-Kacheln „Verstecken · Ping · Fangen“, die beim Öffnen einmal kurz anlaufen. „Wie geht das? Ganze Anleitung“ öffnet ein Fenster mit den vier Schritten und dem Sicherheitshinweis.

### Mitspieler

Code eingeben (oder den Link öffnen), Namen eintragen, Standort freigeben. Danach erscheint eine Warteseite mit der eigenen Rolle und den Regeln.

### Im Spiel

- Beim Start erklärt ein Fenster jedem seine Rolle. Über den **„?“-Knopf** lässt es sich jederzeit wieder öffnen.
- **Unteres Feld zum Hochziehen:** Eingeklappt zeigt es nur das Wichtigste: Jäger sehen den Knopf **„Gefangen!“**, Hider ihren **Fang-Code**. Ein Tipp auf **„Joker“** (oder Hochwischen) klappt die Joker auf, Runterwischen klappt sie wieder zu. Läuft gerade ein eigener Joker, zeigt ein gelber Punkt am Joker-Knopf das an.
- **Eine Hinweis-Leiste:** Oben steht immer nur der wichtigste Hinweis. „+2“ zeigt, dass es weitere gibt, ein Tipp darauf zeigt alle. Reihenfolge: eigene Gefahr (live geortet, außerhalb der Zone, Drohne, Kopfgeld, Schild) → eigene Mission → Standort blockiert/aus → Streitfall → Finale → Ping-Vorwarnung → Missionen (Jäger) → außerhalb der neuen Zone → eigene Joker und Schutz → Special Events und „Zone wird kleiner“ → GPS wird gesucht → Hintergrund-Ortung aktiv. Von den Kurzmeldungen sind im Spiel höchstens zwei gleichzeitig zu sehen.
- **Fang:** Bei jedem Fang sehen alle kurz ein Fadenkreuz, das sich zuzieht, mit „Gefangen – wer wen“ und wie viele Hider noch frei sind. Das Handy vibriert.
- **Ping:** Bei jedem Ping läuft eine gelbe Radar-Welle über die Karte (bei Hidern von der eigenen Position aus), die neuen Ping-Punkte leuchten kurz auf.
- Wer am Handy „Bewegung reduzieren“ eingeschaltet hat, bekommt Fang, Ping und Siegerbildschirm ohne Animation.
- Die eigene Position ist ein **blauer Pfeil in Laufrichtung**. Mit dem **🧭-Knopf** zeigt er die Richtung des Handys (Kompass).
- Bleibt das GPS hängen, startet die App es nach 20 Sekunden selbst neu. Oben rechts erscheint dann ein gelber Punkt.
- Es gibt einen Chat für alle und je einen fürs eigene Team.
- **Missionen:** Ein Angebot erscheint als Karte über dem unteren Feld mit Countdown, „Annehmen“ und „Ablehnen“. Die eigene Mission ist ein grüner Kreis auf der Karte, oben steht „Mission: … · Zeit … · noch … m“ und im Kreis „Im Kreis! Bleib stehen: 0:12 / 0:30“. Jäger sehen gelbe Kreise mit Countdown und oben „Mission zu … – Hinterhalt legen!“.
- **Vorwarnung für Hider:** 30 Sekunden vor jedem Ping erscheint „📍 Ping in … – geh in Deckung!“, und das Handy vibriert kurz, ohne Ton. iPhones erlauben Websites kein Vibrieren, dort gibt es nur den Hinweis.

### Nach dem Spiel

Zuerst kommt der **Siegerbildschirm** in der Farbe des Siegerteams: großer Titel, Konfetti, ein **Siegertreppchen** (bei Jäger-Sieg die meisten Fänge, bei Hider-Sieg wer am längsten frei war), die eigenen Zahlen (gefangen/überlebt, gelaufene Strecke, Pokal) und die Knöpfe „Ergebnis teilen“ und „Routen ansehen“. Darunter zeigt die App (wer wen nach wie vielen Minuten gefangen hat, wer am meisten gelaufen ist) und die Karte mit den **Routen**. Es ist immer eine Route zu sehen, ein Tipp auf einen Namen wechselt sie. Der Spielleiter kann alle zurück in die Lobby holen und eine neue Runde starten.

**📤 Ergebnis teilen:** Jeder Spieler kann das Ergebnis als Text verschicken. Das Teilen-Menü des Handys öffnet sich (WhatsApp, Nachrichten …). Am Computer wird der Text in die Zwischenablage kopiert. Drin stehen Sieger, Dauer, die Jäger mit ihren Fängen, die Hider (überlebt oder wann von wem gefangen), Pokale und wer am meisten gelaufen ist. Standorte, Routen, Fang-Codes, Crush und Chat sind nie dabei. Bei mehr als 10 Spielern wird der Text gekürzt.

## Bisherige Spiele

Die App merkt sich vergangene Runden. Du siehst sie später wieder, mit Auswertung und Routen-Karte.

### Was gespeichert wird

- Eine Runde wird **automatisch am Ende** gespeichert, wenn sie ab „Spiel starten“ (mit Vorsprung) mindestens **20 Minuten** gedauert hat. Das gilt auch für Runden, die der Spielleiter abbricht.
- Gespeichert werden: Datum und Uhrzeit, Lobby-Code, Dauer, Gewinner und Grund, die Spieler mit ihren Rollen, wer wen nach wie vielen Minuten gefangen hat, die gelaufene Strecke, Pokale, eingesetzte Joker, Special Events, die wichtigsten Regeln und vereinfachte Routen.
- **Nie gespeichert** werden das Crush-Paar, Fang-Codes, Spieler-IDs und der Chat.
- Spieler, die das Spiel verlassen oder während der Runde entfernt werden, stehen nicht in der gespeicherten Runde.
- Runden aus der Zeit vor dieser Funktion lassen sich nicht nachholen.

### Ansehen

1. Auf dem Startbildschirm auf **„📜 Bisherige Spiele“** tippen.
2. Ein **Spielleiter-Passwort** eingeben. Das Handy merkt es sich danach. Nach 5 falschen Versuchen pro Minute gibt es eine kurze Sperre.
3. Mit einem **Gruppen-Passwort** zeigt die Liste nur die Runden dieser Gruppe. Mit dem **Hauptpasswort** zeigt sie alle Runden in Abschnitten: zuerst „Hauptpasswort“, dann die Gruppen alphabetisch, jeweils mit Anzahl. Runden, die vor den Gruppen gespeichert wurden, stehen unter „Hauptpasswort“.
4. In jeder Gruppe steht die neueste Runde oben. Ein Tipp öffnet die Details mit der Routen-Karte. Ein Tipp auf einen Namen wechselt die Route.
5. **Runde löschen** (nur mit dem Hauptpasswort): In den Details ganz unten auf „🗑️ Runde löschen“ und zur Bestätigung nochmal tippen. Die Runde ist dann endgültig weg, zum Beispiel wenn ein Spieler die Löschung seiner Daten verlangt.
6. **Anmeldungen ansehen** (nur mit dem Hauptpasswort): Oben in der Liste auf „📱 Anmeldungen ansehen“ tippen. Dort steht für jedes Passwort (Hauptpasswort und jede Gruppe), mit wie vielen verschiedenen Geräten es in den letzten 30 Tagen benutzt wurde. Zu jedem Gerät siehst du Art des Geräts (z. B. „iPhone · Safari“), den Namen beim Erstellen, wie oft ein Spiel erstellt oder „Bisherige Spiele“ geöffnet wurde, die gekürzte IP-Adresse und wann zuletzt. Dein eigenes Handy ist mit „(dieses Gerät)“ markiert.
   - Ein Gerät erkennt die App an einer **zufälligen Geräte-Nummer**, die sie beim ersten Anmelden im Browser speichert. Wer die Browser-Daten löscht, einen anderen Browser oder den privaten Modus nimmt, zählt als neues Gerät.
   - Die IP-Adresse ist gekürzt (letzter Teil weg) und hilft wenig: Am Handy wechselt sie oft, im Mobilfunk teilen sich viele eine.
   - Dasselbe Gerät mit demselben Passwort wird höchstens alle 30 Minuten neu notiert. Einträge werden nach 30 Tagen automatisch gelöscht. Mitspieler ohne Passwort stehen nie in der Liste.

### Neon einrichten

Damit die Runden auch ein Update von Render überstehen, brauchen sie eine kostenlose Datenbank bei Neon. Ohne sie landen die Runden in einer Datei auf dem Server. Auf Render sind sie dann bei jedem Update oder Neustart weg. Der Server schreibt beim Start eine Warnung („Keine DATABASE_URL“) ins Log.

1. Auf [neon.tech](https://neon.tech) ein kostenloses Konto anlegen.
2. Ein Projekt anlegen und als Region **Frankfurt (AWS eu-central-1)** wählen.
3. Die **Verbindungs-URL** kopieren. Sie beginnt mit `postgresql://` und enthält `sslmode=require`.
4. Im Render-Dashboard den Service öffnen, dann **Environment** und eine neue Variable `DATABASE_URL` mit dieser URL anlegen. Speichern.
5. Render startet die App neu. Das nicht mitten in einem laufenden Spiel machen.
6. Prüfen: Im Render-Log steht die Warnung „Keine DATABASE_URL“ nicht mehr.

Die Tabelle legt die App selbst an. Es ist nichts weiter zu tun.

## Tipps fürs Handy

- **iPhone:** Die Seite in Safari öffnen, dann Teilen → **Zum Home-Bildschirm**. Dann läuft die App im Vollbild.
- **Standort erlauben.** Ist er blockiert, zeigt die App unter „So geht’s“ eine Anleitung passend zum Handy.
- **App offen und Bildschirm an lassen.** Eine Website kann den Standort nur senden, solange sie offen ist. Die App hält den Bildschirm selbst wach. Auf dem iPhone hilft zur Sicherheit: Einstellungen → Anzeige & Helligkeit → Automatische Sperre → „Nie“, solange ihr spielt.
- **Powerbank mitnehmen.** GPS und ein dauerhaft eingeschalteter Bildschirm kosten viel Akku.

## Ortung bei gesperrtem Handy (OwnTracks, optional)

Wer das Handy in die Tasche stecken will, nutzt zusätzlich die kostenlose App **OwnTracks** ([iPhone](https://apps.apple.com/app/owntracks/id692424691), [Android](https://play.google.com/store/apps/details?id=org.owntracks.android)):

1. OwnTracks installieren.
2. **Nur iPhone, einmalig:** In OwnTracks unter Settings → Remote Control den Schalter **„Allow external configuration“** einschalten. Sonst kommt der Fehler „URL is not allowed“.
3. In der Lobby unter „📱 Ortung bei gesperrtem Handy“ auf **„Mit Manhunt verbinden“** tippen. Klappt der Link nicht, stehen unter „Von Hand einrichten“ die Werte zum Abtippen.
4. Den Standort für OwnTracks auf **„Immer“** erlauben.
5. Sobald die erste Position ankommt, steht in der Lobby „Hintergrund-Ortung aktiv ✅“.

Nach dem Spiel OwnTracks auf den Modus „Ruhig“ (Quiet) stellen oder die App löschen.

## Online spielen (Render)

Die App läuft kostenlos auf Render und braucht keinen Mac.

- **Aufwachen:** Nach etwa 15 Minuten ohne Spieler schläft die App ein. Der erste Aufruf danach dauert rund eine Minute.
- **Updates:** Sobald neuer Code auf GitHub landet (`git push`), baut Render die App automatisch neu.
- **Kein Update während eines Spiels.** Bei einem Update oder Neustart verliert Render seinen Speicher, laufende Spiele sind dann weg. Beendete Runden bleiben erhalten, wenn [Neon](#neon-einrichten) eingerichtet ist.
- **Push-Sperre:** Vor jedem `git push` fragt der Mac bei Render nach, ob gerade ein Spiel läuft. Wenn ja, bricht der Push ab („⛔ Gerade läuft 1 Spiel …“). Trotzdem pushen: `MANHUNT_FORCE_PUSH=1 git push`. Ist Render nicht erreichbar oder schläft, wird der Push erlaubt. Von Hand prüfen: `npm run check-live`. Dafür braucht der Mac das Hauptpasswort in der Datei `.env` (siehe [Auf dem Mac starten](#auf-dem-mac-starten)), sonst wird ohne Prüfung gepusht. Auf einem neuen Rechner einmal einrichten: `git config core.hooksPath .githooks`.
- **Spielleiter-Passwörter ändern:** Bei Render unter Environment `CREATE_PASSWORD` (Hauptpasswort) oder `GUEST_PASSWORDS` (Gruppen, siehe [Neue Gruppe anlegen](#neue-gruppe-anlegen)) setzen. Die Passwörter stehen **nur** dort (und lokal in der Datei `.env`), nie im Code. Ohne `CREATE_PASSWORD` kann niemand mit dem Hauptpasswort ein Spiel erstellen, ohne `GUEST_PASSWORDS` gibt es keine Gruppen.
- **Datenverbrauch:** etwa 20 MB pro Handy für ein 90-Minuten-Spiel mit 33 Spielern.

## Entwicklung

### Auf dem Mac starten

Beim ersten Mal die Passwörter eintragen: `.env.example` nach `.env` kopieren und das Hauptpasswort (`CREATE_PASSWORD`) und die Gruppen (`GUEST_PASSWORDS`) eintragen. Die Datei `.env` bleibt auf dem Mac und kommt nie ins Repo.

```bash
cd ~/Documents/manhunt
cp .env.example .env   # nur beim ersten Mal, dann ausfüllen
npm install      # nur beim ersten Mal
npm start        # echtes Spiel
npm run dev      # Testmodus: Position per Klick auf die Karte setzen
```

Danach läuft die App auf http://localhost:3000. Lokal speichert der Server die Spielstände alle 5 Sekunden in `data/games.json`, sodass sie einen Neustart überstehen.

**Ohne Render, direkt vom Mac:** `./spielen.sh` startet Server und kostenlosen Cloudflare-Tunnel (`brew install cloudflared`) und zeigt einen Link wie `https://irgendwas.trycloudflare.com`. Der Link ist bei jedem Start neu, und der Mac muss an bleiben.

### Umgebungsvariablen

| Variable | Standard | Wirkung |
|---|---|---|
| `PORT` | `3000` | Port des Servers |
| `CREATE_PASSWORD` | nicht gesetzt | Hauptpasswort: Spiel erstellen mit allen Funktionen, Zugang zu „Bisherige Spiele“ |
| `MAIN_GROUP_NAME` | `Jugend Villingen` | So heißt die Gruppe des Hauptpassworts in der App |
| `GUEST_PASSWORDS` | nicht gesetzt | Gruppen-Passwörter `NAME:passwort, …`: Spiel erstellen ohne Crush, in „Bisherige Spiele“ nur die eigenen Runden |
| `ALLOW_SIM` | aus | `1` schaltet den Testmodus ein (nur lokal!) |
| `DATA_FILE` | `data/games.json` | Datei für die gespeicherten Spielstände |
| `DATABASE_URL` | nicht gesetzt | Neon-Postgres-Verbindung für [Bisherige Spiele](#bisherige-spiele). Ohne sie liegen die Runden in `ARCHIVE_FILE` |
| `ARCHIVE_FILE` | `data/archive.json` | Datei für bisherige Spiele, wenn es keine `DATABASE_URL` gibt |
| `LOGINS_FILE` | `logins.json` neben `ARCHIVE_FILE` | Datei für die Anmelde-Liste, wenn es keine `DATABASE_URL` gibt (sonst Tabelle `logins` in Neon) |
| `ARCHIVE_MIN_MINUTES` | `20` | Mindestdauer einer Runde zum Speichern (nur für Tests und Entwicklung) |

### Testen

```bash
npm test                    # Spiellogik, Zonen, Streitfälle, Events, OwnTracks, Passwort, bisherige Spiele, Ortssuche, Server mit 30 Spielern (~10 s)
npm run simulate            # zwei echte Mini-Partien mit 6 Spielern, prüft jede Fähigkeit (~7 min)
npm run load                # Lasttest mit 33 Spielern: Datenmenge, CPU, Speicher (~2 min)
node test/bots.js ABCD 5    # 5 Bots treten Spiel ABCD bei und laufen herum
```

### Aufbau

- `server/game.js`: die komplette Spiellogik (Rollen, Pings, Fangen, Streitfälle, Joker, Zone, Special Events). Der Server entscheidet, wer was sehen darf.
- `server/access.js`: Spielleiter-Passwörter (Hauptpasswort und Gruppen aus `GUEST_PASSWORDS`).
- `server/logins.js`: Anmelde-Liste der Spielleiter-Passwörter (Geräte-Nummer aus `public/device.js`, Gerätetyp, gekürzte IP, 30 Tage).
- `server/geocode.js`: Ortssuche über Nominatim (OpenStreetMap). Der Server fragt an, höchstens einmal pro Sekunde, Treffer werden einen Tag gemerkt.
- `server/missions.js`: Missionen (Checkpoints): Angebote, Zeit im Kreis, Belohnung, Strafe-Ping. Die Jäger erfahren nie, wer eine Mission hat.
- `server/places.js`: Vorschläge für Checkpoints über die Overpass-API (OpenStreetMap). Der Server fragt an, Treffer werden einen Tag gemerkt (Adresse `/api/places`).
- `public/checkpoints.js`: das Fenster „Checkpoints auswählen“ (Karte und Liste, eigene Punkte). Die Auswahl merkt sich das Handy pro Spielfeld.
- `scripts/check-live.mjs` und `.githooks/pre-push`: Push-Sperre, solange auf Render ein Spiel läuft.
- `server/index.js`: Webserver mit Echtzeit-Verbindung (Socket.IO), Anmeldung als Spielleiter, OwnTracks-Endpunkt (`/owntracks`, Basic-Auth mit Spieler-ID und geheimem Token) und Speicherung der Spielstände.
- `public/`: die Web-App (HTML, CSS, JavaScript, Karte mit Leaflet).
- `public/basemap.js`: der Kartenhintergrund. Eine dunkle Vektorkarte von [OpenFreeMap](https://openfreemap.org) (kostenlos, ohne Konto, Stil „Dark“), über MapLibre angezeigt und in Manhunt-Farben umgefärbt (Liste `COLORS`, Straßen heller als im Original). Kann ein Handy kein WebGL oder ist OpenFreeMap nicht erreichbar, kommen stattdessen OpenStreetMap-Kacheln, per CSS-Filter dunkel gemacht. MapLibre kommt von cdnjs, das Verbindungsstück zu Leaflet liegt in `public/vendor/` (@maplibre/maplibre-gl-leaflet 0.1.4, ISC-Lizenz).
- `public/icons.svg` und `public/icons.js`: einheitliche Linien-Symbole ([Tabler Icons](https://tabler.io/icons), MIT-Lizenz, Lizenztext in `public/icons-LICENSE.txt`) statt Emojis. Texte im Code und vom Server dürfen weiter Emojis enthalten, `icons.js` tauscht sie beim Anzeigen gegen das passende Symbol (Liste `MAP`). Fehlt ein Emoji in der Liste, bleibt es ein Emoji. Chat und der „Ergebnis teilen“-Text behalten ihre Emojis. Neue Symbole: SVG von unpkg.com/@tabler/icons holen und als `<symbol>` in `icons.svg` eintragen.
- Farben (`public/style.css`, oben): Rot (`--hunter`, `--danger`) nur für Jäger und Gefahr, Grün für Hider, Gelb für Ping und Joker, Blau für die eigene Position. Hauptknöpfe und Auswahl nutzen den hellen Akzent `--accent`. Knöpfe mindestens 48 px hoch (kleine 34 px), Ecken 12 px bei Knöpfen und 16 px bei Karten, Schrift mindestens 13 px.
- `test/`: automatische Tests, Simulation, Lasttest und Bots.
- `render.yaml`: Einstellungen für Render.

## Sicherheit

Achtet auf den Verkehr, betretet keine Privatgrundstücke und keine Bahngleise, und legt vorher einen Treffpunkt für Notfälle fest.
