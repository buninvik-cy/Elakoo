#!/usr/bin/env bash
# Runs on the server every 4 hours (systemd timer elakoo-update.timer) and on demand:
#   sudo elakoo-update
# 1) takes the latest code, 2) syncs videos from YouTube (keeps the last good catalog on error),
# 3) builds the site, 4) publishes it to nginx. A failed build never replaces the live site.
set -euo pipefail

APP="${ELAKOO_APP:-/opt/elakoo}"
WEB="${ELAKOO_WEB:-/var/www/elakoo/site}"
DATA="${ELAKOO_DATA:-/var/lib/elakoo}"
export ELAKOO_CATALOG_PATH="$DATA/catalog.json"

log() { echo "[update] $*"; }
cd "$APP"

exec 9>"$DATA/update.lock"
flock -n 9 || { log "Another update is running."; exit 0; }

# 1. Code
OLD="$(git rev-parse HEAD)"
if git fetch -q origin main 2>/dev/null; then
  git reset -q --hard origin/main
else
  log "Could not reach the code repository - building with the current code."
fi
NEW="$(git rev-parse HEAD)"
[ "$OLD" = "$NEW" ] || log "Code updated: ${OLD:0:7} -> ${NEW:0:7}"

if [ ! -d node_modules ] || { [ "$OLD" != "$NEW" ] && ! git diff --quiet "$OLD" "$NEW" -- package.json package-lock.json; }; then
  log "Installing dependencies"
  npm ci --no-audit --no-fund --loglevel=error
fi

# 2. Videos
[ -f "$ELAKOO_CATALOG_PATH" ] || cp data/catalog.json "$ELAKOO_CATALOG_PATH"
FORCE=""
# One-off override of the "0 videos" safety check:  touch /var/lib/elakoo/force-sync && elakoo-update
if [ -f "$DATA/force-sync" ]; then FORCE="--force"; rm -f "$DATA/force-sync"; log "Forced sync"; fi
node scripts/sync-youtube.mjs $FORCE || log "YouTube sync FAILED - the site keeps the last good list of videos."

# 3. Build into a temporary folder
rm -rf "$DATA/build"
npx astro build --outDir "$DATA/build" --silent
test -f "$DATA/build/index.html"

# 4. Publish
rsync -a --delete "$DATA/build/" "$WEB/"
rm -rf "$DATA/build"
log "Site published."

# Contact server code changed -> ask systemd (ExecStartPost) to restart it.
if [ "$OLD" != "$NEW" ] && ! git diff --quiet "$OLD" "$NEW" -- server functions; then
  touch "$DATA/restart-contact"
fi
