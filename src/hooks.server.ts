// Load .env at server startup (for production builds)
// IMPORTANT: This must run BEFORE importing auth.ts
import { config } from 'dotenv';
config({ override: true }); // Override existing vars to ensure .env takes precedence

import { sequence } from '@sveltejs/kit/hooks';
import type { Handle } from '@sveltejs/kit';
import { handle as authHandle } from '$lib/auth';

// CORS handler for all requests
const corsHandler: Handle = async ({ event, resolve }) => {
	// Handle preflight requests
	if (event.request.method === 'OPTIONS') {
		return new Response(null, {
			headers: {
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
				'Access-Control-Allow-Headers': 'Content-Type, x-api-key, X-API-KEY, Authorization',
				'Access-Control-Max-Age': '86400'
			}
		});
	}

	const response = await resolve(event);

	// Add CORS headers to all responses
	response.headers.set('Access-Control-Allow-Origin', '*');
	response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
	response.headers.set(
		'Access-Control-Allow-Headers',
		'Content-Type, x-api-key, X-API-KEY, Authorization'
	);

	return response;
};

export const handle = sequence(corsHandler, authHandle);
