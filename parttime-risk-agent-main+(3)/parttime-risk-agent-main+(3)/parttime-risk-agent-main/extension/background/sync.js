// Account tokens are separate from model settings. Only explicit snapshots are uploaded.
let syncQueue=Promise.resolve();
function syncDispatch(message){const run=syncQueue.then(()=>syncAction(message));syncQueue=run.catch(()=>{});return run;}
async function syncAuth(){return (await chrome.storage.local.get('syncAuth')).syncAuth||null;}
function syncScope(auth){return auth?`${auth.endpoint}|${auth.user.id}`:'guest';}
async function syncState(auth){return (await chrome.storage.local.get('sync:'+syncScope(auth)))['sync:'+syncScope(auth)]||{records:[],active:null};}
async function syncSave(auth,state){await chrome.storage.local.set({['sync:'+syncScope(auth)]:state});}
async function syncRequest(auth,path,method='GET',body){
 let response;
 try {
  response=await fetch(auth.endpoint+'/api'+path,{method,headers:{'Content-Type':'application/json',...(auth.token?{Authorization:'Bearer '+auth.token}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(5000)});
 } catch (_) { throw new Error(`无法连接后端 ${auth.endpoint}。请双击“启动后端.cmd”并保持窗口开启。无需登录也可检测招聘信息。`); }
 let data;
 try { data=await response.json(); } catch (_) { throw new Error('后端返回格式不正确，请核对地址和端口是否为本项目服务'); }
 if(!response.ok)throw new Error(data.error||`服务返回 ${response.status}`);return data;
}
async function syncAction(m){
 let auth=await syncAuth();let state=await syncState(auth);
 if(m.op==='state')return {ok:true,scope:syncScope(auth),user:auth?.user,endpoint:auth?.endpoint||'http://127.0.0.1:3000',state};
 if(m.op==='login'||m.op==='register'){
  const url=new URL(m.endpoint);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('后端地址只填写 http(s)://主机:端口');
  const endpoint=url.origin;
  const result=await syncRequest({endpoint},'/auth/'+m.op,'POST',{username:m.username,password:m.password});
  auth={endpoint,...result};await chrome.storage.local.set({syncAuth:auth});return syncAction({op:'state'});
 }
 if(m.op==='logout'){
  try{if(auth)await syncRequest(auth,'/logout','POST');}catch(_){}finally{await chrome.storage.local.remove('syncAuth');}
  return syncAction({op:'state'});
 }
 // Reject late UI writes belonging to an account that has since changed.
 if(m.scope!==syncScope(auth))throw new Error('账号已变化，请重新打开插件');
 if(m.op==='save'){
  const index=state.records.findIndex(r=>r.id===m.record.id),old=state.records[index];
  const record={id:m.record.id,data:m.record.data,version:old?.version||0,dirty:true,mutationId:crypto.randomUUID(),deleted:old?.deleted||false};
  if(index<0)state.records.unshift(record);else state.records[index]=record;
  state.active=record.id;await syncSave(auth,state);return {ok:true};
 }
 if(m.op==='activate'){state.active=m.id;await syncSave(auth,state);return {ok:true};}
 if(m.op==='clearActive'){state.active=null;await syncSave(auth,state);return {ok:true};}
 if(m.op==='clearLocal'){state={records:[],active:null};await syncSave(auth,state);return {ok:true};}
 if(m.op==='delete'){
  const r=state.records.find(r=>r.id===m.id);if(!r)return {ok:true};
  if(r.version){if(!auth)throw new Error('请先登录');await syncRequest(auth,'/records/'+r.id,'PUT',{baseVersion:r.version,mutationId:crypto.randomUUID(),deleted:true});}
  state.records=state.records.filter(r=>r.id!==m.id);if(state.active===m.id)state.active=null;await syncSave(auth,state);return {ok:true};
 }
 if(m.op==='download'||m.op==='upload'){
  if(!auth)throw new Error('请先登录后端账号');
  if(m.op==='upload'){
   const r=state.records.find(r=>r.id===m.id);if(!r)throw new Error('请先完成一次检测');
   const result=await syncRequest(auth,'/records/'+r.id,'PUT',{baseVersion:r.version,mutationId:r.mutationId,deleted:false,data:r.data});
   r.version=result.version;r.dirty=false;await syncSave(auth,state);
  }
  const {records}=await syncRequest(auth,'/records');let conflicts=0;
  for(const remote of records){
   let local=state.records.find(r=>r.id===remote.id);
   if(local?.dirty){if(local.version!==remote.version){local.conflict=true;local.deleted=remote.deleted;conflicts++;}continue;}
   if(remote.deleted){state.records=state.records.filter(r=>r.id!==remote.id);if(state.active===remote.id)state.active=null;continue;}
   if(local){Object.assign(local,{data:remote.data,version:remote.version,dirty:false,conflict:false});}
   else state.records.push({...remote,dirty:false,mutationId:crypto.randomUUID()});
  }
  await syncSave(auth,state);return {ok:true,conflicts,state};
 }
 if(m.op==='resolve'){
  if(!auth)throw new Error('请先登录');
  const {records}=await syncRequest(auth,'/records');const remote=records.find(r=>r.id===m.id),local=state.records.find(r=>r.id===m.id);
  if(!remote||!local)throw new Error('记录已变化，请刷新');
  // Keep local edits as a separate, never automatically uploaded copy.
  if(local.dirty)state.records.unshift({id:crypto.randomUUID(),data:local.data,version:0,dirty:true,mutationId:crypto.randomUUID()});
  state.records=state.records.filter(r=>r.id!==m.id);
  if(!remote.deleted)state.records.push({...remote,dirty:false,mutationId:crypto.randomUUID()});
  state.active=remote.deleted?null:remote.id;await syncSave(auth,state);return {ok:true};
 }
 throw new Error('未知同步操作');
}
