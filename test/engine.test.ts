import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  ACTION_TYPES,
  ContractError,
  ENERGY_CAP,
  MAX_TURNS,
  abortMatch,
  createDefaultConfig,
  createInitialState,
  createReplay,
  legalActions,
  normalizeMatchConfig,
  observe,
  parseAction,
  publicView,
  resolveTurn,
  verifyReplay,
  type Action,
  type ActionType,
  type GameState,
  type MatchConfig,
  type ReplayTurn,
  type Seat,
} from '../src/engine.js';

function externalConfig(): MatchConfig {
  return normalizeMatchConfig({
    players: {
      A: { name: 'Alpha', role: 'external', style: null, coachNote: 'A private note' },
      B: { name: 'Beta', role: 'external', style: null, coachNote: 'B private note' },
    },
    turnDeadlineMs: 1_000,
  });
}

function action(type: ActionType): Action {
  return { type };
}

function withFighters(a: { hp: number; energy: number }, b: { hp: number; energy: number }, turn = 1): GameState {
  return { ...createInitialState(externalConfig()), turn, fighters: { A: a, B: b } };
}

function resolve(state: GameState, a: ActionType, b: ActionType): GameState {
  return resolveTurn(state, { A: action(a), B: action(b) }).state;
}

function play(sequence: Array<[ActionType, ActionType]>, config = externalConfig()): { state: GameState; turns: ReplayTurn[] } {
  let state = createInitialState(config);
  const turns: ReplayTurn[] = [];
  for (const [a, b] of sequence) {
    const turn: ReplayTurn = { leg: 1, turn: state.turn, actions: { A: action(a), B: action(b) } };
    turns.push(turn);
    state = resolveTurn(state, turn.actions).state;
  }
  return { state, turns };
}

function swapState(state: GameState): GameState {
  return {
    ...state,
    config: {
      ...state.config,
      players: { A: state.config.players.B, B: state.config.players.A },
    },
    fighters: { A: state.fighters.B, B: state.fighters.A },
    result: null,
    events: [],
  };
}

test('initial resources and affordability boundaries are exact', () => {
  const initial = createInitialState(externalConfig());
  assert.deepEqual(initial.fighters, { A: { hp: 12, energy: 3 }, B: { hp: 12, energy: 3 } });
  assert.deepEqual(legalActions(initial, 'A').map((move) => move.type), ACTION_TYPES);

  const expectations: Array<[number, ActionType[]]> = [
    [0, ['guard', 'recharge']],
    [1, ['jab', 'guard', 'recharge']],
    [2, ['jab', 'guard', 'counter', 'recharge', 'feint']],
    [3, [...ACTION_TYPES]],
  ];
  for (const [energy, expected] of expectations) {
    const state = withFighters({ hp: 12, energy }, { hp: 12, energy: 3 });
    assert.deepEqual(legalActions(state, 'A').map((move) => move.type), expected);
  }
});

test('jab, heavy, recharge, and simultaneous resource arithmetic follow corner-1', () => {
  let state = resolve(withFighters({ hp: 12, energy: 3 }, { hp: 12, energy: 3 }), 'jab', 'recharge');
  assert.deepEqual(state.fighters, { A: { hp: 12, energy: 2 }, B: { hp: 10, energy: 5 } });
  assert.deepEqual(state.events[0]?.deltas, { A: { hp: 0, energy: -1 }, B: { hp: -2, energy: 2 } });

  state = resolve(withFighters({ hp: 12, energy: 6 }, { hp: 12, energy: 6 }), 'recharge', 'heavy');
  assert.deepEqual(state.fighters, { A: { hp: 7, energy: 6 }, B: { hp: 12, energy: 3 } });
  assert.ok(state.fighters.A.energy <= ENERGY_CAP);
});

test('guard reduces jab and heavy, floors at zero, and cannot stop feint', () => {
  assert.deepEqual(resolve(withFighters({ hp: 12, energy: 3 }, { hp: 12, energy: 3 }), 'jab', 'guard').fighters, {
    A: { hp: 12, energy: 2 }, B: { hp: 12, energy: 3 },
  });
  assert.equal(resolve(withFighters({ hp: 12, energy: 3 }, { hp: 12, energy: 3 }), 'heavy', 'guard').fighters.B.hp, 10);
  assert.equal(resolve(withFighters({ hp: 12, energy: 3 }, { hp: 12, energy: 3 }), 'feint', 'guard').fighters.B.hp, 10);
});

test('counter cancels only jab/heavy and feint ignores counter', () => {
  for (const attack of ['jab', 'heavy'] as const) {
    const state = resolve(withFighters({ hp: 12, energy: 3 }, { hp: 12, energy: 3 }), attack, 'counter');
    assert.equal(state.fighters.A.hp, 8);
    assert.equal(state.fighters.B.hp, 12);
  }
  const versusFeint = resolve(withFighters({ hp: 12, energy: 3 }, { hp: 12, energy: 3 }), 'counter', 'feint');
  assert.equal(versusFeint.fighters.A.hp, 10);
  assert.equal(versusFeint.fighters.B.hp, 12);
  const versusRecharge = resolve(withFighters({ hp: 12, energy: 3 }, { hp: 12, energy: 3 }), 'counter', 'recharge');
  assert.deepEqual(versusRecharge.fighters, { A: { hp: 12, energy: 1 }, B: { hp: 12, energy: 5 } });
});

test('affordability uses start-of-turn energy and illegal actions fail closed', () => {
  const empty = withFighters({ hp: 12, energy: 0 }, { hp: 12, energy: 3 });
  assert.throws(() => resolve(empty, 'jab', 'guard'), /cannot afford/);
  assert.throws(() => resolve(empty, 'heavy', 'guard'), /cannot afford/);
  assert.equal(resolve(empty, 'recharge', 'heavy').fighters.A.energy, 2);
});

test('damage applies simultaneously, including double KO and an actor dying', () => {
  const doubleKo = resolve(withFighters({ hp: 2, energy: 3 }, { hp: 2, energy: 3 }), 'feint', 'feint');
  assert.deepEqual(doubleKo.result, { status: 'completed', winner: null, reason: 'double-ko', finalTurn: 1 });
  assert.deepEqual(doubleKo.fighters, { A: { hp: 0, energy: 1 }, B: { hp: 0, energy: 1 } });

  const simultaneous = resolve(withFighters({ hp: 2, energy: 3 }, { hp: 5, energy: 3 }), 'heavy', 'jab');
  assert.equal(simultaneous.fighters.A.hp, 0);
  assert.equal(simultaneous.fighters.B.hp, 0);
  assert.equal(simultaneous.result?.reason, 'double-ko');
});

test('turn increments only after resolution and turn 8 uses HP with no energy tiebreak', () => {
  const draw = play(Array.from({ length: MAX_TURNS }, () => ['guard', 'guard'] as [ActionType, ActionType]));
  assert.equal(draw.state.turn, 8);
  assert.deepEqual(draw.state.result, { status: 'completed', winner: null, reason: 'draw-at-limit', finalTurn: 8 });
  assert.deepEqual(legalActions(draw.state, 'A'), []);
  assert.throws(() => resolveTurn(draw.state, { A: action('guard'), B: action('guard') }), /terminal/);

  const points = play([
    ['jab', 'recharge'],
    ...Array.from({ length: 7 }, () => ['guard', 'guard'] as [ActionType, ActionType]),
  ]);
  assert.equal(points.state.result?.winner, 'A');
  assert.equal(points.state.result?.reason, 'points');
});

test('all legal pairings preserve bounds and seat swap symmetry', () => {
  for (const a of ACTION_TYPES) {
    for (const b of ACTION_TYPES) {
      const base = withFighters({ hp: 9, energy: 3 }, { hp: 7, energy: 3 });
      const result = resolve(base, a, b);
      for (const seat of ['A', 'B'] as Seat[]) {
        assert.ok(result.fighters[seat].hp >= 0 && result.fighters[seat].hp <= 12);
        assert.ok(result.fighters[seat].energy >= 0 && result.fighters[seat].energy <= 6);
      }
      const swapped = resolve(swapState(base), b, a);
      assert.deepEqual(result.fighters.A, swapped.fighters.B, `${a}/${b} A relation`);
      assert.deepEqual(result.fighters.B, swapped.fighters.A, `${a}/${b} B relation`);
    }
  }
});

test('runtime validation rejects extra fields, inherited properties, and malformed config', () => {
  assert.deepEqual(parseAction({ type: 'jab' }), { type: 'jab' });
  assert.throws(() => parseAction({ type: 'jab', extra: true }), /unknown field/);
  assert.throws(() => parseAction(Object.create({ type: 'jab' })), /plain object/);
  assert.throws(() => parseAction({ __proto__: { type: 'jab' } }), /type is required|plain object/);
  assert.throws(() => normalizeMatchConfig({ ...externalConfig(), extra: true }), /unknown field/);
  assert.throws(() => normalizeMatchConfig({ players: { A: {}, B: {} }, turnDeadlineMs: 1_000 }), /name/);
  assert.throws(() => normalizeMatchConfig({
    players: {
      A: { name: 'A', role: 'bot', style: null, coachNote: '' },
      B: { name: 'B', role: 'external', style: null, coachNote: '' },
    },
    turnDeadlineMs: 1_000,
  }), /scripted style/);
  assert.throws(() => normalizeMatchConfig({
    players: {
      A: { name: 'A', role: 'external', style: null, coachNote: 'x'.repeat(1_001) },
      B: { name: 'B', role: 'external', style: null, coachNote: '' },
    },
    turnDeadlineMs: 1_000,
  }), /at most 1000/);
});

test('observations own private coaching and public views redact all notes', () => {
  const state = createInitialState(externalConfig());
  assert.equal(observe(state, 'A').coachNote, 'A private note');
  assert.equal(observe(state, 'B').coachNote, 'B private note');
  const serialized = JSON.stringify(publicView(state));
  assert.equal(serialized.includes('private note'), false);
  assert.equal(serialized.includes('coachNote'), false);
});

test('complete and aborted replays recompute; tampering and missing final state fail closed', () => {
  const completed = play([
    ['heavy', 'heavy'],
    ['recharge', 'recharge'],
    ['feint', 'feint'],
    ['recharge', 'recharge'],
    ['feint', 'feint'],
    ['recharge', 'recharge'],
    ['feint', 'guard'],
    ['guard', 'guard'],
  ]);
  assert.equal(completed.state.status, 'completed');
  const replay = createReplay(externalConfig(), completed.turns, completed.state);
  assert.deepEqual(verifyReplay(replay), { ok: true, errors: [] });
  assert.equal(JSON.stringify(replay).includes('private note'), false);

  const eventTamper = structuredClone(replay);
  const firstEvent = eventTamper.events[0];
  assert.ok(firstEvent);
  firstEvent.damage.A = 99;
  assert.equal(verifyReplay(eventTamper).ok, false);
  const hashTamper = structuredClone(replay);
  hashTamper.hash = '0'.repeat(64);
  assert.equal(verifyReplay(hashTamper).ok, false);
  const missing = structuredClone(replay) as unknown as Record<string, unknown>;
  delete missing.finalState;
  assert.equal(verifyReplay(missing).ok, false);
  const actionTamper = structuredClone(replay);
  const firstTurn = actionTamper.actions[0];
  assert.ok(firstTurn);
  firstTurn.actions.A.type = 'guard';
  assert.equal(verifyReplay(actionTamper).ok, false);

  const initial = createInitialState(externalConfig());
  const aborted = abortMatch(initial, 'timeout-both');
  const abortReplay = createReplay(externalConfig(), [], aborted);
  assert.deepEqual(verifyReplay(abortReplay), { ok: true, errors: [] });
});

test('frozen golden replay verifies', async () => {
  const source = await readFile(new URL('../../fixtures/golden-replay.json', import.meta.url), 'utf8');
  const replay = JSON.parse(source) as unknown;
  assert.deepEqual(verifyReplay(replay), { ok: true, errors: [] });
});

test('default config is valid and scripted', () => {
  const config = createDefaultConfig();
  assert.equal(config.players.A.role, 'bot');
  assert.equal(config.players.B.role, 'bot');
  assert.doesNotThrow(() => createInitialState(config));
  assert.ok(ContractError.prototype instanceof Error);
});
