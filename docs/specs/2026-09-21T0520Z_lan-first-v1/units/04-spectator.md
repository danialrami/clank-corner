# Unit 04 — Playable browser and replay viewer

## Objective
Deliver playable browser and replay viewer for Clank Corner, satisfying the phase contract.

## Context
Read ../SPEC.md; predecessor units define the shared types. Unit 01 is first; 02 and 03 may proceed after 01 with fixed imported interfaces; 04 follows 02; 05 closes the integration.

## Acceptance criteria
- [ ] Create a practice match, complete it, navigate actual replay, and rematch from the browser.
- [ ] Names/notes render as inert text; controls display rule costs/roles and errors.
- [ ] Browser smoke proves visible outcome and exported replay equivalence; mobile layout has usable controls.

## Interface contract
UI calls the documented HTTP surface and renders public/seat projections only. Browser secrets stay in memory/session handling, never URL query strings or event logs.

## Boundaries
- Touches: public/index.html, public/app.js, public/style.css, test/browser.mjs
- Does NOT touch: src/engine.ts rule changes

## Output
Small focused implementation, colocated tests, and a truthful verification note. No placeholder-success paths.

## Verification
```sh
npm run test:e2e
```
