try {
  importScripts("../data/riskRules.js");
} catch (error) {
  console.error("risk rules import failed", error);
}

const STORAGE_KEYS = {
  rules: "riskRules",
  history: "checkHistory",
  settings: "agentSettings"
};

const REQUIRED_FIELDS = [
  { key: "company", label: "招聘主体", patterns: [/公司/g, /店/g, /机构/g, /商家/g, /门店/g, /家长/g, /学生家长/g] },
  { key: "work", label: "具体工作内容", patterns: [/工作内容/g, /负责/g, /岗位职责/g, /派发/g, /服务员/g, /家教/g, /补习/g, /辅导/g, /语数英/g, /数学/g, /英语/g, /语文/g, /促销/g, /兼职/g, /播音/g, /PPT/g, /会议/g, /会务/g, /讲.*话/g] },
  { key: "salary", label: "薪资标准", patterns: [/(\d+)\s*元/g, /(\d+)\s*[一\/每]?\s*小时/g, /(\d+)\s*元?\s*\/\s*h/gi, /时薪/g, /课时费/g, /日结/g, /周结/g, /月结/g, /工资/g, /薪资/g, /费用/g] },
  { key: "settlement", label: "结算方式", patterns: [/日结/g, /周结/g, /月结/g, /现结/g, /结算/g, /课后结/g, /当次结/g, /一次一结/g, /每次.*结/g, /\d{2,5}\s*\/\s*天/g, /\d{2,5}\s*元?\s*[一每\/]\s*(天|日)/g] },
  { key: "location", label: "工作地点", patterns: [/地点/g, /地址/g, /校内/g, /线上/g, /线下/g, /到店/g, /附近/g, /省/g, /市/g, /区/g, /县/g, /路/g, /号/g] },
  { key: "fee", label: "是否需要额外交费", patterns: [/不收.*费/g, /无需.*费/g, /押金/g, /培训费/g, /保证金/g, /服装费/g, /手续费/g, /资料费/g, /报名费/g] },
  { key: "advance", label: "是否涉及垫付或刷单", patterns: [/刷单/g, /垫付/g, /返利/g, /充值/g, /先付款/g, /任务单/g] }
];

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get([STORAGE_KEYS.rules, STORAGE_KEYS.history]);
  if (!existing[STORAGE_KEYS.rules]) {
    await chrome.storage.local.set({ [STORAGE_KEYS.rules]: DEFAULT_RISK_RULES || [] });
  }
  if (!existing[STORAGE_KEYS.history]) {
    await chrome.storage.local.set({ [STORAGE_KEYS.history]: [] });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => {
      console.error(error);
      sendResponse({ ok: false, error: error.message || "处理失败" });
    });
  return true;
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case "ANALYZE_CURRENT_PAGE":
      return analyzeCurrentPage(message.tabId);
    case "ANALYZE_TEXT":
      return analyzeText(message.payload?.text || "", message.payload?.followUp || "");
    case "SUBMIT_FOLLOWUP":
      return analyzeText(message.payload?.text || "", message.payload?.followUp || "");
    case "OCR_ANALYZE":
      return analyzeImage(message.payload?.image || "");
    case "HIGHLIGHT_RISKS":
      return highlightRisks(message.tabId, message.payload?.keywords || []);
    case "CLEAR_HIGHLIGHTS":
      return clearHighlights(message.tabId);
    case "EXPORT_REPORT":
      return exportReport(message.payload?.report);
    case "GET_HISTORY":
      return getHistory();
    case "DELETE_HISTORY":
      return deleteHistory(message.payload?.id);
    case "CLEAR_HISTORY":
      return clearHistory();
    case "GET_RULES":
      return getRules();
    case "SAVE_RULE":
      return saveRule(message.payload?.rule);
    case "DELETE_RULE":
      return deleteRule(message.payload?.id);
    case "GET_SETTINGS":
      return getSettings();
    case "SAVE_SETTINGS":
      return saveSettings(message.payload || {});
    default:
      return { ok: false, error: "未知消息类型" };
  }
}

async function analyzeCurrentPage(tabId) {
  const textResponse = await sendToTab(tabId, { type: "EXTRACT_PAGE_TEXT" });
  if (!textResponse?.text) {
    return { ok: false, error: "未能读取当前页面文本，请尝试手动粘贴招聘信息。" };
  }
  return analyzeText(textResponse.text, "");
}

async function analyzeImage(imageDataUrl) {
  if (!imageDataUrl) return { ok: false, error: "未收到图片数据" };
  const settings = await getSettings();
  if (!settings.apiKey || !settings.enableApi) {
    return { ok: false, error: "图片识别需要启用大模型（设置中开启）。请先配置 API 后再使用截图识别功能。" };
  }
  try {
    const text = await fetchLLMImageOCR(settings, imageDataUrl);
    return { ok: true, text: text || "" };
  } catch (error) {
    return { ok: false, error: error.message || "图片识别失败" };
  }
}

async function fetchLLMImageOCR(settings, imageDataUrl) {
  const endpoint = settings.endpoint || "https://api.openai.com/v1/chat/completions";
  const model = settings.model || "gpt-4o-mini";
  const prompt = "请识别这张图片中的所有文字，原样输出文本，不要解释、不要添加任何前后缀或代码块标记。如果图片不是招聘信息或无法识别文字，输出空字符串。";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "你是严谨的 OCR 工具，只输出识别到的中文文本，不输出任何解释或额外格式。" },
        { role: "user", content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: imageDataUrl } }
        ]}
      ],
      temperature: 0,
      max_tokens: 2000
    })
  });
  if (!response.ok) {
    throw new Error(`图片识别 API ${response.status}`);
  }
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";
  return content.replace(/^```[\w]*\n?/gm, "").replace(/```$/gm, "").trim();
}

async function analyzeText(rawText, followUpText = "") {
  const text = normalizeText([rawText, followUpText].filter(Boolean).join("\n补充信息：\n"));
  if (!text) {
    return { ok: false, error: "请输入或抓取兼职招聘信息。" };
  }

  const settings = await getSettings();
  const rules = await getEnabledRules();
  const scan = riskScan(text, rules);
  const extracted = await extractInfo(text, true, settings);
  const missing = getMissingFields(extracted);

  if (shouldAskFollowUp(missing, scan)) {
    const followUp = await buildAgentFollowUpQuestions(text, missing, scan, extracted);
    const questions = followUp.questions;
    await saveHistory({
      status: "待补充",
      inputText: rawText,
      followUpText,
      report: null,
      riskLevel: scan.riskLevel,
      score: scan.score,
      hitRisks: scan.hitRisks,
      evidence: scan.evidence,
      questions,
      questionSource: followUp.source,
      conclusion: "Agent 已生成追问，等待用户补充信息。",
      createdAt: new Date().toISOString()
    });
    return {
      ok: true,
      needQuestion: true,
      questions,
      questionSource: followUp.source,
      extracted,
      preliminary: scan,
      originalText: rawText
    };
  }

  const report = await buildFinalReport(text, scan, extracted, missing);
  await saveHistory({
    status: "已完成",
    inputText: rawText,
    followUpText,
    report,
    riskLevel: report.riskLevel,
    score: report.score,
    hitRisks: report.hitRisks,
    evidence: report.evidence,
    conclusion: report.conclusion,
    createdAt: new Date().toISOString()
  });

  return { ok: true, needQuestion: false, report, extracted };
}

function shouldAskFollowUp(missing, scan) {
  if (!missing.length) return false;
  if (scan.riskLevel === "高风险") return false;
  if (scan.score >= 45) return false;
  return true;
}

function riskScan(text, rules) {
  const hitRules = [];
  const evidence = [];
  const matchedKeywords = [];
  let score = 0;

  for (const rule of rules) {
    const matched = [];
    for (const keyword of rule.keywords || []) {
      if (!keyword) continue;
      if (hasNonNegatedKeyword(text, keyword)) {
        matched.push(keyword);
      }
    }
    if (matched.length) {
      score += Number(rule.score || 0);
      hitRules.push({
        id: rule.id,
        category: rule.category,
        name: rule.name,
        score: Number(rule.score || 0),
        matched,
        description: rule.description,
        advice: rule.advice
      });
      matchedKeywords.push(...matched);
      evidence.push(...matched.map((keyword) => findEvidence(text, keyword)));
    }
  }

  const highRiskCategory = hitRules.some((rule) => ["刷单垫付", "先交费用"].includes(rule.category));
  const riskLevel = getRiskLevel(score, highRiskCategory);
  return {
    score,
    riskLevel,
    hitRules,
    hitRisks: [...new Set(hitRules.map((rule) => rule.category))],
    matchedKeywords: [...new Set(matchedKeywords)],
    evidence: [...new Set(evidence)].slice(0, 8),
    scoreBreakdown: hitRules.map((rule) => ({
      category: rule.category,
      name: rule.name,
      score: rule.score,
      matched: rule.matched
    }))
  };
}

function hasNonNegatedKeyword(text, keyword) {
  let start = 0;
  while (start < text.length) {
    const index = text.indexOf(keyword, start);
    if (index < 0) return false;
    if (!isNegatedKeyword(text, index)) return true;
    start = index + keyword.length;
  }
  return false;
}

function isNegatedKeyword(text, keywordIndex) {
  const before = text.slice(Math.max(0, keywordIndex - 12), keywordIndex);
  const after = text.slice(keywordIndex, Math.min(text.length, keywordIndex + 12));
  return /不需要|无需|不收|不用|没有|无|不涉及|不要求|不必/.test(before) || /不需要|无需|不收|不用|没有|无/.test(after);
}

async function extractInfo(text, useLlm = false, settings = null) {
  // LLM 接管信息抽取（带正则兜底）
  if (useLlm && settings?.apiKey && settings?.enableApi) {
    try {
      const llmResult = await fetchLLMExtraction(settings, text);
      if (llmResult && llmResult.jobType) {
        return normalizeLlmExtraction(llmResult, text);
      }
    } catch (error) {
      console.warn("LLM extraction failed, fallback to regex", error);
    }
  }
  return extractInfoByRegex(text);
}

function normalizeLlmExtraction(llmResult, text) {
  // 保留 LLM 抽取的字段，缺失项回退到正则
  const regexResult = extractInfoByRegex(text);
  return {
    jobType: llmResult.jobType || regexResult.jobType,
    durationType: llmResult.durationType || regexResult.durationType,
    company: llmResult.company || regexResult.company,
    work: llmResult.work || regexResult.work,
    salary: llmResult.salary || regexResult.salary,
    settlement: llmResult.settlement || regexResult.settlement,
    location: llmResult.location || regexResult.location,
    fee: llmResult.fee || regexResult.fee,
    advance: llmResult.advance || regexResult.advance,
    contact: regexResult.contact
  };
}

function extractInfoByRegex(text) {
  const jobType = detectJobType(text);
  const noExtraFee = inferNoExtraFee(text);
  const noAdvance = inferNoAdvance(text);
  const extraFeeMatches = noExtraFee ? [] : [...text.matchAll(/押金|保证金|培训费|服装费|手续费|资料费|报名费|入职费|中介费|介绍费|平台费|解冻费/g)].map((m) => m[0]);
  const deductionMatches = [...text.matchAll(/意外险|物资使用费|管理费|工服清洗费/g)].map((m) => m[0]);
  const contactMatches = [...text.matchAll(/微信|QQ|电话|手机号|联系|私聊|加我/g)].map((m) => m[0]);
  return {
    jobType,
    durationType: detectDurationType(text),
    company: extractCompany(text, jobType),
    work: extractWork(text, jobType),
    salary: extractSalary(text),
    settlement: extractSettlement(text),
    location: extractLocation(text),
    fee: extraFeeMatches.length
      ? `存在额外交费词：${[...new Set(extraFeeMatches)].join("、")}`
      : deductionMatches.length
        ? `存在扣费说明：${[...new Set(deductionMatches)].join("、")}`
        : noExtraFee,
    advance: noAdvance || extractAdvance(text),
    contact: contactMatches.length ? [...new Set(contactMatches)].join("、") : ""
  };
}

function extractSalary(text) {
  const matches = [
    ...text.matchAll(/(\d{2,5})\s*元\s*[一每]?\s*(小时|时|天|日|次|单|课时)?/g),
    ...text.matchAll(/(\d{2,5})\s*[一\/每]\s*(小时|时|天|日|次|单|课时)/g),
    ...text.matchAll(/(\d{1,4})\s*元?\s*\/\s*(小时|天|日|h|次)/gi),
    ...text.matchAll(/时薪\s*(\d{1,5})/g),
    ...text.matchAll(/课时费\s*(\d{1,5})/g),
    ...text.matchAll(/日薪\s*(\d{2,5})/g),
    ...text.matchAll(/日入\s*(\d{2,5})/g),
    ...text.matchAll(/月入\s*(\d{3,6})/g)
  ].map((m) => m[0]).filter((s) => /\d/.test(s));
  const unique = [...new Set(matches)];
  if (unique.length) return unique.slice(0, 3).join("、");
  // 工资面议等模糊表达应触发追问，不当作有薪资
  return "";
}

function extractLocation(text) {
  const regionMatches = [...text.matchAll(/[\u4e00-\u9fa5]{2,}(省|市|区|县|路|街|巷|大道|广场)[\u4e00-\u9fa5\d号\-—、~]*\d*号?/g)]
    .map((m) => m[0].trim())
    .filter((s) => s.length >= 3 && !/账号|信号|马路|年龄|周公|孔子|老师/.test(s));
  if (regionMatches.length) return regionMatches.slice(0, 2).join("、");
  if (/纯线上|全程线上|居家完成|无需到店/.test(text)) return "线上";
  if (/必须到店|线下到岗|现场到岗|需要到店/.test(text)) return "线下到岗";
  if (/校内|学校内|校园内/.test(text)) return "校内";
  return "";
}

function extractCompany(text, jobType) {
  const companyMatches = [...text.matchAll(/[\u4e00-\u9fa5A-Za-z0-9]{2,}(公司|店铺|门店|机构|商家|主办方|酒店|学院|大学|部门|集团|中心|工作室)/g)]
    .map((m) => m[0].trim())
    .filter((s) => s.length >= 3);
  if (companyMatches.length) return companyMatches.slice(0, 2).join("、");
  if (jobType === "家教/补习") {
    if (/学生家长|家长|孩子家长/.test(text)) return "已提到家长/家教对象";
    if (/家教机构|家教中心|家教平台/.test(text)) return "已提到家教机构/平台";
    return "";
  }
  if (jobType === "校园助理") {
    if (/老师|教授|辅导员|学院|实验室|图书馆/.test(text)) return "已提到校内招聘主体";
    return "";
  }
  return "";
}

function extractWork(text, jobType) {
  const explicit = [
    ...text.matchAll(/负责[\s:：]*[\u4e00-\u9fa5，、0-9]{2,}/g),
    ...text.matchAll(/工作内容[\s:：]*[\u4e00-\u9fa5，、0-9]{2,}/g),
    ...text.matchAll(/岗位职责[\s:：]*[\u4e00-\u9fa5，、0-9]{2,}/g),
    ...text.matchAll(/主要工作[\s:：]*[\u4e00-\u9fa5，、0-9]{2,}/g)
  ].map((m) => m[0].slice(0, 40)).filter((s) => s.length >= 4);
  if (explicit.length) return explicit.slice(0, 2).join("；");
  if (jobType === "家教/补习") {
    const subject = [...text.matchAll(/语文|数学|英语|物理|化学|生物|历史|地理|政治|语数英/g)].map((m) => m[0]);
    const grade = [...text.matchAll(/\d+\s*年级|小学|初中|高中/g)].map((m) => m[0]);
    const parts = [];
    if (grade.length) parts.push([...new Set(grade)].join("、"));
    if (subject.length) parts.push([...new Set(subject)].join("、"));
    if (parts.length) return `家教补习：${parts.join("，")}`;
    return "";
  }
  if (jobType === "门店服务") {
    const details = [...text.matchAll(/服务员|收银|传菜|后厨|摆台|上菜|收餐具|迎宾|前厅|餐饮|奶茶|咖啡/g)].map((m) => m[0]);
    return details.length ? `门店岗位：${[...new Set(details)].join("、")}` : "";
  }
  if (jobType === "短期活动/会务协助") {
    const details = [...text.matchAll(/会务|会议|签到|接待|礼仪|播音|PPT|主持|宣讲|现场协助/g)].map((m) => m[0]);
    return details.length ? `会务协助：${[...new Set(details)].join("、")}` : "";
  }
  if (jobType === "活动充场/气氛组") {
    const details = [...text.matchAll(/充场|气氛组|暖场|捧场|凑人气|坐着玩|鼓掌/g)].map((m) => m[0]);
    return details.length ? `充场/气氛：${[...new Set(details)].join("、")}` : "";
  }
  if (jobType === "地推促销") {
    const details = [...text.matchAll(/派发|传单|地推|促销|拉新|推广/g)].map((m) => m[0]);
    return details.length ? `地推/促销：${[...new Set(details)].join("、")}` : "";
  }
  if (jobType === "配送/跑腿") {
    const details = [...text.matchAll(/外卖|配送|跑腿|送餐|骑手|快递|分拣/g)].map((m) => m[0]);
    return details.length ? `配送：${[...new Set(details)].join("、")}` : "";
  }
  if (jobType === "线上兼职") {
    const details = [...text.matchAll(/打字|录入|客服|点赞|看视频|刷销量|刷好评|代付/g)].map((m) => m[0]);
    return details.length ? `线上任务：${[...new Set(details)].join("、")}` : "";
  }
  // 单独"PPT""助理"等词不足以确认工作内容，不返回
  return "";
}

function extractSettlement(text) {
  const matches = [...text.matchAll(/日结|当日结|当天结|现结|当场结|一次一结|每次结|课后结|周结|月结|结算|结清/g)].map((m) => m[0]);
  const periodMatches = [...text.matchAll(/(\d{2,5})\s*元?\s*[一每\/]\s*(天|日|小时|h)/gi)].map((m) => m[0]);
  const all = [...new Set([...matches, ...periodMatches])];
  return all.length ? all.slice(0, 2).join("、") : "";
}

function extractAdvance(text) {
  const matches = [...text.matchAll(/刷单|做单|任务单|垫付|充值|返利|先付款|解冻|拉人|转账任务|代付|代炒/g)].map((m) => m[0]);
  return matches.length ? `已提到：${[...new Set(matches)].join("、")}` : "";
}

function detectJobType(text) {
  if (/充场|气氛组|暖场|捧场|凑人气|坐着玩|鼓掌|节目结束|可以不喝酒|酒水|酒吧|清吧|KTV|夜场|会所/.test(text)) return "活动充场/气氛组";
  if (/会务|会议|酒店|展会|会展|活动执行|现场协助|签到|接待|礼仪|播音|PPT|讲.*话|主持|宣讲/.test(text)) return "短期活动/会务协助";
  if (/家教|补习|辅导|课时|学生|年级|语数英|数学|英语|语文|物理|化学/.test(text)) return "家教/补习";
  if (/服务员|收银|传菜|餐饮|奶茶|咖啡|门店|礼宴|摆台|上菜|传菜|收餐具|会场布置/.test(text)) return "门店服务";
  if (/派发|传单|地推|促销/.test(text)) return "地推促销";
  if (/外卖|配送|跑腿|送餐|骑手|快递|分拣/.test(text)) return "配送/跑腿";
  if (/助教|助理|图书馆|实验室|校园|勤工助学|行政|录入/.test(text)) return "校园助理";
  if (/线上|手机操作|任务|打字|录入/.test(text)) return "线上兼职";
  return "未明确";
}

function detectDurationType(text) {
  if (/临时|短期|兼职一天|一天|两天|任选一天|任意一天|做一天|只做一天|日结|当日结|\d{1,2}\s*[.月]\s*\d{1,2}\s*号?|9月\d+|本周|周末|明天|后天|\d{1,2}[:：]\d{2}\s*[-—~到至]\s*\d{1,2}[:：]\d{2}/.test(text)) {
    return "短期/临时";
  }
  if (/长期|每周|周一到周五|周一到周四|长期工作|稳定/.test(text)) return "长期/固定";
  return "未明确";
}

function inferNoExtraFee(text) {
  if (/不收.*费|无需.*费|无.*押金|不用.*交费|不需要.*交费|没有.*费用|不需要.*中介费|不收.*中介费|无.*中介费|不需要.*介绍费|不收.*介绍费|不需要.*资料费/.test(text)) return "明确说明无需额外交费";
  return "";
}

function inferNoAdvance(text) {
  if (/不.*垫付|无需.*垫付|不需要.*垫付|没有.*垫付|不.*预付|无需.*预付|不需要.*预付|不.*刷单|不涉及.*刷单|无需.*充值|不需要.*充值|不用.*转账/.test(text)) {
    return "明确说明不需要预付、垫付或异常资金操作";
  }
  return "";
}

function getMissingFields(extracted) {
  return REQUIRED_FIELDS.filter((field) => !extracted[field.key]);
}

function buildFollowUpQuestions(missing, scan, extracted = {}) {
  const contextual = buildContextualFollowUpQuestions(missing, scan, extracted);
  if (contextual.length) return mergeRiskQuestions(scan, extracted, contextual);

  const questionMap = {
    company: "招聘信息是否说明了公司、店铺、机构或联系人身份？是否能查到真实主体？",
    work: "具体工作内容是什么？是否只是笼统描述为“简单任务”？",
    salary: "薪资标准是多少？是按小时、按天还是按任务计算？",
    settlement: "工资如何结算？日结、周结还是月结？是否有书面说明？",
    location: "工作地点在哪里？是线上还是线下？是否要求到指定地点面试？",
    fee: "是否需要缴纳押金、培训费、服装费、资料费或其他费用？",
    advance: "是否涉及刷单、垫付、充值、返利、拉人或转账任务？"
  };
  const questions = missing.slice(0, 5).map((field) => questionMap[field.key]);
  if (scan.hitRisks.includes("信息模糊") && !questions.includes(questionMap.work)) {
    questions.push(questionMap.work);
  }
  return [...new Set(questions)].slice(0, 5);
}

function mergeRiskQuestions(scan, extracted, contextual) {
  const categories = new Set(scan.hitRisks);
  const riskQuestions = [];
  if (categories.has("先交费用")) {
    riskQuestions.push("请确认对方要求缴纳费用的名称、金额、收款方和退款条件。");
  }
  if (categories.has("扣费说明")) {
    riskQuestions.push("请确认保险费、物资使用费等扣费是否强制，是否会在工资结算单中列明。");
  }
  if (categories.has("刷单垫付") && extracted.jobType === "线上兼职") {
    riskQuestions.push("请确认是否涉及刷单、充值、返利、拉人或转账任务。");
  }
  if (categories.has("隐私索取")) {
    riskQuestions.push("请确认对方索要敏感信息的用途，并避免提供验证码、银行卡等信息。");
  }
  if (categories.has("工作边界") && extracted.jobType !== "活动充场/气氛组") {
    riskQuestions.push("请确认实际工作边界，是否存在原文未写明的陪酒、营销、拉客或强制消费要求。");
  }
  if (categories.has("现场安全") && extracted.jobType !== "活动充场/气氛组") {
    riskQuestions.push("请确认现场负责人、结束时间、返程安排和突发情况联系方式。");
  }
  return [...new Set([...riskQuestions, ...contextual])].slice(0, 6);
}

function buildContextualFollowUpQuestions(missing, scan, extracted) {
  const missingKeys = new Set(missing.map((field) => field.key));
  switch (extracted.jobType) {
    case "家教/补习":
      return buildTutorFollowUpQuestions(missingKeys, extracted);
    case "门店服务":
      return buildStoreFollowUpQuestions(missingKeys, extracted);
    case "地推促销":
      return buildPromotionFollowUpQuestions(missingKeys, extracted);
    case "配送/跑腿":
      return buildDeliveryFollowUpQuestions(missingKeys, extracted);
    case "校园助理":
      return buildCampusFollowUpQuestions(missingKeys, extracted);
    case "线上兼职":
      return buildOnlineFollowUpQuestions(missingKeys, scan, extracted);
    case "活动充场/气氛组":
      return buildAtmosphereFollowUpQuestions(missingKeys, extracted);
    case "短期活动/会务协助":
      return buildEventSupportFollowUpQuestions(missingKeys, extracted);
    default:
      return [];
  }
}

function buildTutorFollowUpQuestions(missingKeys, extracted) {
  const questions = [];
  if (missingKeys.has("company")) {
    questions.push("请确认发布者身份：是学生家长、家教机构，还是中介？是否能核实联系方式？");
  }
  if (missingKeys.has("settlement")) {
    questions.push("请确认家教费用如何结算：每次课后结、周结还是月结？是否会拖欠？");
  }
  if (missingKeys.has("fee")) {
    questions.push("请确认是否需要向中介或平台缴纳介绍费、押金、资料费等额外费用？");
  }
  if (missingKeys.has("advance")) {
    questions.push("请确认是否要求提前转账、垫付资料费，或先购买课程/教材？");
  }
  if (!extracted.contact) {
    questions.push("请确认联系渠道是否可靠，是否只通过私人账号沟通？");
  }
  questions.push("请确认上课地点是否安全、是否允许先线上沟通或与同学结伴首次见面？");
  return [...new Set(questions)].slice(0, 5);
}

function buildStoreFollowUpQuestions(missingKeys, extracted) {
  const questions = [];
  if (missingKeys.has("company")) questions.push("请确认门店名称和具体招聘主体，是否能在线下找到该门店？");
  if (missingKeys.has("work")) questions.push("请确认具体岗位：服务员、收银、后厨、传菜还是促销？");
  if (missingKeys.has("salary")) questions.push("请确认时薪或日薪标准，是否包含提成、餐补或扣款规则？");
  if (missingKeys.has("settlement")) questions.push("请确认工资结算方式：日结、周结还是月结，离职时如何结清？");
  if (missingKeys.has("fee")) questions.push("请确认是否需要缴纳服装费、工牌费、培训费或押金等额外费用？");
  if (extracted.durationType === "短期/临时") {
    questions.push("请确认具体班次、集合地点、负责人联系方式，以及下班后小程序日结是否能现场确认。");
  } else {
    questions.push("请确认排班时间、是否存在试岗/试用安排，以及是否签订兼职协议。");
  }
  return [...new Set(questions)].slice(0, 5);
}

function buildPromotionFollowUpQuestions(missingKeys, extracted) {
  const questions = [];
  if (missingKeys.has("company")) questions.push("请确认活动主办方或派单方名称，是否有明确负责人？");
  if (missingKeys.has("location")) questions.push("请确认地推或促销地点，是否需要到陌生地点集合？");
  if (missingKeys.has("salary")) questions.push("请确认工资是按小时、按天还是按发单量计算？");
  if (missingKeys.has("settlement")) questions.push("请确认结算时间，以及未达到数量是否会扣工资？");
  if (missingKeys.has("fee")) questions.push("请确认是否需要缴纳物料押金、服装费或报名费？");
  questions.push("请确认工作时长、休息安排和现场负责人联系方式。");
  return [...new Set(questions)].slice(0, 5);
}

function buildDeliveryFollowUpQuestions(missingKeys, extracted) {
  const questions = [];
  if (missingKeys.has("company")) questions.push("请确认平台或站点名称，是否为正规配送站点招聘？");
  if (missingKeys.has("work")) questions.push("请确认具体工作是外卖配送、快递分拣、跑腿还是站点辅助？");
  if (missingKeys.has("salary")) questions.push("请确认薪资是按单、按小时还是按天计算，是否有最低单量要求？");
  if (missingKeys.has("fee")) questions.push("请确认是否需要缴纳装备押金、车辆押金、保险费或培训费？");
  questions.push("请确认交通工具、保险责任、工作区域和安全保障。");
  return [...new Set(questions)].slice(0, 5);
}

function buildCampusFollowUpQuestions(missingKeys, extracted) {
  const questions = [];
  if (missingKeys.has("company")) questions.push("请确认招聘主体是学校部门、老师、实验室，还是校外中介？");
  if (missingKeys.has("work")) questions.push("请确认具体工作内容：资料整理、值班、助教、实验室协助还是信息录入？");
  if (missingKeys.has("salary")) questions.push("请确认补贴或工资标准，以及是否通过学校渠道发放？");
  if (missingKeys.has("settlement")) questions.push("请确认结算周期和考勤方式。");
  questions.push("请确认是否占用上课时间，是否需要老师或学院确认。");
  return [...new Set(questions)].slice(0, 5);
}

function buildOnlineFollowUpQuestions(missingKeys, scan, extracted) {
  const questions = [];
  if (missingKeys.has("company")) questions.push("请确认线上兼职的招聘主体或平台名称，是否能查到真实信息？");
  if (missingKeys.has("work")) questions.push("请确认具体线上工作内容，不要只接受“简单任务”“手机操作”等模糊描述。");
  if (missingKeys.has("salary")) questions.push("请确认薪资按小时、按任务还是按单结算，是否有明确标准？");
  if (missingKeys.has("fee")) questions.push("请确认是否需要缴纳押金、培训费、资料费、解冻费等任何费用？");
  if (missingKeys.has("advance") || scan.hitRisks.includes("刷单垫付")) questions.push("请确认是否涉及刷单、垫付、充值、返利、拉人或转账任务？");
  questions.push("请确认是否要求提供验证码、银行卡、身份证照片等敏感信息。");
  return [...new Set(questions)].slice(0, 5);
}

async function buildAgentFollowUpQuestions(text, missing, scan, extracted) {
  const fallback = buildFollowUpQuestions(missing, scan, extracted);
  const settings = await getSettings();
  if (!settings.apiKey || !settings.enableApi) {
    return { questions: guardQuestions(fallback, text, extracted, fallback), source: "local" };
  }

  try {
    const aiQuestions = await fetchLLMFollowUp(settings, text, scan, extracted, missing, fallback);
    const questions = sanitizeQuestions(aiQuestions, fallback, text, extracted);
    return { questions, source: "api" };
  } catch (error) {
    console.warn("LLM follow-up failed, fallback to local questions", error);
    return { questions: guardQuestions(fallback, text, extracted, fallback), source: "local-fallback" };
  }
}

function buildAtmosphereFollowUpQuestions(missingKeys, extracted) {
  const questions = [];
  if (missingKeys.has("company")) questions.push("请确认活动场所、门店或主办方名称，是否能查到真实主体和负责人？");
  questions.push("请确认工作边界：是否只负责充场、鼓掌、营造氛围，是否涉及陪酒、营销酒水、拉客或强制消费？");
  questions.push("请确认酒水是否完全自愿，是否存在必须饮酒、陪同消费或额外消费要求？");
  if (missingKeys.has("settlement") || missingKeys.has("salary")) questions.push("请确认30~60元/人的工资按什么时间标准计算，何时结算，是否会因迟到、提前离场或表现被扣款？");
  if (missingKeys.has("location")) questions.push("请确认具体活动地址、集合位置、结束时间和返程安排。");
  if (missingKeys.has("fee")) questions.push("请确认是否需要押金、报名费、入场费、服装费或其他提前收费。");
  questions.push("请确认现场负责人联系方式，以及遇到临时变更或安全问题时找谁处理。");
  return [...new Set(questions)].slice(0, 6);
}

function buildEventSupportFollowUpQuestions(missingKeys, extracted) {
  const questions = [];
  if (missingKeys.has("company")) questions.push("请确认活动主办方、酒店对接人或招聘方身份，是否能核实真实负责人？");
  if (missingKeys.has("fee")) questions.push("请确认是否需要押金、服装费、设备费、报名费或其他提前收费。");
  if (missingKeys.has("advance")) questions.push("请确认是否需要自己先垫付交通、物料、设备或其他费用。");
  questions.push("请确认130元/天是否为当天完整工资，包餐是否会折抵工资，迟到或提前结束是否扣款。");
  questions.push("请确认是否只负责PPT播放、播音和简单宣讲，是否有额外销售、拉人、推销或临时加班要求。");
  questions.push("请确认到岗地点、联系人、考勤方式，以及活动结束后工资发放时间。");
  return [...new Set(questions)].slice(0, 6);
}

async function buildFinalReport(text, scan, extracted, missing) {
  const baseReport = {
    riskLevel: scan.riskLevel,
    score: scan.score,
    hitRisks: scan.hitRisks,
    hitRules: scan.hitRules,
    evidence: scan.evidence,
    matchedKeywords: scan.matchedKeywords,
    scoreBreakdown: scan.scoreBreakdown,
    missingFields: missing.map((field) => getFieldLabelByJobType(field.key, extracted.jobType)),
    advice: buildAdvice(scan, missing, extracted),
    confirmQuestions: buildConfirmQuestions(scan, missing, extracted),
    conclusion: buildConclusion(scan, missing)
  };

  const settings = await getSettings();
  if (!settings.apiKey || !settings.enableApi) {
    return {
      ...baseReport,
      agentSummary: buildLocalSummary(baseReport)
    };
  }

  try {
    const aiText = await fetchLLM(settings, text, baseReport, extracted);
    return {
      ...baseReport,
      agentSummary: aiText || buildLocalSummary(baseReport)
    };
  } catch (error) {
    console.warn("LLM failed, fallback to local report", error);
    return {
      ...baseReport,
      agentSummary: buildLocalSummary(baseReport),
      apiError: "大模型调用失败，已使用本地规则生成报告。"
    };
  }
}

function buildAdvice(scan, missing, extracted = {}) {
  const advice = [];
  for (const rule of scan.hitRules) {
    if (rule.advice) advice.push(rule.advice);
  }
  if (missing.length) {
    advice.push("在继续联系前，补充确认缺失信息：" + missing.map((field) => getFieldLabelByJobType(field.key, extracted.jobType)).join("、") + "。");
  }
  if (!advice.length) {
    advice.push("当前文本未命中明显高危规则，但仍建议核实招聘主体、工作内容和薪资结算方式。");
  }
  return [...new Set(advice)].slice(0, 6);
}

function buildConclusion(scan, missing) {
  if (scan.riskLevel === "高风险") {
    return "该兼职信息存在较高风险，不建议在未核实前继续联系，尤其不要缴费、垫付或提供验证码等敏感信息。";
  }
  if (scan.riskLevel === "中风险") {
    return "该兼职信息存在一定疑点，建议补充核实招聘主体、工作内容、薪资结算和是否收费后再决定。";
  }
  if (missing.length >= 3) {
    return "当前未命中明显高危词，但信息不完整，建议补充关键条件后再判断。";
  }
  return "当前文本未发现明显高危风险，但仍应保留聊天记录并核实招聘方身份。";
}

function buildLocalSummary(report) {
  const risks = report.hitRisks.length ? report.hitRisks.join("、") : "未命中明显高危类别";
  const evidence = report.evidence.length ? report.evidence.join("；") : "暂无明显风险证据片段";
  return [
    `风险等级：${report.riskLevel}，综合评分：${report.score}分。`,
    `命中风险：${risks}。`,
    `证据片段：${evidence}。`,
    `建议追问：${(report.confirmQuestions || []).join("；")}`,
    `建议：${report.advice.join("；")}`,
    `结论：${report.conclusion}`
  ].join("\n");
}

function buildConfirmQuestions(scan, missing, extracted = {}) {
  const contextual = buildContextualFollowUpQuestions(missing, scan, extracted);
  if (contextual.length) {
    const riskQuestions = [];
    const categories = new Set(scan.hitRisks);
    if (categories.has("先交费用")) riskQuestions.push("请确认对方要求缴纳费用的名称、金额、收款方和退款条件。");
    if (categories.has("刷单垫付") && extracted.jobType === "线上兼职") riskQuestions.push("请确认是否涉及刷单、充值、返利、拉人或转账任务。");
    if (categories.has("扣费说明")) riskQuestions.push("请确认保险费、物资使用费等扣费是否强制，是否会在工资结算单中列明。");
    if (categories.has("隐私索取")) riskQuestions.push("请确认对方索要敏感信息的用途，并避免提供验证码、银行卡等信息。");
    if (categories.has("工作边界") && extracted.jobType !== "活动充场/气氛组") riskQuestions.push("请确认实际工作边界，是否存在原文未写明的陪酒、营销、拉客或强制消费要求。");
    if (categories.has("现场安全") && extracted.jobType !== "活动充场/气氛组") riskQuestions.push("请确认现场负责人、结束时间、返程安排和突发情况联系方式。");
    return [...new Set([...riskQuestions, ...contextual])].slice(0, 6);
  }

  const questions = [];
  const categories = new Set(scan.hitRisks);
  if (categories.has("先交费用")) questions.push("请确认招聘方要求缴纳的费用名称、金额、收款方和退款条件是什么？");
  if (categories.has("刷单垫付")) questions.push("请确认工作是否涉及刷单、充值、购物垫付、返利或转账任务？");
  if (categories.has("扣费说明")) questions.push("请确认保险费、物资使用费或管理费是否强制扣除，是否有明细凭证？");
  if (categories.has("薪资异常")) questions.push("请确认薪资计算方式、结算周期，以及是否有书面说明？");
  if (categories.has("隐私索取")) questions.push("请确认为什么需要身份证、银行卡、验证码等敏感信息，是否可以拒绝提供？");
  if (categories.has("用工不规范")) questions.push("请确认是否签订兼职协议，工资标准和结算时间是否明确？");
  if (categories.has("工作边界")) questions.push("请确认实际工作边界是否清楚，是否存在陪酒、营销、拉客或强制消费要求？");
  if (categories.has("现场安全")) questions.push("请确认现场负责人、结束时间、返程安排和突发情况联系方式。");
  for (const field of missing.slice(0, 3)) {
    questions.push(`请补充确认：${getFieldLabelByJobType(field.key, extracted.jobType)}。`);
  }
  if (!questions.length) questions.push("请再次核实招聘主体、具体工作内容、工资结算方式和是否需要缴费。");
  return [...new Set(questions)].slice(0, 6);
}

function getFieldLabelByJobType(key, jobType) {
  const labels = {
    "家教/补习": {
      company: "发布者身份或家教机构信息",
      work: "补习年级、科目和学生基础",
      salary: "课时费标准",
      settlement: "课时费结算方式",
      location: "上课地点",
      fee: "是否需要中介费、押金或资料费",
      advance: "是否需要预付、垫付或购买资料"
    },
    "门店服务": {
      company: "门店名称或招聘主体",
      work: "具体门店岗位",
      salary: "时薪或日薪标准",
      settlement: "工资结算方式",
      location: "门店地址",
      fee: "是否需要服装费、工牌费或押金",
      advance: "是否需要垫付物料或提前转账"
    },
    "地推促销": {
      company: "活动主办方或派单方",
      work: "地推/促销具体任务",
      salary: "计时或计件工资标准",
      settlement: "结算时间和扣款规则",
      location: "集合地点和工作区域",
      fee: "是否需要物料押金或报名费",
      advance: "是否需要垫付物料费用"
    },
    "配送/跑腿": {
      company: "平台或站点名称",
      work: "配送、跑腿或分拣具体内容",
      salary: "按单/按小时/按天的薪资标准",
      settlement: "工资结算方式",
      location: "工作区域或站点地址",
      fee: "是否需要装备押金、车辆押金或保险费",
      advance: "是否需要垫付装备或订单费用"
    },
    "校园助理": {
      company: "学校部门、老师或实验室主体",
      work: "助理岗位具体工作内容",
      salary: "补贴或工资标准",
      settlement: "补贴发放和考勤方式",
      location: "工作地点",
      fee: "是否存在额外费用",
      advance: "是否需要预付或垫付费用"
    },
    "线上兼职": {
      company: "线上平台或招聘主体",
      work: "具体线上任务内容",
      salary: "线上任务薪资标准",
      settlement: "线上任务结算方式",
      location: "线上工作平台或沟通渠道",
      fee: "是否需要押金、培训费、资料费或解冻费",
      advance: "是否涉及刷单、垫付、充值或返利"
    },
    "活动充场/气氛组": {
      company: "活动场所、门店或主办方身份",
      work: "充场工作边界",
      salary: "充场工资标准",
      settlement: "工资结算时间和扣款规则",
      location: "活动场所地址和返程安排",
      fee: "是否需要押金、报名费、入场费或强制消费",
      advance: "是否需要预付、垫付或现场消费"
    },
    "短期活动/会务协助": {
      company: "活动主办方、酒店对接人或招聘方身份",
      work: "会务协助具体工作边界",
      salary: "当天工资标准和扣款规则",
      settlement: "当天工资发放时间",
      location: "到岗地点、联系人和考勤方式",
      fee: "是否需要押金、服装费、设备费或报名费",
      advance: "是否需要垫付交通、物料或设备费用"
    }
  };
  const generic = {
    company: "招聘主体",
    work: "具体工作内容",
    salary: "薪资标准",
    settlement: "结算方式",
    location: "工作地点",
    fee: "是否需要额外交费",
    advance: "是否需要垫付、预付或异常资金操作"
  };
  return labels[jobType]?.[key] || generic[key] || key;
}

async function fetchLLM(settings, text, report, extracted) {
  const endpoint = settings.endpoint || "https://api.openai.com/v1/chat/completions";
  const model = settings.model || "gpt-4o-mini";
  const prompt = `你是面向大学生的兼职岗位风险检查Agent。请基于规则检测结果生成中文风险报告，不能编造原文没有的信息。\n\n招聘文本：\n${text.slice(0, 6000)}\n\n规则检测结果：\n${JSON.stringify(report, null, 2)}\n\n提取信息：\n${JSON.stringify(extracted, null, 2)}\n\n请输出：风险等级、主要疑点、证据片段、建议追问、结论建议。`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "你是严谨、简洁的兼职岗位风险检查Agent。" },
        { role: "user", content: prompt }
      ],
      temperature: 0.2
    })
  });
  if (!response.ok) {
    throw new Error(`API ${response.status}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

async function fetchLLMExtraction(settings, text) {
  const endpoint = settings.endpoint || "https://api.openai.com/v1/chat/completions";
  const model = settings.model || "gpt-4o-mini";
  const prompt = [
    "你是兼职岗位信息抽取器。请从招聘文本中抽取结构化字段，只输出 JSON 对象，不要输出任何解释或前后缀。",
    "字段定义：",
    "- jobType: 岗位类型，从 [活动充场/气氛组, 短期活动/会务协助, 家教/补习, 门店服务, 地推促销, 配送/跑腿, 校园助理, 线上兼职, 未明确] 中选一个",
    "- durationType: 用工时长类型，从 [短期/临时, 长期/固定, 未明确] 中选一个",
    "- company: 招聘主体名称（公司/店铺/机构/家长/学校部门等具体名称），原文未明确则为空字符串",
    "- work: 具体工作内容描述，原文未明确则为空字符串",
    "- salary: 薪资标准（金额+周期），原文未明确则为空字符串",
    "- settlement: 结算方式（日结/周结/月结等），原文未明确则为空字符串",
    "- location: 工作地点或线上/线下形式，原文未明确则为空字符串",
    "- fee: 是否涉及押金/培训费/服装费等额外交费。明确说明有则填具体描述；明确说明无则填'明确说明无需额外交费'；未提及则为空字符串",
    "- advance: 是否涉及刷单/垫付/充值/返利等异常资金操作。明确说明有则填具体描述；未提及则为空字符串",
    "",
    "硬性要求：",
    "1. 只抽取原文明确说明的信息，不要推断或编造。原文模糊（如'工资面议'）的，对应字段留空字符串。",
    "2. 每个字段值不超过30字。",
    "3. 输出必须是合法 JSON，形如：{\"jobType\":\"...\",\"durationType\":\"...\",\"company\":\"...\",\"work\":\"...\",\"salary\":\"...\",\"settlement\":\"...\",\"location\":\"...\",\"fee\":\"\",\"advance\":\"\"}",
    "",
    "招聘文本：",
    text.slice(0, 6000)
  ].join("\n");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "你是严谨的兼职招聘信息抽取器，只输出 JSON 对象，不要输出解释。" },
        { role: "user", content: prompt }
      ],
      temperature: 0,
      max_tokens: 600
    })
  });
  if (!response.ok) {
    throw new Error(`API ${response.status}`);
  }
  const data = await response.json();
  return parseJsonObject(data.choices?.[0]?.message?.content || "");
}

function parseJsonObject(text) {
  const content = String(text || "").trim();
  if (!content) return null;
  try {
    const parsed = JSON.parse(content);
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch (error) {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return typeof parsed === "object" && parsed !== null ? parsed : null;
      } catch (innerError) {
        return null;
      }
    }
  }
  return null;
}

async function fetchLLMFollowUp(settings, text, scan, extracted, missing, fallbackQuestions) {
  const endpoint = settings.endpoint || "https://api.openai.com/v1/chat/completions";
  const model = settings.model || "gpt-4o-mini";
  const prompt = [
    "你是面向大学生的兼职岗位风险检查Agent，现在只负责生成追问问题。",
    "请严格根据招聘原文、岗位类型、已提取信息和缺失字段，生成3到6个中文追问。",
    "",
    "硬性要求：",
    "1. 只问原文没有说明、但会影响风险判断的信息。",
    "2. 原文已经写明的内容不要重复追问，例如已经写明日结，就不要问是不是日结。",
    "3. 不要把其他岗位类型的风险套用过来。家教不要问刷单；短期日结岗位不要问试用期；线下服务不要默认问手机操作。",
    "4. 只有原文出现线上任务、刷单、做单、充值、返利、垫付、转账等线索时，才追问刷单/垫付。",
    "5. 如果是充场、气氛组、酒水、表演、鼓掌、坐着玩等场景，重点追问工作边界、是否陪酒/拉客/营销酒水、是否强制消费、现场安全、返程、负责人、结算扣款。",
    "6. 不输出分析过程，不输出风险报告，只输出JSON数组字符串，例如：[\"问题1\",\"问题2\"]。",
    "",
    `招聘文本：${text.slice(0, 6000)}`,
    `岗位类型：${extracted.jobType}`,
    `用工时长类型：${extracted.durationType}`,
    `已提取信息：${JSON.stringify(extracted, null, 2)}`,
    `缺失字段：${missing.map((field) => getFieldLabelByJobType(field.key, extracted.jobType)).join("、") || "无"}`,
    `规则命中：${JSON.stringify(scan.hitRules || [], null, 2)}`,
    `本地兜底追问参考：${JSON.stringify(fallbackQuestions, null, 2)}`
  ].join("\n");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "你是严谨的兼职风险追问生成器。必须按原文场景生成问题，禁止套模板。" },
        { role: "user", content: prompt }
      ],
      temperature: 0.1,
      max_tokens: 800
    })
  });
  if (!response.ok) {
    throw new Error(`API ${response.status}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

function sanitizeQuestions(aiText, fallbackQuestions, text, extracted) {
  const parsed = parseQuestionList(aiText);
  const questions = parsed
    .map((item) => String(item || "").replace(/^\s*\d+[.、]\s*/, "").trim())
    .filter((item) => item.length >= 6 && item.length <= 120)
    .filter((item) => !/思考|分析过程|风险报告|结论/.test(item));
  return guardQuestions(questions, text, extracted, fallbackQuestions);
}

function guardQuestions(questions, text, extracted, fallbackQuestions) {
  const hasOnlineFundClue = /线上|手机操作|刷单|做单|任务单|垫付|充值|返利|先付款|转账|解冻/.test(text);
  const isShortTerm = extracted.durationType === "短期/临时";
  const hasDailySalary = /日结|当天结|当日结|\d{2,5}\s*\/\s*天|\d{2,5}\s*元?\s*[一每\/]\s*(天|日)/.test(text);
  const guarded = [...new Set(questions)]
    .filter((question) => hasOnlineFundClue || !/刷单|做单|充值|返利|解冻|拉人|转账任务/.test(question))
    .filter((question) => !isShortTerm || !/试用期|试岗|长期|月结|周结/.test(question))
    .filter((question) => !hasDailySalary || !/日结、周结还是月结|周结还是月结|按天还是/.test(question));
  if (guarded.length) return guarded.slice(0, 6);
  return [...new Set(fallbackQuestions)]
    .filter((question) => hasOnlineFundClue || !/刷单|做单|充值|返利|解冻|拉人|转账任务/.test(question))
    .filter((question) => !isShortTerm || !/试用期|试岗|长期|月结|周结/.test(question))
    .slice(0, 6);
}

function parseQuestionList(text) {
  const content = String(text || "").trim();
  if (!content) return [];
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.questions)) return parsed.questions;
  } catch (error) {
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed)) return parsed;
      } catch (innerError) {
        // Fall through to line parsing.
      }
    }
  }
  return content
    .split(/\n+/)
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
}

function getRiskLevel(score, highRiskCategory) {
  if (score >= 60 || highRiskCategory) return "高风险";
  if (score >= 30) return "中风险";
  return "低风险";
}

function findEvidence(text, keyword) {
  const index = text.indexOf(keyword);
  if (index < 0) return keyword;
  const start = Math.max(0, index - 18);
  const end = Math.min(text.length, index + keyword.length + 18);
  return text.slice(start, end).replace(/\s+/g, " ");
}

function normalizeText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

async function sendToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

async function highlightRisks(tabId, keywords) {
  await sendToTab(tabId, { type: "HIGHLIGHT_RISKS", payload: { keywords } });
  return { ok: true };
}

async function clearHighlights(tabId) {
  await sendToTab(tabId, { type: "CLEAR_HIGHLIGHTS" });
  return { ok: true };
}

async function exportReport(report) {
  if (!report) return { ok: false, error: "没有可导出的报告" };
  const content = formatExportReport(report);
  const url = `data:text/plain;charset=utf-8,${encodeURIComponent(content)}`;
  const filename = `兼职风险检查报告-${new Date().toISOString().slice(0, 10)}.txt`;
  const downloadId = await chrome.downloads.download({ url, filename, saveAs: true });
  return { ok: true, downloadId };
}

function formatExportReport(report) {
  return [
    "兼职岗位风险检查 Agent 报告",
    "==============================",
    `风险等级：${report.riskLevel}`,
    `综合评分：${report.score}分`,
    "",
    "命中风险：",
    (report.hitRisks || []).map((item, index) => `${index + 1}. ${item}`).join("\n") || "未命中明显风险",
    "",
    "证据片段：",
    (report.evidence || []).map((item, index) => `${index + 1}. ${item}`).join("\n") || "暂无",
    "",
    "建议追问：",
    (report.confirmQuestions || []).map((item, index) => `${index + 1}. ${item}`).join("\n") || "暂无",
    "",
    "处理建议：",
    (report.advice || []).map((item, index) => `${index + 1}. ${item}`).join("\n") || "暂无",
    "",
    "结论：",
    report.conclusion || "",
    "",
    "Agent 说明：",
    report.agentSummary || ""
  ].join("\n");
}

async function getRules() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.rules);
  return { ok: true, rules: data[STORAGE_KEYS.rules] || DEFAULT_RISK_RULES || [] };
}

async function getEnabledRules() {
  const { rules } = await getRules();
  return rules.filter((rule) => rule.enabled !== false);
}

async function saveRule(rule) {
  const { rules } = await getRules();
  const nextRule = {
    ...rule,
    id: rule.id || `rule-${Date.now()}`,
    keywords: Array.isArray(rule.keywords)
      ? rule.keywords
      : String(rule.keywords || "").split(/[,，]/).map((item) => item.trim()).filter(Boolean),
    score: Number(rule.score || 0),
    enabled: rule.enabled !== false
  };
  const index = rules.findIndex((item) => item.id === nextRule.id);
  if (index >= 0) rules[index] = nextRule;
  else rules.push(nextRule);
  await chrome.storage.local.set({ [STORAGE_KEYS.rules]: rules });
  return { ok: true, rule: nextRule, rules };
}

async function deleteRule(id) {
  const { rules } = await getRules();
  const nextRules = rules.filter((rule) => rule.id !== id);
  await chrome.storage.local.set({ [STORAGE_KEYS.rules]: nextRules });
  return { ok: true, rules: nextRules };
}

async function saveHistory(record) {
  const data = await chrome.storage.local.get(STORAGE_KEYS.history);
  const history = data[STORAGE_KEYS.history] || [];
  const id = createHistoryId(record.inputText, record.followUpText, record.status);
  const nextHistory = history.filter((item) => item.id !== id);
  nextHistory.unshift({ id, ...record });
  await chrome.storage.local.set({ [STORAGE_KEYS.history]: nextHistory.slice(0, 30) });
}

function createHistoryId(inputText = "", followUpText = "", status = "") {
  const seed = `${status}|${inputText.slice(0, 120)}|${followUpText.slice(0, 120)}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  return `history-${Math.abs(hash)}-${status === "待补充" ? "pending" : "done"}`;
}

async function getHistory() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.history);
  return { ok: true, history: data[STORAGE_KEYS.history] || [] };
}

async function deleteHistory(id) {
  const data = await chrome.storage.local.get(STORAGE_KEYS.history);
  const history = (data[STORAGE_KEYS.history] || []).filter((item) => item.id !== id);
  await chrome.storage.local.set({ [STORAGE_KEYS.history]: history });
  return { ok: true, history };
}

async function clearHistory() {
  await chrome.storage.local.set({ [STORAGE_KEYS.history]: [] });
  return { ok: true, history: [] };
}

async function getSettings() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.settings);
  return {
    enableApi: false,
    endpoint: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4o-mini",
    apiKey: "",
    ...(data[STORAGE_KEYS.settings] || {})
  };
}

async function saveSettings(settings) {
  const current = await getSettings();
  const next = { ...current, ...settings };
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: next });
  return { ok: true, settings: next };
}
