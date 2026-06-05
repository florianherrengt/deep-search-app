import { z } from "zod";
import {
  BaseDirectory,
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  rename,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { emitResearchLibraryChanged } from "@/lib/research-library-events";

interface AppFileStorageMock {
  writeAppFile?: (input: WriteAppFileInput) => Promise<void>;
  readAppFile?: (input: ReadAppFileInput) => Promise<string | null>;
  listAppSubfolders?: (input: ListAppSubfoldersInput) => Promise<string[]>;
  listAppFiles?: (input: ListAppFilesInput) => Promise<string[]>;
  deleteAppFile?: (input: ReadAppFileInput) => Promise<void>;
  renameAppFile?: (input: { subfolder: string; oldFilename: string; newFilename: string }) => Promise<void>;
  deleteAppSubfolder?: (input: DeleteAppSubfolderInput) => Promise<void>;
  renameAppSubfolder?: (input: RenameAppSubfolderInput) => Promise<void>;
}

declare global {
  interface Window {
    __deepSearchAppFileStorageMock?: AppFileStorageMock;
  }
}

export const SafePathSegmentSchema = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => !value.includes("/"), {
    message: 'Path segment must not contain "/"',
  })
  .refine((value) => !value.includes("\\"), {
    message: 'Path segment must not contain "\\"',
  })
  .refine((value) => value !== "." && value !== "..", {
    message: 'Path segment must not be "." or ".."',
  });

export const SafeSubfolderSchema = z
  .string()
  .min(1)
  .max(512)
  .superRefine((value, ctx) => {
    const segments = value.split("/");

    if (segments.length > 4) {
      ctx.addIssue({
        code: "custom",
        message: "Subfolder must not be more than 4 segments deep",
      });
    }

    for (const segment of segments) {
      const parsed = SafePathSegmentSchema.safeParse(segment);
      if (!parsed.success) {
        ctx.addIssue({
          code: "custom",
          message: "Subfolder must contain only safe path segments",
        });
        return;
      }
    }
  });

export const WriteAppFileInputSchema = z.object({
  subfolder: SafeSubfolderSchema,
  filename: SafePathSegmentSchema,
  content: z.string(),
});

export const ReadAppFileInputSchema = z.object({
  subfolder: SafeSubfolderSchema,
  filename: SafePathSegmentSchema,
});

export const ListAppSubfoldersInputSchema = z.object({
  subfolder: SafeSubfolderSchema,
});

export const ListAppFilesInputSchema = z.object({
  subfolder: SafeSubfolderSchema,
});

export const DeleteAppSubfolderInputSchema = z.object({
  subfolder: SafeSubfolderSchema,
});

export const RenameAppSubfolderInputSchema = z.object({
  oldSubfolder: SafeSubfolderSchema,
  newSubfolder: SafeSubfolderSchema,
});

export type WriteAppFileInput = z.infer<typeof WriteAppFileInputSchema>;
export type ReadAppFileInput = z.infer<typeof ReadAppFileInputSchema>;
export type ListAppSubfoldersInput = z.infer<
  typeof ListAppSubfoldersInputSchema
>;
export type ListAppFilesInput = z.infer<typeof ListAppFilesInputSchema>;
export type DeleteAppSubfolderInput = z.infer<
  typeof DeleteAppSubfolderInputSchema
>;
export type RenameAppSubfolderInput = z.infer<
  typeof RenameAppSubfolderInputSchema
>;

export async function writeAppFile(input: WriteAppFileInput): Promise<void> {
  const parsed = WriteAppFileInputSchema.parse(input);
  const mock = getDevAppFileStorageMock();

  if (mock?.writeAppFile) {
    await mock.writeAppFile(parsed);
  } else {
    await mkdir(parsed.subfolder, {
      baseDir: BaseDirectory.AppData,
      recursive: true,
    });

    await writeTextFile(
      `${parsed.subfolder}/${parsed.filename}`,
      parsed.content,
      {
        baseDir: BaseDirectory.AppData,
      },
    );
  }

  const folderName = researchFolderNameFromSubfolder(parsed.subfolder);
  if (folderName) {
    emitResearchLibraryChanged({ changeType: "write", folderName });
  }
}

export async function readAppFile(
  input: ReadAppFileInput,
): Promise<string | null> {
  const parsed = ReadAppFileInputSchema.parse(input);
  const mock = getDevAppFileStorageMock();
  if (mock?.readAppFile) {
    return mock.readAppFile(parsed);
  }

  const path = `${parsed.subfolder}/${parsed.filename}`;

  const fileExists = await exists(path, {
    baseDir: BaseDirectory.AppData,
  });

  if (!fileExists) {
    return null;
  }

  return readTextFile(path, {
    baseDir: BaseDirectory.AppData,
  });
}

export async function listAppSubfolders(
  input: ListAppSubfoldersInput,
): Promise<string[]> {
  const parsed = ListAppSubfoldersInputSchema.parse(input);
  const mock = getDevAppFileStorageMock();
  if (mock?.listAppSubfolders) {
    return mock.listAppSubfolders(parsed);
  }

  const folderExists = await exists(parsed.subfolder, {
    baseDir: BaseDirectory.AppData,
  });

  if (!folderExists) {
    return [];
  }

  const entries = await readDir(parsed.subfolder, {
    baseDir: BaseDirectory.AppData,
  });

  return entries
    .filter(
      (entry) =>
        entry.isDirectory && SafePathSegmentSchema.safeParse(entry.name).success,
    )
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

export async function listAppFiles(input: ListAppFilesInput): Promise<string[]> {
  const parsed = ListAppFilesInputSchema.parse(input);
  const mock = getDevAppFileStorageMock();
  if (mock?.listAppFiles) {
    return mock.listAppFiles(parsed);
  }

  const folderExists = await exists(parsed.subfolder, {
    baseDir: BaseDirectory.AppData,
  });

  if (!folderExists) {
    return [];
  }

  const entries = await readDir(parsed.subfolder, {
    baseDir: BaseDirectory.AppData,
  });

  return entries
    .filter(
      (entry) =>
        entry.isFile && SafePathSegmentSchema.safeParse(entry.name).success,
    )
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

export async function deleteAppFile(
  input: ReadAppFileInput,
): Promise<void> {
  const parsed = ReadAppFileInputSchema.parse(input);
  const mock = getDevAppFileStorageMock();

  if (mock?.deleteAppSubfolder) {
    await mock.deleteAppSubfolder({ subfolder: parsed.subfolder });
    return;
  }

  const path = `${parsed.subfolder}/${parsed.filename}`;
  const fileExists = await exists(path, {
    baseDir: BaseDirectory.AppData,
  });

  if (!fileExists) {
    return;
  }

  await remove(path, {
    baseDir: BaseDirectory.AppData,
  });
}

export async function renameAppFile(
  input: { subfolder: string; oldFilename: string; newFilename: string },
): Promise<void> {
  const validatedSubfolder = SafeSubfolderSchema.parse(input.subfolder);
  const validatedOld = SafePathSegmentSchema.parse(input.oldFilename);
  const validatedNew = SafePathSegmentSchema.parse(input.newFilename);

  if (validatedOld === validatedNew) {
    return;
  }

  const oldPath = `${validatedSubfolder}/${validatedOld}`;
  const newPath = `${validatedSubfolder}/${validatedNew}`;

  const newExists = await exists(newPath, {
    baseDir: BaseDirectory.AppData,
  });

  if (newExists) {
    throw new Error(`A file named "${validatedNew}" already exists.`);
  }

  await rename(oldPath, newPath, {
    oldPathBaseDir: BaseDirectory.AppData,
    newPathBaseDir: BaseDirectory.AppData,
  });
}

export async function deleteAppSubfolder(
  input: DeleteAppSubfolderInput,
): Promise<void> {
  const parsed = DeleteAppSubfolderInputSchema.parse(input);
  const mock = getDevAppFileStorageMock();

  if (mock?.deleteAppSubfolder) {
    await mock.deleteAppSubfolder(parsed);

    const folderName = researchFolderNameFromSubfolder(parsed.subfolder);
    if (folderName) {
      emitResearchLibraryChanged({ changeType: "delete", folderName });
    }

    return;
  }

  const folderExists = await exists(parsed.subfolder, {
    baseDir: BaseDirectory.AppData,
  });

  if (!folderExists) {
    return;
  }

  await remove(parsed.subfolder, {
    baseDir: BaseDirectory.AppData,
    recursive: true,
  });

  const folderName = researchFolderNameFromSubfolder(parsed.subfolder);
  if (folderName) {
    emitResearchLibraryChanged({ changeType: "delete", folderName });
  }
}

export async function renameAppSubfolder(
  input: RenameAppSubfolderInput,
): Promise<void> {
  const parsed = RenameAppSubfolderInputSchema.parse(input);

  if (parsed.oldSubfolder === parsed.newSubfolder) {
    return;
  }

  const mock = getDevAppFileStorageMock();
  if (mock?.renameAppSubfolder) {
    await mock.renameAppSubfolder(parsed);
    emitResearchFolderRename(parsed.oldSubfolder, parsed.newSubfolder);
    return;
  }

  const targetExists = await exists(parsed.newSubfolder, {
    baseDir: BaseDirectory.AppData,
  });

  if (targetExists) {
    throw new Error("A folder with that name already exists.");
  }

  await rename(parsed.oldSubfolder, parsed.newSubfolder, {
    oldPathBaseDir: BaseDirectory.AppData,
    newPathBaseDir: BaseDirectory.AppData,
  });

  emitResearchFolderRename(parsed.oldSubfolder, parsed.newSubfolder);
}

function emitResearchFolderRename(oldSubfolder: string, newSubfolder: string) {
  const folderName = researchFolderNameFromSubfolder(newSubfolder);
  if (folderName) {
    const previousFolderName = researchFolderNameFromSubfolder(oldSubfolder);
    emitResearchLibraryChanged({
      changeType: "rename",
      folderName,
      ...(previousFolderName ? { previousFolderName } : {}),
    });
  }
}

function researchFolderNameFromSubfolder(subfolder: string): string | null {
  const [root, folderName] = subfolder.split("/");
  return root === "search-results" && folderName ? folderName : null;
}

function getDevAppFileStorageMock(): AppFileStorageMock | null {
  if (!import.meta.env.DEV || typeof window === "undefined") {
    return null;
  }

  return window.__deepSearchAppFileStorageMock ?? null;
}
