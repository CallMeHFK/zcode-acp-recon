#!/usr/bin/env node
/**
 * run.mjs — one-shot Phase 3 contract gate + evidence report.
 *
 * Gates:
 *   L0  build-fixtures.mjs --check  (fixtures are byte-for-byte derivable)
 *   L1  trace-contract.test.mjs     (golden-trace invariants)
 *   L2  adapter-contract.test.mjs   (real adapter process contract)
 *
 * Then writes reports/phase3/contract-results.json with the TAP summaries, the
 * adapter/recon commits, and a per-scenario digest assembled from the real ACP
 * + backend frame logs. No network, no live account, no credential reads.
 *
 * Usage: node contract/run.mjs
 * Env:   ZCODE_ACP_REPO  fork checkout root (default: ../<workspace>/zcode-acp)
 *        ZCODE_ACP_DIST  built dist directory
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FORK =
  process.env.ZCODE_ACP_REPO || path.resolve(ROOT, "..", "..", "zcode-acp");
const DIST = process.env.ZCODE_ACP_DIST || path.join(FORK, "dist");
const LOGS = path.join(ROOT, "contract", "logs");
const REPORTS = path.join(ROOT, "reports", "phase3");
const TESTS = ["contract/trace-contract.test.mjs", "contract/adapter-contract.test.mjs"];

const gitHead = (cwd) => {
  const r = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : "unknown";
};

const tapNumbers = (out) => {
  const pick = (re) => {
    const m = out.match(re);
    return m ? Number(m[1]) : null;
  };
  return {
    tests: pick(/^# tests (\d+)/m),
    pass: pick(/^# pass (\d+)/m),
    fail: pick(/^# fail (\d+)/m),
    durationMs: pick(/^# duration_ms ([\d.]+)/m),
  };
};

function parseLines(p) {
  return fs
    .readFileSync(p, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function scenarioDigest(name) {
  const acpFile = path.join(LOGS, `${name}-acp.jsonl`);
  const backendFile = path.join(LOGS, `${name}.jsonl`);
  if (!fs.existsSync(acpFile) || !fs.existsSync(backendFile)) return null;
  const acp = parseLines(acpFile);
  const backend = parseLines(backendFile);
  const updates = acp.filter((m) => m.method === "session/update").map((m) => m.params?.update ?? {});
  const kinds = updates.map((u) => u.sessionUpdate ?? u.kind ?? "?");
  // Locate the prompt response by its REQUEST id instead of hardcoding "3".
  const promptReq = acp.find((m) => m.method === "session/prompt" && m.id !== undefined);
  const promptResult = promptReq
    ? acp.find((m) => m.id === promptReq.id && m.method === undefined)
    : null;
  const answers = backend.filter((e) => e.type === "answer");
  const scriptComplete = backend.find((e) => e.type === "scriptComplete");
  const synthetic = backend.some((e) => e.type === "syntheticTerminal");
  return {
    sessionUpdateKinds: [...new Set(kinds)],
    agentMessageChunks: kinds.filter((k) => k === "agent_message_chunk").length,
    // A synthetic terminal is a HARNESS close, not a product outcome. Never
    // present its stopReason as if the adapter produced it from real events.
    harnessClosed: synthetic,
    stopReason: synthetic ? null : promptResult?.result?.stopReason ?? promptResult?.error?.message ?? null,
    nonJsonStdoutLines: acp.filter((m) => m.nonJson).length,
    hostAnswers: answers.map((a) => ({
      id: a.id,
      method: backend.find((e) => e.dir === "out" && String(e.frame?.id) === String(a.id))?.frame?.method ?? "?",
    })),
    syntheticTerminal: synthetic,
    scriptComplete: !!scriptComplete,
    matchedSteps: scriptComplete?.matchedSteps ?? 0,
    expectedSteps: scriptComplete?.expectedSteps ?? 0,
    defaultedMethods: scriptComplete?.defaultedMethods ?? [],
  };
}

function main() {
  fs.mkdirSync(REPORTS, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "contract", "fixtures", "manifest.json"), "utf8"));
  const results = {};
  let allOk = true;

  // Keep the fork-facing invariant manifest in sync with the fixtures.
  const exported = spawnSync(process.execPath, [path.join(ROOT, "contract", "export-manifest.mjs")], {
    cwd: ROOT,
    encoding: "utf8",
  });
  console.log(exported.stdout.trim());
  if (exported.status !== 0) allOk = false;

  // The fork's vitest suite reads its OWN copy of the invariant manifest. The
  // gate must keep it in sync, otherwise a fixture change refreshes recon's
  // copy, both privacy checks pass, and the fork keeps asserting stale data
  // (review should-fix #2). export-manifest.mjs is deterministic, so a plain
  // byte copy keeps the two copies identical.
  const reconManifest = path.join(ROOT, "contract", "fixtures", "contract-manifest.json");
  const forkManifest = path.join(FORK, "tests", "contract", "fixtures", "contract-manifest.json");
  if (fs.existsSync(path.dirname(forkManifest))) {
    fs.copyFileSync(reconManifest, forkManifest);
    console.log("fork invariant manifest synced");
  } else {
    console.log(`fork invariant manifest not found at ${forkManifest} — skipped (set ZCODE_ACP_REPO)`);
  }

  const check = spawnSync(process.execPath, [path.join(ROOT, "contract", "build-fixtures.mjs"), "--check"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60000,
  });
  console.log(check.stdout.trim());
  results.L0 = { file: "contract/build-fixtures.mjs --check", exitCode: check.status };
  if (check.status !== 0) {
    console.error(check.stderr);
    allOk = false;
  }

  for (const file of TESTS) {
    const layer = file.includes("trace-contract") ? "L1" : "L2";
    console.log(`running ${layer}: ${file}`);
    const r = spawnSync(process.execPath, ["--test", "--test-timeout=180000", file], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, ZCODE_ACP_DIST: DIST },
    });
    const summary = tapNumbers(r.stdout ?? "");
    results[layer] = { file, ...summary, exitCode: r.status };
    console.log(`  ${layer}: ${summary.pass} pass / ${summary.fail} fail`);
    if (r.status !== 0 || summary.fail !== 0) allOk = false;
  }

  const scenarios = {};
  for (const f of manifest.fixtures) {
    const d = scenarioDigest(f.scenario);
    if (d) scenarios[f.scenario] = d;
  }

  const report = {
    phase: 3,
    generatedAt: new Date().toISOString(),
    ok: allOk,
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      adapterDist: path.join(DIST, "index.js"),
      fakeBackend: path.join(ROOT, "contract", "fake-app-server.mjs"),
      networkDependency: false,
      liveAccountDependency: false,
    },
    commits: { recon: gitHead(ROOT), fork: gitHead(FORK) },
    layers: results,
    scenarios,
    sources: manifest.fixtures.map((f) => {
      const fx = JSON.parse(fs.readFileSync(path.join(ROOT, f.file), "utf8"));
      return {
        scenario: f.scenario,
        trace: fx.source.trace,
        records: fx.source.records,
        sha256: f.sourceSha256,
        syntheticFrameCount: f.syntheticFrameCount,
      };
    }),
  };
  fs.writeFileSync(path.join(REPORTS, "contract-results.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(`report: reports/phase3/contract-results.json (ok=${allOk})`);
  if (!allOk) process.exitCode = 1;
}

main();
