const express = require('express');
const initSqlJs = require('sql.js');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {promisify} = require('node:util');
const scrypt = promisify(crypto.scrypt);
const digest = s => crypto.createHash('sha256').update(s).digest('hex');

async function createApp(file = path.join(__dirname,'data','sync.sqlite')) {
 const SQL = await initSqlJs();
 const db = fs.existsSync(file) ? new SQL.Database(fs.readFileSync(file)) : new SQL.Database();
 db.run(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS records(user_id TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,payload TEXT NOT NULL,mutation TEXT NOT NULL,updated TEXT NOT NULL,PRIMARY KEY(user_id,id));`);
 function save(){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',Buffer.from(db.export()),{mode:0o600});fs.renameSync(file+'.tmp',file);}
 save();
 function one(sql,params=[]){const st=db.prepare(sql);try{st.bind(params);return st.step()?st.getAsObject():null;}finally{st.free();}}
 function all(sql,params=[]){const st=db.prepare(sql),rows=[];try{st.bind(params);while(st.step())rows.push(st.getAsObject());return rows;}finally{st.free();}}
 const app=express();app.disable('x-powered-by');
 app.use(express.json({limit:'512kb'}));
 app.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
 const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
 const attempts=new Map();
 app.get('/api/health',(_,res)=>res.json({ok:true,service:'parttime-sync',version:'3.0.0'}));
 app.use('/api/auth',(req,res,next)=>{
  const now=Date.now(), key=req.ip;let v=attempts.get(key);
  if(!v||v.until<now){v={n:0,until:now+60000};attempts.set(key,v);}
  if(++v.n>30)return res.status(429).json({error:'操作过于频繁，请稍后重试'});
  if(attempts.size>10000)for(const [k,a] of attempts)if(a.until<now)attempts.delete(k);
  next();
 });
 for(const action of ['register','login'])app.post('/api/auth/'+action,wrap(async(req,res)=>{
  const {username,password}=req.body;
  if(typeof username!=='string'||! /^[\p{L}\p{N}_-]{3,32}$/u.test(username)||typeof password!=='string'||password.length<8||password.length>128)return res.status(400).json({error:'用户名3–32位；密码8–128位'});
  let user=one('SELECT * FROM users WHERE username=?',[username]);
  if(action==='register'){
   if(user)return res.status(409).json({error:'用户名已存在'});
   const salt=crypto.randomBytes(16).toString('hex'),hash=(await scrypt(password,salt,64)).toString('hex');
   user={id:crypto.randomUUID(),username,salt,hash};
   if(one('SELECT id FROM users WHERE username=?',[username]))return res.status(409).json({error:'用户名已存在'});
   db.run('INSERT INTO users VALUES(?,?,?,?)',[user.id,username,salt,hash]);
  }else{
   const hash=await scrypt(password,user?.salt||'invalid-user-salt',64);
   if(!user||!crypto.timingSafeEqual(hash,Buffer.from(user.hash,'hex')))return res.status(401).json({error:'用户名或密码错误'});
  }
  const token=crypto.randomBytes(32).toString('hex');
  db.run('DELETE FROM sessions WHERE expires<?',[Date.now()]);
  db.run('INSERT INTO sessions VALUES(?,?,?)',[digest(token),user.id,Date.now()+7*86400000]);save();
  res.json({token,user:{id:user.id,username:user.username}});
 }));
 app.use('/api',(req,res,next)=>{
  const token=(req.get('Authorization')||'').replace(/^Bearer /,'');
  const session=one('SELECT * FROM sessions WHERE token=? AND expires>?',[digest(token),Date.now()]);
  if(!session)return res.status(401).json({error:'登录已失效，请重新登录'});
  req.uid=session.user_id;req.tokenHash=digest(token);next();
 });
 app.post('/api/logout',(req,res)=>{db.run('DELETE FROM sessions WHERE token=?',[req.tokenHash]);save();res.json({ok:true});});
 app.get('/api/records',(req,res)=>res.json({records:all('SELECT * FROM records WHERE user_id=? ORDER BY updated DESC',[req.uid]).map(r=>({id:r.id,version:r.version,deleted:!!r.deleted,updated:r.updated,data:r.deleted?null:JSON.parse(r.payload)}))}));
 app.put('/api/records/:id',(req,res)=>{
  const {baseVersion,mutationId,deleted=false,data}=req.body,id=req.params.id;
  if(!/^[a-zA-Z0-9-]{8,80}$/.test(id)||!Number.isInteger(baseVersion)||baseVersion<0||typeof mutationId!=='string'||! /^[a-zA-Z0-9-]{8,80}$/.test(mutationId)||typeof deleted!=='boolean')return res.status(400).json({error:'无效记录或版本'});
  const previous=one('SELECT * FROM records WHERE user_id=? AND id=?',[req.uid,id]);
  // Retrying the exact last write is safe even after a lost response.
  if(previous?.mutation===mutationId)return res.json({id,version:previous.version,deleted:!!previous.deleted});
  if((previous?.version||0)!==baseVersion||previous?.deleted)return res.status(409).json({error:'云端记录已更新或删除，请先下载云端版本；本地内容仍保留',version:previous?.version||0});
  let payload='{}';
  if(!deleted){
   const allowed=['schema','inputText','turns','questionItems','report','status','draftAnswers','createdAt'];
   if(!data||Object.keys(data).some(k=>!allowed.includes(k))||data.schema!==1||typeof data.inputText!=='string'||data.inputText.length>30000||!Array.isArray(data.turns)||data.turns.length>3||!Array.isArray(data.questionItems)||data.questionItems.length>3||!['待补充','已完成'].includes(data.status))return res.status(400).json({error:'记录格式错误（仅允许会话字段，不接受设置或密钥）'});
   const question=q=>q&&typeof q.key==='string'&&q.key.length<=80&&typeof q.question==='string'&&q.question.length<=500;
   if(!data.questionItems.every(question)||!data.turns.every(t=>t&&Array.isArray(t.answers)&&t.answers.length<=3&&t.answers.every(a=>question(a)&&typeof a.answer==='string'&&a.answer.length<=20000))||!Array.isArray(data.draftAnswers)||data.draftAnswers.length>3||!data.draftAnswers.every(a=>typeof a==='string'&&a.length<=20000)||typeof data.createdAt!=='string'||(data.status==='已完成'&&(!data.report||typeof data.report!=='object')))return res.status(400).json({error:'问答或报告结构无效'});
   payload=JSON.stringify(data);
   if(/"(?:apiKey|api_key|password|token|authorization)"\s*:/i.test(payload))return res.status(400).json({error:'同步内容不能包含密钥或凭证字段'});
  }
  const version=baseVersion+1;
  db.run('INSERT OR REPLACE INTO records VALUES(?,?,?,?,?,?,?)',[req.uid,id,version,deleted?1:0,payload,mutationId,new Date().toISOString()]);save();res.json({id,version,deleted});
 });
 app.use((err,req,res,next)=>{res.status(err.status===413?413:err.type==='entity.parse.failed'?400:500).json({error:err.status===413?'记录过大':err.type==='entity.parse.failed'?'请求格式错误':'服务异常，请稍后重试'});});
 return {app,close(){db.close();}};
}
if(require.main===module)createApp().then(({app})=>{
 const host=process.env.HOST||'127.0.0.1',port=Number(process.env.PORT||3000);
 app.listen(port,host,()=>console.log(`Sync server: http://${host}:${port} (SQLite: server/data/sync.sqlite)`));
}).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={createApp};
