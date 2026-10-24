# KBS-Cannonhill

Cannonhill als Klassen-Turnier: Das Spiel läuft auf den Smartphones der Schülerinnen und Schüler,
der Beamer zeigt Lobby, Ergebnisse und das Finale. Grundlage ist das Spiel
[Cannonhill](https://dplate.de/games/cannonhill) von Dirk Plate.

**Stand:** Netztest. Er prüft im echten Klassenraum, ob WLAN und Handys für Echtzeit reichen
oder ob das Spiel im Salven-Modus (alle feuern gemeinsam) laufen sollte.

## Netztest im Unterricht

1. Am Lehrer-Laptop `https://<adresse>/beamer` öffnen und auf den Beamer legen.
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
npm run last       # 30 simulierte Handys gegen den laufenden Server (ANZAHL, DAUER, BASIS anpassbar)
```

| Pfad | Inhalt |
|---|---|
| `server/raum.ts` | Durable Object: Lobby, Beamer-Verbindung, Netztest im 50-ms-Takt |
| `server/index.ts` | Worker: `/ws/<raumcode>` → Raum, alles andere aus `public/` |
| `public/js/gruppen.js` | Gruppeneinteilung (Server und Beamer) |
| `public/js/sim.js` | deterministische Mini-Pixelphysik (nur Ganzzahlen) |
| `public/js/bewertung.js` | Ampel-Grenzen und Empfehlung |
| `public/js/handy.js`, `beamer.js` | die beiden Oberflächen |

## Datenschutz

- Namen liegen nur im Arbeitsspeicher des Raums und auf dem Beamer. Nichts wird gespeichert oder protokolliert;
  ist niemand mehr verbunden, ist der Raum weg.
- Der Ergebnisbericht enthält keine Namen.
- Das Handy merkt sich Vorname, Anfangsbuchstabe und eine Zufalls-ID lokal, damit es nach dem Neuladen
  ohne erneute Eingabe zurückkommt.

## Danksagung

- **Dirk Plate** – Cannonhill (Programmierung), **Heiko Plate** – Sound und Musik. Verwendung mit Erlaubnis.
- **univrsal** – SDL2-Portierung [cannonhill-sdl](https://github.com/univrsal/cannonhill-sdl).
- **Kazuhiko Arase** – [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT, siehe `public/js/vendor/`).
