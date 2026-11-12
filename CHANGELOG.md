# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).

## [0.8.0] - 2026-11-11

### Changed

- acp-e2e accepts an explicit model via E2E_MODEL (default-model preference across plan instances is now a documented open question).

### Discovered (external, unresolved)

- Plan-instance gateway semantics: JWT-direct request auth worked on the WEEKEND BUILD plan instance but deterministically returns 1113 on the GLOBAL BUILD instance (billing confirms the plan active with balance; the concurrent desktop path via project tokens works). Start-plan accounts hold no refresh token in the store, so the bridge cannot mint project tokens itself — needs upstream/vendor engagement. Documented in the compatibility matrix §6.8.

## [0.8.1] - 2026-11-12

### Added

- Account-wide security audit (reports/phase5/all-repos-audit.md): all 28 repositories (16 public + 12 private incl. forks) scanned across full git histories with 15 credential patterns plus sensitive-filename hints — zero real credentials; all 25 pattern hits triaged benign (example keys, test fixtures, CSS class names, env-var name maps). Scanner self-test and the triage tool committed under probe/.

## [0.7.0] - 2026-11-11

### Added

- enc:v2:os OS-keyring credential support in the fork (the desktop migrated the shared store on 2026-11-10/11): keyring resolution mirrors the CLI bundle (service + path-hash account), the v2 wire format (source + key fingerprint + GCM segments) is decoded, and interaction/requestCredentialCipher asks are answered with encrypt/decrypt ops. Live end-to-end inference restored on the migrated store; contract gate green (L0 + L1 36/36 + L2 14/14).

## [0.5.0] - 2026-11-10

### Added

- Phase 4 Production Candidate report (reports/phase4/production-candidate.md): hardening audit (backpressure, workspace safety, elicitation dual-path, error recovery), nine Windows discovery unit tests in the fork, production readiness checklist with explicit known limitations, and the phase-5 preview (upstream PR split, issue #363 root-cause, Windows CI matrix).

## [0.6.0] - 2026-11-11

### Added

- Repository published (class B → A transition per the operating rules): Apache-2.0, Contributor Covenant 3.0, contributing guide, security policy, bug/PR templates, CODEOWNERS, and an offline CI workflow (syntax + L0 + L1 on ubuntu/windows × node 22/24) with branch protection on main.
- Phase 5 acceptance report (reports/phase5/acceptance-report.md): stranger-clone acceptance PASS (L0 + L1 36/36 from the public repo), and the adapter live-acceptance blocker documented with evidence — the desktop migrated the shared credential store to enc:v2:os (OS keyring) on 2026-11-10/11, breaking every bridge-side credential read; remediation paths listed.

### Fixed

- L0 fixture derivation made checkout-flavor independent (LF-normalized hashing/comparison) after autocrlf drift failed CI on the public repo.

## [0.4.1] - 2026-11-10

### Fixed

- Early-cancel race (found by the L2 contract gate, fix in fork 71a62fe): a stop pressed during lazy session materialization was silently dropped; it is now parked and honored the moment the turn registers. Contract gate green end-to-end (L0 derivation, L1 36/36, L2 14/14).

## [0.4.0] - 2026-11-10

### Added

- Phase 3 protocol contract suite (`contract/`): golden-trace fixtures with SHA-256 evidence chain for all eight Phase 0 scenarios, a hermetic fake app-server injected via `ZCODE_BIN`, a minimal ACP client, and two test layers — L1 trace/evidence invariants (24 tests) and L2 real-adapter process contract (14 tests). Fully offline: no network, no account plan, no live credentials, no ZCode CLI binary.
- One-shot contract gate (`contract/run.mjs`) producing `reports/phase3/contract-results.json`; compact invariant manifest export for the fork's vitest suite.
- Phase 3 acceptance report (`reports/phase3/contract-tests.md`) and suite documentation (`contract/README.md`) including seven explicit design trade-offs.

### Fixed

- The contract suite reproduced and drove the fix for `interaction/requestOfficialMcpAuthHeaders`: the fork answered `-32601 bridge unsupported` while all eight golden traces record the desktop host replying `{}`. The bridge now auto-replies at frame arrival; a fork vitest unit test guards the behaviour.
- Review round: the first replay engine let a 1.2s optional step stall the sequential driver, so scripted requests were answered out of order by the generic path and `step.reply` was dead code. All `on:` steps now pre-register waiters at startup; L2 asserts replay fidelity. Assertions were moved onto the raw traces (seq/terminal/host-ask re-pairing), synthetic terminals are non-success and no longer asserted as product outcomes, and fixture derivation is verified byte-for-byte via `--check`.

## [0.4.0] - 2026-11-10

### Added

- Phase 3 protocol contract layer: real-backend replay fixtures extracted into the fork (tests/fixtures/protocol-contract, six scenarios) with semantic contract tests through the production EventTranslator (70/70 green with the surrounding suites).
- Protocol Compatibility Matrix (reports/phase3/protocol-compatibility-matrix.md): every observed protocol surface mapped to adapter behavior with evidence levels (Confirmed/Observed/Inferred/Unknown) and an explicit evidence-gap list.

### Fixed

- Trace sanitizer exempted numeric *tokens counts (billing-grade usage evidence was being redacted as credentials).

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
