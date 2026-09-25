import type { LiveMessage } from '@pulse/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp, pageview, type TestApp } from './helpers.js';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.app.close();
});

function nextMessage(ws: WebSocket, predicate: (m: LiveMessage) => boolean): Promise<LiveMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), 3000);
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(String(e.data)) as LiveMessage;
      if (predicate(m)) {
        clearTimeout(timer);
        resolve(m);
      }
    });
  });
}

describe('WebSocket live feed', () => {
  it('greets subscribers and streams pageviews and uptime checks', async () => {
    t = await createTestApp();
    const address = await t.app.listen({ port: 0, host: '127.0.0.1' });
    const ws = new WebSocket(`${address.replace('http', 'ws')}/api/live?site=demo`);
    const hello = await nextMessage(ws, (m) => m.type === 'hello');
    expect(hello).toMatchObject({ type: 'hello', siteId: 'demo', active: 0 });

    const view = nextMessage(ws, (m) => m.type === 'pageview');
    await pageview(t.app, { path: '/live' });
    expect(await view).toMatchObject({
      type: 'pageview',
      active: 1,
      event: { path: '/live', device: 'desktop' },
    });

    const check = nextMessage(ws, (m) => m.type === 'check');
    t.ctx.uptime.record({
      monitorId: 'x',
      ts: Date.now(),
      ok: true,
      status: 200,
      latencyMs: 40,
      error: null,
    });
    expect(await check).toMatchObject({ type: 'check', check: { monitorId: 'x' } });
    ws.close();
  });

  it('closes the socket for unknown sites', async () => {
    t = await createTestApp();
    const address = await t.app.listen({ port: 0, host: '127.0.0.1' });
    const ws = new WebSocket(`${address.replace('http', 'ws')}/api/live?site=nope`);
    const code = await new Promise<number>((resolve) =>
      ws.addEventListener('close', (e) => resolve(e.code)),
    );
    expect(code).toBe(1008);
  });
});
