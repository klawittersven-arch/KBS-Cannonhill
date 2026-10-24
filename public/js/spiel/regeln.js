// Spielwerte aus dem Original (panzer.h und InitStructs in panzer.cpp von Dirk Plate).

export const BREITE = 640;
export const HOEHE = 480;
export const BEREICHE = 32; // das Feld ist für die aktiven Pixel in 32×32 Bereiche geteilt
export const BEREICH_B = BREITE / BEREICHE;
export const BEREICH_H = HOEHE / BEREICHE;

export const G = 9.81; // Erdanziehung
export const T = 0.08; // Zeit pro Physikschritt
export const IMPULSABGABE = 0.6; // Anteil der Geschwindigkeit, der an ein getroffenes Pixel geht
export const SCHNEEDICKE = 3;
export const GRASDICKE = 2;
export const ERDDICKE = 10;
export const KANONENLAENGE = 20;
export const HIMMELHOEHE = 470; // so viele Pixel werden oberhalb des Bildes weitergerechnet
export const MAX_HIMMELPIXEL = 500;
export const MAX_MUN = 100; // so viele Geschosse können gleichzeitig fliegen
export const MAX_SCHUSSENERGIE = 50;
export const MAX_LEBENSENERGIE = 500; // Original 1000 – halbiert für kürzere Partien
export const SALVE_SEKUNDEN = 3; // alle 3 Sekunden feuern alle Panzer gleichzeitig
export const START_KRAFT = 30;
export const MAGNETKONSTANTE = 50000;
export const BALLON_ZUFALL = 5000;
export const MAX_SPIELER = 8; // im Original 4; das Finale braucht bis zu 8

// Die SDL-Fassung rechnet 60 Physikschritte pro Sekunde; das Netz taktet mit 20 Hz.
export const BILDER_PRO_SEKUNDE = 60;
export const BILDER_PRO_TAKT = 3;

// Bildgrößen (für Treffer – im Original aus den Bitmaps)
export const PANZER_B = 20;
export const PANZER_H = 10;
export const MUN_B = 10;
export const MUN_H = 10;
export const BALLON_B = 32;
export const BALLON_H = 55;

// Materialien
export const LUFT = 0;
export const GRAS = 1;
export const WASSER = 2;
export const STEIN = 3;
export const SCHNEE = 4;
export const ERDE = 5;
export const PANZER = 6;
export const MUNITION = 7;
export const SAEURE = 8;
export const ARTEN = 9;

export const MASSE = Float64Array.of(0, 50, 100, 200, 20, 80, 500, 100, 100);
export const REIBUNG = Float64Array.of(0.3, 2.0, 0, 3.0, 1.0, 1.5, 2.0, 1.0, 0);
export const FARBE = [
  [255, 0, 255], [0, 150, 0], [100, 100, 255], [150, 150, 150], [255, 255, 255],
  [140, 111, 50], [255, 0, 0], [255, 0, 0], [0, 255, 0],
];
export const FARBSTREUUNG = 15;

// Munition (Reihenfolge wie im Original)
export const M_NICHTS = 0;
export const M_RAKETE = 1;
export const M_SCHILD = 2;
export const M_STEIN = 3;
export const M_GRANATE = 4;
export const M_LASER = 5;
export const M_GEWEHR = 6;
export const M_FASS = 7;
export const M_MEDI = 8;
export const M_MAGRAKETE = 9;
export const M_MAGNET = 10;
export const M_MEGA = 11;
export const M_SCHNEEBALL = 12;
export const M_SPLITTER = 13;
export const MUN_ANZAHL = 14;

export const EXP_NICHTS = 0;
export const EXP_KRATER = 1;
export const EXP_EXPLOSION = 2;
export const EXP_GRANATE = 3;
export const EXP_SPLITTER = 4;
export const EXP_FASS = 5;
export const EXP_MEGA = 6;
export const EXP_SCHNEEBALL = 7;

export const RAUCH_NICHTS = 0;
export const RAUCH_RAUCH = 1;
export const RAUCH_FEUER = 2;

const mun = (name, bild, explosion, rauch, schaden, dauer, preis) => ({ name, bild, explosion, rauch, schaden, dauer, preis });

/** Eigenschaften je Munitionsart; bild = Spalte in Munition.png, dauer -1 = unbegrenzt. */
export const MUNITIONEN = [
  mun('–', 0, EXP_NICHTS, [0, 0], 0, -1, 0),
  mun('Rakete', 0, EXP_EXPLOSION, [RAUCH_RAUCH, RAUCH_FEUER], 300, -1, 70),
  mun('Schild', 1, EXP_NICHTS, [0, 0], 0, 500, 200),
  mun('Stein', 2, EXP_KRATER, [0, 0], 200, -1, 0),
  mun('Granate', 3, EXP_GRANATE, [RAUCH_FEUER, 0], 300, 100, 80),
  mun('Laser', 4, EXP_NICHTS, [0, 0], 500, 10, 250),
  mun('Gewehr', 5, EXP_SPLITTER, [0, 0], 300, -1, 150),
  mun('Säurefass', 6, EXP_FASS, [0, 0], 100, 200, 130),
  mun('Medipack', 7, EXP_NICHTS, [0, 0], 0, -1, 500),
  mun('Magnetrakete', 8, EXP_EXPLOSION, [RAUCH_RAUCH, RAUCH_FEUER], 300, -1, 155),
  mun('Magnet', 9, EXP_NICHTS, [0, 0], 0, 500, 180),
  mun('Megabombe', 10, EXP_MEGA, [0, 0], 0, 300, 850),
  mun('Schneeball', 11, EXP_SCHNEEBALL, [0, 0], 0, 300, 25),
  mun('Splitter', 12, EXP_SPLITTER, [RAUCH_RAUCH, 0], 100, -1, 0),
];

/** Lager zu Spielbeginn (-1 = unbegrenzt). */
export function startLager() {
  const lager = new Int16Array(MUN_ANZAHL);
  lager[M_STEIN] = -1;
  lager[M_RAKETE] = 4;
  lager[M_SCHILD] = 1;
  lager[M_GRANATE] = 2;
  lager[M_FASS] = 2;
  lager[M_SCHNEEBALL] = 2;
  return lager;
}

/**
 * Alle Kanonenstellungen, die man im Original mit den Pfeiltasten erreicht
 * (MoveKanone), von ganz links nach ganz rechts. Fest eingetragen, damit kein
 * Gerät dafür selbst Wurzeln ziehen muss.
 */
export const KANONE = [
  [-20, -2], [-20, -3], [-20, -4], [-19, -4], [-19, -5], [-19, -6], [-19, -7], [-19, -8], [-18, -8], [-18, -9],
  [-18, -10], [-17, -10], [-17, -11], [-16, -11], [-16, -12], [-16, -13], [-15, -13], [-15, -14], [-14, -14], [-14, -15],
  [-13, -15], [-13, -16], [-12, -16], [-11, -16], [-11, -17], [-10, -17], [-10, -18], [-9, -18], [-8, -18], [-8, -19],
  [-7, -19], [-6, -19], [-5, -19], [-4, -19], [-4, -20], [-3, -20], [-2, -20], [-1, -20], [0, -20], [1, -20],
  [2, -20], [3, -20], [4, -20], [4, -19], [5, -19], [6, -19], [7, -19], [8, -19], [8, -18], [9, -18],
  [10, -18], [10, -17], [11, -17], [11, -16], [12, -16], [13, -16], [13, -15], [14, -15], [14, -14], [15, -14],
  [15, -13], [16, -13], [16, -12], [16, -11], [17, -11], [17, -10], [18, -10], [18, -9], [18, -8], [19, -8],
  [19, -7], [19, -6], [19, -5], [19, -4], [20, -4], [20, -3], [20, -2],
];
export const KANONE_SENKRECHT = 38;

/** Spielerfarben: die vier des Originals, dazu vier weitere fürs Finale. */
export const SPIELERFARBEN = [
  [255, 0, 0], [0, 255, 0], [100, 100, 255], [255, 255, 0],
  [255, 140, 0], [190, 90, 255], [0, 220, 220], [255, 90, 180],
];
