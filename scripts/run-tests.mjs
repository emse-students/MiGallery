#!/usr/bin/env node

/**
 * Script pour lancer les tests par catégorie
 * Usage: node scripts/run-tests.mjs [category]
 *
 * Categories disponibles:
 * - all: Tous les tests
 * - api: Tests API de base
 * - albums: Tests albums
 * - users: Tests utilisateurs
 * - admin: Tests admin et auth
 * - people: Tests people/photos-cv
 * - immich: Tests proxy Immich
 * - e2e: Tests end-to-end
 * - quick: Tests rapides (sans Immich)
 * - full: Tests complets avec coverage
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

const categories = {
	all: ['tests/**/*.test.ts'],
	api: ['tests/api.test.ts'],
	albums: ['tests/albums.test.ts'],
	users: ['tests/users.test.ts'],
	favorites: ['tests/favorites-external.test.ts'],
	admin: ['tests/admin-auth.test.ts'],
	people: ['tests/people-photoscv.test.ts'],
	immich: ['tests/immich-proxy.test.ts'],
	e2e: ['tests/e2e-integration.test.ts'],
	quick: [
		'tests/api.test.ts',
		'tests/albums.test.ts',
		'tests/users.test.ts',
		'tests/favorites-external.test.ts',
		'tests/admin-auth.test.ts'
	],
	full: ['tests/**/*.test.ts']
};

const category = process.argv[2] || 'all';

if (!categories[category]) {
	console.error(`❌ Catégorie inconnue: ${category}`);
	console.log('\n📋 Catégories disponibles:');
	Object.keys(categories).forEach((cat) => {
		console.log(`  - ${cat}`);
	});
	process.exit(1);
}

console.log(`🧪 Lancement des tests: ${category}\n`);

const testFiles = categories[category];
const args = ['test'];

if (category === 'full') {
	args.push('--coverage');
}

args.push(...testFiles);

const vitest = spawn('bun', args, {
	cwd: projectRoot,
	stdio: 'inherit',
	env: {
		...process.env,
		API_BASE_URL: process.env.API_BASE_URL || 'http://localhost:3000'
	}
});

vitest.on('exit', (code) => {
	if (code === 0) {
		console.log('\n✅ Tests terminés avec succès');
	} else {
		console.error(`\n❌ Tests échoués (code: ${code})`);
	}
	process.exit(code || 0);
});
