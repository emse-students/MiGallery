/**
 * Helper to consume an NDJSON (Newline Delimited JSON) stream
 * and call a callback for each parsed line.
 * `onChunk` runs once per network chunk, after its lines: publish reactive
 * state there, not in `onItem`, or a 500-line album re-renders 500 times.
 */
export async function consumeNDJSONStream<T>(
  response: Response,
  onItem: (item: T) => void,
  onError?: (error: Error) => void,
  onChunk?: () => void
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
            console.warn('Error parsing NDJSON line:', e);
            if (onError) {
              onError(e as Error);
            }
          }
        }
      }
      onChunk?.();
    }
  } catch (e: unknown) {
    console.error('Error reading stream:', e);
    if (onError) {
      onError(e as Error);
    }
    throw e;
  }
}
