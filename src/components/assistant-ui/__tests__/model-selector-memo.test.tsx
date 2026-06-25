// @vitest-environment jsdom
import { type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

// Mock @assistant-ui/react's useAui to avoid pulling in the runtime. We just
// need modelContext().register to be a no-op so ModelSelector mounts.
vi.mock("@assistant-ui/react", () => ({
  useAui: () => ({
    modelContext: () => ({
      register: () => () => {},
    }),
  }),
}));

// spy on Mantine Select so we can count how many times the memoized subtree
// actually invokes it. Each invocation == one render of ModelSelector.
const selectRenderSpy = vi.fn();
vi.mock("@mantine/core", () => ({
  Select: (props: unknown) => {
    selectRenderSpy(props);
    return null;
  },
}));

const { ModelSelector } = await import(
  "@/components/assistant-ui/model-selector"
);

function Harness({
  models,
  value,
  onValueChange,
}: {
  models: { id: string; name: string }[];
  value: string;
  onValueChange: (v: string) => void;
  trigger?: number;
}) {
  // The parent re-renders whenever `trigger` changes (passed by Wrapper).
  // If onValueChange were recreated every render, ModelSelector's memo
  // would be defeated and selectRenderSpy would fire on every trigger.
  return (
    <ModelSelector
      models={models}
      value={value}
      onValueChange={onValueChange}
    />
  );
}

describe("ModelSelector memoization", () => {
  it("does not re-render when parent re-renders with stable onValueChange", () => {
    const models = [
      { id: "m1", name: "Model 1" },
      { id: "m2", name: "Model 2" },
    ];
    const stableCallback = (v: string) => {
      void v;
    };

    const Wrapper = ({ trigger }: { trigger: number }) => (
      <Harness
        models={models}
        value="m1"
        onValueChange={stableCallback}
        trigger={trigger}
      />
    );

    selectRenderSpy.mockClear();
    const { rerender } = render(<Wrapper trigger={0} />);
    const baselineCalls = selectRenderSpy.mock.calls.length;
    expect(baselineCalls).toBeGreaterThanOrEqual(1);

    // Force 10 parent re-renders with stable props.
    for (let i = 1; i <= 10; i += 1) {
      rerender(<Wrapper trigger={i} />);
    }

    // Memoized: ModelSelector should NOT have re-rendered.
    expect(selectRenderSpy.mock.calls.length).toBe(baselineCalls);
  });

  it("re-renders when value prop changes", () => {
    const models = [
      { id: "m1", name: "Model 1" },
      { id: "m2", name: "Model 2" },
    ];
    const stableCallback = (v: string) => {
      void v;
    };

    const Wrapper = ({ value }: { value: string }) => (
      <Harness
        models={models}
        value={value}
        onValueChange={stableCallback}
        trigger={0}
      />
    );

    selectRenderSpy.mockClear();
    const { rerender } = render(<Wrapper value="m1" />);
    const baselineCalls = selectRenderSpy.mock.calls.length;
    expect(baselineCalls).toBeGreaterThanOrEqual(1);

    rerender(<Wrapper value="m2" />);
    expect(selectRenderSpy.mock.calls.length).toBeGreaterThan(baselineCalls);
  });

  it("regression: re-renders if onValueChange is a fresh closure every render", () => {
    // This test documents the bug we fixed in chat.tsx: passing a fresh
    // function every render defeats React.memo. Chat used to declare
    // handleModelChange as a function in its render body. We now wrap it
    // in useCallback. This test proves the memo contract is enforced.
    const models = [{ id: "m1", name: "Model 1" }];

    const Wrapper = ({ trigger }: { trigger: number }) => (
      <Harness
        models={models}
        value="m1"
        onValueChange={(v) => {
          void v;
          void trigger;
        }}
        trigger={trigger}
      />
    );

    selectRenderSpy.mockClear();
    const { rerender } = render(<Wrapper trigger={0} />);
    const baselineCalls = selectRenderSpy.mock.calls.length;
    expect(baselineCalls).toBeGreaterThanOrEqual(1);

    for (let i = 1; i <= 3; i += 1) {
      rerender(<Wrapper trigger={i} />);
    }

    // Inline closure => memo defeated => ModelSelector re-renders every time.
    expect(selectRenderSpy.mock.calls.length).toBe(baselineCalls + 3);
  });
});

void (null as unknown as ReactNode);

