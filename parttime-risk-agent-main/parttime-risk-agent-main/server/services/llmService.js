async function callLLM(payload) {
  if (process.env.LLM_ENABLE !== "true" || !process.env.LLM_API_KEY) {
    return [];
  }

  const prompt = [
    "你是面向大学生的兼职岗位风险检查Agent，只生成追问问题。",
    "请只问招聘原文没有说明但影响风险判断的信息。",
    "不要把其他岗位类型的风险套用到当前岗位。",
    "短期一天兼职不要问试用期、周结、月结。",
    "原文没有线上资金任务线索时不要问刷单、充值、返利。",
    "只输出JSON数组字符串。",
    "",
    JSON.stringify(payload, null, 2)
  ].join("\n");

  const response = await fetch(process.env.LLM_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.LLM_API_KEY}`
    },
    body: JSON.stringify({
      model: process.env.LLM_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: "你是严谨的兼职风险追问生成器。" },
        { role: "user", content: prompt }
      ],
      temperature: 0.1
    })
  });

  if (!response.ok) return [];
  const data = await response.json();
  return parseQuestions(data.choices?.[0]?.message?.content || "");
}

function parseQuestions(text) {
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return String(text || "")
      .split(/\n+/)
      .map((line) => line.replace(/^\s*\d+[.、]\s*/, "").trim())
      .filter(Boolean);
  }
}

module.exports = { callLLM };
