import test from "node:test";
import assert from "node:assert/strict";
import type { MarketData } from "../lib/data";
import { InputError, parseInput } from "../lib/input";
import { answerFollowUp } from "../lib/follow-up";
import { buildReport, decideState, isStale, median, percentChange } from "../lib/research";
import { DIMENSIONS, type ResearchInput } from "../lib/types";

const input: ResearchInput = { indexCode: "000001.SH", tradingDays: 20, question: "当前市场状态有什么证据？", dimensions: [...DIMENSIONS], mode: "live" };
const t = Date.parse("2026-10-13T15:00:00+08:00");
const source = { provider: "测试夹具", endpoint: "known-sample", url: "" };
function fixture(): MarketData {
  const bars = Array.from({ length: 21 }, (_, i) => ({ date_ms: t - (20 - i) * 86_400_000, close_price: 100 + i / 5, turnover: 1000 + i * 5 }));
  return {
    latestTradingDate: t,
    index: { value: bars, timestamp: t, source },
    breadth: { value: { total: 100, valid: 100, up: 40, down: 55, flat: 5, turnover: 100000, pagesFailed: 0 }, timestamp: t, source, coverage: 1 },
    styles: { value: { "000001.SH": bars, "000300.SH": bars.map(x => ({ ...x, close_price: x.close_price + 2 })) }, timestamp: t, source },
    valuation: { value: { validPe: [10, 15, 20], negativePe: 0, missingPe: 0, total: 3 }, timestamp: t, source },
    sentiment: { value: { up: 10, down: 3, break: 5 }, timestamp: t, source },
    event: { source, error: "测试时不可用" }
  };
}

test("state rule requires both index direction and complete breadth", () => {
  assert.equal(decideState(3.2, 0.4, 0.98), "up_weak_today");
  assert.equal(decideState(3.2, 0.4, 0.75), "insufficient");
  assert.equal(decideState(null, 0.6, 1), "insufficient");
});

test("indicator calculations use exact supplied samples", () => {
  assert.equal(median([2, 8, 4, 6]), 5);
  assert.ok(Math.abs(percentChange([{ date_ms: 1, close_price: 100, turnover: 1 }, { date_ms: 2, close_price: 110, turnover: 2 }], 1)! - 10) < 0.00001);
});

test("report traces numeric claims to fields and marks missing event", () => {
  const report = buildReport(input, fixture());
  assert.equal(report.dataMode, "live");
  assert.equal(report.state, "up_weak_today");
  assert.ok(report.evidence.some(x => x.id === "breadth.upShare" && x.rawFields.up === 40));
  const ids = new Set(report.evidence.map(x => x.id));
  for (const claim of [...report.facts, ...report.syntheses, ...report.contradictions]) for (const id of claim.evidenceIds) assert.ok(ids.has(id));
  assert.ok(report.missingDimensions.includes("event"));
});

test("input validation blocks trading requests, arbitrary codes and demo data", () => {
  assert.throws(() => parseInput({ ...input, question: "我该买入哪只股票？" }), (error: unknown) => error instanceof InputError && error.status === 422);
  assert.throws(() => parseInput({ ...input, indexCode: "BAD" }), InputError);
  assert.throws(() => parseInput({ ...input, mode: "demo" }), InputError);
});

test("stale market slices cannot produce a current-state label", () => {
  const data = fixture();
  data.latestTradingDate = Date.parse("2026-10-14T15:00:00+08:00");
  assert.equal(isStale(data.index.timestamp, data.latestTradingDate), true);
  const report = buildReport(input, data);
  assert.equal(report.state, "insufficient");
  assert.equal(report.evidence.find(x => x.id === "structure.change20")?.quality, "stale");
});

test("follow-up gives a visible, evidence-linked answer to a suggested question", () => {
  const report = buildReport(input, fixture());
  const answer = answerFollowUp("风格指数之间的分化有多大？", report);
  assert.match(answer.text, /百分点/);
  assert.deepEqual(answer.evidenceIds, ["style.spread20"]);
  assert.equal(answer.limited, true); // The fixture has only two comparable indexes.
});

test("follow-up states its limit when a requested dimension is unavailable", () => {
  const report = buildReport(input, fixture());
  const answer = answerFollowUp("最近的政策事件有哪些？", report);
  assert.equal(answer.limited, true);
  assert.match(answer.text, /没有足够的事件资讯证据/);
  assert.deepEqual(answer.evidenceIds, []);
});
