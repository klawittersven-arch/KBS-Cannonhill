// Ampel-Bewertung der Messwerte eines Handys und Gesamtempfehlung.
// Grenzen: [bis hier "gut", bis hier "mittel"]; darüber "schlecht".

export const GRENZEN = {
  eingabeP95: [150, 300], // ms bis die eigene Eingabe im Takt zurückkommt
  haengerProMinute: [1, 5], // Lücken im Takt von mehr als 250 ms
  abbrueche: [0, 1], // Verbindungsabbrüche während des Tests
  msProSchritt: [3, 8], // Rechenzeit für einen Physikschritt
  fpsMin: [40, 20], // Bilder pro Sekunde (hier: mindestens so viele)
};

const STUFEN = ['gut', 'mittel', 'schlecht'];

function stufeAufsteigend(wert, [gut, mittel]) {
  if (wert <= gut) return 0;
  if (wert <= mittel) return 1;
  return 2;
}

function stufeAbsteigend(wert, [gut, mittel]) {
  if (wert >= gut) return 0;
  if (wert >= mittel) return 1;
  return 2;
}

/**
 * @param {{bench?: any, werte?: any}} spieler
 * @returns {{stufe: 'gut'|'mittel'|'schlecht'|'offen', gruende: string[]}}
 */
export function bewerte(spieler) {
  const { bench, werte } = spieler;
  let schlimmste = -1;
  const gruende = [];
  const pruefe = (stufe, grund) => {
    if (stufe > schlimmste) schlimmste = stufe;
    if (stufe > 0) gruende.push(grund);
  };

  if (bench) {
    if (bench.korrekt === false) pruefe(2, 'rechnet falsch');
    pruefe(stufeAufsteigend(bench.msProSchritt, GRENZEN.msProSchritt), 'langsam');
  }
  if (werte && werte.takt && werte.takt.n > 0) {
    if (werte.eingabe && werte.eingabe.n > 0) {
      pruefe(stufeAufsteigend(werte.eingabe.p95, GRENZEN.eingabeP95), 'Verzögerung');
    }
    const minuten = Math.max(werte.takt.n * 0.05 / 60, 0.5);
    pruefe(stufeAufsteigend(werte.takt.haenger / minuten, GRENZEN.haengerProMinute), 'Hänger');
    pruefe(stufeAufsteigend(werte.abbrueche || 0, GRENZEN.abbrueche), 'Abbrüche');
    if (werte.fps && werte.fps.min > 0) {
      pruefe(stufeAbsteigend(werte.fps.min, GRENZEN.fpsMin), 'ruckelt');
    }
  }
  return { stufe: schlimmste < 0 ? 'offen' : STUFEN[schlimmste], gruende };
}

/** Median eines Zahlen-Arrays (oder null). */
export function median(zahlen) {
  if (!zahlen.length) return null;
  const s = zahlen.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/** Wert am Perzentil p (0–100) eines Zahlen-Arrays (oder null). */
export function perzentil(zahlen, p) {
  if (!zahlen.length) return null;
  const s = zahlen.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

/**
 * Gesamtempfehlung nach einem Test.
 * @param {Array<{stufe: string}>} bewertungen  nur Handys, die am Test teilgenommen haben
 * @param {boolean} alleSynchron  haben alle Gruppen dieselbe Prüfsumme?
 */
export function empfehlung(bewertungen, alleSynchron) {
  const gesamt = bewertungen.length;
  if (!gesamt) return null;
  const schlecht = bewertungen.filter((b) => b.stufe === 'schlecht').length;
  const anteil = schlecht / gesamt;
  if (!alleSynchron) {
    return { art: 'pruefen', text: 'Gruppen liefen auseinander – Ergebnis bitte an Claude schicken.' };
  }
  if (anteil <= 0.1) {
    return { art: 'echtzeit', text: 'Echtzeit sollte funktionieren.' };
  }
  if (anteil <= 0.3) {
    return { art: 'salven', text: 'Salven-Modus (alle feuern gemeinsam) empfohlen.' };
  }
  return { art: 'kritisch', text: 'Viele Handys mit Problemen – WLAN prüfen, Salven-Modus nötig.' };
}
