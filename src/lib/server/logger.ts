/* eslint-disable no-console */
/**
 * Minimal structured logger for server code.
 *
 * Replaces the ad-hoc `console.*` calls scattered across handlers. Each logger
 * is bound to a scope (e.g. "auth", "immich-proxy") and emits a single line:
 *
 *   2026-07-13T10:00:00.000Z WARN [auth] cookie failed verification { id: '...' }
 *
 * Levels are gated by a numeric threshold resolved once at module load:
 *   - LOG_LEVEL env wins when set (debug|info|warn|error)
 *   - otherwise: test -> error only, production -> info+, dev -> debug+
 *
 * This is server-only (uses process.env). Never import it into client code.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function resolveThreshold(): number {
	const env = process.env.LOG_LEVEL?.toLowerCase();
	if (env && env in LEVELS) {
		return LEVELS[env as Level];
	}
	if (process.env.NODE_ENV === 'test') {
		return LEVELS.error;
	}
	if (process.env.NODE_ENV === 'production') {
		return LEVELS.info;
	}
	return LEVELS.debug;
}

const threshold = resolveThreshold();

function emit(level: Level, scope: string, message: string, fields?: unknown): void {
	if (LEVELS[level] < threshold) {
		return;
	}
	const line = `${new Date().toISOString()} ${level.toUpperCase()} [${scope}] ${message}`;
	const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
	if (fields === undefined) {
		sink(line);
	} else {
		sink(line, fields);
	}
}

export interface Logger {
	debug(message: string, fields?: unknown): void;
	info(message: string, fields?: unknown): void;
	warn(message: string, fields?: unknown): void;
	error(message: string, fields?: unknown): void;
}

/**
 * Create a scoped logger. The scope is printed as `[scope]` on every line.
 */
export function createLogger(scope: string): Logger {
	return {
		debug: (message, fields) => emit('debug', scope, message, fields),
		info: (message, fields) => emit('info', scope, message, fields),
		warn: (message, fields) => emit('warn', scope, message, fields),
		error: (message, fields) => emit('error', scope, message, fields)
	};
}
