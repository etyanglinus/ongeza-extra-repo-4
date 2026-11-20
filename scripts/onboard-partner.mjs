#!/usr/bin/env node
// Onboards a bank or SACCO onto the platform from one JSON file (see partners/*.example.json):
//   1. creates the partner's own database (local stack) and records its URL secret
//   2. registers its token issuer + public keys with Ongeza Identity
//   3. registers branding, products, connectors and pricing with the core API
//   4. migrates the partner database
// Re-running is safe: every step is an idempotent upsert.
//   node scripts/onboard-partner.mjs partners/coop.json [--local]
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/onboard-partner.mjs partners/<partner>.json [--local]");
  process.exit(1);
}
const local = process.argv.includes("--local");
const env = Object.fromEntries(
  readFileSync(resolve(root, ".env"), "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const p = JSON.parse(readFileSync(resolve(file), "utf8"));
if (!/^[a-z0-9-]{2,40}$/.test(p.id)) throw new Error("id must be lowercase letters, digits and hyphens.");
const identityUrl = process.env.ONGEZA_IDENTITY_ADMIN_URL ?? "http://127.0.0.1:8081";
const apiUrl = process.env.ONGEZA_API_ADMIN_URL ?? "http://127.0.0.1:8080";
const adminKey = process.env.PLATFORM_ADMIN_KEY ?? env.PLATFORM_ADMIN_KEY;
const dbEnv = `TENANT_${p.id.toUpperCase().replace(/-/g, "_")}_DATABASE_URL`;

async function put(url, body) {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json", "X-Admin-Key": adminKey, "Idempotency-Key": randomUUID() },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${url} -> ${res.status} ${text}`);
  return text;
}

// 1. Dedicated database
if (p.dedicatedDatabase) {
  const db = `ongeza_tenant_${p.id.replace(/-/g, "_")}`;
  if (local) {
    const exists = execFileSync("docker", ["compose", "exec", "-T", "postgres", "psql", "-U", "ongeza", "-tAc", `SELECT 1 FROM pg_database WHERE datname='${db}'`], { cwd: root }).toString().trim();
    if (exists !== "1") execFileSync("docker", ["compose", "exec", "-T", "postgres", "psql", "-U", "ongeza", "-c", `CREATE DATABASE ${db}`], { cwd: root, stdio: "inherit" });
    const partnersEnv = readFileSync(resolve(root, ".env.partners"), "utf8");
    if (!partnersEnv.includes(`${dbEnv}=`)) appendFileSync(resolve(root, ".env.partners"), `${dbEnv}=pgsql://ongeza:${env.POSTGRES_PASSWORD}@postgres:5432/${db}\n`);
    execFileSync("docker", ["compose", "up", "-d", "api", "worker", "scheduler"], { cwd: root, stdio: "inherit" });
    console.log(`✓ database ${db}`);
  } else {
    console.log(`→ Create database ${db} on the partner's database cluster and add secret ${dbEnv}=pgsql://... to the API, worker and scheduler.`);
  }
}

// 2. Identity: who may vouch for this partner's customers
const jwks = p.jwksFile ? readFileSync(resolve(dirname(resolve(file)), p.jwksFile), "utf8") : p.jwks ? JSON.stringify(p.jwks) : null;
await put(`${identityUrl}/admin/v1/tenants/${p.id}`, {
  name: p.name, status: "ACTIVE", issuer: p.issuer ?? null, jwksJson: jwks,
  allowPhonePin: Boolean(p.allowPhonePin), allowHostLaunch: Boolean(p.allowHostLaunch),
});
console.log("✓ identity");

// 3. Core API: branding, products, connectors, pricing
await put(`${apiUrl}/api/platform/v1/tenants/${p.id}`, {
  name: p.name, status: "active", kind: p.kind ?? "bank",
  databaseUrlEnv: p.dedicatedDatabase ? dbEnv : null,
  branding: p.branding, products: p.products, connectors: p.connectors ?? {}, billing: p.billing ?? {}, settings: p.settings ?? {},
});
console.log("✓ core API");

// 4. Schema for the partner database
if (p.dedicatedDatabase && local) {
  execFileSync("docker", ["compose", "exec", "-T", "api", "php", "artisan", "tenants:migrate", `--tenant=${p.id}`], { cwd: root, stdio: "inherit" });
  console.log("✓ migrated");
}

console.log(`\n${p.name} is live as "${p.id}".`);
console.log(`Mini-app URL for the partner's app: ${env.PUBLIC_URL}/app/?host=native&tenant=${p.id}`);
if (p.frameOrigins?.length) console.log(`Add to PARTNER_FRAME_ANCESTORS for internet banking: ${p.frameOrigins.join(" ")}`);
