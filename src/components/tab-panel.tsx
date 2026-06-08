import type { ReactNode } from "react";
import { XIcon } from "lucide-react";
import { Button, Group, Box } from "@mantine/core";
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
    <Box className="md-flex-col">
      <Group
        gap={4}
        className="md-divider-bottom"
        style={{
          height: TAB_BAR_HEIGHT,
          flexShrink: 0,
          paddingLeft: 8,
          paddingRight: 8,
          backgroundColor: "var(--mantine-color-body)",
        }}
        wrap="nowrap"
      >
        {(["main", "settings", "prompts", "skills", "tools"] as const).map(
          (tabId) => {
            const label =
              tabId === "main"
                ? "Chat"
                : tabId.charAt(0).toUpperCase() + tabId.slice(1);
            return (
              <Button
                key={tabId}
                variant={activeTabId === tabId ? "light" : "subtle"}
                size="compact-sm"
                data-testid="app-tab"
                data-tab-id={tabId}
                onClick={() => onSwitchTab(tabId)}
              >
                {label}
              </Button>
            );
          },
        )}
        {tabs.map((tab) => (
          <Group key={tab.id} gap={0} wrap="nowrap">
            <Button
              variant={activeTabId === tab.id ? "light" : "subtle"}
              size="compact-sm"
              data-testid="browser-tab"
              data-tab-id={tab.id}
              data-tab-url={tab.url}
              onClick={() => onSwitchTab(tab.id)}
              styles={{
                root: { maxWidth: 160 },
                inner: { justifyContent: "flex-start" },
                label: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
              }}
            >
              {tab.title}
            </Button>
            <Button
              variant="subtle"
              size="compact-sm"
              color="gray"
              aria-label={`Close ${tab.title} tab`}
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(tab.id);
              }}
              styles={{ root: { padding: "0 4px", minWidth: 0, width: "auto" } }}
            >
              <XIcon size={12} />
            </Button>
          </Group>
        ))}
        {toolbarEnd && (
          <Box style={{ marginLeft: "auto", flexShrink: 0, display: "flex", alignItems: "center" }}>
            {toolbarEnd}
          </Box>
        )}
      </Group>
      <Box className="md-flex-fill-overflow">
        <Box style={{ height: "100%" }} hidden={activeTabId !== "main"}>
          {chatPanel}
        </Box>
        <Box style={{ height: "100%" }} hidden={activeTabId !== "settings"}>
          {settingsPanel}
        </Box>
        <Box style={{ height: "100%" }} hidden={activeTabId !== "prompts"}>
          {promptsPanel}
        </Box>
        <Box style={{ height: "100%" }} hidden={activeTabId !== "skills"}>
          {skillsPanel}
        </Box>
        <Box style={{ height: "100%" }} hidden={activeTabId !== "tools"}>
          {toolsPanel}
        </Box>
      </Box>
    </Box>
  );
}
