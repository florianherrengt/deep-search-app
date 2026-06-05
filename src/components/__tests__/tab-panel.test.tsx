import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TabPanel } from "@/components/tab-panel";

describe("TabPanel", () => {
  it("keeps inactive app panels mounted while hiding them", () => {
    const html = renderToStaticMarkup(
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
      />,
    );

    expect(html).toContain("Chat panel");
    expect(html).toContain("Settings panel");
    expect(html).toContain("Tools panel");
    expect(html).toContain('hidden=""><div data-panel="chat"');
    expect(html).toContain('hidden=""><div data-panel="tools"');
  });
});
