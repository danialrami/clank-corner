# Unit 01 — Referee and replay contract

## Objective
Deliver referee and replay contract for Clank Corner, satisfying the phase contract.

## Context
Read ../SPEC.md; predecessor units define the shared types. Unit 01 is first; 02 and 03 may proceed after 01 with fixed imported interfaces; 04 follows 02; 05 closes the integration.

## Acceptance criteria
- [ ] All exact phase rules implemented without I/O or model calls.
- [ ] Runtime configuration/action validation fails closed.
- [ ] Golden and metamorphic fixtures cover legal outcomes, swap/order invariance, boundary resources and tampered replay.

## Interface contract
createInitialState(config: MatchConfig): GameState; legalActions(state: GameState, seat: Seat): Action[]; observe(state: GameState, seat: Seat): Observation; resolveTurn(state: GameState, actions: Record<Seat, Action>): {state: GameState; events: GameEvent[]}; publicView(state: GameState): PublicView; verifyReplay(replay: unknown): {ok: boolean; errors: string[]}

## Boundaries
- Touches: src/engine.ts, src/types.ts if needed, test/engine.test.ts, fixtures/
- Does NOT touch: src/server.ts, public/, src/cli.ts

## Output
Small focused implementation, colocated tests, and a truthful verification note. No placeholder-success paths.

## Verification
```sh
npm run build && node --test dist/test/engine.test.js
```
