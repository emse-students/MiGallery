# Automatic Task Configuration

> **✨ Good news - cron optional since April 2026**
>
> The daily automatic backup is now **built into the server**: when the application starts,
> `startBackupScheduler()` schedules a backup at midnight (then every 24h). **No external cron
> is required.** You can still set up an additional cron if you want redundancy
> (e.g., backup every 6h, or export to remote storage).

This document explains how to configure additional backups via cron or scheduled task.

## 🐧 Linux / Mac (cron)

### Installing the cron task

1. Open the cron editor:

```bash
crontab -e
```

2. Add this line for a daily backup at midnight:

```bash
0 0 * * * cd /absolute/path/to/MiGallery && npm run db:backup >> /var/log/migallery-backup.log 2>&1
```

3. Save and quit (usually: `Ctrl+X`, then `Y`, then `Enter`)

### Check installed cron tasks

```bash
crontab -l
```

### Cron line format

```
┌───────────── minute (0 - 59)
│ ┌───────────── hour (0 - 23)
│ │ ┌───────────── day of month (1 - 31)
│ │ │ ┌───────────── month (1 - 12)
│ │ │ │ ┌───────────── day of week (0 - 6) (Sunday to Saturday)
│ │ │ │ │
│ │ │ │ │
* * * * * command to execute
```

### Scheduling examples

```bash
# Every day at midnight
0 0 * * * cd /path/to/MiGallery && npm run db:backup

# Every day at 2am
0 2 * * * cd /path/to/MiGallery && npm run db:backup

# Every Sunday at 3am
0 3 * * 0 cd /path/to/MiGallery && npm run db:backup

# Every 6 hours
0 */6 * * * cd /path/to/MiGallery && npm run db:backup
```

---

## 🪟 Windows (Task Scheduler)

### Creation via GUI

1. **Open Task Scheduler**
   - Press `Win + R`
   - Type `taskschd.msc`
   - Press `Enter`

2. **Create a basic task**
   - In the right panel, click **"Create Basic Task"**
   - Name: `MiGallery - DB Backup`
   - Description: `Daily MiGallery database backup`
   - Click **Next**

3. **Configure the trigger**
   - Select **"Daily"**
   - Click **Next**
   - Time: `00:00:00` (midnight)
   - Recurrence: `1` day
   - Click **Next**

4. **Configure the action**
   - Select **"Start a program"**
   - Click **Next**
   - Program/script: `npm` (or full path: `C:\Users\YourName\.npm\bin\npm.exe`)
   - Add arguments: `run db:backup`
   - Start in: `D:\Projects\MiGallery`
   - Click **Next**

5. **Finalize**
   - Check **"Open Properties dialog..."**
   - Click **Finish**

6. **Advanced options (in Properties)**
   - **General** tab:
     - Check **"Run whether user is logged on or not"**
     - Check **"Run with highest privileges"** (if needed)
   - **Conditions** tab:
     - Uncheck **"Start the task only if the computer is on AC power"** (if laptop)
   - **Settings** tab:
     - Check **"Allow task to be run on demand"**
   - Click **OK**

### Creation via PowerShell

```powershell
# Define variables
$taskName = "MiGallery-BackupDB"
$taskDescription = "Daily MiGallery database backup"
$bunPath = "npm"  # or full path
$projectPath = "D:\Projects\MiGallery"
$time = "00:00"  # midnight

# Create the action
$action = New-ScheduledTaskAction -Execute $bunPath -Argument "run db:backup" -WorkingDirectory $projectPath

# Create the trigger (daily at midnight)
$trigger = New-ScheduledTaskTrigger -Daily -At $time

# Create the settings
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

# Register the task
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description $taskDescription

Write-Host "✅ Scheduled task created successfully!"
Write-Host "Name: $taskName"
Write-Host "Time: $time"
```

### Test the task manually

```powershell
Start-ScheduledTask -TaskName "MiGallery-BackupDB"
```

### Check scheduled tasks

```powershell
Get-ScheduledTask -TaskName "MiGallery-BackupDB"
```

### Delete the task

```powershell
Unregister-ScheduledTask -TaskName "MiGallery-BackupDB" -Confirm:$false
```

---

## 📋 Verification and logs

### Verify backups are working

```bash
# List backups
ls -lh data/backups/

# View the 10 most recent backup files
ls -lt data/backups/ | head -10
```

### Logs (Linux/Mac)

If you redirected output to a log file:

```bash
tail -f /var/log/migallery-backup.log
```

### Logs (Windows)

- Open **Event Viewer** (`eventvwr.msc`)
- Go to **Task Scheduler Library**
- Look for **MiGallery-BackupDB**
- View history in the **History** tab

---

## 🔧 Troubleshooting

### The task does not run

1. **Check that npm is in PATH**

   ```bash
   which npm  # Linux/Mac
   where npm  # Windows
   ```

2. **Test manually**

   ```bash
   cd /path/to/MiGallery
   npm run db:backup
   ```

3. **Check permissions**
   - The user running the task must have write permissions in `data/backups/`

4. **Use absolute paths**
   - Replace `npm` with the full path: `/usr/local/bin/npm` or `C:\Users\...\npm.exe`

### Old backups are not deleted

- Check that backups are being created in `data/backups/` after midnight (managed by the server)
- Run `npm run db:backup` manually to test the backup logic

---

## ✅ Summary

- **Default mechanism**: `startBackupScheduler()` in `src/lib/server/backup.ts` (built into the server)
- **CLI script**: `scripts/backup-db.cjs` (manual backup or additional cron)
- **Recommended frequency**: Daily (midnight)
- **Retention**: Last 10 backups
- **Location**: `data/backups/`
- **Format**: `migallery_backup_YYYY-MM-DD_HH-MM-SS.db`

**Note**: You can also use the admin interface to export/import the DB manually from the browser.
