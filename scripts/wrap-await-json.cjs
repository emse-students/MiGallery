const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function walk(dir) {
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (['.git', 'node_modules', 'build', 'dist', '.svelte-kit'].includes(entry.name)) continue;
			walk(full);
		} else if (/\.(ts|js|svelte|tsx|jsx)$/.test(entry.name)) {
			transformFile(full);
		}
	}
}

function transformFile(file) {
	let src = fs.readFileSync(file, 'utf8');
	const original = src;

	src = src.replace(/await\s+([^\n;]+?)\.json\(\)/g, '(await $1.json()) as unknown');

	if (src !== original) {
		fs.writeFileSync(file, src, 'utf8');
		console.log('Patched', file);
	}
}

walk(path.join(root, 'src'));
console.log('Done');
