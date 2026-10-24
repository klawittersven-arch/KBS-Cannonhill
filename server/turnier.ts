import { DurableObject } from 'cloudflare:workers';
import { teileGruppen, MAX_SPIELER } from '../public/js/gruppen.js';
import { normalisiereName, sende, sendeText } from './hilfen';
import type { Env } from './env';

// Ein Klassen-Turnier: Lobby → Qualifying in Gruppen → Finale → Siegerehrung.
// Der Server rechnet das Spiel nicht selbst: Er gibt jeder Partie den Takt vor
// und verteilt die Eingaben. Jedes Handy (und im Finale der Beamer) rechnet
// die Partie bit-genau gleich; das Ergebnis melden die Handys.

const TAKT_MS = 50; // 20 Takte pro Sekunde
const VORLAUF_MS = 2500; // Zeit zum Laden und Aufbauen vor dem ersten Takt
const NACHLAUF_TAKTE = 60; // nach dem Ergebnis noch 3 s weiter (Explosionen ausklingen lassen)
const STAND_MS = 1000;
const MAX_EINGABEN_PRO_TAKT = 4;

type Phase = 'lobby' | 'qualifying' | 'finale' | 'siegerehrung';
type Modus = 'auto' | 'direktfinale' | 'qualifying';

interface Optionen {
  alleWaffen: boolean;
  wind: boolean;
  wetter: boolean;
  modus: Modus;
  suddenDeath: number; // Sekunden
  ende: number; // Sekunden
}

interface Spieler {
  id: string;
  nr: number;
  name: string;
  ws: WebSocket | null;
}

type Eingabe = (number | null)[]; // [nr, Kanonenstellung, Kraft, Munition]

interface Partie {
  id: string;
  art: 'quali' | 'finale';
  name: string;
  seed: number;
  mitglieder: string[]; // Spieler-IDs in Panzer-Reihenfolge
  optionen: Optionen;
  takt: number;
  laeuft: boolean;
  startZeit: number;
  verlauf: [number, Eingabe[]][];
  puffer: Eingabe[];
  eingabenImTakt: Map<number, number>;
  ergebnis: { sieger: number; grund: string; n: number; h: string } | null;
  abweichung: boolean;
  abgebrochen: boolean;
  endeTakt: number | null;
  maxTakte: number;
  lage: { n: number; p: number[][] } | null;
}

export class Turnier extends DurableObject<Env> {
  private spieler = new Map<string, Spieler>();
  private naechsteNr = 1;
  private beamer: WebSocket | null = null;
  private beamerToken: string | null = null;
  private gesperrt = false;
  private phase: Phase = 'lobby';
  private optionen: Optionen = { alleWaffen: false, wind: false, wetter: false, modus: 'auto', suddenDeath: 120, ende: 130 };
  private partien = new Map<string, Partie>();
  private naechstePartie = 1;
  private finalisten: string[] = [];
  private sieger: string | null = null;
  private schleife: ReturnType<typeof setInterval> | null = null;
  private standIntervall: ReturnType<typeof setInterval> | null = null;
  private standGeplant = false;

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket erwartet', { status: 426 });
    const paar = new WebSocketPair();
    const [client, server] = Object.values(paar);
    server.accept();
    this.verbinde(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  // --- Verbindungen --------------------------------------------------------------

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
      if (n.typ === 'ping') return sende(ws, { typ: 'pong', t: n.t });
      if (!rolle) {
        if (n.typ === 'hallo') rolle = n.rolle === 'beamer' ? this.begruesseBeamer(ws, n) : this.begruesseHandy(ws, n);
        return;
      }
      if (rolle.art === 'handy') this.vomHandy(rolle.spieler, n);
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
    const finale = this.aktuellesFinale();
    if (finale) this.sendeSpiel(ws, finale);
    if (!this.standIntervall) this.standIntervall = setInterval(() => this.sendeStand(), STAND_MS);
    return { art: 'beamer' };
  }

  private begruesseHandy(ws: WebSocket, n: any): { art: 'handy'; spieler: Spieler } | null {
    const id = typeof n.id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(n.id) ? n.id : null;
    if (!id) return this.lehneAb(ws, 'Ungültige Anmeldung – bitte Seite neu laden.');
    let spieler = this.spieler.get(id);
    if (spieler) {
      if (spieler.ws && spieler.ws !== ws) spieler.ws.close(4003, 'Neu verbunden');
      spieler.ws = ws;
    } else {
      if (this.gesperrt) return this.lehneAb(ws, 'Der Raum ist gesperrt. Frag deine Lehrkraft.');
      if (this.spieler.size >= MAX_SPIELER) return this.lehneAb(ws, 'Der Raum ist voll.');
      const name = normalisiereName(n.vorname, n.initial);
      if (!name) return this.lehneAb(ws, 'Bitte Vorname und Anfangsbuchstaben des Nachnamens eingeben.');
      spieler = { id, nr: this.naechsteNr++, name: this.eindeutigerName(name), ws };
      this.spieler.set(id, spieler);
    }
    sende(ws, { typ: 'willkommen', nr: spieler.nr, name: spieler.name });
    this.sendeTurnier(spieler);
    const partie = this.laufendePartieVon(id);
    if (partie) this.sendeSpiel(ws, partie);
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
    for (let i = 2; ; i++) if (!vergeben.has(`${name} (${i})`)) return `${name} (${i})`;
  }

  // --- Nachrichten ------------------------------------------------------------------

  private vomHandy(spieler: Spieler, n: any) {
    const partie = typeof n.s === 'string' ? this.partien.get(n.s) : undefined;
    if (!partie || !partie.mitglieder.includes(spieler.id)) return;
    switch (n.typ) {
      case 'e':
        return this.nimmEingabe(partie, spieler, n);
      case 'nachholen':
        if (spieler.ws) this.sendeSpiel(spieler.ws, partie);
        return;
      case 'lage':
        if (Number.isInteger(n.n) && Array.isArray(n.p) && n.n > (partie.lage?.n ?? -1)) {
          partie.lage = { n: n.n, p: n.p.slice(0, 8).map((x: unknown) => (Array.isArray(x) ? x.slice(0, 3).map((z) => (typeof z === 'number' ? z : 0)) : [])) };
        }
        return;
      case 'ende':
        return this.nimmErgebnis(partie, n);
    }
  }

  private vomBeamer(n: any) {
    switch (n.typ) {
      case 'optionen': {
        if (this.phase !== 'lobby') break;
        const o = n.optionen || {};
        if (typeof o.alleWaffen === 'boolean') this.optionen.alleWaffen = o.alleWaffen;
        if (typeof o.wind === 'boolean') this.optionen.wind = o.wind;
        if (typeof o.wetter === 'boolean') this.optionen.wetter = o.wetter;
        if (o.modus === 'auto' || o.modus === 'direktfinale' || o.modus === 'qualifying') this.optionen.modus = o.modus;
        // nur für Tests: kürzere Spielzeit
        if (Number.isInteger(o.ende) && o.ende >= 10 && o.ende <= 130) {
          this.optionen.ende = o.ende;
          this.optionen.suddenDeath = Math.max(5, o.ende - 10);
        }
        break;
      }
      case 'starte':
        this.starteTurnier();
        break;
      case 'finale':
        this.starteFinale();
        break;
      case 'abbrechen':
      case 'neu':
        this.zurLobby();
        break;
      case 'nachholen': {
        const finale = this.aktuellesFinale();
        if (finale && this.beamer) this.sendeSpiel(this.beamer, finale);
        break;
      }
      case 'sperre':
        this.gesperrt = n.wert === true;
        break;
      case 'entferne': {
        const spieler = typeof n.id === 'string' ? this.spieler.get(n.id) : undefined;
        if (spieler && !this.laufendePartieVon(spieler.id)) {
          if (spieler.ws) {
            sende(spieler.ws, { typ: 'entfernt' });
            spieler.ws.close(4005, 'entfernt');
          }
          this.spieler.delete(spieler.id);
        }
        break;
      }
      case 'aufraeumen':
        for (const [id, s] of this.spieler) if (!s.ws && !this.laufendePartieVon(id)) this.spieler.delete(id);
        break;
    }
    this.sendeStand();
  }

  // --- Turnierablauf ------------------------------------------------------------------

  private starteTurnier() {
    if (this.phase !== 'lobby') return;
    const verbunden = [...this.spieler.values()].filter((s) => s.ws).map((s) => s.id);
    const einteilung = teileGruppen(verbunden, this.optionen.modus);
    if (einteilung.art === 'zuwenig') {
      if (this.beamer) sende(this.beamer, { typ: 'meldung', text: 'Für ein Turnier braucht es mindestens 2 Handys.' });
      return;
    }
    this.partien.clear();
    this.finalisten = [];
    this.sieger = null;
    if (einteilung.art === 'direktfinale') {
      this.phase = 'finale';
      this.startePartie('finale', 'Finale', einteilung.gruppen[0]);
    } else {
      this.phase = 'qualifying';
      einteilung.gruppen.forEach((g, i) => this.startePartie('quali', `Gruppe ${i + 1}`, g));
    }
    this.sendeAllenTurnier();
  }

  private starteFinale() {
    if (this.phase !== 'qualifying' || !this.qualifyingFertig()) return;
    const finalisten = this.finalisten.filter((id) => this.spieler.has(id));
    if (finalisten.length < 2) {
      if (finalisten.length === 1) return this.kuereSieger(finalisten[0]);
      if (this.beamer) sende(this.beamer, { typ: 'meldung', text: 'Es gibt keine Finalisten – bitte neu starten.' });
      return;
    }
    this.phase = 'finale';
    this.startePartie('finale', 'Finale', finalisten);
    this.sendeAllenTurnier();
  }

  private zurLobby() {
    for (const p of this.partien.values()) p.laeuft = false;
    this.partien.clear();
    this.phase = 'lobby';
    this.finalisten = [];
    this.sieger = null;
    this.sendeAllenTurnier();
  }

  private kuereSieger(id: string) {
    this.sieger = id;
    this.phase = 'siegerehrung';
    this.sendeAllenTurnier();
    this.sendeStand();
  }

  private qualifyingFertig() {
    const quali = [...this.partien.values()].filter((p) => p.art === 'quali');
    return quali.length > 0 && quali.every((p) => p.ergebnis || p.abgebrochen);
  }

  private aktuellesFinale(): Partie | undefined {
    if (this.phase !== 'finale') return undefined;
    return [...this.partien.values()].find((p) => p.art === 'finale');
  }

  private laufendePartieVon(id: string): Partie | undefined {
    return [...this.partien.values()].find((p) => !p.abgebrochen && p.mitglieder.includes(id) &&
      ((p.art === 'quali' && this.phase === 'qualifying') || (p.art === 'finale' && this.phase === 'finale')));
  }

  // --- Partien und Takt ------------------------------------------------------------------

  private startePartie(art: 'quali' | 'finale', name: string, mitglieder: string[]) {
    const partie: Partie = {
      id: `p${this.naechstePartie++}`,
      art,
      name,
      seed: crypto.getRandomValues(new Uint32Array(1))[0],
      mitglieder,
      optionen: { ...this.optionen },
      takt: 0,
      laeuft: true,
      startZeit: Date.now() + VORLAUF_MS,
      verlauf: [],
      puffer: [],
      eingabenImTakt: new Map(),
      ergebnis: null,
      abweichung: false,
      abgebrochen: false,
      endeTakt: null,
      maxTakte: (this.optionen.ende + 10) * 20,
      lage: null,
    };
    this.partien.set(partie.id, partie);
    for (const ws of this.empfaenger(partie)) this.sendeSpiel(ws, partie);
    if (!this.schleife) this.schleife = setInterval(() => this.takt(), TAKT_MS);
  }

  private takt() {
    const jetzt = Date.now();
    let laufend = 0;
    for (const p of this.partien.values()) {
      if (!p.laeuft) continue;
      laufend++;
      if (jetzt < p.startZeit) continue;
      p.takt++;
      const e = p.puffer;
      p.puffer = [];
      p.eingabenImTakt.clear();
      if (e.length) p.verlauf.push([p.takt, e]);
      const text = JSON.stringify({ typ: 't', s: p.id, n: p.takt, e });
      for (const ws of this.empfaenger(p)) sendeText(ws, text);
      if ((p.endeTakt !== null && p.takt >= p.endeTakt) || p.takt >= p.maxTakte) {
        p.laeuft = false;
        if (!p.ergebnis) {
          p.abgebrochen = true; // niemand hat ein Ergebnis gemeldet
          this.nachErgebnis(p);
        }
      }
    }
    if (!laufend && this.schleife) {
      clearInterval(this.schleife);
      this.schleife = null;
    }
  }

  /** Wer bekommt die Takte einer Partie? Ihre Spieler – und beim Finale der Beamer. */
  private empfaenger(p: Partie): WebSocket[] {
    const liste: WebSocket[] = [];
    for (const id of p.mitglieder) {
      const ws = this.spieler.get(id)?.ws;
      if (ws) liste.push(ws);
    }
    if (p.art === 'finale' && this.beamer) liste.push(this.beamer);
    return liste;
  }

  private nimmEingabe(p: Partie, spieler: Spieler, n: any) {
    if (!p.laeuft || p.ergebnis) return; // vor dem ersten Takt: gilt ab Takt 1
    const bisher = p.eingabenImTakt.get(spieler.nr) ?? 0;
    if (bisher >= MAX_EINGABEN_PRO_TAKT) return;
    p.eingabenImTakt.set(spieler.nr, bisher + 1);
    const zahl = (wert: unknown, min: number, max: number) => (Number.isInteger(wert) && (wert as number) >= min && (wert as number) <= max ? (wert as number) : null);
    const eingabe: Eingabe = [spieler.nr, zahl(n.w, 0, 76), zahl(n.k, 1, 50), zahl(n.m, 1, 12)];
    if (eingabe[1] === null && eingabe[2] === null && eingabe[3] === null) return;
    p.puffer.push(eingabe);
  }

  /** Erstes gemeldetes Ergebnis gilt; abweichende Meldungen werden markiert. */
  private nimmErgebnis(p: Partie, n: any) {
    const sieger = Number.isInteger(n.sieger) ? n.sieger : null;
    const siegerSpieler = p.mitglieder.map((id) => this.spieler.get(id)).find((s) => s?.nr === sieger);
    if (!siegerSpieler || typeof n.h !== 'string') return;
    if (p.ergebnis) {
      if (p.ergebnis.sieger !== sieger || p.ergebnis.h !== n.h || p.ergebnis.n !== n.n) p.abweichung = true;
      return;
    }
    p.ergebnis = { sieger, grund: String(n.grund ?? '').slice(0, 20), n: Number(n.n) || 0, h: n.h.slice(0, 16) };
    p.endeTakt = p.takt + NACHLAUF_TAKTE;
    const nachricht = { typ: 'ergebnis', s: p.id, art: p.art, sieger, name: siegerSpieler.name, grund: p.ergebnis.grund };
    for (const id of p.mitglieder) {
      const ws = this.spieler.get(id)?.ws;
      if (ws) sende(ws, nachricht);
    }
    this.nachErgebnis(p);
  }

  private nachErgebnis(p: Partie) {
    if (p.art === 'quali') {
      if (p.ergebnis) {
        const id = p.mitglieder.find((m) => this.spieler.get(m)?.nr === p.ergebnis!.sieger);
        if (id && !this.finalisten.includes(id)) this.finalisten.push(id);
      }
    } else if (p.ergebnis) {
      const id = p.mitglieder.find((m) => this.spieler.get(m)?.nr === p.ergebnis!.sieger);
      // kurz warten, damit alle die letzte Explosion sehen
      if (id) setTimeout(() => this.phase === 'finale' && this.kuereSieger(id), 3500);
    }
    this.standBald();
  }

  // --- Nachrichten an Handys und Beamer -----------------------------------------------

  /** Alles, was ein Gerät zum (Wieder-)Einstieg in eine Partie braucht. */
  private sendeSpiel(ws: WebSocket, p: Partie) {
    sende(ws, {
      typ: 'spiel',
      s: p.id,
      art: p.art,
      name: p.name,
      seed: p.seed,
      spieler: p.mitglieder.map((id) => {
        const s = this.spieler.get(id);
        return { nr: s?.nr ?? 0, name: s?.name ?? '?' };
      }),
      optionen: { alleWaffen: p.optionen.alleWaffen, wind: p.optionen.wind, wetter: p.optionen.wetter, suddenDeath: p.optionen.suddenDeath, ende: p.optionen.ende },
      startInMs: Math.max(0, p.startZeit - Date.now()),
      verlauf: { bis: p.takt, eingaben: p.verlauf },
      ergebnis: p.ergebnis && { sieger: p.ergebnis.sieger, grund: p.ergebnis.grund },
    });
  }

  /** Phase und eigene Rolle für ein Handy. */
  private sendeTurnier(s: Spieler) {
    if (!s.ws) return;
    const partie = this.laufendePartieVon(s.id);
    const siegerName = this.sieger ? this.spieler.get(this.sieger)?.name ?? null : null;
    sende(s.ws, {
      typ: 'turnier',
      phase: this.phase,
      rolle: partie ? 'spieler' : this.phase === 'lobby' || this.phase === 'siegerehrung' ? 'lobby' : 'zuschauer',
      partie: partie?.id ?? null,
      finalist: this.finalisten.includes(s.id),
      sieger: siegerName,
      ichBinSieger: this.sieger === s.id,
    });
  }

  private sendeAllenTurnier() {
    for (const s of this.spieler.values()) this.sendeTurnier(s);
    this.sendeStand();
  }

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
    const name = (id: string | null) => (id ? this.spieler.get(id)?.name ?? '?' : null);
    sende(this.beamer, {
      typ: 'stand',
      phase: this.phase,
      optionen: this.optionen,
      gesperrt: this.gesperrt,
      spieler: [...this.spieler.values()].map((s) => ({ id: s.id, nr: s.nr, name: s.name, verbunden: !!s.ws })),
      partien: [...this.partien.values()].map((p) => ({
        id: p.id,
        art: p.art,
        name: p.name,
        mitglieder: p.mitglieder,
        laeuft: p.laeuft,
        takt: p.takt,
        startInMs: Math.max(0, p.startZeit - Date.now()),
        ergebnis: p.ergebnis && { sieger: p.ergebnis.sieger, grund: p.ergebnis.grund },
        abweichung: p.abweichung,
        abgebrochen: p.abgebrochen,
        lage: p.lage,
      })),
      finalisten: this.finalisten,
      qualifyingFertig: this.qualifyingFertig(),
      sieger: this.sieger && { id: this.sieger, name: name(this.sieger) },
    });
  }
}
