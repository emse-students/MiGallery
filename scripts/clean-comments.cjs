#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function cleanFile(filePath) {
	try {
		let content = fs.readFileSync(filePath, 'utf8');
		const originalContent = content;
		let modified = false;

		const lines = content.split('\n');
		const cleaned = [];

		for (const line of lines) {
			const commentIdx = line.indexOf('//');
			if (commentIdx === -1) {
				cleaned.push(line);
				continue;
			}

			const beforeComment = line.substring(0, commentIdx);
			const comment = line.substring(commentIdx + 2);

			if (!beforeComment.trim()) {
				const trimmed = beforeComment.trimStart();
				if (trimmed.length > 0) {
					cleaned.push(trimmed);
				}
				modified = true;
				continue;
			}

			const isFrenchComment =
				/[àâäæéèêëïîôöœùûüœçÀÂÄÆÉÈÊËÏÎÔÖŒÙÛÜŒÇ]|Vérif|Récupér|Charger|Drag|Détecter|Appui|Mode|Zoom|Affichage|Modif|Édition|Suppressi|Télécharg|Favoris|Sélect|Traitement|Format|Photo|Vidéo|Cache|Nettoyage|Immich|Proxy|Auth|Authentif|Permiss|Admin|Rôle|Utilisateur|Creat|Album|Asset|Database|Modal|Portal|Session|Cookie|Token|Erreur|Succès|Fallback|Défaut|Autom|Sécurité|Visible|Afficher|Masquer|Montrer|Cacher|Copie|Clone|Lien/.test(
					comment
				);

			if (!isFrenchComment) {
				cleaned.push(line);
			} else {
				cleaned.push(beforeComment);
				modified = true;
			}
		}

		const result = cleaned.join('\n').replace(/\n\s*\n\s*\n/g, '\n\n');

		if (modified && result !== originalContent) {
			fs.writeFileSync(filePath, result, 'utf8');
			return true;
		}
		return false;
	} catch (e) {
		console.error(`Error processing ${filePath}: ${String(e)}`);
		return false;
	}
}

function walkDir(dir, ext, callback) {
	try {
		const files = fs.readdirSync(dir);
		for (const file of files) {
			const filePath = path.join(dir, file);
			const stat = fs.statSync(filePath);
			if (stat.isDirectory()) {
				if (!file.startsWith('.') && file !== 'node_modules' && file !== 'build') {
					walkDir(filePath, ext, callback);
				}
			} else if (file.endsWith(ext)) {
				callback(filePath);
			}
		}
	} catch (e) {
		/* ignore */
	}
}

function main() {
	const root = path.resolve(__dirname, '..');
	const extensions = ['.ts', '.tsx', '.js', '.cjs', '.svelte'];
	let cleaned = 0;

	console.log('🧹 Cleaning French comments...\n');

	for (const ext of extensions) {
		walkDir(path.join(root, 'src'), ext, (filePath) => {
			if (cleanFile(filePath)) {
				cleaned++;
				console.log(`✅ ${filePath.replace(root, '')}`);
			}
		});
	}

	console.log(`\n✨ Cleaned ${cleaned} files`);
}

main();
