#!/bin/sh
set -e

# Run database migrations when using the database backend
if [ "$STORAGE_BACKEND" = "database" ]; then
  echo "[entrypoint] STORAGE_BACKEND=database — running migrations..."
  npx tsx src/database/migrate.ts
fi

# Start the server
exec npx tsx src/server/index.ts
