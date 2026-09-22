# HTTP protocol

The default base URL is `http://127.0.0.1:3210`. Except for static files, SSE, and the raw replay download, JSON responses are one of:

```json
{"status":"success","data":{}}
```

```json
{"status":"error","code":409,"message":"match is terminal"}
```

Errors use 400 invalid input, 401 missing/invalid capability, 403 foreign origin, 404 unknown match, 409 state conflict, 413 oversized body, 415 non-JSON mutation, 429 a resource cap, or 500 an internal referee/service failure. Mutation bodies must be `application/json`, no larger than 16 KiB, and contain no undocumented keys.

## Configuration

```json
{
  "players": {
    "A": {"name":"Alpha","role":"external","style":null,"coachNote":"Use tempo."},
    "B": {"name":"Clank","role":"bot","style":"reactive","coachNote":""}
  },
  "turnDeadlineMs": 60000
}
```

Names contain 1–40 characters; notes contain at most 1,000. `role` is `external` or `bot`. External `style` is `null`/omitted; bot style is `aggressive`, `cautious`, or `reactive`. Deadline range is 10–300,000 ms.

## Routes

### `GET /api/status`

Reports game/build/rules versions, readiness, uptime, ephemeral persistence, retained match counts/cap, and stream count/cap. It is process status, not a promise of external provider availability.

### `GET /api/rules`

Returns the machine-readable `corner-1` action grammar, costs, limits, and outcomes.

### `POST /api/matches`

Body: `{"config": CONFIG}`. Returns HTTP 201 and:

```json
{
  "id":"…",
  "hostToken":"…",
  "tokens":{"A":"…","B":"…"},
  "view":{"status":"active"}
}
```

This is the only response containing all newly issued capabilities. Store them out of band; do not log them publicly. A match with both seats set to `bot` resolves synchronously under server-owned scripted policies.

### `GET /api/matches/:id`

Public view: player names/roles/styles, HP, energy, resolved events/result, boolean pending flags, and deadline. No bearer required. Pending move values and coaching notes are absent.

### `GET /api/matches/:id/observe`

Requires a seat bearer capability. Returns match/seat/role, own observation, legal actions, own bounded coaching note, own pending boolean, and deadline. It never includes the opponent coaching note or sealed action.

### `POST /api/matches/:id/actions`

Requires a seat bearer and exact body:

```json
{"leg":1,"turn":1,"action":{"type":"jab"},"requestId":"client-unique-1"}
```

An accepted identical retry with the same `requestId` is idempotent, including after the turn resolves. A conflicting reuse, second seal under a new ID, stale/future turn, wrong leg, illegal/unaffordable move, extra field, or action on a server-owned bot seat is rejected without advancing. Resolution waits for both external seats, except a bot seat submits from its own observation.

### `GET /api/matches/:id/stream`

Public redacted SSE. Each event is named `snapshot` and its `data` is the same public record. There are at most 8 streams per match and 32 globally. The stream closes on terminal state, client close, or shutdown.

### `GET /api/matches/:id/replay`

Returns 409 while active. A terminal response is raw downloadable JSON (not a success envelope) containing schema/game/rules versions, redacted config, resolved action pairs/events, result, final state, and a canonical SHA-256 hash. An unmatched action present at timeout is not a resolved replay turn.

Verification validates schema, strict moves, affordability, sequence, events, result, final state, and hash by running the canonical referee again. The hash alone is insufficient.

### `POST /api/matches/:id/rematch`

Requires the old match's host bearer. Body: `{"config": CONFIG}`. Returns a new ID, capabilities, view, and `rematchOf`. The old match and replay never mutate.

## Timing

No timestamp changes game results. Each new turn gets the configured deadline. At expiry, absent A, B, or both is named in the abort reason; winner is always `null`. Transport/provider failure is not converted into victory.
