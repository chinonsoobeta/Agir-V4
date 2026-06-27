import pg from "pg";
import { assertTestDatabase } from "./assert-test-db.mjs";

const { Client } = pg;

const DATABASE_URL_ENV_KEYS = [
  "POSTGRES_URL",
  "DATABASE_URL",
  "SUPABASE_DB_URL",
  "SUPABASE_DATABASE_URL",
  "SUPABASE_POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL_NON_POOLING",
];

function resolveDatabaseUrl() {
  for (const key of DATABASE_URL_ENV_KEYS) {
    const value = process.env[key]?.trim();
    if (value) return { connectionString: value, envVar: key };
  }
  throw new Error(`Set one database URL env var: ${DATABASE_URL_ENV_KEYS.join(", ")}`);
}

function shouldUseSsl(connectionString) {
  const pgSslMode = process.env.PGSSLMODE?.trim();
  if (pgSslMode === "disable") return false;
  if (pgSslMode === "require") return true;

  const url = new URL(connectionString);
  const sslMode = url.searchParams.get("sslmode");
  if (sslMode === "disable") return false;
  if (sslMode === "require") return true;

  return !["localhost", "127.0.0.1", "::1"].includes(url.hostname);
}

const bootstrapSql = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE ROLE anon NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE ROLE authenticated NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE ROLE service_role NOLOGIN BYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;

CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT,
  raw_user_meta_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  claims_text TEXT;
  claims JSONB;
BEGIN
  claims_text := current_setting('request.jwt.claims', true);
  IF claims_text IS NULL OR claims_text = '' THEN
    RETURN NULL;
  END IF;
  claims := claims_text::jsonb;
  RETURN NULLIF(claims->>'sub', '')::uuid;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  public BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id TEXT NOT NULL REFERENCES storage.buckets(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  owner UUID,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION storage.foldername(name TEXT)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT string_to_array(name, '/')
$$;

DO $$ BEGIN
  CREATE PUBLICATION supabase_realtime;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT USAGE ON SCHEMA auth, public, storage TO anon, authenticated, service_role;
GRANT SELECT ON auth.users TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.buckets, storage.objects TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA auth, public, storage TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth, storage TO anon, authenticated, service_role;
`;

const { connectionString, envVar } = resolveDatabaseUrl();
assertTestDatabase(connectionString);
const client = new Client({
  connectionString,
  ssl: shouldUseSsl(connectionString) ? { rejectUnauthorized: false } : false,
});

try {
  await client.connect();
  await client.query(bootstrapSql);
  console.log(`Bootstrapped Supabase test schemas via ${envVar}.`);
} finally {
  await client.end();
}
