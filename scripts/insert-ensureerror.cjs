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

	// replace console.log with console.warn
	src = src.replace(/console\.log\(/g, 'console.warn(');

	// process catch blocks for err, e, error
	// We'll insert: const _err = ensureError(err);
	src = src.replace(/catch\s*\(\s*(err|e|error)\s*:\s*unknown\s*\)\s*\{/g, (m, varName) => {
		// check if ensureError already present nearby
		const insert = `catch (${varName}: unknown) {\n\tconst _err = ensureError(${varName});`;
		return insert;
	});

	// add import if ensureError used and import not present
	if (src.includes('ensureError(') && !/ensureError/.test(original)) {
		// add import after first import block or at top
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
