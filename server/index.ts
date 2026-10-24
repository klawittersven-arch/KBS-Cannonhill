import { Raum, type Env } from './raum';

export { Raum };

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const treffer = /^\/ws\/(\d{4})$/.exec(url.pathname);
    if (treffer) {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('Hier geht es nur per WebSocket weiter.', { status: 426 });
      }
      const raum = env.RAUM.get(env.RAUM.idFromName(treffer[1]));
      return raum.fetch(request);
    }
    // Alles andere sind die Webseiten aus public/.
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
