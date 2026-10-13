import type { Claim, Report } from "./types";

const PROHIBITED = /(必涨|必跌|稳赚|买入|卖出|加仓|减仓|仓位|收益率将|预计收益)/;

export async function enhanceReport(report: Report): Promise<Report> {
  const key = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL;
  if (!key || !model || report.state === "insufficient") return report;
  const prompt = {
    question: report.input.question,
    state: report.stateLabel,
    evidence: report.evidence.filter(x => x.quality === "valid").map(x => ({ id: x.id, statement: x.statement, metric: x.metric, observedAt: x.observedAt })),
    missingDimensions: report.missingDimensions
  };
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, instructions: "你是金融研究文字编辑。只根据输入的已核验证据，将市场矛盾概括成至多两句中文归纳，并提出两个后续研究问题。不要添加任何数字、日期、事件、来源、涨跌预测、买卖或仓位建议。只返回 JSON 对象：{\"syntheses\":[{\"text\":\"...\",\"evidenceIds\":[\"...\"]}],\"followUps\":[\"...\"]}。引用必须来自输入证据。", input: JSON.stringify(prompt), max_output_tokens: 500 }),
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) return report;
    const body = await response.json() as { output?: { content?: { type?: string; text?: string }[] }[]; output_text?: string };
    const text = body.output_text || body.output?.flatMap(x => x.content || []).filter(x => x.type === "output_text").map(x => x.text || "").join("") || "";
    const parsed = JSON.parse(text) as { syntheses?: Claim[]; followUps?: string[] };
    const validIds = new Set(report.evidence.filter(x => x.quality === "valid").map(x => x.id));
    if (!Array.isArray(parsed.syntheses) || !Array.isArray(parsed.followUps)) return report;
    if (parsed.syntheses.length < 1 || parsed.syntheses.length > 2 || parsed.followUps.length !== 2) return report;
    const good = parsed.syntheses.every(x => typeof x.text === "string" && x.text.length <= 120 && !/[0-9０-９]/.test(x.text) && !PROHIBITED.test(x.text) && Array.isArray(x.evidenceIds) && x.evidenceIds.length >= 1 && x.evidenceIds.every(id => validIds.has(id)));
    if (!good || parsed.followUps.some(x => typeof x !== "string" || x.length > 80 || PROHIBITED.test(x))) return report;
    return { ...report, syntheses: [...report.syntheses, ...parsed.syntheses], followUps: [...parsed.followUps, ...report.followUps], explanationMode: "model" };
  } catch { return report; }
}
