#!/usr/bin/env node

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

const filesToInclude = [];

const buildDir = path.resolve(process.cwd(), 'build');
if (!fs.existsSync(buildDir)) {
	console.error('❌ Le dossier build/ n\'existe pas. Lancez d\'abord "npm run build".');
	process.exit(1);
}
console.log('✅ build/ trouvé');

const dataDir = path.resolve(process.cwd(), 'data');
if (fs.existsSync(dataDir)) {
	console.log('✅ data/ trouvé (base de données)');
} else {
	console.warn("⚠️  data/ non trouvé - le package n'inclura pas de base de données");
}

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

console.log('✅ package.json');

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

try {
	await tar.create(
		{
			gzip: true,
			file: outPath,
			cwd: process.cwd(),
			filter: (p) => {
				// Normaliser le chemin pour la comparaison
				const normalizedPath = p.replace(/\\/g, '/').replace(/^\.\//, '');

				// Exclure les dossiers de données temporaires ou volumineux
				const excludes = [
					'build/artifacts',
					'data/cache',
					'data/chunk-uploads',
					'data/mock-uploads',
					'data/immich-file-cache',
					'data/backups'
				];

				if (excludes.some((ex) => normalizedPath === ex || normalizedPath.startsWith(ex + '/'))) {
					return false;
				}

				// Exclure les fichiers de base de données temporaires (WAL, SHM)
				if (normalizedPath.endsWith('-wal') || normalizedPath.endsWith('-shm')) {
					return false;
				}

				return true;
			}
		},
		[
			'build',
			fs.existsSync(dataDir) ? 'data' : null,
			fs.existsSync(envFile) && includeEnv ? '.env' : null,
			'package.json',
			fs.existsSync(readmeFile) ? 'README.md' : null,
			fs.existsSync(scriptsDir) ? 'scripts' : null
		].filter(Boolean)
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
