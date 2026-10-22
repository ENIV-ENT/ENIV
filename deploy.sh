#!/bin/bash
# Deploys ENIV on the VPS: pulls the tracked branch, then rebuilds and restarts the container.
# Static pages (public/, public-site/) are served by Caddy straight from this folder.
set -euo pipefail
cd "$(dirname "$0")"
# Reverts the ?v=<hash> added by the previous deployment, otherwise the pull fails on these modified files.
git checkout -- public public-site
git pull --ff-only
# Builds the app image first: its Node is then used to version the links to the CSS/JS.
# The Dockerfile base image is not kept locally after a build; using it would add one more download (which can fail) between the pull and the container restart.
docker compose -f compose.yml build
image="$(docker compose -f compose.yml config --images)"
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/app" -w /app "$image" node scripts/version-assets.js
docker compose -f compose.yml up -d --remove-orphans
docker compose -f compose.yml ps
