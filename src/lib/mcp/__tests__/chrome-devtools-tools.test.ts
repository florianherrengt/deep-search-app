import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clients: [] as Array<{
    callTool: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
    listTools: ReturnType<typeof vi.fn>;
  }>,
  createCommand: vi.fn(),
}));

vi.mock("@/lib/tauri-bridge", () => ({
  isTauri: () => true,
}));

vi.mock("@/lib/mcp/chrome-devtools-sidecar", () => ({
  createChromeDevToolsMcpCommand: mocks.createCommand,
}));

vi.mock("@/lib/mcp/tauri-stdio-transport", () => ({
  TauriStdioTransport: class {
    stderrTail = "";
  },
}));

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    callTool = vi.fn(async () => ({ content: [] }));
    close = vi.fn(async () => undefined);
    connect = vi.fn(async () => undefined);
    listTools = vi.fn(async () => ({
      tools: [
        {
          name: "navigate_page",
          description: "Navigate the selected page",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    }));

    constructor() {
      mocks.clients.push(this);
    }
  },
}));

import {
  createChromeDevToolsMcpTools,
  shutdownChromeDevToolsMcp,
  withChromeDevToolsMcpClient,
} from "@/lib/mcp/chrome-devtools-tools";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("Chrome DevTools MCP exclusive operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.clients.length = 0;
    mocks.createCommand.mockResolvedValue("mock-command");
  });

  afterEach(async () => {
    await shutdownChromeDevToolsMcp();
  });

  it("runs operations exclusively in FIFO order", async () => {
    const firstGate = deferred();
    const firstStarted = deferred();
    const events: string[] = [];

    const first = withChromeDevToolsMcpClient({}, async () => {
      events.push("first:start");
      firstStarted.resolve();
      await firstGate.promise;
      events.push("first:end");
      return 1;
    });
    const second = withChromeDevToolsMcpClient({}, async () => {
      events.push("second:start");
      events.push("second:end");
      return 2;
    });
    const third = withChromeDevToolsMcpClient({}, async () => {
      events.push("third:start");
      events.push("third:end");
      return 3;
    });

    await firstStarted.promise;
    expect(events).toEqual(["first:start"]);
    firstGate.resolve();

    await expect(Promise.all([first, second, third])).resolves.toEqual([1, 2, 3]);
    expect(events).toEqual([
      "first:start",
      "first:end",
      "second:start",
      "second:end",
      "third:start",
      "third:end",
    ]);
  });

  it("rejects an aborted queued operation without calling the browser", async () => {
    const firstGate = deferred();
    const browserOperation = vi.fn(async () => "should not run");
    const abortController = new AbortController();

    const first = withChromeDevToolsMcpClient({}, async () => {
      await firstGate.promise;
    });
    const queued = withChromeDevToolsMcpClient(
      {},
      browserOperation,
      abortController.signal,
    );

    abortController.abort();

    await expect(queued).rejects.toMatchObject({ name: "AbortError" });
    expect(browserOperation).not.toHaveBeenCalled();

    firstGate.resolve();
    await first;
    expect(browserOperation).not.toHaveBeenCalled();
  });

  it("rejects promptly when startup is aborted without cancelling shared startup", async () => {
    const command = deferred<string>();
    const abortController = new AbortController();
    const browserOperation = vi.fn(async () => "unused");
    mocks.createCommand.mockReturnValueOnce(command.promise);

    const pending = withChromeDevToolsMcpClient(
      {},
      browserOperation,
      abortController.signal,
    );
    abortController.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(browserOperation).not.toHaveBeenCalled();

    command.resolve("mock-command");
    await withChromeDevToolsMcpClient({}, async () => undefined);
    expect(mocks.clients).toHaveLength(1);
  });

  it("serializes dynamically exposed raw Chrome tool calls", async () => {
    const tools = await createChromeDevToolsMcpTools({ enabled: true });
    const client = mocks.clients[0];
    const firstGate = deferred();

    client.callTool.mockImplementation(async (request: { arguments?: { call?: number } }) => {
      if (request.arguments?.call === 1) await firstGate.promise;
      return { content: [{ type: "text", text: String(request.arguments?.call) }] };
    });

    const execute = tools.chrome_devtools_navigate_page?.execute as unknown as (
      input: { call: number },
      options?: { abortSignal?: AbortSignal },
    ) => Promise<unknown>;
    expect(execute).toBeTypeOf("function");

    const first = execute({ call: 1 });
    const second = execute({ call: 2 });

    expect(client.callTool).toHaveBeenCalledTimes(1);
    expect(client.callTool).toHaveBeenNthCalledWith(
      1,
      { name: "navigate_page", arguments: { call: 1 } },
      undefined,
      { timeout: 30_000 },
    );

    firstGate.resolve();
    await Promise.all([first, second]);

    expect(client.callTool).toHaveBeenCalledTimes(2);
    expect(client.callTool).toHaveBeenNthCalledWith(
      2,
      { name: "navigate_page", arguments: { call: 2 } },
      undefined,
      { timeout: 30_000 },
    );
  });
});

describe("Chrome DevTools MCP client connection cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.clients.length = 0;
    mocks.createCommand.mockResolvedValue("mock-command");
  });

  afterEach(async () => {
    await shutdownChromeDevToolsMcp();
  });

  it("closes and reconnects when a direct caller changes connection config", async () => {
    const first = await withChromeDevToolsMcpClient(
      { connectionMode: "auto" },
      async (client) => client,
    );
    const same = await withChromeDevToolsMcpClient(
      {
        connectionMode: "auto",
        browserUrl: "http://ignored.example:9222",
      },
      async (client) => client,
    );

    expect(same).toBe(first);
    expect(mocks.clients).toHaveLength(1);
    expect(mocks.clients[0].close).not.toHaveBeenCalled();

    const reconnected = await withChromeDevToolsMcpClient(
      {
        connectionMode: "browser-url",
        browserUrl: " http://127.0.0.1:9222 ",
        nodePath: " /custom/node ",
      },
      async (client) => client,
    );

    expect(reconnected).not.toBe(first);
    expect(mocks.clients).toHaveLength(2);
    expect(mocks.clients[0].close).toHaveBeenCalledTimes(1);
    expect(mocks.createCommand).toHaveBeenNthCalledWith(2, {
      mode: "browser-url",
      browserUrl: " http://127.0.0.1:9222 ",
      nodePath: " /custom/node ",
    });
  });

  it("rebuilds exposed tools against the reconnected client", async () => {
    const firstTools = await createChromeDevToolsMcpTools({
      enabled: true,
      connectionMode: "auto",
    });
    const secondTools = await createChromeDevToolsMcpTools({
      enabled: true,
      connectionMode: "browser-url",
      browserUrl: "http://127.0.0.1:9222",
    });

    expect(firstTools.chrome_devtools_navigate_page).toBeDefined();
    expect(secondTools.chrome_devtools_navigate_page).toBeDefined();
    expect(secondTools).not.toBe(firstTools);
    expect(mocks.clients).toHaveLength(2);
    expect(mocks.clients[0].close).toHaveBeenCalledTimes(1);
    expect(mocks.clients[1].listTools).toHaveBeenCalledTimes(1);
  });

  it("waits for an active browser transaction before reconnecting", async () => {
    const firstClient = await withChromeDevToolsMcpClient(
      { connectionMode: "auto" },
      async (client) => client,
    );
    const transactionStarted = deferred();
    const releaseTransaction = deferred();
    const activeTransaction = withChromeDevToolsMcpClient(
      { connectionMode: "auto" },
      async () => {
        transactionStarted.resolve();
        await releaseTransaction.promise;
      },
    );
    await transactionStarted.promise;

    const reconnect = withChromeDevToolsMcpClient(
      {
        connectionMode: "browser-url",
        browserUrl: "http://127.0.0.1:9222",
      },
      async (client) => client,
    );
    await Promise.resolve();

    expect(firstClient.close).not.toHaveBeenCalled();
    expect(mocks.clients).toHaveLength(1);

    releaseTransaction.resolve();
    await activeTransaction;
    const secondClient = await reconnect;

    expect(firstClient.close).toHaveBeenCalledTimes(1);
    expect(secondClient).not.toBe(firstClient);
  });
});
