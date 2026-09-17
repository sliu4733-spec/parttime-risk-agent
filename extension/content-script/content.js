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
  '[role="dialog"]', 'dialog[open]', 'article', 'main', '[role="main"]'
].join(',');
const JOB_NOISE = 'script,style,noscript,nav,footer,aside,button,input,textarea,select,[role="navigation"],[hidden],[aria-hidden="true"],.job-list,.job-list-box,.job-recommend,.recommend-job,.recommend-list,.related-jobs,.job-card-wrapper,#parttime-risk-warning-box';
const JOB_SECTION = /职位描述|岗位职责|工作职责|工作内容|任职要求|职位要求|岗位要求|任职资格/;
const JOB_PAY = /\d+(?:[.,]\d+)?\s*(?:[-~–—至]\s*\d+(?:[.,]\d+)?)?\s*(?:[kK万千]|元|薪)|薪资|时薪|日薪|月薪/;

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

function extractJobOnce() {
  const selected=window.getSelection()?.toString().trim();
  if(selected && selected.length>=30) return {ok:true,text:selected.slice(0,12000),source:'selection',truncated:selected.length>12000};
  const nodes=new Set(document.querySelectorAll(JOB_DETAIL_SELECTORS));
  // Unknown site: grow a small region from a responsibility/requirements heading.
  for(const el of document.querySelectorAll('h1,h2,h3,h4,h5,dt,strong,b,p,div,span')) {
    if(el.children.length>2 || (el.textContent||'').length>40 || !JOB_SECTION.test(el.textContent||'')) continue;
    let p=el;
    for(let i=0;i<6 && p && p!==document.body;i++,p=p.parentElement) nodes.add(p);
  }
  const candidates=[];
  for(const el of nodes) {
    if(!jobVisible(el) || el.closest('.job-list,.job-list-box,.recommend-list,.related-jobs')) continue;
    // A container with the search list is not a single opened position.
    if(el.querySelectorAll('.job-card-wrapper,.job-list-item,[data-testid="job-card"]').length>1) continue;
    const text=jobText(el);
    if(text.length<60 || !JOB_SECTION.test(text)) continue;
    const salaries=text.match(/\d+\s*[-~–—]\s*\d+\s*[kK万千]/g)||[];
    if(new Set(salaries).size>2) continue;
    const heading=el.querySelector('h1,h2,.job-name,.job-title,[itemprop="title"]');
    const title=heading && jobVisible(heading) ? jobText(heading).slice(0,100) : '';
    const rect=el.getBoundingClientRect();
    const inView=rect.bottom>0 && rect.top<innerHeight && rect.right>0 && rect.left<innerWidth;
    const score=30 + (JOB_PAY.test(text)?20:0) + (title && !JOB_SECTION.test(title)?12:0)
      + (/任职要求|职位要求|岗位要求|任职资格/.test(text)?8:0)
      + (/工作地址|工作地点/.test(text)?5:0) + (inView?8:0)
      + (el.matches('[role="dialog"],dialog[open]')?12:0);
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

function clearHighlights() {
  document.querySelectorAll("mark.parttime-risk-highlight").forEach((mark) => {
    const text = document.createTextNode(mark.textContent || "");
    mark.replaceWith(text);
  });
  document.getElementById("parttime-risk-warning-box")?.remove();
}

function highlightKeywords(keywords) {
  const validKeywords = [...new Set(keywords.filter((item) => item && item.length >= 2))].slice(0, 15);
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
      html = html.replace(new RegExp(escaped, "g"), `<mark class="parttime-risk-highlight">$&</mark>`);
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
  document.head.appendChild(style);
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
