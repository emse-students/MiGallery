# Configuration des tâches automatiques

> **✨ Bonne nouvelle — cron optionnel depuis Avril 2026**
>
> La sauvegarde automatique quotidienne est désormais **intégrée au serveur** : au démarrage de l’application,
> `startBackupScheduler()` programme une sauvegarde à minuit (puis toutes les 24 h). **Aucun cron extérieur
> n’est requis.** Vous pouvez tout de même configurer un cron en complément si vous souhaitez une rédondance
> (ex. : sauvegarde toutes les 6 h, ou export vers un stockage distant).

Ce document explique comment configurer des sauvegardes supplémentaires via cron ou tâche planifiée.

## 🐧 Linux / Mac (cron)

### Installation de la tâche cron

1. Ouvrir l'éditeur cron :

```bash
crontab -e
```

2. Ajouter cette ligne pour une sauvegarde quotidienne à minuit :

```bash
0 0 * * * cd /chemin/absolu/vers/MiGallery && bun run db:backup >> /var/log/migallery-backup.log 2>&1
```

3. Sauvegarder et quitter (généralement : `Ctrl+X`, puis `Y`, puis `Entrée`)

### Vérifier les tâches cron installées

```bash
crontab -l
```

### Format de la ligne cron

```
┌───────────── minute (0 - 59)
│ ┌───────────── heure (0 - 23)
│ │ ┌───────────── jour du mois (1 - 31)
│ │ │ ┌───────────── mois (1 - 12)
│ │ │ │ ┌───────────── jour de la semaine (0 - 6) (dimanche à samedi)
│ │ │ │ │
│ │ │ │ │
* * * * * commande à exécuter
```

### Exemples de planifications

```bash
# Tous les jours à minuit
0 0 * * * cd /chemin/vers/MiGallery && bun run db:backup

# Tous les jours à 2h du matin
0 2 * * * cd /chemin/vers/MiGallery && bun run db:backup

# Tous les dimanches à 3h du matin
0 3 * * 0 cd /chemin/vers/MiGallery && bun run db:backup

# Toutes les 6 heures
0 */6 * * * cd /chemin/vers/MiGallery && bun run db:backup
```

---

## 🪟 Windows (Planificateur de tâches)

### Création via l'interface graphique

1. **Ouvrir le Planificateur de tâches**
   - Appuyer sur `Win + R`
   - Taper `taskschd.msc`
   - Appuyer sur `Entrée`

2. **Créer une tâche de base**
   - Dans le panneau de droite, cliquer sur **"Créer une tâche de base"**
   - Nom : `MiGallery - Sauvegarde DB`
   - Description : `Sauvegarde quotidienne de la base de données MiGallery`
   - Cliquer sur **Suivant**

3. **Configurer le déclencheur**
   - Sélectionner **"Tous les jours"**
   - Cliquer sur **Suivant**
   - Heure : `00:00:00` (minuit)
   - Récurrence : `1` jour
   - Cliquer sur **Suivant**

4. **Configurer l'action**
   - Sélectionner **"Démarrer un programme"**
   - Cliquer sur **Suivant**
   - Programme/script : `bun` (ou chemin complet : `C:\Users\VotreNom\.bun\bin\bun.exe`)
   - Ajouter des arguments : `run db:backup`
   - Commencer dans : `D:\Projets Programmation\EMSE\Portail etu\MiGallery`
   - Cliquer sur **Suivant**

5. **Finaliser**
   - Cocher **"Ouvrir la boîte de dialogue Propriétés..."**
   - Cliquer sur **Terminer**

6. **Options avancées (dans Propriétés)**
   - Onglet **Général** :
     - Cocher **"Exécuter même si l'utilisateur n'est pas connecté"**
     - Cocher **"Exécuter avec les autorisations maximales"** (si nécessaire)
   - Onglet **Conditions** :
     - Décocher **"Démarrer la tâche uniquement si l'ordinateur est relié au secteur"** (si laptop)
   - Onglet **Paramètres** :
     - Cocher **"Autoriser la tâche à être exécutée à la demande"**
   - Cliquer sur **OK**

### Création via PowerShell

```powershell
# Définir les variables
$taskName = "MiGallery-BackupDB"
$taskDescription = "Sauvegarde quotidienne de la base de données MiGallery"
$bunPath = "bun"  # ou chemin complet
$projectPath = "D:\Projets Programmation\EMSE\Portail etu\MiGallery"
$time = "00:00"  # minuit

# Créer l'action
$action = New-ScheduledTaskAction -Execute $bunPath -Argument "run db:backup" -WorkingDirectory $projectPath

# Créer le déclencheur (quotidien à minuit)
$trigger = New-ScheduledTaskTrigger -Daily -At $time

# Créer les paramètres
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

# Enregistrer la tâche
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description $taskDescription

Write-Host "✅ Tâche planifiée créée avec succès !"
Write-Host "Nom : $taskName"
Write-Host "Heure : $time"
```

### Tester la tâche manuellement

```powershell
Start-ScheduledTask -TaskName "MiGallery-BackupDB"
```

### Vérifier les tâches planifiées

```powershell
Get-ScheduledTask -TaskName "MiGallery-BackupDB"
```

### Supprimer la tâche

```powershell
Unregister-ScheduledTask -TaskName "MiGallery-BackupDB" -Confirm:$false
```

---

## 📋 Vérification et logs

### Vérifier que les sauvegardes fonctionnent

```bash
# Lister les sauvegardes
ls -lh data/backups/

# Voir les 10 derniers fichiers de sauvegarde
ls -lt data/backups/ | head -10
```

### Logs (Linux/Mac)

Si vous avez redirigé la sortie vers un fichier log :

```bash
tail -f /var/log/migallery-backup.log
```

### Logs (Windows)

- Ouvrir l'**Observateur d'événements** (`eventvwr.msc`)
- Aller dans **Bibliothèque du Planificateur de tâches**
- Chercher **MiGallery-BackupDB**
- Voir l'historique dans l'onglet **Historique**

---

## 🔧 Dépannage

### La tâche ne s'exécute pas

1. **Vérifier que Bun est dans le PATH**

   ```bash
   which bun  # Linux/Mac
   where bun  # Windows
   ```

2. **Tester manuellement**

   ```bash
   cd /chemin/vers/MiGallery
   bun run db:backup
   ```

3. **Vérifier les permissions**
   - L'utilisateur qui exécute la tâche doit avoir les droits d'écriture dans `data/backups/`

4. **Utiliser des chemins absolus**
   - Remplacer `bun` par le chemin complet : `/usr/local/bin/bun` ou `C:\Users\...\bun.exe`

### Les anciennes sauvegardes ne sont pas supprimées

- Vérifier que les sauvegardes se créent bien dans `data/backups/` après minuit (géré par le serveur)
- Lancer manuellement `bun run db:backup` pour tester la logique de sauvegarde

---

## ✅ Récapitulatif

- **Mécanisme par défaut** : `startBackupScheduler()` dans `src/lib/server/backup.ts` (intégré au serveur)
- **Script CLI** : `scripts/backup-db.cjs` (sauvegarde manuelle ou cron supplémentaire)
- **Fréquence recommandée** : Quotidienne (minuit)
- **Rétention** : 10 dernières sauvegardes
- **Emplacement** : `data/backups/`
- **Format** : `migallery_backup_YYYY-MM-DD_HH-MM-SS.db`

**Note** : Vous pouvez également utiliser l'interface admin pour exporter/importer la DB manuellement depuis le navigateur.
