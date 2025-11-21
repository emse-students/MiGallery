import { ensureError } from '$lib/ts-utils';
/**
 * Helper pour consommer un stream NDJSON (Newline Delimited JSON)
 * et appeler un callback pour chaque ligne parsée
 */
export async function consumeNDJSONStream<T>(
	response: Response,
	onItem: (item: T) => void,
	onError?: (error: Error) => void
): Promise<void> {
	if (!response.ok || !response.body) {
		throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n');
			buffer = lines.pop() || '';

			for (const line of lines) {
				if (line.trim()) {
					try {
						const item = JSON.parse(line) as T;
						onItem(item);
					} catch (e: unknown) {
						const _err = ensureError(e);
						console.warn('Error parsing NDJSON line:', e);
						if (onError) {
							onError(e as Error);
						}
					}
				}
			}
		}
	} catch (e: unknown) {
		const _err = ensureError(e);
		console.error('Error reading stream:', e);
		if (onError) {
			onError(e as Error);
		}
		throw e;
	}
}
