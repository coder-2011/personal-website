import vercel from "@astrojs/vercel";
import { defineConfig } from "astro/config";

export default defineConfig({
  prefetch: { defaultStrategy: 'hover' },
  adapter: vercel({
    webAnalytics: {
      enabled: true,
    },
  }),
  server: {
    host: true,
    port: 3000
  }
});
