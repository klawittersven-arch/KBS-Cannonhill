// WebSocket zum Raum mit automatischem Wiederverbinden.
// Schließcodes ab 4001 kommen vom Server (belegt, entfernt, abgelehnt …):
// dann wird bewusst nicht neu verbunden.

/**
 * @param {{pfad: string, beimOeffnen: () => void, beiNachricht: (n: any) => void,
 *          beiStatus?: (status: 'verbinde'|'offen'|'zu', code?: number) => void}} optionen
 */
export function verbinde({ pfad, beimOeffnen, beiNachricht, beiStatus = () => {} }) {
  let ws = null;
  let versuche = 0;
  let zeitgeber = null;
  let beendet = false;

  function oeffne() {
    clearTimeout(zeitgeber);
    const protokoll = location.protocol === 'https:' ? 'wss' : 'ws';
    const neu = new WebSocket(`${protokoll}://${location.host}${pfad}`);
    ws = neu;
    beiStatus('verbinde');
    neu.onopen = () => {
      versuche = 0;
      beiStatus('offen');
      beimOeffnen();
    };
    neu.onmessage = (ereignis) => {
      let nachricht;
      try {
        nachricht = JSON.parse(ereignis.data);
      } catch {
        return;
      }
      beiNachricht(nachricht);
    };
    neu.onclose = (ereignis) => {
      if (ws !== neu) return; // eine neuere Verbindung ist schon unterwegs
      beiStatus('zu', ereignis.code);
      if (!beendet && ereignis.code < 4001) plane();
    };
  }

  function plane() {
    clearTimeout(zeitgeber);
    const warten = Math.min(5000, 400 * 2 ** versuche++);
    zeitgeber = setTimeout(oeffne, warten);
  }

  oeffne();

  return {
    get offen() {
      return ws?.readyState === WebSocket.OPEN;
    },
    sende(nachricht) {
      if (ws?.readyState !== WebSocket.OPEN) return false;
      ws.send(JSON.stringify(nachricht));
      return true;
    },
    /** Sofort neu verbinden, falls gerade keine Verbindung besteht (z. B. nach dem Entsperren). */
    jetztNeu() {
      if (beendet || ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) return;
      versuche = 0;
      oeffne();
    },
    /** Verbindung ist offen, antwortet aber nicht mehr: hart neu aufbauen. */
    erneuern() {
      if (beendet) return;
      const alt = ws;
      ws = null;
      try {
        alt?.close();
      } catch {
        // egal
      }
      versuche = 0;
      oeffne();
    },
    beende() {
      beendet = true;
      clearTimeout(zeitgeber);
      ws?.close();
    },
  };
}

/** Zufällige ID für Handy oder Beamer. */
export function neueId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const zahlen = crypto.getRandomValues(new Uint8Array(16));
  return [...zahlen].map((z) => z.toString(16).padStart(2, '0')).join('');
}

/** localStorage kann in privaten Fenstern fehlen oder werfen – dann eben ohne. */
export const speicher = {
  lies(schluessel) {
    try {
      return localStorage.getItem(schluessel);
    } catch {
      return null;
    }
  },
  schreib(schluessel, wert) {
    try {
      localStorage.setItem(schluessel, wert);
    } catch {
      // ohne Speicher geht es auch
    }
  },
  loesche(schluessel) {
    try {
      localStorage.removeItem(schluessel);
    } catch {
      // ohne Speicher geht es auch
    }
  },
};
