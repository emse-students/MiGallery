#!/usr/bin/env node
/**
 * Script pour lancer les tests API avec un serveur local
 * Usage: bun run test:api:full
 */

import { spawn } from 'child_process';
import { setTimeout } from 'timers/promises';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
const SERVER_STARTUP_DELAY = 7000; // 7 secondes (donne un peu plus de marge au serveur)

console.log('🚀 Démarrage du serveur de test...\n');

// Démarrer le serveur (exécuter le fichier build avec bun)
// Utiliser './build/index.js' pour invoquer directement le bundle Bun.
const server = spawn('bun', ['./build/index.js'], {
  stdio: 'inherit',
  detached: false
});

// Attendre que le serveur démarre
await setTimeout(SERVER_STARTUP_DELAY);

console.log(`\n✅ Serveur démarré sur ${API_BASE_URL}`);
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
