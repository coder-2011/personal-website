import cloudflare from "@astrojs/cloudflare";
import { defineConfig } from "astro/config";

export default defineConfig({
  // Shared scripts should be cached across pages instead of repeated inside each HTML response.
  vite: {
    define: { 'import.meta.env.SITE_BUILD_ID': JSON.stringify(Date.now().toString(36)) },
    // Workers can instantiate bundled WASM modules, but cannot compile WASM bytes.
    resolve: { alias: { 'shiki/wasm': new URL('./node_modules/shiki/dist/onig.wasm', import.meta.url).pathname } },
    build: { assetsInlineLimit: file => file.endsWith('.js') ? false : undefined },
  },
  build: { inlineStylesheets: 'never' },
  prefetch: { defaultStrategy: 'hover' },
  adapter: cloudflare({ imageService: 'compile' }),
  integrations: [{
    name: 'site-analytics',
    hooks: {
      'astro:config:setup': ({ injectScript }) => {
        // Covers every Astro page, including layouts added in the future.
        injectScript('page', "import '/src/scripts/analytics.mjs';");
      },
    },
  }],
  server: {
    host: true,
    port: 3000
  }
});
