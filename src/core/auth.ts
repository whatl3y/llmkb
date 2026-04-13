import type { AuthUser } from '../types/index.js';
import type { StorageBackend } from './storage/types.js';

/**
 * Manages the whitelist of authorized users.
 * Delegates to the active StorageBackend (filesystem JSON or Postgres).
 */
export class UserStore {
  constructor(private storage: StorageBackend) {}

  async getUsers(): Promise<AuthUser[]> {
    return this.storage.getUsers();
  }

  async findByEmail(email: string): Promise<AuthUser | null> {
    return this.storage.findUserByEmail(email);
  }

  async addUser(email: string, name?: string): Promise<AuthUser> {
    return this.storage.addUser(email, name ?? '');
  }

  async removeUser(email: string): Promise<boolean> {
    return this.storage.removeUser(email);
  }
}
