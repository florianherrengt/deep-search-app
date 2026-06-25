import { loadStore, type StoreOptions } from "@/lib/tauri-bridge";
import { z } from "zod";

type StoreApi<T extends z.ZodObject<any>> = {
  get: () => Promise<z.infer<T>>;
  set: (key: keyof z.infer<T>, value: z.infer<T>[keyof z.infer<T>]) => Promise<void>;
  reset: () => Promise<void>;
};

function createStoreOptions<T extends z.ZodObject<any>>(
  defaults: z.infer<T>,
): StoreOptions {
  return {
    autoSave: false,
    defaults: defaults as Record<string, unknown>,
  };
}

export function createStore<T extends z.ZodObject<any>>(
  filename: string,
  schema: T,
  defaults: z.infer<T>,
): StoreApi<T> {
  const shape = schema.shape;
  const keys = Object.keys(shape) as (keyof z.infer<T>)[];
  const storeOptions = createStoreOptions<T>(defaults);

  function loadStoreInstance() {
    return loadStore(filename, storeOptions);
  }

  async function get(): Promise<z.infer<T>> {
    const store = await loadStoreInstance();
    // Single IPC round-trip that returns every key/value pair, instead of
    // one get() per key. For the 27-key settings schema this collapses
    // 28 sequential IPC round-trips (load + 27 gets) into 2 (load + entries).
    const all = await store.entries();
    const valueMap: Record<string, unknown> = {};
    for (const [key, raw] of all) valueMap[key] = raw;

    const result = { ...defaults };
    for (const key of keys) {
      const raw = valueMap[key as string];
      if (raw === null || raw === undefined) continue;
      try {
        const fieldSchema = shape[key as string];
        result[key] = fieldSchema.parse(raw);
      } catch {
        result[key] = defaults[key];
      }
    }

    return result;
  }

  async function set(
    key: keyof z.infer<T>,
    value: z.infer<T>[keyof z.infer<T>],
  ): Promise<void> {
    const fieldSchema = shape[key as string];
    fieldSchema.parse(value);

    const store = await loadStoreInstance();
    await store.set(key as string, value);
    await store.save();
  }

  async function reset(): Promise<void> {
    const store = await loadStoreInstance();
    // clear() is a single IPC round-trip; then we write the defaults back
    // and save once. Avoids one delete()/set() round-trip per key.
    await store.clear();
    for (const key of keys) {
      await store.set(key as string, defaults[key]);
    }
    await store.save();
  }

  return { get, set, reset };
}
