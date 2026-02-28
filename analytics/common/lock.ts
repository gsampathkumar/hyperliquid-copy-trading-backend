/**
 * File-based lock utility for single-instance script execution.
 *
 * Prevents multiple instances of the same script from running concurrently.
 * Uses PID files with stale lock detection.
 */

import * as fs from 'fs';
import * as path from 'path';

const LOCK_DIR = process.env.LOCK_DIR || '/tmp';

if (!fs.existsSync(LOCK_DIR)) {
  fs.mkdirSync(LOCK_DIR, { recursive: true });
}

export class ScriptLock {
  private lockFile: string;
  private acquired: boolean = false;

  constructor(scriptName: string) {
    this.lockFile = path.join(LOCK_DIR, `hyperliquid-${scriptName}.lock`);
  }

  acquire(): boolean {
    try {
      if (fs.existsSync(this.lockFile)) {
        const content = fs.readFileSync(this.lockFile, 'utf8');
        const pid = parseInt(content.trim(), 10);

        if (this.isProcessRunning(pid)) {
          return false;
        }

        fs.unlinkSync(this.lockFile);
      }

      fs.writeFileSync(this.lockFile, process.pid.toString(), { flag: 'wx' });
      this.acquired = true;
      this.registerCleanup();
      return true;
    } catch (error: any) {
      if (error.code === 'EEXIST') {
        return false;
      }
      console.error(`[Lock] Warning: Could not acquire lock: ${error.message}`);
      return true;
    }
  }

  release(): void {
    if (this.acquired) {
      try {
        fs.unlinkSync(this.lockFile);
      } catch {
        // Ignore errors during cleanup
      }
      this.acquired = false;
    }
  }

  private isProcessRunning(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private registerCleanup(): void {
    process.once('exit', () => this.release());
    process.once('SIGINT', () => {
      this.release();
      process.exit(128 + 2);
    });
    process.once('SIGTERM', () => {
      this.release();
      process.exit(128 + 15);
    });
    process.once('uncaughtException', (err) => {
      console.error('[Lock] Uncaught exception:', err);
      this.release();
      process.exit(1);
    });
  }
}
