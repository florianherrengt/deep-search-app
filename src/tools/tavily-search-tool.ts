import { fetch } from "@/lib/tauri-bridge";
import {
  createTavilySearchTool as createCoreTavilySearchTool,
} from "deep-search-core/research-orchestrator";
import { searchQueryInputSchema } from "deep-search-core/search-extract/core";

export const tavilySearchInputSchema = searchQueryInputSchema;

export function createTavilySearchTool(apiKey: string) {
  return createCoreTavilySearchTool(apiKey, fetch);
}
