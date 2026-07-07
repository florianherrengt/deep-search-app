import { fetch } from "@/lib/tauri-bridge";
import {
  createExaSearchTool as createCoreExaSearchTool,
} from "deep-search-core/research-orchestrator";
import { searchQueryInputSchema } from "deep-search-core/search-extract/core";

export const exaSearchInputSchema = searchQueryInputSchema;

export function createExaSearchTool(apiKey: string) {
  return createCoreExaSearchTool(apiKey, fetch);
}
