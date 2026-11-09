# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).

## [0.4.0] - 2026-11-10

### Added

- Phase 3 protocol contract suite (`contract/`): golden-trace fixtures with SHA-256 evidence chain for all eight Phase 0 scenarios, a hermetic fake app-server injected via `ZCODE_BIN`, a minimal ACP client, and two test layers — L1 trace/evidence invariants (24 tests) and L2 real-adapter process contract (14 tests). Fully offline: no network, no account plan, no live credentials, no ZCode CLI binary.
- One-shot contract gate (`contract/run.mjs`) producing `reports/phase3/contract-results.json`; compact invariant manifest export for the fork's vitest suite.
- Phase 3 acceptance report (`reports/phase3/contract-tests.md`) and suite documentation (`contract/README.md`) including seven explicit design trade-offs.

### Fixed

- The contract suite reproduced and drove the fix for `interaction/requestOfficialMcpAuthHeaders`: the fork answered `-32601 bridge unsupported` while all eight golden traces record the desktop host replying `{}`. The bridge now auto-replies at frame arrival; a fork vitest unit test guards the behaviour.
- Review round: the first replay engine let a 1.2s optional step stall the sequential driver, so scripted requests were answered out of order by the generic path and `step.reply` was dead code. All `on:` steps now pre-register waiters at startup; L2 asserts replay fidelity. Assertions were moved onto the raw traces (seq/terminal/host-ask re-pairing), synthetic terminals are non-success and no longer asserted as product outcomes, and fixture derivation is verified byte-for-byte via `--check`.

## [0.3.0] - 2026-11-09

### Added

- Phase 2 Windows MVP validation (reports/phase2/windows-mvp.md): four fix groups on the fork baseline (CLI/node discovery, process-tree reap + windowsHide, graceful file-URI fallback, start-plan entitlement + JWT request auth), verified with a scripted ACP client end-to-end — real inference through the plan gateway, stopReason end_turn, reply "OK".
- ACP e2e probe (probe/acp-e2e.mjs) speaking the Agent Client Protocol directly to the adapter over stdio.

## [0.2.0] - 2026-11-09

### Added

- Phase 1 upstream audit and fork baseline (reports/phase1/): repository audit across three candidate repos (william0wang confirmed as the single active upstream; BrokkAi/haowei2000 are frozen forks), baseline locked at commit ccc5104 (v0.82.3), Windows test baseline 2333/2440 with failure-class taxonomy, and the Windows adaptation architecture note (module boundaries, maintenance strategy).

## [0.1.0] - 2026-11-08

### Added

- Phase 0 feasibility recon for a ZCode ACP adapter: executable probe toolkit (`probe/`) covering spawn, JSONL transport, bidirectional RPC, session lifecycle, model registration, runtime auth headers, permissions, cancel, crash, cross-process resume, and client-disconnect semantics.
- Gate Matrix acceptance report (`reports/gate-matrix.md`): all ten P0 gates PASS with evidence references; Go recommendation for Phase 1.
- Runtime Compatibility Report (`reports/runtime-compat.md`): desktop/CLI/runtime inventory, credential chain structure, `node:sqlite` dependency evidence.
- Task brief frozen through three review rounds (`AGENTS.md`, `TASKS.md`, `docs/report-template.md`).
- Sanitized protocol evidence traces (`traces/*.sanitized.json`) with unified metadata; raw traces stay local (gitignored) per data-safety gate G11.
