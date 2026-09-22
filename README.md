# Clank Corner

Clank Corner is a small LAN-first simultaneous-turn fighting game for a human, deterministic practice bots, or two external shell-capable agents. Coach one fighter, seal one of six moves, inspect the exchange, adjust the setup, and rematch.

Practice styles are closed TypeScript policies, **not LLMs**. The app performs no provider or model calls. External-agent compute and usage are not measured (`null`), and no third-party harness is certified by this repository.

## Quickstart

Requirements: Node **24.14.1** (see `.node-version`) and npm.

```sh
npm ci
npm run build
node dist/src/cli.js demo
node dist/src/cli.js serve
```

Open <http://127.0.0.1:3210>. The browser supports a complete human-versus-scripted-bot bout, replay stepping/export, style and coaching-note edits, and rematch.

Useful verification commands:

```sh
npm run verify
npm run test:e2e
```

`npm run test:e2e` launches a real Chromium browser. Linux uses the pinned `@sparticuz/chromium` dev dependency; elsewhere set `CHROMIUM_PATH` to a compatible Chromium executable. A missing browser is an error, never a skipped green test.

## LAN use

Loopback is the safe default. To listen on all interfaces explicitly:

```sh
node dist/src/cli.js serve --host 0.0.0.0 --port 3210
```

The CLI prints a LAN warning. Share the machine's LAN address and required bearer capabilities out of band. Plain HTTP does not encrypt tokens: use only a trusted LAN, avoid port-forwarding, and stop the process after play. There is no login or internet-hosting security boundary. State is ephemeral memory; export terminal replays to retain them.

## Modes

- **Browser practice:** external/manual seat A versus a server-owned scripted seat B.
- **Scripted demo:** deterministic bot versus bot via `clank-corner demo`.
- **External clients:** two independently authenticated clients use HTTP or the CLI. Coaching notes are included only in the owning seat's authenticated observation.

See [`docs/usage.md`](docs/usage.md) for complete commands, [`docs/rules.md`](docs/rules.md) for exact rules, [`docs/protocol.md`](docs/protocol.md) for HTTP, and [`docs/security.md`](docs/security.md) for the trust model.

## Development

```sh
npm run typecheck
npm run test
npm run verify
npm run test:e2e
```

The canonical referee is `src/engine.ts`; HTTP, CLI, and browser code are adapters. `ci/verify.yml` is a staged template, not an enabled GitHub Actions workflow. Moving it to `.github/workflows/verify.yml` requires owner approval and workflow scope.

## Evidence boundaries

Automated same-machine results are recorded in [`TESTING.md`](TESTING.md) and [`BUILD_REPORT.md`](BUILD_REPORT.md). Physical two-machine LAN play, third-party harness certification, fun, and competitive balance are not claimed. One Ciani external-seat CLI smoke is documented separately below. No license grant is made; the project is `UNLICENSED` pending the owner's choice.

## v1 review evidence and next checks

See [the recorded external-agent smoke](docs/external-agent-smoke.md), [the phase contracts](docs/specs/2026-09-21T0520Z_lan-first-v1/SPEC.md), [CHANGELOG](CHANGELOG.md), and [follow-ups #1](https://github.com/danialrami/clank-corner/issues/1). The [research suite PR](https://github.com/lufs-audio/kb/pull/261) is in the private KB and remains pending CI; it is not needed to build or play.

Both games default to port 3210. When running both together, start Vault with `node dist/src/cli.js serve --port 3211` and open that port.
