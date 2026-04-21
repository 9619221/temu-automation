/**
 * AI 标题重写器
 * 输入：我的标题 + 头部竞品标题（按销量排序）
 * 输出：补入高频关键词后的完整新标题 + 分析元数据
 */

function buildTitleOptimizerPrompt({
  myTitle,
  competitorTitles,
  site,
  maxLength,
  mustKeepWords,
  primaryNeed,
  category,
}) {
  const siteLabel = site || "UK";
  const keepLine = (mustKeepWords && mustKeepWords.length)
    ? mustKeepWords.join(", ")
    : "无（可自由改写）";
  const needLine = primaryNeed ? `\n市场主需求：${primaryNeed}` : "";
  const categoryLine = category ? `\n类目：${category}` : "";

  return `你是 Temu ${siteLabel} 站资深运营总监，任务是重写商品标题以提升搜索权重与点击率。

【我的当前标题】
${String(myTitle || "").trim() || "(空)"}

【头部竞品标题（按销量从高到低）】
${competitorTitles.map((t, i) => `${i + 1}. ${String(t || "").trim()}`).join("\n") || "(无样本)"}
${needLine}${categoryLine}

【任务步骤】
1. 从竞品标题中提取"高频关键词"（出现 >= 3 次或覆盖 >= 30% 样本的词/词组）
2. 识别我的标题"缺失的高价值关键词"
3. 重写一条"新标题"，要求：
   - 长度 <= ${maxLength} 字符（严格，超了立刻删非核心词）
   - **语言规则：和"我的当前标题"保持一致；如果"我的当前标题"为空，则和竞品标题保持一致。中文标题就用中文输出，英文标题就用英文输出，不要混语。**
   - 核心品类词（如"汽车内饰拆卸工具"/"Car Interior Tool"）放最前面
   - 补入 3-5 个缺失的高频关键词
   - 必须保留：${keepLine}
   - 禁止关键词堆砌，要自然可读、符合该语言的母语表达
   - 禁止使用绝对化词：最好 / 第一 / No.1 / Best / #1（广告法禁用）
   - 不要抄袭某一条竞品标题，只借用关键词

【输出格式】
严格输出 JSON，不要 markdown、不要解释：
{
  "optimizedTitle": "重写后的完整标题",
  "length": 字符数（整数）,
  "addedKeywords": ["新增的词1", "新增的词2"],
  "removedKeywords": ["从原标题删掉的冗余词"],
  "topFrequencyWords": [{"word":"car boot","frequency":8},{"word":"foldable","frequency":6}],
  "myMissingHighValue": ["我原标题缺的高价值词"],
  "rationale": "一句话解释为什么这么改（<60 字）"
}`;
}

function parseJsonLoose(text) {
  if (typeof text !== "string") return null;
  const s = text.trim();
  const candidates = [];
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) candidates.push(fenced[1]);
  const braced = s.match(/\{[\s\S]*\}/);
  if (braced) candidates.push(braced[0]);
  candidates.push(s);
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      continue;
    }
  }
  return null;
}

function sanitizeStringArray(value, maxItems = 10) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, maxItems);
}

function sanitizeFrequencyList(value, maxItems = 20) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const word = typeof item.word === "string" ? item.word.trim() : "";
      const freq = Number(item.frequency);
      if (!word || !Number.isFinite(freq) || freq <= 0) return null;
      return { word, frequency: Math.round(freq) };
    })
    .filter(Boolean)
    .slice(0, maxItems);
}

/**
 * 用 Gemini 生成优化后的完整标题
 * @param {Object} params
 * @param {string} params.myTitle - 我的当前标题
 * @param {string[]} params.competitorTitles - 竞品标题数组（按销量从高到低）
 * @param {Object} opts
 * @param {Function} opts.getClient - 返回已构造好的 gemini client（chat.completions.create 接口）
 * @param {string} [opts.model] - 模型名，默认 gemini-2.0-flash
 * @returns {Promise<Object>}
 */
export async function optimizeTitle(params, opts = {}) {
  const {
    myTitle = "",
    competitorTitles = [],
    site = "UK",
    maxLength = 120,
    mustKeepWords = [],
    primaryNeed = "",
    category = "",
  } = params || {};

  const getClient = typeof opts.getClient === "function" ? opts.getClient : null;
  if (!getClient) {
    throw new Error("optimizeTitle 需要传入 opts.getClient 工厂函数");
  }
  const client = getClient();
  if (!client) {
    throw new Error("[AI_API_KEY_MISSING] 未配置 AI API Key，请检查 VECTORENGINE_API_KEY 环境变量");
  }

  const cleanCompetitors = (Array.isArray(competitorTitles) ? competitorTitles : [])
    .map((t) => String(t || "").trim())
    .filter(Boolean)
    .slice(0, 15);

  if (!String(myTitle || "").trim() && cleanCompetitors.length === 0) {
    throw new Error("至少需要「我的标题」或「竞品标题」其中之一");
  }

  const prompt = buildTitleOptimizerPrompt({
    myTitle,
    competitorTitles: cleanCompetitors,
    site,
    maxLength,
    mustKeepWords: Array.isArray(mustKeepWords) ? mustKeepWords.map((w) => String(w || "").trim()).filter(Boolean) : [],
    primaryNeed,
    category,
  });

  const model = opts.model || "gemini-3.1-flash-lite-preview";

  const resp = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: "你是资深跨境电商运营总监，输出严格 JSON。" },
      { role: "user", content: prompt },
    ],
    temperature: 0.4,
    max_tokens: 1500,
  });

  const raw = resp?.choices?.[0]?.message?.content || "";
  const parsed = parseJsonLoose(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("LLM 未返回有效 JSON：" + String(raw).slice(0, 200));
  }

  const optimizedTitle = typeof parsed.optimizedTitle === "string" ? parsed.optimizedTitle.trim() : "";
  if (!optimizedTitle) {
    throw new Error("LLM 返回 JSON 缺少 optimizedTitle 字段");
  }

  return {
    optimizedTitle,
    length: optimizedTitle.length,
    addedKeywords: sanitizeStringArray(parsed.addedKeywords, 15),
    removedKeywords: sanitizeStringArray(parsed.removedKeywords, 15),
    topFrequencyWords: sanitizeFrequencyList(parsed.topFrequencyWords, 20),
    myMissingHighValue: sanitizeStringArray(parsed.myMissingHighValue, 15),
    rationale: typeof parsed.rationale === "string" ? parsed.rationale.trim() : "",
    meta: {
      site,
      maxLength,
      model,
      competitorCount: cleanCompetitors.length,
    },
  };
}
