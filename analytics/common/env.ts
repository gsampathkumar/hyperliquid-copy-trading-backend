/**
 * Centralized environment loader for analytics
 *
 * Loads from the root .env file (shared with api/)
 * All analytics files should import this instead of calling dotenv.config() directly
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load from root .env (hyperliquid-copy-trading-backend/.env)
// This is shared with api/ for unified configuration
const rootEnvPath = path.resolve(__dirname, '../../.env');
dotenv.config({ path: rootEnvPath });

export { rootEnvPath };
