// Manual end-to-end verification. Requires magpie on PATH; uses an isolated config and mock gateway.
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawn} from 'node:child_process';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const temp=mkdtempSync(join(tmpdir(),'magpie-candy-e2e-'));
const env={...process.env,XDG_CONFIG_HOME:temp,MAGPIE_API_KEY:'test-key'};
let server;
try {
  execFileSync('magpie',['plugin','add',root],{env,encoding:'utf8',timeout:30000,windowsHide:true});
  const command={id:'mock-e2e-1',config:{model:'codex/mock',accounts:['mock-account'],type:'candy',runs:1,context:'simple'}};
  execFileSync('magpie',['plugin','options','magpie-codex-candy-eval',JSON.stringify({request:command,history:[]})],{env,timeout:30000,windowsHide:true});
  let seenAccount='';
  server=createServer(async(req,res)=>{
    seenAccount=req.headers['x-magpie-account'];
    let body='';for await(const part of req)body+=part;
    assert.equal(JSON.parse(body).model,'codex/mock');
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({choices:[{message:{content:'The answer is 21.'}}],usage:{total_tokens:20}}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  const child=spawn(process.execPath,['cli/index.mjs','once','--config',join(temp,'magpie','plugins.json'),'--base','http://127.0.0.1:'+port+'/v1'],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';
  child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
  const exit=await new Promise(resolve=>child.on('close',resolve));
  assert.equal(exit,0,'runner failed: '+stdout+'\n'+stderr);
  assert.equal(seenAccount,'mock-account');
  const options=JSON.parse(readFileSync(join(temp,'magpie','plugins.json'),'utf8')).plugins[0].options;
  assert.equal(options.history[0].status,'correct');
  assert.equal(options.history[0].correct,1);
  assert.equal(options.request,null);
  console.log('PASS: isolated Magpie plugin add → option queue → local mock gateway → recorded correct result');
} finally {
  if(server)await new Promise(resolve=>server.close(resolve));
  rmSync(temp,{force:true,recursive:true});
}
