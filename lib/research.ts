import { type MarketData, type Bar, type Slice } from "./data";
import { DIMENSIONS, DIMENSION_LABELS, INDEX_LABELS, type Claim, type Dimension, type Evidence, type Report, type ResearchInput, type State } from "./types";

const formatPct = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
const formatTime = (ms?: number) => ms ? new Date(ms).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "未知时点";
const sourceDate = (ms?: number) => ms ? new Date(ms).toISOString() : "";

export function median(values: number[]): number | null {
  const sorted = values.filter(Number.isFinite).toSorted((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function percentChange(bars: Bar[], days: number): number | null {
  if (bars.length < days + 1) return null;
  const start = bars.at(-(days + 1))?.close_price;
  const end = bars.at(-1)?.close_price;
  if (!start || !end) return null;
  return (end / start - 1) * 100;
}

export function decideState(change20: number | null, upShare: number | null, coverage: number): State {
  if (change20 === null || upShare === null || coverage < 0.95) return "insufficient";
  if (change20 > 2 && upShare >= 0.55) return "up_broad_today";
  if (change20 > 2 && upShare <= 0.45) return "up_weak_today";
  if (change20 < -2 && upShare >= 0.55) return "down_broad_today";
  if (change20 < -2 && upShare <= 0.45) return "down_weak_today";
  return "divergent";
}

function shanghaiDay(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
}

export function isStale(timestamp: number | undefined, latestTradingDate: number | undefined): boolean {
  if (!timestamp || !latestTradingDate) return true;
  return shanghaiDay(timestamp) < shanghaiDay(latestTradingDate);
}

const STATE_LABEL: Record<State, string> = {
  up_broad_today: "近 20 日走强 · 最近交易日广泛参与",
  up_weak_today: "近 20 日走强 · 最近交易日参与偏弱",
  down_broad_today: "近 20 日走弱 · 最近交易日广泛参与",
  down_weak_today: "近 20 日走弱 · 最近交易日参与偏弱",
  divergent: "方向或参与度分歧",
  insufficient: "证据不足，暂不判定市场状态"
};

function fact(text: string, ...evidenceIds: string[]): Claim { return { text, evidenceIds }; }
function usable<T>(slice: Slice<T>): slice is Slice<T> & { value: T } { return slice.value !== undefined; }

export function buildReport(input: ResearchInput, data: MarketData): Report {
  const now = new Date().toISOString();
  const evidence: Evidence[] = [];
  const facts: Claim[] = [];
  const syntheses: Claim[] = [];
  const uncertainties: Claim[] = [];
  const contradictions: Claim[] = [];
  const warnings: string[] = [];
  const missingDimensions: Dimension[] = [];

  const add = (slice: Slice<unknown>, dimension: Dimension, id: string, statement: string, value: number | string | null, unit: string, metric: string, rawFields: Record<string, unknown>, formula?: string, quality: Evidence["quality"] = "valid") => {
    evidence.push({ id, dimension, statement, value, unit, metric, observedAt: sourceDate(slice.timestamp), fetchedAt: now, source: slice.source, rawFields, formula, quality });
  };
  const missing = (dimension: Dimension, reason: string) => { missingDimensions.push(dimension); warnings.push(`${DIMENSION_LABELS[dimension]}：${reason}`); };

  let change20: number | null = null;
  const indexStale = isStale(data.index.timestamp, data.latestTradingDate);
  const breadthStale = isStale(data.breadth.timestamp, data.latestTradingDate);
  if (indexStale) warnings.push("指数日线不是最近交易日数据；不可作为当前状态依据。");
  if (breadthStale) warnings.push("全市场快照不是最近交易日数据；不可作为参与度依据。");
  if (usable(data.index)) {
    change20 = percentChange(data.index.value, 20);
    const last = data.index.value.at(-1)!;
    const base = data.index.value.at(-21);
    if (change20 !== null && base) {
      const id = "structure.change20";
      const name = INDEX_LABELS[input.indexCode];
      add(data.index, "structure", id, `${name}近 20 个交易日收盘变化 ${formatPct(change20)}`, change20, "%", `${name}，未复权指数日线，末值相对第 20 个交易日前收盘`, { start_date_ms: base.date_ms, start_close_price: base.close_price, end_date_ms: last.date_ms, end_close_price: last.close_price }, "(end_close_price / start_close_price - 1) × 100", indexStale ? "stale" : "valid");
      facts.push(fact(`${name}近 20 个交易日收盘变化 ${formatPct(change20)}；末根日线为 ${formatTime(last.date_ms)}。`, id));
    } else missing("structure", "指数日线不足 21 根，无法计算 20 日变化。 ");
    const selected = percentChange(data.index.value, input.tradingDays);
    if (selected !== null && input.tradingDays !== 20) {
      const baseSelected = data.index.value.at(-(input.tradingDays + 1))!;
      const id = `structure.change${input.tradingDays}`;
      add(data.index, "structure", id, `${INDEX_LABELS[input.indexCode]}近 ${input.tradingDays} 个交易日变化 ${formatPct(selected)}`, selected, "%", `${INDEX_LABELS[input.indexCode]}指数日线`, { start_date_ms: baseSelected.date_ms, start_close_price: baseSelected.close_price, end_date_ms: last.date_ms, end_close_price: last.close_price }, "(end_close_price / start_close_price - 1) × 100", indexStale ? "stale" : "valid");
      facts.push(fact(`所选 ${input.tradingDays} 日窗口变化 ${formatPct(selected)}。`, id));
    }
  } else missing("structure", data.index.error || "指数行情不可用。");

  let upShare: number | null = null;
  const coverage = data.breadth.coverage || 0;
  if (usable(data.breadth) && data.breadth.value.valid > 0) {
    const b = data.breadth.value;
    upShare = b.up / b.valid;
    const id = "breadth.upShare";
    const quality = breadthStale ? "stale" : coverage >= 0.95 && b.pagesFailed === 0 ? "valid" : "partial";
    add(data.breadth, "breadth", id, `有效样本上涨占比 ${(upShare * 100).toFixed(1)}%`, upShare * 100, "%", `A 股代码表 ${b.total} 只；有效快照 ${b.valid} 只；覆盖率 ${(coverage * 100).toFixed(1)}%；上涨/下跌/平盘：${b.up}/${b.down}/${b.flat}`, { total: b.total, valid: b.valid, up: b.up, down: b.down, flat: b.flat, pages_failed: b.pagesFailed }, "up / valid × 100", quality);
    facts.push(fact(`最近交易日有效快照中 ${b.up} 只上涨、${b.down} 只下跌，上涨占比 ${(upShare * 100).toFixed(1)}%；覆盖 ${b.valid}/${b.total}。`, id));
    if (quality !== "valid") warnings.push(`市场宽度仅覆盖 ${(coverage * 100).toFixed(1)}%，不可称为全市场结论。`);
  } else missing("breadth", data.breadth.error || "快照有效样本为 0。");

  if (usable(data.styles)) {
    const pairs = Object.entries(data.styles.value).map(([code, bars]) => ({ code, change: percentChange(bars, 20) })).filter((x): x is {code: string; change: number} => x.change !== null);
    if (pairs.length >= 2) {
      const sorted = pairs.toSorted((a, b) => b.change - a.change);
      const spread = sorted[0].change - sorted.at(-1)!.change;
      const id = "style.spread20";
      add(data.styles, "style", id, `样本指数近 20 日表现差距 ${spread.toFixed(2)} 个百分点`, spread, "百分点", `比较 ${sorted.map(x => x.code).join("、")} 的 20 日收盘变化`, { changes: Object.fromEntries(pairs.map(x => [x.code, x.change])) }, "max(change20) - min(change20)", pairs.length < 3 ? "partial" : "valid");
      facts.push(fact(`样本指数近 20 日表现最大差距为 ${spread.toFixed(2)} 个百分点。`, id));
    } else missing("style", "可比较的指数不足两只。");
  } else missing("style", data.styles.error || "风格指数不可用。");

  if (usable(data.valuation)) {
    const v = data.valuation.value;
    const med = median(v.validPe);
    if (med !== null) {
      const id = "valuation.peMedian";
      add(data.valuation, "valuation", id, `沪深 300 成分股正 PE 样本中位数 ${med.toFixed(2)} 倍`, med, "倍", `有效正 PE ${v.validPe.length}/${v.total}；负或零 PE ${v.negativePe}；缺失 ${v.missingPe}；仅最新快照，非历史分位`, { valid_pe_count: v.validPe.length, negative_or_zero_pe: v.negativePe, missing_pe: v.missingPe, total: v.total, median_pe: med }, "median(pe_ttm where pe_ttm > 0)", v.validPe.length / v.total >= 0.8 ? "valid" : "partial");
      facts.push(fact(`沪深 300 成分股正 PE 样本中位数 ${med.toFixed(2)} 倍，有效 ${v.validPe.length}/${v.total}；不能据此判断全市场估值高低。`, id));
    } else missing("valuation", "没有有效正 PE 样本。");
  } else missing("valuation", data.valuation.error || "估值数据不可用。");

  if (usable(data.index) && data.index.value.length >= 21) {
    const bars = data.index.value;
    const current = bars.at(-1)!.turnover;
    const baseline = median(bars.slice(-21, -1).map(x => x.turnover));
    if (baseline && current) {
      const ratio = current / baseline;
      const id = "liquidity.indexTurnoverRatio";
      add(data.index, "liquidity", id, `${INDEX_LABELS[input.indexCode]}末根日线成交额为此前 20 根中位数的 ${ratio.toFixed(2)} 倍`, ratio, "倍", `目标指数成交额口径；非全市场成交额`, { current_turnover_cny: current, prior_20_median_turnover_cny: baseline, date_ms: bars.at(-1)!.date_ms }, "current_turnover / median(prior_20_turnover)");
      facts.push(fact(`${INDEX_LABELS[input.indexCode]}成交额为此前 20 根日线中位数的 ${ratio.toFixed(2)} 倍（指数口径）。`, id));
    } else missing("liquidity", "成交额字段不足或基期为 0。");
  } else missing("liquidity", "指数日线不足，无法比较成交额。");

  if (usable(data.sentiment)) {
    const s = data.sentiment.value;
    const id = "sentiment.limitPools";
    add(data.sentiment, "sentiment", id, `涨停 ${s.up}、跌停 ${s.down}、炸板 ${s.break} 只`, `${s.up}/${s.down}/${s.break}`, "只", "扶摇涨跌停及炸板池；短线情绪旁证，不代表全市场涨跌", { limit_up_total: s.up, limit_down_total: s.down, limit_break_total: s.break });
    facts.push(fact(`短线情绪池记录：涨停 ${s.up}、跌停 ${s.down}、炸板 ${s.break} 只。`, id));
  } else missing("sentiment", data.sentiment.error || "短线情绪数据不可用。");
  if (usable(data.event) && data.event.value.length) {
    if (data.event.error) warnings.push(data.event.error);
    for (const [index, item] of data.event.value.entries()) {
      const id = `event.news${index + 1}`;
      add({ ...data.event, timestamp: Date.parse(`${item.date}T12:00:00+08:00`), source: { ...data.event.source, url: item.url } },
        "event", id, `资讯线索：${item.title}`, item.title, "篇", "iFinD 新闻片段检索；仅表示存在相关报道，不验证报道内容或市场因果", { title: item.title, date: item.date, excerpt: item.excerpt, url: item.url }, undefined, "partial");
      facts.push(fact(`iFinD 检索到 ${item.date} 的资讯《${item.title}》；内容仍需打开原文核对。`, id));
    }
    uncertainties.push(fact("已取得事件资讯线索，但检索片段不能证明政策影响或解释市场涨跌。", ...data.event.value.map((_, i) => `event.news${i + 1}`)));
  } else missing("event", data.event.error || "未获得带日期与原文链接的事件资讯。");

  const state = decideState(indexStale ? null : change20, breadthStale ? null : upShare, coverage);
  if (state === "up_weak_today" || state === "down_broad_today") {
    const text = state === "up_weak_today" ? "指数近 20 日走强，但最近交易日上涨股票占比偏低；两种时间尺度的证据出现分化。" : "指数近 20 日走弱，但最近交易日上涨股票占比较高；两种时间尺度的证据出现分化。";
    contradictions.push(fact(text, "structure.change20", "breadth.upShare"));
  }
  if (state !== "insufficient") {
    syntheses.push(fact(`观察到“${STATE_LABEL[state]}”。该标签只描述近 20 日指数方向与最近交易日参与度，不推断下一交易日。`, "structure.change20", "breadth.upShare"));
  } else uncertainties.push(fact("核心指数或市场宽度证据不足，暂不生成完整市场状态判断。", ...evidence.filter(x => x.dimension === "structure" || x.dimension === "breadth").map(x => x.id)));
  if (!contradictions.length) uncertainties.push(fact("当前已获取的证据未形成足以确认的主要矛盾；继续观察风格与事件信息。", ...evidence.filter(x => x.dimension === "style").map(x => x.id)));
  if (missingDimensions.includes("event")) uncertainties.push(fact("事件维度未接通，不能解释政策或宏观事件对当日市场的影响。"));

  const score = (data.index.value ? 2 : 0) + (coverage >= 0.95 ? 2 : coverage >= 0.8 ? 1 : 0) + (missingDimensions.length <= 2 ? 2 : missingDimensions.length <= 4 ? 1 : 0) + (warnings.some(x => x.includes("过期") || x.includes("冲突")) ? 0 : 2) + (contradictions.length ? 1 : 2);
  const confidence = state === "insufficient" ? "unavailable" : score >= 8 && !missingDimensions.length && evidence.every(x => x.quality === "valid") ? "high" : score >= 5 ? "medium" : "low";
  const confidenceReasons = [`已覆盖 ${DIMENSIONS.length - missingDimensions.length}/${DIMENSIONS.length} 个维度`, `市场宽度有效覆盖率 ${(coverage * 100).toFixed(1)}%`, "该等级表示证据完备度，不是涨跌预测概率"];
  const switchConditions = state === "up_weak_today" ? [fact("若连续两个交易日上涨股票占比 ≥55%，且有效覆盖率 ≥95%，重新评估“今日参与偏弱”。", "breadth.upShare")] : state === "down_broad_today" ? [fact("若连续两个交易日上涨股票占比 ≤45%，且有效覆盖率 ≥95%，重新评估“今日广泛参与”。", "breadth.upShare")] : [fact("下一交易日核对指数 20 日方向与当日上涨占比；若任何一轴跨过预设区间，重新生成状态卡。", ...evidence.filter(x => x.id === "structure.change20" || x.id === "breadth.upShare").map(x => x.id))];

  const dataStatus = state === "insufficient" ? "unavailable" : missingDimensions.length || warnings.length || evidence.some(x => x.quality !== "valid") ? "partial" : "complete";
  return {
    id: crypto.randomUUID(), input, dataMode: input.mode, dataStatus, state, stateLabel: STATE_LABEL[state], confidence,
    confidenceReasons, facts, syntheses, uncertainties, contradictions, switchConditions,
    missingDimensions, evidence, warnings, generatedAt: now, explanationMode: "template",
    followUps: ["风格指数之间的分化有多大？", "哪些数据缺失可能改变当前判断？", "成交额变化与指数方向是否一致？", "什么变化会改变当前市场状态？"]
  };
}
