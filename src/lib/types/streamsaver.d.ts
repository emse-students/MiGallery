declare module 'streamsaver' {
	interface CreateWriteStreamOptions {
		size?: number;
		writableStrategy?: QueuingStrategy;
		readableStrategy?: QueuingStrategy;
		pathname?: string;
	}

	interface StreamSaver {
		mitm: string;
		WritableStream: typeof WritableStream;
		TransformStream?: typeof TransformStream;
		supported: boolean;
		createWriteStream(
			filename: string,
			options?: CreateWriteStreamOptions
		): WritableStream<Uint8Array>;
	}

	const streamSaver: StreamSaver;
	export default streamSaver;
}
