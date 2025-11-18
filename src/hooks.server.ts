// Load .env at server startup (for production builds)
import { config } from 'dotenv';
config();

export { handle } from "$lib/auth";