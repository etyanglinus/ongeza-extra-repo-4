# Ongeza platform operations. Run `make help`.
SHELL := /bin/bash
.DEFAULT_GOAL := help

help: ## List commands
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

secrets: ## Generate .env with fresh keys (once per environment)
	node scripts/generate-secrets.mjs

up: ## Build and start the whole platform
	@test -f .env || (echo "Run 'make secrets' first" && exit 1)
	@touch .env.partners
	docker compose up -d --build

migrate: ## Migrate the platform database and every partner database
	docker compose --profile ops run --rm api-migrate

onboard: ## Onboard a partner: make onboard PARTNER=partners/coop.json
	node scripts/onboard-partner.mjs $(PARTNER) --local

demo: ## Start the mock bank at http://localhost:7070 (bank PIN 1234)
	docker compose --profile demo up -d mockbank

statement: ## Partner statement: make statement TENANT=coop MONTH=2026-11
	docker compose exec api php artisan platform:statement $(TENANT) --month=$(MONTH)

logs: ## Follow logs
	docker compose logs -f --tail=100

ps: ## Service status
	docker compose ps

down: ## Stop (data is kept)
	docker compose down

validate: ## Validate compose and scripts
	@touch .env.partners
	docker compose config -q && node --check scripts/generate-secrets.mjs && node --check scripts/onboard-partner.mjs && echo "valid"

.PHONY: help secrets up migrate onboard demo statement logs ps down validate
