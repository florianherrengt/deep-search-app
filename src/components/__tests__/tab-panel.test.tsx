import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MantineProvider } from "@mantine/core";
import { TabPanel } from "@/components/tab-panel";

describe("TabPanel", () => {
  it("keeps inactive app panels mounted while hiding them", () => {
    const html = renderToStaticMarkup(
      <MantineProvider>
        <TabPanel
          chatPanel={<div data-panel="chat">Chat panel</div>}
          settingsPanel={<div data-panel="settings">Settings panel</div>}
          toolsPanel={<div data-panel="tools">Tools panel</div>}
          promptsPanel={<div data-panel="prompts">Prompts panel</div>}
          skillsPanel={<div data-panel="skills">Skills panel</div>}
          tabs={[]}
          activeTabId="settings"
          onSwitchTab={vi.fn()}
          onCloseTab={vi.fn()}
        />
      </MantineProvider>,
    );

    expect(html).toContain("Chat panel");
    expect(html).toContain("Settings panel");
    expect(html).toContain("Tools panel");
    expect(html).toContain('hidden');
    expect(html).toContain('data-panel="chat"');
    expect(html).toContain('data-panel="tools"');
  });

  it("exposes semantic application navigation and main content", () => {
    const html = renderToStaticMarkup(
      <MantineProvider>
        <TabPanel
          chatPanel={<div>Chat panel</div>}
          settingsPanel={<div>Settings panel</div>}
          toolsPanel={<div>Tools panel</div>}
          promptsPanel={<div>Prompts panel</div>}
          skillsPanel={<div>Skills panel</div>}
          tabs={[]}
          activeTabId="main"
          onSwitchTab={vi.fn()}
          onCloseTab={vi.fn()}
        />
      </MantineProvider>,
    );

    expect(html).toContain('aria-label="Application sections"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("<main");
    expect(html).not.toContain('aria-label="Deep Search"');
  });

  it("omits the sub-agent action until a chat context is available", () => {
    const html = renderToStaticMarkup(
      <MantineProvider>
        <TabPanel
          chatPanel={<div>Chat panel</div>}
          settingsPanel={<div>Settings panel</div>}
          toolsPanel={<div>Tools panel</div>}
          promptsPanel={<div>Prompts panel</div>}
          skillsPanel={<div>Skills panel</div>}
          tabs={[]}
          activeTabId="main"
          subAgentSidebarDisabled
          onToggleSubAgentSidebar={vi.fn()}
          onSwitchTab={vi.fn()}
          onCloseTab={vi.fn()}
        />
      </MantineProvider>,
    );

    expect(html).not.toContain("Open sub-agents");
    expect(html).not.toContain("Close sub-agents");
  });

  it("marks verification-blocked browser tabs with visible and accessible context", () => {
    const html = renderToStaticMarkup(
      <MantineProvider>
        <TabPanel
          chatPanel={<div>Chat panel</div>}
          settingsPanel={<div>Settings panel</div>}
          toolsPanel={<div>Tools panel</div>}
          promptsPanel={<div>Prompts panel</div>}
          skillsPanel={<div>Skills panel</div>}
          tabs={[
            {
              id: "google-search",
              title: "Google Search",
              url: "https://www.google.com/search?q=test",
              needsAttention: true,
            },
          ]}
          activeTabId="main"
          onSwitchTab={vi.fn()}
          onCloseTab={vi.fn()}
        />
      </MantineProvider>,
    );

    expect(html).toContain('data-needs-attention="true"');
    expect(html).toContain("browser-tab-verification-indicator");
    expect(html).toContain("Human verification required");
    expect(html).toContain(
      'aria-label="Google Search — human verification required"',
    );
  });
});
