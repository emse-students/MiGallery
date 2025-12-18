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
		} else if (/\.(ts|js)$/.test(entry.name)) {
			transformFile(full);
		}
	}
}

function transformFile(file) {
	let src = fs.readFileSync(file, 'utf8');
	const original = src;

	src = src.replace(/console\.log\(/g, 'console.warn(');

	src = src.replace(/catch\s*\(\s*(err|e|error)\s*:\s*unknown\s*\)\s*\{/g, (m, varName) => {

		const insert = `catch (${varName}: unknown) {\n\tconst _err = ensureError(${varName});`;
		return insert;
	});

	if (src.includes('ensureError(') && !/ensureError/.test(original)) {

		if (/import\s+.*from\s+['"][^'"]+['"];?\s*/.test(src)) {
			src = src.replace(
				/(import[\s\S]*?from\s+['"][^'"]+['"];?\s*)/m,
				`$1\nimport { ensureError } from '$lib/ts-utils';\n`
			);
		} else {
			src = "import { ensureError } from '$lib/ts-utils';\n" + src;
		}
	}

	if (src !== original) {
		fs.writeFileSync(file, src, 'utf8');
		console.log('Patched', file);
	}
}

walk(path.join(root, 'src'));
console.log('Done');
