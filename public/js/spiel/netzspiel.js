// Eine Partie im Netz: Der Server schickt 20 Takte pro Sekunde mit den Eingaben
// aller Spieler; jedes Gerät rechnet daraus dieselbe Partie. Die Bilder werden
// gleichmäßig mit 60 pro Sekunde gerechnet – mit etwa einem Takt Vorrat, damit
// kleine Verzögerungen im WLAN nicht ruckeln. Wer zurückfällt, holt im Zeitraffer auf.

import { Spiel } from './spiel.js';
import { BILDER_PRO_SEKUNDE, BILDER_PRO_TAKT } from './regeln.js';

const BILD_MS = 1000 / BILDER_PRO_SEKUNDE;
const VORRAT = BILDER_PRO_TAKT; // so viele Bilder bleiben als Puffer übrig
const MAX_BILDER_JE_AUFRUF = 900;

export class NetzSpiel {
  /**
   * @param {object} info  Nachricht 'spiel' vom Server
   * @param {object} o
   * @param {object|null} [o.steinTextur]
   * @param {(ergebnis: object) => void} [o.beiEnde]  Partie entschieden (einmal)
   * @param {(spiel: Spiel, n: number) => void} [o.nachTakt]  nach jedem angewendeten Takt
   * @param {(spiel: Spiel) => void} [o.nachBild]  nach jedem Bild (z. B. für Effekte)
   * @param {() => void} [o.lueckeEntdeckt]  Takte fehlen: alles neu anfordern
   */
  constructor(info, { steinTextur = null, beiEnde = () => {}, nachTakt = () => {}, nachBild = () => {}, lueckeEntdeckt = () => {} } = {}) {
    this.info = info;
    this.id = info.s;
    this.steinTextur = steinTextur;
    this.beiEnde = beiEnde;
    this.nachTakt = nachTakt;
    this.nachBild = nachBild;
    this.lueckeEntdeckt = lueckeEntdeckt;
    this.baueAuf(info);
  }

  /** Neu aufbauen und alle bisherigen Takte im Zeitraffer nachrechnen. */
  baueAuf(info) {
    this.info = info;
    this.spiel = new Spiel({
      seed: info.seed,
      spieler: info.spieler,
      ...info.optionen,
      steinTextur: this.steinTextur,
    });
    this.takte = new Map(info.verlauf.eingaben);
    this.empfangenBis = info.verlauf.bis;
    this.wartetAufNachholen = false;
    this.gemeldet = false;
    this.uebrig = 0;
    this.zuletzt = null;
    // nachrechnen ohne Effekte
    const ziel = this.empfangenBis * BILDER_PRO_TAKT;
    while (this.spiel.bild < ziel && this.bild(false));
    this.spiel.holeEreignisse();
    this.spiel.welt.allesNeu = true;
  }

  /** Ein Takt vom Server. */
  takt(n, eingaben) {
    if (n <= this.empfangenBis || this.wartetAufNachholen) return;
    if (n !== this.empfangenBis + 1) {
      this.wartetAufNachholen = true;
      this.lueckeEntdeckt();
      return;
    }
    this.takte.set(n, eingaben);
    this.empfangenBis = n;
  }

  /** Wie viele Bilder könnten jetzt gerechnet werden? */
  get vorrat() {
    return this.empfangenBis * BILDER_PRO_TAKT - this.spiel.bild;
  }

  /** Ein Bild rechnen; an jeder Taktgrenze zuerst die Eingaben dieses Takts anwenden. */
  bild(mitEffekten = true) {
    const s = this.spiel;
    if (s.bild % BILDER_PRO_TAKT === 0) {
      const n = s.bild / BILDER_PRO_TAKT + 1;
      if (n > this.empfangenBis) return false;
      const eingaben = this.takte.get(n);
      this.takte.delete(n);
      if (eingaben) for (const [nr, w, k, m] of eingaben) s.wendeAn({ nr, w, k, m });
      if (mitEffekten) this.nachTakt(s, n);
    }
    s.schritt();
    if (mitEffekten) this.nachBild(s);
    else if (s.ereignisse.length > 1000) s.holeEreignisse();
    if (s.phase === 'ende' && !this.gemeldet) {
      this.gemeldet = true;
      this.beiEnde({ sieger: s.sieger, grund: s.siegGrund, n: Math.ceil(s.bild / BILDER_PRO_TAKT), h: s.pruefsumme() });
    }
    return true;
  }

  /** Für jede Bildschirmaktualisierung: so viele Bilder rechnen, wie Zeit vergangen ist. */
  laufe(jetzt = performance.now()) {
    if (this.zuletzt === null) this.zuletzt = jetzt;
    this.uebrig += jetzt - this.zuletzt;
    this.zuletzt = jetzt;
    let anzahl = Math.floor(this.uebrig / BILD_MS);
    const vorrat = this.vorrat;
    if (vorrat - anzahl > VORRAT * 3) anzahl = vorrat - VORRAT; // zurückgefallen: aufholen
    anzahl = Math.min(anzahl, vorrat, MAX_BILDER_JE_AUFRUF);
    let gerechnet = 0;
    while (gerechnet < anzahl && this.bild()) gerechnet++;
    this.uebrig = Math.min(Math.max(0, this.uebrig - gerechnet * BILD_MS), BILD_MS * 2);
    return gerechnet;
  }

  /** Alles rechnen, was schon da ist (z. B. in Tests). */
  laufeAlles() {
    let gerechnet = 0;
    while (this.bild()) gerechnet++;
    return gerechnet;
  }
}
