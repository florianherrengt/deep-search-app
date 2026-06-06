import { tool, zodSchema } from "ai";
import { z } from "zod";
import { abortablePromise } from "@/lib/abort";
import {
  SafePathSegmentSchema,
  deleteAppFile,
  listAppFiles,
  readAppFile,
  renameAppFile,
  writeAppFile,
} from "@/lib/app-file-storage";
import { indexResearchFile, deleteResearchFileIndex, type EmbeddingConfig } from "@/lib/research-search";
import { SEARCH_RESULTS_SUBFOLDER } from "@/lib/research-history";

const FilenameField = SafePathSegmentSchema.describe(
  "File name, for example 'notes.md', 'sources.md', or 'queue.json'. Must not include folders.",
);

function subfolderFor(folder: string) {
  return `${SEARCH_RESULTS_SUBFOLDER}/${folder}`;
}

export const createFileInputSchema = z.object({
  filename: FilenameField,
  content: z.string().describe("Full file content to write."),
});

export const readFileInputSchema = z.object({
  filename: FilenameField,
});

export const updateFileInputSchema = z.object({
  filename: FilenameField,
  old_string: z.string().describe("Exact text to find in the file. Must be unique within the file."),
  new_string: z.string().describe("Replacement text."),
  replace_all: z.boolean().optional().describe("Replace all occurrences of old_string. Default: false."),
});

export const moveFileInputSchema = z.object({
  source: SafePathSegmentSchema.describe("Current file name."),
  destination: SafePathSegmentSchema.describe("New file name."),
});

export const deleteFileInputSchema = z.object({
  filename: FilenameField,
});

export function createCreateFileTool(
  getResearchFolder: () => Promise<string>,
  embeddingConfig?: EmbeddingConfig,
) {
  return tool({
    description:
      "Create a new file in the current research folder. Fails if the file already exists.",
    strict: true,
    inputSchema: zodSchema(createFileInputSchema),
    outputSchema: zodSchema(z.string()),
    execute: async ({ filename, content }, options) => {
      const folder = await getResearchFolder();
      const subfolder = subfolderFor(folder);

      const existing = await readAppFile({ subfolder, filename });
      if (existing !== null) {
        throw new Error(`File "${filename}" already exists. Use update_file to modify it.`);
      }

      await writeAppFile({ subfolder, filename, content });

      if (embeddingConfig) {
        await abortablePromise(
          indexResearchFile(embeddingConfig, folder, filename, content),
          options?.abortSignal,
        ).catch(() => {});
      }

      return "OK";
    },
  });
}

export function createReadFileTool(
  getResearchFolder: () => Promise<string>,
) {
  return tool({
    description:
      "Read a file from the current research folder. Returns the full file contents.",
    strict: true,
    inputSchema: zodSchema(readFileInputSchema),
    execute: async ({ filename }) => {
      const folder = await getResearchFolder();
      const subfolder = subfolderFor(folder);

      const content = await readAppFile({ subfolder, filename });

      if (content === null) {
        throw new Error(`File "${filename}" not found in research folder "${folder}".`);
      }

      return content;
    },
  });
}

export function createUpdateFileTool(
  getResearchFolder: () => Promise<string>,
  embeddingConfig?: EmbeddingConfig,
) {
  return tool({
    description:
      "Update a file in the current research folder using search-and-replace. Finds old_string in the file and replaces it with new_string. Fails if the file doesn't exist, old_string is not found, or old_string matches multiple times (unless replace_all is true).",
    strict: true,
    inputSchema: zodSchema(updateFileInputSchema),
    outputSchema: zodSchema(z.string()),
    execute: async ({ filename, old_string, new_string, replace_all }, options) => {
      const folder = await getResearchFolder();
      const subfolder = subfolderFor(folder);

      const content = await readAppFile({ subfolder, filename });
      if (content === null) {
        throw new Error(`File "${filename}" not found in research folder "${folder}".`);
      }

      if (!content.includes(old_string)) {
        throw new Error(
          `old_string not found in "${filename}". Make sure the string matches exactly, including whitespace and indentation.`,
        );
      }

      if (!replace_all) {
        const firstIndex = content.indexOf(old_string);
        const secondIndex = content.indexOf(old_string, firstIndex + 1);
        if (secondIndex !== -1) {
          throw new Error(
            `old_string found multiple times in "${filename}". Provide more surrounding context to make it unique, or set replace_all to true.`,
          );
        }
      }

      const newContent = replace_all
        ? content.split(old_string).join(new_string)
        : content.replace(old_string, new_string);

      await writeAppFile({ subfolder, filename, content: newContent });

      if (embeddingConfig) {
        await abortablePromise(
          indexResearchFile(embeddingConfig, folder, filename, newContent),
          options?.abortSignal,
        ).catch(() => {});
      }

      return "OK";
    },
  });
}

export function createMoveFileTool(
  getResearchFolder: () => Promise<string>,
  embeddingConfig?: EmbeddingConfig,
) {
  return tool({
    description:
      "Rename a file in the current research folder. Fails if the source doesn't exist or the destination already exists.",
    strict: true,
    inputSchema: zodSchema(moveFileInputSchema),
    outputSchema: zodSchema(z.string()),
    execute: async ({ source, destination }, options) => {
      if (source === destination) {
        return "OK";
      }

      const folder = await getResearchFolder();
      const subfolder = subfolderFor(folder);

      await abortablePromise(
        deleteResearchFileIndex(folder, source),
        options?.abortSignal,
      ).catch(() => {});

      await renameAppFile({ subfolder, oldFilename: source, newFilename: destination });

      if (embeddingConfig) {
        const content = await readAppFile({ subfolder, filename: destination });
        if (content) {
          await abortablePromise(
            indexResearchFile(embeddingConfig, folder, destination, content),
            options?.abortSignal,
          ).catch(() => {});
        }
      }

      return "OK";
    },
  });
}

export function createDeleteFileTool(
  getResearchFolder: () => Promise<string>,
) {
  return tool({
    description:
      "Delete a file from the current research folder. Succeeds silently if the file doesn't exist.",
    strict: true,
    inputSchema: zodSchema(deleteFileInputSchema),
    outputSchema: zodSchema(z.string()),
    execute: async ({ filename }, options) => {
      const folder = await getResearchFolder();
      const subfolder = subfolderFor(folder);

      await abortablePromise(
        deleteResearchFileIndex(folder, filename),
        options?.abortSignal,
      ).catch(() => {});
      await deleteAppFile({ subfolder, filename });

      return "OK";
    },
  });
}

export function createListFilesTool(
  getResearchFolder: () => Promise<string>,
) {
  return tool({
    description:
      "List all files in the current research folder.",
    strict: true,
    inputSchema: zodSchema(z.object({}).strict()),
    outputSchema: zodSchema(
      z.object({
        folder: z.string(),
        files: z.array(z.string()),
      }),
    ),
    execute: async () => {
      const folder = await getResearchFolder();
      const subfolder = subfolderFor(folder);

      const files = await listAppFiles({ subfolder });

      return { folder, files };
    },
  });
}
