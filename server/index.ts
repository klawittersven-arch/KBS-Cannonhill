import { Raum } from './raum';
import { Turnier } from './turnier';
import type { Env } from './env';

export { Raum, Turnier };

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    // /ws/<code>: Netztest, /spiel/<code>: Turnier
    const treffer = /^\/(ws|spiel)\/(\d{4})$/.exec(url.pathname);
    if (treffer) {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('Hier geht es nur per WebSocket weiter.', { status: 426 });
      }
      if (treffer[1] === 'ws') return env.RAUM.get(env.RAUM.idFromName(treffer[2])).fetch(request);
      return env.TURNIER.get(env.TURNIER.idFromName(treffer[2])).fetch(request);
    }
    // Alles andere sind die Webseiten aus public/.
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
