import { tool, zodSchema } from "ai";
import { z } from "zod";
import {
  indexResearchFile,
  registerResearchFolder,
  type EmbeddingConfig,
} from "@/lib/research-search";
import { writeAppFile } from "@/lib/app-file-storage";
import { renameResearchFolder } from "@/lib/research-history";
import { slugifyFolderName, resolveUniqueFolderName } from "@/lib/transport/research-folder";

export const renameResearchFolderInputSchema = z.object({
  name: z
    .string()
    .describe(
      "Descriptive kebab-case name for the research folder, e.g. 'acme-market-map' or 'how-llms-work'. Max 5 words.",
    ),
});

export function createRenameResearchFolderTool({
  getResearchFolder,
  onFolderRenamed,
  embeddingConfig,
}: {
  getResearchFolder: () => Promise<string>;
  onFolderRenamed: (newName: string) => void | Promise<void>;
  embeddingConfig: EmbeddingConfig;
}) {
  return tool({
    description:
      "Rename the active research folder to a descriptive kebab-case name. Call this early in the research to give the folder a meaningful name (required before create_research_plan). Can be called multiple times to rename again.",
    strict: true,
    inputSchema: zodSchema(renameResearchFolderInputSchema),
    outputSchema: zodSchema(
      z.object({
        folderName: z.string(),
      }),
    ),
    execute: async ({ name }) => {
      const currentFolder = await getResearchFolder();
      const rawName = slugifyFolderName(name);
      const folderName = await resolveUniqueFolderName(rawName);

      if (folderName !== currentFolder) {
        await renameResearchFolder(currentFolder, folderName);
      }

      const readmeContent = `# ${folderName}\n`;
      await writeAppFile({
        subfolder: `search-results/${folderName}`,
        filename: "README.md",
        content: readmeContent,
      });

      await registerResearchFolder(folderName, folderName).catch(() => {});
      await indexResearchFile(embeddingConfig, folderName, "README.md", readmeContent).catch(() => {});

      await onFolderRenamed(folderName);

      return { folderName };
    },
  });
}
