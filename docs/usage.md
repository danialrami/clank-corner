# Usage

Build once before invoking the compiled CLI:

```sh
npm ci
npm run build
CLI="node dist/src/cli.js"
```

## Browser practice

```sh
$CLI serve
# open http://127.0.0.1:3210
```

Seat A is manual/external and seat B is a deterministic scripted bot. Choose a legal move each turn. On terminal state, inspect and step through the canonical replay, export it, edit fighter name/note/opponent style, and rematch. The coach note is delivered to seat A's authenticated observation; it does **not** instruct or alter the built-in bot.

## Scripted demo

```sh
$CLI demo
$CLI demo --json
```

This runs a real local HTTP bot/bot match and verifies its exported replay. It reports `mode: scripted-practice`, `liveModelCalls: false`, and `externalComputeUsage: null`. It does not call or simulate an LLM.

## Two external CLI clients

Create a match (the JSON output contains bearer capabilities, so protect the terminal/session):

```sh
$CLI create --url http://127.0.0.1:3210 \
  --a-name Alpha --a-role external --a-note "Favor tempo" \
  --b-name Beta --b-role external --json > /tmp/clank-create.json

export CLANK_A_TOKEN="$(node -e "const x=require('/tmp/clank-create.json');process.stdout.write(x.data.tokens.A)")"
export CLANK_B_TOKEN="$(node -e "const x=require('/tmp/clank-create.json');process.stdout.write(x.data.tokens.B)")"
MATCH_ID="$(node -e "const x=require('/tmp/clank-create.json');process.stdout.write(x.data.id)")"
```

Observe and act. Tokens are not accepted as command-line values; `--token-env` names the environment variable to read:

```sh
$CLI observe --url http://127.0.0.1:3210 --match "$MATCH_ID" --token-env CLANK_A_TOKEN --json
$CLI act --url http://127.0.0.1:3210 --match "$MATCH_ID" --token-env CLANK_A_TOKEN \
  --turn 1 --action jab --request-id alpha-1 --json
$CLI act --url http://127.0.0.1:3210 --match "$MATCH_ID" --token-env CLANK_B_TOKEN \
  --turn 1 --action guard --request-id beta-1 --json
```

Repeat using the returned current turn and a unique request ID. Export and independently recompute:

```sh
$CLI replay --url http://127.0.0.1:3210 --match "$MATCH_ID" --out bout.json
$CLI verify bout.json --json
```

## Scripted opponent from CLI

```sh
$CLI create --url http://127.0.0.1:3210 \
  --a-name Human --a-role external --a-note "Watch their last move" \
  --b-name Clank --b-role bot --b-style reactive --json
```

Each accepted A move is paired with B's deterministic move immediately.

## Shell-capable external agents

A game-only shell agent (for example, pi if configured to run these commands) can:

1. receive only `MATCH_ID`, service URL, seat letter, and the name of its token environment variable;
2. call `observe --json`;
3. read `data.observation`, `data.legalActions`, and its own `data.coachNote`;
4. choose exactly one listed legal action without inspecting another client's state;
5. call `act --json` with current leg/turn and a unique request ID; and
6. stop on `completed` or `aborted`, then let the host export/verify.

Restrict that harness to the game command and do not expose the other seat's token. This is an honest protocol path, not a provider adapter. A Ciani external-seat CLI smoke is recorded in `external-agent-smoke.md`; pi and other third-party harnesses, model comparisons, and compute/usage are not certified. Generic HTTP/CLI tests prove the game contract only.

## CLI reference

- `serve`: `--host` (default `127.0.0.1`), `--port` (3210), `--deadline-ms` (60000). Binding `0.0.0.0` prints a LAN warning.
- `rules`: print machine-readable rules.
- `create`: `--url`, per-seat name/role/style/note, deadline.
- `observe`: `--url`, `--match`, `--token-env`.
- `act`: observe options plus `--turn`, `--action`, `--request-id`, optional `--leg` (1).
- `replay`: `--url`, `--match`, optional `--out`.
- `verify`: one local replay path.
- `demo`: optional remote `--url`; otherwise starts/stops an internal loopback server.

Every command accepts `--json`. Exit codes: 0 success, 2 usage/arguments or absent token environment value, 3 transport failure, 5 server contract rejection or replay verification failure.

## Watch external agents in the browser

Enter the CLI-created match ID in **Watch an agent bout**. No token is needed: the viewer is read-only, follows public SSE state, updates on timeout/completion, and allows terminal replay inspection/export. It cannot submit a move or rematch as the host. Normal HTTP LAN pages do not need `crypto.randomUUID()` for browser move requests.
