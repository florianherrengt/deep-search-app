import { useState, useCallback, type FormEvent } from "react";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
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
      <aside className="flex h-full w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="border-b border-sidebar-border p-3">
          <Button
            type="button"
            className="w-full justify-start"
            variant={activeFolderName ? "outline" : "secondary"}
            onClick={onNewChat}
          >
            <PlusIcon />
            New Chat
          </Button>
        </div>

        <div className="border-b border-sidebar-border p-3 pb-2">
          <form onSubmit={handleSearch} className="relative">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => handleSearchInputChange(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") clearSearch();
              }}
              placeholder="Search research... ↵"
              className="h-8 pl-8 pr-7 text-xs"
            />
            {searchQuery && (
              <button
                type="button"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={clearSearch}
              >
                <XIcon className="size-3.5" />
              </button>
            )}
          </form>
        </div>

        {showSearchResults ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {searchLoading ? (
              <div className="flex items-center justify-center py-4">
                <LoaderIcon className="size-4 animate-spin text-muted-foreground" />
              </div>
            ) : matchedFolders.length > 0 ? (
              <>
                <div className="px-2 pb-2 text-xs font-medium uppercase text-muted-foreground">
                  {matchedFolders.length} folder{matchedFolders.length === 1 ? "" : "s"} matched
                </div>
                <div className="space-y-1">
                  {matchedFolders.map((name) => (
                    <button
                      key={name}
                      type="button"
                      className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => onSelectFolder(name)}
                    >
                      <FolderIcon className="size-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{name}</span>
                      {runningFolderSet.has(name) && (
                        <span
                          className="shrink-0 text-muted-foreground"
                          title="Research running"
                        >
                          <LoaderIcon
                            className="size-3 animate-spin"
                            aria-hidden="true"
                          />
                          <span className="sr-only">
                            Research running in {name}
                          </span>
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="px-2 py-2 text-sm text-muted-foreground">
                No results found
              </div>
            )}
          </div>
        ) : (
          <nav
            aria-label="Previous searches"
            className="min-h-0 flex-1 overflow-y-auto p-2"
          >
            <div className="px-2 pb-2 text-xs font-medium uppercase text-muted-foreground">
              Previous Searches
            </div>

            {status === "loading" && folders.length === 0 && (
              <div className="px-2 py-2 text-sm text-muted-foreground">
                Loading...
              </div>
            )}

            {status === "error" && folders.length === 0 && (
              <div className="px-2 py-2 text-sm text-destructive">
                Could not load searches.
              </div>
            )}

            {status === "ready" && folders.length === 0 && (
              <div className="px-2 py-2 text-sm text-muted-foreground">
                No searches yet
              </div>
            )}

            {folders.length > 0 && (
              <div className="space-y-1">
                {folders.map((folder) => {
                  const active = folder.name === activeFolderName;
                  const folderRunning = runningFolderSet.has(folder.name);
                  return (
                    <div key={folder.name}>
                      <ContextMenu>
                        <ContextMenuTrigger asChild>
                          <div
                            className={cn(
                              "group flex min-h-9 items-center gap-1 rounded-md px-1 transition-colors",
                              "hover:bg-accent hover:text-accent-foreground",
                              active
                                ? "bg-secondary text-secondary-foreground"
                                : "text-sidebar-foreground",
                            )}
                          >
                            <button
                              type="button"
                              aria-current={active ? "page" : undefined}
                              className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              onClick={() => onSelectFolder(folder.name)}
                              title={folder.name}
                            >
                              <FolderIcon className="size-4 shrink-0" />
                              <span className="min-w-0 flex-1 truncate">
                                {folder.name}
                              </span>
                              {folderRunning && (
                                <span
                                  className="shrink-0 text-muted-foreground"
                                  title="Research running"
                                >
                                  <LoaderIcon
                                    className="size-3 animate-spin"
                                    aria-hidden="true"
                                  />
                                  <span className="sr-only">
                                    Research running in {folder.name}
                                  </span>
                                </span>
                              )}
                            </button>
                          </div>
                        </ContextMenuTrigger>
                        <ContextMenuContent>
                          <ContextMenuItem
                            disabled={folderRunning}
                            onSelect={() => openRenameDialog(folder)}
                          >
                            <PencilIcon className="size-4" />
                            Rename
                          </ContextMenuItem>
                          <ContextMenuItem
                            disabled={folderRunning}
                            className="text-destructive focus:text-destructive"
                            onSelect={() => {
                              setActionError(null);
                              setDeleteTarget(folder);
                            }}
                          >
                            <Trash2Icon className="size-4" />
                            Delete
                          </ContextMenuItem>
                          <ContextMenuSeparator />
                          <ContextMenuItem
                            onSelect={() =>
                              void handleRevealInFinder(folder.name)
                            }
                          >
                            <FolderOpenIcon className="size-4" />
                            Open in Finder
                          </ContextMenuItem>
                        </ContextMenuContent>
                      </ContextMenu>
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
                    </div>
                  );
                })}
              </div>
            )}
          </nav>
        )}
      </aside>

      <Dialog
        open={!!renameTarget}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Search</DialogTitle>
            <DialogDescription>
              Update the folder name used for this saved search.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleRename}>
            <div className="space-y-2">
              <Label htmlFor="research-folder-name">Folder Name</Label>
              <Input
                id="research-folder-name"
                value={renameValue}
                onChange={(e) => setRenameValue(e.currentTarget.value)}
                autoFocus
              />
            </div>
            {actionError && (
              <p className="text-sm text-destructive">{actionError}</p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRenameTarget(null)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pendingAction}>
                Rename
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>Delete Search</AlertDialogTitle>
          <AlertDialogDescription>
            Delete {deleteTarget?.name ?? "this search"} and all files in its
            research folder. This cannot be undone.
          </AlertDialogDescription>
          {actionError && (
            <p className="text-sm text-destructive">{actionError}</p>
          )}
          <div className="flex justify-end gap-2">
            <AlertDialogCancel asChild>
              <Button variant="outline" size="sm">
                Cancel
              </Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                variant="destructive"
                size="sm"
                disabled={pendingAction}
                onClick={(e) => {
                  e.preventDefault();
                  void handleDelete();
                }}
              >
                Delete
              </Button>
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
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
    <div className="ml-6 mt-1 space-y-1 pb-2">
      <button
        type="button"
        className="flex min-h-8 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => onNewChat(folderName)}
      >
        <PlusIcon className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">New chat</span>
      </button>

      <div className="px-2 pt-1 text-[11px] font-medium uppercase text-muted-foreground">
        Previous Chats
      </div>

      {status === "loading" && chats.length === 0 && (
        <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
          <LoaderIcon className="size-3.5 animate-spin" />
          Loading chats...
        </div>
      )}

      {status === "error" && chats.length === 0 && (
        <div className="px-2 py-1.5 text-xs text-destructive">
          Could not load chats.
        </div>
      )}

      {chats.length === 0 && (status === "ready" || status === "idle") && (
        <div className="px-2 py-1.5 text-xs text-muted-foreground">
          No saved chats
        </div>
      )}

      {chats.length > 0 &&
        chats.map((chat) => {
          const active = chat.id === activeChatId;
          const chatRunning = runningChatIds.has(chat.id);

          return (
            <button
              key={chat.id}
              type="button"
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-10 w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "bg-accent text-accent-foreground"
                  : "text-sidebar-foreground hover:bg-accent hover:text-accent-foreground",
              )}
              onClick={() => onSelectChat(folderName, chat.id)}
              title={chat.title}
            >
              <MessageSquareIcon className="mt-0.5 size-3.5 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs">{chat.title}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {formatChatTimestamp(chat.updatedAt ?? chat.createdAt)}
                </span>
              </span>
              {chatRunning && (
                <span
                  className="mt-0.5 shrink-0 text-muted-foreground"
                  title="Research running"
                >
                  <LoaderIcon
                    className="size-3 animate-spin"
                    aria-hidden="true"
                  />
                  <span className="sr-only">
                    Research running in {chat.title}
                  </span>
                </span>
              )}
            </button>
          );
        })}
    </div>
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
