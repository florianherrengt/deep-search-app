import {
  useEffect,
  useState,
  useRef,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  FolderIcon,
  FolderOpenIcon,
  LoaderIcon,
  MessageCircleQuestionIcon,
  MessageSquareIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { appDataDir, join, openPath } from "@/lib/tauri-bridge";
import {
  Box,
  Button,
  TextInput,
  Modal,
  Text,
  Group,
  Menu,
  ScrollArea,
  ActionIcon,
  Loader,
  rem,
  Skeleton,
  Stack,
  VisuallyHidden,
} from "@mantine/core";
import { useSubAgentRenderCounter } from "@/lib/sub-agent-profiler";

import type {
  ResearchChatSummary,
  ResearchFolder,
} from "@/lib/research-history";
import type { ChatHistorySearchResult } from "@/lib/chat-history-search";

export interface SearchChatsFn {
  (query: string, abortSignal?: AbortSignal): Promise<ChatHistorySearchResult[]>;
}

export interface ResearchSidebarProps {
  width?: string | number;
  folders: ResearchFolder[];
  activeFolderName: string | null;
  chats: ResearchChatSummary[];
  activeChatId: string | null;
  searchChats: SearchChatsFn;
  status: "loading" | "ready" | "error";
  chatsStatus: "idle" | "loading" | "ready" | "error";
  runningFolderNames?: string[];
  runningChatIds?: string[];
  attentionFolderNames?: string[];
  attentionChatIds?: string[];
  onNewChat: () => void;
  onSelectFolder: (folderName: string) => void;
  onNewResearchChat: (folderName: string) => void;
  onSelectChat: (folderName: string, chatId: string) => void;
  onRenameFolder: (oldFolderName: string, newFolderName: string) => Promise<void>;
  onDeleteFolder: (folderName: string) => Promise<void>;
}

export function ResearchSidebar({
  width = rem(280),
  folders,
  activeFolderName,
  chats,
  activeChatId,
  searchChats,
  status,
  chatsStatus,
  runningFolderNames = [],
  runningChatIds = [],
  attentionFolderNames = [],
  attentionChatIds = [],
  onNewChat,
  onSelectFolder,
  onNewResearchChat,
  onSelectChat,
  onRenameFolder,
  onDeleteFolder,
}: ResearchSidebarProps) {
  useSubAgentRenderCounter("ResearchSidebar");

  const [renameTarget, setRenameTarget] = useState<ResearchFolder | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ResearchFolder | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ChatHistorySearchResult[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);

  function openRenameDialog(folder: ResearchFolder) {
    if (runningFolderNames.includes(folder.name)) return;

    setActionError(null);
    setRenameValue(folder.name);
    setRenameTarget(folder);
  }

  async function handleRename(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!renameTarget) return;

    const nextName = renameValue.trim();
    if (!nextName) {
      setActionError("Enter a folder name.");
      return;
    }

    if (
      nextName.includes("/") ||
      nextName.includes("\\") ||
      nextName === "." ||
      nextName === ".."
    ) {
      setActionError('Folder names cannot include slashes or be "." or "..".');
      return;
    }

    if (nextName === renameTarget.name) {
      setRenameTarget(null);
      return;
    }

    setPendingAction(true);
    setActionError(null);

    try {
      await onRenameFolder(renameTarget.name, nextName);
      setRenameTarget(null);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Could not rename search.",
      );
    } finally {
      setPendingAction(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;

    setPendingAction(true);
    setActionError(null);

    try {
      await onDeleteFolder(deleteTarget.name);
      setDeleteTarget(null);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Could not delete search.",
      );
    } finally {
      setPendingAction(false);
    }
  }

  useEffect(() => {
    const query = searchQuery.trim();
    searchAbortRef.current?.abort();

    if (!query) {
      searchAbortRef.current = null;
      return;
    }

    const controller = new AbortController();
    searchAbortRef.current = controller;
    const timeout = window.setTimeout(() => {
      void searchChats(query, controller.signal)
        .then((results) => {
          if (!controller.signal.aborted) {
            setSearchResults(results);
          }
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) {
            setSearchResults([]);
            setSearchError(
              error instanceof Error ? error.message : "Could not search chat history.",
            );
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setSearchLoading(false);
          }
        });
    }, 200);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [searchChats, searchQuery]);

  function clearSearch() {
    searchAbortRef.current?.abort();
    setSearchQuery("");
    setSearchResults(null);
    setSearchLoading(false);
    setSearchError(null);
  }

  function handleSearchInputChange(value: string) {
    setSearchQuery(value);
    if (value.trim()) {
      setSearchResults(null);
      setSearchLoading(true);
      setSearchError(null);
    } else {
      setSearchResults(null);
      setSearchLoading(false);
      setSearchError(null);
    }
  }

  async function handleRevealInFinder(folderName: string) {
    try {
      const dir = await appDataDir();
      const folderPath = await join(dir, "search-results", folderName);
      await openPath(folderPath);
    } catch (error) {
      // Reveal-in-Finder is invoked from a context menu and the result is
      // discarded with `void` at the call site — without this catch, any
      // rejection becomes an unhandled promise rejection that the user never
      // sees. Log enough context to diagnose (which folder, which step).
      const step = error instanceof Error ? error.message : String(error);
      console.error(
        "[research-sidebar] Failed to reveal research folder in Finder",
        { folderName, error: step },
      );
    }
  }

  const matchedChats = searchResults ?? [];
  const runningFolderSet = new Set(runningFolderNames);
  const runningChatIdSet = new Set(runningChatIds);
  const attentionFolderSet = new Set(attentionFolderNames);
  const attentionChatIdSet = new Set(attentionChatIds);

  const showSearchResults = searchQuery.trim().length > 0;

  return (
    <>
      <Box
        component="nav"
        data-testid="research-sidebar"
        aria-label="Research navigation"
        aria-keyshortcuts="Ctrl+Tab Ctrl+Shift+Tab"
        className="md-flex-col md-divider-right"
        style={{ width, flexShrink: 0, background: "var(--mantine-color-body)" }}
      >
        <Box p="sm" className="md-divider-bottom">
          <Button
            fullWidth
            variant="light"
            styles={{ inner: { justifyContent: "flex-start" } }}
            leftSection={<PlusIcon size={16} />}
            onClick={onNewChat}
          >
            New chat
          </Button>
        </Box>

        <Box p="sm" pb="xs" className="md-divider-bottom">
          <form onSubmit={(event) => event.preventDefault()} style={{ position: "relative" }}>
            <TextInput
              aria-label="Search chat history"
              value={searchQuery}
              onChange={(e) => handleSearchInputChange(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") clearSearch();
              }}
              placeholder="Search chat history"
              size="xs"
              leftSection={<SearchIcon size={14} />}
              rightSection={
                searchQuery ? (
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="gray"
                    aria-label="Clear chat search"
                    onClick={clearSearch}
                  >
                    <XIcon size={14} />
                  </ActionIcon>
                ) : null
              }
              styles={{ input: { height: 32, fontSize: 12 } }}
            />
          </form>
        </Box>

        {showSearchResults ? (
          <ScrollArea
            className="md-flex-fill"
            p="xs"
            type="scroll"
            scrollbars="y"
            scrollHideDelay={400}
            scrollbarSize={6}
          >
            {searchLoading ? (
              <Group justify="center" py="md">
                <Loader size="sm" type="dots" />
              </Group>
            ) : searchError ? (
              <Text role="alert" size="sm" c="red" px="xs" py="xs">
                Search failed. Try again.
              </Text>
            ) : matchedChats.length > 0 ? (
              <>
                <Text size="xs" fw={500} tt="uppercase" c="dimmed" px="xs" pb="xs">
                  {matchedChats.length} chat{matchedChats.length === 1 ? "" : "s"} matched
                </Text>
                <Stack gap={4}>
                  {matchedChats.map((result) => {
                    const isRunning = runningChatIdSet.has(result.chatId);
                    const needsAttention = attentionChatIdSet.has(result.chatId);
                    return (
                    <Button
                      key={`${result.folderName}\u0000${result.chatId}`}
                      variant="subtle"
                      fullWidth
                      color="gray"
                      styles={{
                        inner: { justifyContent: "flex-start", alignItems: "flex-start" },
                        root: { minHeight: 36, height: "auto" },
                      }}
                      classNames={{
                        root: chatButtonClassName(needsAttention),
                      }}
                      onClick={() => onSelectChat(result.folderName, result.chatId)}
                      leftSection={<MessageSquareIcon size={16} style={{ marginTop: 2 }} />}
                      rightSection={
                        <ResearchStatusIndicator
                          running={isRunning}
                          needsAttention={needsAttention}
                          label={result.title}
                          style={{ marginTop: 2 }}
                        />
                      }
                    >
                      <Box style={{ minWidth: 0, flex: 1, textAlign: "left" }}>
                        <Text size="xs" truncate lh={1.4}>{result.title}</Text>
                        <Text size="xs" fz={11} c="dimmed" truncate lh={1.4} mt={1}>
                          {result.folderName}
                        </Text>
                        {result.matchedText !== result.title && (
                          <Text size="xs" fz={11} c="dimmed" lineClamp={2} lh={1.4} mt={1}>
                            {result.matchedText}
                          </Text>
                        )}
                        {result.updatedAt && (
                          <Text size="xs" fz={11} c="dimmed" lh={1.4} mt={1}>
                            {formatChatTimestamp(result.updatedAt)}
                          </Text>
                        )}
                      </Box>
                    </Button>
                    );
                  })}
                </Stack>
              </>
            ) : (
              <Text size="sm" c="dimmed" px="xs" py="xs">
                No results found
              </Text>
            )}
          </ScrollArea>
        ) : (
          <ScrollArea
            className="md-flex-fill"
            p="xs"
            type="scroll"
            scrollbars="y"
            scrollHideDelay={400}
            scrollbarSize={6}
          >
            <Text size="xs" fw={500} tt="uppercase" c="dimmed" px="xs" pb="xs">
              Previous Searches
            </Text>

            {status === "loading" && folders.length === 0 && (
              <Stack gap="xs" px="xs" py="xs" role="status" aria-label="Loading research folders">
                <Skeleton h={30} radius="md" />
                <Skeleton h={30} radius="md" />
                <Skeleton h={30} radius="md" />
              </Stack>
            )}

            {status === "error" && folders.length === 0 && (
              <Text size="sm" c="red" px="xs" py="xs">Could not load searches.</Text>
            )}

            {status === "ready" && folders.length === 0 && (
              <Text size="sm" c="dimmed" px="xs" py="xs">No searches yet</Text>
            )}

            {folders.length > 0 && (
              <Stack gap={4}>
                {folders.map((folder) => {
                  const active = folder.name === activeFolderName;
                  const folderRunning = runningFolderSet.has(folder.name);
                  const folderNeedsAttention = attentionFolderSet.has(folder.name);
                  return (
                    <Box key={folder.name}>
                      <Button
                        variant={active ? "light" : "subtle"}
                        color={active ? "blue" : "gray"}
                        fullWidth
                        styles={{
                          inner: { justifyContent: "flex-start" },
                          root: { minHeight: 30, height: "auto" },
                        }}
                        classNames={{
                          root: folderButtonClassName(
                            active,
                            folderNeedsAttention,
                          ),
                        }}
                        aria-current={active ? "page" : undefined}
                        aria-keyshortcuts="Shift+F10"
                        onClick={() => onSelectFolder(folder.name)}
                        onKeyDown={(event: ReactKeyboardEvent<HTMLButtonElement>) => {
                          if (!(event.shiftKey && event.key === "F10")) return;
                          event.preventDefault();
                          const rect = event.currentTarget.getBoundingClientRect();
                          setContextMenu({
                            folder,
                            x: rect.left + 16,
                            y: rect.bottom,
                            trigger: event.currentTarget,
                          });
                        }}
                        onContextMenu={(event: ReactMouseEvent<HTMLButtonElement>) => {
                          event.preventDefault();
                          setContextMenu({
                            folder,
                            x: event.clientX,
                            y: event.clientY,
                            trigger: event.currentTarget,
                          });
                        }}
                        title={folder.name}
                        leftSection={<FolderIcon size={16} />}
                        rightSection={
                          <ResearchStatusIndicator
                            running={folderRunning}
                            needsAttention={folderNeedsAttention}
                            label={folder.name}
                          />
                        }
                      >
                        {folder.name}
                      </Button>
                      {active && (
                        <ResearchChatList
                          folderName={folder.name}
                          chats={chats}
                          activeChatId={activeChatId}
                          status={chatsStatus}
                          runningChatIds={runningChatIdSet}
                          attentionChatIds={attentionChatIdSet}
                          onNewChat={onNewResearchChat}
                          onSelectChat={onSelectChat}
                        />
                      )}
                    </Box>
                  );
                })}
              </Stack>
            )}
          </ScrollArea>
        )}
      </Box>

      <Modal
        opened={!!renameTarget}
        onClose={() => setRenameTarget(null)}
        title="Rename Search"
        size="sm"
      >
        <form onSubmit={handleRename}>
          <TextInput
            label="Folder Name"
            value={renameValue}
            onChange={(e) => setRenameValue(e.currentTarget.value)}
            error={actionError}
            autoFocus
          />
          <Group justify="flex-end" mt="md">
            <Button variant="outline" onClick={() => setRenameTarget(null)}>
              Cancel
            </Button>
            <Button type="submit" loading={pendingAction}>
              Rename
            </Button>
          </Group>
        </form>
      </Modal>

      <Modal
        opened={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Search"
        size="sm"
      >
        <Text size="sm">
          Delete {deleteTarget?.name ?? "this search"} and all files in its
          research folder. This cannot be undone.
        </Text>
        {actionError && (
          <Text role="alert" size="sm" c="red" mt="xs">{actionError}</Text>
        )}
        <Group justify="flex-end" mt="md">
          <Button variant="outline" size="sm" onClick={() => setDeleteTarget(null)}>
            Cancel
          </Button>
          <Button
            color="red"
            size="sm"
            loading={pendingAction}
            onClick={() => void handleDelete()}
          >
            Delete
          </Button>
        </Group>
      </Modal>

      {contextMenu && (
        <FolderContextMenu
          state={contextMenu}
          onClose={() => {
            if (contextMenu.trigger.isConnected) {
              contextMenu.trigger.focus();
            }
            setContextMenu(null);
          }}
          folderRunning={runningFolderSet.has(contextMenu.folder.name)}
          onRename={() => openRenameDialog(contextMenu.folder)}
          onDelete={() => {
            setActionError(null);
            setDeleteTarget(contextMenu.folder);
          }}
          onRevealInFinder={() => void handleRevealInFinder(contextMenu.folder.name)}
        />
      )}
    </>
  );
}

interface ResearchChatListProps {
  folderName: string;
  chats: ResearchChatSummary[];
  activeChatId: string | null;
  status: "idle" | "loading" | "ready" | "error";
  runningChatIds: Set<string>;
  attentionChatIds: Set<string>;
  onNewChat: (folderName: string) => void;
  onSelectChat: (folderName: string, chatId: string) => void;
}

function ResearchChatList({
  folderName,
  chats,
  activeChatId,
  status,
  runningChatIds,
  attentionChatIds,
  onNewChat,
  onSelectChat,
}: ResearchChatListProps) {
  return (
    <Box ml={24} mt={4} pb="xs">
      <Button
        variant="subtle"
        color="gray"
        aria-label={`New chat in ${folderName}`}
        fullWidth
        size="xs"
        styles={{
          inner: { justifyContent: "flex-start" },
          root: { minHeight: 32, height: "auto" },
        }}
        onClick={() => onNewChat(folderName)}
        leftSection={<PlusIcon size={14} />}
      >
        New chat
      </Button>

      <Text size="xs" fz={11} lh={1.4} fw={500} tt="uppercase" c="dimmed" px={8} pt={4} pb={1}>
        Previous Chats
      </Text>

      {status === "loading" && chats.length === 0 && (
        <Group gap="xs" px={8} py={6}>
          <LoaderIcon size={14} style={{ animation: "spin 1s linear infinite" }} />
          <Text size="xs" c="dimmed">Loading chats...</Text>
        </Group>
      )}

      {status === "error" && chats.length === 0 && (
        <Text size="xs" c="red" px={8} py={6}>Could not load chats.</Text>
      )}

      {chats.length === 0 && (status === "ready" || status === "idle") && (
        <Text size="xs" c="dimmed" px={8} py={6}>No saved chats</Text>
      )}

      {chats.length > 0 &&
        chats.map((chat) => {
          const active = chat.id === activeChatId;
          const chatRunning = runningChatIds.has(chat.id);
          const chatNeedsAttention = attentionChatIds.has(chat.id);

          return (
            <Button
              key={chat.id}
              variant={active ? "light" : "subtle"}
              color={active ? "blue" : "gray"}
              fullWidth
              styles={{
                inner: { justifyContent: "flex-start", alignItems: "flex-start" },
                root: { minHeight: 28, height: "auto", padding: "3px 8px" },
              }}
              classNames={{
                root: chatButtonClassName(chatNeedsAttention),
              }}
              aria-current={active ? "page" : undefined}
              onClick={() => onSelectChat(folderName, chat.id)}
              title={chat.title}
              leftSection={<MessageSquareIcon size={14} style={{ marginTop: 2 }} />}
              rightSection={
                <ResearchStatusIndicator
                  running={chatRunning}
                  needsAttention={chatNeedsAttention}
                  label={chat.title}
                  style={{ marginTop: 2 }}
                />
              }
            >
              <Box style={{ minWidth: 0, flex: 1 }}>
                <Text size="xs" truncate lh={1.4}>{chat.title}</Text>
                <Text size="xs" fz={11} c="dimmed" lh={1.4} mt={1}>
                  {formatChatTimestamp(chat.updatedAt ?? chat.createdAt)}
                </Text>
              </Box>
            </Button>
          );
        })}
    </Box>
  );
}

function folderButtonClassName(active: boolean, needsAttention: boolean) {
  return [
    active ? "md-code-bg" : null,
    needsAttention ? "md-sidebar-attention" : null,
  ]
    .filter(Boolean)
    .join(" ");
}

function chatButtonClassName(needsAttention: boolean) {
  return needsAttention ? "md-sidebar-attention" : undefined;
}

function ResearchStatusIndicator({
  running,
  needsAttention,
  label,
  style,
}: {
  running: boolean;
  needsAttention: boolean;
  label: string;
  style?: CSSProperties;
}) {
  if (needsAttention) {
    return (
      <span
        className="md-sidebar-attention-icon"
        title="Question waiting"
        style={style}
      >
        <MessageCircleQuestionIcon size={13} />
        <VisuallyHidden>
          Question waiting in {label}
        </VisuallyHidden>
      </span>
    );
  }

  if (running) {
    return (
      <span title="Research running" style={style}>
        <LoaderIcon size={12} style={{ animation: "spin 1s linear infinite" }} />
        <VisuallyHidden>
          Research running in {label}
        </VisuallyHidden>
      </span>
    );
  }

  return null;
}

// Hoisted singleton — constructing Intl.DateTimeFormat is ~30μs per call
// (locale + ICU data load), versus ~1μs to reuse one. For a folder with N
// chats this is called N times per render of ResearchChatList.
const CHAT_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function formatChatTimestamp(value: string | null) {
  if (!value) {
    return "Legacy chat";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Saved chat";
  }

  return CHAT_TIMESTAMP_FORMATTER.format(date);
}

type ContextMenuState = {
  folder: ResearchFolder;
  x: number;
  y: number;
  trigger: HTMLButtonElement;
} | null;

function FolderContextMenu({
  state,
  onClose,
  folderRunning,
  onRename,
  onDelete,
  onRevealInFinder,
}: {
  state: NonNullable<ContextMenuState>;
  onClose: () => void;
  folderRunning: boolean;
  onRename: () => void;
  onDelete: () => void;
  onRevealInFinder: () => void;
}) {
  return (
    <Menu
      opened
      onChange={(o) => { if (!o) onClose(); }}
      position="bottom-start"
      shadow="sm"
    >
      <Menu.Target>
        <div
          style={{
            position: "fixed",
            left: state.x,
            top: state.y,
            width: 0,
            height: 0,
            pointerEvents: "none",
          }}
        />
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item
          disabled={folderRunning}
          leftSection={<PencilIcon size={16} />}
          onClick={() => { onRename(); onClose(); }}
        >
          Rename
        </Menu.Item>
        <Menu.Item
          disabled={folderRunning}
          color="red"
          leftSection={<Trash2Icon size={16} />}
          onClick={() => { onDelete(); onClose(); }}
        >
          Delete
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item
          leftSection={<FolderOpenIcon size={16} />}
          onClick={() => { onRevealInFinder(); onClose(); }}
        >
          Open in Finder
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
