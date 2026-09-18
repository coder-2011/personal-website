import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('embed resizing validates the sender, supports shrinking, and restores height on unload', () => {
  const listeners = new Map(), cleanup = [], requests = [];
  const frame = {
    tagName:'IFRAME', src:'https://naman.world/embeds/bpe.html', isConnected:true,
    style:{height:'980px'}, contentWindow:{postMessage:(...args) => requests.push(args)},
  };
  const other = {...frame, src:'https://example.com/', style:{height:'100px'}};
  const window = {document:{querySelectorAll:() => [frame, other]}};
  class Plugin {
    app = {workspace:{iterateAllLeaves:() => {}, on:() => {}}};
    registerDomEvent(_target, type, handler) { listeners.set(type, handler); }
    registerEvent() {}
    register(fn) { cleanup.push(fn); }
  }
  const context = {window, module:{}, require:() => ({Plugin})};
  vm.runInNewContext(readFileSync(new URL('../integrations/obsidian/bpe-embed-resize/main.js', import.meta.url), 'utf8'), context);
  new context.module.exports().onload();
  assert.equal(requests.length, 1);
  const send = (height, source = frame.contentWindow, origin = 'null') =>
    listeners.get('message')({data:{type:'bpe:height', height}, source, origin});
  for (const value of [NaN, Infinity, -1, 0, 20001, '1200']) send(value);
  send(1200, {}, 'null');
  send(1200, frame.contentWindow, 'https://example.com');
  assert.equal(frame.style.height, '980px');
  send(1200.2);
  assert.equal(frame.style.height, '1203px');
  send(720, frame.contentWindow, 'https://naman.world');
  assert.equal(frame.style.height, '722px');
  assert.equal(other.style.height, '100px');
  cleanup.forEach(fn => fn());
  assert.equal(frame.style.height, '980px');
});
