import { DIMENSIONS, type Dimension, type ResearchInput } from "./types";

const INDEXES = ["000001.SH", "000300.SH", "399006.SZ"] as const;
const BLOCKED = /(明天|下周|未来).{0,10}(必涨|必跌|涨吗|跌吗|预测)|买入|卖出|加仓|减仓|几成仓|稳赚|收益承诺|推荐.{0,8}(股票|个股)/;

export class InputError extends Error { constructor(message: string, public status = 400) { super(message); } }

export function parseInput(value: unknown): ResearchInput {
  if (!value || typeof value !== "object") throw new InputError("请输入研究条件。");
  const raw = value as Record<string, unknown>;
  const indexCode = raw.indexCode;
  const tradingDays = raw.tradingDays;
  const question = typeof raw.question === "string" ? raw.question.trim() : "";
  const mode = raw.mode;
  if (!INDEXES.some(x => x === indexCode)) throw new InputError("请选择支持的研究指数。");
  if (![5, 20, 60].includes(tradingDays as number)) throw new InputError("研究区间只能是 5、20 或 60 个交易日。");
  if (!question || question.length > 200) throw new InputError("研究问题应为 1–200 个字符。");
  if (BLOCKED.test(question)) throw new InputError("本产品研究已有数据与风险变量，不提供确定性涨跌预测、买卖或仓位建议。可以改问：当前市场状态有哪些证据？", 422);
  if (mode !== "live") throw new InputError("本产品仅使用真实接口数据。");
  const dimensions = Array.isArray(raw.dimensions) ? raw.dimensions.filter((x): x is Dimension => DIMENSIONS.includes(x as Dimension)) : [...DIMENSIONS];
  return { indexCode: indexCode as ResearchInput["indexCode"], tradingDays: tradingDays as ResearchInput["tradingDays"], question, mode, dimensions: [...new Set<Dimension>(["structure", "breadth", ...dimensions])] };
}
