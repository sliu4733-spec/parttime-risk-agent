const { callLLM } = require("./llmService");

const RULES = [
  { category: "先交费用", keywords: ["押金", "保证金", "报名费", "培训费", "服装费", "资料费"], score: 40 },
  { category: "刷单垫付", keywords: ["刷单", "做单", "垫付", "充值", "返利", "解冻", "先付款"], score: 55 },
  { category: "信息模糊", keywords: ["简单任务", "轻松", "加微信详聊", "私聊", "工资面议"], score: 15 },
  { category: "隐私索取", keywords: ["身份证照片", "银行卡", "验证码", "人脸识别", "学生证照片"], score: 35 },
  { category: "工作边界", keywords: ["充场", "气氛组", "陪酒", "拉客", "强制消费", "酒水"], score: 20 }
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
  return {
    jobType,
    durationType: detectDurationType(text),
    salary: /工资|薪资|\d+\s*元|\d+\s*\/\s*天|\d+\s*\/\s*h/i.test(text),
    location: /地址|地点|酒店|学校|校内|线上|市|区|路|号/.test(text),
    company: /公司|机构|门店|店|主办方|酒店|家长|老师/.test(text),
    work: /工作|负责|PPT|播音|家教|补习|服务员|传单|充场|气氛组|配送|助理/.test(text),
    settlement: /日结|当日结|现结|结算|课后结|\d+\s*\/\s*天/.test(text),
    fee: /不收.*费|无需.*费|押金|培训费|服装费|报名费|资料费|设备费/.test(text),
    advance: /刷单|做单|垫付|充值|返利|转账|先付款/.test(text)
  };
}

function detectJobType(text) {
  if (/充场|气氛组|酒水|鼓掌|坐着玩|夜场|KTV|酒吧/.test(text)) return "活动充场/气氛组";
  if (/酒店|会议|会务|PPT|播音|宣讲|签到|接待/.test(text)) return "短期活动/会务协助";
  if (/家教|补习|辅导|年级|语数英|数学|英语|语文/.test(text)) return "家教/补习";
  if (/服务员|收银|传菜|餐饮|奶茶|咖啡|门店/.test(text)) return "门店服务";
  if (/传单|地推|促销/.test(text)) return "地推促销";
  if (/外卖|配送|跑腿|骑手|快递|分拣/.test(text)) return "配送/跑腿";
  if (/线上|手机操作|打字|录入/.test(text)) return "线上兼职";
  return "未明确";
}

function detectDurationType(text) {
  if (/一天|两天|任选一天|日结|当日结|\d{1,2}\s*[.月]\s*\d{1,2}\s*号?|\d{1,2}[:：]\d{2}\s*[-—~到至]\s*\d{1,2}[:：]\d{2}/.test(text)) {
    return "短期/临时";
  }
  if (/长期|每周|稳定/.test(text)) return "长期/固定";
  return "未明确";
}

function scanRisks(text) {
  const hitRisks = [];
  const evidence = [];
  let score = 0;
  for (const rule of RULES) {
    const matched = rule.keywords.filter((keyword) => text.includes(keyword));
    if (matched.length) {
      hitRisks.push(rule.category);
      evidence.push(...matched);
      score += rule.score;
    }
  }
  const riskLevel = score >= 60 || hitRisks.includes("刷单垫付") || hitRisks.includes("先交费用")
    ? "高风险"
    : score >= 30
      ? "中风险"
      : "低风险";
  return { score, riskLevel, hitRisks: [...new Set(hitRisks)], evidence: [...new Set(evidence)] };
}

function getMissingFields(extracted) {
  const fields = [];
  if (!extracted.company) fields.push("招聘主体");
  if (!extracted.work) fields.push("具体工作内容");
  if (!extracted.salary) fields.push("薪资标准");
  if (!extracted.settlement) fields.push("结算方式");
  if (!extracted.location) fields.push("工作地点");
  if (!extracted.fee) fields.push("是否额外收费");
  if (!extracted.advance && extracted.jobType === "线上兼职") fields.push("是否刷单垫付");
  return fields;
}

async function buildFollowUpQuestions(text, extracted, missing, scan) {
  const local = buildLocalQuestions(text, extracted, missing, scan);
  const ai = await callLLM({ text, extracted, missing, scan, localQuestions: local });
  return guardQuestions(ai.length ? ai : local, text, extracted);
}

function buildLocalQuestions(text, extracted, missing) {
  if (extracted.jobType === "短期活动/会务协助") {
    return [
      "请确认活动主办方、酒店对接人或招聘方身份，是否能核实真实负责人？",
      "请确认130元/天是否为当天完整工资，包餐是否会折抵工资，迟到或提前结束是否扣款。",
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
