const els = {
  visionEnable: document.getElementById("visionEnable"),
  visionEndpoint: document.getElementById("visionEndpoint"),
  visionModel: document.getElementById("visionModel"),
  visionApiKey: document.getElementById("visionApiKey"),
  saveVisionBtn: document.getElementById("saveVisionBtn"),
  answerEnable: document.getElementById("answerEnable"),
  answerEndpoint: document.getElementById("answerEndpoint"),
  answerModel: document.getElementById("answerModel"),
  answerApiKey: document.getElementById("answerApiKey"),
  saveAnswerBtn: document.getElementById("saveAnswerBtn"),
  resetRulesBtn: document.getElementById("resetRulesBtn"),
  addRuleBtn: document.getElementById("addRuleBtn"),
  rulesList: document.getElementById("rulesList"),
  category: document.getElementById("category"),
  name: document.getElementById("name"),
  keywords: document.getElementById("keywords"),
  score: document.getElementById("score"),
  description: document.getElementById("description"),
  advice: document.getElementById("advice"),
  toast: document.getElementById("toast")
};

const DEFAULT_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";

document.addEventListener("DOMContentLoaded", init);
els.saveVisionBtn.addEventListener("click", saveVisionSettings);
els.saveAnswerBtn.addEventListener("click", saveAnswerSettings);
els.addRuleBtn.addEventListener("click", addRule);
els.resetRulesBtn.addEventListener("click", resetRules);

async function init() {
  await loadSettings();
  await loadRules();
}

async function loadSettings() {
  const response = await sendMessage({ type: "GET_SETTINGS" });
  const settings = response?.settings || response || {};
  const vision = settings.vision || {};
  const answer = settings.answer || {};
  // 兼容旧版单一配置：无分组时两组共用同一份平铺字段。
  const legacy = (!settings.vision && !settings.answer) ? settings : {};
  const v = { ...legacy, ...vision };
  const a = { ...legacy, ...answer };
  els.visionEnable.checked = Boolean(v.enableApi);
  els.visionEndpoint.value = v.endpoint || DEFAULT_ENDPOINT;
  els.visionModel.value = v.model || DEFAULT_MODEL;
  els.visionApiKey.value = v.apiKey || "";
  els.answerEnable.checked = Boolean(a.enableApi);
  els.answerEndpoint.value = a.endpoint || DEFAULT_ENDPOINT;
  els.answerModel.value = a.model || DEFAULT_MODEL;
  els.answerApiKey.value = a.apiKey || "";
}

function readConfig(prefix) {
  return {
    enableApi: els[prefix + "Enable"].checked,
    endpoint: els[prefix + "Endpoint"].value.trim(),
    model: els[prefix + "Model"].value.trim(),
    apiKey: els[prefix + "ApiKey"].value.trim()
  };
}

async function saveVisionSettings() {
  const vision = readConfig("vision");
  const response = await sendMessage({ type: "SAVE_SETTINGS", payload: { vision } });
  const saved = response?.settings?.vision;
  if (response?.ok && saved) els.visionEndpoint.value = saved.endpoint;
  showToastSaved(response, vision.endpoint, saved?.endpoint, "识图模型设置");
}

async function saveAnswerSettings() {
  const answer = readConfig("answer");
  const response = await sendMessage({ type: "SAVE_SETTINGS", payload: { answer } });
  const saved = response?.settings?.answer;
  if (response?.ok && saved) els.answerEndpoint.value = saved.endpoint;
  showToastSaved(response, answer.endpoint, saved?.endpoint, "回答模型设置");
}

function showToastSaved(response, inputEndpoint, savedEndpoint, label) {
  if (!response?.ok) { showToast("保存失败"); return; }
  showToast(inputEndpoint !== savedEndpoint
    ? `已保存，并转换为本插件使用的 Chat Completions 接口地址（${label}）`
    : `${label}已保存`);
}

async function loadRules() {
  const response = await sendMessage({ type: "GET_RULES" });
  renderRules(response?.rules || []);
}

function renderRules(rules) {
  els.rulesList.innerHTML = "";
  rules.forEach((rule) => {
    const div = document.createElement("div");
    div.className = "rule";
    div.innerHTML = `
      <div>
        <div class="rule-title">${escapeHtml(rule.category)} / ${escapeHtml(rule.name)}</div>
        <div class="rule-meta">关键词：${escapeHtml((rule.keywords || []).join("、"))}</div>
        <div class="rule-meta">分值：${rule.score}；状态：${rule.enabled === false ? "停用" : "启用"}</div>
        <div class="rule-meta">${escapeHtml(rule.description || "")}</div>
      </div>
      <div class="rule-actions">
        <button data-action="toggle">${rule.enabled === false ? "启用" : "停用"}</button>
        <button data-action="delete">删除</button>
      </div>
    `;
    div.querySelector("[data-action='toggle']").addEventListener("click", async () => {
      await sendMessage({ type: "SAVE_RULE", payload: { rule: { ...rule, enabled: rule.enabled === false } } });
      await loadRules();
    });
    div.querySelector("[data-action='delete']").addEventListener("click", async () => {
      await sendMessage({ type: "DELETE_RULE", payload: { id: rule.id } });
      await loadRules();
    });
    els.rulesList.appendChild(div);
  });
}

async function addRule() {
  const rule = {
    category: els.category.value.trim(),
    name: els.name.value.trim(),
    keywords: els.keywords.value.trim(),
    score: Number(els.score.value || 0),
    description: els.description.value.trim(),
    advice: els.advice.value.trim(),
    enabled: true
  };
  if (!rule.category || !rule.name || !rule.keywords || !rule.score) {
    showToast("请填写类别、名称、关键词和分值");
    return;
  }
  const response = await sendMessage({ type: "SAVE_RULE", payload: { rule } });
  if (response?.ok) {
    ["category", "name", "keywords", "score", "description", "advice"].forEach((key) => {
      els[key].value = "";
    });
    await loadRules();
    showToast("规则已新增");
  }
}

async function resetRules() {
  if (!confirm("确定恢复默认规则？这会覆盖当前规则列表。")) return;
  await chrome.storage.local.set({ riskRules: DEFAULT_RISK_RULES });
  await loadRules();
  showToast("已恢复默认规则");
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

function showToast(text) {
  els.toast.textContent = text;
  els.toast.classList.remove("hidden");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.add("hidden"), 1800);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}
