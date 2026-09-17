// Explicit live smoke test; excluded from npm test. Key never appears in logs or reports.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const key=process.env.DEEPSEEK_API_KEY || (fs.existsSync(path.join(__dirname,'../../.deepseek-test-key'))?fs.readFileSync(path.join(__dirname,'../../.deepseek-test-key'),'utf8').trim():'');
if(!key){console.error('Live test blocked: missing DEEPSEEK_API_KEY or project .deepseek-test-key.');process.exit(2);}
if(/[•●]/.test(key) || /[^\x21-\x7e]/.test(key)){console.error('Live test blocked: key file contains masked dots or invalid characters, not a usable API key.');process.exit(2);}
const b={console,URL,AbortSignal,fetch,importScripts(){},chrome:{runtime:{onInstalled:{addListener(){}},onMessage:{addListener(){}}}}};
vm.createContext(b);vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/background/service-worker.js'),'utf8'),b);
b.getSettings=async()=>({enableApi:true,endpoint:'https://api.deepseek.com/chat/completions',model:'deepseek-v4-pro',apiKey:key});b.getEnabledRules=async()=>[];
const text='L4硬件产品经理-无人车 30-60K·19薪。北京，3-5年，本科。岗位职责：负责无人配送车硬件产品线规划与需求管理，主导线控底盘、域控制器、传感器套件选型评审；推进样车验证、DV/PV试验和量产导入。招聘方：京东物流。工作地址：北京通州区。';
(async()=>{
 const result={date:new Date().toISOString(),provider:'DeepSeek',model:'deepseek-v4-pro',checks:[]};
 const first=await b.analyzeText(text,'',{});
 assert.equal(first.ok,true);
 if(first.needQuestion){assert.equal(first.questionSource,'api');assert.equal(first.extracted.extractionSource,'api');assert.doesNotMatch(first.questions.join(' '),/按小时|按单|车辆押金/);result.questions=first.questions;}
 else assert.equal(first.report.analysisSource,'api');
 result.checks.push('initial analysis uses actual model without fallback');
 const report=await b.analyzeText(text,'',{forceReport:true});assert.equal(report.report.analysisSource,'api');assert.equal(report.report.extractionSource,'api');assert.match(report.report.agentSummary,/30.?60K|19薪/);assert.doesNotMatch(report.report.agentSummary,/(?<![不非])(?:是|为|做|担任)[^。；，\n]{0,6}配送员|按单结算|车辆押金/);
 result.checks.push('final report uses actual model and grounded salary');result.report=report.report.agentSummary;
 fs.writeFileSync(path.join(__dirname,'../live-test-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({passed:result.checks,output:'local-v3/live-test-result.json'}));
})().catch(e=>{console.error('Live test failed:',e.code || e.name, String(e.message).replaceAll(key,'[REDACTED]'));process.exitCode=1;});
