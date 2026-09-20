import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('obsidian-plugin/dist', {recursive:true});
await build({ entryPoints:['obsidian-plugin/main.ts'], outfile:'obsidian-plugin/dist/main.js', bundle:true, external:['obsidian'], format:'cjs', platform:'browser', target:'es2022', sourcemap:false, minify:true });
for (const file of ['manifest.json','styles.css']) await copyFile(`obsidian-plugin/${file}`, `obsidian-plugin/dist/${file}`);
