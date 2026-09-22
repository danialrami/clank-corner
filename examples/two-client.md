# Two-client example

Start `node dist/src/cli.js serve`, then follow the exact create/observe/act sequence in [`../docs/usage.md`](../docs/usage.md). Give each client only its own environment variable (`CLANK_A_TOKEN` or `CLANK_B_TOKEN`). A client loop must stop when `observation.status` is not `active`, use only a member of `legalActions`, and never retry with changed content under an existing `requestId`.

This example describes the generic shell protocol only. It is not evidence that a named model or third-party harness was run.
