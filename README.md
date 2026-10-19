<div align="center">

<img src="docs/images/banniere.svg" alt="Eniv : les devoirs de la classe, partagés et toujours à jour" width="100%">

<br>

[![Node.js 24](https://img.shields.io/badge/Node.js-24-5FA04E?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Express 5](https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white)](https://expressjs.com)
[![MariaDB 12](https://img.shields.io/badge/MariaDB-12-003545?logo=mariadb&logoColor=white)](https://mariadb.org)
[![Docker](https://img.shields.io/badge/Docker-prêt-2496ED?logo=docker&logoColor=white)](compose.yml)
[![PWA](https://img.shields.io/badge/PWA-installable-5A0FC8?logo=pwa&logoColor=white)](public/manifest.webmanifest)
[![MCP](https://img.shields.io/badge/MCP-assistants%20IA-D97757)](backend/services/mcpServer.js)

**[eniv.fr](https://eniv.fr)** · [Fonctionnalités](#-fonctionnalités) · [Aperçu](#-aperçu) · [Architecture](#-architecture) · [Installation](#-installation) · [Déploiement](#-déploiement) · [Contributeurs](#-contributeurs) · [Contribuer](#-contribuer)

</div>

---

**Eniv** est un ENT léger centré sur l'essentiel : **le cahier de textes de la classe**.
Les élèves ajoutent les devoirs, tout le monde les voit **en temps réel**, chacun coche ce qu'il a fini,
et l'appli s'installe sur le téléphone comme une application native.

## ✨ Fonctionnalités

<table>
<tr>
<td width="50%" valign="top">

### 📚 Pour les élèves
- **Calendrier** mensuel sur ordinateur, **semaine par semaine** sur mobile
- Devoirs **partagés** avec toute la classe, mis en forme en **Markdown**
- **« Fait »** coché individuellement, devoirs barrés
- **Documents joints** (PDF, Word, PowerPoint, Excel), convertis en PDF pour la lecture
- **Quiz de révision générés par IA** à partir des documents (classes premium)
- **Partage** d'un devoir par lien direct

</td>
<td width="50%" valign="top">

### 🧑‍🏫 Pour les administrateurs de classe
- Gestion des **élèves**, des **matières** (couleur, lien) et des **admins**
- **Invitations par e-mail** et **lien d'inscription** à partager
- **Demandes d'adhésion** à valider
- **Historique complet** : qui a créé, modifié ou supprimé quoi
- Lien vers l'**emploi du temps**
- **Récapitulatif Discord** chaque soir et chaque samedi

</td>
</tr>
<tr>
<td valign="top">

### ⚡ Expérience
- **Temps réel** (WebSocket) : un devoir ajouté apparaît partout sans recharger
- **Application installable** (PWA) et **consultable hors ligne**
- **Thème sombre**
- Inscription libre avec **recherche de l'établissement**

</td>
<td valign="top">

### 🤖 Assistants IA (MCP)
Connectez **Claude, ChatGPT** ou tout client compatible MCP à vos devoirs avec un lien personnel (révocable, avec expiration facultative).
Outils exposés : `lister_devoirs`, `voir_devoir`, `lire_document`, `marquer_fait`, `creer_devoir`, `modifier_devoir`, `supprimer_devoir`, `lister_matieres`.

</td>
</tr>
</table>

## 📸 Aperçu

<table>
<tr>
<td colspan="2"><img src="docs/images/tableau-de-bord-clair.png" alt="Tableau de bord : calendrier du mois avec les devoirs colorés par matière"></td>
</tr>
<tr>
<td width="50%"><img src="docs/images/devoir.png" alt="Détail d'un devoir avec description Markdown"></td>
<td width="50%"><img src="docs/images/tableau-de-bord-sombre.png" alt="Tableau de bord en thème sombre"></td>
</tr>
<tr>
<td align="center" width="50%"><img src="docs/images/mobile.png" alt="Vue mobile semaine par semaine" width="300"></td>
<td width="50%"><img src="docs/images/admin.png" alt="Administration de la classe"><br><br><img src="docs/images/connexion.jpg" alt="Page de connexion"></td>
</tr>
</table>

<details>
<summary><b>🧪 En cours de revue : notifications push, agenda, progression, commentaires…</b></summary>
<br>

| Fonctionnalité | Aperçu |
|---|---|
| 🔔 **Notifications push** : nouveau devoir, modification, rappel la veille à 18 h | <img src="docs/images/apercus/notifications.png" width="480" alt="Section Notifications des paramètres"> |
| 📅 **Abonnement agenda** (Google Agenda, Calendrier, Outlook) | <img src="docs/images/apercus/agenda.png" width="480" alt="Section Agenda des paramètres"> |
| 📊 **Ma progression** : taux de devoirs faits, série, devoirs à rattraper, semaine à venir | <img src="docs/images/apercus/progression.png" width="360" alt="Fenêtre Ma progression"> |
| 💬 **Commentaires sous un devoir**, en temps réel | <img src="docs/images/apercus/commentaires.png" width="360" alt="Commentaires sous un devoir"> |

</details>

## 🏗 Architecture

```mermaid
flowchart TB
    Eleve["📱 Navigateur / PWA<br/><sub>pages + service worker hors ligne</sub>"]
    Assist["🤖 Claude, ChatGPT…<br/><sub>client MCP</sub>"]

    subgraph VPS["🖥️ VPS"]
        Caddy["🔒 Caddy<br/><sub>HTTPS · pages statiques</sub>"]
        subgraph App["🐳 Conteneur eniv (Node 24 · Express 5)"]
            API["API REST<br/><sub>/api/*</sub>"]
            WS["Temps réel<br/><sub>WebSocket /ws</sub>"]
            MCP["Serveur MCP<br/><sub>/api/mcp</sub>"]
            Cron["Tâches planifiées<br/><sub>node-cron</sub>"]
        end
        DB[("🗄️ MariaDB 12")]
        Up[/"📎 data/uploads"/]
    end

    subgraph Ext["☁️ Services externes"]
        IA["Groq / Anthropic<br/><sub>quiz IA</sub>"]
        Mail["Brevo<br/><sub>e-mails</sub>"]
        Discord["Discord<br/><sub>récapitulatifs</sub>"]
    end

    Eleve <-->|HTTPS| Caddy
    Assist -->|HTTPS| Caddy
    Caddy --> API
    Caddy <--> WS
    Caddy --> MCP
    API -. "notifie la classe" .-> WS
    API --> DB
    MCP --> DB
    API --> Up
    API --> IA
    API --> Mail
    Cron --> Discord
```

**Chemin d'une modification en temps réel** : un élève ajoute un devoir → `POST /api/devoirs` →
le middleware `realtimeNotifier` diffuse un événement **à la seule classe concernée** →
les autres onglets ouverts rechargent uniquement ce qui a changé.

<details>
<summary><b>📁 Structure du projet</b></summary>

```text
ENIV/
├── server.js                  # Point d'entrée Express + WebSocket
├── backend/
│   ├── middleware/            # Authentification JWT, notifications temps réel
│   ├── migrations/            # Migrations MySQL numérotées, jouées au démarrage
│   ├── models/                # Pool MySQL et utilitaire de requêtes
│   ├── routes/                # API REST (auth, devoirs, admin, quiz, mcp…)
│   └── services/              # E-mails, Discord, quiz IA, temps réel, MCP, PDF…
├── public/                    # Application (servie par Caddy en production)
│   ├── js/pages/              # Une page = un module
│   ├── js/utils/              # API, DOM, Markdown, temps réel
│   └── sw.js                  # Service worker (PWA, hors ligne)
├── public-site/               # Site vitrine eniv.fr et pages légales
├── docs/                      # Documentation et images du README
├── Dockerfile · compose.yml   # Image et déploiement de production
├── compose.yaml               # Environnement de développement (MySQL + phpMyAdmin)
└── deploy.sh                  # Mise à jour sur le VPS (lancé par GitHub Actions)
```

</details>

## 🚀 Installation

### Avec Docker (recommandé)

```bash
git clone https://github.com/ENIV-ENT/ENIV.git && cd ENIV
docker compose up
```

| Service | Adresse |
|---|---|
| Application | http://localhost:3000 |
| phpMyAdmin | http://localhost:8080 |

`compose.yaml` démarre MySQL, installe les dépendances et lance l'application, avec des valeurs de développement par défaut.

### Sans Docker

Prérequis : **Node.js 24** et **MySQL 8** ou **MariaDB 10.11+** (les deux sont compatibles ; la production tourne sur MariaDB 12).

```bash
cp .env.example .env      # puis renseigner DB_* et JWT_SECRET
npm install
npm run dev               # http://localhost:3000, rechargement automatique
```

Au premier démarrage, les tables et les migrations sont créées automatiquement,
ainsi que le compte **`superadmin`**, dont le mot de passe est **affiché dans les journaux**.
Changez-le dès la première connexion.

### Variables d'environnement

| Variable | Obligatoire | Rôle |
|---|:---:|---|
| `JWT_SECRET` | ✅ | Signature des jetons de connexion (`openssl rand -hex 48`) |
| `DB_HOST` `DB_PORT` `DB_NAME` `DB_USER` `DB_PASSWORD` | ✅ | Connexion à la base (MySQL ou MariaDB) |
| `BASE_URL` | ✅ | Adresse publique (liens des e-mails et de Discord) |
| `BREVO_API_KEY` `BREVO_SENDER_EMAIL` `BREVO_SENDER_NAME` | — | E-mails (invitations, mot de passe oublié…) |
| `GROQ_API_KEY` | — | Quiz IA des classes standard |
| `PREMIUM_API_KEY` | — | Quiz IA des classes premium (Anthropic) |
| `SUPERADMIN_PASSWORD` | — | Mot de passe du compte `superadmin` créé au premier démarrage (sinon tiré au hasard et affiché dans les journaux) |
| `VAPID_PUBLIC_KEY` `VAPID_PRIVATE_KEY` `VAPID_SUBJECT` | — | Notifications push : générées automatiquement si absentes. Une fois fixées, ne plus les changer (tous les abonnements deviendraient invalides) |

Sans clé, la fonctionnalité correspondante est simplement désactivée.

## 🌍 Déploiement

```mermaid
sequenceDiagram
    autonumber
    actor Dev as Développeur
    participant GH as GitHub
    participant GA as GitHub Actions
    participant VPS as VPS (deploy.sh)
    Dev->>GH: push sur main
    GH->>GA: workflow « CI »
    Note over GA: tests unitaires · migrations sur une base vide · image Docker
    alt CI en échec
        GA-->>Dev: ❌ rien n'est déployé
    else CI verte
        GA->>GA: workflow « Déploiement »
        GA->>VPS: SSH (clé restreinte à la seule commande « eniv »)
        VPS->>VPS: git pull --ff-only
        VPS->>VPS: scripts/version-assets.js
        Note over VPS: liens vers le CSS/JS suffixés par le hash du fichier visé
        VPS->>VPS: docker compose up -d --build
        Note over VPS: Healthcheck : l'API répond et accède à la base
        GA->>VPS: test de fumée sur la production
    end
```

- **Image** : `Dockerfile` (Node 24, dépendances de production uniquement, utilisateur non root).
- **Production** : `compose.yml`, avec le port exposé sur `127.0.0.1` seulement. Caddy sert les pages statiques et relaie `/api`, `/ws` et `/vendor`. Les documents joints ne sont servis que par lien temporaire, réservé aux membres de la classe (`/api/fichiers/<jeton>`).
- **Versions des assets** : n'ajoutez pas de `?v=` à la main dans les liens vers le CSS et le JS. Au déploiement, `deploy.sh` les calcule à partir du contenu de chaque fichier (`scripts/version-assets.js`) : seuls les fichiers modifiés, et ceux qui les importent, sont rechargés par les navigateurs. Si vous avez lancé le script en local, `node scripts/version-assets.js --retirer` enlève les versions avant de committer.
- **Secrets GitHub** : `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`, `DEPLOY_HOST`.

## 👥 Contributeurs

<table>
  <tr>
    <td align="center" width="25%">
      <a href="https://github.com/Picsou06">
        <img src="https://github.com/Picsou06.png?size=200" width="100" alt="Avatar de Picsou06"><br>
        <b>Picsou06</b>
      </a><br>
      <sub>🚀 Créateur du projet</sub>
    </td>
    <td align="center" width="25%">
      <a href="https://github.com/Kevin-OVI">
        <img src="https://github.com/Kevin-OVI.png?size=200" width="100" alt="Avatar de Kevin-OVI"><br>
        <b>Kevin-OVI</b>
      </a><br>
      <sub>💻 Contributeur</sub>
    </td>
    <td align="center" width="25%">
      <a href="https://github.com/Tiretinium">
        <img src="https://github.com/Tiretinium.png?size=200" width="100" alt="Avatar de Tiretinium"><br>
        <b>Tiretinium</b>
      </a><br>
      <sub>💻 Contributeur</sub>
    </td>
    <td align="center" width="25%">
      <a href="https://github.com/CodeByHaamza">
        <img src="https://github.com/CodeByHaamza.png?size=200" width="100" alt="Avatar de CodeByHaamza"><br>
        <b>CodeByHaamza</b>
      </a><br>
      <sub>💻 Contributeur</sub>
    </td>
  </tr>
</table>

<p align="center"><sub>Détail des contributions : <a href="https://github.com/ENIV-ENT/ENIV/graphs/contributors">onglet Insights › Contributors</a></sub></p>

## 🤝 Contribuer

1. Créez une branche nommée selon le sujet : `feature/…`, `fix/…`, `securite/…`, `docs/…`, `ci/…`
2. Faites des commits **petits et séparés**, au format [Conventional Commits](https://www.conventionalcommits.org/fr/) :

   ```text
   feat(devoirs): pièces jointes par glisser-déposer
   fix(auth): 400 quand le mot de passe est absent
   docs(readme): schéma d'architecture
   ```

   | Type | Usage |
   |---|---|
   | `feat` | nouvelle fonctionnalité |
   | `fix` | correction de bug |
   | `refactor` | réorganisation sans changement de comportement |
   | `test` | ajout ou correction de tests |
   | `docs` | documentation |
   | `ci` / `chore` | outillage, CI, dépendances |

3. Ouvrez une pull request qui explique le **pourquoi**, l'**avant / après** et **comment c'est testé**.

<div align="center">
<br>
<sub>Fait avec ❤️ pour les élèves qui oublient leurs devoirs.</sub>
</div>
