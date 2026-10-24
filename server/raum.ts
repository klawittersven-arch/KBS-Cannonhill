import { DurableObject } from 'cloudflare:workers';
import { teileGruppen, MAX_SPIELER } from '../public/js/gruppen.js';
import { normalisiereName, saeubere, sende, sendeText } from './hilfen';
import type { Env } from './env';


const TAKT_MS = 50; // 20 Takte pro Sekunde, wie später im Spiel
const STAND_MS = 1000; // so oft bekommt der Beamer den Gesamtstand
const VORLAUF_MS = 1500; // Pause zwischen "Test startet" und erstem Takt
const MAX_EINGABEN_PRO_TAKT = 3;
const MIN_TAKTE_ZWISCHEN_SCHUESSEN = 5;
const ERLAUBTE_DAUERN = [30, 60, 120];

type Modus = 'auto' | 'direktfinale' | 'qualifying';

interface Spieler {
  id: string;
  nr: number;
  name: string;
  ws: WebSocket | null;
  abbruecheGesamt: number;
  abbruecheTest: number;
  geraet: unknown;
  bench: unknown;
  werte: unknown;
  zwischen: unknown; // letzte Zwischen-Prüfsumme {n, h}
  ergebnis: unknown; // Prüfsumme nach Testende {n, h}
  eingabenImTakt: number;
  letzterSchuss: number;
}

interface Gruppe {
  name: string;
  seed: number;
  mitglieder: string[];
  puffer: number[][]; // Eingaben für den nächsten Takt: [nr, folgeNr, x, feuer]
  feuer: [number, number[][]][]; // Verlauf der Schüsse: [takt, [[nr, x], ...]]
}

interface Test {
  laeuft: boolean;
  art: string;
  hinweis: string;
  dauerMs: number;
  start: number; // Zeitpunkt des ersten Takts
  takt: number;
  gruppen: Gruppe[];
  intervall: ReturnType<typeof setInterval> | null;
  serverTakt: { anzahl: number; summe: number; max: number; zuletzt: number };
}

/** Ein Klassenraum: Lobby mit allen Handys, Beamer-Verbindung und Netztest im festen Takt. */
export class Raum extends DurableObject<Env> {
  private spieler = new Map<string, Spieler>();
  private naechsteNr = 1;
  private beamer: WebSocket | null = null;
  private beamerToken: string | null = null;
  private standIntervall: ReturnType<typeof setInterval> | null = null;
  private standGeplant = false;
  private gesperrt = false;
  private modus: Modus = 'auto';
  private test: Test | null = null;

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket erwartet', { status: 426 });
    }
    const paar = new WebSocketPair();
    const [client, server] = Object.values(paar);
    server.accept();
    this.verbinde(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  // --- Verbindungen ------------------------------------------------------

  private verbinde(ws: WebSocket) {
    let rolle: { art: 'handy'; spieler: Spieler } | { art: 'beamer' } | null = null;

    ws.addEventListener('message', (ereignis) => {
      if (typeof ereignis.data !== 'string' || ereignis.data.length > 4096) return;
      let n: any;
      try {
        n = JSON.parse(ereignis.data);
      } catch {
        return;
      }
      if (!n || typeof n !== 'object') return;

      if (!rolle) {
        if (n.typ !== 'hallo') return;
        rolle = n.rolle === 'beamer' ? this.begruesseBeamer(ws, n) : this.begruesseHandy(ws, n);
        return;
      }
      if (rolle.art === 'handy') this.vomHandy(rolle.spieler, ws, n);
      else this.vomBeamer(n);
    });

    const weg = () => {
      if (rolle?.art === 'handy' && rolle.spieler.ws === ws) {
        rolle.spieler.ws = null;
        this.standBald();
      } else if (rolle?.art === 'beamer' && this.beamer === ws) {
        this.beamer = null;
        if (this.standIntervall) clearInterval(this.standIntervall);
        this.standIntervall = null;
      }
    };
    ws.addEventListener('close', weg);
    ws.addEventListener('error', weg);
  }

  private begruesseBeamer(ws: WebSocket, n: any): { art: 'beamer' } | null {
    const token = typeof n.token === 'string' ? n.token.slice(0, 64) : '';
    if (!token || (this.beamerToken && this.beamerToken !== token)) {
      sende(ws, { typ: 'belegt' });
      ws.close(4001, 'Raum belegt');
      return null;
    }
    if (this.beamer && this.beamer !== ws) this.beamer.close(4002, 'Beamer neu verbunden');
    this.beamerToken = token;
    this.beamer = ws;
    sende(ws, { typ: 'willkommen' });
    this.sendeStand();
    if (!this.standIntervall) this.standIntervall = setInterval(() => this.sendeStand(), STAND_MS);
    return { art: 'beamer' };
  }

  private begruesseHandy(ws: WebSocket, n: any): { art: 'handy'; spieler: Spieler } | null {
    const id = typeof n.id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(n.id) ? n.id : null;
    if (!id) return this.lehneAb(ws, 'Ungültige Anmeldung – bitte Seite neu laden.');

    let spieler = this.spieler.get(id);
    if (spieler) {
      // Wiederkehrendes Handy (Sperrbildschirm, WLAN-Wechsel, Seite neu geladen)
      if (spieler.ws && spieler.ws !== ws) spieler.ws.close(4003, 'Neu verbunden');
      spieler.ws = ws;
      spieler.abbruecheGesamt++;
      if (this.test?.laeuft && this.gruppeVon(id)) spieler.abbruecheTest++;
    } else {
      if (this.gesperrt) return this.lehneAb(ws, 'Der Raum ist gesperrt. Frag deine Lehrkraft.');
      if (this.spieler.size >= MAX_SPIELER) return this.lehneAb(ws, 'Der Raum ist voll.');
      const name = normalisiereName(n.vorname, n.initial);
      if (!name) return this.lehneAb(ws, 'Bitte Vorname und Anfangsbuchstaben des Nachnamens eingeben.');
      spieler = {
        id,
        nr: this.naechsteNr++,
        name: this.eindeutigerName(name),
        ws,
        abbruecheGesamt: 0,
        abbruecheTest: 0,
        geraet: saeubere(n.geraet),
        bench: null,
        werte: null,
        zwischen: null,
        ergebnis: null,
        eingabenImTakt: 0,
        letzterSchuss: -999,
      };
      this.spieler.set(id, spieler);
    }

    sende(ws, { typ: 'willkommen', nr: spieler.nr, name: spieler.name });
    this.sendeTestStand(spieler);
    this.standBald();
    return { art: 'handy', spieler };
  }

  private lehneAb(ws: WebSocket, grund: string): null {
    sende(ws, { typ: 'abgelehnt', grund });
    ws.close(4004, 'abgelehnt');
    return null;
  }

  private eindeutigerName(name: string): string {
    const vergeben = new Set([...this.spieler.values()].map((s) => s.name));
    if (!vergeben.has(name)) return name;
    for (let i = 2; ; i++) {
      if (!vergeben.has(`${name} (${i})`)) return `${name} (${i})`;
    }
  }

  // --- Nachrichten der Handys ----------------------------------------------

  private vomHandy(spieler: Spieler, ws: WebSocket, n: any) {
    switch (n.typ) {
      case 'ping':
        sende(ws, { typ: 'pong', t: n.t });
        break;
      case 'bench':
        spieler.bench = saeubere(n.daten);
        this.standBald();
        break;
      case 'werte':
        spieler.werte = saeubere(n.daten);
        break;
      case 'e':
        this.nimmEingabe(spieler, n);
        break;
      case 'nachholen':
        this.sendeTestStand(spieler);
        break;
      case 'pz':
        spieler.zwischen = saeubere({ n: n.n, h: n.h });
        break;
      case 'ergebnis':
        spieler.ergebnis = saeubere({ n: n.n, h: n.h });
        this.standBald();
        break;
    }
  }

  private nimmEingabe(spieler: Spieler, n: any) {
    const test = this.test;
    if (!test?.laeuft || test.takt === 0) return;
    const gruppe = this.gruppeVon(spieler.id);
    if (!gruppe || spieler.eingabenImTakt >= MAX_EINGABEN_PRO_TAKT) return;
    spieler.eingabenImTakt++;
    const folge = Number.isInteger(n.s) ? n.s : 0;
    const x = Number.isInteger(n.x) ? Math.max(0, Math.min(319, n.x)) : 0;
    let feuer = n.f === 1 ? 1 : 0;
    if (feuer) {
      if (test.takt - spieler.letzterSchuss < MIN_TAKTE_ZWISCHEN_SCHUESSEN) feuer = 0;
      else spieler.letzterSchuss = test.takt;
    }
    gruppe.puffer.push([spieler.nr, folge, x, feuer]);
  }

  // --- Nachrichten des Beamers ---------------------------------------------

  private vomBeamer(n: any) {
    switch (n.typ) {
      case 'starte':
        this.starteTest(ERLAUBTE_DAUERN.includes(n.dauer) ? n.dauer : 60);
        break;
      case 'stoppe':
        if (this.test?.laeuft) this.beendeTest();
        break;
      case 'modus':
        if (n.wert === 'auto' || n.wert === 'direktfinale' || n.wert === 'qualifying') this.modus = n.wert;
        break;
      case 'sperre':
        this.gesperrt = n.wert === true;
        break;
      case 'entferne': {
        const spieler = typeof n.id === 'string' ? this.spieler.get(n.id) : undefined;
        if (spieler) {
          if (spieler.ws) {
            sende(spieler.ws, { typ: 'entfernt' });
            spieler.ws.close(4005, 'entfernt');
          }
          this.spieler.delete(spieler.id);
        }
        break;
      }
      case 'aufraeumen':
        for (const [id, spieler] of this.spieler) if (!spieler.ws) this.spieler.delete(id);
        break;
    }
    this.sendeStand();
  }

  // --- Netztest ------------------------------------------------------------

  private starteTest(dauerSekunden: number) {
    if (this.test?.laeuft) return;
    const verbunden = [...this.spieler.values()].filter((s) => s.ws).map((s) => s.id);
    const einteilung = teileGruppen(verbunden, this.modus);
    if (einteilung.art === 'zuwenig') {
      if (this.beamer) sende(this.beamer, { typ: 'meldung', text: 'Für den Test braucht es mindestens 2 verbundene Handys.' });
      return;
    }

    const gruppen: Gruppe[] = einteilung.gruppen.map((mitglieder, i) => ({
      name: einteilung.art === 'direktfinale' ? 'Finale' : `Gruppe ${i + 1}`,
      seed: crypto.getRandomValues(new Uint32Array(1))[0],
      mitglieder,
      puffer: [],
      feuer: [],
    }));
    for (const spieler of this.spieler.values()) {
      spieler.zwischen = null;
      spieler.ergebnis = null;
      spieler.abbruecheTest = 0;
      spieler.letzterSchuss = -999;
    }
    this.test = {
      laeuft: true,
      art: einteilung.art,
      hinweis: einteilung.hinweis,
      dauerMs: dauerSekunden * 1000,
      start: Date.now() + VORLAUF_MS,
      takt: 0,
      gruppen,
      intervall: null,
      serverTakt: { anzahl: 0, summe: 0, max: 0, zuletzt: 0 },
    };
    for (const id of verbunden) this.sendeTestStand(this.spieler.get(id)!);

    const test = this.test;
    setTimeout(() => {
      if (this.test !== test || !test.laeuft) return;
      test.start = Date.now();
      test.serverTakt.zuletzt = test.start;
      test.intervall = setInterval(() => this.takt(test), TAKT_MS);
    }, VORLAUF_MS);
    this.sendeStand();
  }

  private takt(test: Test) {
    const jetzt = Date.now();
    const st = test.serverTakt;
    const abstand = jetzt - st.zuletzt;
    st.zuletzt = jetzt;
    st.anzahl++;
    st.summe += abstand;
    if (abstand > st.max) st.max = abstand;

    test.takt++;
    for (const gruppe of test.gruppen) {
      const eingaben = gruppe.puffer;
      gruppe.puffer = [];
      const schuesse = eingaben.filter((e) => e[3] === 1).map((e) => [e[0], e[2]]);
      if (schuesse.length) gruppe.feuer.push([test.takt, schuesse]);
      const text = JSON.stringify({ typ: 't', n: test.takt, e: eingaben });
      for (const id of gruppe.mitglieder) {
        const ws = this.spieler.get(id)?.ws;
        if (ws) sendeText(ws, text);
      }
    }
    for (const spieler of this.spieler.values()) spieler.eingabenImTakt = 0;

    if (jetzt - test.start >= test.dauerMs) this.beendeTest();
  }

  private beendeTest() {
    const test = this.test;
    if (!test) return;
    test.laeuft = false;
    if (test.intervall) clearInterval(test.intervall);
    test.intervall = null;
    for (const spieler of this.spieler.values()) {
      if (!spieler.ws) continue;
      // Wer erst während des Tests kam, geht zurück in die Lobby.
      if (this.gruppeVon(spieler.id)) sende(spieler.ws, { typ: 'test', phase: 'ende', n: test.takt });
      else sende(spieler.ws, { typ: 'lobby' });
    }
    this.sendeStand();
  }

  private gruppeVon(id: string): Gruppe | undefined {
    return this.test?.gruppen.find((g) => g.mitglieder.includes(id));
  }

  /** Schickt einem Handy alles, was es zum (Wieder-)Einstieg in den Test braucht. */
  private sendeTestStand(spieler: Spieler) {
    const test = this.test;
    if (!spieler.ws || !test) return;
    const gruppe = this.gruppeVon(spieler.id);
    if (!gruppe) {
      if (test.laeuft) sende(spieler.ws, { typ: 'test', phase: 'zuschauen' });
      return;
    }
    sende(spieler.ws, {
      typ: 'test',
      phase: test.laeuft ? 'laeuft' : 'ende',
      n: test.takt,
      dauerMs: test.dauerMs,
      restMs: test.laeuft ? Math.max(0, test.start + test.dauerMs - Date.now()) : 0,
      taktMs: TAKT_MS,
      gruppe: {
        name: gruppe.name,
        seed: gruppe.seed,
        mitglieder: gruppe.mitglieder
          .map((id) => this.spieler.get(id))
          .filter((s): s is Spieler => !!s)
          .map((s) => ({ nr: s.nr, name: s.name })),
      },
      verlauf: { bis: test.takt, feuer: gruppe.feuer },
    });
  }

  // --- Stand für den Beamer ------------------------------------------------

  private standBald() {
    if (this.standGeplant || !this.beamer) return;
    this.standGeplant = true;
    setTimeout(() => {
      this.standGeplant = false;
      this.sendeStand();
    }, 200);
  }

  private sendeStand() {
    if (!this.beamer) return;
    const test = this.test;
    sende(this.beamer, {
      typ: 'stand',
      gesperrt: this.gesperrt,
      modus: this.modus,
      spieler: [...this.spieler.values()].map((s) => ({
        id: s.id,
        nr: s.nr,
        name: s.name,
        verbunden: !!s.ws,
        abbruecheGesamt: s.abbruecheGesamt,
        abbruecheTest: s.abbruecheTest,
        geraet: s.geraet,
        bench: s.bench,
        werte: s.werte,
        zwischen: s.zwischen,
        ergebnis: s.ergebnis,
      })),
      test: test && {
        laeuft: test.laeuft,
        art: test.art,
        hinweis: test.hinweis,
        dauerMs: test.dauerMs,
        restMs: test.laeuft ? Math.max(0, Math.min(test.dauerMs, test.start + test.dauerMs - Date.now())) : 0,
        takt: test.takt,
        gruppen: test.gruppen.map((g) => ({ name: g.name, mitglieder: g.mitglieder })),
        serverTakt: {
          anzahl: test.serverTakt.anzahl,
          schnittMs: test.serverTakt.anzahl ? Math.round((test.serverTakt.summe / test.serverTakt.anzahl) * 10) / 10 : null,
          maxMs: test.serverTakt.max,
        },
      },
    });
  }
}
