import { useState, useEffect } from "react";
import { SettingsProvider, useSettings } from "@/hooks/use-settings";
import { setupMenu } from "@/lib/setup-menu";
import {
  setBraveApiKey,
  setExaApiKey,
  setSerperApiKey,
  setTavilyApiKey,
  setSearXNGBaseUrl,
} from "@/lib/transport";
import { Chat } from "@/components/chat";
import { SettingsDialog } from "@/components/settings-dialog";
import { TabPanel } from "@/components/tab-panel";
import { useBrowserTabs } from "@/hooks/use-browser-tabs";

declare global {
  interface Window {
    __mockQuestions?: boolean;
    __logs?: Array<Record<string, unknown>>;
  }
}

function AppInner() {
  const { settings, loading } = useSettings();
  const [dialogOpen, setDialogOpen] = useState(false);
  const { tabs, activeTabId, switchToTab, closeTab } = useBrowserTabs();

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
            Press{" "}
            <kbd className="rounded border px-1.5 py-0.5 text-xs">
              Cmd+,
            </kbd>{" "}
            to open settings and add your OpenRouter API key.
          </p>
        </main>
        <SettingsDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      </>
    );
  }

  return (
    <TabPanel
      chatPanel={
        <Chat
          apiKey={settings.openrouter_api_key}
          defaultModel={settings.default_model}
        />
      }
      tabs={tabs}
      activeTabId={activeTabId}
      onSwitchTab={switchToTab}
      onCloseTab={closeTab}
    />
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
