import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function cursorFixture({fine=true, reduced=false}={}) {
  const handlers = new Map(), frames = new Map();
  let next = 0, geometryReads = 0;
  const node = () => ({style:{},classList:{toggle(){},remove(){},add(){}}});
  const cursor=node(),tail=node(),dots=Array.from({length:4},node);
  const links=Array.from({length:3},() => ({...node(),getBoundingClientRect(){geometryReads++;return {left:0,top:0,right:10,bottom:10};}}));
  const pointer={matches:fine,addEventListener(){}},motion={matches:reduced,addEventListener(){}};
  const document={hidden:false,body:node(),querySelector:s=>s==='.site-cursor'?cursor:tail,querySelectorAll:s=>s==='.site-cursor__tail-dot'?dots:links,addEventListener:(name,fn)=>handlers.set(name,fn)};
  const context={document,window:{addEventListener:(name,fn)=>handlers.set(name,fn)},Element:class{},matchMedia:s=>s.includes('pointer:')?pointer:motion,requestAnimationFrame:fn=>{frames.set(++next,fn);return next;},cancelAnimationFrame:id=>frames.delete(id)};
  runInNewContext(readFileSync(new URL('../src/scripts/cursor.mjs',import.meta.url),'utf8'),context);
  const move=(x,y)=>handlers.get('mousemove')({clientX:x,clientY:y,target:null});
  const tick=()=>{const work=[...frames.values()];frames.clear();work.forEach(fn=>fn());};
  return {frames,handlers,document,cursor,move,tick,reads:()=>geometryReads};
}

test('cursor schedules no idle work and batches pointer events into a single frame', () => {
  const f=cursorFixture();assert.equal(f.frames.size,0);
  for(let i=0;i<100;i++)f.move(i,i);
  assert.equal(f.frames.size,1);assert.equal(f.reads(),0);
  let ticks=0;while(f.frames.size&&ticks++<200)f.tick();
  assert.ok(ticks<200);assert.equal(f.frames.size,0);assert.equal(f.reads(),3);
  f.move(400,200);assert.equal(f.frames.size,1);
  f.handlers.get('pagehide')();assert.equal(f.frames.size,0);
  f.handlers.get('pageshow')();f.move(500,300);f.tick();assert.equal(f.cursor.style.opacity,'1');
  f.document.hidden=true;f.handlers.get('visibilitychange')();assert.equal(f.frames.size,0);
});

test('touch devices do no cursor work and reduced motion settles in one frame', () => {
  const touch=cursorFixture({fine:false});touch.move(30,30);assert.equal(touch.frames.size,0);
  const reduced=cursorFixture({reduced:true});reduced.move(10,10);reduced.tick();reduced.move(90,90);reduced.tick();assert.equal(reduced.frames.size,0);
});

test('both default tokenizer examples render without fetching an API', async () => {
  for(const name of ['bpe','unigram']) {
    const html=readFileSync(new URL(`../public/embeds/${name}.html`,import.meta.url),'utf8');
    const example=JSON.parse(html.match(/const defaultExample = (.*);\n/)[1]);
    const encode=html.match(/async function encodeInput\(\) \{[\s\S]*?\n\}/)[0];
    let rendered=0;
    const elements=new Map();const $=id=>{if(!elements.has(id))elements.set(id,{value:example.text,textContent:''});return elements.get(id);};
    const context={API_URL:'https://naman.world/api/'+name,$,traceCache:new Map([[example.text,example.result]]),fetch:()=>{throw new Error('Default example must not fetch');},document:{querySelectorAll:()=>[]},encoder:new TextEncoder(),TextEncoder,AbortController,setTimeout:()=>1,clearTimeout(){},pause(){},render(){rendered++;},makeSteps:()=>[{}],activeRequest:null,generation:0,busy:false,frames:[],data:null,steps:[],position:0};
    await runInNewContext(`${encode}; encodeInput();`,context);
    assert.equal($('input-error').textContent,'');assert.equal(rendered,1,name);
    let requests=0;
    context.fetch=async()=>{requests++;return {status:200,ok:true,json:async()=>example.result};};
    $('input').value='another input';
    await runInNewContext('encodeInput();',context);
    await runInNewContext('encodeInput();',context);
    assert.equal(requests,1,'repeating an input reuses its result');
    for(let i=0;i<6;i++){ $('input').value=`input ${i}`;await runInNewContext('encodeInput();',context); }
    assert.equal(context.traceCache.size,4,'recent inputs use bounded memory');
  }
});
