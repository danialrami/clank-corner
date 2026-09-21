# Unit 03 — Agent client and scripted practice

## Objective
Deliver agent client and scripted practice for Clank Corner, satisfying the phase contract.

## Context
Read ../SPEC.md; predecessor units define the shared types. Unit 01 is first; 02 and 03 may proceed after 01 with fixed imported interfaces; 04 follows 02; 05 closes the integration.

## Acceptance criteria
- [ ] A documented CLI sequence completes a two-client game and verifies an exported replay.
- [ ] Built-ins are deterministic legal role-aware policies; mode and inference usage are honest.
- [ ] Invalid args, absent token, network failure and bad replay have nonzero documented exits.

## Interface contract
CLI serve/rules/create/observe/act/replay/verify/demo; --json envelope and 0/2/3/5 exit semantics; Bearer token via selected environment variable. chooseAction(observation: Observation, style: string): Action uses only supplied view.

## Boundaries
- Touches: src/cli.ts, src/bots.ts, test/cli.test.ts, examples/
- Does NOT touch: src/engine.ts rule changes, public/

## Output
Small focused implementation, colocated tests, and a truthful verification note. No placeholder-success paths.

## Verification
```sh
npm run build && node --test dist/test/cli.test.js
```
