import type { ResearchInput, Source } from "./types";
import { loadEvents, type MarketEvent } from "./ifind";

export interface Bar { date_ms: number; close_price: number; turnover: number }
export interface Breadth { total: number; valid: number; up: number; down: number; flat: number; turnover: number; pagesFailed: number }
export interface Valuation { validPe: number[]; negativePe: number; missingPe: number; total: number }
export interface Sentiment { up: number; down: number; break: number }
export interface Slice<T> { value?: T; timestamp?: number; source: Source; error?: string; coverage?: number }
export interface MarketData {
  latestTradingDate?: number;
  index: Slice<Bar[]>;
  breadth: Slice<Breadth>;
  styles: Slice<Record<string, Bar[]>>;
  valuation: Slice<Valuation>;
  sentiment: Slice<Sentiment>;
  event: Slice<MarketEvent[]>;
}

const BASE = "https://fuyao.aicubes.cn";
const source = (endpoint: string, requestId?: string): Source => ({
  provider: "扶摇金融数据 API", endpoint, url: `${BASE}${endpoint}`, requestId
});

interface Envelope<T> { code: number; message: string; request_id?: string; data: T }
async function fuyao<T>(path: string, key: string): Promise<{ data: T; source: Source }> {
  const response = await fetch(`${BASE}${path}`, { headers: { "X-api-key": key }, signal: AbortSignal.timeout(8000), cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json() as Envelope<T>;
  if (body.code !== 0) throw new Error(`扶摇业务错误 ${body.code}：${body.message || "未提供说明"}`);
  return { data: body.data, source: source(path, body.request_id) };
}

async function attempt<T>(path: string, call: () => Promise<{ value: T; timestamp?: number; source: Source; coverage?: number }>): Promise<Slice<T>> {
  try { return await call(); }
  catch (error) { return { source: source(path), error: error instanceof Error ? error.message : "未知取数错误" }; }
}

async function indexBars(code: string, start: number, end: number, key: string): Promise<Slice<Bar[]>> {
  const path = `/api/a-share-index/prices/historical?thscode=${encodeURIComponent(code)}&interval=1d&start=${start}&end=${end}`;
  return attempt(path, async () => {
    const result = await fuyao<{ timestamp?: number; item?: Bar[] }>(path, key);
    const bars = (result.data.item || []).filter(x => Number.isFinite(x.date_ms) && Number.isFinite(x.close_price)).sort((a, b) => a.date_ms - b.date_ms);
    if (bars.length < 2) throw new Error("指数日线不足，无法判断方向");
    return { value: bars, timestamp: result.data.timestamp, source: result.source };
  });
}

async function stockBreadth(key: string): Promise<Slice<Breadth>> {
  const path = "/api/a-share/prices/snapshot?limit=100&offset=0";
  return attempt(path, async () => {
    type Stock = { thscode: string; price_change_ratio_pct: number | null; turnover: number | null };
    type Page = { timestamp?: number; total: number; item: Stock[] };
    const first = await fuyao<Page>(path, key);
    const total = first.data.total;
    if (!Number.isFinite(total) || total < 1 || total > 12000) throw new Error("全市场总数异常");
    const pageCount = Math.ceil(total / 100);
    const pages: Array<Page | null> = Array(pageCount).fill(null);
    pages[0] = first.data;
    let next = 1;
    const workers = Array.from({ length: Math.min(4, pageCount - 1) }, async () => {
      while (next < pageCount) {
        const page = next++;
        try {
          const result = await fuyao<Page>(`/api/a-share/prices/snapshot?limit=100&offset=${page * 100}`, key);
          pages[page] = result.data;
        } catch { pages[page] = null; }
      }
    });
    await Promise.all(workers);
    const stocks = new Map<string, Stock>();
    for (const page of pages) for (const stock of page?.item || []) if (stock.thscode) stocks.set(stock.thscode, stock);
    const valid = [...stocks.values()].filter(x => typeof x.price_change_ratio_pct === "number" && Number.isFinite(x.price_change_ratio_pct));
    const value: Breadth = {
      total, valid: valid.length, up: valid.filter(x => x.price_change_ratio_pct! > 0).length,
      down: valid.filter(x => x.price_change_ratio_pct! < 0).length,
      flat: valid.filter(x => x.price_change_ratio_pct === 0).length,
      turnover: valid.reduce((sum, x) => sum + (Number.isFinite(x.turnover) ? (x.turnover || 0) : 0), 0),
      pagesFailed: pages.filter(x => x === null).length
    };
    const timestamp = Math.min(...pages.filter((x): x is Page => !!x && typeof x.timestamp === "number").map(x => x.timestamp!));
    return { value, timestamp: Number.isFinite(timestamp) ? timestamp : undefined, source: first.source, coverage: valid.length / total };
  });
}

async function valuationSample(key: string): Promise<Slice<Valuation>> {
  const path = "/api/a-share-index/constituents/ths-stock-list?thscode=000300.SH";
  return attempt(path, async () => {
    const constituents = await fuyao<{ timestamp?: number; item: { thscode: string }[] }>(path, key);
    const codes = (constituents.data.item || []).map(x => x.thscode).filter(Boolean);
    if (!codes.length) throw new Error("成分股列表为空");
    type Val = { pe_ttm: number | null };
    const vals: Val[] = [];
    for (let i = 0; i < codes.length; i += 100) {
      const result = await fuyao<{ timestamp?: number; item: Val[] }>(`/api/a-share/valuations/snapshot?thscodes=${codes.slice(i, i + 100).join(",")}`, key);
      vals.push(...(result.data.item || []));
    }
    const pe = vals.map(x => x.pe_ttm);
    return { value: { validPe: pe.filter((x): x is number => typeof x === "number" && Number.isFinite(x) && x > 0), negativePe: pe.filter(x => typeof x === "number" && x <= 0).length, missingPe: codes.length - vals.length + pe.filter(x => x === null).length, total: codes.length }, timestamp: constituents.data.timestamp, source: constituents.source, coverage: vals.length / codes.length };
  });
}

async function sentiment(key: string, dateMs: number): Promise<Slice<Sentiment>> {
  const path = "/api/a-share/special-data/limit-up-pool";
  return attempt(path, async () => {
    const names = ["limit-up-pool", "limit-down-pool", "limit-break-pool"];
    const counts = await Promise.all(names.map(async name => {
      const result = await fuyao<{ timestamp?: number; pagination?: { total: number }; item?: unknown[] }>(`/api/a-share/special-data/${name}?date_ms=${dateMs}&page=1&size=200`, key);
      return { count: result.data.pagination?.total ?? result.data.item?.length ?? 0, timestamp: result.data.timestamp, requestId: result.source.requestId };
    }));
    return { value: { up: counts[0].count, down: counts[1].count, break: counts[2].count }, timestamp: Math.min(...counts.map(x => x.timestamp || Date.now())), source: source(path, counts.map(x => x.requestId).filter(Boolean).join(",")) };
  });
}

export async function loadLiveData(input: ResearchInput, key: string): Promise<MarketData> {
  const end = Date.now();
  const start = end - 120 * 86_400_000;
  const calendarPath = "/api/a-share/calendar/trading-days";
  const calendar = await attempt(calendarPath, async () => {
    const result = await fuyao<{ timestamp?: number; item: { date_ms: number }[] }>(calendarPath, key);
    return { value: result.data.item, timestamp: result.data.timestamp, source: result.source };
  });
  const tradingDate = calendar.value?.map(x => x.date_ms).filter(x => x + 15 * 3_600_000 <= Date.now()).sort((a, b) => b - a)[0];
  const primary = indexBars(input.indexCode, start, end, key);
  const styles = input.dimensions.includes("style") ? Promise.all(["000001.SH", "000300.SH", "399006.SZ"].map(code => indexBars(code, start, end, key))) : Promise.resolve([]);
  const breadth = input.dimensions.includes("breadth") ? stockBreadth(key) : Promise.resolve({ source: source("/api/a-share/prices/snapshot"), error: "用户未选此维度" } as Slice<Breadth>);
  const valuation = input.dimensions.includes("valuation") ? valuationSample(key) : Promise.resolve({ source: source("/api/a-share/valuations/snapshot"), error: "用户未选此维度" } as Slice<Valuation>);
  const sent = input.dimensions.includes("sentiment") && tradingDate ? sentiment(key, tradingDate) : Promise.resolve({ source: source("/api/a-share/special-data"), error: tradingDate ? "用户未选此维度" : "交易日历不可用" } as Slice<Sentiment>);
  const event = input.dimensions.includes("event") ? loadEvents(process.env.IFIND_API_KEY, tradingDate) : Promise.resolve({ source: { provider: "iFinD MCP", endpoint: "search_news", url: "https://mcp.51ifind.com/" }, error: "用户未选此维度" } as Slice<MarketEvent[]>);
  const [indexResult, styleResult, breadthResult, valuationResult, sentimentResult, eventResult] = await Promise.all([primary, styles, breadth, valuation, sent, event]);
  const styleCodes = ["000001.SH", "000300.SH", "399006.SZ"];
  const styleEntries = styleResult.flatMap((x, i) => x.value ? [[styleCodes[i], x.value] as const] : []);
  return {
    latestTradingDate: tradingDate,
    index: indexResult,
    breadth: breadthResult,
    styles: styleEntries.length ? { value: Object.fromEntries(styleEntries), timestamp: Math.min(...styleResult.filter(x => x.timestamp).map(x => x.timestamp!)), source: source("/api/a-share-index/prices/historical") } : { source: source("/api/a-share-index/prices/historical"), error: "风格指数日线不可用" },
    valuation: valuationResult,
    sentiment: sentimentResult,
    event: eventResult
  };
}

const liveCache = new Map<string, { expires: number; data: Promise<MarketData> }>();
export function getLiveData(input: ResearchInput, key: string): Promise<MarketData> {
  const cacheKey = `${input.indexCode}:${input.dimensions.toSorted().join(",")}`;
  const cached = liveCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.data;
  const data = loadLiveData(input, key);
  liveCache.set(cacheKey, { expires: Date.now() + 120_000, data });
  if (liveCache.size > 24) liveCache.delete(liveCache.keys().next().value!);
  return data;
}
