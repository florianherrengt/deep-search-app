import { fetch } from "@/lib/tauri-bridge";
import {
  createSerperSearchTool as createCoreSerperSearchTool,
} from "deep-search-core/research-orchestrator";
import { searchQueryInputSchema } from "deep-search-core/search-extract/core";

export const serperSearchInputSchema = searchQueryInputSchema;

export function createSerperSearchTool(apiKey: string) {
  return createCoreSerperSearchTool(apiKey, fetch);
}
