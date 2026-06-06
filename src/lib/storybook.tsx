import type { ReactNode } from "react";
import type { Decorator } from "@storybook/react-vite";
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  type ChatModelAdapter,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import type { AppUpdateState } from "@/hooks/use-app-update";

type StoreSeed = Record<string, Record<string, unknown>>;

type StorybookWindow = Window & {
  __storybookTauriStores?: StoreSeed;
  __storybookAppUpdateState?: AppUpdateState;
};

const storybookChatModel: ChatModelAdapter = {
  async run() {
    return {
      content: [
        {
          type: "text",
          text: "This is a local Storybook response from the browser runtime.",
        },
      ],
    };
  },
};

function cloneStoreSeed(stores: StoreSeed): StoreSeed {
  return JSON.parse(JSON.stringify(stores)) as StoreSeed;
}

export function setStorybookTauriStores(stores: StoreSeed) {
  if (typeof window === "undefined") return;
  (window as StorybookWindow).__storybookTauriStores = cloneStoreSeed(stores);
}

export function withTauriStores(stores: StoreSeed): Decorator {
  return (Story) => {
    setStorybookTauriStores(stores);
    return <Story />;
  };
}

export function withAppUpdateState(state: AppUpdateState): Decorator {
  return (Story) => {
    if (typeof window !== "undefined") {
      (window as StorybookWindow).__storybookAppUpdateState = state;
    }
    return <Story />;
  };
}

export function AssistantRuntimeStoryProvider({
  children,
  initialMessages = [],
}: {
  children: ReactNode;
  initialMessages?: readonly ThreadMessageLike[];
}) {
  const runtime = useLocalRuntime(storybookChatModel, { initialMessages });
  return (
    <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>
  );
}

export function withAssistantRuntime(
  initialMessages: readonly ThreadMessageLike[] = [],
): Decorator {
  return (Story) => (
    <AssistantRuntimeStoryProvider initialMessages={initialMessages}>
      <Story />
    </AssistantRuntimeStoryProvider>
  );
}
