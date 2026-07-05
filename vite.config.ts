import { loadEnv } from "vite";
import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";

export default defineConfig(({ mode }) => {
  // Load every env var (no prefix filter) from .env files AND process.env so we can
  // bridge them to the browser. The Vercel Supabase integration only provides
  // SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL / SUPABASE_ANON_KEY: it does NOT provide
  // the VITE_* vars that a Vite browser bundle needs. We inject only the public URL +
  // anon key below. The service-role key is intentionally never exposed to the client.
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const SUPABASE_URL =
    env.SUPABASE_URL ||
    env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "";
  const SUPABASE_ANON_KEY =
    env.SUPABASE_ANON_KEY ||
    env.SUPABASE_PUBLISHABLE_KEY ||
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    "";

  // Server functions read process.env at runtime. Mirror the values loaded from
  // Vite's env files during local development without exposing any private key.
  if (!process.env.SUPABASE_URL && SUPABASE_URL) process.env.SUPABASE_URL = SUPABASE_URL;
  if (!process.env.SUPABASE_ANON_KEY && SUPABASE_ANON_KEY) {
    process.env.SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;
  }

  return {
    define: {
      // Statically inline the public Supabase config into the browser bundle.
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(SUPABASE_URL),
      "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(SUPABASE_ANON_KEY),
    },
    plugins: [
      // tsconfigPaths must run first so the "@/..." alias resolves for every other plugin.
      tsconfigPaths(),
      tailwindcss(),
      // tanstackStart() already includes the TanStack Router code-splitting plugin internally.
      // Do NOT also add TanStackRouterVite(): registering both runs the route transform twice,
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
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return;
            if (id.includes("/xlsx/")) return "export-xlsx";
            if (id.includes("/docx/")) return "export-docx";
            if (id.includes("/html2canvas/")) return "export-html2canvas";
            if (
              id.includes("/canvg/") ||
              id.includes("/svg-pathdata/") ||
              id.includes("/rgbcolor/")
            ) {
              return "export-svg-render";
            }
            if (id.includes("/jspdf/")) return "export-pdf";
            if (id.includes("/unpdf/") || id.includes("/pdfjs-dist/")) return "document-pdf";
            if (id.includes("/@ai-sdk/") || id.includes("/ai/") || id.includes("/@anthropic-ai/")) {
              return "copilot-ai";
            }
            if (id.includes("/@supabase/")) return "supabase";
            if (id.includes("/@tanstack/")) return "tanstack";
            if (id.includes("/@radix-ui/")) return "radix-ui";
            if (id.includes("/lucide-react/")) return "icons";
            if (id.includes("/react-dom/") || id.includes("/react/")) return "react";
          },
        },
      },
    },
    // Playwright specs live in e2e/ and also match the *.spec.ts glob; keep them
    // out of the Vitest run (they are driven by `npm run test:e2e`).
    test: {
      exclude: [...configDefaults.exclude, "e2e/**"],
    },
  };
});
