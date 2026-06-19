import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";

export default defineConfig({
  plugins: [
    // tsconfigPaths must run first so the "@/..." alias resolves for every other plugin.
    tsconfigPaths(),
    tailwindcss(),
    // tanstackStart() already includes the TanStack Router code-splitting plugin internally.
    // Do NOT also add TanStackRouterVite() — registering both runs the route transform twice,
    // which produces duplicate declarations and a broken client entry module.
    tanstackStart(),
    // nitro() builds the deployable server output. It auto-detects the Vercel build
    // environment and emits .vercel/output so SSR routes work in production. Without it,
    // only a static client is produced and deep routes 404 on Vercel.
    nitro(),
    react(),
  ],
  server: {
    port: 8081,
  },
  build: {
    target: "ES2020",
  },
});
