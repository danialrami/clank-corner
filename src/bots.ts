import {
  ContractError,
  STYLES,
  type Action,
  type ActionType,
  type Observation,
  type Style,
} from './engine.js';

function has(legal: readonly Action[], type: ActionType): boolean {
  return legal.some((action) => action.type === type);
}

function firstLegal(observation: Observation, preferences: readonly ActionType[]): Action {
  for (const type of preferences) {
    if (has(observation.legalActions, type)) return { type };
  }
  throw new ContractError('observation contains no legal actions');
}

/**
 * A closed, deterministic practice policy. It receives only the authenticated
 * observation for its own seat and never reads a match store or opponent seal.
 */
export function chooseAction(observation: Observation, styleValue: string): Action {
  if (!STYLES.includes(styleValue as Style)) {
    throw new ContractError(`unknown scripted style: ${styleValue}`);
  }
  const style = styleValue as Style;
  if (observation.status !== 'active') throw new ContractError('cannot choose an action for a terminal observation');

  if (style === 'aggressive') {
    return firstLegal(observation, ['heavy', 'feint', 'jab', 'recharge', 'counter', 'guard']);
  }

  if (style === 'cautious') {
    if (observation.self.energy < 2) return firstLegal(observation, ['recharge', 'guard', 'jab']);
    if (observation.self.hp <= 5) return firstLegal(observation, ['counter', 'guard', 'recharge', 'jab']);
    return firstLegal(observation, ['guard', 'counter', 'recharge', 'jab']);
  }

  const last = observation.events.at(-1);
  const opponentSeat = observation.seat === 'A' ? 'B' : 'A';
  const lastOpponentAction = last?.actions[opponentSeat].type;
  if ((lastOpponentAction === 'jab' || lastOpponentAction === 'heavy') && has(observation.legalActions, 'counter')) {
    return { type: 'counter' };
  }
  if ((lastOpponentAction === 'guard' || lastOpponentAction === 'counter') && has(observation.legalActions, 'feint')) {
    return { type: 'feint' };
  }
  if (observation.self.energy <= 1) return firstLegal(observation, ['recharge', 'guard', 'jab']);
  return firstLegal(observation, ['jab', 'counter', 'guard', 'recharge']);
}
