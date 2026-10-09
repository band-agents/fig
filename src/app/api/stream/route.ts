import { currentUser } from '@/lib/auth/session';
import { bus, presence, type LiveEvent } from '@/lib/bus';

export const dynamic = 'force-dynamic';

function broadcastPresence() {
  bus.emit('presence', [...presence.entries()].map(([id, p]) => ({ id, name: p.name, hue: p.hue })));
}

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return new Response('signed out', { status: 401 });
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {}
      };
      const onLive = (e: LiveEvent) => {
        if (e.channelId && user.channels.length && !user.channels.includes(e.channelId)) return;
        send('live', e);
      };
      const onPresence = (list: unknown) => send('presence', list);
      bus.on('live', onLive);
      bus.on('presence', onPresence);

      const p = presence.get(user.id) ?? { name: user.name, hue: user.hue, since: Date.now(), conns: 0 };
      p.conns++;
      presence.set(user.id, p);
      broadcastPresence();
      send('hello', { at: new Date().toISOString() });

      const beat = setInterval(() => {
        try {
          controller.enqueue(enc.encode(`: beat\n\n`));
        } catch {}
      }, 20_000);

      req.signal.addEventListener('abort', () => {
        clearInterval(beat);
        bus.off('live', onLive);
        bus.off('presence', onPresence);
        const cur = presence.get(user.id);
        if (cur && --cur.conns <= 0) presence.delete(user.id);
        broadcastPresence();
        try {
          controller.close();
        } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' },
  });
}
