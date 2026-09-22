# Clank Corner — LAN-first v1 specification

## Goal and the smallest loop
Coach a recognizable fighter, watch a short bout, inspect a decisive event, revise its note or scripted style, and rematch. One fighter per seat, no grid or unlock economy. Placeholder art is acceptable; unreadable actions are not. UI must make health, energy, pending/ready state (without move reveal), event deltas, winner/draw/abort, and replay navigation obvious. Supply names and move explanations.

## Exact rules, rulesVersion corner-1
- Both fighters start HP 12 and energy 3; energy cap 6. 8 simultaneous beats maximum.
- jab costs 1, deals 2 base damage.
- heavy costs 3, deals 5 base damage.
- guard costs 0, reduces incoming damage by 3 (floor 0), except against feint.
- counter costs 2. Against jab or heavy it cancels that attack and deals 4 damage to that attacker. Against any other action it deals 0 and does not block damage.
- recharge costs 0 and restores 2 energy (cap 6); deals 0 damage.
- feint costs 2 and deals 2 damage, ignoring guard and counter.
- Check affordability against START-of-beat energy; deduct both costs, calculate both damage amounts, then apply both damage simultaneously and recharge gains. No negative HP/energy. No attack is retroactively canceled by its actor dying simultaneously.
- On either zero HP: double KO is a draw; otherwise the surviving seat wins. At beat 8 higher HP wins; equal HP is a draw, with no energy tiebreaker.
- Legal actions enumerate only affordable actions. Action schema is {type:'jab'|'heavy'|'guard'|'counter'|'recharge'|'feint'} with no other keys.
- leg is always 1. turn is 1-based and increments only on a resolved pair. Winner is A, B, or null with an explicit draw/abort reason.

## Practice styles and coaching
Offer at least aggressive, cautious, and reactive closed policies; all deterministic and receive only their seat observation. Preserve symmetry (no seat-based preference). Bot/bot demo, human/bot manual control, and external/external match must all be supported. Styles may choose from legal actions but never peek at a sealed opponent choice. Bounded notes are exposed only to the owning external seat. UI visibly distinguishes notes from built-in strategy selection.

## Non-goals and open evidence
No claim the six-move game is competitively balanced. Measure degeneracy with small scripted round robins, but fun requires human play. No live model calls in the built-ins. No automatic prompting/coaching of a remote harness behind a pretend UI button. No hardware-speed scoring, wagering, login, cloud deployment, or general game registry.

## Authorization and scope
Daniel authorized the specification and subsequent v1 build on 2026-09-21. This contract is written before implementation. Deliver an actual local game, not a generated mockup. Same-machine automated tests and two-machine LAN/model-backed checks are separate facts. Never claim fun, balanced ranked play, or compatibility with an untested harness.

## Platform
Node 24 LTS, TypeScript strict, Fastify, plain browser HTML/CSS/JavaScript. Keep the independent repo self-contained; no sibling-game imports or universal arena framework. Pin package versions and commit package-lock.json. Node's test runner is sufficient; use Playwright for browser E2E. Known available package versions: fastify 5.12.5, typescript 7.0.2, @types/node 24.10.1, playwright 1.63.0. A Linux headless Chromium package, @sparticuz/chromium 153.0.0, is available for the sandbox. Public/personal repos have no assumed access to the private lufs runner fleet.

## Interface and authority
One referee module owns the transition logic; UI, CLI, and HTTP are readers/adapters. Export createInitialState(config), legalActions(state, seat), observe(state, seat), resolveTurn(state, actions), publicView(state), and verifyReplay(replay) with explicit TypeScript types. Unit 01 defines the complete canonical types in src/engine.ts; later units import them rather than duplicate them. A Seat is 'A' | 'B'; actions are submitted once per numbered turn for the current leg. Incoming runtime values must be validated even if TypeScript compiles.

The HTTP surface has these routes:
- GET /api/status — game/version and honest process status.
- GET /api/rules — machine-readable rules and action grammar.
- POST /api/matches — validated configuration, returns id, hostToken, tokens {A,B}, and public view. Anyone on the trusted LAN may create a match, subject to a small in-memory match cap; this is not a public hosting boundary.
- GET /api/matches/:id — public redacted view, no pending move values or private coaching.
- GET /api/matches/:id/observe — Authorization: Bearer seat token; returns that seat's role, observation, legal actions, bounded coaching note and match identifiers.
- POST /api/matches/:id/actions — same bearer; body {leg,turn,action,requestId}; a successful identical retry is idempotent; a conflicting duplicate, stale turn, wrong leg or unknown field/action is rejected without advancing state. Resolve only when both seats have an action, except a documented server-owned bot seat.
- GET /api/matches/:id/stream — public redacted server-sent snapshots, no secrets in event data. Bounded connections and clean close.
- GET /api/matches/:id/replay — only when terminal; earlier returns 409. Export includes rulesVersion/config/actions/events/result but no seat/host tokens, API keys, or raw private coaching notes. Hashes of tactics may be included.
- POST /api/matches/:id/rematch — host bearer; validated replacement configuration creates a new id/tokens, never mutates the old replay.

Each HTTP response except SSE/static/replay downloads uses {status:'success',data:...} or {status:'error',code:number,message:string}. Return appropriate HTTP codes (400 invalid, 401 no/invalid bearer, 404 unknown, 409 conflict, 413 oversized, 429 cap). Do not leak rejected private values in public logs. Referee errors are not wins. No arbitrary JS execution or uploaded plugins. Same-origin browser calls; reject foreign Origin on mutation routes, JSON-only bodies, bounded request size (e.g. 16KB), safe textContent rendering, no secrets in URLs, no unbounded agent loops. Local memory is explicitly ephemeral; export completed replays to retain them.

The CLI must support serve, rules, create, observe, act, replay, verify, and demo with --json machine output; tokens read from a named env var, not required as a command-line argument. Exit floor 0 success, 2 usage, 5 contract violation; additional transport exit code 3 is documented. bind defaults 127.0.0.1; --host 0.0.0.0 requires an explicit LAN warning. Do not use reserved paths /run, /events, /health, /interrupt, or /keepalive as routes.

## Entrants and coaching
Provide closed, deterministic built-in practice styles and an external seat. No paid API key needed for practice. No hidden provider calls. Coaching notes (<=1000 characters per seat) are passed in authenticated observations for the external agent to consume; changing text alone must not be advertised as changing the built-in policy. Label built-ins as scripted styles, not LLMs. Document how pi or another shell-capable game-only agent can use the actual CLI/HTTP API; generic protocol tests do not certify those third-party products. No provider-specific/MCP adapter is required in v1; this narrowing from the research proposal is explicit, reversible, and avoids pretending untested integrations work. External compute/usage is unverified/null, not zero. Demo mode is labeled scripted. A future metered same-model class is not implemented or claimed.

## Timing and replay
No faster-submission advantage. Both actions seal against the same start state; no opponent pending-action preview. A configurable turn deadline (default 60s, test clock injectable) must not hang forever. On deadline the match ABORTS with a named timeout and no winner; provider/transport failures are not tactical victories. The server reports active, completed, or aborted honestly. Replay verifies schema, legal action sequence, exact transitions, outcome, and hash where present by recomputing from the canonical engine. Tampering and missing final state fail closed; a self-reported hash is not sufficient proof. No timestamps affect deterministic game results.

## Required deliverables
README quickstart and LAN instructions; CHANGELOG with actual v1 changes; AGENTS.md; docs/usage.md, docs/rules.md, docs/protocol.md, docs/security.md; TESTING.md with exact commands, real outputs/limitations; .agents/skills/play-clank-corner/SKILL.md and .agents/skills/verify-clank-corner/SKILL.md with frontmatter name+description, project-specific steps, failure checks, and pointers rather than copied global skill docs. Root SPEC.md is a pointer to this phase. Include a frozen lockfile and node pin. License remains UNLICENSED pending owner's explicit choice; do not invent a copyright grant.

CI is authored in ci/verify.yml, not .github/workflows, since integration workflow scope is unavailable. It is a staged template, NOT active CI. Use SHA-pinned actions (checkout v5 fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09; setup-node v5 a0853c24544627f65ddf259abe73b1d18a591444). Public repo uses ubuntu-latest as an explicitly documented personal-repo exception, not private self-hosted fleet. Document placement needed; do not claim checks ran just because a PR is clean with no checks. No artifact upload needed. Exact npm verify must run build/typecheck, unit/API tests and deterministic replay checks; browser E2E is separate npm run test:e2e or incorporated when feasible, and missing browser fails honestly rather than skips green.

## Verification and acceptance
A fresh npm ci and npm run verify must pass. Tests include every move/rule branch, illegal/oversized/config inputs, resource/terminal invariants, side-swap or role-swap relations, submission-order equivalence, hidden/pending-info nonleakage, idempotency, timeout, full two-client HTTP game, complete replay and tamper rejection. Browser E2E creates and completes a practice game, observes visible result, inspects/exports replay, changes a style/note and rematches. Test logs belong in a compact verification report, not raw token-bearing HTTP dumps. No real-model or physical LAN claims without actually running those tests.

## Ecosystem references
Research rationale (private KB; not required to run): https://github.com/lufs-audio/kb/pull/261 (research suite pending CI; no runtime dependency) . House conventions: bplate docs/units/08-documentation-and-workflow-standard.md and 10-exit-code-and-json-envelope-standard.md. Global speccing/land-plane skills live in danialrami/dotfiles; do not vendor them. This is a standalone game, not a Workchain component or lsbx consumer.

## V1 review clarification — 2026-09-22
Unexpected referee exceptions abort as server-error with no winner, immediately rather than stranding both sealed actions. The browser can watch a CLI-created match ID through public SSE without a token, and those spectators cannot mutate the match. Rules remain corner-1.
