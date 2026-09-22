# Testing

## Reproducible commands

Use Node 24.14.1 from `.node-version`:

```sh
npm ci
npm run verify
npm run test:e2e
```

`npm run verify` performs strict TypeScript checking/build, then Node unit/API/CLI tests over real loopback HTTP and subprocess CLI clients, followed by CLI recomputation of the frozen golden replay. `npm run test:e2e` builds, starts a loopback server, launches real headless Chromium, clicks through an eight-turn practice bout, steps/exports/verifies replay, edits a name/style/note, and rematches.

Linux uses pinned `@sparticuz/chromium@153.0.0`. To use another compatible installed browser:

```sh
CHROMIUM_PATH=/path/to/chromium npm run test:e2e
```

No browser means test failure; there is no skip branch.

## Coverage contract

Automated checks cover every move interaction branch, affordability/resource/terminal invariants, seat swap and submission order relations, strict runtime objects, redaction, bearer isolation, sealed pending information, retry idempotency/conflict, stale/wrong actions, JSON/Origin/body/resource limits, named timeout abort, bot practice, two-client HTTP and CLI games, replay/hash recomputation and tampering, safe browser text, responsive controls, replay navigation/export, and rematch setup delivery.

## Recorded local run

At 2026-09-21T06:08Z in the local Linux workspace on Node 24.14.1, this exact sequence passed:

```sh
npm ci && npm run verify && npm run test:e2e
```

Observed summary: `npm ci` added 73 packages, audited 74, and reported 0 vulnerabilities; `verify` passed 29 tests with 0 failed/cancelled/skipped/todo and then returned `{"ok":true,"errors":[]}` for the golden replay; browser E2E printed `Browser E2E passed: practice completion, replay stepping/export, inert text, style/note rematch, mobile controls.` All test servers, streams, subprocesses, and the browser were closed; a process check found no leftover Clank Corner server.

This same-machine loopback run is also summarized in `BUILD_REPORT.md`. It is not evidence of enabled hosted CI: `ci/verify.yml` is only a staged template.

## Not tested or claimed

- Physical two-machine LAN traffic/firewalls and TLS termination.
- pi or any third-party agent harness (the separate Ciani CLI smoke below did run).
- External provider compute/usage (reported as unverified/`null`, not zero).
- Long-running/public-internet hardening, persistence, or restart recovery.
- Human fun, accessibility audit, or competitive balance.
- Hosted CI execution; no workflow is enabled from `ci/`.

## Independent review — 2026-09-22

Fresh frozen installs, strict build/typecheck, API/CLI checks and real Chromium click E2E were rerun by the orchestrator, not accepted solely from the builder report. The game-only Ciani CLI smoke is recorded in [docs/external-agent-smoke.md](docs/external-agent-smoke.md); it supersedes the original blanket no-live-agent note, but does not certify a third-party harness, physical LAN or metered inference.

Review fixes: wait for hydrated browser state rather than placeholder visibility; remove the secure-context-only request-ID dependency; enforce full Origin matching and no-store private responses; abort and verify unexpected referee failures with no winner; add a read-only live spectator path and browser test. Current Node test count: 31 passed. Browser coverage includes the unavailable-randomUUID path and an independent live spectator through terminal replay.

Final reviewed gate on 2026-09-22: **31 Node tests passed, zero failed/skipped**, strict build/typecheck passed, and the real browser E2E passed. The recorded Ciani replay also passes the compiled CLI verifier.
