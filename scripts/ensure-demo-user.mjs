// One-off helper: ensure the demo login user exists in Supabase Auth.
// Run: node --env-file-if-exists=/vercel/share/.env.project scripts/ensure-demo-user.mjs
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const EMAIL = "maple.heights@example.com";
const PASSWORD = "password123";

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Look for an existing user with this email.
const { data: list, error: listErr } = await admin.auth.admin.listUsers();
if (listErr) {
  console.error("listUsers failed:", listErr.message);
  process.exit(1);
}
const existing = list.users.find((u) => u.email === EMAIL);

if (existing) {
  // Make sure it is confirmed and the password is known.
  const { error: updErr } = await admin.auth.admin.updateUserById(existing.id, {
    password: PASSWORD,
    email_confirm: true,
  });
  if (updErr) {
    console.error("updateUser failed:", updErr.message);
    process.exit(1);
  }
  console.log(`[demo-user] updated existing user ${EMAIL} (id=${existing.id})`);
} else {
  const { data, error } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: "Maple Heights Demo" },
  });
  if (error) {
    console.error("createUser failed:", error.message);
    process.exit(1);
  }
  console.log(`[demo-user] created user ${EMAIL} (id=${data.user.id})`);
}
