# ENT Léger

Application web légère de gestion de devoirs pour établissements scolaires.

## Fonctionnalités

### Pour les administrateurs
- Créer et gérer des comptes élèves
- Créer et gérer des matières (avec image et lien optionnels)
- Configurer le lien vers l'emploi du temps

### Pour les élèves
- Consulter la liste des devoirs
- Créer, modifier et supprimer des devoirs (partagés avec tous les élèves)
- Marquer les devoirs comme faits
- Ajouter des fichiers/photos aux devoirs
- Accéder à l'emploi du temps (si configuré par l'admin)

## Caractéristiques techniques
- Base de données SQLite locale (fichier `backend/ent.db`)
- Rechargement automatique des données via WebSocket
- Interface responsive (PC et mobile)
- Style épuré et simple

## Installation

### Prérequis
- Node.js (version 14 ou supérieure)
- npm
- Git (pour le déploiement automatique)

### Étapes

1. Accéder au dossier du projet:
```bash
cd ENT
```

2. Copier le fichier d'environnement exemple et le configurer:
```bash
cp .env.exemple .env
```
Éditez `.env` et modifiez les valeurs selon vos besoins.

3. Installer les dépendances:
```bash
npm install
```

4. Démarrer le serveur:
```bash
npm start
```

5. Ouvrir votre navigateur à l'adresse: `http://localhost:3650`

## Compte administrateur par défaut

- **Nom d'utilisateur**: `admin`
- **Mot de passe**: `admin123`

> **Important**: Créez vos propres comptes élèves via l'interface admin après la première connexion.

## Mode développement

Pour démarrer le serveur en mode développement avec rechargement automatique:

```bash
npm run dev
```

## Déploiement automatique avec GitHub Webhooks

Le projet inclut un système de déploiement automatique via GitHub Webhooks qui permet de mettre à jour automatiquement le serveur à chaque push sur la branche `main`.

### Configuration du serveur

1. Assurez-vous que votre fichier `.env` contient la variable `GITHUB_WEBHOOK_SECRET`:
```bash
GITHUB_WEBHOOK_SECRET=votre-secret-securise
```

2. Le serveur doit être démarré avec un gestionnaire de processus comme PM2, systemd ou supervisor pour redémarrer automatiquement après le déploiement:
```bash
# Avec PM2 (recommandé)
npm install -g pm2
pm2 start server.js --name ent
pm2 save
pm2 startup
```

### Configuration du webhook GitHub

1. Sur GitHub, allez dans les paramètres de votre repository
2. Allez dans **Settings** > **Webhooks** > **Add webhook**
3. Configurez le webhook:
   - **Payload URL**: `https://votre-domaine.com/api/deploy`
   - **Content type**: `application/json`
   - **Secret**: Le même secret que dans votre fichier `.env`
   - **Events**: Sélectionnez "Just the push event"
   - Activez le webhook

### Fonctionnement

Lorsqu'un push est effectué sur la branche `main`:
1. GitHub envoie une requête POST à `/api/deploy`
2. Le serveur vérifie la signature du webhook (sécurité)
3. Si valide, le déploiement démarre:
   - `git fetch origin`
   - `git reset --hard origin/main`
   - `npm install --production`
4. Le serveur redémarre automatiquement
5. La nouvelle version est en ligne

### Sécurité

- Le webhook vérifie la signature SHA-256 de GitHub pour s'assurer que la requête provient bien de GitHub
- Seuls les événements push sur `main` ou `master` déclenchent un déploiement
- Les autres branches et événements sont ignorés

### Logs

Les logs de déploiement sont préfixés par `[DEPLOY]` dans la console du serveur:
```bash
pm2 logs ent
```

## Structure du projet

```
ENT/
├── backend/
│   ├── models/
│   │   └── database.js       # Configuration BDD SQLite
│   ├── routes/
│   │   ├── auth.js           # Routes d'authentification
│   │   ├── admin.js          # Routes admin
│   │   └── devoirs.js        # Routes devoirs
│   ├── middleware/
│   │   └── auth.js           # Middleware d'authentification
│   └── uploads/              # Fichiers uploadés
├── public/
│   ├── css/
│   │   └── style.css         # Styles
│   ├── js/
│   │   └── app.js            # JavaScript frontend
│   └── index.html            # Page principale
├── server.js                 # Serveur Express
├── deploy.js                 # Gestion des webhooks GitHub
├── .env.exemple              # Variables d'environnement exemple
└── package.json
```

## Utilisation

### Administrateur

1. Connectez-vous avec le compte admin
2. **Onglet Élèves**: Créez des comptes élèves
3. **Onglet Matières**: Créez les matières (avec images et liens optionnels)
4. **Onglet Paramètres**: Configurez le lien vers l'emploi du temps

### Élève

1. Connectez-vous avec votre compte élève
2. Consultez la liste des devoirs
3. Cliquez sur "Ajouter un devoir" pour créer un nouveau devoir
4. Cochez la case "Fait" pour marquer un devoir comme terminé
5. Modifiez ou supprimez un devoir via les boutons correspondants
6. Cliquez sur "Emploi du temps" (si configuré) pour accéder à votre emploi du temps

## Notes importantes

- Tous les devoirs sont partagés entre tous les élèves
- Chaque élève peut marquer individuellement un devoir comme fait
- Les modifications sont synchronisées en temps réel via WebSocket
- La base de données est stockée dans `backend/ent.db`
- Les fichiers uploadés sont dans `backend/uploads/`

## Compatibilité

- Navigateurs modernes (Chrome, Firefox, Safari, Edge)
- Compatible PC et mobile
- Interface responsive adaptée aux petits écrans

## Support

Pour toute question ou problème, consultez la documentation ou contactez votre administrateur système.
