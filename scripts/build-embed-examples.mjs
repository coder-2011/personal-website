import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { handleBpeRequest } from '../src/lib/bpe/api.mjs';
import { handleUnigramRequest } from '../src/lib/unigram/api.mjs';

for (const [name, handler] of [['bpe', handleBpeRequest], ['unigram', handleUnigramRequest]]) {
  const path = `public/embeds/${name}.html`;
  let html = await readFile(path, 'utf8');
  const input = html.match(/<input id="input" value="([^"]*)"/)[1];
  const response = await handler(new Request(`https://naman.world/api/${name}`, {
    method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({text:input}),
  }));
  if (!response.ok) throw new Error(`Could not generate the ${name} example.`);
  const json = JSON.stringify({text:input, result:await response.json()}).replaceAll('<', '\\u003c');
  const block = `// BEGIN GENERATED EXAMPLE\nconst defaultExample = ${json};\n// END GENERATED EXAMPLE`;
  html = html.replace(/\/\/ BEGIN GENERATED EXAMPLE[\s\S]*?\/\/ END GENERATED EXAMPLE/, block);
  const script = html.split('<script>')[1].split('</script>')[0];
  html = html.replace(/script-src 'sha256-[^']+'/, `script-src 'sha256-${createHash('sha256').update(script).digest('base64')}'`);
  await writeFile(path, html);
}
