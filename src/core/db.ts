import Database from 'better-sqlite3';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
export class Store {
  readonly sql: Database.Database;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.sql = new Database(path);
    this.sql.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY)');
    for (const name of readdirSync(resolve('migrations')).filter(x => x.endsWith('.sql')).sort()) {
      if (!this.get('SELECT name FROM migrations WHERE name=?', name)) this.tx(() => {
        this.sql.exec(readFileSync(resolve('migrations', name), 'utf8'));
        this.run('INSERT INTO migrations VALUES (?)', name);
      });
    }
  }
  get<T = Record<string, any>>(q: string, ...p: any[]): T | undefined { return this.sql.prepare(q).get(...p) as T | undefined; }
  all<T = Record<string, any>>(q: string, ...p: any[]): T[] { return this.sql.prepare(q).all(...p) as T[]; }
  run(q: string, ...p: any[]) { return this.sql.prepare(q).run(...p); }
  tx<T>(fn: () => T): T { this.sql.exec('BEGIN IMMEDIATE'); try { const r = fn(); this.sql.exec('COMMIT'); return r; } catch(e) { this.sql.exec('ROLLBACK'); throw e; } }
  value<T>(key: string, fallback: T): T { const r = this.get('SELECT value FROM settings WHERE key=?', key); return r ? JSON.parse(r.value) : fallback; }
  set(key: string, value: unknown) { this.run('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, JSON.stringify(value)); }
  id(key: string) { return this.get('SELECT id FROM resources WHERE key=?', key)?.id as string | undefined; }
  bind(key: string, id: string) { this.run('INSERT INTO resources(key,id) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET id=excluded.id,operation=NULL', key, id); }
  audit(entity: string, actor: string, action: string, data: unknown = {}) { this.run('INSERT INTO history(entity,actor,action,created,data) VALUES (?,?,?,?,?)', entity, actor, action, Date.now(), JSON.stringify(data)); }
  enqueue(kind: string, data: unknown) { this.run('INSERT INTO outbox(kind,data,created) VALUES (?,?,?)', kind, JSON.stringify(data), Date.now()); }
  close() { this.sql.close(); }
}
export class UserError extends Error {}
export function requireValue<T>(value: T, message: string): NonNullable<T> { if (value == null) throw new UserError(message); return value as NonNullable<T>; }
export class Serial {
  private tails = new Map<string, Promise<unknown>>();
  async run<T>(key: string, action: () => Promise<T>): Promise<T> {
    const before = this.tails.get(key) ?? Promise.resolve();
    const next = before.catch(() => {}).then(action); this.tails.set(key, next);
    try { return await next; } finally { if (this.tails.get(key) === next) this.tails.delete(key); }
  }
}
