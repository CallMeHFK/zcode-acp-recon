# Security Policy

## Scope

This repository documents protocol recon against the ZCode desktop app and
hosts probe tooling. Two classes of sensitive material exist here by design:

1. **Sanitized evidence traces** (`traces/*.sanitized.json`) — structured
   redaction runs before anything is committed; credential-shaped values are
   replaced (`<redacted>`), numeric token counts are kept as billing-grade
   evidence.
2. **Raw traces** (`traces/raw/`) — contain credential material by definition
   and are **gitignored, local-only, never committed**.

## Reporting a vulnerability

If you find credential material, a token, or any other sensitive data that
should not be public:

- Use GitHub's **private vulnerability reporting** on this repository
  (Report a vulnerability button on the Security tab), or
- Open a minimal issue asking the maintainer to make contact, without
  reproducing the material.

## Response

- Confirmed leaks are removed via a history rewrite followed by a force push
  to `main`, and the incident is recorded in the changelog. This is the one
  sanctioned exception to the no-history-rewrite rule — a published secret is
  worse than a rewritten branch.
- The trace sanitizer (`probe/redact.mjs`, `probe/finalize.mjs`) and its scan
  coverage report are the enforcement points; regressions there are treated
  as security bugs.
