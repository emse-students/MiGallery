#!/usr/bin/env node
// Supprime les fichiers .part et .complete plus vieux que X heures dans le tmpdir
import fs from 'fs';
import path from 'path';
import os from 'os';

const MAX_AGE_HOURS = Number(process.env.CHUNKED_TEMP_MAX_HOURS || '24');
const now = Date.now();

const dirsToClean = [
	os.tmpdir(),
	path.join(process.cwd(), 'data', 'chunk-uploads')
];

dirsToClean.forEach(tmp => {
	if (!fs.existsSync(tmp)) return;
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
});
