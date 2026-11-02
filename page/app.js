const $=id=>document.getElementById(id);
const fields=['model','accounts','type','effort','runs','variant','context'];
const el=(name,txt,cls='')=>{const d=document.createElement(name);d.textContent=txt;if(cls)d.className=cls;return d;};
let current={};
async function load() {
  current=await magpie.options.get()||{};
  for (const key of fields){
    const value=key==='accounts'?(current.accounts||''):current[key];
    if(value!==undefined && document.activeElement!==$(key))$(key).value=value;
  }
  const busy=!!current.running || !!current.request;
  $('run').disabled=busy;
  if(current.running){
    const r=current.running;
    $('status').textContent='正在测试 '+r.done+'/'+r.total+' 个账号。';
  }else if(current.request){$('status').textContent='已提交测试请求，等待本地运行器接收……';}
  else {$('status').textContent='就绪（需要在终端启动 watch 才能运行测试）';}
  const root=$('history');root.replaceChildren();
  if(!(current.history||[]).length){root.append(el('p','暂无历史记录'));return;}
  for(const r of current.history){
    const entry=el('article','','entry');
    const heading=el('div','','heading');
    const left=el('strong',r.account+' · '+r.type+' · '+r.status,/^(correct|completed)$/.test(r.status)?'good':r.status==='wrong'||r.status==='failed'?'bad':'');
    heading.append(left,el('span',new Date(r.started||Date.now()).toLocaleString(),'meta'));
    entry.append(heading,el('div',r.model+' · '+(r.durationMs||0)+' ms · '+(r.correct===undefined?'':(r.correct+'/'+r.total)),'meta'));
    if(r.attribution?.prediction)entry.append(el('p','指纹推测：'+r.attribution.prediction_name+' ('+r.attribution.prediction+')；置信值 '+(r.attribution.probability??'未知')));
    if(r.warning)entry.append(el('p',r.warning,'bad'));
    if(r.error)entry.append(el('p',r.error,'bad'));
    const details=el('details','');
    details.append(el('summary','展开结果/代码'),el('pre',JSON.stringify(r,null,2)));
    entry.append(details);root.append(entry);
  }
}
async function onStart(ev){
  ev.preventDefault();
  try{
    const accounts=$('accounts').value.split(/[\n,]/).map(s=>s.trim()).filter(Boolean);
    if(!accounts.length)throw new Error('请输入至少一个账号');
    const config={model:$('model').value.trim(),accounts,type:$('type').value,effort:$('effort').value,runs:Number($('runs').value),variant:$('variant').value,context:$('context').value};
    const request={id:Date.now()+'-'+Math.random().toString(36).slice(2),config};
    current=await magpie.options.set({...current,...config,accounts:$('accounts').value,request});
    await load();
  }catch(e){$('status').textContent='错误：'+e.message;}
}
async function init(){
  try{
    await magpie.ready;
    await load();
    $('form').addEventListener('submit',onStart);
    $('refresh').addEventListener('click',()=>load().catch(e=>$('status').textContent=e.message));
    $('clear').addEventListener('click',async()=>{current=await magpie.options.set({...current,history:[]});await load();});
    setInterval(()=>load().catch(()=>{}),3500);
  }catch(e){$('status').textContent='插件页面错误：'+e.message;}
}
init();
