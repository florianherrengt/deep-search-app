# Store Utility Design

## Problem

`load("settings.json", { autoSave: false } as any)` is repeated throughout `use-settings.ts` with no validation of stored data. The `as any` cast and manual key iteration is fragile.

## Solution

A generic, Zod-validated store utility with a pre-configured settings instance.

## Files

### `src/lib/store.ts` — Generic factory

`createStore<T>(filename, schema, defaults)` returns three functions:

- `get()` — loads all keys from the Tauri store, validates against the Zod schema, falls back to defaults for missing keys
- `set(key, value)` — validates the full state after setting, then saves
- `reset()` — resets to defaults, validates, saves

Every read and write goes through Zod `schema.parse()`. On validation failure, falls back to defaults for that key.

No classes — closures over the config. The Tauri store instance is loaded fresh per call (matching current behavior).

### `src/lib/settings-store.ts` — Settings instance

Exports `settingsSchema` (Zod object), `settingsDefaults`, and `settingsStore` (result of `createStore`).

Consumers call `settingsStore.get()`, `settingsStore.set(key, value)`, `settingsStore.reset()`.

## Constraints

- Purely additive — no existing files change
- Functional style (no classes)
- Zod validation on every get and set
- Graceful fallback to defaults on validation failure
