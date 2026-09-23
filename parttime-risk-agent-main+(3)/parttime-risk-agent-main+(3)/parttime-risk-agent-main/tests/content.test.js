const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {JSDOM}=require('../server/node_modules/jsdom');
const source=fs.readFileSync(path.join(__dirname,'../extension/content-script/content.js'),'utf8');
const detail=(title='AI产品经理（北京）',salary='30-60K·16薪')=>`<h2>${title}</h2><div>${salary} 北京 5-10年 本科</div><h3>职位描述</h3><p>岗位职责：设计AI Agent执行方案，将查询和操作抽象为技能，设计失败恢复与人工接管。</p><h3>任职要求</h3><p>本科及以上，具有客服智能化转型与产品化落地经验，统筹跨团队交付。</p><p>工作地址：北京通州</p>`;
function page(html){
 const dom=new JSDOM(html,{runScripts:'outside-only'}),w=dom.window;
 w.chrome={runtime:{onMessage:{addListener(){}}}};
 w.HTMLElement.prototype.getClientRects=function(){return [{top:0,bottom:600,left:0,right:800}];};
 w.HTMLElement.prototype.getBoundingClientRect=function(){return {top:0,bottom:600,left:0,right:800};};
 vm.runInContext(source,dom.getInternalVMContext());return {dom,w,read:()=>w.extractJobOnce()};
}
test('company recruitment split view extracts opened position, not navigation or cards',()=>{
 const p=page(`<nav>首页 公司 校园 APP 海归</nav><main><section class="job-list"><div class="job-card-wrapper">供应链专家 40-60K</div><div class="job-card-wrapper">硬件经理 50-80K</div></section><section class="job-detail">${detail()}<aside>推荐岗位 客服 3-5K</aside><button>立即沟通</button></section></main>`);
 const r=p.read();assert.equal(r.ok,true);assert.match(r.text,/AI产品经理/);assert.match(r.text,/30-60K/);assert.match(r.text,/人工接管/);assert.doesNotMatch(r.text,/首页|海归|供应链|硬件|推荐岗位|立即沟通/);p.dom.window.close();
});
test('hidden stale detail and recommendations do not contaminate active detail',()=>{
 const p=page(`<div class="job-detail" style="display:none">${detail('旧岗位','10-20K')}</div><div class="job-detail">${detail()}<div class="recommend-list">其他岗位 10-20K</div></div>`);
 assert.doesNotMatch(p.read().text,/旧岗位|其他岗位/);p.dom.window.close();
});
test('SPA change rereads current description rather than cached text',()=>{
 const p=page(`<div class="job-detail">${detail()}</div>`);assert.match(p.read().text,/AI产品经理/);
 p.w.document.querySelector('.job-detail').innerHTML=detail('物流产品负责人','40-70K');assert.match(p.read().text,/物流产品负责人/);assert.doesNotMatch(p.read().text,/AI产品经理/);p.dom.window.close();
});
test('generic semantic detail locates parent with title and salary',()=>{
 const p=page(`<div class="layout"><nav>首页</nav><div class="custom-panel">${detail()}</div></div>`);
 const r=p.read();assert.equal(r.ok,true);assert.match(r.text,/30-60K/);assert.match(r.text,/任职要求/);p.dom.window.close();
});
test('list-only page refuses whole-body fallback',()=>{
 const p=page('<main><nav>首页 公司</nav><div class="job-list">产品经理 30-60K 客服专员 3-5K</div></main>');assert.equal(p.read().ok,false);p.dom.window.close();
});
test('multiple visible details require a selection',()=>{
 const p=page(`<div class="job-detail">${detail()}</div><div class="job-detail">${detail('物流经理','40-80K')}</div>`);assert.equal(p.read().ok,false);
 p.w.getSelection=()=>({toString:()=> 'AI产品经理（北京）30-60K，岗位职责是设计AI Agent执行方案并实现失败恢复和人工接管。'});
 assert.equal(p.read().source,'selection');p.dom.window.close();
});
test('text outside viewport in scrollable detail is preserved',()=>{
 const p=page(`<div class="job-detail">${detail()}<p id="end">补充条件：合同约定绩效奖金支付日期。</p></div>`);
 p.w.document.getElementById('end').getBoundingClientRect=()=>({top:3000,bottom:3100,left:0,right:800});assert.match(p.read().text,/支付日期/);p.dom.window.close();
});
