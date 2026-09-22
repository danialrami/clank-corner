# Contract review

Reviewed before implementation on 2026-09-21. The five units have explicit surfaces and verification commands. Unit 01 owns canonical types; service and agent clients consume them. Browser integration follows the service. Packaging files are serialized under Unit 05 rather than edited concurrently. Exact rule choices, API grammar, authorization, replay verification, and open evidence are defined in SPEC.md. Integration fixes must update the contract if they change behavior.

Explicit deviations: HTTP + CLI first, no claimed provider-specific/MCP integration; scripted zero-inference practice is not marketed as an LLM; equal-compute ranking is unimplemented; personal public repositories have staged hosted CI only; license unselected. These are reversible scope choices.
