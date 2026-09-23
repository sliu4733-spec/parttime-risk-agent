const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createApp}=require('../server/app');
function client(){
 const storage={},context={crypto:require('node:crypto').webcrypto,URL,AbortSignal,fetch,console,chrome:{storage:{local:{async get(k){return {[k]:storage[k]};},async set(o){Object.assign(storage,structuredClone(o));},async remove(k){delete storage[k];}}}}};
 vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/background/sync.js'),'utf8'),context);
 return {call:m=>context.syncDispatch(m),offline(v){context.fetch=v?async()=>{throw Error('offline');}:fetch;},storage};
}
test('two clients sync, local offline state, conflict copy, account switching and deletion',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sync-client-')),service=await createApp(path.join(dir,'test.sqlite')),server=service.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{
 const endpoint=`http://127.0.0.1:${server.address().port}`,a=client(),b=client();
 const login={endpoint,username:'student',password:'password123'};
 const aa=await a.call({op:'register',...login}),bb=await b.call({op:'login',...login});assert.equal(aa.scope,bb.scope);
 const scope=aa.scope,data={schema:1,inputText:'兼职工资60',turns:[],questionItems:[{key:'fee',question:'需要押金吗？'}],report:null,status:'待补充',draftAnswers:['没有'],createdAt:new Date().toISOString()};
 await a.call({op:'save',scope,record:{id:'record-1234',data}});await a.call({op:'upload',scope,id:'record-1234'});
 await b.call({op:'download',scope});let bs=await b.call({op:'state'});assert.equal(bs.state.records[0].data.draftAnswers[0],'没有');
 a.offline(true);await a.call({op:'save',scope,record:{id:'record-1234',data:{...data,inputText:'offline edit'}}});await assert.rejects(a.call({op:'upload',scope,id:'record-1234'}),/无法连接后端/);a.offline(false);
 await b.call({op:'save',scope,record:{id:'record-1234',data:{...data,inputText:'remote edit'}}});await b.call({op:'upload',scope,id:'record-1234'});
 await assert.rejects(a.call({op:'upload',scope,id:'record-1234'}),/更新或删除/);let d=await a.call({op:'download',scope});assert.equal(d.conflicts,1);
 await a.call({op:'resolve',scope,id:'record-1234'});let state=(await a.call({op:'state'})).state;assert.equal(state.records.length,2);assert.ok(state.records.some(r=>r.data.inputText==='offline edit'&&r.version===0));
 await b.call({op:'delete',scope,id:'record-1234'});await a.call({op:'download',scope});assert.ok(!(await a.call({op:'state'})).state.records.some(r=>r.id==='record-1234'));
 await a.call({op:'logout'});assert.equal((await a.call({op:'state'})).state.records.length,0);
 await assert.rejects(a.call({op:'save',scope,record:{id:'record-1234',data}}),/账号已变化/);
 await a.call({op:'login',...login});assert.equal((await a.call({op:'state'})).state.records.length,1);
 assert.ok(!JSON.stringify(a.storage).includes('apiKey'));
 }finally{await new Promise(r=>server.close(r));service.close();fs.rmSync(dir,{recursive:true,force:true});}
});
