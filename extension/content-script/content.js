if (!globalThis.__parttimeRiskContentReady) {
globalThis.__parttimeRiskContentReady = true;
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "EXTRACT_PAGE_TEXT") {
    extractCurrentJob().then(sendResponse).catch(() => sendResponse({ok:false,error:"读取岗位详情失败，请选中岗位正文后重试。"}));
    return true;
  }

  if (message.type === "HIGHLIGHT_RISKS") {
    const keywords = message.payload?.keywords || [];
    clearHighlights();
    const count = highlightKeywords(keywords);
    insertWarningBox(keywords, count);
    sendResponse({ ok: true, count });
    return;
  }

  if (message.type === "CLEAR_HIGHLIGHTS") {
    clearHighlights();
    sendResponse({ ok: true });
  }
});

}

// Read the live DOM on every request: SPA detail panels change without navigation.
const JOB_DETAIL_SELECTORS = [
  '.job-detail', '.job-detail-box', '.job-detail-container', '.job-detail-content',
  '.job-detail-body', '.job-detail-section', '.job-details', '.job-info-detail',
  '[data-testid="job-detail"]', '[itemtype*="JobPosting"]',
  '[class*="job-detail"]', '[class*="position-detail"]', '[class*="post-detail"]',
  '[class*="recruit-detail"]', '[id*="job-detail"]',
  '[role="dialog"]', 'dialog[open]', 'article', 'main', '[role="main"]'
].join(',');
const JOB_CARD_LIKE = '.job-card-wrapper,.job-list-item,.job-card,[data-testid="job-card"],[class*="job-card"],[class*="job-item"],li[data-job-id],[class*="position-card"]';
const JOB_LIST_NOISE = '.job-list,.job-list-box,.job-recommend,.recommend-job,.recommend-list,.related-jobs,.job-card-wrapper,[class*="job-list"],[class*="recommend"],[class*="related-job"],[class*="similar-job"],[class*="hot-job"]';
const JOB_NOISE = 'script,style,noscript,nav,header,footer,aside,button,input,textarea,select,[role="navigation"],[role="banner"],[hidden],[aria-hidden="true"],' + JOB_LIST_NOISE + ',#parttime-risk-warning-box,#parttime-risk-host';
const JOB_SECTION = /职位描述|岗位职责|工作职责|工作内容|任职要求|职位要求|岗位要求|任职资格/;
const JOB_PAY = /\d+(?:[.,]\d+)?\s*(?:[-~–—至]\s*\d+(?:[.,]\d+)?)?\s*(?:[kK万千]|元|薪)|薪资|时薪|日薪|月薪/;

// ===== 兼职招聘相关性信号：多组弱信号叠加，普通新闻/说明页/登录弹窗不会凑够 =====
const JOB_HEADING_RE = /职位描述|岗位职责|工作职责|工作内容|任职要求|职位要求|岗位要求|任职资格|岗位说明|职位信息|岗位介绍|工作要求|招工要求|招聘要求|岗位福利/;
const RECRUIT_RE = /招聘|急招|诚招|高薪招|火热招|招工|招人|招\s*(?:兼职|代理|学徒|客服|服务员|促销员|家教|店员|主播|模特|礼仪|充场|分拣|普工|技工)|应聘|求职|投递|报名|有意者|名额(?:有限|不多)|招满(?:即止|为止)|联系(?:方式|人|电话|微信|QQ|VX|vx)|加(?:微|我|Q|V)|扫码(?:咨询|报名)/;
// 只在“短句叶子节点”上锚定，避免把站点导航里的“招聘”菜单当成帖子
const RECRUIT_ANCHOR_RE = /招(?:聘|募)?(?:兼职|临时工|暑假工|寒假工|日结工|钟点工|短期工)|急招|诚招|高薪急聘|招工|招人|招\s*[\u4e00-\u9fa5]{0,5}(?:服务员|促销员|派发|家教|学徒|普工|技工|店员|收银|客服|模特|礼仪|主播|充场|分拣|骑手|代理)|有意者|名额(?:有限|不多)|招满(?:即止|为止)|立即报名|扫码报名|报名(?:从速|方式|微信|电话)|投递简历|应聘方式|联系(?:电话|方式|微信|人|QQ|VX)|加(?:微|VX|QQ|我)|日结\s*\d/;
const DOMAIN_RE = /兼职|钟点工|临时工|暑假工|寒假工|短期工|日结工|周末工/;
const WORK_RE = /服务员|促销员|促销|派发|传单|地推|家教|补习|辅导|充场|气氛组|暖场|礼仪|模特|主播|话务|客服|分拣|骑手|配送|跑腿|店员|收银|后厨|传菜|洗碗|会务|展会|检票|引导员|代理|打字|录入|试玩|点赞|探店|人偶|玩偶|发单|举牌/;
const PAY_SIGNAL_RE = /\d+(?:[.,]\d+)?\s*(?:[-~–—至]\s*\d+(?:[.,]\d+)?)?\s*(?:[kK万千](?:[·•xX×*]\s*\d+\s*薪)?|元(?:\s*[\/／每]\s*(?:小时|时|天|日|次|单|课时|h|H))?|薪|块钱)|(?:时薪|日薪|月薪|底薪|薪资|工资|报酬|酬劳|佣金|提成|日入|月入)\s*[:：]?\s*\d|\d{2,5}\s*元/;
const SETTLE_RE = /日结|周结|月结|现结|当天结|当日结|当场结|一次一结|课后结|完工结|一单一结|不拖欠/;
const CONDITION_RE = /时间自由|排班|班次|到岗|入职|工期|无需经验|学历不限|男女不限|名额|报名|面试|试岗|接受短期|可做短期|包吃住|双休|弹性/;
const CONTACT_RE = /微信|VX|vx|V信|v信|QQ|qq|电话|手机|联系|扫码|加我|私聊|咨询/;
const LOCATION_RE = /工作地点|工作地址|上班地点|上班地址|面试地址|面试地点|工作城市|办公地址|集合地点/;
// 新闻/科普/案情语境：出现两个及以上这类强标记时，基本可判定为文章而非招聘帖。
const EDITORIAL_STRONG_RE = /本文|记者|报道|新闻|据悉|警方|民警|派出所|嫌疑人|受害人|市民|被骗|骗子|诈骗案|涉案|开庭|法院|检察院|案例|网友称|当事人|律师提醒|文章/;
const NAV_NOISE_SEL = 'nav,header,[role="navigation"],[role="banner"],[class*="navbar"],[class*="main-nav"],[class*="site-nav"],[class*="menu"],footer,[class*="footer"],' + JOB_LIST_NOISE;

function jobPostSignals(text) {
  const head = String(text || "").slice(0, 2000);
  const groups = {};
  let score = 0;
  const add = (name, weight) => { groups[name] = (groups[name] || 0) + weight; score += weight; };
  if (JOB_HEADING_RE.test(head)) add("heading", 3);
  if (RECRUIT_RE.test(head)) add("recruit", 4);
  if (DOMAIN_RE.test(head)) add("domain", 3);
  if (WORK_RE.test(head)) add("work", 2);
  if (PAY_SIGNAL_RE.test(head)) add("pay", 2);
  if (SETTLE_RE.test(head)) add("settle", 3);
  if (CONTACT_RE.test(head)) add("contact", 2);
  if (LOCATION_RE.test(head)) add("location", 1);
  if (CONDITION_RE.test(head)) add("condition", 1);
  return { score, groupCount: Object.keys(groups).length, groups: Object.keys(groups) };
}
// 新闻报道/防骗科普里会引用大量“兼职/日结/加微信”字样，必须排除，避免对文章弹卡片。
function looksLikeEditorial(text) {
  const head = String(text || "").slice(0, 2000);
  const hits = new Set();
  let m;
  const re = new RegExp(EDITORIAL_STRONG_RE.source, "g");
  while ((m = re.exec(head))) hits.add(m[0]);
  return hits.size >= 2;
}
// strict=true 用于 main/article 这类谁都可能有的兜底容器，要求更强的多信号汇聚
function likelyJobPosting(text, strict) {
  if (looksLikeEditorial(text)) return false;
  const s = jobPostSignals(text);
  // main/article 等通用容器还必须带“招聘/结算”意图，百科职业介绍、行业文章才混不过来。
  const hasIntent = !strict || s.groups.includes("recruit") || s.groups.includes("settle");
  return strict
    ? (s.score >= 6 && s.groupCount >= 3 && hasIntent)
    : (s.score >= 5 && s.groupCount >= 2);
}

function jobVisible(el) {
  for (let p=el; p && p.nodeType===1; p=p.parentElement) {
    const style=getComputedStyle(p);
    if (p.hidden || p.getAttribute('aria-hidden')==='true' || style.display==='none' || style.visibility==='hidden' || style.opacity==='0') return false;
  }
  return !!el.getClientRects().length;
}

function jobText(root) {
  // Traverse original nodes so computed visibility is retained. Keep paragraph boundaries.
  const lines=[];
  function visit(el) {
    if (el.nodeType===3) { lines.push(el.nodeValue); return; }
    if (el.nodeType!==1 || el.matches(JOB_NOISE) || !jobVisible(el)) return;
    const block=/^(DIV|P|LI|SECTION|ARTICLE|H[1-6]|BR|TR|DL|DT|DD)$/.test(el.tagName);
    if(block) lines.push('\n');
    for(const child of el.childNodes) visit(child);
    if(block) lines.push('\n');
  }
  visit(root);
  return lines.join('').replace(/[^\S\n]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}

function extractJobOnce(allowSelection = true) {
  // 手动“分析当前页面”优先读取用户选中正文；自动检测不读取选区，避免任意选中文字触发误报。
  if (allowSelection) {
    const selected=window.getSelection()?.toString().trim();
    if(selected && selected.length>=30) return {ok:true,text:selected.slice(0,12000),source:'selection',truncated:selected.length>12000};
  }
  const nodes=new Set(document.querySelectorAll(JOB_DETAIL_SELECTORS));
  // Unknown site: grow a small region from a responsibility/requirements heading.
  for(const el of document.querySelectorAll('h1,h2,h3,h4,h5,dt,strong,b,p,div,span')) {
    if(el.children.length>2 || (el.textContent||'').length>40 || !JOB_SECTION.test(el.textContent||'')) continue;
    if(el.closest(NAV_NOISE_SEL)) continue;
    let p=el;
    for(let i=0;i<6 && p && p!==document.body;i++,p=p.parentElement) nodes.add(p);
  }
  // 社媒/论坛/通用站点：从“招兼职/急招/日结300/加微信”等招聘短语向上长出候选容器。
  for(const el of document.querySelectorAll('h1,h2,h3,h4,h5,p,div,span,td,li')) {
    const t=(el.textContent||'').trim();
    if(el.children.length>2 || t.length>30 || t.length<2) continue;
    if(!RECRUIT_ANCHOR_RE.test(t) || el.closest(NAV_NOISE_SEL)) continue;
    let p=el;
    for(let i=0;i<5 && p && p!==document.body;i++,p=p.parentElement) nodes.add(p);
  }
  const candidates=[];
  for(const el of nodes) {
    if(!jobVisible(el) || el.closest(JOB_LIST_NOISE)) continue;
    // A container with the search list is not a single opened position.
    if(el.querySelectorAll(JOB_CARD_LIKE).length>1) continue;
    const text=jobText(el);
    if(text.length<50) continue;
    // 岗位相关性门槛：job-detail/弹窗/长出的容器用普通门槛；main/article 兜底容器用严格门槛。
    const cls = typeof el.className === 'string' ? el.className : '';
    const isJobSpecific = el.matches('[class*="job"],[class*="position"],[class*="recruit"],[itemtype*="JobPosting"],[role="dialog"],dialog[open]')
      || /job|position|recruit|post/i.test(cls);
    const isGeneric = !isJobSpecific && el.matches('main,article,[role="main"]');
    if(!likelyJobPosting(text, isGeneric)) continue;
    const salaries=text.match(/\d+\s*[-~–—]\s*\d+\s*[kK万千]/g)||[];
    if(new Set(salaries).size>2) continue;
    const heading=el.querySelector('h1,h2,h3,.job-name,.job-title,[itemprop="title"],[class*="job"][class*="name"],[class*="position-name"]');
    const title=heading && jobVisible(heading) ? jobText(heading).slice(0,100) : '';
    const rect=el.getBoundingClientRect();
    const inView=rect.bottom>0 && rect.top<innerHeight && rect.right>0 && rect.left<innerWidth;
    const score=30 + (JOB_PAY.test(text)?20:0) + (title && !JOB_SECTION.test(title)?12:0)
      + (/任职要求|职位要求|岗位要求|任职资格/.test(text)?8:0)
      + (/工作地址|工作地点/.test(text)?5:0) + (inView?8:0)
      + (el.matches('[role="dialog"],dialog[open]')?12:0)
      + (isJobSpecific?6:0);
    candidates.push({el,text,title,score});
  }
  candidates.sort((a,b)=>b.score-a.score || a.text.length-b.text.length);
  const best=candidates[0];
  if(!best) return {ok:false,error:'未定位到当前打开的岗位详情。请打开具体岗位，等待正文加载；也可选中岗位标题、薪资和职责后再点“分析当前页面”，或上传详情截图。'};
  const rival=candidates.find(c=>c!==best && !best.el.contains(c.el) && !c.el.contains(best.el) && c.text!==best.text && c.score>=best.score-5);
  if(rival) return {ok:false,error:'页面中有多个岗位详情，暂时无法确定你要分析哪一个。请选中目标岗位正文后再次分析。'};
  return {ok:true,text:best.text.slice(0,12000),title:best.title,source:'job-detail',truncated:best.text.length>12000};
}

async function extractCurrentJob() {
  let result;
  for(let attempt=0;attempt<3;attempt++) {
    result=extractJobOnce();
    if(result.ok) return result;
    if(attempt<2) await new Promise(resolve=>setTimeout(resolve,300));
  }
  return result;
}

function extractPageText() { return extractJobOnce().text || ''; }

// 高危词：检测完成后必须在招聘原文中以红色突出显示，便于一眼识别可疑内容。
const DANGER_KEYWORDS = ["押金", "垫付", "激活费", "刷单", "备案费"];

function clearHighlights() {
  document.querySelectorAll("mark.parttime-risk-highlight, mark.parttime-risk-danger").forEach((mark) => {
    const text = document.createTextNode(mark.textContent || "");
    mark.replaceWith(text);
  });
  document.getElementById("parttime-risk-warning-box")?.remove();
}

function highlightKeywords(keywords) {
  // 始终把高危词纳入高亮集合：只要招聘原文里出现就标红，避免检测规则遗漏。
  const merged = [...new Set([...(keywords || []), ...DANGER_KEYWORDS])];
  const validKeywords = merged.filter((item) => item && item.length >= 2).slice(0, 20);
  if (!validKeywords.length) return 0;

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const tag = parent.tagName.toLowerCase();
      if (["script", "style", "textarea", "input", "mark"].includes(tag)) return NodeFilter.FILTER_REJECT;
      if (!node.nodeValue || !validKeywords.some((keyword) => node.nodeValue.includes(keyword))) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);

  let count = 0;
  for (const node of nodes) {
    let html = escapeHtml(node.nodeValue || "");
    for (const keyword of validKeywords) {
      const escaped = escapeRegExp(escapeHtml(keyword));
      const cls = DANGER_KEYWORDS.includes(keyword) ? "parttime-risk-danger" : "parttime-risk-highlight";
      html = html.replace(new RegExp(escaped, "g"), `<mark class="${cls}">$&</mark>`);
    }
    if (html !== escapeHtml(node.nodeValue || "")) {
      const span = document.createElement("span");
      span.innerHTML = html;
      node.replaceWith(...span.childNodes);
      count++;
    }
  }

  injectHighlightStyle();
  return count;
}

function insertWarningBox(keywords, count) {
  if (!keywords.length) return;
  const box = document.createElement("div");
  box.id = "parttime-risk-warning-box";
  box.innerHTML = `
    <div class="parttime-risk-title">兼职风险提示</div>
    <div>已在页面中标记 ${count} 处可能风险文字。</div>
    <div class="parttime-risk-keywords">${keywords.slice(0, 8).join("、")}</div>
  `;
  document.documentElement.appendChild(box);
  injectHighlightStyle();
}

function injectHighlightStyle() {
  if (document.getElementById("parttime-risk-style")) return;
  const style = document.createElement("style");
  style.id = "parttime-risk-style";
  style.textContent = `
    mark.parttime-risk-highlight {
      background: #ffe08a !important;
      color: #6b2500 !important;
      padding: 1px 3px !important;
      border-radius: 4px !important;
      box-shadow: 0 0 0 1px rgba(180, 83, 9, .22) !important;
    }
    mark.parttime-risk-danger {
      background: #e00035 !important;
      color: #ffffff !important;
      padding: 1px 4px !important;
      border-radius: 4px !important;
      font-weight: 700 !important;
      box-shadow: 0 0 0 1px rgba(138, 0, 33, .45), 0 1px 4px rgba(224, 0, 53, .35) !important;
    }
    #parttime-risk-warning-box {
      position: fixed !important;
      right: 18px !important;
      bottom: 18px !important;
      z-index: 2147483647 !important;
      max-width: 300px !important;
      padding: 14px 16px !important;
      background: #fff7ed !important;
      color: #431407 !important;
      border: 1px solid #fdba74 !important;
      border-radius: 10px !important;
      box-shadow: 0 12px 30px rgba(67, 20, 7, .18) !important;
      font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
    }
    #parttime-risk-warning-box .parttime-risk-title {
      font-weight: 700 !important;
      margin-bottom: 6px !important;
    }
    #parttime-risk-warning-box .parttime-risk-keywords {
      margin-top: 6px !important;
      font-size: 12px !important;
      color: #9a3412 !important;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ===== 页面自动检测 + 风险小卡片（兼容 SPA、懒加载、后台标签与多款 Chromium 浏览器）=====
const QUICK_CARD_CSS = `
  .pr-card {
    box-sizing: border-box;
    width: 264px;
    max-width: calc(100vw - 24px);
    padding: 14px 16px 16px;
    border-radius: 12px;
    box-shadow: 0 12px 32px rgba(16, 24, 40, .22);
    font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    color: #172033;
    background: #ffffff;
    border: 1px solid #e9e2d3;
  }
  .pr-high { background: #fef3f2; border-color: #fda29b; }
  .pr-mid  { background: #fffbeb; border-color: #fcd34d; }
  .pr-low  { background: #ecfdf3; border-color: #a6f4c5; }
  .pr-close {
    position: absolute; top: 6px; right: 8px; width: 22px; height: 22px;
    line-height: 20px; text-align: center; border: 0; padding: 0;
    background: transparent; color: #667085; font-size: 18px; cursor: pointer;
    border-radius: 6px;
  }
  .pr-close:hover { background: rgba(16,24,40,.1); }
  .pr-level { font-weight: 800; font-size: 15px; margin: 2px 24px 4px 0; }
  .pr-high .pr-level { color: #b42318; }
  .pr-mid .pr-level { color: #b45309; }
  .pr-low .pr-level { color: #047857; }
  .pr-score { font-size: 12px; color: #475467; margin-bottom: 4px; word-break: break-all; }
  .pr-hint { font-size: 12px; color: #667085; margin-bottom: 10px; }
  .pr-report {
    width: 100%; padding: 8px 10px; border: 0; border-radius: 8px;
    background: #2563eb; color: #fff; font-size: 13px; font-weight: 700; cursor: pointer;
  }
  .pr-report:hover { background: #1d4ed8; }
`;

function prHashText(text) {
  const s = String(text || "").slice(0, 4000);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h);
}

function prSendRuntime(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) resolve({ __error: true, message: chrome.runtime.lastError.message });
        else resolve(response);
      });
    } catch (error) {
      resolve({ __error: true, message: error?.message || String(error) });
    }
  });
}

// Service worker 可能被浏览器休眠唤醒，消息通道偶发失败，重试两次。
async function prQuickScanWithRetry(text, title, source) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const resp = await prSendRuntime({ type: "QUICK_SCAN", payload: { text, title, source } });
    if (!resp || resp.__error) {
      if (attempt < 2) await new Promise(r => setTimeout(r, 350 * (attempt + 1)));
      continue;
    }
    return resp;
  }
  return null;
}

function prLevelClass(level) {
  if (level === "高风险") return "high";
  if (level === "中风险") return "mid";
  return "low";
}

function removeQuickCard() {
  document.getElementById("parttime-risk-host")?.remove();
}

function prOpenReport() {
  // 由后台用 chrome.windows.create 打开小弹窗，避免页面 window.open 被拦截或新开标签页。
  prSendRuntime({ type: "OPEN_REPORT" }).catch(() => {});
}

function injectQuickCard(resp) {
  removeQuickCard();
  const host = document.createElement("div");
  host.id = "parttime-risk-host";
  host.style.cssText = "position:fixed!important;right:16px!important;bottom:16px!important;z-index:2147483647!important;width:264px!important;max-width:calc(100vw - 24px)!important;";
  let root = host;
  // Shadow DOM 隔离页面样式，避免被站点 CSS 挤坏；不支持时退回普通节点。
  try { if (host.attachShadow) root = host.attachShadow({ mode: "open" }); } catch (_) {}
  const risks = escapeHtml(((resp.hitRisks || []).slice(0, 3).join("、")) || "未命中明显高危类别");
  root.innerHTML = `
    <style>${QUICK_CARD_CSS}</style>
    <div class="pr-card pr-${prLevelClass(resp.riskLevel)}" role="dialog" aria-label="兼职风险快速检测">
      <button class="pr-close" title="关闭" aria-label="关闭">×</button>
      <div class="pr-level">${escapeHtml(resp.riskLevel || "待检测")}</div>
      <div class="pr-score">规则风险分 ${resp.score ?? 0} · ${risks}</div>
      <div class="pr-hint">已识别到兼职招聘信息</div>
      <button class="pr-report">查看报告</button>
    </div>
  `;
  document.documentElement.appendChild(host);
  // 个别国产内核首帧会把注入的 fixed 元素定位到错误位置，连续两帧强制重排修正。
  requestAnimationFrame(() => {
    void host.offsetHeight;
    host.style.bottom = "18px";
    requestAnimationFrame(() => { host.style.bottom = "16px"; });
  });
  root.querySelector(".pr-close").addEventListener("click", () => {
    removeQuickCard();
    if (globalThis.__prAuto) globalThis.__prAuto.dismissed.add(globalThis.__prAuto.key);
  });
  root.querySelector(".pr-report").addEventListener("click", () => {
    prOpenReport();
    removeQuickCard();
    if (globalThis.__prAuto) globalThis.__prAuto.dismissed.add(globalThis.__prAuto.key);
  });
}

function startAutoDetect() {
  // 测试环境或消息通道不可用时不启动任何定时器/监听。
  if (typeof chrome === "undefined" || !chrome.runtime || typeof chrome.runtime.sendMessage !== "function") return;

  const pr = {
    key: location.href,
    dismissed: new Set(),
    finishedKey: null,
    tries: 0,
    lastHash: "",
    observer: null,
    cleanupScroll: null,
    bodyEl: null,
    startedAt: Date.now()
  };
  globalThis.__prAuto = pr;
  const MAX_TRIES = 40;
  const LIFE_MS = 6 * 60 * 1000;

  const armed = () => !pr.dismissed.has(pr.key) && pr.finishedKey !== pr.key;
  const exhausted = () => pr.tries >= MAX_TRIES || Date.now() - pr.startedAt > LIFE_MS;

  async function run() {
    if (!armed() || exhausted() || document.readyState === "loading") return;
    pr.tries++;
    let result;
    try { result = extractJobOnce(false); } catch (_) { return; }
    if (!result || !result.ok) return;
    if (!likelyJobPosting(result.text, false)) return; // 内容侧二次确认
    const hash = prHashText(result.text);
    if (hash === pr.lastHash) return;
    pr.lastHash = hash;
    const resp = await prQuickScanWithRetry(result.text, result.title, result.source);
    if (resp === null) { pr.lastHash = ""; return; } // 通道失败：允许稍后重试
    if (!resp?.ok || !resp.hasJob) {
      // 后台相关性判定更严格：相同内容不再重复请求，等页面内容变化。
      if (resp?.ok === false) pr.finishedKey = pr.key;
      return;
    }
    if (!armed()) return;
    pr.finishedKey = pr.key;
    stopObservers();
    injectQuickCard(resp);
  }

  function debounce(fn, wait) {
    let t = null;
    return () => { clearTimeout(t); t = setTimeout(() => { t = null; fn(); }, wait); };
  }
  function throttle(fn, wait) {
    let locked = false;
    return () => { if (!locked) { locked = true; setTimeout(() => { locked = false; fn(); }, wait); } };
  }

  function stopObservers() {
    if (pr.observer) { try { pr.observer.disconnect(); } catch (_) {} pr.observer = null; }
    if (pr.cleanupScroll) { try { pr.cleanupScroll(); } catch (_) {} pr.cleanupScroll = null; }
  }

  function ensureObservers() {
    if (pr.observer || !document.body || !("MutationObserver" in window)) return;
    const onMutation = debounce(() => { run(); }, 350);
    pr.observer = new MutationObserver((records) => {
      if (pr.finishedKey === pr.key) return;
      const ownChange = records.every((r) => r.target && r.target.nodeType === 1 && r.target.closest && r.target.closest("#parttime-risk-host"));
      if (ownChange) return;
      onMutation();
    });
    pr.observer.observe(document.body, { childList: true, subtree: true });
    pr.bodyEl = document.body;

    const onScroll = throttle(() => run(), 600);
    const onVisible = () => { if (!document.hidden) run(); };
    const opts = { passive: true, capture: true };
    window.addEventListener("scroll", onScroll, opts);
    window.addEventListener("touchmove", onScroll, opts);
    document.addEventListener("visibilitychange", onVisible);
    pr.cleanupScroll = () => {
      window.removeEventListener("scroll", onScroll, opts);
      window.removeEventListener("touchmove", onScroll, opts);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }

  function resetForNavigation(newKey) {
    removeQuickCard();
    pr.key = newKey;
    pr.tries = 0;
    pr.lastHash = "";
    pr.startedAt = Date.now();
    // 部分 SPA 整页切换会换掉 body 节点，挂在旧 body 上的观察器会静默失效，需要重建。
    if (pr.observer && document.body && document.body !== pr.bodyEl) stopObservers();
    if (!armed()) return;
    [300, 900, 1800, 3200].forEach((d) => setTimeout(run, d));
    ensureObservers();
  }

  function watchNavigation() {
    // SPA 常见的 pushState/replaceState 不触发任何事件，需要包装 history。
    for (const type of ["pushState", "replaceState"]) {
      const original = history[type];
      if (typeof original !== "function") continue;
      history[type] = function () {
        const ret = original.apply(this, arguments);
        try { if (location.href !== pr.key) resetForNavigation(location.href); } catch (_) {}
        return ret;
      };
    }
    window.addEventListener("popstate", () => { if (location.href !== pr.key) resetForNavigation(location.href); });
    window.addEventListener("hashchange", () => { if (location.href !== pr.key) resetForNavigation(location.href); });
  }

  // 初次加载：立即尝试 + 多档延迟重试，覆盖慢加载与分页渲染。
  [0, 500, 1200, 2500, 4500].forEach((d) => setTimeout(run, d));
  ensureObservers();
  watchNavigation();
}

// 仅在首次注入（真正页面加载）时触发；程序化重注入（如手动“分析当前页面”补脚本）不重复弹窗。
if (!globalThis.__parttimeRiskAutoStarted) {
  globalThis.__parttimeRiskAutoStarted = true;
  startAutoDetect();
}
