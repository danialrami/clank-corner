---
name: play-clank-corner
description: Run and play this repository's local Clank Corner browser, scripted demo, or authenticated CLI protocol without overstating model evidence.
---

# Play Clank Corner

1. From the repository root, confirm Node 24.14.1, then run `npm ci && npm run build`.
2. For browser practice, run `node dist/src/cli.js serve`, open `http://127.0.0.1:3210`, choose the external fighter's move, inspect/export the terminal replay, edit setup, and rematch.
3. For a no-model smoke bout, run `node dist/src/cli.js demo --json`. Require `mode: scripted-practice`, `liveModelCalls: false`, and `replayVerified: true`.
4. For external clients, use the create/observe/act sequence in `docs/usage.md`. Put each bearer value in its own environment variable and pass only its variable name through `--token-env`. Never put tokens in arguments, URLs, logs, or replay files.
5. Stop on completed/aborted. Export with `replay --out` and recompute with `verify`; a hash by itself is not verification.

Failure checks: do not act outside `legalActions`; do not change content under a reused request ID; treat timeout/provider/transport failures as aborts or errors, never wins. Built-ins are deterministic scripted styles and ignore coach notes. Do not claim a live model, third-party harness, physical LAN, balance, or fun unless separately run and evidenced.
