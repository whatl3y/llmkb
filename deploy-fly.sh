#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# deploy.sh — One-command Fly.io deployment for LLM Knowledge Base
#
# Provisions ALL infrastructure and deploys a fully working KB:
#   - Fly.io app (Docker container)
#   - PostgreSQL (Fly Postgres, auto-sets DATABASE_URL)
#   - S3-compatible object storage (Fly Tigris, auto-sets AWS_* creds)
#   - ChromaDB via Chroma Cloud (https://trychroma.com)
#
# Prerequisites:
#   - flyctl installed  — https://fly.io/docs/flyctl/install/
#   - Logged in to Fly  — fly auth login
#   - Chroma Cloud account + API key from https://trychroma.com
#     Create a free account, then grab your API key, tenant ID,
#     and database name from the Chroma Cloud dashboard.
#
# Usage:
#   ./deploy.sh [APP_NAME]
#
# The script is interactive — it will prompt for everything it needs.
# ============================================================

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FLY_TOML="$PROJECT_DIR/fly.toml"

# ── Colors & helpers ─────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

info()    { echo -e "${BLUE}▸${NC} $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }
warn()    { echo -e "${YELLOW}!${NC} $1"; }
die()     { echo -e "${RED}✗${NC} $1" >&2; exit 1; }
header()  { echo -e "\n${BOLD}${CYAN}── $1 ──${NC}\n"; }

# Prompt for a value. Args: VAR_NAME LABEL [DEFAULT]
prompt() {
  local var=$1 label=$2 default=${3:-}
  local display="$label"
  [[ -n "$default" ]] && display="$label ${DIM}[$default]${NC}"
  echo -ne "  $display: "
  local val; read -r val
  val="${val:-$default}"
  eval "$var=\$val"
}

# Prompt for a required value. Args: VAR_NAME LABEL
prompt_required() {
  local var=$1 label=$2 val=""
  while [[ -z "$val" ]]; do
    echo -ne "  $label: "
    read -r val
    [[ -z "$val" ]] && echo -e "  ${RED}Required.${NC}"
  done
  eval "$var=\$val"
}

# Prompt for a secret (masked input). Args: VAR_NAME LABEL
prompt_secret() {
  local var=$1 label=$2 val=""
  while [[ -z "$val" ]]; do
    echo -ne "  $label: "
    read -rs val
    echo ""
    [[ -z "$val" ]] && echo -e "  ${RED}Required.${NC}"
  done
  eval "$var=\$val"
}

# ── Prerequisites ────────────────────────────────────────────

check_prerequisites() {
  header "Prerequisites"

  # Resolve flyctl binary name
  if command -v fly &>/dev/null; then
    FLY=fly
  elif command -v flyctl &>/dev/null; then
    FLY=flyctl
  else
    die "flyctl is not installed.\n  Install: curl -L https://fly.io/install.sh | sh\n  Docs:    https://fly.io/docs/flyctl/install/"
  fi

  if ! $FLY auth whoami &>/dev/null 2>&1; then
    die "Not logged in to Fly. Run: $FLY auth login"
  fi

  local fly_user
  fly_user=$($FLY auth whoami 2>/dev/null)
  success "flyctl installed, logged in as ${BOLD}$fly_user${NC}"
}

# ── Gather configuration ────────────────────────────────────

gather_config() {
  echo -e "\n${BOLD}${CYAN}========================================${NC}"
  echo -e "${BOLD}${CYAN}  LLM Knowledge Base — Fly.io Deploy${NC}"
  echo -e "${BOLD}${CYAN}========================================${NC}\n"

  # ── App name & region ──
  header "App"
  local default_name="${1:-}"
  if [[ -n "$default_name" ]]; then
    prompt "APP_NAME" "App name" "$default_name"
  else
    prompt_required "APP_NAME" "App name"
  fi
  prompt "REGION" "Fly region (see https://fly.io/docs/reference/regions)" "iad"

  # ── LLM provider ──
  header "LLM Provider"
  echo -e "  ${DIM}1)${NC} Claude (Anthropic)"
  echo -e "  ${DIM}2)${NC} OpenAI"
  local llm_choice
  prompt "llm_choice" "Choice" "1"

  if [[ "$llm_choice" == "2" ]]; then
    LLM_PROVIDER="openai"
    prompt_secret "LLM_API_KEY" "OpenAI API Key"
  else
    LLM_PROVIDER="claude"
    prompt_secret "LLM_API_KEY" "Anthropic API Key"
  fi

  # ── ChromaDB (Chroma Cloud) ──
  header "ChromaDB — Chroma Cloud"
  echo -e "  ${DIM}This deployment uses Chroma Cloud for vector search.${NC}"
  echo -e "  ${DIM}Create a free account at ${BOLD}https://trychroma.com${NC}${DIM} and grab${NC}"
  echo -e "  ${DIM}your API key, tenant, and database from the dashboard.${NC}"
  echo ""
  prompt_secret "CHROMA_API_KEY"  "Chroma Cloud API Key"
  prompt_required "CHROMA_TENANT" "Chroma Cloud Tenant"
  prompt "CHROMA_DATABASE"        "Chroma Cloud Database" "default_database"

  # ── Auth (optional) ──
  header "Authentication (optional)"
  echo -e "  ${DIM}Google OAuth restricts who can ingest content.${NC}"
  echo -e "  ${DIM}Read access (search, browse) is always open.${NC}"
  echo ""
  echo -e "  ${DIM}1)${NC} No authentication"
  echo -e "  ${DIM}2)${NC} Enable Google OAuth"
  local auth_choice
  prompt "auth_choice" "Choice" "1"

  AUTH_ENABLED=false
  GOOGLE_CLIENT_ID=""
  GOOGLE_CLIENT_SECRET=""
  JWT_SECRET=""
  if [[ "$auth_choice" == "2" ]]; then
    AUTH_ENABLED=true
    prompt_required "GOOGLE_CLIENT_ID"  "Google Client ID"
    prompt_secret "GOOGLE_CLIENT_SECRET" "Google Client Secret"
    JWT_SECRET=$(openssl rand -hex 32)
    success "JWT secret auto-generated"
  fi

  # ── Summary ──
  header "Summary"
  echo -e "  App name:       ${BOLD}$APP_NAME${NC}"
  echo -e "  Region:         $REGION"
  echo -e "  LLM provider:   $LLM_PROVIDER"
  echo -e "  ChromaDB:       Chroma Cloud (tenant: $CHROMA_TENANT)"
  echo -e "  Auth:           $([ "$AUTH_ENABLED" = true ] && echo "Google OAuth" || echo "Disabled")"
  echo -e "  PostgreSQL:     Fly Postgres (auto-provisioned)"
  echo -e "  Object store:   Fly Tigris  (auto-provisioned)"
  echo ""
  echo -ne "  ${BOLD}Proceed?${NC} [Y/n] "
  local confirm; read -r confirm
  confirm="${confirm:-Y}"
  [[ "$confirm" =~ ^[Yy] ]] || { echo "Cancelled."; exit 0; }
  echo ""
}

# ── Generate fly.toml ───────────────────────────────────────

generate_fly_toml() {
  info "Generating fly.toml..."

  if [[ -f "$FLY_TOML" ]]; then
    cp "$FLY_TOML" "${FLY_TOML}.bak"
    warn "Existing fly.toml backed up to fly.toml.bak"
  fi

  cat > "$FLY_TOML" << EOF
# Generated by deploy.sh — safe to edit for future deploys
app = "$APP_NAME"
primary_region = "$REGION"

[build]

[env]
  NODE_ENV = "production"
  STORAGE_BACKEND = "database"
  PORT = "8080"
  WATCH_RAW = "false"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0

[[vm]]
  size = "shared-cpu-1x"
  memory = "512mb"
EOF

  success "fly.toml written"
}

# ── Provision Fly app ────────────────────────────────────────

create_app() {
  header "Provisioning Fly App"

  if $FLY apps list 2>/dev/null | grep -qw "$APP_NAME"; then
    warn "App '$APP_NAME' already exists — reusing"
  else
    info "Creating app: $APP_NAME"
    $FLY apps create "$APP_NAME" --region "$REGION" \
      || die "Failed to create app. The name may be taken — try a different one."
    success "App created"
  fi
}

# ── Provision PostgreSQL ─────────────────────────────────────

provision_postgres() {
  local pg_name="${APP_NAME}-db"
  header "Provisioning PostgreSQL"

  if $FLY postgres list 2>/dev/null | grep -qw "$pg_name"; then
    warn "Postgres cluster '$pg_name' already exists"
  else
    info "Creating Fly Postgres cluster: $pg_name"
    info "  (shared-cpu-1x, 1 GB disk, single node)"
    $FLY postgres create \
      --name "$pg_name" \
      --region "$REGION" \
      --initial-cluster-size 1 \
      --vm-size shared-cpu-1x \
      --volume-size 1 \
      || die "Failed to create Postgres.\n  If this is a new Fly account you may need to add a credit card:\n  https://fly.io/dashboard/personal/billing"
    success "Postgres cluster created"
  fi

  info "Attaching Postgres to $APP_NAME (sets DATABASE_URL)..."
  $FLY postgres attach "$pg_name" --app "$APP_NAME" 2>/dev/null \
    || warn "Postgres may already be attached"
  success "DATABASE_URL configured"
}

# ── Provision Tigris object storage ──────────────────────────

provision_storage() {
  local bucket="${APP_NAME}-uploads"
  header "Provisioning Object Storage (Tigris)"

  info "Creating Tigris bucket: $bucket"
  info "  (S3-compatible — auto-sets AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY,"
  info "   AWS_ENDPOINT_URL_S3, AWS_REGION, BUCKET_NAME on the app)"
  $FLY storage create \
    --name "$bucket" \
    --app "$APP_NAME" \
    2>/dev/null \
    || warn "Bucket may already exist"
  success "Tigris storage provisioned"
}

# ── Set secrets ──────────────────────────────────────────────

set_secrets() {
  header "Configuring Secrets"

  # Build KEY=VALUE pairs for fly secrets import (stdin-based, handles special chars)
  local secrets=""
  secrets+="STORAGE_BACKEND=database\n"
  secrets+="LLM_PROVIDER=$LLM_PROVIDER\n"
  secrets+="HOST=https://${APP_NAME}.fly.dev\n"

  if [[ "$LLM_PROVIDER" == "claude" ]]; then
    secrets+="ANTHROPIC_API_KEY=$LLM_API_KEY\n"
  else
    secrets+="OPENAI_API_KEY=$LLM_API_KEY\n"
  fi

  secrets+="CHROMA_API_KEY=$CHROMA_API_KEY\n"
  secrets+="CHROMA_TENANT=$CHROMA_TENANT\n"
  secrets+="CHROMA_DATABASE=$CHROMA_DATABASE\n"

  if [[ "$AUTH_ENABLED" == "true" ]]; then
    secrets+="AUTH_ENABLED=true\n"
    secrets+="GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID\n"
    secrets+="GOOGLE_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET\n"
    secrets+="JWT_SECRET=$JWT_SECRET\n"
  fi

  info "Setting secrets (staged for next deploy)..."
  echo -e "$secrets" | $FLY secrets import --app "$APP_NAME" --stage \
    || die "Failed to set secrets"
  success "All secrets configured"
}

# ── Deploy ───────────────────────────────────────────────────

deploy_app() {
  header "Deploying"

  info "Building and deploying to Fly (remote builder)..."
  info "  This uses the project Dockerfile. Migrations run automatically"
  info "  on startup when STORAGE_BACKEND=database."
  echo ""

  cd "$PROJECT_DIR"
  $FLY deploy --app "$APP_NAME" --region "$REGION" --yes \
    || die "Deploy failed. Check logs: $FLY logs -a $APP_NAME"

  success "Deploy complete"
}

# ── Post-deploy ──────────────────────────────────────────────

post_deploy() {
  local app_url="https://${APP_NAME}.fly.dev"

  echo ""
  echo -e "${BOLD}${GREEN}========================================${NC}"
  echo -e "${BOLD}${GREEN}  Deployment Complete!${NC}"
  echo -e "${BOLD}${GREEN}========================================${NC}"
  echo ""
  echo -e "  ${BOLD}App URL${NC}        $app_url"
  echo -e "  ${BOLD}PostgreSQL${NC}     ${APP_NAME}-db  ${DIM}(Fly Postgres)${NC}"
  echo -e "  ${BOLD}Object store${NC}   ${APP_NAME}-uploads  ${DIM}(Fly Tigris)${NC}"
  echo -e "  ${BOLD}ChromaDB${NC}       Chroma Cloud  ${DIM}(trychroma.com)${NC}"
  echo ""
  echo -e "  ${DIM}View logs:${NC}     $FLY logs -a $APP_NAME"
  echo -e "  ${DIM}Open app:${NC}      $FLY open -a $APP_NAME"
  echo -e "  ${DIM}SSH console:${NC}   $FLY ssh console -a $APP_NAME"
  echo -e "  ${DIM}Redeploy:${NC}      $FLY deploy --app $APP_NAME"
  echo ""

  if [[ "$AUTH_ENABLED" == "true" ]]; then
    echo -e "  ${YELLOW}Auth is enabled. Next steps:${NC}"
    echo ""
    echo -e "  1. Set your Google OAuth redirect URI to:"
    echo -e "     ${BOLD}${app_url}/api/auth/google/callback${NC}"
    echo ""
    echo -e "  2. Add your first authorized user:"
    echo -e "     ${BOLD}$FLY ssh console -a $APP_NAME -C 'npx tsx scripts/add-user.ts you@email.com'${NC}"
    echo ""
  fi
}

# ── Main ─────────────────────────────────────────────────────

main() {
  check_prerequisites
  gather_config "$@"
  generate_fly_toml
  create_app
  provision_postgres
  provision_storage
  set_secrets
  deploy_app
  post_deploy
}

main "$@"
