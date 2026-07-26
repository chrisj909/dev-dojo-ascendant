/**
 * Loads .env.local (then .env) before the integration suite runs, so
 * TEST_DATABASE_URL is picked up from the same file everything else uses.
 */
import { config } from 'dotenv';

config({ path: ['.env.local', '.env'], quiet: true });
