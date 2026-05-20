import { tool, zodSchema } from "ai";
import { z } from "zod";
import {
  SafePathSegmentSchema,
  writeAppFile,
} from "@/lib/app-file-storage";

const SaveResearchFileInputSchema = z.object({
  subfolder: SafePathSegmentSchema,
  filename: SafePathSegmentSchema,
  content: z.string(),
  folderDescription: z
    .string()
    .min(1)
    .max(500)
    .describe(
      "Short explanation of what this research folder represents and what belongs in it.",
    ),
});

export const saveResearchFileTool = tool({
  description:
    "Save or update a file for a research thread in app data. Files are always saved under AppData/search-results/<short-research-folder>/.",
  strict: true,
  inputSchema: zodSchema(
    SaveResearchFileInputSchema.extend({
      subfolder: SaveResearchFileInputSchema.shape.subfolder.describe(
        "Short folder name for this research thread, for example 'acme-market-map'. Must not include slashes.",
      ),
      filename: SaveResearchFileInputSchema.shape.filename.describe(
        "File to save inside the research folder, for example 'sources.md', 'notes.md', or 'queue.json'. Must not include folders.",
      ),
      content: z
        .string()
        .describe(
          "Full file content to write. Store plain strings; JSON and Markdown formatting are decided at the call site.",
        ),
    }),
  ),
  outputSchema: zodSchema(
    z.object({
      savedTo: z.string(),
    }),
  ),
  execute: async ({ subfolder, folderDescription, filename, content }) => {
    const targetSubfolder = `search-results/${subfolder}`;

    if (filename !== "README.md") {
      await writeAppFile({
        subfolder: targetSubfolder,
        filename: "README.md",
        content: `# ${subfolder}\n\n${folderDescription.trim()}\n`,
      });
    }

    await writeAppFile({
      subfolder: targetSubfolder,
      filename,
      content,
    });

    return {
      savedTo: `AppData/${targetSubfolder}/${filename}`,
    };
  },
});
