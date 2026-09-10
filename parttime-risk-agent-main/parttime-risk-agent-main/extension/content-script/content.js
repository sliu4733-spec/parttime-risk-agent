chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "EXTRACT_PAGE_TEXT") {
    sendResponse({ ok: true, text: extractPageText() });
    return;
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

function extractPageText() {
  const candidates = [
    document.querySelector("main"),
    document.querySelector("article"),
    document.querySelector("[role='main']"),
    document.body
  ].filter(Boolean);
  const text = candidates[0]?.innerText || document.body.innerText || "";
  return text.replace(/\s+/g, " ").trim().slice(0, 12000);
}

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
