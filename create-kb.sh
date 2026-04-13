#!/usr/bin/env bash
set -euo pipefail

# Bootstrap a new Knowledge Base from this template.
#
# Usage:
#   From a fresh clone (bootstrap in place):
#     ./create-kb.sh
#
#   Create a new KB in a new directory:
#     ./create-kb.sh my-cooking-kb
#     ./create-kb.sh my-cooking-kb https://github.com/you/your-kb-template
#
#   One-liner (curl + run):
#     bash <(curl -sL https://raw.githubusercontent.com/OWNER/REPO/main/create-kb.sh) my-cooking-kb https://github.com/OWNER/REPO

DIR="${1:-}"
REPO="${2:-}"

bootstrap() {
  echo ""
  echo "--- Installing dependencies ---"
  npm install

  echo ""
  echo "--- Running KB setup ---"
  npm run setup

  echo ""
  echo "Done! Next steps:"
  echo "  1. Edit .env to add your API keys (if you haven't already)"
  echo "  2. Run: docker compose up --build"
  echo "     Or:  npm run dev"
  echo ""
}

if [ -z "$DIR" ]; then
  # No argument — bootstrap the current directory (already cloned)
  if [ ! -f "package.json" ]; then
    echo "Error: No package.json found. Run this from the repo root, or pass a directory name."
    exit 1
  fi
  bootstrap
  exit 0
fi

# Directory argument provided — clone template into it
if [ -z "$REPO" ]; then
  # Try to infer repo URL from current git remote
  REPO="$(git remote get-url origin 2>/dev/null || echo "")"
fi

if [ -z "$REPO" ]; then
  echo "Error: Could not detect template repo URL."
  echo "Usage: ./create-kb.sh <directory> <repo-url>"
  exit 1
fi

echo "--- Creating new Knowledge Base: $DIR ---"
echo "    Template: $REPO"
echo ""

npx --yes degit "$REPO" "$DIR"
cd "$DIR"
bootstrap
