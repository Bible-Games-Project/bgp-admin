.PHONY: help run dev install clean format lint check supabase-start supabase-stop supabase-reset sync-ios sync-android release-ci

# Default target
.DEFAULT_GOAL := help

help: ## Show this help message
	@echo "BGP-Admin Makefile Commands:"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

run: ## Run the development server (alias for dev)
	@echo "🚀 Starting bgp-admin development server..."
	bun run dev

dev: ## Run the development server with Vite
	@echo "🚀 Starting development server..."
	bun run dev

install: ## Install dependencies
	@echo "📦 Installing dependencies..."
	bun install

build: ## Build for production
	@echo "🏗️  Building for production..."
	bun run build

preview: ## Preview production build locally
	@echo "👀 Previewing production build..."
	bun run preview

sync-ios: ## Build app bundle and sync Capacitor iOS
	@echo "📱 Building and syncing iOS..."
	bun run build:app
	bunx cap sync ios

sync-android: ## Build app bundle and sync Capacitor Android
	@echo "🤖 Building and syncing Android..."
	bun run build:app
	bunx cap sync android

format: ## Format code with Prettier
	@echo "✨ Formatting code..."
	bun run format

lint: ## Lint code with ESLint
	@echo "🔍 Linting code..."
	bun run lint

check: lint ## Run all checks (lint)
	@echo "✅ All checks passed"

clean: ## Clean node_modules and lock files
	@echo "🧹 Cleaning..."
	rm -rf node_modules
	rm -f bun.lockb

supabase-start: ## Start Supabase local instance
	@echo "🗄️  Starting Supabase..."
	cd supabase && supabase start

supabase-stop: ## Stop Supabase local instance
	@echo "🛑 Stopping Supabase..."
	cd supabase && supabase stop

supabase-reset: ## Reset Supabase local database
	@echo "🔄 Resetting Supabase database..."
	cd supabase && supabase db reset

supabase-status: ## Show Supabase status
	@echo "📊 Supabase status:"
	cd supabase && supabase status

migrate: ## Create a new migration
	@echo "📝 Creating new migration..."
	@read -p "Migration name: " name; \
	cd supabase && supabase migration new $$name

release-ci: ## Move the v1 tag so game repos pick up the current reusable workflows
	@echo "🏷️  Pointing v1 at $$(git rev-parse --short HEAD) on $$(git rev-parse --abbrev-ref HEAD)..."
	@git rev-parse --abbrev-ref HEAD | grep -qx main || \
		{ echo "❌ Refusing: release-ci must run on main."; exit 1; }
	@test -z "$$(git status --porcelain)" || \
		{ echo "❌ Refusing: working tree is dirty."; exit 1; }
	@git fetch origin main --quiet
	@test "$$(git rev-parse HEAD)" = "$$(git rev-parse origin/main)" || \
		{ echo "❌ Refusing: local main differs from origin/main. Push first."; exit 1; }
	git tag -f v1
	git push origin v1 --force
	@echo "✅ v1 moved. Every game repo now builds with these workflows."

setup: install ## Complete setup (install deps)
	@echo ""
	@echo "✅ Setup complete!"
	@echo ""
	@echo "Next steps:"
	@echo "  1. Configure .env file if needed"
	@echo "  2. Start Supabase: make supabase-start"
	@echo "  3. Run the app: make run"
	@echo ""
