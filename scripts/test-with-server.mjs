#!/usr/bin/env node
/**
 * Script pour lancer les tests API avec un serveur local
 * Usage: bun run test:api:full
 */

import { spawn } from 'child_process';
import { setTimeout } from 'timers/promises';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
const SERVER_STARTUP_DELAY = 7000; // 7 secondes (donne un peu plus de marge au serveur)
const READINESS_TIMEOUT = 30000; // 30s
const READINESS_POLL_INTERVAL = 500; // 0.5s

console.log('🚀 Démarrage du serveur de test...\n');

// Démarrer le serveur (exécuter le fichier build avec bun)
// Utiliser './build/index.js' pour invoquer directement le bundle Bun.
const server = spawn('bun', ['./build/index.js'], {
	stdio: 'inherit',
	detached: false
});

// Attendre que le serveur démarre
// Attendre un délai initial, puis effectuer un polling actif sur /api/health
await setTimeout(SERVER_STARTUP_DELAY);

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

// Lancer les tests
const tests = spawn('bun', ['run', 'vitest', 'run'], {
	stdio: 'inherit',
	env: { ...process.env, API_BASE_URL }
});

// Attendre la fin des tests
tests.on('close', (code) => {
	console.log('\n🛑 Arrêt du serveur...');
	server.kill();
	process.exit(code);
});

// Cleanup en cas d'interruption
process.on('SIGINT', () => {
	console.log('\n⚠️  Interruption détectée, arrêt du serveur...');
	server.kill();
	process.exit(1);
});

process.on('SIGTERM', () => {
	console.log('\n⚠️  Terminaison demandée, arrêt du serveur...');
	server.kill();
	process.exit(1);
});
