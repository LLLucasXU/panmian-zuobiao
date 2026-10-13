import { NextResponse } from "next/server";
import { parseInput, InputError } from "@/lib/input";
import { DIMENSION_LABELS } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const input = parseInput(await request.json());
    const plan = input.dimensions.map(dimension => ({
      dimension, label: DIMENSION_LABELS[dimension],
      source: dimension === "event" ? process.env.IFIND_EVENT_SNAPSHOT_JSON ? "iFinD MCP · 已验证资讯快照" : "iFinD MCP · 新闻片段检索" : "扶摇金融数据 API",
      purpose: ({ structure: "判断指数近 20 日方向", breadth: "判断今日上涨股票参与度及覆盖率", style: "比较风格指数近 20 日表现", valuation: "描述沪深 300 成分股 PE 样本", liquidity: "比较指数成交额与历史中位数", sentiment: "查看涨跌停与炸板池", event: "核对有原文的事件" })[dimension],
      available: dimension === "event" ? !!(process.env.IFIND_API_KEY || process.env.IFIND_EVENT_SNAPSHOT_JSON) : !!process.env.FUYAO_API_KEY
    }));
    return NextResponse.json({ input, plan, note: "所有市场数值仅来自实时调用的真实接口；取数失败会明确展示。" });
  } catch (error) {
    const status = error instanceof InputError ? error.status : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "输入解析失败" }, { status });
  }
}
