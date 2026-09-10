const { callLLM } = require("./llmService");

const RULES = [
  { id: "fee-deposit", category: "先交费用", keywords: ["押金", "保证金", "入职费", "报名费", "手续费", "资料费"], score: 40 },
  { id: "fee-training", category: "先交费用", keywords: ["培训费", "服装费", "工牌费", "教材费", "押服装"], score: 40 },
  { id: "scam-brushing", category: "刷单垫付", keywords: ["刷单", "返利", "任务单", "做单", "垫付", "先付款", "充值", "解冻"], score: 55 },
  { id: "salary-high", category: "薪资异常", keywords: ["日入300", "日赚300", "日结300", "日入500", "月入过万", "轻松月入", "无经验高薪"], score: 25 },
  { id: "vague-work", category: "信息模糊", keywords: ["手机操作", "简单任务", "轻松简单", "时间自由", "待遇优厚", "工资面议", "加微信详聊", "私聊"], score: 15 },
  { id: "privacy-sensitive", category: "隐私索取", keywords: ["身份证照片", "银行卡", "验证码", "人脸识别", "学生证照片", "支付宝账号", "微信收款码", "手持身份证", "四件套"], score: 35 },
  { id: "labor-irregular", category: "用工不规范", keywords: ["试用期无薪", "无合同", "工资另算", "月底看情况", "干完再说", "不签协议", "试岗无薪", "试工期", "考核期"], score: 25 },
  { id: "fee-deduction", category: "扣费说明", keywords: ["意外险", "物资使用费", "管理费", "工服清洗费"], score: 15 },
  { id: "boundary-atmosphere", category: "工作边界", keywords: ["充场", "气氛组", "暖场", "捧场", "凑人气", "坐着玩", "陪酒", "拉客", "营销酒水", "强制消费", "可以不喝酒", "酒水"], score: 20 },
  { id: "safety-atmosphere", category: "现场安全", keywords: ["夜场", "酒吧", "清吧", "KTV", "会所", "表演", "鼓掌", "节目结束", "凌晨"], score: 15 }
];

const REQUIRED_FIELDS = [
  { key: "company", label: "招聘主体" },
  { key: "work", label: "具体工作内容" },
  { key: "salary", label: "薪资标准" },
  { key: "settlement", label: "结算方式" },
  { key: "location", label: "工作地点" },
  { key: "fee", label: "是否需要额外交费" },
  { key: "advance", label: "是否涉及垫付或刷单" }
];

async function analyzeJobText(rawText, followUpText = "") {
  const text = [rawText, followUpText].filter(Boolean).join("\n补充信息：\n");
  const extracted = extractInfo(text);
  const scan = scanRisks(text);
  const missing = getMissingFields(extracted);

  if (missing.length && scan.riskLevel !== "高风险") {
    const questions = await buildFollowUpQuestions(text, extracted, missing, scan);
    return {
      needQuestion: true,
      extracted,
      preliminary: scan,
      questions
    };
  }

  const report = {
    riskLevel: scan.riskLevel,
    score: scan.score,
    hitRisks: scan.hitRisks,
    evidence: scan.evidence,
    missingFields: missing,
    advice: buildAdvice(scan, extracted, missing),
    conclusion: buildConclusion(scan, missing)
  };
  return {
    needQuestion: false,
    extracted,
    report
  };
}

function extractInfo(text) {
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

function detectJobType(text) {
  if (/充场|气氛组|暖场|捧场|凑人气|坐着玩|鼓掌|节目结束|可以不喝酒|酒水|酒吧|清吧|KTV|夜场|会所/.test(text)) return "活动充场/气氛组";
  if (/会务|会议|酒店|展会|会展|活动执行|现场协助|签到|接待|礼仪|播音|PPT|讲.*话|主持|宣讲/.test(text)) return "短期活动/会务协助";
  if (/家教|补习|辅导|课时|学生|年级|语数英|数学|英语|语文|物理|化学/.test(text)) return "家教/补习";
  if (/服务员|收银|传菜|餐饮|奶茶|咖啡|门店|礼宴|摆台|上菜|收餐具|会场布置/.test(text)) return "门店服务";
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

function scanRisks(text) {
  const hitRisks = [];
  const evidence = [];
  let score = 0;
  for (const rule of RULES) {
    const matched = (rule.keywords || []).filter((keyword) => hasNonNegatedKeyword(text, keyword));
    if (matched.length) {
      hitRisks.push(rule.category);
      evidence.push(...matched);
      score += Number(rule.score || 0);
    }
  }
  const highRiskCategory = hitRisks.includes("刷单垫付") || hitRisks.includes("先交费用");
  const riskLevel = score >= 60 || highRiskCategory ? "高风险" : score >= 30 ? "中风险" : "低风险";
  return { score, riskLevel, hitRisks: [...new Set(hitRisks)], evidence: [...new Set(evidence)] };
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

function getMissingFields(extracted) {
  return REQUIRED_FIELDS.filter((field) => !extracted[field.key]);
}

async function buildFollowUpQuestions(text, extracted, missing, scan) {
  const local = buildLocalQuestions(text, extracted, missing, scan);
  const ai = await callLLM({ text, extracted, missing, scan, localQuestions: local });
  return guardQuestions(ai.length ? ai : local, text, extracted);
}

function buildLocalQuestions(text, extracted, missing, scan) {
  if (extracted.jobType === "短期活动/会务协助") {
    return [
      "请确认活动主办方、酒店对接人或招聘方身份，是否能核实真实负责人？",
      "请确认薪资是否为当天完整工资，包餐是否会折抵工资，迟到或提前结束是否扣款。",
      "请确认是否只负责PPT播放、播音和简单宣讲，是否有额外销售、拉人、推销或临时加班要求。",
      "请确认到岗地点、联系人、考勤方式，以及活动结束后工资发放时间。"
    ];
  }
  if (extracted.jobType === "活动充场/气氛组") {
    return [
      "请确认活动场所、门店或主办方名称，是否能查到真实主体和负责人？",
      "请确认工作边界：是否只负责充场、鼓掌、营造氛围，是否涉及陪酒、营销酒水、拉客或强制消费？",
      "请确认酒水是否完全自愿，是否存在必须饮酒、陪同消费或额外消费要求？",
      "请确认具体活动地址、集合位置、结束时间和返程安排。"
    ];
  }
  return missing.map((field) => `请补充确认：${field}。`).slice(0, 5);
}

function guardQuestions(questions, text, extracted) {
  const hasOnlineFundClue = /线上|手机操作|刷单|做单|任务单|垫付|充值|返利|先付款|转账|解冻/.test(text);
  const isShortTerm = extracted.durationType === "短期/临时";
  return [...new Set(questions)]
    .filter((question) => hasOnlineFundClue || !/刷单|做单|充值|返利|解冻|拉人|转账任务/.test(question))
    .filter((question) => !isShortTerm || !/试用期|试岗|长期|月结|周结/.test(question))
    .slice(0, 6);
}

function buildAdvice(scan, extracted, missing) {
  if (scan.riskLevel === "高风险") return ["不要提前缴费、垫付或提供验证码等敏感信息。"];
  if (missing.length) return ["继续联系前先补充确认缺失信息，保留聊天记录和招聘截图。"];
  return ["当前未发现明显高危风险，但仍建议核实招聘主体和工资发放方式。"];
}

function buildConclusion(scan, missing) {
  if (scan.riskLevel === "高风险") return "该兼职存在较高风险，不建议在未核实前继续联系。";
  if (missing.length) return "当前信息不完整，建议补充关键条件后再判断。";
  return "当前未发现明显高危风险，可在核实主体后谨慎联系。";
}

module.exports = { analyzeJobText };
