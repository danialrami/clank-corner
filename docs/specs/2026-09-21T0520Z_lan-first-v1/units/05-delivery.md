# Unit 05 — Documentation and project-specific skills

## Objective
Deliver documentation and project-specific skills for Clank Corner, satisfying the phase contract.

## Context
Read ../SPEC.md; predecessor units define the shared types. Unit 01 is first; 02 and 03 may proceed after 01 with fixed imported interfaces; 04 follows 02; 05 closes the integration.

## Acceptance criteria
- [ ] Fresh install/build/unit/API/CLI/browser verification commands are reproducible.
- [ ] Usage docs describe actual endpoints, auth, coaching, practice, LAN and replay behavior; skill commands are exercised.
- [ ] No fabricated license grant, enabled-CI claim, live model run, physical LAN result, or tested-fun claim.

## Interface contract
Project-scoped SKILL.md frontmatter has exactly name and description. CI is staged ci/verify.yml; root SPEC.md points at the phase. Verification report distinguishes real automated runs from pending hardware/model/fun checks.

## Boundaries
- Touches: README.md, AGENTS.md, CHANGELOG.md, TESTING.md, docs/usage.md, docs/rules.md, docs/protocol.md, docs/security.md, .agents/, ci/, package.json, package-lock.json, tsconfig.json, .node-version, .gitignore, scripts/
- Does NOT touch: Other units source files except documented integration fixes after their tests

## Output
Small focused implementation, colocated tests, and a truthful verification note. No placeholder-success paths.

## Verification
```sh
npm ci && npm run verify && npm run test:e2e
```
