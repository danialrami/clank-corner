import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseAction } from '../src/bots.js';
import {
  STYLES,
  createInitialState,
  legalActions,
  normalizeMatchConfig,
  observe,
  resolveTurn,
  type GameState,
  type Seat,
  type Style,
} from '../src/engine.js';

function run(aStyle: Style, bStyle: Style): GameState {
  const config = normalizeMatchConfig({
    players: {
      A: { name: 'A', role: 'bot', style: aStyle, coachNote: 'note A is not a bot instruction' },
      B: { name: 'B', role: 'bot', style: bStyle, coachNote: 'note B is not a bot instruction' },
    },
    turnDeadlineMs: 1_000,
  });
  let state = createInitialState(config);
  while (state.status === 'active') {
    const actions = {
      A: chooseAction(observe(state, 'A'), aStyle),
      B: chooseAction(observe(state, 'B'), bStyle),
    };
    for (const seat of ['A', 'B'] as Seat[]) {
      assert.equal(legalActions(state, seat).some((candidate) => candidate.type === actions[seat].type), true);
    }
    state = resolveTurn(state, actions).state;
  }
  return state;
}

function swappedWinner(winner: Seat | null): Seat | null {
  return winner === 'A' ? 'B' : winner === 'B' ? 'A' : null;
}

test('every built-in style is deterministic, legal, and ignores coaching-note wording', () => {
  for (const style of STYLES) {
    const config = normalizeMatchConfig({
      players: {
        A: { name: 'A', role: 'bot', style, coachNote: 'first wording' },
        B: { name: 'B', role: 'bot', style: 'reactive', coachNote: '' },
      },
      turnDeadlineMs: 1_000,
    });
    const state = createInitialState(config);
    const first = observe(state, 'A');
    assert.equal(first.coachNote, '', 'bot observations do not receive coaching notes');
    const changedNote = { ...first, coachNote: 'entirely different wording' };
    assert.deepEqual(chooseAction(first, style), chooseAction(first, style));
    assert.deepEqual(chooseAction(first, style), chooseAction(changedNote, style));
    assert.equal(first.legalActions.some((candidate) => candidate.type === chooseAction(first, style).type), true);
  }
  assert.throws(() => chooseAction(observe(createInitialState(normalizeMatchConfig({
    players: {
      A: { name: 'A', role: 'external', style: null, coachNote: '' },
      B: { name: 'B', role: 'external', style: null, coachNote: '' },
    },
    turnDeadlineMs: 1_000,
  })), 'A'), 'unknown'), /unknown scripted style/);
});

test('scripted 3x3 round robin terminates and preserves side-swap relations', () => {
  for (const aStyle of STYLES) {
    for (const bStyle of STYLES) {
      const direct = run(aStyle, bStyle);
      const swapped = run(bStyle, aStyle);
      assert.notEqual(direct.status, 'active');
      assert.ok(direct.events.length >= 1 && direct.events.length <= 8);
      assert.deepEqual(direct.fighters.A, swapped.fighters.B, `${aStyle}/${bStyle} A`);
      assert.deepEqual(direct.fighters.B, swapped.fighters.A, `${aStyle}/${bStyle} B`);
      assert.equal(direct.result?.reason, swapped.result?.reason);
      assert.equal(direct.result?.winner ?? null, swappedWinner(swapped.result?.winner ?? null));
    }
  }
});
