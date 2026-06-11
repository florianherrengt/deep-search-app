import type { SubAgentRun } from "./sub-agent-types";
import { readAppFile, writeAppFile, SafePathSegmentSchema } from "./app-file-storage";
import { SEARCH_RESULTS_SUBFOLDER } from "./research-history";
import { tryParseJson } from "./json";

const CHATS_SUBFOLDER = "chats";
const SUBAGENTS_FILE_SUFFIX = ".subagents.json";

function subAgentsFilePath(folderName: string, chatId: string): {
  subfolder: string;
  filename: string;
} {
  return {
    subfolder: `${SEARCH_RESULTS_SUBFOLDER}/${SafePathSegmentSchema.parse(folderName)}/${CHATS_SUBFOLDER}`,
    filename: `${SafePathSegmentSchema.parse(chatId)}${SUBAGENTS_FILE_SUFFIX}`,
  };
}

export async function readSubAgentRuns(
  folderName: string,
  chatId: string,
): Promise<SubAgentRun[]> {
  const { subfolder, filename } = subAgentsFilePath(folderName, chatId);
  const raw = await readAppFile({ subfolder, filename });
  if (!raw) return [];

  const parsed = tryParseJson(raw);
  if (!Array.isArray(parsed)) return [];

  return parsed;
}

export async function writeSubAgentRuns(
  folderName: string,
  chatId: string,
  runs: SubAgentRun[],
): Promise<void> {
  const { subfolder, filename } = subAgentsFilePath(folderName, chatId);
  await writeAppFile({
    subfolder,
    filename,
    content: JSON.stringify(runs, undefined, 2),
    emitChange: false,
  });
}
