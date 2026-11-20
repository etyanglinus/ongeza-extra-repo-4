#!/usr/bin/env node
// Generates .env with every secret the platform needs. Never commit the output.
//   node scripts/generate-secrets.mjs [--force] [--public-url https://ongeza.example]
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const envPath = resolve(root, ".env");
if (existsSync(envPath) && !process.argv.includes("--force")) {
  console.error(".env already exists. Re-run with --force to replace it (this rotates every key and logs everyone out).");
  process.exit(1);
}

const token = (n = 32) => randomBytes(n).toString("base64url");
const kid = `ongeza-${new Date().toISOString().slice(0, 10)}`;
const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const jwk = { ...privateKey.export({ format: "jwk" }), kid, use: "sig", alg: "ES256" };
const sibling = (name) => resolve(root, "..", name);
const publicUrl = arg("public-url", "http://localhost:8000");

const env = {
  PUBLIC_URL: publicUrl,
  GATEWAY_PORT: "8000",
  HISA_MODE: "demo",
  OTP_EXPOSE_IN_RESPONSE: publicUrl.startsWith("http://localhost") ? "true" : "false",
  PARTNER_FRAME_ANCESTORS: "http://localhost:7070",
  DEPLOY_DIR: root,
  ONGEZA_ADMIN_DIR: sibling("ongeza-admin"),
  ONGEZA_IDENTITY_DIR: sibling("ongeza-extra-repo-1"),
  ONGEZA_AI_DIR: sibling("ongeza-extra-repo-2"),
  ONGEZA_BANK_KIT_DIR: sibling("ongeza-extra-repo-3"),
  ONGEZA_MOBILE_DIR: sibling("ongeza-mobile-app"),
  POSTGRES_PASSWORD: token(24),
  REDIS_PASSWORD: token(24),
  APP_KEY: `base64:${randomBytes(32).toString("base64")}`,
  PLATFORM_ADMIN_KEY: token(32),
  JWT_KEY_ID: kid,
  JWT_SIGNING_JWK: `'${JSON.stringify(jwk)}'`,
  PIN_PEPPER: token(32),
  OTP_HMAC_KEY: token(32),
  IDEMPOTENCY_STORAGE_KEY: randomBytes(32).toString("base64"),
  LLM_PROVIDERS: "anthropic",
  ANTHROPIC_API_KEY: "",
};
const body = Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n");
writeFileSync(envPath, `# Generated ${new Date().toISOString()}. Secret: do not commit or share.\n${body}\n`, { mode: 0o600 });
const partners = resolve(root, ".env.partners");
if (!existsSync(partners)) writeFileSync(partners, "# Partner database URLs (written by onboard-partner.mjs).\n", { mode: 0o600 });
console.log(`Wrote ${envPath}`);
console.log("Next: add an LLM key (ANTHROPIC_API_KEY or another provider) if you want Ask Hisa, then `make up`.");
