import { createHash, createHmac } from "node:crypto";
import type { CustomerAuditPackage } from "./customer-audit-package";

export type CustomerAuditArchive = {
  filename: string;
  contentType: "application/zip";
  base64: string;
  sha256: string;
  signature: {
    schema: "agir.customer-audit-package.signature.v1";
    algorithm: "HMAC-SHA256" | "SHA256";
    signed_at: string;
    package_sha256: string;
    signature: string;
    key_hint: string | null;
  };
};

const encoder = new TextEncoder();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeU16(out: number[], value: number) {
  out.push(value & 0xff, (value >>> 8) & 0xff);
}

function writeU32(out: number[], value: number) {
  out.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function dosTime(date: Date) {
  return (
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    ((date.getSeconds() / 2) & 0x1f)
  );
}

function dosDate(date: Date) {
  return (
    (((date.getFullYear() - 1980) & 0x7f) << 9) |
    (((date.getMonth() + 1) & 0xf) << 5) |
    (date.getDate() & 0x1f)
  );
}

function concat(parts: Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function storedZip(files: Record<string, string>, date: Date): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    const filename = encoder.encode(name);
    const data = encoder.encode(text);
    const crc = crc32(data);
    const time = dosTime(date);
    const day = dosDate(date);
    const local: number[] = [];
    writeU32(local, 0x04034b50);
    writeU16(local, 20);
    writeU16(local, 0x0800);
    writeU16(local, 0);
    writeU16(local, time);
    writeU16(local, day);
    writeU32(local, crc);
    writeU32(local, data.length);
    writeU32(local, data.length);
    writeU16(local, filename.length);
    writeU16(local, 0);
    localParts.push(Uint8Array.from(local), filename, data);

    const central: number[] = [];
    writeU32(central, 0x02014b50);
    writeU16(central, 20);
    writeU16(central, 20);
    writeU16(central, 0x0800);
    writeU16(central, 0);
    writeU16(central, time);
    writeU16(central, day);
    writeU32(central, crc);
    writeU32(central, data.length);
    writeU32(central, data.length);
    writeU16(central, filename.length);
    writeU16(central, 0);
    writeU16(central, 0);
    writeU16(central, 0);
    writeU16(central, 0);
    writeU32(central, 0);
    writeU32(central, offset);
    centralParts.push(Uint8Array.from(central), filename);
    offset += local.length + filename.length + data.length;
  }
  const centralOffset = offset;
  const centralDir = concat(centralParts);
  const end: number[] = [];
  const fileCount = Object.keys(files).length;
  writeU32(end, 0x06054b50);
  writeU16(end, 0);
  writeU16(end, 0);
  writeU16(end, fileCount);
  writeU16(end, fileCount);
  writeU32(end, centralDir.length);
  writeU32(end, centralOffset);
  writeU16(end, 0);
  return concat([...localParts, centralDir, Uint8Array.from(end)]);
}

const sha256 = (text: string | Uint8Array) =>
  createHash("sha256")
    .update(typeof text === "string" ? text : Buffer.from(text))
    .digest("hex");

export function buildCustomerAuditArchive(pkg: CustomerAuditPackage): CustomerAuditArchive {
  const checksums = Object.fromEntries(
    Object.entries(pkg.files).map(([name, text]) => [name, sha256(text)]),
  );
  const signedAt = new Date().toISOString();
  const packageSha = sha256(JSON.stringify({ manifest: pkg.manifest, checksums }));
  const secret = process.env.AUDIT_PACKAGE_SIGNING_SECRET;
  const signatureValue = secret
    ? createHmac("sha256", secret).update(packageSha).digest("hex")
    : packageSha;
  const signature = {
    schema: "agir.customer-audit-package.signature.v1" as const,
    algorithm: secret ? ("HMAC-SHA256" as const) : ("SHA256" as const),
    signed_at: signedAt,
    package_sha256: packageSha,
    signature: signatureValue,
    key_hint: secret ? sha256(secret).slice(0, 12) : null,
  };
  const files = {
    ...pkg.files,
    "checksums.json": `${JSON.stringify(checksums, null, 2)}\n`,
    "integrity-signature.json": `${JSON.stringify(signature, null, 2)}\n`,
  };
  const zip = storedZip(files, new Date(pkg.manifest.generated_at));
  return {
    filename: `agir-customer-audit-package-${pkg.manifest.workspace_id}.zip`,
    contentType: "application/zip",
    base64: Buffer.from(zip).toString("base64"),
    sha256: sha256(zip),
    signature,
  };
}
