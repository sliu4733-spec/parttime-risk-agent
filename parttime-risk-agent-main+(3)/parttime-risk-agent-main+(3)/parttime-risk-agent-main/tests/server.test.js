const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../server/app');
test('accounts, persistence, isolation, idempotence, version conflict and tombstone',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'risk-test-')),file=path.join(dir,'test.sqlite');
 let service=await createApp(file),server=service.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 let base=`http://127.0.0.1:${server.address().port}/api`;
 async function call(route,method='GET',body,token){const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,...await r.json()};}
 try{
 const a=await call('/auth/register','POST',{username:'alice',password:'password123'}),b=await call('/auth/register','POST',{username:'bobby',password:'password123'});assert.equal(a.status,200);
 assert.equal((await call('/auth/login','POST',{username:'alice',password:'wrongpass'})).status,401);
 assert.equal((await call('/records')).status,401);
 const data={schema:1,inputText:'工资60红包日结',turns:[],questionItems:[],report:null,status:'待补充',draftAnswers:[],createdAt:new Date().toISOString()};
 const payload={baseVersion:0,mutationId:'mutation-0001',data};
 assert.equal((await call('/records/record-0001','PUT',payload,a.token)).version,1);
 assert.equal((await call('/records/record-0001','PUT',payload,a.token)).version,1);
 assert.equal((await call('/records','GET',null,b.token)).records.length,0);
 assert.equal((await call('/records/record-0001','PUT',{...payload,baseVersion:1,mutationId:'mutation-bbbb',deleted:true},b.token)).status,409);
 assert.equal((await call('/records/record-0001','PUT',{...payload,mutationId:'mutation-0002'},a.token)).status,409);
 assert.equal((await call('/records/record-0002','PUT',{...payload,data:{...data,apiKey:'secret'}},a.token)).status,400);
 assert.equal((await call('/records/record-0001','PUT',{...payload,baseVersion:1,mutationId:'mutation-0003',data:{...data,inputText:'new text'}},a.token)).version,2);
 await new Promise(r=>server.close(r));service.close();
 assert.equal(fs.readFileSync(file).subarray(0,15).toString(),'SQLite format 3');
 service=await createApp(file);server=service.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}/api`;
 assert.equal((await call('/records','GET',null,a.token)).records[0].data.inputText,'new text');
 assert.equal((await call('/records/record-0001','PUT',{baseVersion:2,mutationId:'mutation-delete',deleted:true},a.token)).version,3);
 assert.equal((await call('/records/record-0001','PUT',{...payload,baseVersion:3,mutationId:'mutation-resurrect'},a.token)).status,409);
 assert.equal((await call('/records','GET',null,a.token)).records[0].deleted,true);
 await call('/logout','POST',{},a.token);assert.equal((await call('/records','GET',null,a.token)).status,401);
 }finally{await new Promise(r=>server.close(r));service.close();fs.rmSync(dir,{recursive:true,force:true});}
});
