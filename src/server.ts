import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import { chooseAction } from './bots.js';
import {
  ACTION_TYPES,
  ContractError,
  GAME_ID,
  GAME_VERSION,
  MAX_TURNS,
  RULES_VERSION,
  SEATS,
  abortMatch,
  createInitialState,
  createReplay,
  normalizeMatchConfig,
  observe,
  parseAction,
  publicView,
  resolveTurn,
  rulesDocument,
  type Action,
  type GameState,
  type MatchConfig,
  type Replay,
  type ReplayTurn,
  type Seat,
} from './engine.js';

const PUBLIC_DIR = fileURLToPath(new URL('../../public/', import.meta.url));
const BODY_LIMIT = 16 * 1024;
const MAX_MATCHES = 32;
const MAX_SSE_TOTAL = 32;
const MAX_SSE_PER_MATCH = 8;
const MAX_REQUEST_ID_LENGTH = 80;

export interface Clock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

interface PendingAction {
  leg: 1;
  turn: number;
  action: Action;
  requestId: string;
}

interface AcceptedAction extends PendingAction {}

interface StreamClient {
  send(payload: unknown): void;
  close(): void;
}

interface MatchRecord {
  id: string;
  config: MatchConfig;
  state: GameState;
  tokenHashes: Record<Seat, string>;
  hostTokenHash: string;
  pending: Partial<Record<Seat, PendingAction>>;
  accepted: Record<Seat, Map<string, AcceptedAction>>;
  replayTurns: ReplayTurn[];
  deadlineAt: number;
  timer: unknown | null;
  streams: Set<StreamClient>;
}

export interface ServerOptions {
  host?: string;
  port?: number;
  turnTimeoutMs?: number;
  clock?: Clock;
  resolveTurnImpl?: typeof resolveTurn;
}

class HttpError extends Error {
  public readonly statusCode: number;

  public constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
  }
}

function realClock(): Clock {
  return {
    now: () => Date.now(),
    setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactBody(value: unknown, keys: readonly string[], required: readonly string[], label: string): Record<string, unknown> {
  if (!isPlainRecord(value)) throw new HttpError(400, `${label} must be a plain JSON object`);
  const unknown = Object.keys(value).find((key) => !keys.includes(key));
  if (unknown !== undefined) throw new HttpError(400, `${label} has unknown field: ${unknown}`);
  const missing = required.find((key) => !Object.prototype.hasOwnProperty.call(value, key));
  if (missing !== undefined) throw new HttpError(400, `${label}.${missing} is required`);
  return value;
}

function token(): string {
  return randomBytes(32).toString('base64url');
}

function tokenHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function tokenMatches(supplied: string, expectedHash: string): boolean {
  const suppliedHash = Buffer.from(tokenHash(supplied), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return suppliedHash.length === expected.length && timingSafeEqual(suppliedHash, expected);
}

function bearer(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ') || header.length <= 7) {
    throw new HttpError(401, 'a valid Authorization: Bearer token is required');
  }
  return header.slice(7);
}

function seatFor(record: MatchRecord, supplied: string): Seat {
  for (const seat of SEATS) {
    if (tokenMatches(supplied, record.tokenHashes[seat])) return seat;
  }
  throw new HttpError(401, 'invalid seat bearer token');
}

function requireHost(record: MatchRecord, supplied: string): void {
  if (!tokenMatches(supplied, record.hostTokenHash)) throw new HttpError(401, 'invalid host bearer token');
}

async function mutationGuard(request: FastifyRequest): Promise<void> {
  const contentType = request.headers['content-type'];
  if (typeof contentType !== 'string' || !/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new HttpError(415, 'mutation routes require Content-Type: application/json');
  }
  const origin = request.headers.origin;
  if (origin !== undefined) {
    const host = request.headers.host;
    if (typeof host !== 'string') throw new HttpError(403, 'Origin cannot be validated without Host');
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new HttpError(403, 'invalid Origin');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new HttpError(403, 'foreign Origin rejected');
    if (parsed.origin !== `${request.protocol}://${host}`) throw new HttpError(403, 'foreign Origin rejected');
  }
}

function success(data: unknown): { status: 'success'; data: unknown } {
  return { status: 'success', data };
}

function publicRecord(record: MatchRecord): object {
  return {
    id: record.id,
    ...publicView(record.state),
    pending: { A: record.pending.A !== undefined, B: record.pending.B !== undefined },
    deadlineAt: record.state.status === 'active' ? new Date(record.deadlineAt).toISOString() : null,
  };
}

function sendSnapshot(record: MatchRecord): void {
  const payload = publicRecord(record);
  for (const stream of [...record.streams]) {
    try {
      stream.send(payload);
    } catch {
      record.streams.delete(stream);
      stream.close();
    }
  }
}

function closeStreams(record: MatchRecord): void {
  for (const stream of [...record.streams]) stream.close();
  record.streams.clear();
}

function sanitizeConfig(value: unknown, defaultDeadlineMs: number): MatchConfig {
  if (!isPlainRecord(value)) throw new HttpError(400, 'config must be a plain JSON object');
  const candidate = Object.prototype.hasOwnProperty.call(value, 'turnDeadlineMs')
    ? value
    : { ...value, turnDeadlineMs: defaultDeadlineMs };
  try {
    return normalizeMatchConfig(candidate);
  } catch (error) {
    if (error instanceof ContractError) throw new HttpError(400, error.message);
    throw error;
  }
}

export function createServer(options: ServerOptions = {}): FastifyInstance {
  const clock = options.clock ?? realClock();
  const transition = options.resolveTurnImpl ?? resolveTurn;
  const defaultDeadlineMs = options.turnTimeoutMs ?? 60_000;
  if (!Number.isInteger(defaultDeadlineMs) || defaultDeadlineMs < 10 || defaultDeadlineMs > 300_000) {
    throw new ContractError('turnTimeoutMs must be an integer from 10 to 300000');
  }
  const matches = new Map<string, MatchRecord>();
  let sseTotal = 0;
  const app = Fastify({ logger: false, bodyLimit: BODY_LIMIT });

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Cache-Control', 'no-store');
    reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    return payload;
  });

  app.setErrorHandler((error, _request, reply) => {
    const candidate = error as { statusCode?: unknown; code?: unknown; message?: unknown };
    let statusCode = error instanceof HttpError
      ? error.statusCode
      : typeof candidate.statusCode === 'number' ? candidate.statusCode : 500;
    if (statusCode === 500 && error instanceof ContractError) statusCode = 400;
    if (statusCode === 413 || candidate.code === 'FST_ERR_CTP_BODY_TOO_LARGE') statusCode = 413;
    const safeMessage = typeof candidate.message === 'string' ? candidate.message : 'request failed';
    const message = statusCode >= 500 ? 'internal server error' : safeMessage;
    void reply.code(statusCode).send({ status: 'error', code: statusCode, message });
  });

  app.setNotFoundHandler((_request, reply) => {
    void reply.code(404).send({ status: 'error', code: 404, message: 'route not found' });
  });

  function getMatch(id: string): MatchRecord {
    const record = matches.get(id);
    if (record === undefined) throw new HttpError(404, 'match not found');
    return record;
  }

  function clearDeadline(record: MatchRecord): void {
    if (record.timer !== null) clock.clearTimeout(record.timer);
    record.timer = null;
  }

  function finishIfTerminal(record: MatchRecord): void {
    if (record.state.status !== 'active') clearDeadline(record);
  }

  function handleTimeout(record: MatchRecord): void {
    if (record.state.status !== 'active') return;
    const missingA = record.pending.A === undefined;
    const missingB = record.pending.B === undefined;
    const reason = missingA && missingB ? 'timeout-both' : missingA ? 'timeout-A' : missingB ? 'timeout-B' : null;
    if (reason === null) return;
    record.state = abortMatch(record.state, reason);
    record.pending = {};
    clearDeadline(record);
    sendSnapshot(record);
    closeStreams(record);
  }

  function scheduleDeadline(record: MatchRecord): void {
    clearDeadline(record);
    record.deadlineAt = clock.now() + record.config.turnDeadlineMs;
    record.timer = clock.setTimeout(() => handleTimeout(record), record.config.turnDeadlineMs);
  }

  function resolvePending(record: MatchRecord): boolean {
    const pendingA = record.pending.A;
    const pendingB = record.pending.B;
    if (pendingA === undefined || pendingB === undefined) return false;
    const turn: ReplayTurn = {
      leg: 1,
      turn: record.state.turn,
      actions: { A: { ...pendingA.action }, B: { ...pendingB.action } },
    };
    try {
      record.state = transition(record.state, turn.actions).state;
    } catch {
      // An internal failure must not leave two permanently sealed moves active.
      record.state = abortMatch(record.state, 'server-error');
      record.pending = {};
      clearDeadline(record);
      sendSnapshot(record);
      closeStreams(record);
      throw new HttpError(500, 'referee failure aborted match');
    }
    record.replayTurns.push(turn);
    record.pending = {};
    finishIfTerminal(record);
    if (record.state.status === 'active') scheduleDeadline(record);
    sendSnapshot(record);
    return true;
  }

  function submitBotActions(record: MatchRecord): void {
    while (record.state.status === 'active') {
      let added = false;
      for (const seat of SEATS) {
        const player = record.config.players[seat];
        if (player.role === 'bot' && record.pending[seat] === undefined) {
          if (player.style === null) throw new ContractError('bot seat is missing its scripted style');
          const action = chooseAction(observe(record.state, seat), player.style);
          record.pending[seat] = {
            leg: 1,
            turn: record.state.turn,
            action,
            requestId: `server-bot-${record.state.turn}-${seat}`,
          };
          added = true;
        }
      }
      if (resolvePending(record)) continue;
      if (!added) break;
      break;
    }
  }

  function createMatch(config: MatchConfig): { record: MatchRecord; hostToken: string; seatTokens: Record<Seat, string> } {
    if (matches.size >= MAX_MATCHES) throw new HttpError(429, `in-memory match cap of ${MAX_MATCHES} reached`);
    const hostToken = token();
    const seatTokens = { A: token(), B: token() };
    const record: MatchRecord = {
      id: randomUUID(),
      config,
      state: createInitialState(config),
      tokenHashes: { A: tokenHash(seatTokens.A), B: tokenHash(seatTokens.B) },
      hostTokenHash: tokenHash(hostToken),
      pending: {},
      accepted: { A: new Map(), B: new Map() },
      replayTurns: [],
      deadlineAt: clock.now() + config.turnDeadlineMs,
      timer: null,
      streams: new Set(),
    };
    matches.set(record.id, record);
    scheduleDeadline(record);
    submitBotActions(record);
    return { record, hostToken, seatTokens };
  }

  app.get('/api/status', async () => {
    const counts = { active: 0, completed: 0, aborted: 0 };
    for (const record of matches.values()) counts[record.state.status] += 1;
    return success({
      game: GAME_ID,
      version: GAME_VERSION,
      rulesVersion: RULES_VERSION,
      process: 'ready',
      persistence: 'ephemeral-memory',
      matches: { ...counts, retained: matches.size, cap: MAX_MATCHES },
      streamConnections: { current: sseTotal, cap: MAX_SSE_TOTAL },
      uptimeSeconds: Math.floor(process.uptime()),
    });
  });

  app.get('/api/rules', async () => success(rulesDocument()));

  app.post('/api/matches', { preHandler: mutationGuard }, async (request, reply) => {
    const body = exactBody(request.body, ['config'], ['config'], 'body');
    const config = sanitizeConfig(body.config, defaultDeadlineMs);
    const created = createMatch(config);
    return reply.code(201).send(success({
      id: created.record.id,
      hostToken: created.hostToken,
      tokens: created.seatTokens,
      view: publicRecord(created.record),
    }));
  });

  app.get<{ Params: { id: string } }>('/api/matches/:id', async (request) => success(publicRecord(getMatch(request.params.id))));

  app.get<{ Params: { id: string } }>('/api/matches/:id/observe', async (request) => {
    const record = getMatch(request.params.id);
    const seat = seatFor(record, bearer(request));
    const observation = observe(record.state, seat);
    return success({
      matchId: record.id,
      seat,
      role: record.config.players[seat].role,
      observation,
      legalActions: observation.legalActions,
      coachNote: observation.coachNote,
      ownActionPending: record.pending[seat] !== undefined,
      deadlineAt: record.state.status === 'active' ? new Date(record.deadlineAt).toISOString() : null,
    });
  });

  app.post<{ Params: { id: string } }>('/api/matches/:id/actions', { preHandler: mutationGuard }, async (request) => {
    const record = getMatch(request.params.id);
    const seat = seatFor(record, bearer(request));
    const body = exactBody(request.body, ['leg', 'turn', 'action', 'requestId'], ['leg', 'turn', 'action', 'requestId'], 'body');
    if (body.leg !== 1) throw new HttpError(409, 'wrong leg');
    if (!Number.isInteger(body.turn)) throw new HttpError(400, 'turn must be an integer');
    if (typeof body.requestId !== 'string' || body.requestId.length < 1 || body.requestId.length > MAX_REQUEST_ID_LENGTH || !/^[A-Za-z0-9._:-]+$/.test(body.requestId)) {
      throw new HttpError(400, `requestId must be 1-${MAX_REQUEST_ID_LENGTH} safe characters`);
    }
    let action: Action;
    try {
      action = parseAction(body.action);
    } catch (error) {
      if (error instanceof ContractError) throw new HttpError(400, error.message);
      throw error;
    }
    const requestId = body.requestId;
    const previous = record.accepted[seat].get(requestId);
    if (previous !== undefined) {
      const identical = previous.leg === body.leg && previous.turn === body.turn && previous.action.type === action.type;
      if (!identical) throw new HttpError(409, 'requestId conflicts with an earlier accepted action');
      return success({ accepted: true, idempotent: true, view: publicRecord(record) });
    }
    if (record.state.status !== 'active') throw new HttpError(409, 'match is terminal');
    if (body.turn !== record.state.turn) throw new HttpError(409, `stale or future turn; current turn is ${record.state.turn}`);
    if (record.config.players[seat].role === 'bot') throw new HttpError(409, 'this seat is server-owned by a scripted bot');
    if (record.pending[seat] !== undefined) throw new HttpError(409, 'seat already submitted a sealed action for this turn');
    const legal = observe(record.state, seat).legalActions.some((candidate) => candidate.type === action.type);
    if (!legal) throw new HttpError(409, `action ${action.type} is not affordable`);
    const accepted: AcceptedAction = { leg: 1, turn: body.turn as number, action, requestId };
    record.pending[seat] = accepted;
    record.accepted[seat].set(requestId, accepted);
    resolvePending(record);
    submitBotActions(record);
    if (record.state.status !== 'active') closeStreams(record);
    else sendSnapshot(record);
    return success({ accepted: true, idempotent: false, view: publicRecord(record) });
  });

  app.get<{ Params: { id: string } }>('/api/matches/:id/replay', async (request, reply) => {
    const record = getMatch(request.params.id);
    if (record.state.status === 'active') throw new HttpError(409, 'replay is available only after completion or abort');
    const replay: Replay = createReplay(record.config, record.replayTurns, record.state);
    return reply
      .type('application/json; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="clank-corner-${record.id}.json"`)
      .send(replay);
  });

  app.post<{ Params: { id: string } }>('/api/matches/:id/rematch', { preHandler: mutationGuard }, async (request, reply) => {
    const old = getMatch(request.params.id);
    requireHost(old, bearer(request));
    const body = exactBody(request.body, ['config'], ['config'], 'body');
    const config = sanitizeConfig(body.config, defaultDeadlineMs);
    const created = createMatch(config);
    return reply.code(201).send(success({
      id: created.record.id,
      hostToken: created.hostToken,
      tokens: created.seatTokens,
      view: publicRecord(created.record),
      rematchOf: old.id,
    }));
  });

  app.get<{ Params: { id: string } }>('/api/matches/:id/stream', async (request, reply) => {
    const record = getMatch(request.params.id);
    if (sseTotal >= MAX_SSE_TOTAL || record.streams.size >= MAX_SSE_PER_MATCH) {
      throw new HttpError(429, 'server-sent event connection cap reached');
    }
    reply.hijack();
    const raw = reply.raw;
    raw.statusCode = 200;
    raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    raw.setHeader('Cache-Control', 'no-cache, no-transform');
    raw.setHeader('Connection', 'keep-alive');
    raw.flushHeaders();
    let closed = false;
    const client: StreamClient = {
      send: (payload) => {
        if (!closed) raw.write(`event: snapshot\ndata: ${JSON.stringify(payload)}\n\n`);
      },
      close: () => {
        if (closed) return;
        closed = true;
        record.streams.delete(client);
        sseTotal = Math.max(0, sseTotal - 1);
        raw.end();
      },
    };
    record.streams.add(client);
    sseTotal += 1;
    client.send(publicRecord(record));
    raw.on('close', client.close);
    if (record.state.status !== 'active') client.close();
  });

  app.get('/', async (_request, reply) => reply.type('text/html; charset=utf-8').send(await readFile(`${PUBLIC_DIR}index.html`, 'utf8')));
  app.get('/app.js', async (_request, reply) => reply.type('application/javascript; charset=utf-8').send(await readFile(`${PUBLIC_DIR}app.js`, 'utf8')));
  app.get('/style.css', async (_request, reply) => reply.type('text/css; charset=utf-8').send(await readFile(`${PUBLIC_DIR}style.css`, 'utf8')));

  app.addHook('onClose', async () => {
    for (const record of matches.values()) {
      clearDeadline(record);
      closeStreams(record);
    }
  });

  return app;
}

export const SERVICE_LIMITS = {
  bodyBytes: BODY_LIMIT,
  matches: MAX_MATCHES,
  sseTotal: MAX_SSE_TOTAL,
  ssePerMatch: MAX_SSE_PER_MATCH,
  maxTurns: MAX_TURNS,
  actionTypes: ACTION_TYPES,
} as const;
