# Repository guidance for agents

Read `SPEC.md`, the linked phase specification, and every unit before changing behavior. The phase specification is the authority.

## Architecture

- `src/engine.ts` exclusively owns rule transitions and canonical shared types.
- `src/server.ts`, `src/cli.ts`, `src/bots.ts`, and `public/` are adapters/clients; do not reimplement combat rules there.
- Built-ins must remain closed deterministic policies over only their supplied observation. Never describe them as agents, LLMs, or live model calls.
- Treat seat and host tokens as capabilities. Never put them in URLs, logs, public views, SSE, fixtures, or replays.
- Coaching notes belong only to the owning external observation and do not alter built-in bot policy.
- Render user names/notes with `textContent`, not HTML insertion.

## Required checks

```sh
npm ci
npm run verify
npm run test:e2e
```

A missing browser must fail. Keep timers, servers, streams, browser contexts, and child processes cleanly closed in tests. Update the authoritative spec and `BUILD_REPORT.md` when behavior changes.

## Scope and claims

This is a self-contained repository: do not import sibling projects or introduce a universal arena layer. Do not add arbitrary plugins or code execution. Do not claim physical LAN, third-party agent/model, balance, fun, or enabled CI evidence unless actually run. CI remains staged under `ci/` until an owner enables it. Do not add a license grant without explicit owner instruction.
