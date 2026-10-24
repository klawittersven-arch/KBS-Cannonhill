# KBS-Cannonhill

Cannonhill als Klassen-Turnier: Das Spiel läuft auf den Smartphones der Schülerinnen und Schüler,
der Beamer zeigt Lobby, Ergebnisse und das Finale. Grundlage ist das Spiel
[Cannonhill](https://dplate.de/games/cannonhill) von Dirk Plate.

**Stand:**
- **Turnier** (`/beamer` für die Lehrkraft, `/handy` für die SuS): Lobby mit QR-Code, Qualifying in Gruppen
  auf den Handys, Finale am Beamer, Siegerehrung.
- **Netztest** (`/netztest`, `/netztest-handy`): prüft im echten Klassenraum WLAN und Handys.
- **Spielkern** (`public/js/spiel/`): das Original-Spiel, Bild für Bild nachgebaut und bit-genau
  wiederholbar – Voraussetzung dafür, dass später alle Handys einer Gruppe dasselbe sehen.
- **Probespiel** (`/probe`): das Spiel auf einem Gerät ausprobieren, 2–8 Panzer, andere auf Wunsch vom Computer.

## Spielregeln (Abweichungen vom Original)

- Alle **3 Sekunden** feuern alle Panzer gleichzeitig mit dem eingestellten Winkel und der Kraft.
- Standard: **nur Raketen, unbegrenzt**. Mit „Alle Waffen aktivieren“ gelten die Waffen und das Lager des Originals
  (4 Raketen, Stein unbegrenzt, Schild, Granaten …) und der Fallschirm-Ballon bringt Nachschub.
- **Wind und Wetter** sind standardmäßig aus.
- Panzer haben **500 statt 1000** Lebenspunkte.
- Nach **2 Minuten** beginnt der Sudden Death: Raketen regnen vom Himmel, Schild, Magnet und Medipack wirken nicht mehr.
  Nach 2:10 gewinnt, wer die meiste Energie hat. Sterben die Letzten gleichzeitig, gewinnt, wer vorher mehr hatte.
- Bis zu 8 Panzer (Original: 4); die Panzer zielen zu Beginn schräg zur Feldmitte.
- Spielfeld 384×216 statt 640×480 (größere Panzer auf dem Handy); Geschosse in der Farbe des Schützen.

## Turnier im Unterricht

1. Am Lehrer-Laptop `https://<adresse>/beamer` öffnen und auf den Beamer legen (Vollbild: F11).
2. Die SuS scannen den QR-Code und geben Vorname und ersten Buchstaben des Nachnamens ein.
3. Optional: **Alle Waffen aktivieren**, Wind, Wetter, Einteilung. Dann **Turnier starten**.
   - 2–8 SuS: alle spielen direkt das Finale am Beamer.
   - ab 9 SuS: Qualifying in Gruppen à 3–4 auf den Handys; der Beamer zeigt Stand und Gruppensieger.
4. Sind alle Gruppen entschieden: **Finale starten** – die Gruppensieger spielen, alle schauen auf den Beamer.
5. Siegerehrung mit Pokal; **Neues Turnier** führt zurück in die Lobby (alle bleiben angemeldet).

Wer zu spät kommt, ist beim nächsten Turnier dabei. Ein Handy, das die Verbindung verliert oder neu
geladen wird, steigt automatisch wieder in seine Partie ein. Zum Ausprobieren verkürzt
`/beamer?spielzeit=20` jede Partie auf 20 Sekunden.

## Netztest im Unterricht

1. Am Lehrer-Laptop `https://<adresse>/netztest` öffnen und auf den Beamer legen.
2. Die SuS scannen den QR-Code und geben Vorname und ersten Buchstaben des Nachnamens ein.
3. Warten, bis alle Kacheln da sind. Optional: **Raum sperren**.
4. **Test starten** (60 Sekunden, Einteilung „Automatisch“).
   Die Handys werden wie im Turnier eingeteilt (2–8 SuS: alle zusammen; ab 9: Gruppen à 3–4).
   Jede Gruppe sieht dieselbe Landschaft; Antippen löst bei allen gleichzeitig eine Explosion aus.
5. Danach zeigt der Beamer eine Empfehlung. **Ergebnis anzeigen → Kopieren** liefert einen Bericht
   **ohne Namen**, den man direkt an Claude weitergeben kann.

Gemessen wird pro Handy: Ping, Eingabe-Verzögerung im Takt, Hänger, Verbindungsabbrüche,
Bilder pro Sekunde, Rechenleistung, ob die Pixelphysik bit-genau gleich rechnet,
und ob die Handys einer Gruppe am Ende exakt dieselbe Landschaft haben.

## Einrichtung bei Cloudflare

Einmalig, danach wird jede Änderung auf `main` automatisch veröffentlicht.

1. Im Cloudflare-Dashboard **Workers & Pages → Create application** wählen.
2. **Import a repository** wählen (nicht „Pages“), GitHub verbinden und `KBS-Cannonhill` auswählen.
   Falls Cloudflare nur auf ausgewählte Repositories zugreifen darf, dort `KBS-Cannonhill` freigeben.
3. Als Namen **`kbs-cannonhill`** eintragen – er muss zum `name` in `wrangler.jsonc` passen.
4. Build-Befehl leer lassen, Deploy-Befehl `npx wrangler deploy`, Produktions-Branch `main`.
5. **Deploy**. Die Adresse lautet dann `https://kbs-cannonhill.<dein-konto>.workers.dev`.

Das Projekt ist ein *Worker* mit *Durable Object* (ein Objekt pro Klassenraum), keine reine Pages-Seite.
Eine eigene Domain ist nicht nötig – nur falls der Webfilter der Schule `workers.dev` sperrt.

## Entwicklung

```sh
npm install
npm run dev        # lokaler Server auf http://localhost:8787
npm test           # Gruppenregeln, Physik, Eingabeprüfung
npm run check      # TypeScript-Prüfung des Servers
npm run last       # Netztest: 30 simulierte Handys gegen den laufenden Server (ANZAHL, DAUER, BASIS)
npm run turnier    # ganzes Turnier mit 10 rechnenden Handys (ANZAHL, ENDE, BASIS)
```

| Pfad | Inhalt |
|---|---|
| `server/turnier.ts` | Durable Object: Turnier – Lobby, Gruppen, Partien im 50-ms-Takt, Ergebnisse, Finale |
| `server/raum.ts` | Durable Object: Netztest im 50-ms-Takt |
| `server/index.ts` | Worker: `/spiel/<code>` → Turnier, `/ws/<code>` → Netztest, alles andere aus `public/` |
| `public/js/spiel/netzspiel.js` | eine Partie im Netz: Takte anwenden, 60 Bilder/s, Aufholen, Wiedereinstieg |
| `public/js/beamer.js`, `handy.js` | Turnier: Beamer-Ansicht und Spieler-Seite |
| `public/js/gruppen.js` | Gruppeneinteilung (Server und Beamer) |
| `public/js/sim.js` | deterministische Mini-Pixelphysik (nur Ganzzahlen) |
| `public/js/bewertung.js` | Ampel-Grenzen und Empfehlung |
| `public/js/netztest-beamer.js`, `netztest-handy.js` | die beiden Oberflächen des Netztests |
| `public/js/spiel/regeln.js` | alle Werte des Originals (Materialien, Munition, Kanonenstellungen) |
| `public/js/spiel/welt.js` | Pixelfeld, Landschaft, Pixel bewegen/löschen, Hangneigung |
| `public/js/spiel/spiel.js` | eine Partie: Physik, Panzer, Munition, Explosionen, Salven, Sudden Death, Prüfsumme |
| `public/js/spiel/zeichner.js` | Anzeige mit den Original-Grafiken, Flammen, Rauch, Trümmer |
| `public/js/probe.js` | Probespiel auf einem Gerät |

Der Spielkern rechnet nur mit + − × ÷, Wurzel und einem eigenen Zufallsgenerator – keine
Winkelfunktionen, damit iPhone und Android exakt gleich rechnen. Flammen, Rauch und Farben
entstehen nur in der Anzeige und zählen nicht zur Prüfsumme.

## Datenschutz

- Namen liegen nur im Arbeitsspeicher des Raums und auf dem Beamer. Nichts wird gespeichert oder protokolliert;
  ist niemand mehr verbunden, ist der Raum weg.
- Der Ergebnisbericht enthält keine Namen.
- Das Handy merkt sich Vorname, Anfangsbuchstabe und eine Zufalls-ID lokal, damit es nach dem Neuladen
  ohne erneute Eingabe zurückkommt.

## Danksagung

- **Dirk Plate** – Cannonhill (Programmierung), **Heiko Plate** – Sound und Musik. Spiellogik und Grafiken
  (`public/img/`) stammen aus dem Original und werden mit Erlaubnis verwendet.
- **univrsal** – SDL2-Portierung [cannonhill-sdl](https://github.com/univrsal/cannonhill-sdl).
- **Kazuhiko Arase** – [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT, siehe `public/js/vendor/`).
