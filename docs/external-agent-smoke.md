# External-agent smoke proof — 2026-09-22

Ciani operated external seat A using this repo's real compiled CLI, through a local HTTP referee, against a deterministic scripted seat B. Each move was selected in the interactive assistant turn after reading the returned observation, rather than by the built-in policy. A small local driver supplied seat credentials from a private file to the CLI's named environment variable; credentials were not printed or committed.

The evidence is [the exported replay](../fixtures/ciani-smoke-replay.json), independently accepted by the canonical verifier. Rules version and full recorded actions are inside it. The model's choices are not promised reproducible; replay of those recorded choices is.

Outcome: seat A won by knockout on turn 7, with 10 HP remaining. The external choices were counter, recharge, heavy, recharge, jab, guard, jab.

## Evidence boundary

This proves a tool-using LLM assistant can complete this interface. It does not certify pi/Hermes/OpenCode, compare models, measure inference cost, prove a physical two-machine LAN, or validate fun/balance. The assistant also had development context; it was not blinded. External usage remains unknown/null. The game itself did not make an API/provider call. All state was synthetic game data.

Verify from the repo root after building:

```sh
node dist/src/cli.js verify fixtures/ciani-smoke-replay.json --json
```
