#!/usr/bin/env node

/**
 * Script pour attendre que le serveur soit prêt avant de lancer les tests
 * Usage: node scripts/wait-for-server.mjs [url] [timeout]
 */

const API_BASE_URL = process.argv[2] || process.env.API_BASE_URL || 'http://localhost:3000';
const MAX_WAIT_TIME = parseInt(process.argv[3] || '60000', 10); // 60 secondes par défaut
const CHECK_INTERVAL = 1000; // 1 seconde

async function checkServer() {
	try {
		const response = await fetch(`${API_BASE_URL}/api/health`);
		return response.ok;
	} catch {
		return false;
	}
}

async function waitForServer() {
	const startTime = Date.now();
	let attempts = 0;

	console.log(`⏳ En attente du serveur sur ${API_BASE_URL}...`);

	while (Date.now() - startTime < MAX_WAIT_TIME) {
		attempts++;

		if (await checkServer()) {
			console.log(`✅ Serveur prêt après ${attempts} tentative(s) (${Date.now() - startTime}ms)`);
			return true;
		}

		if (attempts % 5 === 0) {
			console.log(`   Tentative ${attempts}... (${Math.floor((Date.now() - startTime) / 1000)}s)`);
		}

		await new Promise((resolve) => setTimeout(resolve, CHECK_INTERVAL));
	}

	console.error(`❌ Timeout: le serveur n'est pas disponible après ${MAX_WAIT_TIME}ms`);
	return false;
}

// Exécution
waitForServer().then((ready) => {
	process.exit(ready ? 0 : 1);
});
