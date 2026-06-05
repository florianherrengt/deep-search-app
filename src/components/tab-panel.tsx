import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { BrowserTab } from "@/hooks/use-browser-tabs";

const TAB_BAR_HEIGHT = 40;

interface TabPanelProps {
  chatPanel: ReactNode;
  toolsPanel: ReactNode;
  settingsPanel: ReactNode;
  promptsPanel: ReactNode;
  skillsPanel: ReactNode;
  toolbarEnd?: ReactNode;
  tabs: BrowserTab[];
  activeTabId: string;
  onSwitchTab: (id: string) => void;
  onCloseTab: (id: string) => void;
}

export function TabPanel({
  chatPanel,
  toolsPanel,
  settingsPanel,
  promptsPanel,
  skillsPanel,
  toolbarEnd,
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
          data-testid="app-tab"
          data-tab-id="main"
          onClick={() => onSwitchTab("main")}
        >
          Chat
        </Button>
        <Button
          variant={activeTabId === "settings" ? "secondary" : "ghost"}
          size="sm"
          className="h-7 px-3 text-xs"
          data-testid="app-tab"
          data-tab-id="settings"
          onClick={() => onSwitchTab("settings")}
        >
          Settings
        </Button>
        <Button
          variant={activeTabId === "prompts" ? "secondary" : "ghost"}
          size="sm"
          className="h-7 px-3 text-xs"
          data-testid="app-tab"
          data-tab-id="prompts"
          onClick={() => onSwitchTab("prompts")}
        >
          Prompts
        </Button>
        <Button
          variant={activeTabId === "skills" ? "secondary" : "ghost"}
          size="sm"
          className="h-7 px-3 text-xs"
          data-testid="app-tab"
          data-tab-id="skills"
          onClick={() => onSwitchTab("skills")}
        >
          Skills
        </Button>
        <Button
          variant={activeTabId === "tools" ? "secondary" : "ghost"}
          size="sm"
          className="h-7 px-3 text-xs"
          data-testid="app-tab"
          data-tab-id="tools"
          onClick={() => onSwitchTab("tools")}
        >
          Tools
        </Button>
        {tabs.map((tab) => (
          <div key={tab.id} className="flex items-center">
            <Button
              variant={activeTabId === tab.id ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-3 text-xs gap-1"
              data-testid="browser-tab"
              data-tab-id={tab.id}
              data-tab-url={tab.url}
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
        {toolbarEnd ? (
          <div className="ml-auto flex shrink-0 items-center">{toolbarEnd}</div>
        ) : null}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <div className="h-full" hidden={activeTabId !== "main"}>
          {chatPanel}
        </div>
        <div className="h-full" hidden={activeTabId !== "settings"}>
          {settingsPanel}
        </div>
        <div className="h-full" hidden={activeTabId !== "prompts"}>
          {promptsPanel}
        </div>
        <div className="h-full" hidden={activeTabId !== "skills"}>
          {skillsPanel}
        </div>
        <div className="h-full" hidden={activeTabId !== "tools"}>
          {toolsPanel}
        </div>
      </div>
    </div>
  );
}
