#!/usr/bin/env bash
# Sauvegarde d'Eniv : base MySQL (+ fichiers déposés en option), avec rotation.
#
#   scripts/backup.sh                 sauvegarde la base
#   scripts/backup.sh --uploads       sauvegarde aussi data/uploads
#
# À lancer sur le VPS, depuis n'importe quel dossier, par exemple chaque nuit :
#   15 3 * * * /chemin/vers/ENIV/scripts/backup.sh --uploads >> /chemin/vers/ENIV/data/backups/backup.log 2>&1
#
# Les identifiants sont lus dans le .env du projet (DB_HOST, DB_PORT, DB_NAME,
# DB_USER, DB_PASSWORD). Variables facultatives :
#   DB_CONTAINER   conteneur MySQL : mysqldump est alors lancé dedans (docker exec)
#   BACKUP_DIR     dossier de destination (défaut : data/backups)
#   KEEP_DAILY     sauvegardes quotidiennes gardées  (défaut : 7)
#   KEEP_WEEKLY    sauvegardes du dimanche gardées   (défaut : 4)
#   KEEP_MONTHLY   sauvegardes du 1er du mois gardées (défaut : 6)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WITH_UPLOADS=false
[[ "${1:-}" == "--uploads" ]] && WITH_UPLOADS=true

# Lit une variable du .env sans l'exécuter (les valeurs peuvent contenir des caractères spéciaux)
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
BACKUP_DIR="$(env_value BACKUP_DIR "$ROOT/data/backups")"
KEEP_DAILY="$(env_value KEEP_DAILY 7)"
KEEP_WEEKLY="$(env_value KEEP_WEEKLY 4)"
KEEP_MONTHLY="$(env_value KEEP_MONTHLY 6)"

STAMP="$(date +%Y-%m-%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"/{daily,weekly,monthly}
chmod 700 "$BACKUP_DIR"

log() { echo "[$(date '+%F %T')] $*"; }

# --single-transaction : copie cohérente sans bloquer l'application (InnoDB)
DUMP_ARGS=(--single-transaction --quick --routines --triggers --no-tablespaces
           --default-character-set=utf8mb4 -u"$DB_USER" "$DB_NAME")

dump() {
  if [[ -n "$DB_CONTAINER" ]]; then
    docker exec -e MYSQL_PWD="$DB_PASSWORD" "$DB_CONTAINER" mysqldump "${DUMP_ARGS[@]}"
  else
    MYSQL_PWD="$DB_PASSWORD" mysqldump -h"$DB_HOST" -P"$DB_PORT" "${DUMP_ARGS[@]}"
  fi
}

DB_FILE="$BACKUP_DIR/daily/eniv-db-$STAMP.sql.gz"
log "Sauvegarde de la base $DB_NAME…"
# Écriture dans un fichier temporaire : une sauvegarde interrompue ne remplace jamais une bonne
dump | gzip -9 > "$DB_FILE.tmp"
gzip -t "$DB_FILE.tmp"
# Un dump complet se termine par cette ligne : sans elle, il est tronqué
if ! zcat "$DB_FILE.tmp" | tail -n 1 | grep -q "Dump completed"; then
  rm -f "$DB_FILE.tmp"
  log "ERREUR : dump incomplet"
  exit 1
fi
mv "$DB_FILE.tmp" "$DB_FILE"
chmod 600 "$DB_FILE"
log "✓ Base : $DB_FILE ($(du -h "$DB_FILE" | cut -f1))"

if $WITH_UPLOADS && [[ -d "$ROOT/data/uploads" ]]; then
  UP_FILE="$BACKUP_DIR/daily/eniv-uploads-$STAMP.tar.gz"
  tar -czf "$UP_FILE.tmp" -C "$ROOT/data" uploads
  mv "$UP_FILE.tmp" "$UP_FILE"
  chmod 600 "$UP_FILE"
  log "✓ Fichiers : $UP_FILE ($(du -h "$UP_FILE" | cut -f1))"
fi

# Copies hebdomadaire (dimanche) et mensuelle (1er du mois) : liens durs, sans espace en plus
for f in "$BACKUP_DIR"/daily/*-"$STAMP".*; do
  [[ "$(date +%u)" == 7 ]] && ln -f "$f" "$BACKUP_DIR/weekly/"
  [[ "$(date +%d)" == 01 ]] && ln -f "$f" "$BACKUP_DIR/monthly/"
done

# Rotation : on garde les N plus récentes de chaque type (les noms sont datés,
# l'ordre alphabétique inverse est donc l'ordre chronologique inverse)
shopt -s nullglob
prune() {
  local dir="$1" keep="$2" prefix files
  for prefix in eniv-db eniv-uploads; do
    files=("$dir"/"$prefix"-*)
    (( ${#files[@]} > keep )) || continue
    printf '%s\n' "${files[@]}" | sort -r | tail -n +"$((keep + 1))" | xargs -r rm -f
  done
}
prune "$BACKUP_DIR/daily" "$KEEP_DAILY"
prune "$BACKUP_DIR/weekly" "$KEEP_WEEKLY"
prune "$BACKUP_DIR/monthly" "$KEEP_MONTHLY"

log "Terminé."
