---
name: verify-clank-corner
description: Reproduce this repository's strict build, referee/API/CLI checks, canonical replay verification, and real Chromium browser end-to-end test.
---

# Verify Clank Corner

From the repository root with Node 24.14.1:

```sh
npm ci
npm run verify
npm run test:e2e
```

`verify` must typecheck/build, pass all compiled `node:test` suites, and verify `fixtures/golden-replay.json` by canonical recomputation. `test:e2e` must launch and click a real browser; on non-Linux systems set `CHROMIUM_PATH=/path/to/chromium`. A missing browser is a failure, not a skip.

On failure, run focused commands from the phase units (`node --test dist/test/engine.test.js`, `api.test.js`, or `cli.test.js`) after `npm run build`. Check that no server/stream/browser/child process remains. Confirm public views/SSE/replays contain no bearer token, pending move, or coaching note. Confirm tampered replay returns exit 5.

Record actual same-machine results and limitations in `BUILD_REPORT.md`/`TESTING.md`. `ci/verify.yml` is staged and inactive; do not report hosted checks. Do not infer physical LAN, model-harness compatibility, fun, balance, or provider usage from these tests.
