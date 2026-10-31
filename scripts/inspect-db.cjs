#!/usr/bin/env bun

const fs = require('fs');
const path = require('path');

const { Database } = require('bun:sqlite');

const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'migallery.db');
const REPAIR_MODE = process.argv.includes('--repair');

console.log('🔍 Inspection de la base de données...');
console.log('📍 Emplacement:', DB_PATH);
console.log('');

if (!fs.existsSync(DB_PATH)) {
  console.error('❌ Base de données non trouvée:', DB_PATH);
  console.log('\n💡 Utilisez "bun run db:init" pour créer une nouvelle base de données.');
  process.exit(1);
}

let hasErrors = false;
const errors = [];

// Inspection
let db;
try {
  db = new Database(DB_PATH, { readonly: true });
} catch (e) {
  console.error(`❌ Impossible d'ouvrir la base de données: ${e.message}`);
  process.exit(1);
}

try {
  console.log('📊 STATISTIQUES DE LA BASE DE DONNÉES\n');

  console.log("1. Vérification de l'intégrité...");
  try {
    const integrity = db.prepare('PRAGMA integrity_check').all();
    if (integrity.length === 1 && integrity[0].integrity_check === 'ok') {
      console.log('   ✅ Intégrité OK');
    } else {
      console.error("   ❌ Problèmes d'intégrité détectés:");
      integrity.forEach((i) => console.error('      -', i.integrity_check));
      hasErrors = true;
      errors.push('integrity_check_failed');
    }
  } catch (e) {
    console.error('   ❌ Erreur lors de la vérification:', e.message);
    hasErrors = true;
    errors.push('integrity_check_error');
  }

  console.log('\n2. Tables présentes:');
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all();
  tables.forEach((t) => console.log(`   - ${t.name}`));

  const expectedTables = ['users', 'albums', 'album_permissions'];
  const missingTables = expectedTables.filter((t) => !tables.find((row) => row.name === t));
  if (missingTables.length > 0) {
    console.error('   ❌ Tables manquantes:', missingTables.join(', '));
    hasErrors = true;
    errors.push('missing_tables');
  } else {
    console.log('   ✅ Toutes les tables attendues sont présentes');
  }

  console.log('\n3. Statistiques:');
  try {
    const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get();
    console.log(`   - Utilisateurs: ${userCount.c}`);

    const albumCount = db.prepare('SELECT COUNT(*) AS c FROM albums').get();
    console.log(`   - Albums: ${albumCount.c}`);

    const adminCount = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role='admin'").get();
    console.log(`   - Administrateurs: ${adminCount.c}`);
  } catch (e) {
    console.error('   ❌ Erreur lors du comptage:', e.message);
    hasErrors = true;
    errors.push('count_error');
  }

  console.log('\n4. Vérification des clés étrangères...');
  try {
    const fkCheck = db.prepare('PRAGMA foreign_key_check').all();
    if (fkCheck.length === 0) {
      console.log('   ✅ Toutes les clés étrangères sont valides');
    } else {
      console.error('   ❌ Violations de clés étrangères détectées:');
      fkCheck.forEach((fk) => console.error('      -', JSON.stringify(fk)));
      hasErrors = true;
      errors.push('foreign_key_violations');
    }
  } catch (e) {
    console.error('   ❌ Erreur lors de la vérification des FK:', e.message);
    hasErrors = true;
    errors.push('fk_check_error');
  }

  console.log('\n5. Exemples de données (premiers résultats):');
  try {
    console.log('\n   Utilisateurs (5 premiers):');
    const users = db.prepare('SELECT id_user, name, role, promo FROM users LIMIT 5').all();
    users.forEach((u) =>
      console.log(
        `      - ${u.id_user} (${u.name}) [${u.role}] ${u.promo ? `Promo ${u.promo}` : 'sans promo'}`
      )
    );

    console.log('\n   Albums (5 premiers):');
    const albums = db.prepare('SELECT id, name, visibility, visible FROM albums LIMIT 5').all();
    albums.forEach((a) =>
      console.log(`      - ${a.name} [${a.visibility}] ${a.visible ? '👁️' : '🔒'}`)
    );
  } catch (e) {
    console.warn('   ⚠️  Impossible de lire les exemples:', e.message);
  }
} catch (error) {
  console.error("\n❌ Erreur fatale lors de l'inspection:", error.message);
  hasErrors = true;
  errors.push('fatal_error');
} finally {
  try {
    db.close();
  } catch {}
}

// Résumé et actions
console.log('\n' + '='.repeat(60));
if (!hasErrors) {
  console.log('✅ Base de données saine ! Aucune erreur détectée.');
  console.log('='.repeat(60));
  process.exit(0);
} else {
  console.log('❌ Erreurs détectées dans la base de données !');
  console.log('='.repeat(60));
  console.log('\nErreurs trouvées:');
  errors.forEach((e) => console.log(`   - ${e}`));

  if (REPAIR_MODE) {
    console.log('\n🔧 MODE RÉPARATION ACTIVÉ');
    console.log('\nTentative de réparation...');

    // The only automatic repair this script had recreated an obsolete system account; none of the
    // errors above has one, so a repair run says so and points at the backup-and-reset path.
    console.log('\n⚠️  Aucune réparation automatique disponible pour ces erreurs.');
    suggestBackupAndReset();
  } else {
    console.log('\n💡 Pour tenter une réparation automatique:');
    console.log('   bun run db:inspect -- --repair');
    console.log('\n💡 Si la réparation échoue, une sauvegarde et réinitialisation sera proposée.');
  }

  process.exit(1);
}

function suggestBackupAndReset() {
  console.log('\n⚠️  RÉPARATION AUTOMATIQUE IMPOSSIBLE');
  console.log('\n💡 Solutions recommandées:');
  console.log('   1. Sauvegarder la base actuelle:');
  console.log('      bun run db:backup');
  console.log('   2. Renommer ou supprimer la base corrompue');
  console.log('   3. Réinitialiser avec:');
  console.log('      bun run db:init');
  console.log('\n⚠️  Toutes les données seront perdues lors de la réinitialisation !');
}
