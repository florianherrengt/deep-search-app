import { fetch } from "@/lib/tauri-bridge";
import {
  createSearXNGSearchTool as createCoreSearXNGSearchTool,
} from "deep-search-core/research-orchestrator";
import { searchQueryInputSchema } from "deep-search-core/search-extract/core";

const DEFAULT_BASE_URL = "http://localhost:8080";

export const searxngSearchInputSchema = searchQueryInputSchema;

export function createSearXNGSearchTool(baseUrl: string = DEFAULT_BASE_URL) {
  return createCoreSearXNGSearchTool(baseUrl, fetch);
}
