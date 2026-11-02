import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluate,isCandyCorrect,pickChallenges,findPelicanCode} from '../lib/eval.mjs';
import {askGateway,apiBase,extractText,contextMessages} from '../lib/gateway.mjs';

test('candy checks a standalone 21 rather than a substring of 3214',()=>{
  assert.equal(isCandyCorrect('答案是21。'),true);
  assert.equal(isCandyCorrect('3214'),false);
  assert.equal(isCandyCorrect('121'),false);
});
test('unique randomized enrollment challenges',()=>{
  const samples=pickChallenges(3);
  assert.equal(samples.length,3);
  assert.equal(new Set(samples.map(x=>x.challenge_id+x.condition)).size,3);
});
test('pelican requires SVG content',()=>{
  assert.ok(findPelicanCode('<html><svg viewBox="0 0 1 1"></svg></html>').includes('svg'));
  assert.equal(findPelicanCode('I cannot draw'), '');
});
test('candy test with mock gateway',async()=>{
  let n=0;
  const result=await evaluate({type:'candy',model:'codex/gpt',account:'one@example.com',runs:2},async()=>{n++;return{text:n===1?'21':'22',attempts:1,usage:null};});
  assert.equal(result.status,'wrong');assert.equal(result.correct,1);assert.equal(result.total,2);
});
test('pelican test with mock gateway',async()=>{
  const result=await evaluate({type:'pelican',model:'codex/gpt',account:'one'},async()=>({text:'<html><svg></svg></html>',attempts:1}));
  assert.equal(result.status,'completed');
});
test('gateway rejects remote URL by default',()=>assert.throws(()=>apiBase('https://example.com/v1'),/Remote/));
test('gateway response extraction',()=>{
  assert.equal(extractText({choices:[{message:{content:'ok'}}]}),'ok');
  assert.equal(extractText({output:[{content:[{type:'output_text',text:'test'}]}]}),'test');
});
test('pin account in header and use selected model',async()=>{
  let called;
  const fake=async(url,init)=>{called={url,init};return{ok:true,status:200,text:async()=>JSON.stringify({choices:[{message:{content:'21'}}]}),headers:{get:()=>null}};};
  const result=await askGateway({base:'http://127.0.0.1:3425/v1',model:'codex/gpt',account:'名 字',effort:'low',context:'simple'},'test','',fake);
  assert.equal(result.text,'21');
  assert.equal(called.init.headers['X-Magpie-Account'],encodeURIComponent('名 字'));
  assert.equal(JSON.parse(called.init.body).model,'codex/gpt');
  assert.equal(JSON.parse(called.init.body).reasoning_effort,'low');
});
test('HTTP authentication errors never retry',async()=>{
  let calls=0;
  await assert.rejects(()=>askGateway({model:'codex/gpt',context:'simple',base:'http://localhost:3425/v1'},'test','',async()=>{calls++;return{ok:false,status:401,text:async()=>JSON.stringify({error:{message:'bad key'}})};}),/401/);
  assert.equal(calls,1);
});
test('Codex fixture is added only in codex mode',()=>{
  assert.deepEqual(contextMessages({},'simple'),[]);
  assert.equal(contextMessages({base_instructions:'test'},'codex')[0].role,'developer');
});
