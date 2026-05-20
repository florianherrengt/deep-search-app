import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { BrowserTab } from "@/hooks/use-browser-tabs";

const TAB_BAR_HEIGHT = 40;

interface TabPanelProps {
  chatPanel: ReactNode;
  tabs: BrowserTab[];
  activeTabId: string;
  onSwitchTab: (id: string) => void;
  onCloseTab: (id: string) => void;
}

export function TabPanel({
  chatPanel,
  tabs,
  activeTabId,
  onSwitchTab,
  onCloseTab,
}: TabPanelProps) {
  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <div
        className="shrink-0 flex items-center gap-1 border-b bg-background px-2"
        style={{ height: TAB_BAR_HEIGHT }}
      >
        <Button
          variant={activeTabId === "main" ? "secondary" : "ghost"}
          size="sm"
          className="h-7 px-3 text-xs"
          onClick={() => onSwitchTab("main")}
        >
          Chat
        </Button>
        {tabs.map((tab) => (
          <div key={tab.id} className="flex items-center">
            <Button
              variant={activeTabId === tab.id ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-3 text-xs gap-1"
              onClick={() => onSwitchTab(tab.id)}
            >
              <span className="max-w-[120px] truncate">{tab.title}</span>
              <span
                className="ml-1 text-muted-foreground hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.id);
                }}
              >
                ✕
              </span>
            </Button>
          </div>
        ))}
      </div>
      <div className="flex-1 relative">{chatPanel}</div>
    </div>
  );
}
