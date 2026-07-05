import {
  createAppSubfolder,
  deleteAppFile,
  listAppFiles,
  listAppSubfolders,
  readAppFile,
  renameAppFile,
  writeAppFile,
} from "@/lib/app-file-storage";

type ArtifactStorageEntry = {
  name: string;
  type: "file" | "directory";
};

type ArtifactStorageAdapter = {
  readText(path: string): Promise<string | null>;
  writeText(path: string, content: string): Promise<void>;
  list(path: string): Promise<ArtifactStorageEntry[]>;
  remove(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  ensureDirectory(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
};

type ArtifactListEntry = {
  path: string;
  type: "file" | "directory";
};

type AppArtifactStore = {
  readText(relativePath: string): Promise<string | null>;
  writeText(
    relativePath: string,
    content: string,
    options?: { overwrite?: boolean },
  ): Promise<void>;
  list(): Promise<ArtifactListEntry[]>;
  remove(relativePath: string): Promise<void>;
  rename(
    from: string,
    to: string,
    options?: { overwrite?: boolean },
  ): Promise<void>;
};

export function createAppArtifactStorage(): ArtifactStorageAdapter {
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

export function createAppArtifactStore(root: string): AppArtifactStore {
  const storage = createAppArtifactStorage();

  function resolve(relativePath: string): string {
    const normalized = relativePath.trim().replace(/\\/g, "/").replace(/^\/+/g, "");
    if (!normalized || normalized.includes("/")) {
      throw new Error(`Expected artifact filename without folders: ${relativePath}`);
    }
    return `${root}/${normalized}`;
  }

  return {
    async readText(relativePath) {
      return storage.readText(resolve(relativePath));
    },
    async writeText(relativePath, content, options = {}) {
      const target = resolve(relativePath);
      if (options.overwrite === false && await storage.exists(target)) {
        throw new Error(`Artifact already exists: ${relativePath}`);
      }
      await storage.ensureDirectory(root);
      await storage.writeText(target, content);
    },
    async list() {
      const entries = await storage.list(root);
      return entries
        .filter((entry) => entry.type === "file" || entry.type === "directory")
        .map((entry) => ({
          path: entry.name,
          type: entry.type,
        }))
        .sort((a, b) => a.path.localeCompare(b.path));
    },
    async remove(relativePath) {
      await storage.remove(resolve(relativePath));
    },
    async rename(from, to, options = {}) {
      const target = resolve(to);
      if (options.overwrite === false && await storage.exists(target)) {
        throw new Error(`Artifact already exists: ${to}`);
      }
      if (options.overwrite === true && await storage.exists(target)) {
        await storage.remove(target);
      }
      await storage.rename(resolve(from), target);
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
