#!/usr/bin/env bash
# Restauration de la base d'Eniv depuis une sauvegarde de scripts/backup.sh.
#
#   scripts/restore.sh data/backups/daily/eniv-db-2026-10-18_0315.sql.gz
#
# ⚠ Remplace le contenu actuel de la base. Une sauvegarde de sécurité de l'état
# actuel est faite juste avant. Mêmes variables que backup.sh (.env, DB_CONTAINER).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FILE="${1:-}"

if [[ -z "$FILE" || ! -f "$FILE" ]]; then
  echo "Usage : $0 <fichier eniv-db-*.sql.gz>" >&2
  echo "Sauvegardes disponibles :" >&2
  shopt -s nullglob
  printf '  %s\n' "$ROOT"/data/backups/daily/eniv-db-*.sql.gz | sort -r | head -n 10 >&2
  exit 1
fi

env_value() {
  local key="$1" default="${2:-}"
  if [[ -n "${!key:-}" ]]; then printf '%s' "${!key}"; return; fi
  local line
  line="$(grep -E "^${key}=" "$ROOT/.env" 2>/dev/null | tail -n 1 || true)"
  line="${line#*=}"
  line="${line%\"}"; line="${line#\"}"
  printf '%s' "${line:-$default}"
}

DB_HOST="$(env_value DB_HOST 127.0.0.1)"
DB_PORT="$(env_value DB_PORT 3306)"
DB_NAME="$(env_value DB_NAME ent)"
DB_USER="$(env_value DB_USER root)"
DB_PASSWORD="$(env_value DB_PASSWORD)"
DB_CONTAINER="$(env_value DB_CONTAINER)"

gzip -t "$FILE"
BACKUP_DIR="$(env_value BACKUP_DIR "$ROOT/data/backups")"

if [[ "${FORCE:-}" != 1 ]]; then
  read -r -p "Remplacer la base « $DB_NAME » par $(basename "$FILE") ? Tapez OUI : " answer
  [[ "$answer" == "OUI" ]] || { echo "Annulé."; exit 1; }
fi

# Copie de travail : rien de ce qui suit ne peut toucher au fichier choisi
WORK="$(mktemp)"
trap 'rm -f "$WORK"' EXIT
cp "$FILE" "$WORK"

# Sauvegarde de sécurité dans un dossier à part, hors de la rotation habituelle
echo "Sauvegarde de sécurité de l'état actuel…"
BACKUP_DIR="$BACKUP_DIR/avant-restauration" KEEP_DAILY=5 "$ROOT/scripts/backup.sh"

restore() {
  if [[ -n "$DB_CONTAINER" ]]; then
    docker exec -i -e MYSQL_PWD="$DB_PASSWORD" "$DB_CONTAINER" mysql -u"$DB_USER" "$DB_NAME"
  else
    MYSQL_PWD="$DB_PASSWORD" mysql -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" "$DB_NAME"
  fi
}

echo "Restauration de $(basename "$FILE")…"
zcat "$WORK" | restore
echo "✓ Base restaurée. Redémarrez l'application : docker compose -f compose.yml restart eniv"
