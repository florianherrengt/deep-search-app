import type { ComponentType, ReactNode } from "react";
import {
  BotIcon,
  FileTextIcon,
  MessageSquareIcon,
  PanelLeftIcon,
  SettingsIcon,
  SparklesIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import {
  ActionIcon,
  Box,
  Button,
  Divider,
  Group,
  Tooltip,
} from "@mantine/core";
import type { BrowserTab } from "@/hooks/use-browser-tabs";
import classes from "./tab-panel.module.css";

interface TabPanelProps {
  chatPanel: ReactNode;
  toolsPanel: ReactNode;
  settingsPanel: ReactNode;
  promptsPanel: ReactNode;
  skillsPanel: ReactNode;
  toolbarEnd?: ReactNode;
  navigationOpen?: boolean;
  onToggleNavigation?: () => void;
  subAgentSidebarOpen?: boolean;
  subAgentSidebarDisabled?: boolean;
  onToggleSubAgentSidebar?: () => void;
  tabs: BrowserTab[];
  activeTabId: string;
  onSwitchTab: (id: string) => void;
  onCloseTab: (id: string) => void;
}

type AppTabId = "main" | "settings" | "prompts" | "skills" | "tools";

const APP_TABS: ReadonlyArray<{
  id: AppTabId;
  label: string;
  icon: ComponentType<{ size?: string | number }>;
}> = [
  { id: "main", label: "Chat", icon: MessageSquareIcon },
  { id: "settings", label: "Settings", icon: SettingsIcon },
  { id: "prompts", label: "Prompts", icon: FileTextIcon },
  { id: "skills", label: "Skills", icon: SparklesIcon },
  { id: "tools", label: "Tools", icon: WrenchIcon },
];

export function TabPanel({
  chatPanel,
  toolsPanel,
  settingsPanel,
  promptsPanel,
  skillsPanel,
  toolbarEnd,
  navigationOpen,
  onToggleNavigation,
  subAgentSidebarOpen,
  subAgentSidebarDisabled = false,
  onToggleSubAgentSidebar,
  tabs,
  activeTabId,
  onSwitchTab,
  onCloseTab,
}: TabPanelProps) {
  return (
    <Box className="md-flex-col">
      <Box component="header" className={classes.header}>
        <Group h="100%" gap="xs" wrap="nowrap">
          {onToggleNavigation ? (
            <Tooltip label={navigationOpen ? "Close research navigation" : "Open research navigation"}>
              <ActionIcon
                variant="subtle"
                color="gray"
                data-active={navigationOpen || undefined}
                size="sm"
                aria-label={navigationOpen ? "Close research navigation" : "Open research navigation"}
                aria-expanded={navigationOpen}
                onClick={onToggleNavigation}
              >
                <PanelLeftIcon size={16} />
              </ActionIcon>
            </Tooltip>
          ) : null}

          <Box component="nav" aria-label="Application sections" className={classes.tabScroller}>
            <Group gap={2} wrap="nowrap" className={classes.tabList}>
              {APP_TABS.map(({ id, label, icon: Icon }) => {
                const active = activeTabId === id;
                return (
                  <Button
                    key={id}
                    variant="subtle"
                    color="gray"
                    size="compact-sm"
                    className={classes.appTab}
                    data-active={active || undefined}
                    leftSection={<Icon size={14} />}
                    aria-label={label}
                    aria-current={active ? "page" : undefined}
                    data-testid="app-tab"
                    data-tab-id={id}
                    onClick={() => onSwitchTab(id)}
                  >
                    <span className={classes.appTabLabel}>{label}</span>
                  </Button>
                );
              })}

              {tabs.length > 0 ? (
                <Divider orientation="vertical" className={classes.tabDivider} />
              ) : null}

              {tabs.map((tab) => {
                const active = activeTabId === tab.id;
                return (
                  <Group key={tab.id} gap={0} wrap="nowrap" className={classes.browserTabGroup}>
                    <Button
                      variant="subtle"
                      color="gray"
                      size="compact-sm"
                      className={classes.browserTab}
                      data-active={active || undefined}
                      data-testid="browser-tab"
                      data-tab-id={tab.id}
                      data-tab-url={tab.url}
                      aria-current={active ? "page" : undefined}
                      onClick={() => onSwitchTab(tab.id)}
                    >
                      {tab.title}
                    </Button>
                    <ActionIcon
                      variant="subtle"
                      size="sm"
                      color="gray"
                      aria-label={`Close ${tab.title} tab`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onCloseTab(tab.id);
                      }}
                    >
                      <XIcon size={12} />
                    </ActionIcon>
                  </Group>
                );
              })}
            </Group>
          </Box>

          {onToggleSubAgentSidebar && !subAgentSidebarDisabled ? (
            <Tooltip
              label={subAgentSidebarOpen ? "Close sub-agents" : "Open sub-agents"}
            >
              <Button
                variant="subtle"
                color="gray"
                size="compact-sm"
                className={classes.toolbarAction}
                data-active={subAgentSidebarOpen || undefined}
                leftSection={<BotIcon size={14} />}
                aria-label={subAgentSidebarOpen ? "Close sub-agents" : "Open sub-agents"}
                aria-expanded={subAgentSidebarOpen}
                onClick={onToggleSubAgentSidebar}
              >
                <span className={classes.toolbarActionLabel}>Sub-agents</span>
              </Button>
            </Tooltip>
          ) : null}

          {toolbarEnd ? <Box className={classes.toolbarEnd}>{toolbarEnd}</Box> : null}
        </Group>
      </Box>

      <Box component="main" className="md-flex-fill-overflow">
        <Box h="100%" hidden={activeTabId !== "main"}>
          {chatPanel}
        </Box>
        <Box h="100%" hidden={activeTabId !== "settings"}>
          {settingsPanel}
        </Box>
        <Box h="100%" hidden={activeTabId !== "prompts"}>
          {promptsPanel}
        </Box>
        <Box h="100%" hidden={activeTabId !== "skills"}>
          {skillsPanel}
        </Box>
        <Box h="100%" hidden={activeTabId !== "tools"}>
          {toolsPanel}
        </Box>
      </Box>
    </Box>
  );
}
