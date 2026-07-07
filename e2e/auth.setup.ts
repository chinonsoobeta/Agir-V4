import { test as setup } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const EMAIL = process.env.E2E_EMAIL ?? "maple.heights@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "password123";
const AUTH_FILE = "e2e/.auth/user.json";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:8081";

function loadEnv() {
  const fileEnv = existsSync(".env.local")
    ? Object.fromEntries(
        readFileSync(".env.local", "utf8")
          .trim()
          .split(/\n/)
          .filter(Boolean)
          .map((line) => line.split("=", 2)),
      )
    : {};
  const SUPABASE_URL = process.env.SUPABASE_URL ?? fileEnv.SUPABASE_URL;
  const SUPABASE_ANON_KEY =
    process.env.SUPABASE_ANON_KEY ??
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    fileEnv.SUPABASE_ANON_KEY ??
    fileEnv.SUPABASE_PUBLISHABLE_KEY ??
    fileEnv.VITE_SUPABASE_ANON_KEY ??
    fileEnv.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY for Playwright auth setup.");
  }
  return { SUPABASE_URL, SUPABASE_ANON_KEY };
}

function supabaseStorageKey(supabaseUrl: string) {
  return `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
}

function appOrigin() {
  const url = new URL(BASE_URL);
  return `${url.protocol}//${url.host}`;
}

// Sign in once through Supabase Auth and persist the browser localStorage
// session so every other spec starts authenticated. Keeping setup out of the UI
// prevents one hydrated-login-page race from skipping every browser spec.
setup("authenticate", async () => {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = loadEnv();
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signIn = supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error("Timed out signing in to Supabase for E2E auth setup.")),
      30_000,
    );
  });
  const { data, error } = await Promise.race([signIn, timeout]);
  if (error) throw new Error(`E2E auth setup failed: ${error.message}`);
  if (!data.session) throw new Error("E2E auth setup did not receive a Supabase session.");

  await mkdir(dirname(AUTH_FILE), { recursive: true });
  await writeFile(
    AUTH_FILE,
    JSON.stringify(
      {
        cookies: [],
        origins: [
          {
            origin: appOrigin(),
            localStorage: [
              {
                name: supabaseStorageKey(SUPABASE_URL),
                value: JSON.stringify(data.session),
              },
            ],
          },
        ],
      },
      null,
      2,
    ),
  );
});
