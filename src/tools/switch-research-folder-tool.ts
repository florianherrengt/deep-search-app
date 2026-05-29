import { tool, zodSchema } from "ai";
import { z } from "zod";
import {
  listAppSubfolders,
  SafePathSegmentSchema,
} from "@/lib/app-file-storage";
import { SEARCH_RESULTS_SUBFOLDER } from "@/lib/research-history";

type SwitchResearchFolder = (folderName: string) => void;

export const switchResearchFolderInputSchema = z.object({
  folder: SafePathSegmentSchema.describe(
    "Existing research folder to continue, for example 'acme-market-map'.",
  ),
});

export function createSwitchResearchFolderTool(
  switchResearchFolder: SwitchResearchFolder,
) {
  return tool({
    description:
      "Switch the active research folder to an existing previous research folder.",
    strict: true,
    inputSchema: zodSchema(switchResearchFolderInputSchema),
    outputSchema: zodSchema(
      z.object({
        researchFolder: z.string(),
      }),
    ),
    execute: async ({ folder }) => {
      const parsedFolder = SafePathSegmentSchema.parse(folder);
      const folders = await listAppSubfolders({
        subfolder: SEARCH_RESULTS_SUBFOLDER,
      });

      if (!folders.includes(parsedFolder)) {
        throw new Error(`Research folder not found: ${parsedFolder}`);
      }

      switchResearchFolder(parsedFolder);

      return {
        researchFolder: parsedFolder,
      };
    },
  });
}
