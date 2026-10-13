"use client";

import { useEffect, useRef, useState } from "react";
import { DIMENSIONS, DIMENSION_LABELS, INDEX_LABELS, type Claim, type Dimension, type Evidence, type Report, type ResearchInput } from "@/lib/types";

type PlanItem = { dimension: Dimension; label: string; source: string; purpose: string; available: boolean };
type Health = { fuyao: string; model: string; ifind: string };
const DEFAULT_INPUT: ResearchInput = {
  indexCode: "000001.SH", tradingDays: 20, question: "当前 A 股处于什么市场状态？哪些证据支持或反对这个判断？",
  dimensions: [...DIMENSIONS], mode: "live"
};
const QUALITY: Record<Evidence["quality"], string> = { valid: "已核验", stale: "已过期", partial: "部分覆盖", conflict: "口径冲突", missing: "缺失" };
const CONFIDENCE: Record<Report["confidence"], string> = { high: "较高", medium: "中等", low: "较低", unavailable: "无法判定" };

function ClaimList({ title, items, onOpen, type }: { title: string; items: Claim[]; onOpen: (id: string) => void; type: string }) {
  return <section className={`claim-block claim-${type}`}>
    <div className="claim-heading"><span className="claim-symbol" aria-hidden="true">{type === "fact" ? "●" : type === "synthesis" ? "◆" : "◇"}</span><h3>{title}</h3></div>
    {items.length ? items.map((item, index) => <div className="claim" key={`${title}-${index}`}><p>{item.text}</p>{item.evidenceIds.length > 0 && <div className="references">{item.evidenceIds.map(id => <button type="button" key={id} onClick={() => onOpen(id)} className="reference">查看证据 {id} ↗</button>)}</div>}</div>) : <p className="quiet">当前没有可展示的内容。</p>}
  </section>;
}

function formatDate(iso: string) {
  if (!iso) return "未提供时点";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "未提供时点" : date.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
}

export default function Home() {
  const [input, setInput] = useState<ResearchInput>(DEFAULT_INPUT);
  const [plan, setPlan] = useState<PlanItem[] | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [selectedEvidence, setSelectedEvidence] = useState<Evidence | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [error, setError] = useState("");
  const [followUp, setFollowUp] = useState("");
  const drawerClose = useRef<HTMLButtonElement>(null);
  const drawerOpener = useRef<HTMLElement | null>(null);

  useEffect(() => { fetch("/api/health").then(r => r.json()).then(value => setHealth(value as Health)).catch(() => setHealth(null)); }, []);
  useEffect(() => { if (selectedEvidence) drawerClose.current?.focus(); else drawerOpener.current?.focus(); }, [selectedEvidence]);
  useEffect(() => {
    if (!report) return;
    const target = document.getElementById(report.followUpAnswer ? "follow-up-answer" : "report");
    target?.scrollIntoView({ behavior: report.followUpAnswer ? "auto" : "smooth", block: "start" });
    if (report.followUpAnswer) target?.focus({ preventScroll: true });
  }, [report]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setSelectedEvidence(null); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);

  function update<K extends keyof ResearchInput>(key: K, value: ResearchInput[K]) { setInput(previous => ({ ...previous, [key]: value })); setPlan(null); setReport(null); setError(""); }
  function toggleDimension(dimension: Dimension) {
    if (dimension === "structure" || dimension === "breadth") return;
    update("dimensions", input.dimensions.includes(dimension) ? input.dimensions.filter(x => x !== dimension) : [...input.dimensions, dimension]);
  }
  function openEvidence(id: string) {
    drawerOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelectedEvidence(report?.evidence.find(x => x.id === id) || null);
  }

  async function requestJson(url: string, body: ResearchInput) {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(typeof json.error === "string" ? json.error : `请求失败：HTTP ${response.status}`);
    return json;
  }
  async function makePlan() {
    setError(""); setBusy(true); setStep("正在整理取数计划");
    try { const result = await requestJson("/api/plan", input); setPlan(result.plan as PlanItem[]); }
    catch (e) { setError(e instanceof Error ? e.message : "计划生成失败"); }
    finally { setBusy(false); setStep(""); }
  }
  async function runResearch(question = input.question, isFollowUp = false) {
    setError(""); setBusy(true); setStep("正在核对数据与来源");
    if (!isFollowUp) setReport(null);
    try {
      const nextInput = { ...input, question };
      const result = await requestJson(isFollowUp ? "/api/follow-up" : "/api/research", nextInput) as unknown as Report;
      setReport(result); setInput(nextInput); setFollowUp("");
    } catch (e) { setError(e instanceof Error ? e.message : "研判失败"); }
    finally { setBusy(false); setStep(""); }
  }

  return <main>
    <header className="topbar"><div className="container topbar-inner"><a href="#top" className="brand" aria-label="盘面坐标首页"><span className="brand-mark" aria-hidden="true"><i></i><i></i></span><span>盘面坐标</span></a><div className="topbar-right"><span className="eyebrow">A 股市场研究台</span><span className={`connection ${health?.fuyao === "configured" ? "connected" : ""}`}>{health?.fuyao === "configured" ? "实时数据已配置" : "实时数据未配置"}</span></div></div></header>

    <div id="top" className="container">
      <section className="intro" aria-labelledby="intro-title"><div><p className="eyebrow intro-kicker">MARKET RESEARCH / 证据优先</p><h1 id="intro-title">今天的市场，<br/><em>有哪些证据？</em></h1><p className="intro-copy">从行情结构、参与度与风格分化出发，把事实、归纳和仍需观察的条件放在同一张研究纸上。</p></div><div className="intro-aside"><div className="aside-line"><span>研究对象</span><strong>A 股</strong></div><div className="aside-line"><span>交付方式</span><strong>结论 → 原始字段</strong></div><div className="aside-line"><span>边界</span><strong>不提供交易建议</strong></div></div></section>

      <section className="research-form" aria-labelledby="form-title"><div className="section-header"><div><p className="eyebrow">01 / 提出问题</p><h2 id="form-title">开始一次市场研判</h2></div><span className="small-note">Asia/Shanghai · 数据时点以证据为准</span></div>
        <div className="form-grid"><label>研究指数<select value={input.indexCode} onChange={e => update("indexCode", e.target.value as ResearchInput["indexCode"])}>{Object.entries(INDEX_LABELS).map(([code, name]) => <option value={code} key={code}>{name}</option>)}</select></label><label>观察窗口<select value={input.tradingDays} onChange={e => update("tradingDays", Number(e.target.value) as ResearchInput["tradingDays"])}><option value={5}>近 5 个交易日</option><option value={20}>近 20 个交易日</option><option value={60}>近 60 个交易日</option></select></label><div className="mode-control"><span>数据来源</span><strong>扶摇金融数据 API · iFinD MCP</strong></div></div>
        <label className="question-label">研究问题<textarea value={input.question} maxLength={200} onChange={e => update("question", e.target.value)} rows={3} placeholder="例如：指数与上涨家数是否分化？" /></label>
        <p className="mode-hint">{health?.fuyao === "configured" ? "系统通过真实接口取数；缺失、过期或部分覆盖会如实标记。" : "服务端尚未配置扶摇密钥；可以查看计划，暂时无法生成真实研判。"}</p>
        <div className="form-footer"><button type="button" className="button-secondary" onClick={makePlan} disabled={busy}>查看取数计划</button><button type="button" className="button-primary" onClick={() => runResearch()} disabled={busy}>{busy ? step : "生成研判"}<span aria-hidden="true">↗</span></button></div>
        {error && <div role="alert" className="error-box"><strong>暂时无法完成</strong><p>{error}</p></div>}
      </section>

      {plan && <section className="plan-panel" aria-labelledby="plan-title"><div className="section-header"><div><p className="eyebrow">02 / 取数计划</p><h2 id="plan-title">先看系统准备查什么</h2></div><span className="small-note">核心维度保持开启，其他维度可调整</span></div><div className="plan-list">{plan.map(item => <label className={`plan-row ${item.available ? "" : "unavailable"}`} key={item.dimension}><input type="checkbox" checked={input.dimensions.includes(item.dimension)} disabled={item.dimension === "structure" || item.dimension === "breadth"} onChange={() => toggleDimension(item.dimension)} /><span className="plan-title">{item.label}<small>{item.source}</small></span><span className="plan-purpose">{item.purpose}</span><span className="plan-status">{item.available ? "可取数" : "暂未接通"}</span></label>)}</div><div className="plan-actions"><button className="button-primary" type="button" onClick={() => runResearch()} disabled={busy}>{busy ? step : "执行这份计划"}<span aria-hidden="true">↗</span></button></div></section>}

      {report && <section id="report" className="report-section" aria-labelledby="report-title"><div className="section-header"><div><p className="eyebrow">03 / 研究结果</p><h2 id="report-title">市场状态卡</h2></div><span className="report-time">生成于 {formatDate(report.generatedAt)}</span></div>
        <div className="report-grid"><article className="state-card"><div className="state-top"><span className="chip">真实接口取数</span><span className="chip light">{report.dataStatus === "partial" ? "部分维度可用" : report.dataStatus === "complete" ? "数据完整" : "核心证据不足"}</span></div><p className="eyebrow state-eyebrow">观察到的市场状态</p><h3>{report.stateLabel}</h3><p className="state-subtitle">置信度：{CONFIDENCE[report.confidence]} <span>· 指证据完备度，不是预测概率</span></p><div className="state-divider"></div><ClaimList title="事实" type="fact" items={report.facts.slice(0, 4)} onOpen={openEvidence} /><ClaimList title="归纳" type="synthesis" items={report.syntheses} onOpen={openEvidence} /><ClaimList title="不确定与边界" type="uncertainty" items={report.uncertainties} onOpen={openEvidence} />{report.contradictions.length > 0 && <ClaimList title="主要矛盾" type="contradiction" items={report.contradictions} onOpen={openEvidence} />}</article>
          <aside className="quality-card"><p className="eyebrow">证据质量 / COVERAGE</p><div className="quality-number"><strong>{report.evidence.filter(x => x.quality === "valid").length}</strong><span>条已核验证据</span></div><div className="quality-rule"></div><ul>{report.confidenceReasons.map((x, i) => <li key={i}>{x}</li>)}</ul><div className="quality-warning"><strong>当前边界</strong><p>{report.warnings.length ? report.warnings.slice(0, 3).join("；") : "所有计划维度均已取得数据。"}</p></div><span className="small-note">AI 解释：{report.explanationMode === "model" ? "模型生成并通过引用校验" : "确定性模板（模型未接通或未通过校验）"}</span></aside></div>
        <div className="conditions"><div><p className="eyebrow">重新评估的条件</p><h3>什么变化会改变这张卡？</h3></div><div>{report.switchConditions.map((x, i) => <p key={i}>{x.text}</p>)}</div></div>
        <section className="evidence-section" aria-labelledby="evidence-title"><div className="section-header"><div><p className="eyebrow">04 / 原始依据</p><h2 id="evidence-title">逐条核对证据</h2></div><span className="small-note">点击卡片查看字段、单位、计算式与来源</span></div><div className="evidence-grid">{DIMENSIONS.map(d => { const items = report.evidence.filter(x => x.dimension === d); const hasValid = items.some(x => x.quality === "valid"); return <div className="dimension-card" key={d}><div className="dimension-heading"><h3>{DIMENSION_LABELS[d]}</h3><span className={`dimension-status ${items.length ? hasValid ? "good" : "partial" : "missing"}`}>{items.length ? hasValid ? "已取得" : "部分覆盖" : "未覆盖"}</span></div>{items.length ? items.map(item => <button type="button" className="evidence-link" onClick={() => openEvidence(item.id)} key={item.id}><span>{item.statement}</span><small>{formatDate(item.observedAt)} · {QUALITY[item.quality]}</small><span aria-hidden="true" className="arrow">↗</span></button>) : <p className="empty-evidence">{report.warnings.find(x => x.startsWith(DIMENSION_LABELS[d])) || "本次没有可核验数据。"}</p>}</div>; })}</div></section>
        <section className="followup-section" aria-labelledby="followup-title">
          <div><p className="eyebrow">05 / 继续研究</p><h2 id="followup-title">沿着证据继续问</h2><p>追问会重新执行服务端研究；不会把网页传回的证据当作真实来源。</p></div>
          <div className="followup-content">
            <div className="followup-suggestions">{report.followUps.map((x, i) => <button type="button" key={i} className="suggestion" onClick={() => setFollowUp(x)}>{x}<span aria-hidden="true">↗</span></button>)}</div>
            <form onSubmit={e => { e.preventDefault(); if (followUp.trim()) runResearch(followUp, true); }}><label htmlFor="follow-up-input">你还想研究什么？</label><div className="followup-input-row"><input id="follow-up-input" value={followUp} onChange={e => setFollowUp(e.target.value)} maxLength={200} placeholder="输入一个可核验的问题" /><button className="button-primary" disabled={busy || !followUp.trim()} type="submit">{busy ? step : "继续研究"}</button></div></form>
            {error && <div role="alert" className="error-box"><strong>追问未完成</strong><p>{error}</p></div>}
            {report.followUpAnswer && <article id="follow-up-answer" className="followup-answer" tabIndex={-1} aria-live="polite"><span className="eyebrow">本轮追问 · {report.followUpAnswer.limited ? "证据有限" : "有据可查"}</span><h3>{report.followUpAnswer.question}</h3><p>{report.followUpAnswer.text}</p><div className="references">{report.followUpAnswer.evidenceIds.map(id => <button type="button" key={id} onClick={() => openEvidence(id)} className="reference">查看证据 {id} ↗</button>)}</div><small>已重新核对本轮数据；回答只使用页面中的证据。</small></article>}
          </div>
        </section>
      </section>}
    </div>
    <footer><div className="container footer-inner"><strong>盘面坐标</strong><p>只分析已取得的证据。产品不提供确定性涨跌预测、收益承诺、仓位或直接买卖建议。</p><span>研究原型 · 数据以页面标注的来源与时点为准</span></div></footer>

    {selectedEvidence && <div className="drawer-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setSelectedEvidence(null); }}><aside className="evidence-drawer" role="dialog" aria-modal="true" aria-label="证据详情"><div className="drawer-top"><span className="eyebrow">EVIDENCE / 原始依据</span><button type="button" ref={drawerClose} onClick={() => setSelectedEvidence(null)} aria-label="关闭证据详情" className="drawer-close">×</button></div><div className="drawer-scroll"><span className="drawer-id">{selectedEvidence.id}</span><h2>{selectedEvidence.statement}</h2><div className="drawer-meta"><span>{QUALITY[selectedEvidence.quality]}</span><span>{DIMENSION_LABELS[selectedEvidence.dimension]}</span></div><dl><div><dt>数值 / 单位</dt><dd>{selectedEvidence.value ?? "无"} {selectedEvidence.unit}</dd></div><div><dt>统计口径</dt><dd>{selectedEvidence.metric}</dd></div><div><dt>原始数据时点</dt><dd>{formatDate(selectedEvidence.observedAt)}</dd></div><div><dt>本次取数时间</dt><dd>{formatDate(selectedEvidence.fetchedAt)}</dd></div><div><dt>来源</dt><dd>{selectedEvidence.source.provider}<br/>{selectedEvidence.source.endpoint}</dd></div><div><dt>请求追踪 ID</dt><dd>{selectedEvidence.source.requestId || "未提供"}</dd></div>{selectedEvidence.formula && <div><dt>计算式</dt><dd className="mono">{selectedEvidence.formula}</dd></div>}</dl><h3>原始字段摘要</h3><pre>{JSON.stringify(selectedEvidence.rawFields, null, 2)}</pre>{selectedEvidence.source.url && <a className="source-link" href={selectedEvidence.source.url} target="_blank" rel="noreferrer">{selectedEvidence.dimension === "event" ? "打开资讯原文 ↗" : "查看数据接口 ↗"}</a>}<p className="drawer-footnote">请求 ID 用于回查服务端原始响应；事件资讯为检索片段，请打开原文核对。</p></div></aside></div>}
  </main>;
}
