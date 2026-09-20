import { resolve, join } from 'node:path';
import { mkdir, copyFile, readFile, writeFile, chmod } from 'node:fs/promises';

const [vaultArgument, site = 'https://naman.world'] = process.argv.slice(2);
if (!vaultArgument) throw new Error('Usage: node scripts/blog/install-plugin.mjs VAULT_PATH [SITE_ORIGIN]');
const vault = resolve(vaultArgument);
const destination = join(vault, '.obsidian/plugins/naman-publish');
let data = {};
try { data = JSON.parse(await readFile(join(destination,'data.json'),'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (Object.keys(data.posts || {}).length && data.site !== site) throw new Error('This installation has posts for another site. Keep its existing origin.');
await mkdir(destination, {recursive:true});
for (const file of ['main.js','manifest.json','styles.css']) await copyFile(join('obsidian-plugin/dist',file), join(destination,file));
const token = process.env.BLOG_PUBLISH_TOKEN;
await writeFile(join(destination,'data.json'), JSON.stringify({...data,site,...(token ? {bootstrapToken:token} : {})},null,2));
await chmod(join(destination,'data.json'),0o600);
console.log(`Installed Naman Publish in ${vault}. Enable it in this vault's Community plugins settings.`);
