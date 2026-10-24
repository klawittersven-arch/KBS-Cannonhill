import type { Raum } from './raum';
import type { Turnier } from './turnier';

export interface Env {
  RAUM: DurableObjectNamespace<Raum>;
  TURNIER: DurableObjectNamespace<Turnier>;
  ASSETS: Fetcher;
}
