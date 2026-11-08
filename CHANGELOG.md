# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).

## [0.1.0] - 2026-11-08

### Added

- Phase 0 feasibility recon for a ZCode ACP adapter: executable probe toolkit (`probe/`) covering spawn, JSONL transport, bidirectional RPC, session lifecycle, model registration, runtime auth headers, permissions, cancel, crash, cross-process resume, and client-disconnect semantics.
- Gate Matrix acceptance report (`reports/gate-matrix.md`): all ten P0 gates PASS with evidence references; Go recommendation for Phase 1.
- Runtime Compatibility Report (`reports/runtime-compat.md`): desktop/CLI/runtime inventory, credential chain structure, `node:sqlite` dependency evidence.
- Task brief frozen through three review rounds (`AGENTS.md`, `TASKS.md`, `docs/report-template.md`).
- Sanitized protocol evidence traces (`traces/*.sanitized.json`) with unified metadata; raw traces stay local (gitignored) per data-safety gate G11.
