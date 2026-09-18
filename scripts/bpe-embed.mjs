import { readFileSync } from 'node:fs';

// Obsidian removes srcdoc; src supplies the identical static frontend there.
const html = readFileSync(new URL('../public/embeds/bpe.html', import.meta.url), 'utf8');
const escaped = html.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
  .replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\n', '&#10;');
console.log(`<iframe src="https://naman.world/embeds/bpe.html" srcdoc="${escaped}" title="GPT-2 BPE animation" sandbox="allow-scripts allow-forms" referrerpolicy="no-referrer" style="width:100%; height:1400px; border:0; border-radius:8px;"></iframe>`);
