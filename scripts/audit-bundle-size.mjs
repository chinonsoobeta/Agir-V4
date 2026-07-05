#!/usr/bin/env node
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ASSET_DIR = ".output/public/assets";
const MAX_TOTAL_JS_BYTES = 3_600_000;
const MAX_JS_CHUNK_BYTES = 460_000;
const MAX_CSS_BYTES = 125_000;

const REQUIRED_ISOLATED_CHUNKS = [
  "export-xlsx",
  "export-docx",
  "export-pdf",
  "export-html2canvas",
  "export-svg-render",
];

function fail(message) {
  console.error(`[bundle-audit] FAIL: ${message}`);
  process.exitCode = 1;
}

let entries;
try {
  entries = readdirSync(ASSET_DIR);
} catch {
  fail(`missing ${ASSET_DIR}; run npm run build before npm run bundle:audit`);
  process.exit();
}

const assets = entries
  .map((name) => ({
    name,
    bytes: statSync(join(ASSET_DIR, name)).size,
  }))
  .filter((asset) => asset.name.endsWith(".js") || asset.name.endsWith(".css"));

const jsAssets = assets.filter((asset) => asset.name.endsWith(".js"));
const cssAssets = assets.filter((asset) => asset.name.endsWith(".css"));
const totalJsBytes = jsAssets.reduce((sum, asset) => sum + asset.bytes, 0);

if (totalJsBytes > MAX_TOTAL_JS_BYTES) {
  fail(`client JS total ${totalJsBytes} bytes exceeds ${MAX_TOTAL_JS_BYTES}`);
}

for (const asset of jsAssets) {
  if (asset.bytes > MAX_JS_CHUNK_BYTES) {
    fail(`${asset.name} is ${asset.bytes} bytes; max chunk budget is ${MAX_JS_CHUNK_BYTES}`);
  }
}

for (const asset of cssAssets) {
  if (asset.bytes > MAX_CSS_BYTES) {
    fail(`${asset.name} is ${asset.bytes} bytes; CSS budget is ${MAX_CSS_BYTES}`);
  }
}

for (const chunkName of REQUIRED_ISOLATED_CHUNKS) {
  if (!jsAssets.some((asset) => asset.name.startsWith(`${chunkName}-`))) {
    fail(`expected isolated ${chunkName} chunk in client build output`);
  }
}

if (!process.exitCode) {
  console.log(
    `[bundle-audit] PASS: ${jsAssets.length} JS chunks, ${totalJsBytes} JS bytes, ${cssAssets.length} CSS assets.`,
  );
}
