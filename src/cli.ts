#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createServer } from './server.js';
import {
  ACTION_TYPES,
  DEFAULT_TURN_DEADLINE_MS,
  STYLES,
  createDefaultConfig,
  rulesDocument,
  verifyReplay,
  type MatchConfig,
  type PlayerRole,
  type Seat,
  type Style,
} from './engine.js';

const EXIT_SUCCESS = 0;
const EXIT_USAGE = 2;
const EXIT_TRANSPORT = 3;
const EXIT_CONTRACT = 5;

class CliFailure extends Error {
  public readonly exitCode: number;

  public constructor(message: string, exitCode: number) {
    super(message);
    this.name = 'CliFailure';
    this.exitCode = exitCode;
  }
}

interface ParsedArgs {
  command: string | undefined;
  flags: Map<string, string | true>;
  positionals: string[];
  json: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const flags = new Map<string, string | true>();
  const positionals: string[] = [];
  let json = false;
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (value === undefined) continue;
    if (value === '--json') {
      json = true;
      continue;
    }
    if (value.startsWith('--')) {
      if (flags.has(value)) throw new CliFailure(`duplicate option ${value}`, EXIT_USAGE);
      const next = rest[index + 1];
      if (next === undefined || next.startsWith('--')) flags.set(value, true);
      else {
        flags.set(value, next);
        index += 1;
      }
      continue;
    }
    positionals.push(value);
  }
  return { command, flags, positionals, json };
}

function option(args: ParsedArgs, name: string, options: { required?: boolean; fallback?: string } = {}): string | undefined {
  const value = args.flags.get(name);
  if (value === true) throw new CliFailure(`${name} requires a value`, EXIT_USAGE);
  if (typeof value === 'string') return value;
  if (options.required === true) throw new CliFailure(`${name} is required`, EXIT_USAGE);
  return options.fallback;
}

function numberOption(args: ParsedArgs, name: string, fallback?: number): number {
  const raw = option(args, name, fallback === undefined ? {} : { fallback: String(fallback) });
  if (raw === undefined || !/^\d+$/.test(raw)) throw new CliFailure(`${name} must be an integer`, EXIT_USAGE);
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new CliFailure(`${name} must be a safe integer`, EXIT_USAGE);
  return value;
}

function rejectUnknown(args: ParsedArgs, allowed: readonly string[]): void {
  for (const name of args.flags.keys()) {
    if (!allowed.includes(name)) throw new CliFailure(`unknown option ${name}`, EXIT_USAGE);
  }
}

function output(args: ParsedArgs, data: unknown, human?: string): void {
  if (args.json) process.stdout.write(`${JSON.stringify({ status: 'success', data })}\n`);
  else if (human !== undefined) process.stdout.write(`${human}\n`);
  else process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

function outputError(args: ParsedArgs, message: string, exitCode: number): void {
  if (args.json) process.stderr.write(`${JSON.stringify({ status: 'error', code: exitCode, message })}\n`);
  else process.stderr.write(`clank-corner: ${message}\n`);
}

function baseUrl(args: ParsedArgs): string {
  const value = option(args, '--url', { required: true });
  try {
    const url = new URL(value ?? '');
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('unsupported protocol');
    return url.href.replace(/\/$/, '');
  } catch {
    throw new CliFailure('--url must be an http(s) URL', EXIT_USAGE);
  }
}

function tokenFromEnv(args: ParsedArgs): string {
  const name = option(args, '--token-env', { required: true });
  if (name === undefined || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new CliFailure('--token-env must name an environment variable', EXIT_USAGE);
  }
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new CliFailure(`environment variable ${name} is empty or absent`, EXIT_USAGE);
  return value;
}

async function request(url: string, init: RequestInit = {}, raw = false): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new CliFailure(`transport failure: ${error instanceof Error ? error.message : 'request failed'}`, EXIT_TRANSPORT);
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new CliFailure(`contract violation: server returned non-JSON (${response.status})`, EXIT_CONTRACT);
  }
  if (!response.ok) {
    const message = typeof data === 'object' && data !== null && 'message' in data && typeof data.message === 'string'
      ? data.message
      : `HTTP ${response.status}`;
    throw new CliFailure(`server rejected request: ${message}`, EXIT_CONTRACT);
  }
  if (raw) return data;
  if (typeof data !== 'object' || data === null || !('status' in data) || data.status !== 'success' || !('data' in data)) {
    throw new CliFailure('contract violation: invalid success envelope', EXIT_CONTRACT);
  }
  return data.data;
}

function playerFromFlags(args: ParsedArgs, seat: Lowercase<Seat>): MatchConfig['players'][Seat] {
  const roleValue = option(args, `--${seat}-role`, { fallback: 'external' });
  if (roleValue !== 'external' && roleValue !== 'bot') {
    throw new CliFailure(`--${seat}-role must be external or bot`, EXIT_USAGE);
  }
  const role = roleValue as PlayerRole;
  const defaultName = seat === 'a' ? 'Clatter' : 'Clank';
  const name = option(args, `--${seat}-name`, { fallback: defaultName }) ?? defaultName;
  const coachNote = option(args, `--${seat}-note`, { fallback: '' }) ?? '';
  const styleValue = option(args, `--${seat}-style`, { fallback: seat === 'a' ? 'aggressive' : 'cautious' });
  if (role === 'bot') {
    if (styleValue === undefined || !STYLES.includes(styleValue as Style)) {
      throw new CliFailure(`--${seat}-style must be ${STYLES.join(', ')}`, EXIT_USAGE);
    }
    return { name, role, style: styleValue as Style, coachNote };
  }
  return { name, role, style: null, coachNote };
}

function configFromFlags(args: ParsedArgs, forceBot = false): MatchConfig {
  if (forceBot) return createDefaultConfig();
  return {
    players: {
      A: playerFromFlags(args, 'a'),
      B: playerFromFlags(args, 'b'),
    },
    turnDeadlineMs: numberOption(args, '--deadline-ms', DEFAULT_TURN_DEADLINE_MS),
  };
}

const CREATE_FLAGS = [
  '--url', '--a-name', '--a-role', '--a-style', '--a-note', '--b-name', '--b-role', '--b-style', '--b-note', '--deadline-ms',
] as const;

function usage(): string {
  return `Clank Corner v1\n\nUsage:\n  clank-corner serve [--host 127.0.0.1] [--port 3210] [--deadline-ms 60000]\n  clank-corner rules [--json]\n  clank-corner create --url URL [seat/config options] [--json]\n  clank-corner observe --url URL --match ID --token-env ENV [--json]\n  clank-corner act --url URL --match ID --token-env ENV --turn N --action TYPE --request-id ID [--json]\n  clank-corner replay --url URL --match ID [--out FILE] [--json]\n  clank-corner verify FILE [--json]\n  clank-corner demo [--url URL] [--json]\n\nSeat/config options:\n  --a-name NAME --a-role external|bot --a-style aggressive|cautious|reactive --a-note NOTE\n  --b-name NAME --b-role external|bot --b-style aggressive|cautious|reactive --b-note NOTE\n  --deadline-ms N\n\nTokens are accepted only through the environment variable named by --token-env.\nExit codes: 0 success, 2 usage, 3 transport, 5 contract/replay violation.`;
}

async function run(args: ParsedArgs): Promise<void> {
  switch (args.command) {
    case undefined:
    case 'help':
    case '--help':
      rejectUnknown(args, []);
      output(args, { usage: usage() }, usage());
      return;
    case 'serve': {
      rejectUnknown(args, ['--host', '--port', '--deadline-ms']);
      if (args.positionals.length > 0) throw new CliFailure('serve takes no positional arguments', EXIT_USAGE);
      const host = option(args, '--host', { fallback: '127.0.0.1' }) ?? '127.0.0.1';
      const port = numberOption(args, '--port', 3210);
      const turnTimeoutMs = numberOption(args, '--deadline-ms', DEFAULT_TURN_DEADLINE_MS);
      if (host === '0.0.0.0' || host === '::') {
        process.stderr.write('LAN WARNING: the service is reachable by other hosts; bearer tokens are unencrypted over plain HTTP. Use only on a trusted LAN.\n');
      }
      const app = createServer({ host, port, turnTimeoutMs });
      const address = await app.listen({ host, port });
      output(args, { address, host, port, persistence: 'ephemeral-memory' }, `Clank Corner listening at ${address}`);
      return;
    }
    case 'rules':
      rejectUnknown(args, []);
      if (args.positionals.length > 0) throw new CliFailure('rules takes no positional arguments', EXIT_USAGE);
      output(args, rulesDocument());
      return;
    case 'create': {
      rejectUnknown(args, CREATE_FLAGS);
      if (args.positionals.length > 0) throw new CliFailure('create takes no positional arguments', EXIT_USAGE);
      const url = baseUrl(args);
      const data = await request(`${url}/api/matches`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ config: configFromFlags(args) }),
      });
      output(args, data);
      return;
    }
    case 'observe': {
      rejectUnknown(args, ['--url', '--match', '--token-env']);
      if (args.positionals.length > 0) throw new CliFailure('observe takes no positional arguments', EXIT_USAGE);
      const url = baseUrl(args);
      const match = option(args, '--match', { required: true });
      const token = tokenFromEnv(args);
      const data = await request(`${url}/api/matches/${encodeURIComponent(match ?? '')}/observe`, {
        headers: { authorization: `Bearer ${token}` },
      });
      output(args, data);
      return;
    }
    case 'act': {
      rejectUnknown(args, ['--url', '--match', '--token-env', '--turn', '--action', '--request-id', '--leg']);
      if (args.positionals.length > 0) throw new CliFailure('act takes no positional arguments', EXIT_USAGE);
      const url = baseUrl(args);
      const match = option(args, '--match', { required: true });
      const token = tokenFromEnv(args);
      const turn = numberOption(args, '--turn');
      const action = option(args, '--action', { required: true });
      if (action === undefined || !ACTION_TYPES.includes(action as (typeof ACTION_TYPES)[number])) {
        throw new CliFailure(`--action must be ${ACTION_TYPES.join(', ')}`, EXIT_USAGE);
      }
      const requestId = option(args, '--request-id', { required: true });
      const leg = numberOption(args, '--leg', 1);
      const data = await request(`${url}/api/matches/${encodeURIComponent(match ?? '')}/actions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ leg, turn, action: { type: action }, requestId }),
      });
      output(args, data);
      return;
    }
    case 'replay': {
      rejectUnknown(args, ['--url', '--match', '--out']);
      if (args.positionals.length > 0) throw new CliFailure('replay takes no positional arguments', EXIT_USAGE);
      const url = baseUrl(args);
      const match = option(args, '--match', { required: true });
      const replay = await request(`${url}/api/matches/${encodeURIComponent(match ?? '')}/replay`, {}, true);
      const out = option(args, '--out');
      if (out !== undefined) {
        await writeFile(out, `${JSON.stringify(replay, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
        const hash = typeof replay === 'object' && replay !== null && 'hash' in replay ? replay.hash : null;
        output(args, { path: out, hash }, `Replay written to ${out}`);
      } else output(args, replay);
      return;
    }
    case 'verify': {
      rejectUnknown(args, []);
      if (args.positionals.length !== 1) throw new CliFailure('verify requires exactly one replay file', EXIT_USAGE);
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readFile(args.positionals[0] ?? '', 'utf8'));
      } catch (error) {
        throw new CliFailure(`cannot read replay: ${error instanceof Error ? error.message : 'invalid file'}`, EXIT_CONTRACT);
      }
      const verification = verifyReplay(parsed);
      if (!verification.ok) throw new CliFailure(`replay verification failed: ${verification.errors.join('; ')}`, EXIT_CONTRACT);
      output(args, verification, 'Replay verified by canonical recomputation.');
      return;
    }
    case 'demo': {
      rejectUnknown(args, ['--url']);
      if (args.positionals.length > 0) throw new CliFailure('demo takes no positional arguments', EXIT_USAGE);
      let app: ReturnType<typeof createServer> | undefined;
      let url = option(args, '--url');
      try {
        if (url === undefined) {
          app = createServer();
          const address = await app.listen({ host: '127.0.0.1', port: 0 });
          url = address;
        } else {
          try {
            url = new URL(url).href.replace(/\/$/, '');
          } catch {
            throw new CliFailure('--url must be an http(s) URL', EXIT_USAGE);
          }
        }
        const created = await request(`${url}/api/matches`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ config: configFromFlags(args, true) }),
        }) as { id?: unknown };
        if (typeof created.id !== 'string') throw new CliFailure('contract violation: create response has no match id', EXIT_CONTRACT);
        const replay = await request(`${url}/api/matches/${encodeURIComponent(created.id)}/replay`, {}, true);
        const verification = verifyReplay(replay);
        if (!verification.ok) throw new CliFailure(`demo replay failed verification: ${verification.errors.join('; ')}`, EXIT_CONTRACT);
        output(args, {
          mode: 'scripted-practice',
          liveModelCalls: false,
          externalComputeUsage: null,
          matchId: created.id,
          result: typeof replay === 'object' && replay !== null && 'result' in replay ? replay.result : null,
          replayVerified: true,
        }, 'Scripted practice demo completed and its replay verified. No model was called.');
      } finally {
        if (app !== undefined) await app.close();
      }
      return;
    }
    default:
      throw new CliFailure(`unknown command: ${args.command}`, EXIT_USAGE);
  }
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    const fallback: ParsedArgs = { command: argv[0], flags: new Map(), positionals: [], json: argv.includes('--json') };
    const failure = error instanceof CliFailure ? error : new CliFailure('invalid arguments', EXIT_USAGE);
    outputError(fallback, failure.message, failure.exitCode);
    return failure.exitCode;
  }
  try {
    await run(args);
    return EXIT_SUCCESS;
  } catch (error) {
    const failure = error instanceof CliFailure
      ? error
      : new CliFailure(error instanceof Error ? error.message : 'unexpected failure', EXIT_CONTRACT);
    outputError(args, failure.message, failure.exitCode);
    return failure.exitCode;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await main();
}
