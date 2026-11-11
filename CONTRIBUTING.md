# Contributing to zcode-acp-recon

Thanks for looking at this repository. It hosts the feasibility recon for a
ZCode ACP adapter: probe tooling, sanitized protocol evidence, and phase
reports.

## Repository layout

- `probe/` — live probes against the ZCode app-server (need a logged-in
  desktop install; not part of CI)
- `contract/` — the offline protocol contract gate (L0 derivation check,
  L1 golden-trace contracts, L2 adapter contracts; L2 additionally needs the
  fork adapter built locally)
- `reports/` — phase reports and evidence summaries
- `traces/` — sanitized evidence traces (raw traces with credential material
  are deliberately gitignored and never committed)

## Development setup

- Node >= 22 (`node:sqlite` is load-bearing)
- A ZCode desktop install signed in, for live probes only
- No package manager needed for the offline contract layer: everything runs
  on the Node standard library

## Running the checks

```bash
# L0: fixture derivation integrity (offline)
node contract/build-fixtures.mjs --check

# L1: golden-trace protocol contracts, 36 cases (offline)
node --test contract/trace-contract.test.mjs

# Full gate (L2 also spawns the fork adapter from ../zcode-acp)
node contract/run.mjs
```

## Pull requests

- Conventional Commits subjects (`feat:`, `fix:`, `docs:`, `chore:`, ...),
  imperative mood, <= 72 characters.
- Keep the pre-commit privacy screen green: no credentials, no tokens, no
  machine-specific secret material. Absolute user paths in evidence files are
  expected (this repo documents a real machine's protocol recon) — flag
  anything beyond that.
- Contract fixtures are derived artifacts: change the source traces and the
  extraction script, never the fixture by hand (`--check` enforces this).

## Contributor origin

No DCO or CLA — by opening a PR you agree your contribution is licensable
under the repository license (Apache-2.0).
