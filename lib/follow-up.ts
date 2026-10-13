import { DIMENSION_LABELS, INDEX_LABELS, type Evidence, type FollowUpAnswer, type Report } from "./types";

export function answerFollowUp(question: string, report: Report): FollowUpAnswer {
  const evidence = (id: string) => report.evidence.find(item => item.id === id);
  const answer = (text: string, ids: string[] = [], limited = false): FollowUpAnswer => ({
    question, text, evidenceIds: ids.filter(id => !!evidence(id)), limited
  });
  const unsupported = (dimension: string) => answer(`本轮没有足够的${dimension}证据，暂时不能直接回答。请查看本轮“当前边界”和证据详情。`, [], true);

  if (/风格|指数.*分化|分化.*指数/.test(question)) {
    const item = evidence("style.spread20");
    if (!item) return unsupported("风格指数");
    const changes = item.rawFields.changes;
    const ranked = changes && typeof changes === "object" && !Array.isArray(changes)
      ? Object.entries(changes).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1])).sort((a, b) => b[1] - a[1]) : [];
    const detail = ranked.length >= 2
      ? `${INDEX_LABELS[ranked[0][0] as keyof typeof INDEX_LABELS] || ranked[0][0]}为 ${ranked[0][1].toFixed(2)}%，${INDEX_LABELS[ranked.at(-1)![0] as keyof typeof INDEX_LABELS] || ranked.at(-1)![0]}为 ${ranked.at(-1)![1].toFixed(2)}%。`
      : "";
    return answer(`${item.statement}。${detail}这里只比较已取得同口径日线的样本指数，不代表全部行业或股票。`, [item.id], item.quality !== "valid");
  }

  if (/缺失|不足|覆盖|数据质量/.test(question)) {
    const missing = report.missingDimensions.map(d => DIMENSION_LABELS[d]);
    const partial = [...new Set(report.evidence.filter(item => item.quality !== "valid").map(item => DIMENSION_LABELS[item.dimension]))];
    const detail = [missing.length ? `缺失维度：${missing.join("、")}` : "本轮没有完全缺失的维度", partial.length ? `部分覆盖或过期：${partial.join("、")}` : "其余证据按当前规则可用"].join("；");
    const ids = report.evidence.filter(item => item.id === "structure.change20" || item.id === "breadth.upShare").map(item => item.id);
    return answer(`${detail}。这些缺口可能改变状态置信度；若核心指数或市场宽度失效，产品应停止给出完整状态判断。`, ids, !!missing.length || !!partial.length);
  }

  if (/成交额|流动性|量价/.test(question)) {
    const amount = evidence("liquidity.indexTurnoverRatio");
    const direction = evidence("structure.change20");
    if (!amount || !direction) return unsupported("成交额与指数方向");
    return answer(`${direction.statement}；${amount.statement}。前者是近 20 日价格变化，后者是最近一根日线相对此前 20 根成交额中位数，两者窗口不同，不能仅凭这两个指标断定量价同向或因果关系。`, [direction.id, amount.id], direction.quality !== "valid" || amount.quality !== "valid");
  }

  if (/变化|条件|改变|调整|切换/.test(question)) {
    const condition = report.switchConditions[0];
    return condition ? answer(condition.text, condition.evidenceIds, report.state === "insufficient") : unsupported("状态切换条件");
  }

  if (/估值|市盈率|PE/.test(question)) {
    const item = evidence("valuation.peMedian");
    return item ? answer(`${item.statement}。这只是沪深 300 成分股正 PE 样本的最新快照，不能推断全市场估值分位或投资价值。`, [item.id], item.quality !== "valid") : unsupported("估值");
  }

  if (/情绪|涨停|跌停|炸板/.test(question)) {
    const item = evidence("sentiment.limitPools");
    return item ? answer(`${item.statement}。这是短线情绪旁证，不能替代全市场涨跌家数或判断后续走势。`, [item.id], item.quality !== "valid") : unsupported("短线情绪");
  }

  if (/事件|新闻|政策|宏观/.test(question)) {
    const items = report.evidence.filter((item): item is Evidence => item.dimension === "event");
    if (!items.length) return unsupported("事件资讯");
    return answer(`iFinD 本轮检索到 ${items.length} 条带日期和原文链接的资讯线索。检索片段只能证明报道存在，不能证明事件影响市场的因果关系；请打开原文核对。`, items.map(item => item.id), true);
  }

  if (/历史|阶段|回测/.test(question)) {
    return answer("当前只保存本轮所需的指数日线与快照，尚没有同口径的历史市场宽度序列，因此不能可靠匹配历史同状态阶段。", [], true);
  }

  return answer("当前证据包不能直接回答这个问题。可以询问指数方向、市场宽度、风格差距、成交额、估值、情绪、事件或状态切换条件，系统会给出对应证据。", [], true);
}
