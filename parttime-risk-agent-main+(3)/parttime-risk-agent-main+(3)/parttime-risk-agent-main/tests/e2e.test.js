const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),os=require('node:os');
const {JSDOM}=require('../server/node_modules/jsdom');
const {createApp}=require('../server/app');

// 端到端：真实后端 + 真实后台 service worker + popup 页面（大模型关闭，走本地规则）。
test('register → login → full local analysis → report → next round against real server',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'e2e-')),service=await createApp(path.join(dir,'test.sqlite')),server=service.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 let dom,ctx;
 try{
  const endpoint=`http://127.0.0.1:${server.address().port}`;

  // 后台上下文：sync.js + riskRules.js + service-worker.js
  const storage={};let messageListener=null;
  const bg={crypto:require('node:crypto').webcrypto,URL,AbortSignal,fetch,console,importScripts(){},
   chrome:{storage:{local:{async get(k){return {[k]:storage[k]};},async set(o){Object.assign(storage,structuredClone(o));},async remove(k){delete storage[k];}}},
    runtime:{onInstalled:{addListener(){}},onConnect:{addListener(){}},
     onMessage:{addListener(fn){messageListener=fn;}}}}};
  vm.createContext(bg);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/background/sync.js'),'utf8'),bg);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/data/riskRules.js'),'utf8'),bg);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/background/service-worker.js'),'utf8'),bg);

  // popup 上下文：sendMessage 直连后台消息监听器
  dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../extension/popup/popup.html'),'utf8'),{url:'https://extension.example/',runScripts:'outside-only'});
  const w=dom.window;ctx=dom.getInternalVMContext();
  w.HTMLElement.prototype.scrollIntoView=function(){};w.confirm=()=>true;
  w.chrome={runtime:{
   connect(){return {onDisconnect:{addListener(){}}}},
   sendMessage(m,cb){messageListener(m,{},cb);}
  }};
  for(const f of ['popup.js','sync-ui.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/popup',f),'utf8'),ctx);
  const settle=(ms)=>new Promise(r=>setTimeout(r,ms));
  await settle(150);

  // 首页三个入口
  assert.ok(!w.document.getElementById('page-home').classList.contains('hidden'));

  // 注册 → 回到登录页
  w.document.getElementById('homeRegisterBtn').click();await settle(150);
  assert.ok(!w.document.getElementById('page-register').classList.contains('hidden'));
  w.document.getElementById('registerBackendUrl').value=endpoint;
  w.document.getElementById('registerUsername').value='studentA';
  w.document.getElementById('registerPassword').value='password123';
  w.document.getElementById('registerConfirm').value='password123';
  w.document.getElementById('registerBtn').click();await settle(800);
  assert.ok(!w.document.getElementById('page-login').classList.contains('hidden'));
  assert.match(w.document.getElementById('loginNotice').textContent,/注册成功/);
  assert.equal(w.document.getElementById('loginUsername').value,'studentA');

  // 登录 → 进入分析页
  w.document.getElementById('loginPassword').value='password123';
  w.document.getElementById('loginBtn').click();await settle(800);
  assert.ok(!w.document.getElementById('page-analyze').classList.contains('hidden'));
  assert.match(w.document.getElementById('accountInfo').textContent,/studentA/);

  // 输入招聘信息并检测 → 出现追问（薪资、结算等缺失）
  w.document.getElementById('jobText').value='招聘家教兼职，辅导小学生数学，地点面议。';
  w.document.getElementById('analyzeTextBtn').click();await settle(800);
  assert.ok(!w.document.getElementById('agentPanel').classList.contains('hidden'));
  const q1=w.document.getElementById('answer-0');assert.ok(q1);

  // 第一轮逐题回答并提交 → 出现第二轮追问（地点、费用等）
  for(let i=0;i<w.document.querySelectorAll('#questions textarea').length;i++){
   const t=w.document.getElementById(`answer-${i}`);t.value='已确认';t.dispatchEvent(new w.Event('input',{bubbles:true}));
  }
  await settle(150);
  w.document.getElementById('submitFollowUpBtn').click();await settle(800);
  assert.ok(!w.document.getElementById('agentPanel').classList.contains('hidden'));

  // 第二轮回答后按现有信息结束本轮 → 生成报告
  for(let i=0;i<w.document.querySelectorAll('#questions textarea').length;i++){
   const t=w.document.getElementById(`answer-${i}`);t.value='不适用';t.dispatchEvent(new w.Event('input',{bubbles:true}));
  }
  await settle(150);
  w.document.getElementById('finishBtn').click();await settle(800);
  assert.ok(!w.document.getElementById('reportPanel').classList.contains('hidden'));
  assert.ok(w.document.getElementById('agentSummary').textContent.length>0);

  // 报告已保存到本机记录
  const state=await bg.syncDispatch({op:'state'});
  const record=state.state.records.find(r=>r.id===state.state.active);
  assert.equal(record.data.status,'已完成');

  // 下一轮：报告隐藏、输入清空、当前会话指针清除（重开不再恢复上一轮）
  w.document.getElementById('nextRoundBtn').click();
  assert.ok(w.document.getElementById('reportPanel').classList.contains('hidden'));
  assert.equal(w.document.getElementById('jobText').value,'');
  await settle(200);
  const state2=await bg.syncDispatch({op:'state'});
  assert.equal(state2.state.active,null);
  assert.equal(state2.state.records.length,1);
 }finally{
  if(ctx)vm.runInContext('stopPoll()',ctx);
  if(dom)dom.window.close();
  await new Promise(r=>server.close(r));service.close();fs.rmSync(dir,{recursive:true,force:true});
 }
});
