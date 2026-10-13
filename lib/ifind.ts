import type { Slice } from "./data";
import type { Source } from "./types";

export interface MarketEvent {
  title: string;
  excerpt: string;
  date: string;
  url: string;
}

const ENDPOINT = "https://api-mcp.51ifind.com:8643/ds-mcp-servers/hexin-ifind-ds-news-mcp";
const SOURCE: Source = { provider: "iFinD MCP", endpoint: "search_news", url: "https://mcp.51ifind.com/" };

function dateString(ms: number) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
}

function verifiedSnapshot(reason: string): Slice<MarketEvent[]> | null {
  try {
    const snapshot = JSON.parse(process.env.IFIND_EVENT_SNAPSHOT_JSON || "[]") as MarketEvent[];
    const events = snapshot.filter(item => item && /^https?:\/\//.test(item.url) && /^\d{4}-\d{2}-\d{2}$/.test(item.date));
    const newest = events.map(item => Date.parse(`${item.date}T12:00:00+08:00`)).sort((a, b) => b - a)[0];
    if (!events.length || !newest || Date.now() - newest >= 7 * 86_400_000) return null;
    return {
      value: events, timestamp: newest,
      source: { provider: "iFinD MCP · 已验证快照", endpoint: "search_news", url: SOURCE.url },
      error: `${reason}；展示截至 ${dateString(newest)} 已验证的真实资讯快照。`,
      coverage: 1
    };
  } catch { return null; }
}

async function mcpPost(token: string, payload: object, session?: string) {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: token,
      ...(session ? { "Mcp-Session-Id": session } : {})
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(12_000),
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`iFinD HTTP ${response.status}`);
  return { data: await response.json() as { error?: unknown; result?: { isError?: boolean; content?: { type?: string; text?: string }[] } }, session: response.headers.get("mcp-session-id") || session };
}

export async function loadEvents(token: string | undefined, tradingDate?: number): Promise<Slice<MarketEvent[]>> {
  if (process.env.IFIND_EVENT_SNAPSHOT_JSON) {
    return verifiedSnapshot("当前托管环境无法实时连接 iFinD MCP") || { source: SOURCE, error: "iFinD 真实资讯快照已过期或不可用。" };
  }
  if (!token) return { source: SOURCE, error: "iFinD MCP 密钥未配置。" };
  const end = tradingDate || Date.now();
  const start = end - 7 * 86_400_000;
  try {
    const init = await mcpPost(token, {
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "market-coordinates", version: "0.1.0" } }
    });
    if (!init.session) throw new Error("iFinD 未返回会话 ID");
    await mcpPost(token, { jsonrpc: "2.0", method: "notifications/initialized" }, init.session);
    const call = await mcpPost(token, {
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "search_news", arguments: { query: "A股市场 宏观政策 流动性", time_start: dateString(start), time_end: dateString(end), size: 3 } }
    }, init.session);
    if (call.data.error || call.data.result?.isError) throw new Error("iFinD 新闻检索失败");
    const text = call.data.result?.content?.find((item: { type?: string }) => item.type === "text")?.text;
    if (typeof text !== "string") throw new Error("iFinD 未返回文本内容");
    const inner = JSON.parse(text);
    if (inner.code !== 1) throw new Error(`iFinD 业务错误：${inner.msg || inner.code}`);
    const raw = typeof inner.data?.data === "string" ? JSON.parse(inner.data.data) : inner.data?.result;
    if (!Array.isArray(raw)) throw new Error("iFinD 新闻结构无法识别");
    const events: MarketEvent[] = raw.filter((item: Record<string, unknown>) => typeof item["资讯标题"] === "string" && typeof item["URL"] === "string")
      .map((item: Record<string, unknown>) => ({
        title: String(item["资讯标题"]).slice(0, 120),
        excerpt: String(item["资讯内容"] || "").slice(0, 280),
        date: String(item["日期"] || ""),
        url: String(item["URL"])
      }))
      .filter(item => /^https?:\/\//.test(item.url) && /^\d{4}-\d{2}-\d{2}$/.test(item.date));
    if (!events.length) return { source: SOURCE, error: "iFinD 未检索到可核对日期与链接的资讯。" };
    return { value: events, timestamp: Date.parse(`${events[0].date}T12:00:00+08:00`), source: SOURCE, coverage: 1 };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "iFinD 事件取数失败";
    return verifiedSnapshot(`iFinD 实时连接失败（${reason}）`) || { source: SOURCE, error: reason };
  }
}
