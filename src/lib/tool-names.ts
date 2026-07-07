import { TOOL_NAMES as CORE_TOOL_NAMES } from "deep-search-core/research-orchestrator";

export const TOOL_NAMES = {
  ...CORE_TOOL_NAMES,
  create_file: "create_file",
  read_file: "read_file",
  update_file: "update_file",
  move_file: "move_file",
  delete_file: "delete_file",
  list_files: "list_files",
  load_skill: "load_skill",
  search_research: "search_research",
  switch_research_folder: "switch_research_folder",
  currency_conversion: "currency_conversion",
} as const;
