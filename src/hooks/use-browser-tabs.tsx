import { useState, useCallback, useEffect } from "react";
import { invoke } from "@/lib/tauri-bridge";
import {
  BROWSER_TAB_CLOSED_EVENT,
  BROWSER_TAB_OPENED_EVENT,
  type BrowserTabClosedDetail,
  type BrowserTabOpenedDetail,
} from "@/lib/browser-tab-events";

export interface BrowserTab {
  id: string;
  url: string;
  title: string;
}

export function useBrowserTabs() {
  const [tabs, setTabs] = useState<BrowserTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>("main");

  const addTab = useCallback(
    (tab: BrowserTab, activate = true) => {
      setTabs((prev) =>
        prev.some((existing) => existing.id === tab.id)
          ? prev.map((existing) => (existing.id === tab.id ? tab : existing))
          : [...prev, tab],
      );
      if (activate) setActiveTabId(tab.id);
    },
    [],
  );

  const removeTab = useCallback(
    (id: string) => {
      setTabs((prev) => prev.filter((t) => t.id !== id));
      setActiveTabId((current) => {
        if (current !== id) return current;
        invoke("switch_tab", { id: "main" }).catch(() => {});
        return "main";
      });
    },
    [],
  );

  const switchToTab = useCallback((id: string) => {
    setActiveTabId(id);
    invoke("switch_tab", { id }).catch(() => {});
  }, []);

  useEffect(() => {
    const handleTabOpened = (event: Event) => {
      const detail = (event as CustomEvent<BrowserTabOpenedDetail>).detail;
      if (!detail?.id || !detail.url) return;

      addTab(
        {
          id: detail.id,
          url: detail.url,
          title: detail.title || detail.url,
        },
        detail.activate !== false,
      );

      if (detail.activate !== false) {
        invoke("switch_tab", { id: detail.id }).catch(() => {});
      }
    };

    const handleTabClosed = (event: Event) => {
      const detail = (event as CustomEvent<BrowserTabClosedDetail>).detail;
      if (!detail?.id) return;
      removeTab(detail.id);
    };

    window.addEventListener(BROWSER_TAB_OPENED_EVENT, handleTabOpened);
    window.addEventListener(BROWSER_TAB_CLOSED_EVENT, handleTabClosed);

    return () => {
      window.removeEventListener(BROWSER_TAB_OPENED_EVENT, handleTabOpened);
      window.removeEventListener(BROWSER_TAB_CLOSED_EVENT, handleTabClosed);
    };
  }, [addTab, removeTab]);

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

      const html = await invoke<string>("extract_content", { id }).catch(
        () => "",
      );

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
