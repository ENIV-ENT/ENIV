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

### Étapes

1. Accéder au dossier du projet:
```bash
cd ent-leger
```

2. Installer les dépendances:
```bash
npm install
```

3. Démarrer le serveur:
```bash
npm start
```

4. Ouvrir votre navigateur à l'adresse: `http://localhost:3000`

## Compte administrateur par défaut

- **Nom d'utilisateur**: `admin`
- **Mot de passe**: `admin123`

> **Important**: Créez vos propres comptes élèves via l'interface admin après la première connexion.

## Mode développement

Pour démarrer le serveur en mode développement avec rechargement automatique:

```bash
npm run dev
```

## Structure du projet

```
ent-leger/
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
