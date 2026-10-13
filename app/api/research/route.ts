import { NextResponse } from "next/server";
import { getLiveData } from "@/lib/data";
import { enhanceReport } from "@/lib/explain";
import { parseInput, InputError } from "@/lib/input";
import { buildReport } from "@/lib/research";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const input = parseInput(await request.json());
    const key = process.env.FUYAO_API_KEY;
    if (!key) return NextResponse.json({ error: "真实金融数据未配置：服务端缺少 FUYAO_API_KEY。" }, { status: 503 });
    const data = await getLiveData(input, key);
    const report = await enhanceReport(buildReport(input, data));
    return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof InputError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "研究任务失败" }, { status });
  }
}
