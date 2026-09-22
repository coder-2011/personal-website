import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {buildOutline} from '../src/lib/blog/outline.mjs';

test('catalogue scrolling reuses positions and remeasures when embed layout changes', () => {
  const frames = new Map(), links = [];
  let next = 0, geometryReads = 0, shift = 0, resized;
  class Node extends EventTarget {
    constructor(tag = 'div') { super(); this.tag = tag; this.children = []; this.dataset = {}; this.attrs = {}; this.classList = {add(){},remove(){},toggle(){}}; }
    append(...nodes) { for (const node of nodes) {node.parentElement = this; this.children.push(node);} }
    setAttribute(name,value) {this.attrs[name] = value;}
    removeAttribute(name) {delete this.attrs[name];}
    querySelector(selector) {return selector === 'ul' ? {replaceWith:node=>this.append(node)} : null;}
    closest() {return null;}
    getBoundingClientRect() {return {top:0,bottom:500};}
  }
  const window = new EventTarget(); window.scrollY = 0;
  const headings = Array.from({length:100}, (_,i) => ({
    id:`heading-${i}`,tagName:'H2',closest:()=>null,
    cloneNode:()=>({textContent:`Heading ${i}`,querySelectorAll:()=>[]}),
    getBoundingClientRect:()=>{geometryReads++;return {top:i*200+shift-window.scrollY};},
  }));
  const nav = new Node(), host = new Node(), tools = new Node(), toggle = new Node(), dialog = new Node(), close = new Node();
  host.querySelector = () => nav; tools.querySelector = () => toggle; dialog.querySelector = () => close;
  const page = new Node();
  page.querySelector = selector => ({'.blog-catalogue':host,'.catalogue-dialog':dialog,'.blog-reading-tools':tools})[selector];
  const body = new Node(); body.querySelectorAll = () => headings;
  const document = {
    fonts:new EventTarget(),
    createElement:tag=>{const node=new Node(tag);if(tag==='a')links.push(node);return node;},
  };
  const context = {buildOutline,document,window,innerHeight:800,matchMedia:()=>({matches:true}),
    requestAnimationFrame:fn=>{frames.set(++next,fn);return next;},cancelAnimationFrame:id=>frames.delete(id),
    ResizeObserver:class {constructor(fn){resized=fn;}observe(){}disconnect(){}},
  };
  const source = readFileSync(new URL('../src/scripts/blog-catalogue.mjs',import.meta.url),'utf8').replace(/^import[^\n]+\n/,'').replace('export function','function');
  const enable = runInNewContext(source+'\nenableCatalogue;',context);
  const cleanup = enable(page,body);
  assert.equal(geometryReads,100);
  const tick=()=>{const work=[...frames.values()];frames.clear();work.forEach(fn=>fn());};
  for(let i=1;i<=100;i++){window.scrollY=i*10;window.dispatchEvent(new Event('scroll'));tick();}
  assert.equal(geometryReads,100,'scrolling does not measure every heading again');
  assert.equal(links.find(link=>link.attrs['aria-current']).dataset.heading,'heading-6');
  shift=300;resized();tick();
  assert.equal(geometryReads,200,'resizing an embed refreshes heading positions');
  assert.equal(links.find(link=>link.attrs['aria-current']).dataset.heading,'heading-4');
  cleanup();
  window.dispatchEvent(new Event('scroll'));assert.equal(frames.size,0);
});
