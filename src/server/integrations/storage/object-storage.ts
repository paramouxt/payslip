import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';

/**
 * Object storage port. Raw email MIME and payslip documents live here,
 * immutably, in a PRIVATE bucket; reads are via short-lived signed URLs only
 * (§7). Supabase in production; local filesystem in dev; memory in tests.
 */
export interface ObjectStorage {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string | null>;
}

export function createSupabaseStorage(
  url: string,
  serviceRoleKey: string,
  bucket: string
): ObjectStorage {
  const client = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  return {
    async put(key, data, contentType) {
      const { error } = await client.storage.from(bucket).upload(key, data, {
        contentType,
        upsert: false, // immutability: a second write to the same key fails
      });
      if (error && !error.message.includes('already exists')) {
        throw new Error(`storage put failed: ${error.message}`);
      }
    },
    async get(key) {
      const { data, error } = await client.storage.from(bucket).download(key);
      if (error) return null;
      return Buffer.from(await data.arrayBuffer());
    },
    async getSignedUrl(key, expiresInSeconds = 300) {
      const { data, error } = await client.storage
        .from(bucket)
        .createSignedUrl(key, expiresInSeconds);
      return error ? null : data.signedUrl;
    },
  };
}

export function createLocalStorage(rootDir: string): ObjectStorage {
  function pathFor(key: string): string {
    const safe = normalize(key).replace(/^(\.\.[/\\])+/, '');
    return join(rootDir, safe);
  }
  return {
    async put(key, data) {
      const path = pathFor(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, data, { flag: 'wx' }).catch((e: unknown) => {
        // Immutable: existing keys are final; anything else propagates.
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      });
    },
    async get(key) {
      try {
        return await readFile(pathFor(key));
      } catch {
        return null;
      }
    },
    getSignedUrl() {
      return Promise.resolve(null); // no URL surface for local dev storage
    },
  };
}

export function createMemoryStorage(): ObjectStorage & { keys(): string[] } {
  const store = new Map<string, Buffer>();
  return {
    put(key, data) {
      if (!store.has(key)) store.set(key, data);
      return Promise.resolve();
    },
    get(key) {
      return Promise.resolve(store.get(key) ?? null);
    },
    getSignedUrl() {
      return Promise.resolve(null);
    },
    keys() {
      return [...store.keys()];
    },
  };
}

export function createObjectStorageFromEnv(): ObjectStorage {
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    return createSupabaseStorage(
      env.SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY,
      env.SUPABASE_STORAGE_BUCKET
    );
  }
  return createLocalStorage(env.LOCAL_STORAGE_DIR);
}
