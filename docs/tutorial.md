# 📚 Tutoriel : Ajouter une image à un album

Ce guide vous explique étape par étape comment ajouter des photos à un album dans MiGallery.

## Prérequis

- Avoir un compte utilisateur (rôle `mitviste` ou `admin` requis pour créer/modifier des albums)
- Être connecté à l'application

---

## Étape 1 : Accéder à la gestion des albums

1. Connectez-vous à l'application.
2. Dans la barre de navigation, cliquez sur **"Albums"**.
3. Vous verrez la liste de tous les albums disponibles.

## Étape 2 : Créer un nouvel album (si nécessaire)

Si l'album n'existe pas encore :

1. Cliquez sur le bouton **"Créer un album"** (visible uniquement pour les admins/mitvistes).
2. Remplissez le formulaire :
   - **Nom** : Le titre de l'album (ex: "WEI 2024")
   - **Date** : La date de l'événement
   - **Lieu** : L'endroit où les photos ont été prises
   - **Visibilité** :
     - `Public` : Visible par tous les utilisateurs connectés
     - `Privé` : Visible uniquement par les utilisateurs autorisés
     - `Non répertorié` : Accessible uniquement via le lien direct
3. Cliquez sur **"Créer"**.

## Étape 3 : Ajouter des photos

MiGallery est synchronisé avec **Immich**. Pour ajouter des photos à un album MiGallery, vous devez d'abord les avoir dans Immich.

### Méthode 1 : Via l'interface Immich (Recommandé)

1. Ouvrez votre instance Immich.
2. Créez un album dans Immich correspondant à votre événement.
3. Ajoutez vos photos dans cet album Immich.
4. Revenez sur MiGallery.
5. Allez dans l'interface d'administration (`/admin/albums`).
6. Liez l'album Immich à l'album MiGallery en utilisant l'ID de l'album Immich.

### Méthode 2 : Synchronisation automatique

Si la synchronisation est configurée :

1. Les nouveaux albums créés dans Immich peuvent être importés automatiquement via le script de synchronisation.
2. Contactez un administrateur pour lancer une synchronisation manuelle si nécessaire.

## Étape 4 : Gérer les permissions (pour les albums privés)

1. Allez sur la page de l'album.
2. Cliquez sur **"Modifier"** (icône crayon).
3. Dans la section **"Permissions"** :
   - Ajoutez des utilisateurs spécifiques par leur nom.
   - Ou ajoutez des tags (ex: `promo:2025`) pour donner accès à tout un groupe.
4. Sauvegardez les modifications.

---

## 💡 Astuces

- **Photo de couverture** : La première photo de l'album sera utilisée comme couverture par défaut.
- **Téléchargement** : Les utilisateurs peuvent télécharger toutes les photos d'un album en un clic via le bouton "Télécharger tout".
- **Partage** : Pour partager un album privé, ajoutez simplement l'utilisateur à la liste des permissions, il le verra apparaître dans sa liste "Mes Albums".

---

## ❓ Besoin d'aide ?

Si vous rencontrez des problèmes, contactez l'équipe MiTV ou consultez la documentation technique dans le dossier `docs/`.
