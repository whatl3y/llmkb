#!/bin/bash
set -e

# LLM Knowledge Base - Heroku Container Deployment Script
#
# Deploys the web dyno to Heroku using Docker containers.
# The existing Dockerfile builds the frontend and server.
# The docker-entrypoint.sh handles database migrations automatically
# when STORAGE_BACKEND=database.
#
# Prerequisites:
#   - Docker installed and running
#   - Heroku CLI installed and logged in (heroku login + heroku container:login)
#
# Usage:
#   ./deploy-heroku.sh APP_NAME [OPTIONS]
#
# Options:
#   --skip-build    Skip building the image (use existing local image)

# Parse options and positional args
SKIP_BUILD=false
APP_NAME=""

for arg in "$@"; do
    case $arg in
        --skip-build)
            SKIP_BUILD=true
            ;;
        --*)
            echo "Unknown option: $arg"
            exit 1
            ;;
        *)
            APP_NAME="$arg"
            ;;
    esac
done

if [ -z "$APP_NAME" ]; then
    echo "Error: APP_NAME is required."
    echo "Usage: ./deploy-heroku.sh APP_NAME [--skip-build]"
    exit 1
fi

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_IMAGE="$APP_NAME:local-build"

echo "========================================"
echo "LLM Knowledge Base"
echo "Heroku Container Deployment"
echo "========================================"
echo ""
echo "App: $APP_NAME"
echo "Process: web"
echo ""

# Check prerequisites
check_prerequisites() {
    echo "Checking prerequisites..."

    if ! command -v docker &> /dev/null; then
        echo "Error: Docker is not installed. Please install Docker first."
        exit 1
    fi

    if ! docker info &> /dev/null; then
        echo "Error: Docker is not running. Please start Docker first."
        exit 1
    fi

    if ! command -v heroku &> /dev/null; then
        echo "Error: Heroku CLI is not installed."
        echo "Install it with: brew install heroku/brew/heroku"
        exit 1
    fi

    if ! heroku auth:whoami &> /dev/null; then
        echo "Error: Not logged in to Heroku. Please run: heroku login"
        exit 1
    fi

    # Login to Heroku Container Registry
    echo "Logging in to Heroku Container Registry..."
    heroku container:login

    echo "All prerequisites met."
    echo ""
}

# Create or verify Heroku app
setup_heroku_app() {
    echo "Setting up Heroku app: $APP_NAME"

    # Check if app exists
    if heroku apps:info -a "$APP_NAME" &> /dev/null; then
        echo "App '$APP_NAME' already exists."
    else
        echo "Creating new Heroku app: $APP_NAME"
        heroku create "$APP_NAME" || {
            echo ""
            echo "Could not create app with name '$APP_NAME'."
            echo "The name might be taken. Please provide a unique name:"
            read -p "App name: " NEW_APP_NAME
            APP_NAME="$NEW_APP_NAME"
            heroku create "$APP_NAME"
        }
    fi

    # Set stack to container
    echo "Setting stack to container..."
    heroku stack:set container -a "$APP_NAME"

    # Ensure DATABASE_URL is set (provision Postgres if needed)
    echo "Checking for DATABASE_URL..."
    if heroku config:get DATABASE_URL -a "$APP_NAME" | grep -q .; then
        echo "DATABASE_URL is already set."
    else
        echo "DATABASE_URL is not set. Provisioning Heroku Postgres (essential-0)..."
        heroku addons:create heroku-postgresql:essential-0 -a "$APP_NAME" --wait
        echo "Postgres provisioned. DATABASE_URL is now set."
    fi

    echo ""
}

# Build Docker image
build_image() {
    if [ "$SKIP_BUILD" = true ]; then
        echo "Skipping build (--skip-build specified)"
        return 0
    fi

    echo "Building Docker image..."
    cd "$PROJECT_DIR"

    docker buildx build --platform linux/amd64 \
        -t "$LOCAL_IMAGE" \
        .

    # Tag for Heroku registry
    docker tag "$LOCAL_IMAGE" "registry.heroku.com/$APP_NAME/web"

    echo ""
    echo "Image built and tagged successfully."
    echo ""
}

# Push image to Heroku
push_image() {
    echo "Pushing image to Heroku Container Registry..."
    docker push "registry.heroku.com/$APP_NAME/web"
    echo ""
}

# Release container
release_container() {
    echo "Releasing container: web"
    heroku container:release --app "$APP_NAME" web
    echo ""
}

# Deploy to Heroku
deploy() {
    build_image
    push_image
    release_container

    echo "========================================"
    echo "Deployment complete!"
    echo "========================================"
    echo ""
    echo "Your app is available at:"
    heroku apps:info -a "$APP_NAME" | grep "Web URL" || echo "  https://$APP_NAME.herokuapp.com"
    echo ""
    echo "View logs with:"
    echo "  heroku logs --tail -a $APP_NAME"
    echo ""
    echo "Required config vars (set with heroku config:set -a $APP_NAME):"
    echo "  STORAGE_BACKEND=database"
    echo "  DATABASE_URL        (auto-set if using Heroku Postgres addon)"
    echo "  AWS_BUCKET          (S3 bucket for uploaded source files)"
    echo "  AWS_ACCESS_KEY_ID"
    echo "  AWS_SECRET_ACCESS_KEY"
    echo "  AWS_REGION"
    echo "  LLM_PROVIDER        (claude or openai)"
    echo "  ANTHROPIC_API_KEY   (if using claude)"
    echo "  OPENAI_API_KEY      (if using openai)"
    echo "  CHROMA_URL          (ChromaDB instance URL)"
    echo ""
    echo "Optional config vars:"
    echo "  AUTH_ENABLED=true"
    echo "  GOOGLE_CLIENT_ID"
    echo "  GOOGLE_CLIENT_SECRET"
    echo "  JWT_SECRET"
    echo ""
}

# Main
main() {
    check_prerequisites
    setup_heroku_app
    deploy
}

main
