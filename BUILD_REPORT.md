# Clank Corner v1 build report

**Status:** complete locally against the authorized LAN-first `corner-1` contract. Recorded 2026-09-21T06:08Z on Linux with Node 24.14.1.

## Implemented

- `src/engine.ts`: canonical strict types, six-move simultaneous referee, runtime config/action validation, observations/public projection, named timeout abort, redacted replay construction, canonical SHA-256, and fail-closed recomputation verification.
- `src/server.ts`: Fastify HTTP/static service, random hashed seat/host bearer capabilities, sealed/idempotent actions, server-owned bot seats, injectable deadlines, same-origin/JSON/body checks, redacted SSE, replay download, rematch, and bounded memory/connections.
- `src/bots.ts`: deterministic aggressive/cautious/reactive closed policies using only their seat observation; bot observations receive no coaching note.
- `src/cli.ts`: `serve`, `rules`, `create`, `observe`, `act`, `replay`, `verify`, and `demo`; JSON envelopes; token environment-variable handling; exits 0/2/3/5; explicit LAN warning.
- `public/`: compact responsive human-versus-scripted-bot game with real move controls, HP/energy/events/result, safe text rendering, replay stepping/export, editable external note/opponent style, and host-authenticated rematch.
- `test/` and `fixtures/`: referee/metamorphic/tamper tests, 3×3 scripted round robin, real loopback API and subprocess CLI E2E, frozen replay, and real Playwright Chromium click E2E.
- `README.md`, `CHANGELOG.md`, `AGENTS.md`, `TESTING.md`, `docs/{usage,rules,protocol,security}.md`, `examples/two-client.md`, and two repo-scoped skills.
- Exact runtime/tool pins and frozen `package-lock.json`; staged `ci/verify.yml` with the required SHA-pinned actions. It is intentionally not enabled.

## Final verification

Exact clean sequence:

```sh
npm ci && npm run verify && npm run test:e2e
```

Results:

- `npm ci`: 73 packages added, 74 audited, 0 vulnerabilities reported.
- strict typecheck/build: passed.
- Node tests: **29 passed; 0 failed, cancelled, skipped, or todo**.
- frozen replay CLI recomputation: `ok: true`, no errors.
- real browser: passed practice completion, visible result, replay stepping/export plus canonical verification, inert name rendering, mobile controls, edited style/note delivery, and rematch.
- process check after tests: no Clank Corner server/browser child remained.
- Scripted 3×3 measurement: all 9 matches reached turn 8; 3 same-style draws and 6 side-symmetric points results. This is a degeneracy smoke measurement, not a balance/fun claim.

## Bounds and implementation choices

Within the spec's permitted concrete choices: 16 KiB request bodies; 32 retained in-memory matches; 32 SSE clients globally/8 per match; 1–40 character names; 1,000-character notes; 10–300,000 ms deadlines (60,000 default); 80-character safe request IDs. Terminal matches remain retained until process exit, so the 32-match cap is deliberately hard and honest.

Browser practice is manual external seat A versus one scripted bot; external/external and bot/bot are available through HTTP/CLI. Coaching text is delivered only to its owning external observation and never changes a built-in policy. No provider-specific adapter was added.

## Remaining gaps / unverified evidence

- No physical two-machine LAN/firewall/TLS run.
- No live model, pi, or other third-party harness run; external compute/usage remains unverified/`null`, not zero.
- No human fun, accessibility audit, or competitive-balance evidence.
- No persistence/restart recovery or public-internet hardening; memory is ephemeral and plain LAN HTTP is unencrypted.
- No hosted CI run; `ci/verify.yml` is staged only.
- No license grant; package remains `UNLICENSED` pending owner choice.

## Spec deviations

None found. Concrete bounds above narrow unspecified values without changing the authoritative behavior. No authoritative spec text was changed.

## Independent review — 2026-09-22 (supersedes the original evidence boundary)

The orchestrator reread the code, reran clean installs and verification, exercised real browser controls, and ran an actual Ciani external seat through the CLI. See docs/external-agent-smoke.md and its replay fixture. Third-party harnesses, two physical machines, fun/balance and enabled CI remain unverified.

Review fixes: wait for hydrated browser state rather than placeholder visibility; remove the secure-context-only request-ID dependency; enforce full Origin matching and no-store private responses; abort and verify unexpected referee failures with no winner; add a read-only live spectator path and browser test. Current Node test count: 31 passed. Browser coverage includes the unavailable-randomUUID path and an independent live spectator through terminal replay.

Final reviewed gate: 31 Node tests passed, no failures/skips; strict build, replay recomputation and real browser E2E passed on 2026-09-22. See the numbered issue #1 for open follow-ups.
