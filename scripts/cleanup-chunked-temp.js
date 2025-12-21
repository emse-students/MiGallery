#!/usr/bin/env node
// Supprime les fichiers .part et .complete plus vieux que X heures dans le tmpdir
const fs = require('fs');
const path = require('path');
const os = require('os');

const MAX_AGE_HOURS = Number(process.env.CHUNKED_TEMP_MAX_HOURS || '24');
const now = Date.now();
const tmp = os.tmpdir();

console.log(`Cleaning chunked temp files in ${tmp}, older than ${MAX_AGE_HOURS}h`);

fs.readdirSync(tmp).forEach((f) => {
	if (!f.startsWith('immich_proxy_')) return;
	const full = path.join(tmp, f);
	try {
		const st = fs.statSync(full);
		const ageH = (now - st.mtimeMs) / (1000 * 60 * 60);
		if (ageH > MAX_AGE_HOURS) {
			try {
				fs.unlinkSync(full);
				console.log('Removed', full);
			} catch (e) {
				console.warn('Failed to remove', full, e);
			}
		}
	} catch (e) {
		/* ignore */
	}
});
