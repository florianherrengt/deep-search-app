import { load } from "@tauri-apps/plugin-store";
import { z } from "zod";

type StoreApi<T extends z.ZodObject<any>> = {
  get: () => Promise<z.infer<T>>;
  set: (key: keyof z.infer<T>, value: z.infer<T>[keyof z.infer<T>]) => Promise<void>;
  reset: () => Promise<void>;
};

export async function createStore<T extends z.ZodObject<any>>(
  filename: string,
  schema: T,
  defaults: z.infer<T>,
): Promise<StoreApi<T>> {
  const shape = schema.shape;
  const keys = Object.keys(shape) as (keyof z.infer<T>)[];

  async function get(): Promise<z.infer<T>> {
    const store = await load(filename, { autoSave: false } as any);
    const result = { ...defaults };

    for (const key of keys) {
      const raw = await store.get<z.infer<T>[typeof key]>(key as string);
      if (raw !== null && raw !== undefined) {
        try {
          const fieldSchema = shape[key as string];
          result[key] = fieldSchema.parse(raw);
        } catch {
          result[key] = defaults[key];
        }
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

    const store = await load(filename, { autoSave: false } as any);
    await store.set(key as string, value);
    await store.save();
  }

  async function reset(): Promise<void> {
    const store = await load(filename, { autoSave: false } as any);
    for (const key of keys) {
      await store.set(key as string, defaults[key]);
    }
    await store.save();
  }

  return { get, set, reset };
}
