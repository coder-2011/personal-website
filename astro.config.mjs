import node from "@astrojs/node";
import { defineConfig } from "astro/config";

export default defineConfig({
  adapter: node({
    mode: "standalone"
  }),
  server: {
    host: true,
    port: 3000
  }
});
