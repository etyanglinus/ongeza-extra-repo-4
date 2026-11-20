# Ongeza Platform Deploy

Runs the whole Ongeza wealth-as-a-service platform: one command locally, Kubernetes in
production. It also onboards a new bank or SACCO from a single JSON file.

## What runs

| Service | Repository | Stack | Role |
|---|---|---|---|
| **identity** | `ongeza-extra-repo-1` | Java 21, Spring Boot 3.5, PostgreSQL | Phone + PIN sign-in, bank mini-app launch, device keys, step-up tokens, partner keys |
| **api** (web, worker, scheduler) | `Ongeza-admin` | PHP 8.3, Laravel 13, PostgreSQL, Redis | Products (Chama, Junior, Goals, Autopilot, Vault, Loan…), ledgers, staff portal, **one database per partner**, metering and billing |
| **ai** | `ongeza-extra-repo-2` | Node 22, TypeScript, MCP | Hisa Coach: works with any LLM, guardrails, propose-only actions |
| **web** | `Ongeza-Mobile-App` | Flutter 3 (web build) | The app: standalone, white-label, or mini-app inside a bank app |
| **gateway** | this repo | nginx | One public origin; partner-only iframe embedding; safe retries |
| **mockbank** (demo) | `ongeza-extra-repo-3` | Node | A partner bank that embeds Ongeza, for demos and partner testing |
| Postgres / Redis | — | PostgreSQL 17, Redis 7 | Platform DB + one DB per partner; cache, locks, queues |

The Android and iOS apps are built from `Ongeza-Mobile-App` with Flutter. Banks embed the
same mini-app using the Android/iOS/web host code in the **Bank Integration Kit**
(`ongeza-extra-repo-3`).

## Requirements

**Developer / demo machine:** Docker Engine 24+ with Compose v2, Node 22, Git, and about
8 GB of free RAM (the first build also downloads the Flutter image, ~3 GB). Building the
mobile app also needs Flutter 3.38+, Android Studio and/or Xcode 16.

**Pilot (one partner, up to ~10k active customers):** one Linux VM with 8 vCPU, 32 GB RAM
and 200 GB SSD, running this compose stack behind TLS, plus off-site database backups.
This setup is **not** highly available. Use it only for a time-boxed pilot.

**Production (no single point of failure):**

| Component | Minimum |
|---|---|
| Kubernetes | 3 worker nodes across 3 zones (e.g. 8 vCPU / 32 GB each), ingress-nginx, cert-manager |
| PostgreSQL | HA with synchronous standby (CloudNativePG `k8s/base/postgres.yaml`, or managed Multi-AZ), PITR backups ≥ 35 days |
| Redis | Sentinel or managed HA (cache, locks, queues) |
| Secrets | A secret manager (Vault / cloud KMS) via External Secrets; HSM for the identity signing key where available |
| Observability | Prometheus/Grafana (identity exposes `/actuator/prometheus`), central logs, uptime checks on `/api/v1/ready` |
| Region | Hosting in or near Kenya, chosen to meet CBK outsourcing guidance and the Data Protection Act (agree this with each partner) |

## Install (local)

```bash
# 1. Put the repositories side by side
git clone https://github.com/etyanglinus/Ongeza-admin ongeza-admin
git clone https://github.com/etyanglinus/Ongeza-Mobile-App ongeza-mobile-app
git clone https://github.com/etyanglinus/ongeza-extra-repo-1
git clone https://github.com/etyanglinus/ongeza-extra-repo-2
git clone https://github.com/etyanglinus/ongeza-extra-repo-3
git clone https://github.com/etyanglinus/ongeza-extra-repo-4 && cd ongeza-extra-repo-4

# 2. Secrets, build, start, migrate
make secrets          # writes .env (never commit it)
make up               # builds all images, starts the platform
make migrate          # platform + partner databases

# 3. Open http://localhost:8000/app/   (SMS codes appear on screen in local mode)

# 4. See the bank mini-app experience
make demo             # http://localhost:7070, tap "Ongeza", bank PIN 1234
```

To use **Ask Hisa**, set an LLM key in `.env` (e.g. `ANTHROPIC_API_KEY`, or any
OpenAI-compatible provider; see the AI repository README) and run `make up` again.

## Onboard a bank or SACCO

1. The partner generates its signing key with the Bank Integration Kit
   (`npx ongeza-bank-keys --kid <bank>-2026-11`) and sends you the **public** JWKS.
2. Copy `partners/coop.example.json` to `partners/<id>.json`. Set the branding, enabled
   products, connectors (its core banking, broker and custodian), pricing and support
   details. Put the JWKS next to it.
3. `make onboard PARTNER=partners/<id>.json`. This creates the partner's own database,
   registers its keys with identity and its configuration with the API, then migrates.
   Re-running it is safe.
4. Give the partner its mini-app URL (printed by the script). Add its internet-banking
   origin to `PARTNER_FRAME_ANCESTORS`.

Typical timeline for a bank, once commercial and legal terms are signed:

- 1–2 weeks of bank-side work (two token endpoints plus hosting the mini-app);
- certification of their core-banking and broker connectors;
- a pilot with staff, then a pilot segment of customers.

## Operations

| Task | Command |
|---|---|
| Status / logs | `make ps`, `make logs` |
| Monthly partner statement | `make statement TENANT=coop MONTH=2026-11` (drafts on the 1st automatically; add `--issue` to freeze) |
| Run a command for every partner | `docker compose exec api php artisan tenants:run "hisa:reconcile"` |
| Migrate after a release | `make migrate` (production: the `api-migrate` Job runs before each rollout) |
| Back up / restore one partner | Each partner is a separate database: `pg_dump` / point-in-time restore it alone |

## Business model (what pays for the platform)

Pricing is set per partner in its JSON (`billing`), metered automatically, and turned into a
monthly statement:

| Revenue line | How it's measured |
|---|---|
| Platform and support fee | Fixed monthly, covers a block of active customers |
| Active customers above the block | Customers who used Ongeza in the month (counted once each) |
| Brokerage fee share | % of brokerage fees on trades placed through Ongeza |
| Chama premium | Per Chama with activity in the month (governance, statements, voting) |
| Loan origination | Basis points on Hisa Loan amounts approved |
| One-off setup | Integration and certification. Invoiced outside the platform |

Direct (Ongeza-branded) customers can be monetised separately with transparent brokerage
fees and fund revenue sharing.

## Security notes

- The gateway blocks the partner-onboarding and billing APIs (`/api/platform`,
  `/id/admin`). Operations reach them only on the private ports bound to `127.0.0.1`, or
  through cluster-internal services.
- `PLATFORM_ADMIN_KEY`, `JWT_SIGNING_JWK`, `PIN_PEPPER`, `OTP_HMAC_KEY`,
  `IDEMPOTENCY_STORAGE_KEY` and `APP_KEY` are the crown jewels. Keep them in the secret
  manager and rotate them on staff changes.
- Run `php artisan ongeza:release-check` against production configuration before going
  live.
