#!/bin/bash
# Déploiement d'ENIV sur le VPS : récupère la branche suivie puis reconstruit et relance le conteneur.
# Les pages statiques (public/, public-site/) sont servies directement par Caddy depuis ce dossier.
set -euo pipefail
cd "$(dirname "$0")"
# Annule les ?v=<hash> insérés au déploiement précédent, sinon le pull échoue sur ces fichiers modifiés.
git checkout -- public public-site
git pull --ff-only
# Versionne les liens vers le CSS/JS juste après le pull, pour que Caddy serve le moins longtemps possible des pages sans version.
# Node vient de l'image de base du Dockerfile (déjà nécessaire au build) : il n'a pas à être installé sur l'hôte.
image="$(awk '$1 == "FROM" { print $2; exit }' Dockerfile)"
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/app" -w /app "$image" node scripts/version-assets.js
docker compose -f compose.yml up -d --build --remove-orphans
docker compose -f compose.yml ps
