export function asArray<T>(v: unknown): T[] {
	return Array.isArray(v) ? (v as T[]) : [];
}

export function asRecord<T extends Record<string, unknown>>(v: unknown): T | null {
	return v && typeof v === 'object' && !Array.isArray(v) ? (v as T) : null;
}

export function asNumber(v: unknown): number | null {
	if (typeof v === 'number') {
		return v;
	}
	if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) {
		return Number(v);
	}
	return null;
}

export function ensureError(e: unknown): Error {
	if (e instanceof Error) {
		return e;
	}
	try {
		return new Error(JSON.stringify(e));
	} catch (_) {
		void _;
		return new Error(String(e));
	}
}

export function asString(v: unknown): string | null {
	return typeof v === 'string' ? v : null;
}

export function isRecord(v: unknown): v is Record<string, unknown> {
	return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function hasProperty<K extends string>(obj: unknown, key: K): obj is Record<K, unknown> {
	return isRecord(obj) && key in obj;
}

// Helper pour typer les réponses API
export function asApiResponse<T = unknown>(
	v: unknown
): {
	success?: boolean;
	data?: T;
	error?: string;
	message?: string;
} {
	if (!isRecord(v)) {
		return {};
	}
	return {
		success: hasProperty(v, 'success') && typeof v.success === 'boolean' ? v.success : undefined,
		data: hasProperty(v, 'data') ? (v.data as T) : undefined,
		error: hasProperty(v, 'error') && typeof v.error === 'string' ? v.error : undefined,
		message: hasProperty(v, 'message') && typeof v.message === 'string' ? v.message : undefined
	};
}
