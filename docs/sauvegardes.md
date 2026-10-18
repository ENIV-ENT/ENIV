# Sauvegardes et restauration

Eniv stocke tout dans **MySQL** (comptes, classes, devoirs, statuts, quiz…) et
les documents joints dans **`data/uploads`** sur le VPS. Les deux scripts de
`scripts/` permettent de les sauvegarder chaque nuit et de revenir en arrière.

## Ce qui est sauvegardé

| Élément | Fichier produit | Option |
|---|---|---|
| Base MySQL complète (`mysqldump --single-transaction`) | `eniv-db-AAAA-MM-JJ_HHMMSS.sql.gz` | toujours |
| Documents joints (`data/uploads`) | `eniv-uploads-AAAA-MM-JJ_HHMMSS.tar.gz` | `--uploads` |

Rotation dans `data/backups/` (déjà ignoré par git) :

```
data/backups/
├── daily/     7 dernières sauvegardes          (KEEP_DAILY)
├── weekly/    4 derniers dimanches             (KEEP_WEEKLY)
├── monthly/   6 derniers 1ers du mois          (KEEP_MONTHLY)
└── avant-restauration/   état juste avant chaque restauration
```

Les copies hebdomadaires et mensuelles sont des **liens durs** : elles ne
prennent pas de place en plus. Chaque dump est vérifié (intégrité gzip et
ligne finale « Dump completed ») avant de remplacer quoi que ce soit, et les
fichiers ne sont lisibles que par leur propriétaire (`chmod 600`).

## Mise en place sur le VPS

1. Si MySQL tourne dans un conteneur Docker, ajouter son nom au `.env` :

   ```env
   DB_CONTAINER=mysql
   ```

   Sinon, `mysqldump` doit être installé sur l'hôte et `DB_HOST`/`DB_PORT`
   doivent pointer vers la base.

2. Tester une fois à la main :

   ```bash
   ./scripts/backup.sh --uploads
   ```

3. Programmer la sauvegarde chaque nuit à 3 h 15 (`crontab -e`) :

   ```cron
   15 3 * * * /home/deploy/ENIV/scripts/backup.sh --uploads >> /home/deploy/ENIV/data/backups/backup.log 2>&1
   ```

4. **Recommandé** : copier `data/backups` hors du VPS (une sauvegarde sur la
   même machine ne protège pas d'une panne du disque), par exemple avec
   `rclone sync data/backups distant:eniv-backups` dans la même tâche cron.

## Restaurer

```bash
./scripts/restore.sh data/backups/daily/eniv-db-2026-10-18_031500.sql.gz
docker compose -f compose.yml restart eniv
```

Le script :
1. vérifie le fichier ;
2. demande de taper `OUI` (ou `FORCE=1` pour l'automatiser) ;
3. sauvegarde l'état actuel dans `data/backups/avant-restauration/` ;
4. restaure.

Sans argument, il liste les dernières sauvegardes disponibles.

Pour les documents joints :

```bash
tar -xzf data/backups/daily/eniv-uploads-2026-10-18_031500.tar.gz -C data/
```

## Variables

| Variable | Défaut | Rôle |
|---|---|---|
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | lues dans `.env` | connexion |
| `DB_CONTAINER` | — | lancer `mysqldump`/`mysql` dans ce conteneur |
| `BACKUP_DIR` | `data/backups` | destination |
| `KEEP_DAILY` / `KEEP_WEEKLY` / `KEEP_MONTHLY` | 7 / 4 / 6 | rotation |

Une variable d'environnement passée en ligne de commande l'emporte sur le `.env`.
