/**
 * Script pour supprimer les clés API de test de la base de données
 */
const Database = require('bun:sqlite').default;
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'migallery.db');
const db = Database.open(dbPath);

console.log('🔍 Recherche des clés API de test...\n');

// Lister les clés API de test
const testKeys = db.prepare(`
  SELECT id, label, scopes, revoked, created_at
  FROM api_keys
  WHERE label LIKE 'Test API Key%'
`).all();

if (testKeys.length === 0) {
  console.log('✅ Aucune clé API de test trouvée dans la base de données.');
  process.exit(0);
}

console.log(`📋 ${testKeys.length} clé(s) API de test trouvée(s):\n`);
testKeys.forEach((k, i) => {
  console.log(`  ${i + 1}. ID: ${k.id}`);
  console.log(`     Label: ${k.label}`);
  console.log(`     Scopes: ${k.scopes}`);
  console.log(`     Révoquée: ${k.revoked ? 'Oui' : 'Non'}`);
  console.log(`     Créée le: ${new Date(k.created_at).toLocaleString()}`);
  console.log('');
});

// Supprimer les clés
console.log('🗑️  Suppression des clés API de test...');
const result = db.prepare(`
  DELETE FROM api_keys
  WHERE label LIKE 'Test API Key%'
`).run();

console.log(`\n✅ ${result.changes} clé(s) API de test supprimée(s).`);

db.close();
