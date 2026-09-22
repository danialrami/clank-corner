import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, SERVICE_LIMITS, type Clock } from '../src/server.js';
import { verifyReplay, type ActionType } from '../src/engine.js';

function config(overrides: Record<string, unknown> = {}): object {
  return {
    players: {
      A: { name: '<b>Alpha</b>', role: 'external', style: null, coachNote: 'secret-A' },
      B: { name: 'Beta', role: 'external', style: null, coachNote: 'secret-B' },
    },
    turnDeadlineMs: 2_000,
    ...overrides,
  };
}

class FakeClock implements Clock {
  private time = 0;
  private nextId = 1;
  private readonly tasks = new Map<number, { at: number; callback: () => void }>();

  public now(): number {
    return this.time;
  }

  public setTimeout(callback: () => void, delayMs: number): number {
    const id = this.nextId;
    this.nextId += 1;
    this.tasks.set(id, { at: this.time + delayMs, callback });
    return id;
  }

  public clearTimeout(handle: unknown): void {
    if (typeof handle === 'number') this.tasks.delete(handle);
  }

  public advance(milliseconds: number): void {
    this.time += milliseconds;
    const due = [...this.tasks.entries()]
      .filter(([, task]) => task.at <= this.time)
      .sort((left, right) => left[1].at - right[1].at);
    for (const [id, task] of due) {
      if (!this.tasks.delete(id)) continue;
      task.callback();
    }
  }
}

async function openServer(options: Parameters<typeof createServer>[0] = {}): Promise<{
  app: ReturnType<typeof createServer>;
  base: string;
}> {
  const app = createServer(options);
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  return { app, base };
}

async function jsonFetch(base: string, path: string, options: RequestInit = {}): Promise<{ response: Response; body: any }> {
  const response = await fetch(`${base}${path}`, options);
  const body = await response.json();
  return { response, body };
}

async function createMatch(base: string, value = config()): Promise<any> {
  const { response, body } = await jsonFetch(base, '/api/matches', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ config: value }),
  });
  assert.equal(response.status, 201, JSON.stringify(body));
  return body.data;
}

async function submit(
  base: string,
  id: string,
  token: string,
  turn: number,
  type: ActionType,
  requestId: string,
): Promise<{ response: Response; body: any }> {
  return jsonFetch(base, `/api/matches/${id}/actions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ leg: 1, turn, action: { type }, requestId }),
  });
}

async function playGuardGame(base: string, order: 'AB' | 'BA'): Promise<any> {
  const created = await createMatch(base);
  for (let turn = 1; turn <= 8; turn += 1) {
    const entries = order === 'AB'
      ? [['A', created.tokens.A], ['B', created.tokens.B]] as const
      : [['B', created.tokens.B], ['A', created.tokens.A]] as const;
    for (const [seat, token] of entries) {
      const submitted = await submit(base, created.id, token, turn, 'guard', `${order}-${turn}-${seat}`);
      assert.equal(submitted.response.status, 200, JSON.stringify(submitted.body));
    }
  }
  const current = await jsonFetch(base, `/api/matches/${created.id}`);
  return { created, view: current.body.data };
}

test('status and machine-readable rules report honest process facts', async (t) => {
  const { app, base } = await openServer();
  t.after(() => app.close());
  const status = await jsonFetch(base, '/api/status');
  assert.equal(status.response.status, 200);
  assert.equal(status.body.data.process, 'ready');
  assert.equal(status.body.data.persistence, 'ephemeral-memory');
  assert.equal(status.body.data.matches.cap, SERVICE_LIMITS.matches);
  const rules = await jsonFetch(base, '/api/rules');
  assert.equal(rules.body.data.rulesVersion, 'corner-1');
  assert.equal(rules.body.data.actions.heavy.cost, 3);
  assert.deepEqual(rules.body.data.actionSchema.type, ['jab', 'heavy', 'guard', 'counter', 'recharge', 'feint']);
});

test('two independently authenticated clients complete a real HTTP game and replay verifies', async (t) => {
  const { app, base } = await openServer();
  t.after(() => app.close());
  const created = await createMatch(base);
  assert.equal(created.view.status, 'active');
  assert.equal(JSON.stringify(created.view).includes('secret-A'), false);

  const observedA = await jsonFetch(base, `/api/matches/${created.id}/observe`, {
    headers: { authorization: `Bearer ${created.tokens.A}` },
  });
  assert.equal(observedA.body.data.seat, 'A');
  assert.equal(observedA.body.data.coachNote, 'secret-A');
  assert.equal(JSON.stringify(observedA.body).includes('secret-B'), false);

  const firstA = await submit(base, created.id, created.tokens.A, 1, 'heavy', 'turn-1-A');
  assert.equal(firstA.response.status, 200);
  assert.equal(firstA.body.data.view.pending.A, true);
  const publicPending = await jsonFetch(base, `/api/matches/${created.id}`);
  const pendingText = JSON.stringify(publicPending.body);
  assert.equal(pendingText.includes('heavy'), false);
  assert.equal(pendingText.includes('secret-A'), false);
  assert.equal(pendingText.includes(created.tokens.A), false);
  assert.deepEqual(publicPending.body.data.pending, { A: true, B: false });

  const retry = await submit(base, created.id, created.tokens.A, 1, 'heavy', 'turn-1-A');
  assert.equal(retry.response.status, 200);
  assert.equal(retry.body.data.idempotent, true);
  const conflict = await submit(base, created.id, created.tokens.A, 1, 'jab', 'turn-1-A');
  assert.equal(conflict.response.status, 409);

  const firstB = await submit(base, created.id, created.tokens.B, 1, 'guard', 'turn-1-B');
  assert.equal(firstB.response.status, 200);
  assert.equal(firstB.body.data.view.turn, 2);
  for (let turn = 2; turn <= 8; turn += 1) {
    assert.equal((await submit(base, created.id, created.tokens.A, turn, 'guard', `turn-${turn}-A`)).response.status, 200);
    assert.equal((await submit(base, created.id, created.tokens.B, turn, 'guard', `turn-${turn}-B`)).response.status, 200);
  }
  const final = await jsonFetch(base, `/api/matches/${created.id}`);
  assert.equal(final.body.data.status, 'completed');
  assert.equal(final.body.data.result.winner, 'A');
  assert.equal(final.body.data.result.reason, 'points');

  const replayResponse = await fetch(`${base}/api/matches/${created.id}/replay`);
  assert.equal(replayResponse.status, 200);
  assert.match(replayResponse.headers.get('content-disposition') ?? '', /attachment/);
  const replay = await replayResponse.json();
  assert.deepEqual(verifyReplay(replay), { ok: true, errors: [] });
  const replayText = JSON.stringify(replay);
  assert.equal(replayText.includes('secret-A'), false);
  assert.equal(replayText.includes(created.tokens.A), false);
  assert.equal(replayText.includes(created.hostToken), false);
});

test('submission order is outcome-equivalent', async (t) => {
  const { app, base } = await openServer();
  t.after(() => app.close());
  const ab = await playGuardGame(base, 'AB');
  const ba = await playGuardGame(base, 'BA');
  assert.deepEqual(ab.view.fighters, ba.view.fighters);
  assert.deepEqual(ab.view.result, ba.view.result);
  assert.deepEqual(ab.view.events, ba.view.events);
});

test('invalid auth, stale/wrong turns, unknown fields, and active replay reject without advancing', async (t) => {
  const { app, base } = await openServer();
  t.after(() => app.close());
  const created = await createMatch(base);

  assert.equal((await jsonFetch(base, `/api/matches/${created.id}/observe`)).response.status, 401);
  assert.equal((await jsonFetch(base, `/api/matches/${created.id}/observe`, {
    headers: { authorization: 'Bearer wrong' },
  })).response.status, 401);
  assert.equal((await jsonFetch(base, `/api/matches/${created.id}/replay`)).response.status, 409);

  const wrongLeg = await jsonFetch(base, `/api/matches/${created.id}/actions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${created.tokens.A}` },
    body: JSON.stringify({ leg: 2, turn: 1, action: { type: 'guard' }, requestId: 'wrong-leg' }),
  });
  assert.equal(wrongLeg.response.status, 409);
  assert.equal((await submit(base, created.id, created.tokens.A, 2, 'guard', 'future')).response.status, 409);
  const extra = await jsonFetch(base, `/api/matches/${created.id}/actions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${created.tokens.A}` },
    body: JSON.stringify({ leg: 1, turn: 1, action: { type: 'guard', power: 100 }, requestId: 'extra' }),
  });
  assert.equal(extra.response.status, 400);
  const weird = await fetch(`${base}/api/matches`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: `{"config":${JSON.stringify(config())},"__proto__":{"admin":true}}`,
  });
  assert.equal(weird.status, 400);
  const unchanged = await jsonFetch(base, `/api/matches/${created.id}`);
  assert.equal(unchanged.body.data.turn, 1);
  assert.deepEqual(unchanged.body.data.pending, { A: false, B: false });
});

test('mutation routes require JSON and reject foreign Origin', async (t) => {
  const { app, base } = await openServer();
  t.after(() => app.close());
  const foreign = await fetch(`${base}/api/matches`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://evil.example' },
    body: JSON.stringify({ config: config() }),
  });
  assert.equal(foreign.status, 403);
  const notJson = await fetch(`${base}/api/matches`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: JSON.stringify({ config: config() }),
  });
  assert.equal(notJson.status, 415);
  const ownOrigin = await fetch(`${base}/api/matches`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ config: config() }),
  });
  assert.equal(ownOrigin.status, 201);
});

test('referee exceptions abort immediately with no winner and a verifiable replay', async (t) => {
  const { app, base } = await openServer({ resolveTurnImpl: () => { throw new Error('injected failure'); } });
  t.after(() => app.close());
  const created = await createMatch(base);
  assert.equal((await submit(base, created.id, created.tokens.A, 1, 'guard', 'failure-A')).response.status, 200);
  assert.equal((await submit(base, created.id, created.tokens.B, 1, 'guard', 'failure-B')).response.status, 500);
  const view = await jsonFetch(base, `/api/matches/${created.id}`);
  assert.equal(view.body.data.status, 'aborted');
  assert.equal(view.body.data.result.reason, 'server-error');
  assert.equal(view.body.data.result.winner, null);
  assert.deepEqual(view.body.data.pending, { A: false, B: false });
  const replay = await (await fetch(`${base}/api/matches/${created.id}/replay`)).json();
  assert.deepEqual(verifyReplay(replay), { ok: true, errors: [] });
  assert.equal(replay.actions.length, 0);
});

test('Origin scheme matters and private observations are never cacheable', async (t) => {
  const { app, base } = await openServer();
  t.after(() => app.close());
  const foreignScheme = await fetch(`${base}/api/matches`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: base.replace('http:', 'https:') },
    body: JSON.stringify({ config: config() }),
  });
  assert.equal(foreignScheme.status, 403);
  const created = await createMatch(base);
  const observed = await fetch(`${base}/api/matches/${created.id}/observe`, {
    headers: { authorization: `Bearer ${created.tokens.A}` },
  });
  assert.equal(observed.headers.get('cache-control'), 'no-store');
});

test('oversized bodies and in-memory match cap return bounded errors', async (t) => {
  const { app, base } = await openServer();
  t.after(() => app.close());
  const oversized = await fetch(`${base}/api/matches`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ padding: 'x'.repeat(SERVICE_LIMITS.bodyBytes + 1) }),
  });
  assert.equal(oversized.status, 413);
  const botConfig = {
    players: {
      A: { name: 'A', role: 'bot', style: 'aggressive', coachNote: '' },
      B: { name: 'B', role: 'bot', style: 'cautious', coachNote: '' },
    },
    turnDeadlineMs: 2_000,
  };
  for (let index = 0; index < SERVICE_LIMITS.matches; index += 1) {
    const response = await fetch(`${base}/api/matches`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ config: botConfig }),
    });
    assert.equal(response.status, 201, `match ${index + 1}`);
  }
  const capped = await fetch(`${base}/api/matches`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ config: botConfig }),
  });
  assert.equal(capped.status, 429);
});

test('injectable turn clock aborts with named timeout and no tactical winner', async (t) => {
  const clock = new FakeClock();
  const { app, base } = await openServer({ turnTimeoutMs: 30, clock });
  t.after(() => app.close());
  const shortConfig = config({ turnDeadlineMs: 30 });
  const created = await createMatch(base, shortConfig);
  await submit(base, created.id, created.tokens.A, 1, 'guard', 'only-A');
  clock.advance(30);
  const view = await jsonFetch(base, `/api/matches/${created.id}`);
  assert.equal(view.body.data.status, 'aborted');
  assert.equal(view.body.data.result.reason, 'timeout-B');
  assert.equal(view.body.data.result.winner, null);
  const replay = await (await fetch(`${base}/api/matches/${created.id}/replay`)).json();
  assert.deepEqual(verifyReplay(replay), { ok: true, errors: [] });
  assert.equal(replay.actions.length, 0);
});

test('scripted bot practice completes without external or model calls', async (t) => {
  const { app, base } = await openServer();
  t.after(() => app.close());
  const created = await createMatch(base, {
    players: {
      A: { name: 'Aggro', role: 'bot', style: 'aggressive', coachNote: 'ignored by policy' },
      B: { name: 'React', role: 'bot', style: 'reactive', coachNote: '' },
    },
    turnDeadlineMs: 2_000,
  });
  assert.notEqual(created.view.status, 'active');
  const replay = await (await fetch(`${base}/api/matches/${created.id}/replay`)).json();
  assert.ok(replay.actions.length >= 1 && replay.actions.length <= 8);
  assert.deepEqual(verifyReplay(replay), { ok: true, errors: [] });
});

test('SSE connection cap rejects excess clients and event payload is redacted', async (t) => {
  const { app, base } = await openServer();
  t.after(() => app.close());
  const created = await createMatch(base);
  const controllers: AbortController[] = [];
  const responses: Response[] = [];
  try {
    for (let index = 0; index < SERVICE_LIMITS.ssePerMatch; index += 1) {
      const controller = new AbortController();
      controllers.push(controller);
      const response = await fetch(`${base}/api/matches/${created.id}/stream`, { signal: controller.signal });
      assert.equal(response.status, 200);
      responses.push(response);
    }
    const excess = await fetch(`${base}/api/matches/${created.id}/stream`);
    assert.equal(excess.status, 429);
    const reader = responses[0]?.body?.getReader();
    assert.ok(reader);
    const chunk = await reader.read();
    const text = new TextDecoder().decode(chunk.value);
    assert.match(text, /event: snapshot/);
    assert.equal(text.includes('secret-A'), false);
    assert.equal(text.includes(created.tokens.A), false);
    await reader.cancel();
  } finally {
    for (const controller of controllers) controller.abort();
  }
});

test('host-authenticated rematch creates an independent id and replacement config', async (t) => {
  const { app, base } = await openServer();
  t.after(() => app.close());
  const old = await createMatch(base);
  const denied = await fetch(`${base}/api/matches/${old.id}/rematch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${old.tokens.A}` },
    body: JSON.stringify({ config: config() }),
  });
  assert.equal(denied.status, 401);
  const replacement = config({
    players: {
      A: { name: 'New Alpha', role: 'external', style: null, coachNote: 'new private note' },
      B: { name: 'New Beta', role: 'external', style: null, coachNote: '' },
    },
  });
  const rematch = await jsonFetch(base, `/api/matches/${old.id}/rematch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${old.hostToken}` },
    body: JSON.stringify({ config: replacement }),
  });
  assert.equal(rematch.response.status, 201);
  assert.notEqual(rematch.body.data.id, old.id);
  assert.equal(rematch.body.data.view.players.A.name, 'New Alpha');
  const oldView = await jsonFetch(base, `/api/matches/${old.id}`);
  assert.equal(oldView.body.data.players.A.name, '<b>Alpha</b>');
});
