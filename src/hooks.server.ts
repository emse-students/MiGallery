// Load .env at server startup (for production builds)
// IMPORTANT: This must run BEFORE importing auth.ts
import { config } from 'dotenv';
config({ override: true }); // Override existing vars to ensure .env takes precedence

export { handle } from "$lib/auth";