let accountScope = 'guest', activeRecordId = null, latestSnapshot = null, accountBusy = false;
const syncEl = (id) => document.getElementById(id);

async function syncCall(op, extra = {}) {
  const result = await sendMessage({ type: 'SYNC', op, scope: accountScope, ...extra }, 20000);
  if (!result?.ok) throw new Error(result?.error || '同步失败');
  return result;
}

function snapshotData() {
  return {
    schema: 1,
    inputText: activeText,
    turns: followUpAnswers,
    questionItems: currentItems,
    report: latestReport,
    status: latestReport ? '已完成' : '待补充',
    draftAnswers: currentItems.map((_, i) => document.getElementById(`answer-${i}`)?.value || ''),
    createdAt: latestSnapshot?.createdAt || new Date().toISOString()
  };
}

async function persistSnapshot() {
  if (!activeText) return;
  if (!activeRecordId) activeRecordId = crypto.randomUUID();
  latestSnapshot = snapshotData();
  await syncCall('save', { record: { id: activeRecordId, data: latestSnapshot } });
  syncEl('syncStatus').textContent = '已保存到本机；需点击同步才会上传';
}

function restoreSnapshot(record) {
  resetConversation();
  hideReport();
  activeRecordId = record.id;
  latestSnapshot = record.data;
  activeText = record.data.inputText;
  els.jobText.value = activeText;
  followUpAnswers = record.data.turns || [];
  renderFollowUpHistory();
  if (record.data.status === '已完成') {
    latestReport = record.data.report;
    renderReport(latestReport);
  } else {
    showQuestions((record.data.questionItems || []).map((i) => i.question), record.data.questionItems || []);
    (record.data.draftAnswers || []).forEach((v, i) => {
      const input = document.getElementById(`answer-${i}`);
      if (input) input.value = v;
    });
  }
  syncEl('syncStatus').textContent = record.conflict ? '存在版本冲突，请在历史列表中处理' : record.dirty ? '本机记录尚未同步' : '已加载同步记录';
}

async function refreshSync(restore = false) {
  const r = await syncCall('state');
  accountScope = r.scope;
  syncEl('accountInfo').textContent = r.user ? `已登录：${r.user.username}` : '游客模式（未登录）';
  syncEl('logoutBtn').hidden = !r.user;
  syncEl('switchAccountBtn').textContent = r.user ? '切换账号' : '登录 / 注册';
  syncEl('historyTitle').textContent = r.user ? '当前账号的个人记录' : '本机记录（游客）';
  els.historyList.replaceChildren();
  for (const record of r.state.records) {
    const row = document.createElement('div');
    row.className = 'history-item';
    const title = document.createElement('div');
    title.textContent = `${record.data.status} · ${record.conflict ? '冲突' : record.dirty ? '未同步' : '已同步'} · ${record.data.inputText.slice(0, 65)}`;
    row.appendChild(title);
    const open = document.createElement('button');
    open.textContent = '打开 / 继续';
    open.onclick = () => accountTask(async () => { restoreSnapshot(record); await syncCall('activate', { id: record.id }); });
    row.appendChild(open);
    const del = document.createElement('button');
    del.textContent = record.version ? '删除云端及本机记录' : '删除本机记录';
    del.onclick = () => accountTask(async () => {
      if (!confirm('确认删除这条记录？已同步记录将同时从云端删除。')) return;
      await syncCall('delete', { id: record.id });
      if (activeRecordId === record.id) { resetConversation(); hideReport(); els.jobText.value = ''; activeText = ''; }
      await refreshSync();
    });
    row.appendChild(del);
    if (record.conflict) {
      const resolve = document.createElement('button');
      resolve.textContent = '采用云端版本（保留本机副本）';
      resolve.onclick = () => accountTask(async () => { await syncCall('resolve', { id: record.id }); await refreshSync(true); });
      row.appendChild(resolve);
    }
    els.historyList.appendChild(row);
  }
  if (!r.state.records.length) els.historyList.textContent = '暂无个人记录';
  if (restore) {
    const record = r.state.records.find((x) => x.id === r.state.active);
    if (record && record.id === activeRecordId) restoreSnapshot(record);
  }
}

async function accountTask(fn, busyText = '') {
  if (accountBusy) return;
  accountBusy = true;
  setBusy(true);
  if (busyText) showProgress(busyText);
  try {
    await fn();
  } catch (e) {
    syncEl('syncStatus').textContent = e.message;
    showToast(e.message);
  } finally {
    accountBusy = false;
    setBusy(false);
  }
}

function goHome() {
  showPage('home');
  initHome().catch((e) => showToast(e.message));
}

async function initHome() {
  const r = await syncCall('state');
  const hint = syncEl('homeAccountHint');
  const cont = syncEl('homeContinueBtn');
  const out = syncEl('homeLogoutBtn');
  if (r.user) {
    hint.hidden = false;
    hint.textContent = `当前已登录：${r.user.username}`;
    cont.hidden = false;
    cont.textContent = `以 ${r.user.username} 身份继续使用`;
    out.hidden = false;
  } else {
    hint.hidden = true;
    cont.hidden = true;
    out.hidden = true;
  }
  showPage('home');
}

async function openLogin() {
  const r = await syncCall('state');
  syncEl('loginBackendUrl').value = r.endpoint || 'http://127.0.0.1:3000';
  syncEl('loginNotice').classList.add('hidden');
  showPage('login');
}

async function openRegister() {
  const r = await syncCall('state');
  syncEl('registerBackendUrl').value = r.endpoint || 'http://127.0.0.1:3000';
  syncEl('registerNotice').classList.add('hidden');
  showPage('register');
}

syncEl('loginBtn').onclick = () => accountTask(async () => {
  const username = syncEl('loginUsername').value.trim(), password = syncEl('loginPassword').value;
  if (!username || !password) throw new Error('请输入用户名和密码');
  await syncCall('login', { endpoint: syncEl('loginBackendUrl').value.trim(), username, password });
  syncEl('loginPassword').value = '';
  await enterAnalyze();
  showToast(`登录成功：${username}`);
}, '正在登录…');

syncEl('registerBtn').onclick = () => accountTask(async () => {
  const username = syncEl('registerUsername').value.trim(), password = syncEl('registerPassword').value;
  if (!username || !password) throw new Error('请输入用户名和密码');
  if (password !== syncEl('registerConfirm').value) throw new Error('两次输入的密码不一致');
  const endpoint = syncEl('registerBackendUrl').value.trim();
  await syncCall('register', { endpoint, username, password });
  // 注册不保持会话，按要求回到登录页重新登录。
  await syncCall('logout');
  syncEl('registerPassword').value = '';
  syncEl('registerConfirm').value = '';
  syncEl('loginBackendUrl').value = endpoint;
  syncEl('loginUsername').value = username;
  syncEl('loginNotice').textContent = `注册成功！请使用账号「${username}」登录。`;
  syncEl('loginNotice').classList.remove('hidden');
  showPage('login');
}, '正在注册…');

syncEl('homeLogoutBtn').onclick = () => accountTask(async () => {
  await syncCall('logout');
  await initHome();
  showToast('已退出登录');
}, '正在退出…');

syncEl('logoutBtn').onclick = () => accountTask(async () => {
  await syncCall('logout');
  resetConversation();
  hideReport();
  activeText = '';
  els.jobText.value = '';
  goHome();
  showToast('已退出登录；本机缓存仍保留，下次登录可继续同步');
}, '正在退出…');

syncEl('uploadBtn').onclick = () => accountTask(async () => {
  if (!syncEl('syncConsent').checked) throw new Error('请先勾选同意上传本条招聘文本、问答和报告');
  if (!activeRecordId) throw new Error('请先完成一次检测');
  const r = await syncCall('upload', { id: activeRecordId });
  await refreshSync();
  syncEl('syncStatus').textContent = r.conflicts ? '同步完成，但其他记录存在冲突' : '当前记录已同步（未上传 API Key 和图片原文件）';
});

syncEl('downloadBtn').onclick = () => accountTask(async () => {
  const r = await syncCall('download');
  await refreshSync(true);
  syncEl('syncStatus').textContent = r.conflicts ? '发现冲突，本机修改已保留，请在历史列表中处理' : '已获取云端记录';
});

// 弹窗失去焦点前保存已填写的答案，无需等待下一次模型请求。
els.questions.addEventListener('input', () => {
  persistSnapshot().catch((e) => { syncEl('syncStatus').textContent = e.message; });
});

initHome().catch((e) => showToast(e.message));
