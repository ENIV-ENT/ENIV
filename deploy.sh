#!/bin/bash
# Déploiement d'ENIV sur le VPS : récupère la branche suivie puis reconstruit et relance le conteneur.
# Les pages statiques (public/, public-site/) sont servies directement par Caddy depuis ce dossier.
set -euo pipefail
cd "$(dirname "$0")"
git pull --ff-only
docker compose -f compose.yml up -d --build --remove-orphans
docker compose -f compose.yml ps
