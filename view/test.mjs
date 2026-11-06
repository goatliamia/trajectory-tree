import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createPiSample} from '../analyzers/pi-sample.mjs';
import {generateTraceView} from './generate.mjs';
import {startViewServer} from './serve.mjs';
const directory=await mkdtemp(join(tmpdir(),'trajectory-view-test-'));let serving;
try{
 const input=createPiSample({revision:'view-entry-test'}),copy=JSON.stringify(input);
 const view=await generateTraceView({host:'pi',input,output:join(directory,'view.html')});
 assert.equal(JSON.stringify(input),copy,'Generation does not mutate the native session');
 assert.equal(view.synthetic,true);assert.equal(view.session,input.header.id);
 const html=await readFile(view.output,'utf8');assert.ok(html.includes('data:font/woff2;base64,'));assert.ok(!html.includes('url(\'/fonts/'));
 const english=await generateTraceView({host:'pi',input,locale:'en-US',output:join(directory,'en.html')});
 assert.equal(english.locale,'en');assert.equal(english.capabilities.chatJump,false);assert.equal(english.capabilities.childHistory,'unavailable');
 const englishHtml=await readFile(english.output,'utf8');
 const frozen=JSON.parse(englishHtml.match(/<script id="trace-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
 assert.equal(frozen.sessions[0].turns[0].prompts[0].text,input.entries.find(e=>e.message?.role==='user').message.content[0].text,'English UI preserves native source text');
 await assert.rejects(()=>generateTraceView({host:'pi',input,locale:'fr'}),/Language/);
 serving=await startViewServer(view.output);
 const response=await fetch(serving.url);assert.equal(response.status,200);assert.equal(await response.text(),html);
 assert.equal((await fetch(new URL('/other',serving.url))).status,404,'No directory browsing');
 assert.equal((await fetch(serving.url,{method:'POST'})).status,404,'No write route');
 assert.equal(await (await fetch(serving.url,{method:'HEAD'})).text(),'');
 const cancelled=new AbortController();cancelled.abort();await assert.rejects(()=>generateTraceView({host:'pi',input},{signal:cancelled.signal}));
 await assert.rejects(()=>generateTraceView({host:'codex',snapshot:{thread:{id:'one',path:join(directory,'missing')}},rollout:join(directory,'missing')}),/ENOENT/);
 console.log('View entry passed: native input preserved, bundled assets, exact-file localhost serving, read-only routes and cancellation.');
}finally{
 serving?.close();
 if(!resolve(directory).startsWith(resolve(tmpdir(),'trajectory-view-test-')))throw Error('Unexpected test cleanup path');
 await rm(directory,{recursive:true,force:true});
}
