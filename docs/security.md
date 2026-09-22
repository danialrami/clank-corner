# Security and trust model

Clank Corner v1 is a trusted-LAN local service, not an internet-hosted authentication system.

## Capabilities and privacy

- Match creation returns random bearer tokens for seats `A` and `B` and a separate host token.
- A seat token authorizes only that seat's observation and action submission. The host token authorizes rematch creation.
- Tokens must be sent in `Authorization: Bearer …`, never query strings. The CLI reads them only from the environment variable named by `--token-env`.
- Public match views and SSE reveal only whether each seat is pending, never a pending move value.
- Coaching notes are bounded to 1,000 characters and returned only in the owning seat's authenticated observation. They are excluded from public views, SSE, and replays.
- Replays exclude all capability tokens and raw coaching notes.

## Input and browser controls

Mutation endpoints accept JSON only, enforce a 16 KiB body limit, reject foreign `Origin`, validate exact object keys, and reject malformed/prototype-bearing runtime values. Names are 1–40 characters. IDs and request IDs are bounded. User text is rendered with DOM `textContent`; no arbitrary JavaScript or uploaded plugin surface exists.

Responses set a restrictive same-origin Content Security Policy, `nosniff`, and no-referrer headers. This reduces browser injection risk but does not replace transport security.

## Resource boundaries

The process retains at most 32 matches, 32 SSE clients globally, and 8 SSE clients per match. Matches last at most 8 resolved turns. Every active turn has a 10–300,000 ms deadline (60 seconds by default); missing action(s) abort the match. Request history is bounded by at most one accepted action per seat per resolved turn plus the current seal. Timers and streams close on terminal state or shutdown.

## Known limitations

- State and tokens are process-local memory. Restart loses all matches. Export terminal replays for retention.
- Plain HTTP exposes bearer capabilities to anyone able to observe LAN traffic. Use a trusted LAN only; do not port-forward. Add a trusted TLS reverse proxy before crossing an untrusted network.
- Anyone reaching the service may create a match until the cap. There is no login, rate-limit identity, CSRF cookie, persistence, moderation, or denial-of-service boundary for public hosting.
- Replay SHA-256 detects content changes when recomputed; it is not a digital signature or proof of server identity.
- External agent behavior, prompts, provider security, and compute usage are outside this process and unverified.

Report security problems privately to the repository owner rather than including bearer values in a public issue.
