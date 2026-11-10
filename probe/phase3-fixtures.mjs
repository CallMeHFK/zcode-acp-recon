// phase3-fixtures.mjs — 从 recon 已脱敏 trace 提取真实协议事件流，生成 fork 侧契约测试 fixtures（L1 证据入库）
// 源：traces/<scenario>.sanitized.json（wrapped: {metadata, records}）
// 出：zcode-acp/tests/fixtures/protocol-contract/<scenario>.json
//     { metadata, events: [{ seq, turnId?, type, payload }] }  — 仅 session/event 通知，剔除 sessionId
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const RECON = path.resolve(here, "..");
const FORK = "C:/Users/Rt/.zcode/workspace/zcode-acp";
const OUT_DIR = path.join(FORK, "tests", "fixtures", "protocol-contract");
fs.mkdirSync(OUT_DIR, { recursive: true });

const SCENARIOS = [
  ["normal", "normal"],
  ["permission-allow", "permission-allow"],
  ["permission-deny", "permission-deny"],
  ["cancel", "cancel"],
  ["crash", "crash"],
  ["resume-graceful", "resume-graceful"],
];

const summary = {};
for (const [srcName, outName] of SCENARIOS) {
  const src = path.join(RECON, "traces", srcName + ".sanitized.json");
  if (!fs.existsSync(src)) { summary[outName] = "missing source"; continue; }
  const wrapped = JSON.parse(fs.readFileSync(src, "utf8"));
  // Segment on every `session/create` / `session/resume` request (each marks a
  // fresh app-server lifetime or a reconnect). Default: keep the LAST
  // lifetime. "incomplete" pick: the LAST lifetime that started a turn but
  // never saw a terminal event (the mid-turn crash capture).
  const records = wrapped.records ?? [];
  const isSegmentMarker = (rec) =>
    rec.method === "session/create" || rec.method === "session/resume";
  const segments = [];
  for (let i = 0; i < records.length; i++) {
    if (isSegmentMarker(records[i])) segments.push(i);
  }
  if (segments.length === 0) segments.push(0);
  const lifetimes = segments.map((start, idx) =>
    records.slice(start, idx + 1 < segments.length ? segments[idx + 1] : records.length),
  );
  const hasTerminal = (seg) =>
    seg.some((rec) => rec.method === "session/event" && String(rec.params?.type ?? "").startsWith("turn."));
  const hasTurnStart = (seg) =>
    seg.some((rec) => rec.method === "session/event" && rec.params?.type === "turn.started");
  let lifetime;
  if (srcName === "crash") {
    lifetime = [...lifetimes].reverse().find((seg) => hasTurnStart(seg) && !hasTerminal(seg)) ?? lifetimes[lifetimes.length - 1];
  } else {
    lifetime = lifetimes[lifetimes.length - 1];
  }
  const events = [];
  for (const rec of lifetime) {
    if (rec.method !== "session/event") continue;
    const p = rec.params ?? {};
    events.push({
      seq: p.seq,
      ...(p.turnId !== undefined ? { turnId: p.turnId } : {}),
      type: p.type,
      payload: p.payload ?? {},
    });
  }
  const fixture = {
    metadata: {
      ...wrapped.metadata,
      extractedFor: "protocol-contract replay tests (L1 evidence, sanitized)",
      sourceTrace: "zcode-acp-recon/traces/" + srcName + ".sanitized.json",
    },
    events,
  };
  const out = path.join(OUT_DIR, outName + ".json");
  fs.writeFileSync(out, JSON.stringify(fixture, null, 1));
  const types = {};
  for (const e of events) types[e.type] = (types[e.type] || 0) + 1;
  summary[outName] = { events: events.length, types };
}
fs.writeFileSync(path.join(RECON, "reports", "phase3", "fixture-summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 1));
