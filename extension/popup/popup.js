let activeText = "";
let latestReport = null;
let followUpAnswers = [];
let currentItems = [];
let sourceTabId = null;
let highlightedTabId = null;
let busy = false;
let analysisSeq = 0;
let pollTimer = null;
let pollTries = 0;

// 在标题下方显示当前插件版本，便于确认浏览器加载的是否为最新代码。
try {
  document.querySelector(".header p").textContent += ` · v${chrome.runtime.getManifest().version}`;
} catch (_) {}

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
  finishBtn: document.getElementById("finishBtn"),
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
  nextRoundBtn: document.getElementById("nextRoundBtn"),
  cancelWaitBtn: document.getElementById("cancelWaitBtn"),
  clearHistoryBtn: document.getElementById("clearHistoryBtn"),
  historyList: document.getElementById("historyList"),
  progressPanel: document.getElementById("progressPanel"),
  progressText: document.getElementById("progressText"),
  toast: document.getElementById("toast")
};

function showPage(name) {
  ["home", "login", "register", "analyze"].forEach((page) => {
    document.getElementById(`page-${page}`).classList.toggle("hidden", page !== name);
  });
}

// 打开与后台 service worker 的长连接，避免长分析期间后台被浏览器回收。
let keepAlivePort = null;
function ensureKeepAlive() {
  if (keepAlivePort || !chrome?.runtime?.connect) return;
  try {
    keepAlivePort = chrome.runtime.connect({ name: "popup-keepalive" });
    keepAlivePort.onDisconnect.addListener(() => { keepAlivePort = null; });
  } catch (_) {}
}
ensureKeepAlive();

const SEND_TIMEOUT = { default: 20000, analysis: 290000, ocr: 90000 };

function sendMessage(message, timeoutMs = SEND_TIMEOUT.default) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    timer = setTimeout(() => finish(reject, new Error("操作超时，请重试；后台结果会保存在本机记录中")), timeoutMs);
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) finish(reject, new Error(chrome.runtime.lastError.message));
        else finish(resolve, response);
      });
    } catch (error) {
      finish(reject, error);
    }
  });
}

function showProgress(text) {
  els.progressText.textContent = text || "正在分析，请稍候…";
  els.progressPanel.classList.remove("hidden");
}

function hideProgress() {
  els.progressPanel.classList.add("hidden");
}

function setBusy(isBusy) {
  busy = isBusy;
  [els.analyzePageBtn, els.analyzeTextBtn, els.submitFollowUpBtn, els.ocrBtn, els.sampleBtn, els.finishBtn].forEach((button) => {
    button.disabled = isBusy;
  });
  if (isBusy) showProgress("正在分析，请稍候…");
  else hideProgress();
}

async function enterAnalyze() {
  analysisSeq++;
  resetConversation();
  hideReport();
  activeText = "";
  els.jobText.value = "";
  showPage("analyze");
  try {
    await refreshSync(false);
    await syncCall("clearActive");
  } catch (error) {
    showToast(error.message);
  }

}

function startNextRound() {
  analysisSeq++;
  setBusy(false);
  resetConversation();
  hideReport();
  activeText = "";
  els.jobText.value = "";
  // 清除当前会话指针：关闭弹窗再打开时不再恢复上一轮，历史记录仍保留。
  syncCall("clearActive").catch(() => {});
  showToast("已开始新一轮检测，可粘贴信息、识别截图或分析当前页面");
  els.jobText.focus();
}

// 弹窗关闭期间后台可能仍在分析；轮询检测本机记录，完成后自动加载报告。
function stopPoll() {
  clearInterval(pollTimer);
  pollTimer = null;
  pollTries = 0;
}

async function maybePollPending() {
  stopPoll();
  try {
    const r = await syncCall("state");
    const record = r.state.records.find((x) => x.id === r.state.active);
    if (!record || record.data.status !== "待补充") return;
  } catch (_) {
    return;
  }
  pollTimer = setInterval(async () => {
    if (busy || document.hidden) return;
    if (++pollTries > 60) { stopPoll(); return; }
    try {
      const r = await syncCall("state");
      const record = r.state.records.find((x) => x.id === r.state.active);
      if (!record) { stopPoll(); return; }
      if (record.data.status === "已完成") {
        const hasDrafts = [...document.querySelectorAll("#questions textarea")].some((t) => t.value.trim());
        if (!hasDrafts) {
          restoreSnapshot(record);
          showToast("后台分析已完成，已加载报告");
        } else {
          showToast("后台分析已完成，可提交当前回答或从历史列表打开记录");
        }
        stopPoll();
      }
    } catch (_) { stopPoll(); }
  }, 4000);
}

async function handleOcrImage(event) {
  if (busy) {
    showToast("正在分析中，请稍候");
    return;
  }
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
  showProgress("正在识别图片文字…");
  hideReport();
  resetConversation();
  try {
    const dataUrl = await readFileAsDataUrl(file);
    const response = await sendMessage({ type: "OCR_ANALYZE", payload: { image: dataUrl } }, SEND_TIMEOUT.ocr);
    if (!response?.ok) {
      showToast(response?.error || "图片识别失败");
      return;
    }
    if (!response.text) {
      showToast("图片中没有识别到文字。可能原因：图片模糊、当前模型不支持图片识别，或截图不含文字。也可以直接粘贴文字检测。");
      return;
    }
    els.jobText.value = response.text;
    await analyzeText(response.text, "", false, true);
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
  if (busy) {
    showToast("正在分析中，请稍候");
    return;
  }
  const seq = ++analysisSeq;
  setBusy(true);
  showProgress("正在抓取当前页面并分析…");
  hideReport();
  resetConversation();
  try {
    const tab = await getActiveTab();
    sourceTabId = tab.id;
    activeRecordId = crypto.randomUUID();
    const response = await sendMessage({ type: "ANALYZE_CURRENT_PAGE", tabId: tab.id, payload: { syncId: activeRecordId, scope: accountScope } }, SEND_TIMEOUT.analysis);
    await handleAnalyzeResponse(response, seq);
  } catch (error) {
    showToast(error.message || "分析当前页面失败");
  } finally {
    setBusy(false);
  }
}

async function analyzeText(text, followUp, reset = true, internal = false) {
  if (!internal && busy) {
    showToast("正在分析中，请稍候");
    return;
  }
  if (!text.trim()) {
    showToast("请先输入兼职招聘信息");
    return;
  }
  const seq = ++analysisSeq;
  setBusy(true);
  showProgress("正在分析招聘信息…");
  hideReport();
  if (reset) resetConversation();
  try {
    activeText = text.trim();
    if (!activeRecordId) activeRecordId = crypto.randomUUID();
    const response = await sendMessage({
      type: "ANALYZE_TEXT",
      payload: { text: activeText, followUp, syncId: activeRecordId, scope: accountScope }
    }, SEND_TIMEOUT.analysis);
    await handleAnalyzeResponse(response, seq);
  } catch (error) {
    showToast(error.message || "检测失败");
  } finally {
    setBusy(false);
  }
}

async function submitFollowUp(forceReport = false) {
  if (busy) {
    showToast("正在分析中，请稍候");
    return;
  }
  forceReport = forceReport === true;
  const answers = currentItems.map((item, index) => ({ ...item, answer: document.getElementById(`answer-${index}`).value.trim() }));
  if (!forceReport && answers.some((a) => !a.answer)) { showToast("请逐题回答；不清楚可填“不知道”。"); return; }
  const next = [...followUpAnswers];
  if (answers.some((a) => a.answer)) next.push({ answers: answers.filter((a) => a.answer) });
  const seq = ++analysisSeq;
  setBusy(true);
  showProgress("正在结合回答继续分析…");
  try {
    const response = await sendMessage({ type: "SUBMIT_FOLLOWUP", payload: { text: activeText, turns: next, forceReport, syncId: activeRecordId, scope: accountScope } }, SEND_TIMEOUT.analysis);
    if (!response?.ok) { showToast(response?.error || "分析失败，请重试"); return; }
    followUpAnswers = next;
    renderFollowUpHistory();
    await handleAnalyzeResponse(response, seq);
  } catch (error) {
    showToast(error.message || "继续分析失败");
  } finally {
    setBusy(false);
  }
}

async function handleAnalyzeResponse(response, seq) {
  if (seq !== undefined && seq !== analysisSeq) return;
  if (!response?.ok) {
    showToast(response?.error || "Agent 未返回结果");
    return;
  }

  if (response.pageSource) {
    const hint = document.getElementById("pageSourceHint");
    hint.textContent = (response.pageSource === "selection" ? "本次分析：你选中的文字" : "本次分析：当前岗位详情") + (response.pageTitle ? ` · ${response.pageTitle}` : "") + (response.pageTruncated ? "（正文较长，仅分析前12000字）" : "") + "。下方可核对抓取原文。";
    hint.classList.remove("hidden");
  }
  if (response.originalText) {
    activeText = response.originalText;
    els.jobText.value = response.originalText;
  }

  if (response.needQuestion) {
    showQuestions(response.questions || [], response.questionItems);
    const sourceText = response.questionSource === "api" ? "大模型已生成场景化追问" : response.questionSource === "local-fallback" ? "大模型追问失败，当前为本地问题" : "当前为本地规则问题";
    const status = document.getElementById("pageSourceHint");
    status.textContent = sourceText + (response.apiError ? `：${response.apiError}` : "") + (response.extractionError ? `；事实抽取已降级：${response.extractionError}` : "");
    status.classList.remove("hidden");
    await persistSnapshot();
    await refreshSync();
  
    showToast(followUpAnswers.length ? `${sourceText}，还需要继续补充` : sourceText);
    return;
  }

  els.agentPanel.classList.add("hidden");
  latestReport = response.report;
  renderReport(response.report);
  currentItems = [];
  await persistSnapshot();
  await refreshSync();
  stopPoll();
}

function showQuestions(questions, items) {
  currentItems = items || questions.map((question, index) => ({ key: `legacy-${index}`, question }));
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
    div.textContent = `第 ${index + 1} 轮：` + answer.answers.map((a) => `\n问：${a.question}\n答：${a.answer}`).join("\n");
    div.style.whiteSpace = "pre-wrap";
    els.followUpHistory.appendChild(div);
  });
}

function renderReport(report) {
  if (!report) return;
  els.reportPanel.classList.remove("hidden");
  els.riskBadge.className = `badge ${badgeClass(report.riskLevel)}`;
  els.riskBadge.textContent = report.riskLevel;
  els.score.textContent = `规则风险分：${report.score} 分`;
  document.getElementById("scoreHelp").textContent = report.scoreExplanation || "分值越高，规则发现的风险线索越多或越严重。0分仅表示未命中规则，不代表安全；不是岗位质量评分或诈骗概率。";
  document.getElementById("modelStatus").textContent = (report.analysisSource === "api" ? `报告：大模型生成（${report.model || "已配置模型"}）` : report.analysisSource === "local-fallback" ? "报告：模型失败，已降级为本地结果" : "报告：本地规则或历史记录，未确认模型调用成功") + (report.apiError ? `；${report.apiError}` : "") + (report.extractionSource ? `；事实抽取：${report.extractionSource === "api" ? "大模型" : "本地规则"}` : "") + (report.extractionError ? `；${report.extractionError}` : "");
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
  const words = [...new Set(keywords.filter((k) => typeof k === "string" && k.trim()))].sort((a, b) => b.length - a.length);
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
  const keywords = [...(latestReport.matchedKeywords || []), ...(latestReport.hitRules || []).flatMap((rule) => rule.matched || [])];
  const text = [activeText, ...followUpAnswers.flatMap((t) => t.answers.map((a) => a.answer))].join("\n");
  const count = renderRiskMarks(text, keywords);
  const preview = document.getElementById("highlightPreview");
  preview.classList.toggle("hidden", !count);
  if (count) preview.scrollIntoView({ block: "nearest", behavior: "smooth" });
  let pageCount = 0;
  if (sourceTabId !== null && keywords.length) {
    try {
      const result = await sendMessage({ type: "HIGHLIGHT_RISKS", tabId: sourceTabId, payload: { keywords } });
      if (result?.ok) { pageCount = result.count || 0; highlightedTabId = sourceTabId; }
    } catch (_) { /* 原网页关闭时仍保留插件内预览。 */ }
  }
  showToast(count || pageCount ? `已标记 ${count} 处风险词${pageCount ? "，原网页也已高亮" : ""}` : "暂无高亮风险词");
}

async function clearHighlights() {
  const target = document.getElementById("highlightText");
  target.textContent = target.textContent;
  if (highlightedTabId !== null) {
    try {
      const result = await sendMessage({ type: "CLEAR_HIGHLIGHTS", tabId: highlightedTabId });
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

async function clearHistory() {
  if (!confirm("清空当前账号的本机记录？未同步的内容会丢失，云端记录不删除。")) return;
  await accountTask(async () => { await syncCall("clearLocal"); resetConversation(); hideReport(); activeText = ""; els.jobText.value = ""; await refreshSync(); });
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
  document.getElementById("pageSourceHint").classList.add("hidden");
  stopPoll();
  activeRecordId = null;
  latestSnapshot = null;
  document.getElementById("syncConsent").checked = false;
  sourceTabId = null;
  document.getElementById("highlightPreview").classList.add("hidden");
  followUpAnswers = [];
  currentItems = [];
  els.followUpHistory.innerHTML = "";
  els.agentPanel.classList.add("hidden");
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

function showToast(text) {
  els.toast.textContent = text;
  els.toast.classList.remove("hidden");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.add("hidden"), 2200);
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

document.getElementById("guestEnterBtn").addEventListener("click", () => {
  showToast("游客模式：检测数据仅保存在本机");
  enterAnalyze().catch((e) => showToast(e.message));
});
document.getElementById("homeLoginBtn").addEventListener("click", () => openLogin().catch((e) => showToast(e.message)));
document.getElementById("homeRegisterBtn").addEventListener("click", () => openRegister().catch((e) => showToast(e.message)));
document.getElementById("homeContinueBtn").addEventListener("click", () => enterAnalyze().catch((e) => showToast(e.message)));
document.getElementById("loginBackHomeBtn").addEventListener("click", () => goHome());
document.getElementById("registerBackHomeBtn").addEventListener("click", () => goHome());
document.getElementById("switchAccountBtn").addEventListener("click", () => goHome());

els.analyzePageBtn.addEventListener("click", analyzeCurrentPage);
els.analyzeTextBtn.addEventListener("click", () => analyzeText(els.jobText.value, ""));
els.submitFollowUpBtn.addEventListener("click", () => submitFollowUp(false));
els.finishBtn.addEventListener("click", () => submitFollowUp(true));
els.sampleBtn.addEventListener("click", fillSample);
els.ocrBtn.addEventListener("click", () => els.ocrInput.click());
els.ocrInput.addEventListener("change", handleOcrImage);
els.highlightBtn.addEventListener("click", highlightRisks);
els.clearHighlightBtn.addEventListener("click", clearHighlights);
els.copyBtn.addEventListener("click", copyReport);
els.exportBtn.addEventListener("click", exportReport);
els.nextRoundBtn.addEventListener("click", startNextRound);
els.cancelWaitBtn.addEventListener("click", startNextRound);
els.clearHistoryBtn.addEventListener("click", clearHistory);
