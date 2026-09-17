const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),http=require('node:http');
function box(fetchImpl=fetch){const b={console,URL,AbortSignal,fetch:fetchImpl,importScripts(){},chrome:{runtime:{onInstalled:{addListener(){}},onMessage:{addListener(){}}}}};vm.createContext(b);vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/background/service-worker.js'),'utf8'),b);return b;}
const settings={endpoint:'https://api.deepseek.com/chat/completions',model:'deepseek-v4-pro',apiKey:'test'};
const response=(content,reason='stop',extra={})=>({ok:true,json:async()=>({choices:[{finish_reason:reason,message:{content,...extra}}]})});
test('official DeepSeek extraction uses JSON mode without thinking; reasoning stages have explicit budgets',()=>{
 const b=box(),e=b.structuredRequestOptions(settings,'extraction',0),q=b.structuredRequestOptions(settings,'questions',0),r=b.structuredRequestOptions(settings,'report',0);
 assert.equal(e.response_format.type,'json_object');assert.equal(e.thinking.type,'disabled');assert.equal(q.thinking.type,'enabled');assert.equal(q.reasoning_effort,'low');assert.equal(r.reasoning_effort,'high');assert.ok(q.max_tokens>=16384);
 assert.equal(b.structuredRequestOptions({...settings,endpoint:'https://other.example/v1/chat/completions'},'report',0).thinking,undefined);
});
test('reasoning-only truncation retries with larger budget, never parses private thinking as facts',async()=>{
 let calls=0,bodies=[];const b=box(async(url,opts)=>{bodies.push(JSON.parse(opts.body));return ++calls===1?response('', 'length',{reasoning_content:'internal'}):response('{"jobType":"产品总监"}');});
 const r=await b.fetchLLMExtraction(settings,'供应链产品总监 60-90K·16薪');assert.equal(r.jobType,'产品总监');assert.equal(calls,2);assert.ok(bodies[1].max_tokens>bodies[0].max_tokens);assert.ok(bodies.every(x=>x.response_format.type==='json_object'));
});
test('content blocks and fenced objects containing braces parse correctly',async()=>{
 const b=box(async()=>response([{type:'text',text:'```json\n{"jobType":"软件工程师","work":"处理 {JSON} 文档"}\n```'}]));
 const r=await b.fetchLLMExtraction(settings,'软件工程师');assert.equal(r.work,'处理 {JSON} 文档');
});
test('empty and reasoning-only replies fail explicitly after a bounded retry',async()=>{
 for(const reasoning of [false,true]){let count=0;const b=box(async()=>{count++;return response('', 'stop',reasoning?{reasoning_content:'not final'}:{});});
 await assert.rejects(()=>b.fetchLLMExtraction(settings,'岗位'),e=>e.outputCode===(reasoning?'reasoning_only':'empty'));assert.equal(count,2);}
});
test('HTTP authentication errors and wrong protocol are not retried as JSON problems',async()=>{
 let count=0;const b=box(async()=>{count++;return {ok:false,status:401};});await assert.rejects(()=>b.fetchLLMExtraction(settings,'岗位'),/401/);assert.equal(count,1);
 b.fetch=async()=>({ok:true,json:async()=>({content:[{type:'text',text:'not chat completions'}]})});await assert.rejects(()=>b.fetchLLMExtraction(settings,'岗位'),e=>e.outputCode==='protocol');
});
test('native HTTP transport handles truncation then complete JSON through real fetch',async()=>{
 let count=0;const server=http.createServer((req,res)=>{let chunks='';req.on('data',c=>chunks+=c);req.on('end',()=>{const body=JSON.parse(chunks);assert.equal(body.stream,false);assert.match(body.messages[1].content,/供应链/);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{finish_reason:++count===1?'length':'stop',message:{content:count===1?'':'{"jobType":"供应链产品总监"}'}}]}));});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {const b=box();const r=await b.fetchLLMExtraction({...settings,endpoint:`http://127.0.0.1:${server.address().port}/chat/completions`},'供应链产品总监');assert.equal(r.jobType,'供应链产品总监');assert.equal(count,2);} finally{await new Promise(resolve=>server.close(resolve));}
});
