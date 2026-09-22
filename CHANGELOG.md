# Changelog

## 1.0.0 — 2026-09-21

Initial LAN-first implementation of rules version `corner-1`:

- Added the canonical six-move simultaneous referee, runtime validation, observations, public projections, replay construction, SHA-256 hashing, and recomputation verification.
- Added a bounded Fastify match service with seat/host bearer capabilities, sealed idempotent submissions, deadlines, SSE snapshots, redacted replay export, rematches, and ephemeral-memory limits.
- Added deterministic aggressive, cautious, and reactive scripted practice policies with no model calls.
- Added `serve`, `rules`, `create`, `observe`, `act`, `replay`, `verify`, and `demo` CLI commands with JSON output and documented exit codes.
- Added a responsive browser practice game, safe text rendering, replay stepping/export, setup edits, and rematch.
- Added unit, API, CLI, and real-browser end-to-end tests plus a frozen golden replay.
- Added usage/rules/protocol/security/testing documentation, project-scoped skills, and a staged (not enabled) CI template.

License remains `UNLICENSED`; no license grant was selected.

### Pre-release review fixes — 2026-09-22

- Fixed browser hydration synchronization, LAN-safe request IDs, Origin scheme validation, and private-response cache policy.
- Added fail-closed referee-error aborts and a live read-only spectator/replay path.
- Recorded a real external Ciani CLI game and verified replay; third-party harness and physical LAN checks remain open.
