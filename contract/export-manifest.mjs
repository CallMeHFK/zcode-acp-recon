#!/usr/bin/env node
/**
 * export-manifest.mjs — compact, portable slice of the golden-trace contract.
 *
 * The full replay fixtures (~1.1 MB) stay in the recon evidence repo. This
 * exports just the invariants into a small JSON that can be committed to the
 * fork and asserted by its vitest suite (tests/contract/golden-contract.test.ts).
 *
 * Usage:
 *   node contract/export-manifest.mjs [outputPath]
 * Default output: contract/fixtures/contract-manifest.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIX = path.join(ROOT, "contract", "fixtures");
const outPath = process.argv[2] ?? path.join(FIX, "contract-manifest.json");

const base = JSON.parse(fs.readFileSync(path.join(FIX, "manifest.json"), "utf8"));
const fixtures = base.fixtures.map((entry) => {
  const fx = JSON.parse(fs.readFileSync(path.join(ROOT, entry.file), "utf8"));
  // sourceSeq is the ORIGINAL seq from the raw golden trace, not the replay's
  // renumbered one — the invariant is about the evidence, not the fixture.
  const seqs = fx.turnEvents.map((e) => e.sourceSeq);
  const last = fx.turnEvents[fx.turnEvents.length - 1];
  const syntheticFrameCount = fx.steps
    .filter((s) => s.syntheticTerminal)
    .reduce((n, s) => n + (s.emit?.length ?? 0), 0);
  return {
    scenario: fx.scenario,
    trace: fx.source.trace,
    traceSha256: fx.source.sha256,
    zcodeVersion: fx.source.metadata?.zcodeVersion ?? null,
    records: fx.source.records,
    expectedTerminal: fx.contract.expectedTerminal,
    syntheticTerminal: fx.contract.syntheticTerminal,
    syntheticFrameCount,
    seqCount: seqs.length,
    seqContiguous: seqs.every((s, i) => s === i + 1),
    terminalEventType: last?.params?.type ?? null,
    terminalResultType: last?.params?.payload?.resultType ?? null,
    stopMustBeRequest: fx.contract.stopMustBeRequest,
    stdoutMustBeJsonLines: fx.contract.stdoutMustBeJsonLines,
    hostAsks: fx.hostAsks.map((a) => ({
      method: a.method,
      answered: a.answered,
      answer: a.answer,
      ...(a.options ? { options: a.options } : {}),
    })),
  };
});

// Deterministic on purpose: no generatedAt. The same traces always produce the
// same bytes, so the recon copy and the fork copy can be compared exactly.
const manifest = {
  schema: 1,
  sourceRepo: "CallMeHFK/zcode-acp-recon",
  source: "Phase 0 sanitized golden traces (traces/*.sanitized.json)",
  note: "Invariants only; full replay scripts stay in the recon repo.",
  fixtures,
};
fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`wrote ${outPath} (${fixtures.length} scenarios, ${fs.statSync(outPath).size} bytes)`);
