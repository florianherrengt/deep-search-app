import { tool, zodSchema } from "ai";
import { z } from "zod";
import {
  SafePathSegmentSchema,
  writeAppFile,
} from "@/lib/app-file-storage";
import { indexResearchFile } from "@/lib/research-search";

export function createSaveResearchFileTool(
  researchFolder: string,
  apiKey?: string,
) {
  return tool({
    description:
      "Save or update a file in the current research folder in app data.",
    strict: true,
    inputSchema: zodSchema(
      z.object({
        filename: SafePathSegmentSchema.describe(
          "File to save, for example 'sources.md', 'notes.md', or 'queue.json'. Must not include folders.",
        ),
        content: z.string().describe(
          "Full file content to write. Store plain strings; JSON and Markdown formatting are decided at the call site.",
        ),
      }),
    ),
    outputSchema: zodSchema(
      z.object({
        savedTo: z.string(),
      }),
    ),
    execute: async ({ filename, content }) => {
      const targetSubfolder = `search-results/${researchFolder}`;

      await writeAppFile({
        subfolder: targetSubfolder,
        filename,
        content,
      });

      if (apiKey) {
        await indexResearchFile(apiKey, researchFolder, filename, content).catch(
          () => {},
        );
      }

      return {
        savedTo: `AppData/${targetSubfolder}/${filename}`,
      };
    },
  });
}
