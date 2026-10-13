export type Dimension = "structure" | "breadth" | "style" | "valuation" | "liquidity" | "sentiment" | "event";
export type DataMode = "live";
export type Quality = "valid" | "stale" | "partial" | "conflict" | "missing";
export type State = "up_broad_today" | "up_weak_today" | "down_broad_today" | "down_weak_today" | "divergent" | "insufficient";

export interface ResearchInput {
  indexCode: "000001.SH" | "000300.SH" | "399006.SZ";
  tradingDays: 5 | 20 | 60;
  question: string;
  dimensions: Dimension[];
  mode: DataMode;
}

export interface Source {
  provider: string;
  endpoint: string;
  url: string;
  requestId?: string;
}

export interface Evidence {
  id: string;
  dimension: Dimension;
  statement: string;
  value: number | string | null;
  unit: string;
  metric: string;
  observedAt: string;
  fetchedAt: string;
  source: Source;
  rawFields: Record<string, unknown>;
  formula?: string;
  quality: Quality;
}

export interface Claim { text: string; evidenceIds: string[] }
export interface FollowUpAnswer { question: string; text: string; evidenceIds: string[]; limited: boolean }
export interface Report {
  id: string;
  input: ResearchInput;
  dataMode: DataMode;
  dataStatus: "complete" | "partial" | "unavailable";
  state: State;
  stateLabel: string;
  confidence: "high" | "medium" | "low" | "unavailable";
  confidenceReasons: string[];
  facts: Claim[];
  syntheses: Claim[];
  uncertainties: Claim[];
  contradictions: Claim[];
  switchConditions: Claim[];
  missingDimensions: Dimension[];
  evidence: Evidence[];
  warnings: string[];
  generatedAt: string;
  explanationMode: "model" | "template";
  followUps: string[];
  followUpAnswer?: FollowUpAnswer;
}

export const DIMENSIONS: Dimension[] = ["structure", "breadth", "style", "valuation", "liquidity", "sentiment", "event"];
export const DIMENSION_LABELS: Record<Dimension, string> = {
  structure: "行情结构", breadth: "市场宽度", style: "风格轮动", valuation: "估值样本",
  liquidity: "流动性", sentiment: "短线情绪", event: "重要事件"
};

export const INDEX_LABELS: Record<ResearchInput["indexCode"], string> = {
  "000001.SH": "上证综指", "000300.SH": "沪深 300", "399006.SZ": "创业板指"
};
