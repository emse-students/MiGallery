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
	console.log(`Test file server listening on http://localhost:${PORT}/large-test`);
});
