import { fetch } from "@/lib/tauri-bridge";
import {
  createBraveSearchTool as createCoreBraveSearchTool,
} from "deep-search-core/research-orchestrator";
import { searchQueryInputSchema } from "deep-search-core/search-extract/core";

export const braveSearchInputSchema = searchQueryInputSchema;

export function createBraveSearchTool(apiKey: string) {
  return createCoreBraveSearchTool(apiKey, fetch);
}
