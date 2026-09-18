import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('both animations include transition time in the same playback intervals', async () => {
  for (const name of ['bpe', 'unigram']) {
    const html = readFileSync(new URL(`../public/embeds/${name}.html`, import.meta.url), 'utf8');
    const options = Array.from(html.matchAll(/<option value="(\d+)"[^>]*>(.*?)<\/option>/g),
      ([, value, label]) => [Number(value), label]);
    assert.deepEqual(options, [[4400,'0.5×'], [2200,'1×'], [1100,'2×']]);
    const play = html.match(/function play\(\) \{[\s\S]*?\n\}/)[0];
    for (const [interval] of options) {
      let now = 0, next = null, id = 0;
      const context = {
        frames:[{}], data:{}, steps:[0,1,2,3], position:0, timer:null, activeRequest:null,
        $: () => ({value:interval}), performance:{now:() => now},
        setTimeout: (callback, delay) => { next = {callback, due:now + delay}; return ++id; },
        pause: () => { context.timer = null; },
        advance: async () => {
          // BPE waits for its merge motion; Unigram renders without that wait.
          now += name === 'bpe' ? 220 : 0;
          if (++context.position === context.steps.length - 1) context.pause();
        },
      };
      runInNewContext(`${play}; play();`, context);
      for (let step = 1; step <= 3; step++) {
        assert.equal(next.due, step * interval, `${name} step ${step} at ${interval} ms`);
        const scheduled = next; next = null; now = scheduled.due;
        await scheduled.callback();
      }
      assert.equal(next, null, 'completion stops scheduling');
    }
  }
});
