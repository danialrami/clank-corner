import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from '../src/server.js';

const execFileAsync = promisify(execFile);
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const CLI = join(ROOT, 'dist/src/cli.js');

async function cli(args: string[], env: NodeJS.ProcessEnv = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(process.execPath, [CLI, ...args], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const candidate = error as { code?: unknown; stdout?: unknown; stderr?: unknown };
    return {
      code: typeof candidate.code === 'number' ? candidate.code : -1,
      stdout: typeof candidate.stdout === 'string' ? candidate.stdout : '',
      stderr: typeof candidate.stderr === 'string' ? candidate.stderr : '',
    };
  }
}

function jsonLine(text: string): any {
  return JSON.parse(text.trim());
}

test('rules has machine output and usage errors exit 2', async () => {
  const rules = await cli(['rules', '--json']);
  assert.equal(rules.code, 0, rules.stderr);
  assert.equal(jsonLine(rules.stdout).data.rulesVersion, 'corner-1');

  const invalid = await cli(['act', '--json']);
  assert.equal(invalid.code, 2);
  assert.equal(jsonLine(invalid.stderr).code, 2);
  const unknown = await cli(['nonesuch', '--json']);
  assert.equal(unknown.code, 2);
});

test('absent token env, transport failure, and bad replay use documented nonzero exits', async (t) => {
  const app = createServer();
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(() => app.close());
  const absent = await cli(['observe', '--url', base, '--match', 'missing', '--token-env', 'NO_SUCH_TOKEN', '--json'], {
    NO_SUCH_TOKEN: '',
  });
  assert.equal(absent.code, 2);

  const transport = await cli(['create', '--url', 'http://127.0.0.1:1', '--json']);
  assert.equal(transport.code, 3, transport.stderr);
  assert.equal(jsonLine(transport.stderr).code, 3);

  const directory = await mkdtemp(join(tmpdir(), 'clank-cli-bad-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const badPath = join(directory, 'bad.json');
  await writeFile(badPath, '{"not":"a replay"}\n');
  const bad = await cli(['verify', badPath, '--json']);
  assert.equal(bad.code, 5);
  assert.match(jsonLine(bad.stderr).message, /verification failed/);
});

test('documented CLI sequence completes a two-client HTTP game, exports, and verifies replay', async (t) => {
  const app = createServer();
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(() => app.close());
  const directory = await mkdtemp(join(tmpdir(), 'clank-cli-e2e-'));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const createdResult = await cli([
    'create', '--url', base,
    '--a-name', 'CLI Alpha', '--a-role', 'external', '--a-note', 'read the tempo',
    '--b-name', 'CLI Beta', '--b-role', 'external', '--json',
  ]);
  assert.equal(createdResult.code, 0, createdResult.stderr);
  const created = jsonLine(createdResult.stdout).data;
  assert.equal(typeof created.id, 'string');
  assert.equal(typeof created.tokens.A, 'string');

  const observed = await cli(['observe', '--url', base, '--match', created.id, '--token-env', 'CLANK_A_TOKEN', '--json'], {
    CLANK_A_TOKEN: created.tokens.A,
  });
  assert.equal(observed.code, 0, observed.stderr);
  assert.equal(jsonLine(observed.stdout).data.coachNote, 'read the tempo');

  for (let turn = 1; turn <= 8; turn += 1) {
    const a = await cli([
      'act', '--url', base, '--match', created.id, '--token-env', 'CLANK_A_TOKEN', '--turn', String(turn),
      '--action', 'guard', '--request-id', `cli-${turn}-A`, '--json',
    ], { CLANK_A_TOKEN: created.tokens.A });
    assert.equal(a.code, 0, `A turn ${turn}: ${a.stderr}`);
    const b = await cli([
      'act', '--url', base, '--match', created.id, '--token-env', 'CLANK_B_TOKEN', '--turn', String(turn),
      '--action', 'guard', '--request-id', `cli-${turn}-B`, '--json',
    ], { CLANK_B_TOKEN: created.tokens.B });
    assert.equal(b.code, 0, `B turn ${turn}: ${b.stderr}`);
  }

  const replayPath = join(directory, 'replay.json');
  const exported = await cli(['replay', '--url', base, '--match', created.id, '--out', replayPath, '--json']);
  assert.equal(exported.code, 0, exported.stderr);
  const fileReplay = JSON.parse(await readFile(replayPath, 'utf8'));
  assert.equal(fileReplay.result.reason, 'draw-at-limit');
  assert.equal(JSON.stringify(fileReplay).includes('read the tempo'), false);

  const verified = await cli(['verify', replayPath, '--json']);
  assert.equal(verified.code, 0, verified.stderr);
  assert.deepEqual(jsonLine(verified.stdout).data, { ok: true, errors: [] });
});

test('demo is explicitly scripted and verifies its own actual replay', async () => {
  const result = await cli(['demo', '--json']);
  assert.equal(result.code, 0, result.stderr);
  const data = jsonLine(result.stdout).data;
  assert.equal(data.mode, 'scripted-practice');
  assert.equal(data.liveModelCalls, false);
  assert.equal(data.externalComputeUsage, null);
  assert.equal(data.replayVerified, true);
});
