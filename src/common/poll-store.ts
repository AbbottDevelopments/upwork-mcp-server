import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CONFIG_DIR = join(homedir(), '.upwork-mcp');
const POLL_FILE = join(CONFIG_DIR, 'poll-state.json');

/**
 * Snapshot persistence for poll_notifications.
 * Stores last-seen state for diffing. Implemented in Phase 4.
 */
export class PollStore {
  async load<T>(): Promise<T | null> {
    if (!existsSync(POLL_FILE)) return null;
    try {
      const raw = await readFile(POLL_FILE, 'utf-8');
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async save<T>(state: T): Promise<void> {
    // F8: No TOCTOU — mkdir recursive is a no-op if dir exists
    await mkdir(CONFIG_DIR, { recursive: true });
    await writeFile(POLL_FILE, JSON.stringify(state, null, 2), 'utf-8');
    // F14: Set restrictive permissions consistent with TokenStore
    try {
      await chmod(POLL_FILE, 0o600);
    } catch {
      // chmod may not work on Windows
    }
  }
}
