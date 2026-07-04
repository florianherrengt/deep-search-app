import {
  compareResearchFolders,
  type ResearchFolder,
} from "@/lib/research-history";

export function mergeResearchFoldersWithCurrent(
  folders: ResearchFolder[],
  currentFolders: ResearchFolder[],
) {
  return folders
    .map((folder) => {
      const currentFolder = currentFolders.find(
        (candidate) => candidate.name === folder.name,
      );
      const updatedAt = newestTimestamp(
        folder.updatedAt,
        currentFolder?.updatedAt,
      );

      if (updatedAt !== folder.updatedAt) {
        return { ...folder, updatedAt };
      }

      return folder;
    })
    .sort(compareResearchFolders);
}

export function upsertRecentResearchFolder(
  folders: ResearchFolder[],
  folderName: string,
) {
  const updatedAt = new Date().toISOString();
  const exists = folders.some((folder) => folder.name === folderName);
  const nextFolders = exists
    ? folders.map((folder) =>
        folder.name === folderName ? { ...folder, updatedAt } : folder,
      )
    : [...folders, { name: folderName, updatedAt }];

  return nextFolders.sort(compareResearchFolders);
}

function newestTimestamp(
  left?: string | null,
  right?: string | null,
) {
  return sortableTimestamp(right) > sortableTimestamp(left) ? right : left;
}

function sortableTimestamp(value?: string | null) {
  if (!value) return 0;

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}
