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

	src = src.replace(/:\s*any(\b|\s|;|>)/g, ': unknown$1');
	// 2) any[] -> unknown[]
	src = src.replace(/\bany\s*\[\s*\]/g, 'unknown[]');
	// 3) as any -> as unknown
	src = src.replace(/as\s+any\b/g, 'as unknown');

	src = src.replace(/\(\s*([a-zA-Z0-9_\$]+)\s*:\s*any(\s*\))/g, '($1: unknown$2)');
	// 5) generic usages <any> -> <unknown>
	src = src.replace(/<any>/g, '<unknown>');

	if (src !== original) {
		fs.writeFileSync(file, src, 'utf8');
		console.log('Patched', file);
	}
}

walk(path.join(root, 'src'));
console.log('Done');
