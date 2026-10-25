# Chrome Web Store Listing — DoliSIRH

> Fichier de référence pour le Chrome Web Store Developer Dashboard (conforme aux recommandations du skill `chrome-extensions`).

---

## Basic Info

| Field | Value |
|---|---|
| **Extension Name** | DoliSIRH |
| **Summary** (≤132 chars) | Extension navigateur DoliSIRH pour le suivi du temps, des présences et des projets RH dans Dolibarr |
| **Category** | Productivity (Workflow & Planning) |
| **Language** | Français (`fr` par défaut) — multilingue (`fr`, `en`, `es`, `de`, `it`) |

---

## Detailed Description (FR)

Connectez votre navigateur à votre instance Dolibarr ERP/CRM équipée du module DoliSIRH pour suivre votre temps de travail, vos présences/absences et vos projets directement depuis la barre d'outils de Chrome.

FONCTIONNALITÉS PRINCIPALES
• Pointage Présence & Absence (Vue Semaine) : Saisissez rapidement vos heures de travail, télétravail, congés ou absences grâce aux horaires hebdomadaires pré-remplis et aux boutons d'accès rapide.
• Suivi Mensuel (Vue Mois) : Visualisez en un coup d'œil vos feuilles de temps mensuelles, le cumul des heures pointées par rapport aux heures théoriques et l'état de vos journées.
• Pointage sur Projets & Tâches (Vue Projet) : Imputez votre temps sur les projets et tâches Dolibarr auxquels vous êtes affecté, ou ajoutez une note de suivi sur une tâche.
• Multi-profils & Multi-entités (Multicompany) : Gérez plusieurs instances Dolibarr ou plusieurs entités et basculez d'un profil ou d'une entité à l'autre en un clic.
• Multilingue : Interface intégralement traduite en français, anglais, espagnol, allemand et italien.

CONFIDENTIALITÉ ET SÉCURITÉ
• Vos données vous appartiennent : DoliSIRH communique exclusivement et directement avec l'API REST de votre propre serveur Dolibarr configuré dans les options.
• Aucun serveur tiers, aucun pistage publicitaire et aucune télémétrie externe.
• Les permissions d'accès réseau ne sont demandées dynamiquement que pour le domaine précis de votre instance Dolibarr.

PRÉREQUIS
• Une instance Dolibarr ERP/CRM accessible avec le module API REST activé.
• Le module DoliSIRH installé et activé sur Dolibarr (disponible sur le DoliStore : https://www.dolistore.com/product.php?id=597&l=fr).

---

## Detailed Description (EN)

Connect your browser to your Dolibarr ERP/CRM instance powered by the DoliSIRH module to track working hours, attendance/absences, and project time directly from your Chrome toolbar.

KEY FEATURES
• Attendance & Absence Tracking (Week View): Quickly log working hours, remote work, leave, or absences using pre-filled weekly schedules and quick-select buttons.
• Monthly Overview (Month View): View your monthly timesheets at a glance, comparing logged hours against planned hours across each day of the month.
• Project & Task Time Logging (Project View): Log time spent on assigned Dolibarr projects and tasks, or attach progress notes directly to a task.
• Multi-Profile & Multi-Entity (Multicompany): Configure multiple Dolibarr instances or entities and switch between them in one click.
• Multilingual: Full interface available in French, English, Spanish, German, and Italian.

PRIVACY & SECURITY
• Your data stays yours: DoliSIRH communicates exclusively and directly with your own self-hosted Dolibarr REST API.
• No third-party servers, no analytics tracking, and no external telemetry.
• Network host permissions are requested dynamically only for the specific Dolibarr domain you configure.

---

## Graphic Assets Checklist

| Asset | Dimensions | Status / File |
|---|---|---|
| **Toolbar Icon (32×32)** | 32×32 PNG | `icon32.png` (32×32 verified) |
| **Store Icon (128×128)** | 128×128 PNG | `icon128.png` (128×128 verified) |
| **Extension Icon (192×192)** | 192×192 PNG | `icon192.png` (192×192 verified) |
| **Screenshots** (1–5 required) | 1280×800 or 640×400 PNG/JPEG (no alpha) | À capturer depuis le popup (Vue Semaine, Vue Mois, Vue Projet) et la page d'options |
| **Small Promo Tile** (optional) | 440×280 PNG/JPEG | Optionnel |
| **Marquee Promo Tile** (optional) | 1400×560 PNG/JPEG | Optionnel |

---

## Privacy Tab Disclosures (Formulaires Chrome Web Store)

### Single Purpose Description (FR)
Saisie et suivi du temps de travail, des présences/absences hebdomadaires et mensuelles ainsi que du temps passé sur les projets et tâches dans un ERP/CRM Dolibarr (avec le module DoliSIRH) connecté via son API REST.

### Single Purpose Description (EN)
Track working hours, weekly/monthly attendance and absences, and time spent on projects and tasks in a self-hosted Dolibarr ERP/CRM instance (with the DoliSIRH module) via its REST API.

### Permission Justifications

| Permission | Justification (FR — copier dans le Dashboard) | Justification (EN — copy into Dashboard) |
|---|---|---|
| `storage` | Utilisé pour sauvegarder la configuration des profils de connexion Dolibarr (URL de l'instance, clé API REST, entité, langue, horaires hebdomadaires théoriques via `chrome.storage.sync`) et mettre en cache localement la liste des projets, tâches et feuilles de temps (`chrome.storage.local`) afin d'offrir une ouverture instantanée du popup. | Used to store user configuration and Dolibarr connection profiles (instance URL, REST API key, entity, language, weekly schedule in `chrome.storage.sync`) and locally cache projects, tasks, and timesheets (`chrome.storage.local`) for fast popup rendering. |
| `optional_host_permissions` (`https://*/*`, `http://*/*`) | Chaque entreprise hébergeant son instance Dolibarr ERP/CRM sur son propre nom de domaine (cloud ou auto-hébergé), le domaine cible ne peut pas être connu à l'avance. L'extension utilise `optional_host_permissions` pour demander dynamiquement l'accès réseau (`chrome.permissions.request`) uniquement pour l'origine exacte du serveur Dolibarr configuré par l'utilisateur. | Because each company hosts its Dolibarr ERP/CRM instance on its own custom domain (cloud or self-hosted), the target domain cannot be hardcoded at build time. The extension uses `optional_host_permissions` to dynamically request network access (`chrome.permissions.request`) solely for the specific Dolibarr origin configured by the user. |

### Remote Code
- **Are you using remote code?** **No** — Tout le code JavaScript et CSS est intégralement embarqué dans le package de l'extension (Manifest V3 strict). Seules des données JSON sont échangées avec l'API REST du serveur Dolibarr configuré par l'utilisateur.

### Data Usage Disclosures
- **Authentication information** : Oui (uniquement la clé API Dolibarr `DOLAPIKEY` saisie par l'utilisateur, stockée dans `chrome.storage.sync` et transmise uniquement au serveur Dolibarr de l'utilisateur).
- **Personal communications / Website content** : Non collecté à des fins externes (les temps pointés, notes de tâches et présences sont envoyés directement à l'instance Dolibarr de l'utilisateur sur son action explicite).
- **Certifications (3 cases à cocher)** :
  - [x] I do not sell or transfer user data to third parties, outside of the approved use cases.
  - [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
  - [x] I do not use or transfer user data to determine creditworthiness or for lending purposes.

---

## Distribution

| Setting | Value |
|---|---|
| **Visibility** | Public |
| **Regions** | All regions |
| **Pricing** | Free |

---

## Version History

| Version | Date | Notes |
|---|---|---|
| `23.0.3` | 2026-10-25 | Première publication Chrome Web Store (Vues Semaine, Mois et Projet, détection API REST & module DoliSIRH avec lien DoliStore, validation temps nul présence vs projet avec note, nettoyage des permissions Manifest V3 et workflow GitHub Actions de release ZIP). |
