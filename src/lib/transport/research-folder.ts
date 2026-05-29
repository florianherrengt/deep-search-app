import { generateObject, zodSchema, type LanguageModel, type UIMessage } from "ai";
import { z } from "zod";
import {
  indexResearchFile,
  registerResearchFolder,
} from "@/lib/research-search";
import {
  SafePathSegmentSchema,
  writeAppFile,
} from "@/lib/app-file-storage";

const FolderNameSchema = z.object({
  folderName: z
    .string()
    .describe(
      "Short kebab-case folder name for this research, e.g. 'how-llms-work' or 'acme-market-map'. Max 5 words.",
    ),
});

function slugifyFolderName(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);

  return SafePathSegmentSchema.parse(slug || "research");
}

function getFirstUserMessage(messages: UIMessage[]): string | null {
  for (const msg of messages) {
    if (msg.role === "user") {
      const text = msg.parts
        .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
        .map((p) => p.text)
        .join(" ")
        .trim();
      if (text) return text;
    }
  }
  return null;
}

export async function generateResearchFolder(
  model: LanguageModel,
  messages: UIMessage[],
  apiKey: string,
): Promise<string> {
  const firstMessage = getFirstUserMessage(messages);
  if (!firstMessage) return "research";

  let folderName = slugifyFolderName(firstMessage);
  try {
    const { object } = await generateObject({
      model,
      schema: zodSchema(FolderNameSchema),
      system:
        "You name research folders. Given a user question, produce a short, descriptive kebab-case folder name. Use at most 5 words. Focus on the core topic, not the phrasing.",
      prompt: firstMessage,
    });

    folderName = slugifyFolderName(object.folderName);
  } catch {}

  const readmeContent = `# ${folderName}\n\nQuery: ${firstMessage}\n`;

  await writeAppFile({
    subfolder: `search-results/${folderName}`,
    filename: "README.md",
    content: readmeContent,
  });

  await registerResearchFolder(folderName, firstMessage).catch(() => {});
  await indexResearchFile(apiKey, folderName, "README.md", readmeContent).catch(
    () => {},
  );

  return folderName;
}
