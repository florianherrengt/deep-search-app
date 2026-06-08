import { useState, useCallback, type FormEvent, type MouseEvent as ReactMouseEvent } from "react";
import {
  FolderIcon,
  FolderOpenIcon,
  LoaderIcon,
  MessageSquareIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { appDataDir, join } from "@tauri-apps/api/path";
import { openPath } from "@tauri-apps/plugin-opener";
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
  Stack,
  VisuallyHidden,
} from "@mantine/core";

import type {
  ResearchChatSummary,
  ResearchFolder,
} from "@/lib/research-history";
import {
  searchResearch,
  type SearchResult,
  type EmbeddingConfig,
  type RerankerConfig,
} from "@/lib/research-search";

interface ResearchSidebarProps {
  folders: ResearchFolder[];
  activeFolderName: string | null;
  chats: ResearchChatSummary[];
  activeChatId: string | null;
  embeddingConfig: EmbeddingConfig;
  rerankerConfig: RerankerConfig;
  status: "loading" | "ready" | "error";
  chatsStatus: "idle" | "loading" | "ready" | "error";
  runningFolderNames?: string[];
  runningChatIds?: string[];
  onNewChat: () => void;
  onSelectFolder: (folderName: string) => void;
  onNewResearchChat: (folderName: string) => void;
  onSelectChat: (folderName: string, chatId: string) => void;
  onRenameFolder: (oldFolderName: string, newFolderName: string) => Promise<void>;
  onDeleteFolder: (folderName: string) => Promise<void>;
}

export function ResearchSidebar({
  folders,
  activeFolderName,
  chats,
  activeChatId,
  embeddingConfig,
  rerankerConfig,
  status,
  chatsStatus,
  runningFolderNames = [],
  runningChatIds = [],
  onNewChat,
  onSelectFolder,
  onNewResearchChat,
  onSelectChat,
  onRenameFolder,
  onDeleteFolder,
}: ResearchSidebarProps) {
  const [renameTarget, setRenameTarget] = useState<ResearchFolder | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ResearchFolder | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);

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

  const handleSearch = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const q = searchQuery.trim();
      if (!q) {
        setSearchResults(null);
        return;
      }
      setSearchLoading(true);
      setSearchResults(null);
      try {
        const results = await searchResearch(embeddingConfig, rerankerConfig, q, { limit: 10 });
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    },
    [embeddingConfig, rerankerConfig, searchQuery],
  );

  function clearSearch() {
    setSearchQuery("");
    setSearchResults(null);
    setSearchLoading(false);
  }

  function handleSearchInputChange(value: string) {
    setSearchQuery(value);
    if (!value.trim()) {
      setSearchResults(null);
      setSearchLoading(false);
    }
  }

  async function handleRevealInFinder(folderName: string) {
    const dir = await appDataDir();
    const folderPath = await join(dir, "search-results", folderName);
    await openPath(folderPath);
  }

  const matchedFolders =
    searchResults !== null
      ? Array.from(new Set(searchResults.map((r) => r.folder_name)))
      : [];
  const runningFolderSet = new Set(runningFolderNames);
  const runningChatIdSet = new Set(runningChatIds);

  const showSearchResults = searchLoading || searchResults !== null;

  return (
    <>
      <Box
        component="aside"
        data-testid="research-sidebar"
        className="md-flex-col md-divider-right"
        style={{ width: 256, flexShrink: 0 }}
      >
        <Box p="sm" className="md-divider-bottom">
          <Button
            fullWidth
            variant={activeFolderName ? "outline" : "light"}
            styles={{ inner: { justifyContent: "flex-start" } }}
            leftSection={<PlusIcon size={16} />}
            onClick={onNewChat}
          >
            New Chat
          </Button>
        </Box>

        <Box p="sm" pb="xs" className="md-divider-bottom">
          <form onSubmit={handleSearch} style={{ position: "relative" }}>
            <TextInput
              value={searchQuery}
              onChange={(e) => handleSearchInputChange(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") clearSearch();
              }}
              placeholder="Search research... ↵"
              size="xs"
              leftSection={<SearchIcon size={14} />}
              rightSection={
                searchQuery ? (
                  <ActionIcon size="xs" variant="subtle" color="gray" onClick={clearSearch}>
                    <XIcon size={14} />
                  </ActionIcon>
                ) : null
              }
              styles={{ input: { height: 32, fontSize: 12 } }}
            />
          </form>
        </Box>

        {showSearchResults ? (
          <ScrollArea className="md-flex-fill" p="xs">
            {searchLoading ? (
              <Group justify="center" py="md">
                <Loader size="sm" type="dots" />
              </Group>
            ) : matchedFolders.length > 0 ? (
              <>
                <Text size="xs" fw={500} tt="uppercase" c="dimmed" px="xs" pb="xs">
                  {matchedFolders.length} folder{matchedFolders.length === 1 ? "" : "s"} matched
                </Text>
                <Stack gap={4}>
                  {matchedFolders.map((name) => (
                    <Button
                      key={name}
                      variant="subtle"
                      fullWidth
                      color="gray"
                      styles={{
                        inner: { justifyContent: "flex-start" },
                        root: { minHeight: 36, height: "auto" },
                      }}
                      onClick={() => onSelectFolder(name)}
                      leftSection={<FolderIcon size={16} />}
                      rightSection={
                        runningFolderSet.has(name) ? (
                          <span title="Research running">
                            <LoaderIcon size={12} style={{ animation: "spin 1s linear infinite" }} />
                            <VisuallyHidden>
                              Research running in {name}
                            </VisuallyHidden>
                          </span>
                        ) : null
                      }
                    >
                      {name}
                    </Button>
                  ))}
                </Stack>
              </>
            ) : (
              <Text size="sm" c="dimmed" px="xs" py="xs">
                No results found
              </Text>
            )}
          </ScrollArea>
        ) : (
          <ScrollArea className="md-flex-fill" p="xs">
            <Text size="xs" fw={500} tt="uppercase" c="dimmed" px="xs" pb="xs">
              Previous Searches
            </Text>

            {status === "loading" && folders.length === 0 && (
              <Text size="sm" c="dimmed" px="xs" py="xs">Loading...</Text>
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
                  return (
                    <Box key={folder.name}>
                      <Button
                        variant="subtle"
                        color="gray"
                        fullWidth
                        styles={{
                          inner: { justifyContent: "flex-start" },
                          root: { minHeight: 30, height: "auto" },
                        }}
                        classNames={{ root: active ? "md-code-bg" : undefined }}
                        aria-current={active ? "page" : undefined}
                        onClick={() => onSelectFolder(folder.name)}
                        onContextMenu={(e: ReactMouseEvent) => {
                          e.preventDefault();
                          setContextMenu({ folder, x: e.clientX, y: e.clientY });
                        }}
                        title={folder.name}
                        leftSection={<FolderIcon size={16} />}
                        rightSection={
                          folderRunning ? (
                            <span title="Research running">
                              <LoaderIcon size={12} style={{ animation: "spin 1s linear infinite" }} />
                              <VisuallyHidden>
                                Research running in {folder.name}
                              </VisuallyHidden>
                            </span>
                          ) : null
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
            autoFocus
          />
          {actionError && (
            <Text size="sm" c="red" mt="xs">{actionError}</Text>
          )}
          <Group justify="flex-end" mt="md">
            <Button variant="outline" onClick={() => setRenameTarget(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pendingAction}>
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
          <Text size="sm" c="red" mt="xs">{actionError}</Text>
        )}
        <Group justify="flex-end" mt="md">
          <Button variant="outline" size="sm" onClick={() => setDeleteTarget(null)}>
            Cancel
          </Button>
          <Button
            color="red"
            size="sm"
            disabled={pendingAction}
            onClick={() => void handleDelete()}
          >
            Delete
          </Button>
        </Group>
      </Modal>

      {contextMenu && (
        <FolderContextMenu
          state={contextMenu}
          onClose={() => setContextMenu(null)}
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
  onNewChat: (folderName: string) => void;
  onSelectChat: (folderName: string, chatId: string) => void;
}

function ResearchChatList({
  folderName,
  chats,
  activeChatId,
  status,
  runningChatIds,
  onNewChat,
  onSelectChat,
}: ResearchChatListProps) {
  return (
    <Box ml={24} mt={4} pb="xs">
      <Button
        variant="subtle"
        color="gray"
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

          return (
            <Button
              key={chat.id}
              variant={active ? "light" : "subtle"}
              color="gray"
              fullWidth
              styles={{
                inner: { justifyContent: "flex-start", alignItems: "flex-start" },
                root: { minHeight: 28, height: "auto", padding: "3px 8px" },
              }}
              aria-current={active ? "page" : undefined}
              onClick={() => onSelectChat(folderName, chat.id)}
              title={chat.title}
              leftSection={<MessageSquareIcon size={14} style={{ marginTop: 2 }} />}
              rightSection={
                chatRunning ? (
                  <span title="Research running">
                    <LoaderIcon size={12} style={{ marginTop: 2, animation: "spin 1s linear infinite" }} />
                    <VisuallyHidden>
                      Research running in {chat.title}
                    </VisuallyHidden>
                  </span>
                ) : null
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

function formatChatTimestamp(value: string | null) {
  if (!value) {
    return "Legacy chat";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Saved chat";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

type ContextMenuState = {
  folder: ResearchFolder;
  x: number;
  y: number;
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
      shadow="md"
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
