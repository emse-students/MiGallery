#!/usr/bin/env node
/**
 * Script pour lancer les tests API avec un serveur local
 * Usage: bun run test:api:full
 */

import { spawn } from 'child_process';
import { setTimeout } from 'timers/promises';
import { readFileSync } from 'fs';
import { join } from 'path';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
const SERVER_STARTUP_DELAY = 7000; // 7 secondes (donne un peu plus de marge au serveur)
const READINESS_TIMEOUT = 30000; // 30s
const READINESS_POLL_INTERVAL = 500; // 0.5s

/**
 * Charge les variables d'environnement depuis .env
 */
function loadEnv() {
	try {
		const envPath = join(process.cwd(), '.env');
		const content = readFileSync(envPath, 'utf-8');
		const env = {};
		content.split('\n').forEach((line) => {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith('#')) return;
			const [key, ...rest] = trimmed.split('=');
			if (key && rest.length > 0) {
				env[key.trim()] = rest.join('=').trim();
			}
		});
		return env;
	} catch (error) {
		console.warn('⚠️  Impossible de charger .env:', error.message);
		return {};
	}
}

/**
 * Build le serveur SvelteKit
 */
async function buildServer() {
	console.log('🔨 Building SvelteKit...\n');

	return new Promise((resolve, reject) => {
		const build = spawn('bun', ['run', 'build'], {
			stdio: 'inherit',
			shell: process.platform === 'win32',
			env: { ...process.env, NODE_ENV: 'test' }
		});

		build.on('close', (code) => {
			if (code === 0) {
				console.log('\n✅ Build terminé avec succès\n');
				resolve(true);
			} else {
				console.error(`\n❌ Build échoué avec le code ${code}\n`);
				reject(new Error(`Build process exited with code ${code}`));
			}
		});

		build.on('error', (error) => {
			console.error('\n❌ Erreur lors du build:', error);
			reject(error);
		});
	});
}

async function waitForReadiness(url, timeout = READINESS_TIMEOUT) {
	const start = Date.now();
	while (Date.now() - start < timeout) {
		try {
			const res = await fetch(url, { method: 'GET' });
			// Si on obtient une réponse HTTP (quel que soit le code), considérer le service prêt
			// Certaines routes peuvent retourner 404 si non configurées; l'important est que le serveur réponde.
			return res;
		} catch (e) {
			// connexion refusée => serveur pas encore prêt
			await setTimeout(READINESS_POLL_INTERVAL);
		}
	}
	throw new Error(`Timeout waiting for readiness at ${url}`);
}

async function main() {
	let server = null;

	try {
		// 0. Charger le .env
		const envVars = loadEnv();
		console.log('📄 Variables .env chargées:', Object.keys(envVars).join(', '));

		// Définir NODE_ENV=test pour activer les routes de dev pendant les tests
		process.env.NODE_ENV = 'test';
		console.log('✅ NODE_ENV défini à "test"');

		// 1. Build le serveur
		await buildServer();

		console.log('🚀 Démarrage du serveur de test...\n');

		// 2. Démarrer le serveur (exécuter le fichier build avec bun)
		server = spawn('bun', ['./build/index.js'], {
			stdio: 'inherit',
			detached: false,
			env: { ...process.env, ...envVars, NODE_ENV: 'test' }
		});

		// 3. Attendre que le serveur démarre
		await setTimeout(SERVER_STARTUP_DELAY);

		console.log(`\n✅ Serveur démarré sur ${API_BASE_URL} (en attente de disponibilité)`);
		try {
			const healthUrl = `${API_BASE_URL.replace(/\/$/, '')}/api/health`;
			await waitForReadiness(healthUrl);
			console.log('✅ Endpoint /api/health répond — démarrage OK');
		} catch (err) {
			console.warn(`⚠️  Readiness probe failed: ${(err && err.message) || err}`);
			console.log("⚠️  Poursuite des tests malgré l'échec de la probe (timeout)");
		}

		console.log('🧪 Lancement des tests...\n');

		// 4. Lancer les tests
		const tests = spawn('bun', ['run', 'vitest', 'run'], {
			stdio: 'inherit',
			env: { ...process.env, ...envVars, API_BASE_URL, NODE_ENV: 'test' }
		});

		// 5. Attendre la fin des tests
		tests.on('close', async (code) => {
			console.log('\n🛑 Arrêt du serveur...');
			server.kill();

			// 6. Nettoyer les artefacts de test
			console.log('\n🧹 Nettoyage des artefacts de test...');
			const cleanup = spawn('node', ['./scripts/cleanup-test-artifacts.cjs'], {
				stdio: 'inherit'
			});

			cleanup.on('close', () => {
				process.exit(code);
			});

			cleanup.on('error', () => {
				// Ignorer les erreurs de cleanup et quitter avec le code des tests
				process.exit(code);
			});
		});
	} catch (error) {
		console.error('\n💥 Erreur:', error.message);

		if (server) {
			console.log('🛑 Arrêt du serveur...');
			server.kill();
		}

		process.exit(1);
	}
}

// Cleanup en cas d'interruption
process.on('SIGINT', () => {
	console.log('\n⚠️  Interruption détectée, arrêt du serveur...');
	process.exit(1);
});

process.on('SIGTERM', () => {
	console.log('\n⚠️  Terminaison demandée, arrêt du serveur...');
	process.exit(1);
});

main();
