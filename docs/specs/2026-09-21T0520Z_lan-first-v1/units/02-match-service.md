# Unit 02 — Bounded two-seat match service

## Objective
Deliver bounded two-seat match service for Clank Corner, satisfying the phase contract.

## Context
Read ../SPEC.md; predecessor units define the shared types. Unit 01 is first; 02 and 03 may proceed after 01 with fixed imported interfaces; 04 follows 02; 05 closes the integration.

## Acceptance criteria
- [ ] Both independently authenticated seats play a complete game over real HTTP.
- [ ] Pending/private state and capability tokens never leak into public views/SSE/replays.
- [ ] Conflicting duplicates, stale leg/turn, deadlines, limits and foreign Origin are exercised; aborts have no winner.

## Interface contract
createServer(options?: {host?: string; port?: number; turnTimeoutMs?: number}): FastifyInstance; HTTP routes, bearer capabilities and action envelope exactly as phase SPEC.

## Boundaries
- Touches: src/server.ts, src/store.ts if needed, test/api.test.ts
- Does NOT touch: src/engine.ts rule changes, public/, src/cli.ts

## Output
Small focused implementation, colocated tests, and a truthful verification note. No placeholder-success paths.

## Verification
```sh
npm run build && node --test dist/test/api.test.js
```
