import http from 'http';
import fs from 'fs';
import path from 'path';

const FILE_PATH = path.normalize(
	'J:/Drive partagés/Photothèque/2024-2025/Clips/Film Gala 2025.mp4'
);
const PORT = process.env.PORT || 4000;

const server = http.createServer((req, res) => {
	if (req.url !== '/large-test') {
		res.writeHead(404);
		res.end('Not found');
		return;
	}

	fs.stat(FILE_PATH, (err, stat) => {
		if (err) {
			console.error('File stat error', err);
			res.writeHead(404);
			res.end('File not found');
			return;
		}

		const range = req.headers.range;
		if (range) {
			const match = /bytes=(\d*)-(\d*)/.exec(range);
			let start = 0;
			let end = stat.size - 1;
			if (match) {
				if (match[1]) start = parseInt(match[1], 10);
				if (match[2]) end = parseInt(match[2], 10);
			}
			if (isNaN(start) || isNaN(end) || start > end || start < 0) {
				res.writeHead(416);
				res.end('Range Not Satisfiable');
				return;
			}
			const chunkSize = end - start + 1;
			res.writeHead(206, {
				'Content-Range': `bytes ${start}-${end}/${stat.size}`,
				'Accept-Ranges': 'bytes',
				'Content-Length': String(chunkSize),
				'Content-Type': 'video/mp4',
				'Content-Disposition': 'attachment; filename="Film Gala 2025.mp4"'
			});
			const stream = fs.createReadStream(FILE_PATH, { start, end });
			stream.pipe(res);
			stream.on('error', (err) => {
				console.error('Stream error', err);
				try {
					res.destroy();
				} catch (e) {}
			});
			return;
		}

		// No range header — send whole file
		res.writeHead(200, {
			'Content-Type': 'video/mp4',
			'Content-Length': String(stat.size),
			'Content-Disposition': 'attachment; filename="Film Gala 2025.mp4"'
		});

		const stream = fs.createReadStream(FILE_PATH);
		stream.pipe(res);
		stream.on('error', (err) => {
			console.error('Stream error', err);
			try {
				res.destroy();
			} catch (e) {}
		});
	});
});

server.listen(PORT, () => {
	console.log(`Range-aware test file server listening on http://localhost:${PORT}/large-test`);
});
