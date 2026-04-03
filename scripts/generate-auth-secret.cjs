#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function generateAuthSecret() {
	return crypto.randomBytes(32).toString('hex');
}

function main() {
	console.log('\n🔐 Générateur de AUTH_SECRET pour MiGallery\n');

	const secret = generateAuthSecret();
	console.log('✅ Nouvelle clé AUTH_SECRET générée');

	const envPath = path.join(process.cwd(), '.env');

	try {
		const envContent = fs.readFileSync(envPath, 'utf8');
		const updatedContent = envContent.includes('AUTH_SECRET=')
			? envContent.replace(/AUTH_SECRET=.*/, `AUTH_SECRET=${secret}`)
			: envContent + `\nAUTH_SECRET=${secret}\n`;

		const tmpPath = `${envPath}.tmp`;
		fs.writeFileSync(tmpPath, updatedContent, 'utf8');
		fs.renameSync(tmpPath, envPath);
		console.log('📝 Fichier .env mis à jour avec la nouvelle clé');
	} catch (err) {
		if (err && err.code === 'ENOENT') {
		console.log('⚠️  Fichier .env non trouvé');
		console.log('   Veuillez ajouter cette ligne à votre .env :');
		console.log(`   AUTH_SECRET=${secret}\n`);
		} else {
			throw err;
		}
	}

	console.log('✨ Configuration terminée!\n');
}

main();
