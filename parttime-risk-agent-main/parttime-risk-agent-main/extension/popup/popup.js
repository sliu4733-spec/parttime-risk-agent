let activeText = "";
let latestReport = null;
let followUpAnswers = [];
let currentItems = [];
let sourceTabId = null;
let highlightedTabId = null;

const els = {
  analyzePageBtn: document.getElementById("analyzePageBtn"),
  analyzeTextBtn: document.getElementById("analyzeTextBtn"),
  sampleBtn: document.getElementById("sampleBtn"),
  ocrBtn: document.getElementById("ocrBtn"),
  ocrInput: document.getElementById("ocrInput"),
  jobText: document.getElementById("jobText"),
  agentPanel: document.getElementById("agentPanel"),
  followUpHistory: document.getElementById("followUpHistory"),
  questions: document.getElementById("questions"),
  followUpText: document.getElementById("followUpText"),
  submitFollowUpBtn: document.getElementById("submitFollowUpBtn"),
  reportPanel: document.getElementById("reportPanel"),
  riskBadge: document.getElementById("riskBadge"),
  score: document.getElementById("score"),
  agentSummary: document.getElementById("agentSummary"),
  riskList: document.getElementById("riskList"),
  missingList: document.getElementById("missingList"),
  breakdownList: document.getElementById("breakdownList"),
  confirmList: document.getElementById("confirmList"),
  evidenceList: document.getElementById("evidenceList"),
  highlightBtn: document.getElementById("highlightBtn"),
  clearHighlightBtn: document.getElementById("clearHighlightBtn"),
  copyBtn: document.getElementById("copyBtn"),
  exportBtn: document.getElementById("exportBtn"),
  clearHistoryBtn: document.getElementById("clearHistoryBtn"),
  historyList: document.getElementById("historyList"),
  toast: document.getElementById("toast")
};

document.addEventListener("DOMContentLoaded", loadHistory);
els.analyzePageBtn.addEventListener("click", analyzeCurrentPage);
els.analyzeTextBtn.addEventListener("click", () => analyzeText(els.jobText.value, ""));
els.submitFollowUpBtn.addEventListener("click", submitFollowUp);
els.sampleBtn.addEventListener("click", fillSample);
els.ocrBtn.addEventListener("click", () => els.ocrInput.click());
els.ocrInput.addEventListener("change", handleOcrImage);
els.highlightBtn.addEventListener("click", highlightRisks);
els.clearHighlightBtn.addEventListener("click", clearHighlights);
els.copyBtn.addEventListener("click", copyReport);
els.exportBtn.addEventListener("click", exportReport);
els.clearHistoryBtn.addEventListener("click", clearHistory);

async function handleOcrImage(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    showToast("请选择图片文件");
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    showToast("图片不能超过 8MB");
    els.ocrInput.value = "";
    return;
  }
  setBusy(true);
  hideReport();
  resetConversation();
  try {
    const dataUrl = await readFileAsDataUrl(file);
    showToast("正在识别图片文字...");
    const response = await sendMessage({ type: "OCR_ANALYZE", payload: { image: dataUrl } });
    if (!response?.ok) {
      showToast(response?.error || "图片识别失败");
      return;
    }
    if (!response.text) {
      showToast("未在图片中识别到招聘信息文字");
      return;
    }
    els.jobText.value = response.text.slice(0, 2500);
    showToast("已识别图片文字，开始分析...");
    await analyzeText(response.text, "", false);
  } catch (error) {
    showToast(error.message || "图片识别失败");
  } finally {
    els.ocrInput.value = "";
    setBusy(false);
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

async function analyzeCurrentPage() {
  setBusy(true);
  hideReport();
  resetConversation();
  try {
    const tab = await getActiveTab();
    sourceTabId = tab.id;
    const response = await sendMessage({ type: "ANALYZE_CURRENT_PAGE", tabId: tab.id });
    handleAnalyzeResponse(response);
  } catch (error) {
    showToast(error.message || "分析当前页面失败");
  } finally {
    setBusy(false);
  }
}

async function analyzeText(text, followUp, reset = true) {
  if (!text.trim()) {
    showToast("请先输入兼职招聘信息");
    return;
  }
  setBusy(true);
  hideReport();
  if (reset) resetConversation();
  try {
    activeText = text.trim();
    const response = await sendMessage({
      type: "ANALYZE_TEXT",
      payload: { text: activeText, followUp }
    });
    handleAnalyzeResponse(response);
  } catch (error) {
    showToast(error.message || "检测失败");
  } finally {
    setBusy(false);
  }
}

async function submitFollowUp(forceReport = false) {
  forceReport = forceReport === true;
  const answers = currentItems.map((item,index) => ({...item, answer:document.getElementById(`answer-${index}`).value.trim()}));
  if (!forceReport && answers.some(a=>!a.answer)) { showToast("请逐题回答；不清楚可填“不知道”。"); return; }
  const next = [...followUpAnswers];
  if (answers.some(a=>a.answer)) next.push({answers:answers.filter(a=>a.answer)});
  setBusy(true);
  try {
    const response = await sendMessage({type:"SUBMIT_FOLLOWUP", payload:{text:activeText, turns:next, forceReport}});
    if (!response?.ok) { showToast(response?.error || "分析失败，请重试"); return; }
    followUpAnswers=next;
    renderFollowUpHistory();
    handleAnalyzeResponse(response);
  } catch(error) { showToast(error.message || "继续分析失败"); }
  finally { setBusy(false); }
}

function handleAnalyzeResponse(response) {
  if (!response?.ok) {
    showToast(response?.error || "Agent 未返回结果");
    return;
  }

  if (response.originalText) {
    activeText = response.originalText;
    els.jobText.value = response.originalText.slice(0, 2500);
  }

  if (response.needQuestion) {
    showQuestions(response.questions || [], response.questionItems);
    const sourceText = response.questionSource === "api" ? "大模型已生成场景化追问" : "本地规则已生成场景化追问";
    showToast(followUpAnswers.length ? `${sourceText}，还需要继续补充` : sourceText);
    return;
  }

  els.agentPanel.classList.add("hidden");
  latestReport = response.report;
  renderReport(response.report);
  loadHistory();
}

function showQuestions(questions, items) {
  currentItems = items || questions.map((question,index)=>({key:`legacy-${index}`,question}));
  els.questions.innerHTML = "";
  questions.forEach((question, index) => {
    const div = document.createElement("div");
    div.className = "question";
    div.textContent = `${index + 1}. ${question}`;
    els.questions.appendChild(div);
    const answer = document.createElement("textarea");
    answer.id = `answer-${index}`;
    answer.placeholder = "只回答这一题；不清楚可填“不知道”，也可填“已确认”或“不适用”。";
    answer.style.minHeight = "65px";
    els.questions.appendChild(answer);
  });
  els.followUpText.value = "";
  els.agentPanel.classList.remove("hidden");
}

function renderFollowUpHistory() {
  els.followUpHistory.innerHTML = "";
  followUpAnswers.forEach((answer, index) => {
    const div = document.createElement("div");
    div.className = "follow-answer";
    div.textContent = `第 ${index + 1} 轮：` + answer.answers.map(a=>`\n问：${a.question}\n答：${a.answer}`).join("\n");
    div.style.whiteSpace = "pre-wrap";
    els.followUpHistory.appendChild(div);
  });
}

function renderReport(report) {
  if (!report) return;
  els.reportPanel.classList.remove("hidden");
  els.riskBadge.className = `badge ${badgeClass(report.riskLevel)}`;
  els.riskBadge.textContent = report.riskLevel;
  els.score.textContent = `${report.score} 分`;
  els.agentSummary.textContent = report.agentSummary || report.conclusion || "";
  renderMiniList(els.riskList, report.hitRisks || [], "未命中明显风险类别");
  renderMiniList(els.missingList, report.missingFields || [], "关键信息较完整");
  renderBreakdown(report.scoreBreakdown || []);
  renderConfirmQuestions(report.confirmQuestions || []);
  els.evidenceList.innerHTML = "";
  (report.evidence || []).forEach((evidence) => {
    const span = document.createElement("span");
    span.className = "chip";
    span.textContent = evidence;
    els.evidenceList.appendChild(span);
  });
}

function renderMiniList(container, items, emptyText) {
  container.innerHTML = "";
  if (!items.length) {
    container.textContent = emptyText;
    return;
  }
  items.forEach((item) => {
    const div = document.createElement("div");
    div.className = "mini-item";
    div.textContent = item;
    container.appendChild(div);
  });
}

function renderBreakdown(items) {
  els.breakdownList.innerHTML = "";
  if (!items.length) {
    els.breakdownList.innerHTML = `<div class="mini-list">暂无分值明细</div>`;
    return;
  }
  items.forEach((item) => {
    const div = document.createElement("div");
    div.className = "breakdown-item";
    div.innerHTML = `
      <div>
        <strong>${escapeHtml(item.category)} / ${escapeHtml(item.name)}</strong>
        <div>${escapeHtml((item.matched || []).join("、"))}</div>
      </div>
      <div class="breakdown-score">+${Number(item.score || 0)}</div>
    `;
    els.breakdownList.appendChild(div);
  });
}

function renderConfirmQuestions(items) {
  els.confirmList.innerHTML = "";
  if (!items.length) {
    els.confirmList.innerHTML = `<div class="question">暂无建议追问</div>`;
    return;
  }
  items.forEach((item, index) => {
    const div = document.createElement("div");
    div.className = "question";
    div.textContent = `${index + 1}. ${item}`;
    els.confirmList.appendChild(div);
  });
}

function renderRiskMarks(text, keywords) {
  const target = document.getElementById("highlightText");
  target.replaceChildren();
  const words = [...new Set(keywords.filter(k => typeof k === "string" && k.trim()))].sort((a,b)=>b.length-a.length);
  let offset = 0, count = 0;
  while (offset < text.length) {
    let start = text.length, word = "";
    for (const k of words) {
      const index = text.indexOf(k, offset);
      if (index >= 0 && index < start) { start = index; word = k; }
    }
    target.appendChild(document.createTextNode(text.slice(offset, start)));
    if (!word) break;
    const mark = document.createElement("mark");
    mark.textContent = word;
    mark.style.cssText = "background:#ffe044;color:#b00020;font-weight:800;border-bottom:2px solid #e00035;border-radius:3px;padding:1px 2px";
    target.appendChild(mark);
    count++; offset = start + word.length;
  }
  return count;
}
async function highlightRisks() {
  if (!latestReport) { showToast("请先生成风险报告"); return; }
  const keywords = [...(latestReport.matchedKeywords || []), ...(latestReport.hitRules || []).flatMap(rule=>rule.matched || [])];
  const text = [activeText, ...followUpAnswers.flatMap(t=>t.answers.map(a=>a.answer))].join("\n");
  const count = renderRiskMarks(text, keywords);
  const preview = document.getElementById("highlightPreview");
  preview.classList.toggle("hidden", !count);
  if (count) preview.scrollIntoView({block:"nearest", behavior:"smooth"});
  let pageCount = 0;
  if (sourceTabId !== null && keywords.length) {
    try {
      const result = await sendMessage({type:"HIGHLIGHT_RISKS",tabId:sourceTabId,payload:{keywords}});
      if (result?.ok) { pageCount=result.count || 0; highlightedTabId=sourceTabId; }
    } catch (_) { /* Local preview remains available if the source page closed. */ }
  }
  showToast(count || pageCount ? `已标记 ${count} 处风险词${pageCount ? "，原网页也已高亮" : ""}` : "暂无高亮风险词");
}
async function clearHighlights() {
  const target = document.getElementById("highlightText");
  target.textContent = target.textContent;
  if (highlightedTabId !== null) {
    try {
      const result = await sendMessage({type:"CLEAR_HIGHLIGHTS",tabId:highlightedTabId});
      if (!result?.ok) { showToast("插件内高亮已清除；原网页无法连接，刷新原网页即可清除"); return; }
      highlightedTabId = null;
    } catch (_) { showToast("插件内高亮已清除；刷新原网页即可清除网页标记"); return; }
  }
  showToast("已清除高亮");
}

async function copyReport() {
  if (!latestReport) {
    showToast("请先生成风险报告");
    return;
  }
  await navigator.clipboard.writeText(latestReport.agentSummary || JSON.stringify(latestReport, null, 2));
  showToast("报告已复制");
}

async function exportReport() {
  if (!latestReport) {
    showToast("请先生成风险报告");
    return;
  }
  const response = await sendMessage({ type: "EXPORT_REPORT", payload: { report: latestReport } });
  showToast(response?.ok ? "已创建导出任务" : response?.error || "导出失败");
}

async function loadHistory() {
  const response = await sendMessage({ type: "GET_HISTORY" });
  const history = response?.history || [];
  els.historyList.innerHTML = "";
  if (!history.length) {
    els.historyList.innerHTML = `<div class="history-empty">暂无检测记录</div>`;
    return;
  }
  history.slice(0, 5).forEach((item) => {
    const div = document.createElement("div");
    div.className = "history-item";
    div.innerHTML = `
      <div class="history-meta">
        <strong>${escapeHtml(item.status || "已完成")} / ${escapeHtml(item.riskLevel)}</strong>
        <span>${formatTime(item.createdAt)}</span>
      </div>
      <div class="history-text">${escapeHtml((item.inputText || "").slice(0, 80))}</div>
    `;
    div.addEventListener("click", () => {
      resetConversation();
      followUpAnswers = item.turns || [];
      renderFollowUpHistory();
      els.jobText.value = item.inputText || "";
      activeText = item.inputText || "";
      if (item.status === "待补充") {
        latestReport = null;
        hideReport();
        showQuestions(item.questions || [], item.questionItems);
        showToast("已恢复待补充记录");
        return;
      }
      latestReport = {
        ...(item.report || {}),
        riskLevel: item.riskLevel,
        score: item.score,
        hitRisks: item.hitRisks || [],
        evidence: item.evidence || [],
        conclusion: item.conclusion,
        agentSummary: item.report?.agentSummary || item.conclusion
      };
      renderReport(latestReport);
    });
    els.historyList.appendChild(div);
  });
}

async function clearHistory() {
  const response = await sendMessage({ type: "CLEAR_HISTORY" });
  if (response?.ok) {
    await loadHistory();
    showToast("历史记录已清空");
  }
}

function fillSample() {
  els.jobText.value = "招聘线上兼职，手机操作即可，时间自由，日结300元。需要先交99元培训费，完成任务后返还，有兴趣加微信详聊。";
  activeText = els.jobText.value;
  resetConversation();
}

function hideReport() {
  els.reportPanel.classList.add("hidden");
  latestReport = null;
}

function resetConversation() {
  sourceTabId = null;
  document.getElementById("highlightPreview").classList.add("hidden");
  followUpAnswers = [];
  currentItems = [];
  els.followUpHistory.innerHTML = "";
  els.agentPanel.classList.add("hidden");
}

function setBusy(isBusy) {
  [els.analyzePageBtn, els.analyzeTextBtn, els.submitFollowUpBtn, els.ocrBtn, els.sampleBtn, document.getElementById("finishBtn")].forEach((button) => {
    button.disabled = isBusy;
  });
  if (isBusy) showToast("Agent 正在分析...");
}

function badgeClass(level) {
  if (level === "高风险") return "high";
  if (level === "中风险") return "mid";
  if (level === "低风险") return "low";
  return "";
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("无法获取当前标签页");
  return tab;
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
  showToast.timer = setTimeout(() => els.toast.classList.add("hidden"), 2200);
}

function formatTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
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

document.getElementById("finishBtn").addEventListener("click", () => submitFollowUp(true));
