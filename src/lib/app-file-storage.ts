import { z } from "zod";
import {
  exists as bridgeExists,
  mkdir as bridgeMkdir,
  readDir as bridgeReadDir,
  readTextFile as bridgeReadTextFile,
  remove as bridgeRemove,
  rename as bridgeRename,
  writeTextFile as bridgeWriteTextFile,
} from "@/lib/tauri-bridge";
import { emitResearchLibraryChanged } from "@/lib/research-library-events";


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

const WriteAppFileInputSchema = z.object({
  subfolder: SafeSubfolderSchema,
  filename: SafePathSegmentSchema,
  content: z.string(),
  emitChange: z.boolean().optional(),
});

const ReadAppFileInputSchema = z.object({
  subfolder: SafeSubfolderSchema,
  filename: SafePathSegmentSchema,
});

const ListAppSubfoldersInputSchema = z.object({
  subfolder: SafeSubfolderSchema,
});

const ListAppFilesInputSchema = z.object({
  subfolder: SafeSubfolderSchema,
});

const DeleteAppSubfolderInputSchema = z.object({
  subfolder: SafeSubfolderSchema,
});

const RenameAppSubfolderInputSchema = z.object({
  oldSubfolder: SafeSubfolderSchema,
  newSubfolder: SafeSubfolderSchema,
});

type WriteAppFileInput = z.infer<typeof WriteAppFileInputSchema>;
type ReadAppFileInput = z.infer<typeof ReadAppFileInputSchema>;
type ListAppSubfoldersInput = z.infer<
  typeof ListAppSubfoldersInputSchema
>;
type ListAppFilesInput = z.infer<typeof ListAppFilesInputSchema>;
type DeleteAppSubfolderInput = z.infer<
  typeof DeleteAppSubfolderInputSchema
>;
type RenameAppSubfolderInput = z.infer<
  typeof RenameAppSubfolderInputSchema
>;

export async function writeAppFile(input: WriteAppFileInput): Promise<void> {
  const parsed = WriteAppFileInputSchema.parse(input);

  await bridgeMkdir(parsed.subfolder, { recursive: true });

  await bridgeWriteTextFile(
    `${parsed.subfolder}/${parsed.filename}`,
    parsed.content,
  );

  if (parsed.emitChange !== false) {
    const folderName = researchFolderNameFromSubfolder(parsed.subfolder);
    if (folderName) {
      emitResearchLibraryChanged({ changeType: "write", folderName });
    }
  }
}

export async function readAppFile(
  input: ReadAppFileInput,
): Promise<string | null> {
  const parsed = ReadAppFileInputSchema.parse(input);

  const path = `${parsed.subfolder}/${parsed.filename}`;

  const fileExists = await bridgeExists(path);

  if (!fileExists) {
    return null;
  }

  return bridgeReadTextFile(path);
}

export async function listAppSubfolders(
  input: ListAppSubfoldersInput,
): Promise<string[]> {
  const parsed = ListAppSubfoldersInputSchema.parse(input);

  const folderExists = await bridgeExists(parsed.subfolder);

  if (!folderExists) {
    return [];
  }

  const entries = await bridgeReadDir(parsed.subfolder);

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

  const folderExists = await bridgeExists(parsed.subfolder);

  if (!folderExists) {
    return [];
  }

  const entries = await bridgeReadDir(parsed.subfolder);

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

  const path = `${parsed.subfolder}/${parsed.filename}`;
  const fileExists = await bridgeExists(path);

  if (!fileExists) {
    return;
  }

  await bridgeRemove(path);
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

  const newExists = await bridgeExists(newPath);

  if (newExists) {
    throw new Error(`A file named "${validatedNew}" already exists.`);
  }

  await bridgeRename(oldPath, newPath);
}

export async function deleteAppSubfolder(
  input: DeleteAppSubfolderInput,
): Promise<void> {
  const parsed = DeleteAppSubfolderInputSchema.parse(input);

  const folderExists = await bridgeExists(parsed.subfolder);

  if (!folderExists) {
    return;
  }

  await bridgeRemove(parsed.subfolder, { recursive: true });

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

  const targetExists = await bridgeExists(parsed.newSubfolder);

  if (targetExists) {
    throw new Error("A folder with that name already exists.");
  }

  await bridgeRename(parsed.oldSubfolder, parsed.newSubfolder);

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

