import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@/lib/tauri-bridge";
import {
  BROWSER_TAB_CLOSED_EVENT,
  BROWSER_TAB_OPENED_EVENT,
  BROWSER_TAB_VERIFICATION_CLEARED_EVENT,
  BROWSER_TAB_VERIFICATION_REQUIRED_EVENT,
  type BrowserTabClosedDetail,
  type BrowserTabOpenedDetail,
  type BrowserTabVerificationDetail,
} from "@/lib/browser-tab-events";

export interface BrowserTab {
  id: string;
  url: string;
  title: string;
  needsAttention?: boolean;
}

const APP_TAB_IDS = new Set(["main", "settings", "prompts", "skills", "tools"]);

export function useBrowserTabs() {
  const [tabs, setTabs] = useState<BrowserTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>("main");
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  const addTab = useCallback(
    (tab: BrowserTab, activate = true) => {
      setTabs((prev) =>
        prev.some((existing) => existing.id === tab.id)
          ? prev.map((existing) =>
              existing.id === tab.id ? { ...existing, ...tab } : existing,
            )
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
    const targetId =
      APP_TAB_IDS.has(id) || tabsRef.current.some((tab) => tab.id === id)
        ? id
        : "main";
    setActiveTabId(targetId);
    invoke("switch_tab", { id: targetId }).catch(() => {});
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

    const setVerificationAttention = (event: Event, needsAttention: boolean) => {
      const detail = (event as CustomEvent<BrowserTabVerificationDetail>).detail;
      if (!detail?.id) return;
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === detail.id ? { ...tab, needsAttention } : tab,
        ),
      );
    };

    const handleVerificationRequired = (event: Event) => {
      setVerificationAttention(event, true);
    };

    const handleVerificationCleared = (event: Event) => {
      setVerificationAttention(event, false);
    };

    window.addEventListener(BROWSER_TAB_OPENED_EVENT, handleTabOpened);
    window.addEventListener(BROWSER_TAB_CLOSED_EVENT, handleTabClosed);
    window.addEventListener(
      BROWSER_TAB_VERIFICATION_REQUIRED_EVENT,
      handleVerificationRequired,
    );
    window.addEventListener(
      BROWSER_TAB_VERIFICATION_CLEARED_EVENT,
      handleVerificationCleared,
    );

    return () => {
      window.removeEventListener(BROWSER_TAB_OPENED_EVENT, handleTabOpened);
      window.removeEventListener(BROWSER_TAB_CLOSED_EVENT, handleTabClosed);
      window.removeEventListener(
        BROWSER_TAB_VERIFICATION_REQUIRED_EVENT,
        handleVerificationRequired,
      );
      window.removeEventListener(
        BROWSER_TAB_VERIFICATION_CLEARED_EVENT,
        handleVerificationCleared,
      );
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
