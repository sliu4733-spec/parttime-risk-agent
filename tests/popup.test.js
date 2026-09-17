const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {JSDOM}=require('../server/node_modules/jsdom');

function makePopup({onBg,onMessage}={}){
 const storage={};
 const bg={crypto:require('node:crypto').webcrypto,URL,AbortSignal,fetch,console,chrome:{storage:{local:{async get(k){return {[k]:storage[k]};},async set(o){Object.assign(storage,structuredClone(o));},async remove(k){delete storage[k];}}}}};
 vm.createContext(bg);vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/background/sync.js'),'utf8'),bg);
 if(onBg)onBg(bg);
 const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../extension/popup/popup.html'),'utf8'),{url:'https://extension.example/',runScripts:'outside-only'}),w=dom.window,ctx=dom.getInternalVMContext();
 w.HTMLElement.prototype.scrollIntoView=function(){};w.confirm=()=>true;
 w.chrome={runtime:{
  connect(){return {onDisconnect:{addListener(){}}}},
  sendMessage(m,cb){
   if(m.type==='SYNC'){bg.syncDispatch(m).then(cb,e=>cb({ok:false,error:e.message}));return;}
   (onMessage||(()=>cb({ok:true})))(m,cb);
  }
 }};
 for(const f of ['popup.js','sync-ui.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/popup',f),'utf8'),ctx);
 return {dom,w,ctx,bg,storage};
}

test('home page offers entries; guest flow runs questions, answers, report and next round',async()=>{
 let saved;
 const p=makePopup({onMessage:(m,cb)=>{
  if(m.type==='SUBMIT_FOLLOWUP'){saved=m.payload;cb({ok:true,needQuestion:false,report:{riskLevel:'低风险',score:0,agentSummary:'测试报告',matchedKeywords:['押金'],evidence:[]}});return;}
  cb({ok:true});
 }});
 const {w,ctx}=p;const settle=()=>new Promise(r=>setTimeout(r,25));
 await settle();
 assert.ok(!w.document.getElementById('page-home').classList.contains('hidden'));
 assert.ok(w.document.getElementById('page-analyze').classList.contains('hidden'));
 w.document.getElementById('guestEnterBtn').click();await settle();
 assert.ok(!w.document.getElementById('page-analyze').classList.contains('hidden'));
 await vm.runInContext(`activeText='工作需要押金';handleAnalyzeResponse({ok:true,needQuestion:true,questions:['需要押金吗？'],questionItems:[{key:'fee',question:'需要押金吗？'}]},analysisSeq)`,ctx);await settle();
 const input=w.document.getElementById('answer-0');assert.ok(input);
 input.value='不需要';input.dispatchEvent(new w.Event('input',{bubbles:true}));await settle();
 await vm.runInContext('refreshSync(true)',ctx);
 assert.equal(w.document.getElementById('answer-0').value,'不需要');
 await vm.runInContext('submitFollowUp()',ctx);await settle();
 assert.equal(saved.turns[0].answers[0].answer,'不需要');assert.equal(saved.turns[0].answers[0].key,'fee');
 await vm.runInContext('highlightRisks()',ctx);assert.equal(w.document.querySelectorAll('#highlightText mark').length,1);
 await vm.runInContext('clearHighlights()',ctx);assert.equal(w.document.querySelectorAll('#highlightText mark').length,0);
 await vm.runInContext('refreshSync(true)',ctx);assert.ok(!w.document.getElementById('reportPanel').classList.contains('hidden'));
 w.document.getElementById('nextRoundBtn').click();
 assert.ok(w.document.getElementById('reportPanel').classList.contains('hidden'));
 assert.equal(w.document.getElementById('jobText').value,'');
 assert.ok(w.document.getElementById('agentPanel').classList.contains('hidden'));
 assert.ok(!w.document.getElementById('analyzePageBtn').disabled);
 // 下一轮后重开弹窗（模拟）不应再恢复上一轮，但历史记录仍保留
 await settle();
 await vm.runInContext('refreshSync(true)',ctx);
 assert.ok(w.document.getElementById('reportPanel').classList.contains('hidden'));
 assert.equal(w.document.getElementById('jobText').value,'');
 assert.ok(w.document.getElementById('historyList').textContent.length>0);
 vm.runInContext('stopPoll()',ctx);
 p.dom.window.close();
});

test('register redirects to login page; login enters analyze page; logout returns home',async()=>{
 const p=makePopup({onBg(bg){
  bg.fetch=async(url)=>{
   url=String(url);
   if(url.endsWith('/api/auth/register'))return {ok:true,json:async()=>({token:'tok-1',user:{id:'u-1',username:'张三'}})};
   if(url.endsWith('/api/auth/login'))return {ok:true,json:async()=>({token:'tok-2',user:{id:'u-1',username:'张三'}})};
   if(url.endsWith('/api/logout'))return {ok:true,json:async()=>({ok:true})};
   throw new Error('unexpected fetch '+url);
  };
 }});
 const {w}=p;const settle=()=>new Promise(r=>setTimeout(r,35));
 await settle();
 w.document.getElementById('homeRegisterBtn').click();await settle();
 assert.ok(!w.document.getElementById('page-register').classList.contains('hidden'));
 w.document.getElementById('registerUsername').value='张三';
 w.document.getElementById('registerPassword').value='password123';
 w.document.getElementById('registerConfirm').value='password123';
 w.document.getElementById('registerBtn').click();await settle();await settle();
 assert.ok(!w.document.getElementById('page-login').classList.contains('hidden'));
 assert.match(w.document.getElementById('loginNotice').textContent,/注册成功/);
 assert.equal(w.document.getElementById('loginUsername').value,'张三');
 w.document.getElementById('loginPassword').value='password123';
 w.document.getElementById('loginBtn').click();await settle();await settle();
 assert.ok(!w.document.getElementById('page-analyze').classList.contains('hidden'));
 assert.match(w.document.getElementById('accountInfo').textContent,/张三/);
 w.document.getElementById('logoutBtn').click();await settle();await settle();
 assert.ok(!w.document.getElementById('page-home').classList.contains('hidden'));
 assert.ok(w.document.getElementById('homeContinueBtn').hidden);
 p.dom.window.close();
});

test('message timeout releases busy state and shows an error',async()=>{
 const p=makePopup({onMessage:()=>{/* 模拟后台无响应 */}});
 const {w,ctx}=p;const settle=()=>new Promise(r=>setTimeout(r,30));
 await settle();
 await vm.runInContext(`SEND_TIMEOUT.default=60;SEND_TIMEOUT.analysis=60;SEND_TIMEOUT.ocr=60;`,ctx);
 w.document.getElementById('guestEnterBtn').click();await settle();
 w.document.getElementById('jobText').value='招聘信息测试';
 await vm.runInContext('analyzeText(els.jobText.value,"")',ctx);
 await settle();await settle();await settle();
 assert.ok(!w.document.getElementById('analyzePageBtn').disabled);
 assert.match(w.document.getElementById('toast').textContent,/超时/);
 vm.runInContext('stopPoll()',ctx);
 p.dom.window.close();
});

test('reentering analysis starts blank while history remains available',async()=>{
 const p=makePopup();await new Promise(r=>setTimeout(r,25));
 await vm.runInContext(`enterAnalyze()`,p.ctx);
 await vm.runInContext(`(async()=>{activeText='图书馆整理书籍';currentItems=[{key:'fee',question:'有费用吗？'}];await persistSnapshot();await enterAnalyze();})()`,p.ctx);
 assert.equal(p.w.document.getElementById('jobText').value,'');
 assert.ok(p.w.document.getElementById('agentPanel').classList.contains('hidden'));
 assert.ok(p.w.document.getElementById('reportPanel').classList.contains('hidden'));
 assert.match(p.w.document.getElementById('historyList').textContent,/图书馆/);
 assert.equal(vm.runInContext('activeRecordId',p.ctx),null);
 p.dom.window.close();
});

test('report UI explains risk score and exposes model fallback',async()=>{
 const p=makePopup();await new Promise(r=>setTimeout(r,25));
 vm.runInContext(`renderReport({score:0,riskLevel:'低风险',analysisSource:'local-fallback',apiError:'接口返回 HTTP 401',extractionSource:'local',agentSummary:'仅本地结果'})`,p.ctx);
 assert.match(p.w.document.getElementById('score').textContent,/规则风险分/);
 assert.match(p.w.document.getElementById('scoreHelp').textContent,/不代表安全/);
 assert.match(p.w.document.getElementById('modelStatus').textContent,/401/);
 assert.match(p.w.document.getElementById('modelStatus').textContent,/降级/);p.dom.window.close();
});
