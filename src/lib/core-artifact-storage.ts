import type { ArtifactStorage } from "deep-search-core/research-orchestrator";
import {
  createAppSubfolder,
  deleteAppFile,
  listAppFiles,
  listAppSubfolders,
  readAppFile,
  renameAppFile,
  writeAppFile,
} from "@/lib/app-file-storage";

export function createAppArtifactStorage(): ArtifactStorage {
  return {
    async readText(path) {
      const { subfolder, filename } = splitStorageFilePath(path);
      return readAppFile({ subfolder, filename });
    },
    async writeText(path, content) {
      const { subfolder, filename } = splitStorageFilePath(path);
      await writeAppFile({ subfolder, filename, content });
    },
    async list(path) {
      const files = await listAppFiles({ subfolder: path }).catch(() => []);
      const folders = await listAppSubfolders({ subfolder: path }).catch(() => []);
      return [
        ...folders.map((name) => ({ name, type: "directory" as const })),
        ...files.map((name) => ({ name, type: "file" as const })),
      ].sort((a, b) => a.name.localeCompare(b.name));
    },
    async remove(path) {
      const { subfolder, filename } = splitStorageFilePath(path);
      await deleteAppFile({ subfolder, filename });
    },
    async rename(from, to) {
      const source = splitStorageFilePath(from);
      const target = splitStorageFilePath(to);
      if (source.subfolder !== target.subfolder) {
        throw new Error("Moving files between artifact subfolders is not supported by this storage adapter.");
      }
      await renameAppFile({
        subfolder: source.subfolder,
        oldFilename: source.filename,
        newFilename: target.filename,
      });
    },
    async ensureDirectory(path) {
      await createAppSubfolder({ subfolder: path });
    },
    async exists(path) {
      const { subfolder, filename } = splitStorageFilePath(path);
      return (await readAppFile({ subfolder, filename })) !== null;
    },
  };
}

function splitStorageFilePath(path: string): { subfolder: string; filename: string } {
  const normalized = path.trim().replace(/\\/g, "/").replace(/\/+$/g, "");
  const index = normalized.lastIndexOf("/");
  if (index <= 0 || index === normalized.length - 1) {
    throw new Error(`Expected storage file path with subfolder and filename: ${path}`);
  }
  return {
    subfolder: normalized.slice(0, index),
    filename: normalized.slice(index + 1),
  };
}
