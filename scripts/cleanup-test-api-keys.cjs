/**
 * Script pour supprimer les clés API de test de la base de données
 */
const Database = require('bun:sqlite').default;
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'migallery.db');
const db = Database.open(dbPath);

console.log('🔍 Recherche des clés API de test...\n');

// Patterns de clés de test à supprimer
const TEST_KEY_PATTERNS = [
	'Test API Key%',
	'Test Read Key',
	'Test Permission Key',
	'Temp key for delete test',
	'Multi Scope Key',
	'Invalid Scope Key',
	'Read Only Key',
	'Admin Key Test',
	'E2E Test%',
	'Test External API'
];

// Lister les clés API de test (label vide ou correspondant aux patterns)
const testKeys = db
	.prepare(
		`
  SELECT id, label, scopes, revoked, created_at
  FROM api_keys
  WHERE label = ''
     OR label LIKE 'Test API Key%'
     OR label LIKE 'Test Read Key%'
     OR label LIKE 'Test Permission Key%'
     OR label LIKE 'Temp key for delete test%'
     OR label LIKE 'E2E Test%'
     OR label = 'Multi Scope Key'
     OR label = 'Invalid Scope Key'
     OR label = 'Read Only Key'
     OR label = 'Admin Key Test'
     OR label = 'Test External API'
`
	)
	.all();

if (testKeys.length === 0) {
	console.log('✅ Aucune clé API de test trouvée dans la base de données.');
	process.exit(0);
}

console.log(`📋 ${testKeys.length} clé(s) API de test trouvée(s):\n`);
testKeys.forEach((k, i) => {
	console.log(`  ${i + 1}. ID: ${k.id}`);
	console.log(`     Label: ${k.label || '(vide)'}`);
	console.log(`     Scopes: ${k.scopes}`);
	console.log(`     Révoquée: ${k.revoked ? 'Oui' : 'Non'}`);
	console.log(`     Créée le: ${new Date(k.created_at).toLocaleString()}`);
	console.log('');
});

// Supprimer les clés
console.log('🗑️  Suppression des clés API de test...');
const result = db
	.prepare(
		`
  DELETE FROM api_keys
  WHERE label = ''
     OR label LIKE 'Test API Key%'
     OR label LIKE 'Test Read Key%'
     OR label LIKE 'Test Permission Key%'
     OR label LIKE 'Temp key for delete test%'
     OR label LIKE 'E2E Test%'
     OR label = 'Multi Scope Key'
     OR label = 'Invalid Scope Key'
     OR label = 'Read Only Key'
     OR label = 'Admin Key Test'
     OR label = 'Test External API'
`
	)
	.run();

console.log(`\n✅ ${result.changes} clé(s) API de test supprimée(s).`);

db.close();
