import { createHash } from 'node:crypto';

export const GAME_ID = 'clank-corner' as const;
export const GAME_VERSION = '1.0.0' as const;
export const RULES_VERSION = 'corner-1' as const;
export const MAX_TURNS = 8;
export const STARTING_HP = 12;
export const STARTING_ENERGY = 3;
export const ENERGY_CAP = 6;
export const MAX_NAME_LENGTH = 40;
export const MAX_NOTE_LENGTH = 1_000;
export const DEFAULT_TURN_DEADLINE_MS = 60_000;

export const SEATS = ['A', 'B'] as const;
export type Seat = (typeof SEATS)[number];
export const ACTION_TYPES = ['jab', 'heavy', 'guard', 'counter', 'recharge', 'feint'] as const;
export type ActionType = (typeof ACTION_TYPES)[number];
export interface Action {
  type: ActionType;
}

export const STYLES = ['aggressive', 'cautious', 'reactive'] as const;
export type Style = (typeof STYLES)[number];
export type PlayerRole = 'external' | 'bot';

export interface PlayerConfig {
  name: string;
  role: PlayerRole;
  style: Style | null;
  coachNote: string;
}

export interface MatchConfig {
  players: Record<Seat, PlayerConfig>;
  turnDeadlineMs: number;
}

export interface FighterState {
  hp: number;
  energy: number;
}

export type MatchStatus = 'active' | 'completed' | 'aborted';
export type ResultReason =
  | 'knockout'
  | 'double-ko'
  | 'points'
  | 'draw-at-limit'
  | 'timeout-A'
  | 'timeout-B'
  | 'timeout-both'
  | 'server-error';

export interface GameResult {
  status: 'completed' | 'aborted';
  winner: Seat | null;
  reason: ResultReason;
  finalTurn: number;
}

export interface SeatTurnDelta {
  hp: number;
  energy: number;
}

export interface GameEvent {
  leg: 1;
  turn: number;
  actions: Record<Seat, Action>;
  damage: Record<Seat, number>;
  deltas: Record<Seat, SeatTurnDelta>;
  after: Record<Seat, FighterState>;
  result: GameResult | null;
}

export interface GameState {
  rulesVersion: typeof RULES_VERSION;
  config: MatchConfig;
  leg: 1;
  turn: number;
  status: MatchStatus;
  fighters: Record<Seat, FighterState>;
  events: GameEvent[];
  result: GameResult | null;
}

export interface Observation {
  rulesVersion: typeof RULES_VERSION;
  seat: Seat;
  leg: 1;
  turn: number;
  status: MatchStatus;
  self: FighterState & { name: string; role: PlayerRole; style: Style | null };
  opponent: FighterState & { name: string; role: PlayerRole; style: Style | null };
  legalActions: Action[];
  coachNote: string;
  events: GameEvent[];
  result: GameResult | null;
}

export interface PublicPlayer {
  name: string;
  role: PlayerRole;
  style: Style | null;
}

export interface PublicView {
  game: typeof GAME_ID;
  version: typeof GAME_VERSION;
  rulesVersion: typeof RULES_VERSION;
  leg: 1;
  turn: number;
  status: MatchStatus;
  players: Record<Seat, PublicPlayer>;
  fighters: Record<Seat, FighterState>;
  events: GameEvent[];
  result: GameResult | null;
}

export interface ReplayTurn {
  leg: 1;
  turn: number;
  actions: Record<Seat, Action>;
}

export interface ReplayConfig {
  players: Record<Seat, Omit<PlayerConfig, 'coachNote'>>;
  turnDeadlineMs: number;
}

export interface ReplayFinalState {
  leg: 1;
  turn: number;
  status: MatchStatus;
  fighters: Record<Seat, FighterState>;
  result: GameResult | null;
}

export interface Replay {
  schemaVersion: 1;
  game: typeof GAME_ID;
  version: typeof GAME_VERSION;
  rulesVersion: typeof RULES_VERSION;
  config: ReplayConfig;
  actions: ReplayTurn[];
  events: GameEvent[];
  result: GameResult;
  finalState: ReplayFinalState;
  hash: string;
}

export class ContractError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ContractError';
  }
}

const ACTION_COST: Record<ActionType, number> = {
  jab: 1,
  heavy: 3,
  guard: 0,
  counter: 2,
  recharge: 0,
  feint: 2,
};

export const ACTION_RULES: Record<ActionType, { cost: number; description: string }> = {
  jab: { cost: 1, description: 'Deal 2 damage.' },
  heavy: { cost: 3, description: 'Deal 5 damage.' },
  guard: { cost: 0, description: 'Reduce incoming jab/heavy damage by 3; feint ignores it.' },
  counter: { cost: 2, description: 'Cancel an incoming jab/heavy and deal 4 back; otherwise deal 0.' },
  recharge: { cost: 0, description: 'Restore 2 energy after damage, up to 6.' },
  feint: { cost: 2, description: 'Deal 2 damage through guard and counter.' },
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isPlainRecord(value)) throw new ContractError(`${label} must be a plain object`);
}

function assertExactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const keys = Object.keys(value);
  const unknown = keys.filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new ContractError(`${label} has unknown field: ${unknown[0]}`);
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new ContractError(`${label} contains inherited field: ${key}`);
    }
  }
}

function cloneAction(action: Action): Action {
  return { type: action.type };
}

function cloneFighter(fighter: FighterState): FighterState {
  return { hp: fighter.hp, energy: fighter.energy };
}

function cloneResult(result: GameResult | null): GameResult | null {
  return result === null ? null : { ...result };
}

function cloneEvent(event: GameEvent): GameEvent {
  return {
    leg: 1,
    turn: event.turn,
    actions: { A: cloneAction(event.actions.A), B: cloneAction(event.actions.B) },
    damage: { ...event.damage },
    deltas: { A: { ...event.deltas.A }, B: { ...event.deltas.B } },
    after: { A: cloneFighter(event.after.A), B: cloneFighter(event.after.B) },
    result: cloneResult(event.result),
  };
}

function cloneConfig(config: MatchConfig): MatchConfig {
  return {
    players: {
      A: { ...config.players.A },
      B: { ...config.players.B },
    },
    turnDeadlineMs: config.turnDeadlineMs,
  };
}

export function otherSeat(seat: Seat): Seat {
  return seat === 'A' ? 'B' : 'A';
}

export function isSeat(value: unknown): value is Seat {
  return value === 'A' || value === 'B';
}

export function parseAction(value: unknown, label = 'action'): Action {
  assertPlainRecord(value, label);
  assertExactKeys(value, ['type'], label);
  if (!Object.prototype.hasOwnProperty.call(value, 'type')) {
    throw new ContractError(`${label}.type is required`);
  }
  if (typeof value.type !== 'string' || !ACTION_TYPES.includes(value.type as ActionType)) {
    throw new ContractError(`${label}.type is not a known action`);
  }
  return { type: value.type as ActionType };
}

function parsePlayer(value: unknown, seat: Seat): PlayerConfig {
  assertPlainRecord(value, `players.${seat}`);
  assertExactKeys(value, ['name', 'role', 'style', 'coachNote'], `players.${seat}`);
  if (typeof value.name !== 'string') throw new ContractError(`players.${seat}.name must be a string`);
  const name = value.name.trim();
  if (name.length < 1 || name.length > MAX_NAME_LENGTH) {
    throw new ContractError(`players.${seat}.name must be 1-${MAX_NAME_LENGTH} characters`);
  }
  if (value.role !== 'external' && value.role !== 'bot') {
    throw new ContractError(`players.${seat}.role must be external or bot`);
  }
  const coachNote = value.coachNote === undefined ? '' : value.coachNote;
  if (typeof coachNote !== 'string' || coachNote.length > MAX_NOTE_LENGTH) {
    throw new ContractError(`players.${seat}.coachNote must be at most ${MAX_NOTE_LENGTH} characters`);
  }
  if (value.role === 'bot') {
    if (typeof value.style !== 'string' || !STYLES.includes(value.style as Style)) {
      throw new ContractError(`players.${seat}.style must name a scripted style for bot seats`);
    }
    return { name, role: 'bot', style: value.style as Style, coachNote };
  }
  if (value.style !== undefined && value.style !== null) {
    throw new ContractError(`players.${seat}.style must be null or omitted for external seats`);
  }
  return { name, role: 'external', style: null, coachNote };
}

export function normalizeMatchConfig(value: unknown): MatchConfig {
  assertPlainRecord(value, 'config');
  assertExactKeys(value, ['players', 'turnDeadlineMs'], 'config');
  assertPlainRecord(value.players, 'config.players');
  assertExactKeys(value.players, ['A', 'B'], 'config.players');
  if (!Object.prototype.hasOwnProperty.call(value.players, 'A') || !Object.prototype.hasOwnProperty.call(value.players, 'B')) {
    throw new ContractError('config.players must contain A and B');
  }
  const deadline = value.turnDeadlineMs === undefined ? DEFAULT_TURN_DEADLINE_MS : value.turnDeadlineMs;
  if (!Number.isInteger(deadline) || (deadline as number) < 10 || (deadline as number) > 300_000) {
    throw new ContractError('config.turnDeadlineMs must be an integer from 10 to 300000');
  }
  return {
    players: {
      A: parsePlayer(value.players.A, 'A'),
      B: parsePlayer(value.players.B, 'B'),
    },
    turnDeadlineMs: deadline as number,
  };
}

export function createDefaultConfig(): MatchConfig {
  return {
    players: {
      A: { name: 'Clatter', role: 'bot', style: 'aggressive', coachNote: '' },
      B: { name: 'Clank', role: 'bot', style: 'cautious', coachNote: '' },
    },
    turnDeadlineMs: DEFAULT_TURN_DEADLINE_MS,
  };
}

export function createInitialState(config: MatchConfig): GameState {
  const validated = normalizeMatchConfig(config);
  return {
    rulesVersion: RULES_VERSION,
    config: cloneConfig(validated),
    leg: 1,
    turn: 1,
    status: 'active',
    fighters: {
      A: { hp: STARTING_HP, energy: STARTING_ENERGY },
      B: { hp: STARTING_HP, energy: STARTING_ENERGY },
    },
    events: [],
    result: null,
  };
}

export function legalActions(state: GameState, seat: Seat): Action[] {
  if (!isSeat(seat)) throw new ContractError('seat must be A or B');
  if (state.status !== 'active') return [];
  const energy = state.fighters[seat].energy;
  return ACTION_TYPES.filter((type) => ACTION_COST[type] <= energy).map((type) => ({ type }));
}

function damageFor(action: ActionType, opponentAction: ActionType): number {
  if (action === 'feint') return 2;
  if (action === 'counter') return opponentAction === 'jab' || opponentAction === 'heavy' ? 4 : 0;
  if (action !== 'jab' && action !== 'heavy') return 0;
  if (opponentAction === 'counter') return 0;
  const base = action === 'jab' ? 2 : 5;
  return opponentAction === 'guard' ? Math.max(0, base - 3) : base;
}

function resultAt(after: Record<Seat, FighterState>, turn: number): GameResult | null {
  const aDown = after.A.hp === 0;
  const bDown = after.B.hp === 0;
  if (aDown || bDown) {
    return {
      status: 'completed',
      winner: aDown === bDown ? null : aDown ? 'B' : 'A',
      reason: aDown && bDown ? 'double-ko' : 'knockout',
      finalTurn: turn,
    };
  }
  if (turn === MAX_TURNS) {
    if (after.A.hp === after.B.hp) {
      return { status: 'completed', winner: null, reason: 'draw-at-limit', finalTurn: turn };
    }
    return {
      status: 'completed',
      winner: after.A.hp > after.B.hp ? 'A' : 'B',
      reason: 'points',
      finalTurn: turn,
    };
  }
  return null;
}

export function resolveTurn(
  state: GameState,
  actionsValue: Record<Seat, Action>,
): { state: GameState; events: GameEvent[] } {
  if (state.status !== 'active') throw new ContractError('cannot resolve a terminal match');
  if (!Number.isInteger(state.turn) || state.turn < 1 || state.turn > MAX_TURNS) {
    throw new ContractError('state turn is outside the rules');
  }
  assertPlainRecord(actionsValue, 'actions');
  assertExactKeys(actionsValue, ['A', 'B'], 'actions');
  if (!Object.prototype.hasOwnProperty.call(actionsValue, 'A') || !Object.prototype.hasOwnProperty.call(actionsValue, 'B')) {
    throw new ContractError('actions must contain A and B');
  }
  const actions: Record<Seat, Action> = {
    A: parseAction(actionsValue.A, 'actions.A'),
    B: parseAction(actionsValue.B, 'actions.B'),
  };
  for (const seat of SEATS) {
    if (ACTION_COST[actions[seat].type] > state.fighters[seat].energy) {
      throw new ContractError(`${seat} cannot afford ${actions[seat].type} at start of turn`);
    }
  }

  const damageDealt = {
    A: damageFor(actions.A.type, actions.B.type),
    B: damageFor(actions.B.type, actions.A.type),
  };
  const after: Record<Seat, FighterState> = {
    A: {
      hp: Math.max(0, state.fighters.A.hp - damageDealt.B),
      energy: Math.min(
        ENERGY_CAP,
        state.fighters.A.energy - ACTION_COST[actions.A.type] + (actions.A.type === 'recharge' ? 2 : 0),
      ),
    },
    B: {
      hp: Math.max(0, state.fighters.B.hp - damageDealt.A),
      energy: Math.min(
        ENERGY_CAP,
        state.fighters.B.energy - ACTION_COST[actions.B.type] + (actions.B.type === 'recharge' ? 2 : 0),
      ),
    },
  };
  const result = resultAt(after, state.turn);
  const event: GameEvent = {
    leg: 1,
    turn: state.turn,
    actions: { A: cloneAction(actions.A), B: cloneAction(actions.B) },
    damage: { A: damageDealt.A, B: damageDealt.B },
    deltas: {
      A: { hp: after.A.hp - state.fighters.A.hp, energy: after.A.energy - state.fighters.A.energy },
      B: { hp: after.B.hp - state.fighters.B.hp, energy: after.B.energy - state.fighters.B.energy },
    },
    after: { A: cloneFighter(after.A), B: cloneFighter(after.B) },
    result: cloneResult(result),
  };
  const next: GameState = {
    rulesVersion: RULES_VERSION,
    config: cloneConfig(state.config),
    leg: 1,
    turn: result === null ? state.turn + 1 : state.turn,
    status: result === null ? 'active' : 'completed',
    fighters: after,
    events: [...state.events.map(cloneEvent), cloneEvent(event)],
    result: cloneResult(result),
  };
  return { state: next, events: [cloneEvent(event)] };
}

export function abortMatch(state: GameState, reason: Extract<ResultReason, `timeout-${string}`> | 'server-error'): GameState {
  if (state.status !== 'active') throw new ContractError('cannot abort a terminal match');
  if (!['timeout-A', 'timeout-B', 'timeout-both', 'server-error'].includes(reason)) {
    throw new ContractError('unknown abort reason');
  }
  const result: GameResult = { status: 'aborted', winner: null, reason, finalTurn: state.turn };
  return {
    ...state,
    config: cloneConfig(state.config),
    fighters: { A: cloneFighter(state.fighters.A), B: cloneFighter(state.fighters.B) },
    events: state.events.map(cloneEvent),
    status: 'aborted',
    result,
  };
}

export function observe(state: GameState, seat: Seat): Observation {
  if (!isSeat(seat)) throw new ContractError('seat must be A or B');
  const opponent = otherSeat(seat);
  return {
    rulesVersion: RULES_VERSION,
    seat,
    leg: 1,
    turn: state.turn,
    status: state.status,
    self: {
      ...cloneFighter(state.fighters[seat]),
      name: state.config.players[seat].name,
      role: state.config.players[seat].role,
      style: state.config.players[seat].style,
    },
    opponent: {
      ...cloneFighter(state.fighters[opponent]),
      name: state.config.players[opponent].name,
      role: state.config.players[opponent].role,
      style: state.config.players[opponent].style,
    },
    legalActions: legalActions(state, seat),
    coachNote: state.config.players[seat].role === 'external' ? state.config.players[seat].coachNote : '',
    events: state.events.map(cloneEvent),
    result: cloneResult(state.result),
  };
}

export function publicView(state: GameState): PublicView {
  return {
    game: GAME_ID,
    version: GAME_VERSION,
    rulesVersion: RULES_VERSION,
    leg: 1,
    turn: state.turn,
    status: state.status,
    players: {
      A: {
        name: state.config.players.A.name,
        role: state.config.players.A.role,
        style: state.config.players.A.style,
      },
      B: {
        name: state.config.players.B.name,
        role: state.config.players.B.role,
        style: state.config.players.B.style,
      },
    },
    fighters: { A: cloneFighter(state.fighters.A), B: cloneFighter(state.fighters.B) },
    events: state.events.map(cloneEvent),
    result: cloneResult(state.result),
  };
}

function replayConfig(config: MatchConfig): ReplayConfig {
  return {
    players: {
      A: { name: config.players.A.name, role: config.players.A.role, style: config.players.A.style },
      B: { name: config.players.B.name, role: config.players.B.role, style: config.players.B.style },
    },
    turnDeadlineMs: config.turnDeadlineMs,
  };
}

function replayMatchConfig(config: ReplayConfig): MatchConfig {
  return {
    players: {
      A: { ...config.players.A, coachNote: '' },
      B: { ...config.players.B, coachNote: '' },
    },
    turnDeadlineMs: config.turnDeadlineMs,
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isPlainRecord(value)) {
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) output[key] = canonicalize(value[key]);
    return output;
  }
  return value;
}

function hashReplayParts(value: Omit<Replay, 'hash'>): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

export function createReplay(config: MatchConfig, actions: ReplayTurn[], finalState: GameState): Replay {
  if (finalState.status === 'active' || finalState.result === null) {
    throw new ContractError('a replay requires a terminal final state');
  }
  const withoutHash: Omit<Replay, 'hash'> = {
    schemaVersion: 1,
    game: GAME_ID,
    version: GAME_VERSION,
    rulesVersion: RULES_VERSION,
    config: replayConfig(config),
    actions: actions.map((turn) => ({
      leg: 1,
      turn: turn.turn,
      actions: { A: cloneAction(turn.actions.A), B: cloneAction(turn.actions.B) },
    })),
    events: finalState.events.map(cloneEvent),
    result: { ...finalState.result },
    finalState: {
      leg: 1,
      turn: finalState.turn,
      status: finalState.status,
      fighters: { A: cloneFighter(finalState.fighters.A), B: cloneFighter(finalState.fighters.B) },
      result: { ...finalState.result },
    },
  };
  return { ...withoutHash, hash: hashReplayParts(withoutHash) };
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function parseReplayConfig(value: unknown): ReplayConfig {
  assertPlainRecord(value, 'replay.config');
  assertExactKeys(value, ['players', 'turnDeadlineMs'], 'replay.config');
  assertPlainRecord(value.players, 'replay.config.players');
  assertExactKeys(value.players, ['A', 'B'], 'replay.config.players');
  const players = {} as Record<Seat, Omit<PlayerConfig, 'coachNote'>>;
  for (const seat of SEATS) {
    const candidate = value.players[seat];
    assertPlainRecord(candidate, `replay.config.players.${seat}`);
    assertExactKeys(candidate, ['name', 'role', 'style'], `replay.config.players.${seat}`);
    const parsed = parsePlayer({ ...candidate, coachNote: '' }, seat);
    players[seat] = { name: parsed.name, role: parsed.role, style: parsed.style };
  }
  const normalized = normalizeMatchConfig({
    players: {
      A: { ...players.A, coachNote: '' },
      B: { ...players.B, coachNote: '' },
    },
    turnDeadlineMs: value.turnDeadlineMs,
  });
  return replayConfig(normalized);
}

function parseReplayTurn(value: unknown, index: number): ReplayTurn {
  assertPlainRecord(value, `replay.actions[${index}]`);
  assertExactKeys(value, ['leg', 'turn', 'actions'], `replay.actions[${index}]`);
  if (value.leg !== 1) throw new ContractError(`replay.actions[${index}].leg must be 1`);
  if (!Number.isInteger(value.turn) || value.turn !== index + 1) {
    throw new ContractError(`replay.actions[${index}].turn must be ${index + 1}`);
  }
  assertPlainRecord(value.actions, `replay.actions[${index}].actions`);
  assertExactKeys(value.actions, ['A', 'B'], `replay.actions[${index}].actions`);
  return {
    leg: 1,
    turn: value.turn as number,
    actions: {
      A: parseAction(value.actions.A, `replay.actions[${index}].actions.A`),
      B: parseAction(value.actions.B, `replay.actions[${index}].actions.B`),
    },
  };
}

export function verifyReplay(replay: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  try {
    assertPlainRecord(replay, 'replay');
    assertExactKeys(
      replay,
      ['schemaVersion', 'game', 'version', 'rulesVersion', 'config', 'actions', 'events', 'result', 'finalState', 'hash'],
      'replay',
    );
    for (const key of ['schemaVersion', 'game', 'version', 'rulesVersion', 'config', 'actions', 'events', 'result', 'finalState']) {
      if (!Object.prototype.hasOwnProperty.call(replay, key)) throw new ContractError(`replay.${key} is required`);
    }
    if (replay.schemaVersion !== 1) throw new ContractError('replay.schemaVersion must be 1');
    if (replay.game !== GAME_ID) throw new ContractError(`replay.game must be ${GAME_ID}`);
    if (replay.version !== GAME_VERSION) throw new ContractError(`replay.version must be ${GAME_VERSION}`);
    if (replay.rulesVersion !== RULES_VERSION) throw new ContractError(`replay.rulesVersion must be ${RULES_VERSION}`);
    if (!Array.isArray(replay.actions) || replay.actions.length > MAX_TURNS) {
      throw new ContractError(`replay.actions must contain at most ${MAX_TURNS} turns`);
    }
    if (!Array.isArray(replay.events)) throw new ContractError('replay.events must be an array');
    const config = parseReplayConfig(replay.config);
    const turns = replay.actions.map(parseReplayTurn);
    let state = createInitialState(replayMatchConfig(config));
    for (const turn of turns) {
      if (state.status !== 'active') throw new ContractError('replay contains actions after terminal state');
      state = resolveTurn(state, turn.actions).state;
    }
    assertPlainRecord(replay.result, 'replay.result');
    if (state.status === 'active') {
      const reason = replay.result.reason;
      if (reason !== 'timeout-A' && reason !== 'timeout-B' && reason !== 'timeout-both' && reason !== 'server-error') {
        throw new ContractError('nonterminal action history requires a named abort');
      }
      state = abortMatch(state, reason);
    }
    if (state.status === 'active' || state.result === null) throw new ContractError('replay is missing a terminal final state');
    const expected = createReplay(replayMatchConfig(config), turns, state);
    if (!deepEqual(replay.events, expected.events)) errors.push('events do not match canonical recomputation');
    if (!deepEqual(replay.result, expected.result)) errors.push('result does not match canonical recomputation');
    if (!deepEqual(replay.finalState, expected.finalState)) errors.push('finalState does not match canonical recomputation');
    if (Object.prototype.hasOwnProperty.call(replay, 'hash')) {
      if (typeof replay.hash !== 'string' || !/^[a-f0-9]{64}$/.test(replay.hash)) {
        errors.push('hash is not a lowercase SHA-256 value');
      } else {
        const suppliedWithoutHash = { ...replay };
        delete suppliedWithoutHash.hash;
        const actual = hashReplayParts(suppliedWithoutHash as Omit<Replay, 'hash'>);
        if (actual !== replay.hash) errors.push('hash does not match replay content');
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'unknown replay error');
  }
  return { ok: errors.length === 0, errors };
}

export function rulesDocument(): object {
  return {
    game: GAME_ID,
    version: GAME_VERSION,
    rulesVersion: RULES_VERSION,
    starting: { hp: STARTING_HP, energy: STARTING_ENERGY },
    energyCap: ENERGY_CAP,
    maxTurns: MAX_TURNS,
    simultaneous: true,
    actions: ACTION_RULES,
    outcome: {
      knockout: 'A zero-HP fighter loses; simultaneous zero HP is a draw.',
      turnLimit: 'After turn 8, higher HP wins; equal HP is a draw. Energy never breaks ties.',
      timeout: 'The match aborts with no winner.',
    },
    actionSchema: { type: ACTION_TYPES },
  };
}
