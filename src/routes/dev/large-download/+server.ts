import fs from 'fs';
import { Readable } from 'stream';
import path from 'path';

export const GET = async ({ request }) => {
	// Chemin local du fichier fourni par l'utilisateur
	const filePath = path.normalize(
		'J:/Drive partagés/Photothèque/2024-2025/Clips/Film Gala 2025.mp4'
	);

	try {
		const stat = await fs.promises.stat(filePath);

		const rangeHeader = request.headers.get('range');
		if (rangeHeader) {
			// support single range like: bytes=START-END
			const m = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
			let start = 0;
			let end = stat.size - 1;
			if (m) {
				if (m[1]) {
					start = parseInt(m[1], 10);
				}
				if (m[2]) {
					end = parseInt(m[2], 10);
				}
			}

			if (isNaN(start) || isNaN(end) || start > end || start < 0) {
				return new Response('Range Not Satisfiable', { status: 416 });
			}

			const chunkSize = end - start + 1;
			const fileStream = fs.createReadStream(filePath, { start, end });
			const webStream = Readable.toWeb(fileStream);

			return new Response(webStream, {
				status: 206,
				headers: {
					'Content-Type': 'video/mp4',
					'Content-Length': String(chunkSize),
					'Content-Range': `bytes ${start}-${end}/${stat.size}`,
					'Accept-Ranges': 'bytes',
					'Content-Disposition': 'attachment; filename="Film Gala 2025.mp4"'
				}
			});
		}

		// no range — send whole file
		const fileStream = fs.createReadStream(filePath);
		const webStream = Readable.toWeb(fileStream);

		return new Response(webStream, {
			status: 200,
			headers: {
				'Content-Type': 'video/mp4',
				'Content-Length': String(stat.size),
				'Content-Disposition': 'attachment; filename="Film Gala 2025.mp4"'
			}
		});
	} catch (err) {
		console.error('[dev/large-download] error serving file', err);
		return new Response('File not found or inaccessible', { status: 404 });
	}
};
