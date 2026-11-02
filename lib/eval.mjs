import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {randomInt} from 'node:crypto';
import {askGateway} from './gateway.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const suite = JSON.parse(readFileSync(resolve(ROOT, 'data/enrollment-suite.json'), 'utf8'));
const fixture = JSON.parse(readFileSync(resolve(ROOT, 'data/codex_context.json'), 'utf8'));
export const CANDY_PROMPT = '不使用任何外部工具回答以下问题：\n\n在一个黑色的袋子里放有三种口味的糖果，每种糖果有两种不同的形状（圆形和五角星形，不同的形状靠手感可以分辨）。现已知不同口味的糖和不同形状的数量统计如下表。参赛者需要在活动前决定摸出的糖果数目，那么，最少取出多少个糖果才能保证手中同时拥有不同形状的苹果味和桃子味的糖？（同时手中有圆形苹果味匹配五角星桃子味糖果，或者有圆形桃子味匹配五角星苹果味糖果都满足要求）\n\n        苹果味  桃子味  西瓜味\n圆形       7      9      8\n五角星形   7      6      4\n';
export const PELICAN = {
  original:'不使用任何工具，也不要创建或修改文件，直接在回复中完成以下任务：\n\n创建一个 HTML，内容是 SVG 绘制一个鹈鹕骑自行车的 2D 动画，你不需要任何测试，不要使用外部资产。\n\n在一个HTML代码块中给出完整的 HTML 文件。',
  'all-in-one':'不使用任何工具，也不要创建或修改文件，直接在回复中完成以下任务：\n\n做一张精细的SVG图片，内容是鹈鹕骑着自行车在孙悟空开的大型飞机机翼上骑行，鹈鹕展开翅膀，上面托着秦始皇的北极熊，秦始皇骑在熊上打螺丝。鹈鹕喊出糖果题答案21。\n\n在一个SVG代码块中给出完整的 SVG 文件。'
};
export const isCandyCorrect = text => /(?<!\d)21(?!\d)/.test(text);
export function pickChallenges(n=3, rng=randomInt) {
  if(n<1 || n>suite.length) throw new Error('invalid sample size');
  const indices = Array.from({length:suite.length},(_,i)=>i);
  for(let i=0;i<n;i++){const j=rng(i,indices.length);[indices[i],indices[j]]=[indices[j],indices[i]];}
  return indices.slice(0,n).map(i=>suite[i]);
}
export function findPelicanCode(text) {
  const pattern = new RegExp('\\x60{3}(?:html|svg|xml)?\\s*\\n([\\s\\S]*?)\\x60{3}', 'i');
  const block = text.match(pattern)?.[1] || text;
  return /<svg[\s>]/i.test(block) ? block.slice(0,262144) : '';
}
export async function analyzeFingerprintGo(outputs, command='go') {
  return new Promise((resolvePromise,reject)=>{
    const child=spawn(command,['run','./cmd/fingerprint'],{cwd:ROOT,windowsHide:true,stdio:['pipe','pipe','pipe']});
    let out='',err='',done=false;
    const timer=setTimeout(()=>child.kill(),120000);
    child.on('error',e=>{if(!done){done=true;clearTimeout(timer);reject(e);}});
    child.stdout.on('data',b=>{out+=b.toString();if(out.length>2e6)child.kill();});
    child.stderr.on('data',b=>{err+=b.toString().slice(0,1000);});
    child.on('close',code=>{clearTimeout(timer);if(done)return;done=true;if(code!==0)return reject(new Error('Fingerprint detector: '+err.trim()));try{resolvePromise(JSON.parse(out));}catch(e){reject(e);}});
    child.stdin.end(JSON.stringify(outputs.map(x=>({text:x.text||'',expected_count:x.expected_count||0}))));
  });
}
export async function evaluate(config, transport=askGateway) {
  const {type='candy',model,account='',effort='low'}=config;
  if(!model || !/^[a-zA-Z0-9_.:/-]{1,180}$/.test(model))throw new Error('Select a valid model id (provider/model)');
  if(!['candy','pelican','fingerprint'].includes(type))throw new Error('Unknown test type');
  const opts={...config,model,account,effort,fixture};
  const result={type,model,account,effort,started:new Date().toISOString(),status:'failed',samples:[]};
  const begin=Date.now();
  try {
    if(type==='candy') {
      const runs=Math.min(10,Math.max(1,Number(config.runs)||1));
      for(let i=0;i<runs;i++){
        const a=await transport({...opts,timeout:600000},CANDY_PROMPT);
        result.samples.push({status:isCandyCorrect(a.text)?'correct':'wrong',text:a.text.slice(0,4000),usage:a.usage,attempts:a.attempts,provider:a.provider,servedModel:a.servedModel});
      }
      result.correct=result.samples.filter(x=>x.status==='correct').length;
      result.total=result.samples.length;
      result.status=result.correct===result.total?'correct':'wrong';
    }else if(type==='pelican') {
      const variant=config.variant==='all-in-one'?'all-in-one':'original';
      const a=await transport({...opts,timeout:600000},PELICAN[variant]);
      const code=findPelicanCode(a.text);
      result.variant=variant;
      result.status=code?'completed':'invalid';
      result.code=code.slice(0,20000);
      result.samples=[{text:a.text.slice(0,3000),attempts:a.attempts,usage:a.usage}];
    }else {
      const challenges=pickChallenges(3);
      for(const q of challenges){
        const prompt=q.user_prefix ? q.user_prefix+'\n\nFinal task:\n'+q.prompt : q.prompt;
        try {
          const a=await transport({...opts,effort:'none',timeout:180000},prompt,q.system || '');
          result.samples.push({text:a.text.slice(0,64000),expected_count:q.expected_count,challenge_id:q.challenge_id,usage:a.usage});
        }catch(e){ result.samples.push({text:'',expected_count:q.expected_count,error:e.message,challenge_id:q.challenge_id});}
      }
      try {
        result.attribution=await analyzeFingerprintGo(result.samples,config.go || 'go');
        result.status=result.attribution.decision==='not_model'?'not_model':(result.attribution.decision==='partial'?'partial':'completed');
      }catch(e){
        result.status='partial';
        result.warning='Raw samples collected, calibrated attribution unavailable: '+e.message;
      }
      result.samples=result.samples.map(s=>({...s,text:s.text.slice(0,1200)}));
    }
  }catch(e){result.error=e.message;result.status='failed';}
  result.durationMs=Date.now()-begin;
  return result;
}
