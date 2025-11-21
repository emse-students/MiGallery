#!/usr/bin/env node
/**
 * Script de packaging complet de l'application
 * - Compile le build
 * - Inclut la base de données
 * - Inclut le fichier .env
 * - Crée un package prêt à déployer
 */

import fs from 'fs';
import path from 'path';
import * as tar from 'tar';

const pkgPath = path.resolve(process.cwd(), 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const version = pkg.version || '0.0.0';
const name = pkg.name || 'package';

const outDir = path.resolve(process.cwd(), 'build', 'artifacts');
await fs.promises.mkdir(outDir, { recursive: true });

const filename = `${name.replace(/[^a-z0-9.-]/gi, '_')}-${version}-full.tgz`;
const outPath = path.join(outDir, filename);

console.log("📦 Création du package complet de l'application...");
console.log(`📍 Destination: ${outPath}`);
console.log('');

// Liste des fichiers/dossiers à inclure
const filesToInclude = [];

// 1. Build folder (obligatoire)
const buildDir = path.resolve(process.cwd(), 'build');
if (!fs.existsSync(buildDir)) {
	console.error('❌ Le dossier build/ n\'existe pas. Lancez d\'abord "npm run build".');
	process.exit(1);
}
console.log('✅ build/ trouvé');

// 2. Data folder (base de données)
const dataDir = path.resolve(process.cwd(), 'data');
if (fs.existsSync(dataDir)) {
	console.log('✅ data/ trouvé (base de données)');
} else {
	console.warn("⚠️  data/ non trouvé - le package n'inclura pas de base de données");
}

// 3. .env file
// NOTE: For safety we DO NOT include the local `.env` file by default in release packages.
// If you really want to include it, set the environment variable `PACK_INCLUDE_ENV=true`.
const envFile = path.resolve(process.cwd(), '.env');
const includeEnv = String(process.env.PACK_INCLUDE_ENV || '').toLowerCase() === 'true';
if (fs.existsSync(envFile) && includeEnv) {
	console.log('✅ .env trouvé et inclusion demandée via PACK_INCLUDE_ENV=true');
} else if (fs.existsSync(envFile) && !includeEnv) {
	console.warn(
		"⚠️  .env trouvé mais NON inclus dans le package (sécurité). Si vous voulez l'inclure, exportez PACK_INCLUDE_ENV=true avant d'exécuter le script."
	);
} else {
	console.warn("⚠️  .env non trouvé - le package n'inclura pas de configuration");
}

// 4. package.json (pour info sur la version)
console.log('✅ package.json');

// 5. README.md
const readmeFile = path.resolve(process.cwd(), 'README.md');
if (fs.existsSync(readmeFile)) {
	console.log('✅ README.md');
}

// 6. Scripts (pour utilisation sur la machine cible)
const scriptsDir = path.resolve(process.cwd(), 'scripts');
if (fs.existsSync(scriptsDir)) {
	console.log('✅ scripts/');
}

console.log('');
console.log("🔄 Création de l'archive...");

// Créer une archive tar.gz incluant tous les éléments
try {
	await tar.create(
		{
			gzip: true,
			file: outPath,
			cwd: process.cwd()
		},
		[
			'build',
			fs.existsSync(dataDir) ? 'data' : null,
			fs.existsSync(envFile) && includeEnv ? '.env' : null,
			'package.json',
			fs.existsSync(readmeFile) ? 'README.md' : null,
			fs.existsSync(scriptsDir) ? 'scripts' : null
		].filter(Boolean) // Enlever les null
	);

	const stats = fs.statSync(outPath);
	const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

	console.log('');
	console.log('✅ Package créé avec succès !');
	console.log(`📦 Fichier: ${filename}`);
	console.log(`📏 Taille: ${sizeMB} MB`);
	console.log(`📍 Emplacement: ${outPath}`);
	console.log('');
	console.log('💡 Pour déployer sur une autre machine:');
	console.log('   1. Copiez le fichier .tgz');
	console.log('   2. Extrayez: tar -xzf ' + filename);
	console.log('   3. Installez les dépendances: bun install --production');
	console.log('   4. Configurez .env si nécessaire');
	console.log('   5. Lancez: bun run build/index.js');
} catch (error) {
	console.error('❌ Erreur lors de la création du package:', error.message);
	process.exit(1);
}
