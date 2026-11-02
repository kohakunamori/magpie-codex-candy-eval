#!/usr/bin/env node
import {readFileSync,existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {evaluate} from '../lib/eval.mjs';

function argsOf(argv) {
  const opts={};
  for(let i=0;i<argv.length;i++){
    if(argv[i].startsWith('--')){
      const [key,...rest]=argv[i].slice(2).split('=');
      opts[key]=rest.length?rest.join('='):(argv[i+1] && !argv[i+1].startsWith('--')?argv[++i]:true);
    }
  }
  return opts;
}
function configPath(supplied) {
  if(supplied)return resolve(supplied);
  const roots=[
    process.env.XDG_CONFIG_HOME && join(process.env.XDG_CONFIG_HOME,'magpie','plugins.json'),
    process.env.MAGPIE_CONFIG_DIR && join(process.env.MAGPIE_CONFIG_DIR,'plugins.json'),
    join(homedir(),'.config','magpie','plugins.json'),
    process.env.APPDATA && join(process.env.APPDATA,'magpie','plugins.json'),
  ].filter(Boolean);
  return roots.find(existsSync)||roots[0];
}
function getOptions(path) {
  const config=JSON.parse(readFileSync(path,'utf8'));
  const plugin=(config.plugins||[]).find(e=>String(e.spec||'').includes('magpie-codex-candy-eval'));
  if(!plugin)throw new Error('Plugin is not installed. Use magpie plugin add ./magpie-codex-candy-eval');
  return plugin.options||{};
}
function saveOptions(options,magpieBin='magpie') {
  const output=execFileSync(magpieBin,['plugin','options','magpie-codex-candy-eval',JSON.stringify(options)],{encoding:'utf8',timeout:30000,windowsHide:true});
  return output.trim();
}
function shortResult(result){
  const copy={...result};
  if(copy.samples)copy.samples=copy.samples.map(s=>({...s,text:String(s.text||'').slice(0,1000)}));
  if(copy.code)copy.code=copy.code.slice(0,8000);
  if(copy.attribution?.results)copy.attribution.results=copy.attribution.results.slice(0,8);
  return copy;
}
function addHistory(history,result) {
  const old=Array.isArray(history)?history:[];
  const combined=[shortResult(result),...old];
  const counts=new Map();
  return combined.filter(r=>{
    const key=[r.account,r.type].join('/');
    const count=counts.get(key)||0;
    counts.set(key,count+1);
    return count<20;
  }).slice(0,200);
}
function jobsFor(req){
  const base=req.config||{};
  const list=Array.isArray(base.accounts)?base.accounts:Array.isArray(req.accounts)?req.accounts:[base.account];
  const accounts=[...new Set(list.map(s=>String(s||'').trim()).filter(Boolean))];
  if(!accounts.length)throw new Error('Specify at least one account; this runner refuses unpinned evaluations');
  if(accounts.length>50)throw new Error('Too many accounts (limit: 50)');
  return accounts.map(account=>({...base,account}));
}
async function executePending(path,bin,cliOpts) {
  const opts=getOptions(path);
  const request=opts.request;
  if(!request || !request.id || request.id===opts.handledId)return false;
  let jobs;
  try {jobs=jobsFor(request);} catch(e) {
    saveOptions({...opts,request:null,handledId:request.id,running:null,lastError:e.message},bin);
    return true;
  }
  // Mark handled *before* the first billed request: a runner crash must not replay the batch.
  let latest={...opts,handledId:request.id,request:null,lastError:'',running:{id:request.id,started:new Date().toISOString(),done:0,total:jobs.length,error:''}};
  saveOptions(latest,bin);
  for(let i=0;i<jobs.length;i++) {
    let result;
    try{
      result=await evaluate({...jobs[i],base:cliOpts.base,allowRemote:cliOpts['allow-remote']===true,context:jobs[i].context||'codex'});
    }catch(e){
      result={type:jobs[i].type,account:jobs[i].account,model:jobs[i].model,status:'failed',error:e.message,started:new Date().toISOString()};
    }
    latest={...latest,history:addHistory(latest.history,result),running:{...latest.running,done:i+1}};
    saveOptions(latest,bin);
    console.log(JSON.stringify({account:result.account,type:result.type,status:result.status,correct:result.correct,total:result.total}));
  }
  latest={...latest,handledId:request.id,request:null,running:null};
  saveOptions(latest,bin);
  return true;
}
const argv=process.argv.slice(2);
const command=argv[0]||'help';
const opts=argsOf(argv.slice(1));
async function main() {
  if(command==='help' || opts.help) {
    console.log('Usage:\n  node cli/index.mjs run --account EMAIL --model PROVIDER/MODEL --type candy|pelican|fingerprint [--runs 3] [--context simple|codex]\n  node cli/index.mjs once [--config PATH] [--magpie-bin PATH]\n  node cli/index.mjs watch [--interval 2000] [--config PATH] [--magpie-bin PATH]\n\nKeys: set MAGPIE_API_KEY in environment; gateway defaults to loopback 127.0.0.1:3425.');
    return;
  }
  if(command==='run') {
    if(!opts.account)throw new Error('Specify --account for an unambiguous per-account test');
    const r=await evaluate({type:opts.type||'candy',model:opts.model,account:opts.account,effort:opts.effort||'low',runs:opts.runs,variant:opts.variant,context:opts.context||'codex',base:opts.base,allowRemote:opts['allow-remote']===true,go:opts.go});
    console.log(JSON.stringify(r,null,2));
    if(r.status==='failed')process.exitCode=1;
    return;
  }
  if(command!=='watch'&&command!=='once')throw new Error('Unknown command '+command);
  const path=configPath(opts.config), bin=opts['magpie-bin']||'magpie';
  console.log('Monitoring plugin requests via '+path+'; no tests run until requested.');
  const initial=getOptions(path);
  if(initial.running && initial.handledId===initial.running.id){
    saveOptions({...initial,running:null,lastError:'Prior run stopped; remaining requests were NOT automatically retried to avoid spending quota twice.'},bin);
  }
  const once=async()=>{try {await executePending(path,bin,opts);} catch(e){console.error(e.message);if(command==='once')process.exitCode=1;}};
  if(command==='once')return once();
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const interval=Math.min(60000,Math.max(1000,Number(opts.interval)||2000));
  for(;;){await once();await sleep(interval);}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
