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

export async function readAppFile(
  input: ReadAppFileInput,
): Promise<string | null> {
  const parsed = ReadAppFileInputSchema.parse(input);
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

export async function deleteAppSubfolder(
  input: DeleteAppSubfolderInput,
): Promise<void> {
  const parsed = DeleteAppSubfolderInputSchema.parse(input);

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
}

export async function renameAppSubfolder(
  input: RenameAppSubfolderInput,
): Promise<void> {
  const parsed = RenameAppSubfolderInputSchema.parse(input);

  if (parsed.oldSubfolder === parsed.newSubfolder) {
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
}
