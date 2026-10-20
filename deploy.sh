#!/bin/bash
# Déploiement d'ENIV sur le VPS : récupère la branche suivie puis reconstruit et relance le conteneur.
# Les pages statiques (public/, public-site/) sont servies directement par Caddy depuis ce dossier.
set -euo pipefail
cd "$(dirname "$0")"
# Annule les ?v=<hash> insérés au déploiement précédent, sinon le pull échoue sur ces fichiers modifiés.
git checkout -- public public-site
git pull --ff-only
# Construit l'image de l'app d'abord : son Node sert ensuite à versionner les liens vers le CSS/JS.
# L'image de base du Dockerfile n'est pas gardée en local après un build, l'utiliser imposerait un téléchargement de plus (qui peut échouer) entre le pull et la relance du conteneur.
docker compose -f compose.yml build
image="$(docker compose -f compose.yml config --images)"
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/app" -w /app "$image" node scripts/version-assets.js
docker compose -f compose.yml up -d --remove-orphans
docker compose -f compose.yml ps
