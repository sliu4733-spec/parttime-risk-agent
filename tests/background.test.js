const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('completed background analysis persists without popup callback',async()=>{
 let stored;
 const box={console,importScripts(){},chrome:{runtime:{onInstalled:{addListener(){}},onMessage:{addListener(){}}}}};
 vm.createContext(box);vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/background/service-worker.js'),'utf8'),box);
 box.getSettings=async()=>({});box.getEnabledRules=async()=>[];box.extractInfo=async()=>({});box.getMissingFields=()=>[];
 box.riskScan=()=>({riskLevel:'低风险',score:0});box.buildFinalReport=async()=>({agentSummary:'结果'});
 box.syncDispatch=async m=>{stored=m;};
 await box.analyzeText('工资60红包日结','',{syncId:'record-1234',scope:'test-account'});
 assert.equal(stored.scope,'test-account');assert.equal(stored.record.id,'record-1234');assert.equal(stored.record.data.status,'已完成');assert.equal(stored.record.data.inputText,'工资60红包日结');
 assert.ok(!('apiKey' in stored.record.data));
});

test('guest page analysis injects missing content script without login',async()=>{
 let injected=0,calls=0;
 const box={console,importScripts(){},chrome:{runtime:{onInstalled:{addListener(){}},onMessage:{addListener(){}}},scripting:{executeScript:async()=>{injected++;}}}};
 vm.createContext(box);vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/background/service-worker.js'),'utf8'),box);
 box.sendToTab=async()=>{if(!calls++)throw Error('Receiving end does not exist');return {text:'工资60 日结'};};
 box.analyzeText=async(text,followup,context)=>({ok:true,text,scope:context.scope});
 const r=await box.analyzeCurrentPage(1,{scope:'guest'});assert.equal(r.ok,true);assert.equal(r.scope,'guest');assert.equal(injected,1);
 box.sendToTab=async()=>{throw Error('restricted');};box.chrome.scripting.executeScript=async()=>{throw Error('restricted');};
 assert.match((await box.analyzeCurrentPage(1)).error,/浏览器设置页不能读取/);
 assert.equal(box.compatibleEndpoint('https://api.deepseek.com/anthropic'),'https://api.deepseek.com/chat/completions');
 assert.equal(box.compatibleEndpoint('https://example.com/anthropic'),'https://example.com/anthropic');
});

test('image OCR extracts all text without filtering by job keywords',async()=>{
 const box={console,AbortSignal,URL,fetch,importScripts(){},chrome:{runtime:{onInstalled:{addListener(){}},onMessage:{addListener(){}}}}};
 vm.createContext(box);vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/background/service-worker.js'),'utf8'),box);
 let capturedBody=null;
 box.fetch=async(url,opts)=>{capturedBody=JSON.parse(opts.body);return {ok:true,json:async()=>({choices:[{message:{content:'产品经理 岗位职责 月薪20-30K'}}]})};};
 box.getSettings=async()=>({apiKey:'k',enableApi:true});
 const r=await box.analyzeImage('data:image/png;base64,xxx');
 assert.equal(r.ok,true);assert.equal(r.text,'产品经理 岗位职责 月薪20-30K');
 const userPrompt=capturedBody.messages[1].content[0].text;
 assert.ok(!/不是招聘信息/.test(userPrompt),'OCR 提示词不应要求模型判断内容性质');
 assert.match(userPrompt,/所有文字/);
 // 无 API Key 时给出明确提示
 box.getSettings=async()=>({apiKey:'',enableApi:false});
 const r2=await box.analyzeImage('data:image/png;base64,xxx');
 assert.equal(r2.ok,false);
});

test('image OCR retries empty result and rejects reasoning-only output',async()=>{
 const box={console,AbortSignal,URL,fetch,importScripts(){},chrome:{runtime:{onInstalled:{addListener(){}},onMessage:{addListener(){}}}}};
 vm.createContext(box);vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/background/service-worker.js'),'utf8'),box);
 // 第一次返回空 → 自动换提示词重试成功
 let calls=0;
 box.fetch=async()=>{calls++;return {ok:true,json:async()=>({choices:[{message:{content:calls===1?'NO_TEXT':'客服专员 底薪5000'}}]})};};
 box.getSettings=async()=>({apiKey:'k',enableApi:true});
 const r=await box.analyzeImage('data:image/png;base64,xxx');
 assert.equal(r.ok,true);assert.equal(r.text,'客服专员 底薪5000');assert.equal(calls,2);
 // 内容在 reasoning_content 字段时也能取到
 box.fetch=async()=>({ok:true,json:async()=>({choices:[{message:{content:'',reasoning_content:'运营实习生 日薪150'}}]})});
 const r2=await box.analyzeImage('data:image/png;base64,xxx');
 assert.equal(r2.ok,false);assert.match(r2.error,/未能可靠读取/);
});

function analysisBox() {
 const box={console,AbortSignal,URL,importScripts(){},chrome:{runtime:{onInstalled:{addListener(){}},onMessage:{addListener(){}}}}};
 vm.createContext(box);vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/background/service-worker.js'),'utf8'),box);return box;
}
test('questions do not contaminate extracted facts',async()=>{
 const box=analysisBox();let input,context;
 box.getSettings=async()=>({});box.getEnabledRules=async()=>[];
 box.extractInfo=async(text,a,b,turns)=>{input=text;context=turns;return {};};
 box.getMissingFields=()=>[];box.buildFinalReport=async()=>({agentSummary:'报告'});
 await box.analyzeText('图书馆整理书籍，每小时20元','',{forceReport:true,turns:[{answers:[{key:'fee',question:'是否需要押金500元或刷单？',answer:'不知道'}]}]});
 assert.doesNotMatch(input,/押金|刷单|500/);assert.match(input,/不知道/);assert.equal(context.length,1);
});
test('OCR retries a mistaken recruitment rejection',async()=>{
 const box=analysisBox();let calls=0;
 box.fetch=async()=>({ok:true,json:async()=>({choices:[{message:{content:++calls===1?'暂无招聘相关信息':'明天图书馆整理书籍 20元每小时'}}]})});
 const text=await box.fetchLLMImageOCR({apiKey:'test'},'data:image/png;base64,test');
 assert.match(text,/图书馆/);assert.equal(calls,2);
});
test('question validation removes unrelated funds and already known fields',async()=>{
 const box=analysisBox();box.fetch=async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({questions:[{key:'advance',quote:'图书馆',question:'是否需要充值刷单？'},{key:'location',quote:'图书馆',question:'地址在哪？'},{key:'company',quote:'图书馆',question:'图书馆由哪个单位管理？'}]})}}]})});
 const result=await box.planQuestions('图书馆整理书籍',[],[{key:'company'}],{location:'校内图书馆'},{enableApi:true,apiKey:'test'});
 assert.deepEqual(Array.from(result.items,x=>x.key),['company']);
});

test('unknown model fields remain unknown and daily rate is not settlement',()=>{
 const box=analysisBox();
 assert.equal(box.extractSettlement('整理书籍 150元/天'),'');
 const info=box.normalizeLlmExtraction({jobType:'未明确',company:'',salary:'',settlement:''},'公司地址待定，工资面议，150元/天');
 assert.equal(info.company,'');assert.equal(info.salary,'');assert.equal(info.settlement,'');
});
test('truncated OCR is rejected rather than analyzed as complete evidence',async()=>{
 const box=analysisBox();box.fetch=async()=>({ok:true,json:async()=>({choices:[{finish_reason:'length',message:{content:'图书馆工作'}}]})});
 await assert.rejects(()=>box.fetchLLMImageOCR({apiKey:'test'},'data:image/png;base64,test'),/截断/);
});

test('page extraction failure never calls model; completed report retains exact selected source',async()=>{
 const box=analysisBox();let calls=0;
 box.sendToTab=async()=>({ok:false,error:'请选中目标岗位正文'});
 box.analyzeText=async()=>{calls++;return {ok:true,needQuestion:false,report:{}};};
 assert.equal((await box.analyzeCurrentPage(1)).ok,false);assert.equal(calls,0);
 box.sendToTab=async()=>({ok:true,text:'AI产品经理 30-60K 职责：Agent执行方案',source:'job-detail',title:'AI产品经理'});
 const r=await box.analyzeCurrentPage(1);assert.equal(calls,1);assert.match(r.originalText,/Agent执行方案/);assert.equal(r.pageTitle,'AI产品经理');
});

const hardwareJob='L4硬件产品经理-无人车 30-60K·19薪 北京 本科。岗位职责：负责无人配送车硬件产品线规划与需求管理，主导线控底盘与传感器选型，推进DV/PV试验和量产导入。';
function emptyScan(){return {score:0,riskLevel:'低风险',hitRisks:[],hitRules:[],evidence:[],matchedKeywords:[],scoreBreakdown:[]};}
test('grounding accepts near-verbatim quotes but rejects fabricated evidence',()=>{
  const box=analysisBox();
  const text='负责无人配送车硬件产品线规划 30-60K·19薪。北京';
  assert.equal(box.quoteAnchored('30-60K·19薪',text),true);
  assert.equal(box.quoteAnchored('30-60K·19薪，',text),true);
  assert.equal(box.quoteAnchored('30-60K • 19薪',text),true);
  assert.equal(box.quoteAnchored('负责无人配送车硬件产品线规划…',text),true);
  assert.equal(box.quoteAnchored('30-60K·20薪',text),false);
  assert.equal(box.quoteAnchored('先交500元押金',text),false);
  assert.equal(box.quoteAnchored('x',text),false);
});

test('hardware product role and K salary remain correct without model',async()=>{
 const box=analysisBox();const info=box.extractInfoByRegex(hardwareJob);
 assert.match(info.jobType,/产品经理/);assert.notEqual(info.jobType,'配送/跑腿');assert.equal(info.salary,'30-60K·19薪');
 box.getSettings=async()=>({enableApi:false});
 const report=await box.buildFinalReport(hardwareJob,emptyScan(),info,box.getMissingFields(info));
 assert.doesNotMatch(report.agentSummary,/按小时|按单|按天|车辆押金|交通工具/);
 assert.match(report.agentSummary,/额外薪数是否保底/);assert.equal(report.analysisSource,'local');assert.match(report.scoreExplanation,/不等于安全/);
});
test('model report uses source evidence and dynamic questions, excludes unsupported evidence',async()=>{
 const box=analysisBox();box.getSettings=async()=>({enableApi:true,apiKey:'test',model:'test-model'});
 box.fetch=async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({facts:[{quote:'30-60K·19薪',meaning:'原文给出薪资区间和19薪，额外薪数兑现条件未说明。'}],observations:[{quote:'DV/PV试验和量产导入',meaning:'建议确认试验和量产交付的职责边界。'},{quote:'先交500元押金',meaning:'要求交押金'}],questions:[{key:'salary',quote:'30-60K·19薪',question:'薪资按小时还是按单？'},{key:'compensation',quote:'30-60K·19薪',question:'额外薪数是否保底？'},{key:'validation_scope',quote:'DV/PV试验和量产导入',question:'DV/PV阶段的验收责任如何划分？'}]})}}]})});
 const info=box.extractInfoByRegex(hardwareJob),r=await box.buildFinalReport(hardwareJob,emptyScan(),info,box.getMissingFields(info));
 assert.equal(r.analysisSource,'api');assert.match(r.agentSummary,/验收责任/);assert.doesNotMatch(r.agentSummary,/按小时|500元押金/);assert.equal(r.confirmQuestions.length,2);
});
test('HTTP errors and empty reports are explicitly labeled local fallback',async()=>{
 const box=analysisBox();box.getSettings=async()=>({enableApi:true,apiKey:'secret-key'});const info=box.extractInfoByRegex(hardwareJob);
 box.fetch=async()=>({ok:false,status:401});let r=await box.buildFinalReport(hardwareJob,emptyScan(),info,[]);
 assert.equal(r.analysisSource,'local-fallback');assert.match(r.apiError,/401/);assert.doesNotMatch(r.apiError,/secret-key/);
 box.fetch=async()=>({ok:true,json:async()=>({choices:[{message:{content:''}}]})});r=await box.buildFinalReport(hardwareJob,emptyScan(),info,[]);
 assert.equal(r.analysisSource,'local-fallback');assert.match(r.apiError,/empty/);
});
test('professional questions support new topics and require actual evidence',async()=>{
 const box=analysisBox();box.fetch=async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({questions:[{key:'validation_scope',quote:'DV/PV试验',question:'DV/PV试验由哪些团队共同验收？'},{key:'vehicle_deposit',quote:'车辆押金',question:'车辆押金多少？'}]})}}]})});
 const r=await box.planQuestions(hardwareJob,[],[{key:'settlement'}],box.extractInfoByRegex(hardwareJob),{enableApi:true,apiKey:'test'});
 assert.deepEqual(Array.from(r.items,i=>i.key),['validation_scope']);
});
test('extraction failures expose stage diagnostics rather than silently posing as model facts',async()=>{
 const box=analysisBox();box.fetch=async()=>({ok:false,status:429});
 const r=await box.extractInfo(hardwareJob,true,{enableApi:true,apiKey:'test'});
 assert.equal(r.extractionSource,'local-fallback');assert.match(r.extractionError,/429/);assert.match(r.jobType,/产品经理/);
});
