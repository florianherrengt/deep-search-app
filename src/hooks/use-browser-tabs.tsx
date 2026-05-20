import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface BrowserTab {
  id: string;
  url: string;
  title: string;
}

export function useBrowserTabs() {
  const [tabs, setTabs] = useState<BrowserTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>("main");

  useEffect(() => {
    const unlisteners: (() => void)[] = [];

    listen<BrowserTab>("browser-tab-opened", (e) => {
      setTabs((prev) => {
        if (prev.some((t) => t.id === e.payload.id)) return prev;
        return [...prev, e.payload];
      });
      setActiveTabId(e.payload.id);
    }).then((u) => unlisteners.push(u));

    listen<{ id: string }>("browser-tab-closed", (e) => {
      setTabs((prev) => prev.filter((t) => t.id !== e.payload.id));
      setActiveTabId("main");
    }).then((u) => unlisteners.push(u));

    return () => {
      for (const u of unlisteners) u();
    };
  }, []);

  const switchToTab = useCallback((id: string) => {
    setActiveTabId(id);
    invoke("switch_tab", { id }).catch(() => {});
  }, []);

  const closeTab = useCallback((id: string) => {
    invoke("close_tab", { id }).catch(() => {});
    invoke("switch_tab", { id: "main" }).catch(() => {});
    setTabs((prev) => prev.filter((t) => t.id !== id));
    setActiveTabId("main");
  }, []);

  return {
    tabs,
    activeTabId,
    switchToTab,
    closeTab,
  };
}
