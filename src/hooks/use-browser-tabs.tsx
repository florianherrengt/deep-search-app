import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface BrowserTab {
  id: string;
  url: string;
  title: string;
}

export function useBrowserTabs() {
  const [tabs, setTabs] = useState<BrowserTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>("main");

  const addTab = useCallback(
    (tab: BrowserTab) => {
      setTabs((prev) => [...prev, tab]);
      setActiveTabId(tab.id);
    },
    [],
  );

  const removeTab = useCallback(
    (id: string) => {
      setTabs((prev) => prev.filter((t) => t.id !== id));
      if (activeTabId === id) {
        setActiveTabId("main");
        invoke("switch_tab", { id: "main" }).catch(() => {});
      }
    },
    [activeTabId],
  );

  const switchToTab = useCallback((id: string) => {
    setActiveTabId(id);
    invoke("switch_tab", { id }).catch(() => {});
  }, []);

  const openAndExtract = useCallback(
    async (url: string): Promise<string> => {
      const id = `tab-${Date.now()}`;
      const hostname = (() => {
        try {
          return new URL(url).hostname;
        } catch {
          return url;
        }
      })();

      addTab({ id, url, title: hostname });
      await invoke("switch_tab", { id });

      let html = "";
      try {
        html = await invoke<string>("extract_content", { id });
      } catch {}

      removeTab(id);
      return html;
    },
    [addTab, removeTab],
  );

  const closeTab = useCallback(
    (id: string) => {
      invoke("close_tab", { id }).catch(() => {});
      removeTab(id);
    },
    [removeTab],
  );

  return {
    tabs,
    activeTabId,
    switchToTab,
    closeTab,
    openAndExtract,
  };
}
