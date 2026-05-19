# Settings Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a settings modal accessible via Cmd+, with all API keys, default model input, and a reset button, plus a minimal app menu.

**Architecture:** React context (`SettingsProvider`) wraps the app, backed by the existing `tauri-plugin-store`. A Radix Dialog (shadcn `dialog`) provides the UI. Tauri's built-in menu API registers Preferences... with `CmdOrCtrl+,`.

**Tech Stack:** Tauri v2 menu API, `@tauri-apps/plugin-store` (existing), shadcn `dialog` + `input` + `label` components, React context.

---

### Task 1: Add shadcn dialog, input, and label components

**Files:**
- Create: `src/components/ui/dialog.tsx`
- Create: `src/components/ui/input.tsx`
- Create: `src/components/ui/label.tsx`

- [ ] **Step 1: Install shadcn components**

Run:
```bash
npx shadcn@latest add dialog input label
```

This generates the three UI component files using the project's existing `components.json` config (new-york style, radix-ui, tailwind).

- [ ] **Step 2: Verify files exist**

Run: `ls src/components/ui/dialog.tsx src/components/ui/input.tsx src/components/ui/label.tsx`
Expected: all three files listed

---

### Task 2: Create the `useSettings` hook and `SettingsProvider`

**Files:**
- Create: `src/hooks/use-settings.ts`

This hook manages all settings in a single Tauri store (`settings.json`) and exposes them via React context.

- [ ] **Step 1: Create the settings hook with context**

```ts
import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { load } from "@tauri-apps/plugin-store";

export interface Settings {
  openrouter_api_key: string;
  searxng_url: string;
  brave_api_key: string;
  exa_api_key: string;
  serper_api_key: string;
  tavily_api_key: string;
  default_model: string;
}

const DEFAULTS: Settings = {
  openrouter_api_key: "",
  searxng_url: "",
  brave_api_key: "",
  exa_api_key: "",
  serper_api_key: "",
  tavily_api_key: "",
  default_model: "openrouter/free",
};

interface SettingsContextValue {
  settings: Settings;
  loading: boolean;
  updateSetting: (key: keyof Settings, value: string) => Promise<void>;
  resetAll: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const store = await load("settings.json", { autoSave: false } as any);
        const loaded = { ...DEFAULTS };
        for (const key of Object.keys(DEFAULTS) as (keyof Settings)[]) {
          const val = await store.get<string>(key);
          if (val !== null && val !== undefined) {
            loaded[key] = val;
          }
        }
        setSettings(loaded);
      } catch {
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const updateSetting = useCallback(async (key: keyof Settings, value: string) => {
    const store = await load("settings.json", { autoSave: false } as any);
    await store.set(key, value);
    await store.save();
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  const resetAll = useCallback(async () => {
    const store = await load("settings.json", { autoSave: false } as any);
    for (const key of Object.keys(DEFAULTS) as (keyof Settings)[]) {
      await store.set(key, DEFAULTS[key]);
    }
    await store.save();
    setSettings(DEFAULTS);
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, loading, updateSetting, resetAll }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors related to `use-settings.ts`

---

### Task 3: Create the `SettingsDialog` component

**Files:**
- Create: `src/components/settings-dialog.tsx`

- [ ] **Step 1: Create the settings dialog component**

```tsx
import { useState, type FormEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useSettings, type Settings } from "@/hooks/use-settings";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface FieldConfig {
  key: keyof Settings;
  label: string;
  type: "text" | "password";
  placeholder: string;
}

const FIELDS: FieldConfig[] = [
  { key: "openrouter_api_key", label: "OpenRouter API Key", type: "password", placeholder: "sk-or-..." },
  { key: "searxng_url", label: "SearXNG URL", type: "text", placeholder: "http://localhost:8080" },
  { key: "brave_api_key", label: "Brave Search API Key", type: "password", placeholder: "BSA-..." },
  { key: "exa_api_key", label: "Exa API Key", type: "password", placeholder: "exa-..." },
  { key: "serper_api_key", label: "Serper API Key", type: "password", placeholder: "serper-..." },
  { key: "tavily_api_key", label: "Tavily API Key", type: "password", placeholder: "tvly-..." },
];

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { settings, updateSetting, resetAll } = useSettings();
  const [confirmReset, setConfirmReset] = useState(false);

  function handleBlur(key: keyof Settings, value: string) {
    if (value !== settings[key]) {
      updateSetting(key, value);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent, key: keyof Settings, value: string) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleBlur(key, value);
    }
  }

  async function handleReset() {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    await resetAll();
    setConfirmReset(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Configure API keys and preferences. Changes are saved automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="default_model">Default Model (OpenRouter)</Label>
            <Input
              id="default_model"
              type="text"
              placeholder="openrouter/free"
              defaultValue={settings.default_model}
              onBlur={(e: FormEvent<HTMLInputElement>) => handleBlur("default_model", e.currentTarget.value)}
              onKeyDown={(e: React.KeyboardEvent) => handleKeyDown(e, "default_model", (e.target as HTMLInputElement).value)}
            />
          </div>

          <div className="space-y-1">
            <p className="text-sm font-medium">API Keys & Services</p>
          </div>

          {FIELDS.map((field) => (
            <div key={field.key} className="space-y-2">
              <Label htmlFor={field.key}>{field.label}</Label>
              <Input
                id={field.key}
                type={field.type}
                placeholder={field.placeholder}
                defaultValue={settings[field.key]}
                onBlur={(e: FormEvent<HTMLInputElement>) => handleBlur(field.key, e.currentTarget.value)}
                onKeyDown={(e: React.KeyboardEvent) => handleKeyDown(e, field.key, (e.target as HTMLInputElement).value)}
              />
            </div>
          ))}
        </div>

        <DialogFooter className="flex-row items-center justify-between gap-2 border-t pt-4">
          <div>
            {confirmReset ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-destructive">Are you sure?</span>
                <Button variant="destructive" size="sm" onClick={handleReset}>
                  Confirm Reset
                </Button>
                <Button variant="outline" size="sm" onClick={() => setConfirmReset(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button variant="destructive" size="sm" onClick={handleReset}>
                Reset All Settings
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors related to `settings-dialog.tsx`

---

### Task 4: Create the menu setup utility

**Files:**
- Create: `src/lib/setup-menu.ts`

- [ ] **Step 1: Create the menu setup function**

```ts
import { Menu, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";

export async function setupMenu(onPreferences: () => void) {
  const preferences = await MenuItem.new({
    id: "preferences",
    text: "Preferences...",
    accelerator: "CmdOrCtrl+,",
    action: onPreferences,
  });

  const separator = await PredefinedMenuItem.new({ item: "Separator" });

  const quit = await PredefinedMenuItem.new({ item: "Quit", text: "Quit Deep Search" });

  const appMenu = await Menu.new({
    id: "app-menu",
    items: [preferences, separator, quit],
  });

  await appMenu.setAsAppMenu();
}
```

Note: On macOS, `setAsAppMenu()` places this under the app-named menu automatically. On other platforms, this may need to be wrapped in a submenu called "File" — but Tauri's `setAsAppMenu` handles the platform convention.

---

### Task 5: Wire everything together in `App.tsx`

**Files:**
- Modify: `src/App.tsx`

This is the main integration task. Replace the inline API key forms with the settings context, add the dialog, and set up the menu.

- [ ] **Step 1: Rewrite App.tsx**

Replace the entire file with:

```tsx
import { useState, useEffect, useRef } from "react";
import { useChat } from "@ai-sdk/react";
import {
  streamText,
  convertToModelMessages,
  isToolUIPart,
  type ChatTransport,
  type UIMessage,
} from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { useAISDKRuntime } from "@assistant-ui/react-ai-sdk";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { SettingsProvider, useSettings } from "@/hooks/use-settings";
import { setupMenu } from "@/lib/setup-menu";
import { questionsTool } from "./tools/questions-tool";
import {
  braveSearchTool,
  setBraveApiKey,
} from "./tools/brave-search-tool";
import {
  exaSearchTool,
  setExaApiKey,
} from "./tools/exa-search-tool";
import {
  serperSearchTool,
  setSerperApiKey,
} from "./tools/serper-search-tool";
import {
  tavilySearchTool,
  setTavilyApiKey,
} from "./tools/tavily-search-tool";
import {
  searxngSearchTool,
  setSearXNGBaseUrl,
} from "./tools/searxng-search-tool";
import { QuestionsToolUI } from "./components/assistant-ui/questions-tool";
import { Thread } from "./components/assistant-ui/thread";
import { SettingsDialog } from "./components/settings-dialog";

class DirectTransport implements ChatTransport<UIMessage> {
  constructor(private getApiKey: () => string, private getModel: () => string) {}

  async sendMessages({
    messages,
    abortSignal,
  }: {
    trigger: "submit-message" | "regenerate-message";
    chatId: string;
    messageId: string | undefined;
    messages: UIMessage[];
    abortSignal: AbortSignal | undefined;
    headers?: Record<string, string> | Headers;
    body?: object;
    metadata?: unknown;
  }) {
    const openrouter = createOpenRouter({ apiKey: this.getApiKey() });
    const result = streamText({
      model: openrouter(this.getModel()),
      messages: await convertToModelMessages(messages),
      tools: {
        askQuestions: questionsTool,
        braveSearch: braveSearchTool,
        exaSearch: exaSearchTool,
        serperSearch: serperSearchTool,
        tavilySearch: tavilySearchTool,
        searxngSearch: searxngSearchTool,
      },
      abortSignal,
    });
    return result.toUIMessageStream();
  }

  reconnectToStream(): Promise<ReadableStream | null> {
    return Promise.resolve(null);
  }
}

function shouldContinueAfterToolResult({ messages }: { messages: UIMessage[] }) {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") return false;

  let lastToolPartIndex = -1;
  for (let index = last.parts.length - 1; index >= 0; index -= 1) {
    if (isToolUIPart(last.parts[index])) {
      lastToolPartIndex = index;
      break;
    }
  }
  if (lastToolPartIndex === -1) return false;

  const partsAfterTool = last.parts.slice(lastToolPartIndex + 1);
  const hasTextAfterTool = partsAfterTool.some(
    (part) => part.type === "text" && part.text.length > 0,
  );
  if (hasTextAfterTool) return false;

  const toolParts = last.parts.filter(isToolUIPart);
  return toolParts.every(
    (part) => part.state === "output-available" || part.state === "output-error",
  );
}

function AppInner() {
  const { settings, loading } = useSettings();
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    setupMenu(() => setDialogOpen(true));
  }, []);

  useEffect(() => {
    if (settings.brave_api_key) setBraveApiKey(settings.brave_api_key);
    if (settings.exa_api_key) setExaApiKey(settings.exa_api_key);
    if (settings.serper_api_key) setSerperApiKey(settings.serper_api_key);
    if (settings.tavily_api_key) setTavilyApiKey(settings.tavily_api_key);
    if (settings.searxng_url) setSearXNGBaseUrl(settings.searxng_url);
  }, [settings]);

  if (loading) return null;

  if (!settings.openrouter_api_key) {
    return (
      <>
        <main className="flex flex-col items-center justify-center pt-[10vh] text-center">
          <h1 className="text-2xl font-bold">Deep Search</h1>
          <p className="mt-2 text-sm text-zinc-500">
            Press <kbd className="rounded border px-1.5 py-0.5 text-xs">Cmd+,</kbd> to open settings and add your OpenRouter API key.
          </p>
        </main>
        <SettingsDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      </>
    );
  }

  return (
    <>
      <Chat apiKey={settings.openrouter_api_key} defaultModel={settings.default_model} />
      <SettingsDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}

function Chat({ apiKey, defaultModel }: { apiKey: string; defaultModel: string }) {
  const apiKeyRef = useRef(apiKey);
  apiKeyRef.current = apiKey;

  const modelRef = useRef(defaultModel);
  modelRef.current = defaultModel;

  const transportRef = useRef(new DirectTransport(() => apiKeyRef.current, () => modelRef.current));

  const chat = useChat({
    transport: transportRef.current,
    sendAutomaticallyWhen: shouldContinueAfterToolResult,
  });
  const runtime = useAISDKRuntime(chat);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <QuestionsToolUI />
      <div className="h-screen">
        <Thread />
      </div>
    </AssistantRuntimeProvider>
  );
}

function App() {
  return (
    <SettingsProvider>
      <AppInner />
    </SettingsProvider>
  );
}

export default App;
```

Key changes from the original `App.tsx`:
- Removed inline API key forms and all `useState` for individual keys
- Added `SettingsProvider` wrapper and `useSettings` hook
- `DirectTransport` now takes `getModel()` and reads `default_model` from settings
- All search tools are imported and wired up (braveSearch, exaSearch, serperSearch, tavilySearch, searxngSearch)
- Onboarding screen shows a message to press Cmd+, instead of inline forms
- `SettingsDialog` rendered at the top level, controlled by `dialogOpen` state
- Menu setup runs once on mount, callback opens the dialog

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors

---

### Task 6: Add menu permissions to Tauri capabilities

**Files:**
- Modify: `src-tauri/capabilities/default.json`

- [ ] **Step 1: Add menu permissions**

Change `src-tauri/capabilities/default.json` to:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Capability for the main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "opener:default",
    "store:default",
    "menu:default"
  ]
}
```

The only addition is `"menu:default"` which grants access to the Tauri menu API.

---

### Task 7: Verify the app builds and runs

- [ ] **Step 1: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 2: Run Tauri dev build**

Run: `npm run tauri dev`
Expected: app window opens, menu bar shows Preferences... with Cmd+, shortcut, settings dialog opens and saves values
