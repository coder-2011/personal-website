import vercel from "@astrojs/vercel";
import { defineConfig } from "astro/config";

export default defineConfig({
  // Shared scripts should be cached across pages instead of repeated inside each HTML response.
  vite: { build: { assetsInlineLimit: file => file.endsWith('.js') ? false : undefined } },
  prefetch: { defaultStrategy: 'hover' },
  adapter: vercel(),
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
