#!/usr/bin/env node
/**
 * Générateur de AUTH_SECRET pour MiGallery
 * Cet outil génère une clé sécurisée pour AUTH_SECRET
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function generateAuthSecret() {
	return crypto.randomBytes(32).toString('hex');
}

function main() {
	console.log('\n🔐 Générateur de AUTH_SECRET pour MiGallery\n');

	const secret = generateAuthSecret();
	console.log('✅ Nouvelle clé AUTH_SECRET générée :');
	console.log(`   ${secret}\n`);

	const envPath = path.join(process.cwd(), '.env');

	if (fs.existsSync(envPath)) {
		const envContent = fs.readFileSync(envPath, 'utf8');

		if (envContent.includes('AUTH_SECRET=')) {
			// Remplacer la clé existante
			const updatedContent = envContent.replace(/AUTH_SECRET=.*/, `AUTH_SECRET=${secret}`);
			fs.writeFileSync(envPath, updatedContent, 'utf8');
			console.log('📝 Fichier .env mis à jour avec la nouvelle clé');
		} else {
			// Ajouter la clé
			const updatedContent = envContent + `\nAUTH_SECRET=${secret}\n`;
			fs.writeFileSync(envPath, updatedContent, 'utf8');
			console.log('➕ AUTH_SECRET ajouté au fichier .env');
		}
	} else {
		console.log('⚠️  Fichier .env non trouvé');
		console.log('   Veuillez ajouter cette ligne à votre .env :');
		console.log(`   AUTH_SECRET=${secret}\n`);
	}

	console.log('✨ Configuration terminée!\n');
}

main();
