import { createDisambiguateTool } from "deep-search-core/research-orchestrator";
import { fetch } from "@/lib/tauri-bridge";
import { z } from "zod";

export const disambiguateInputSchema = z.object({
  terms: z.array(z.string()).describe("Specific terms to disambiguate. Only include terms that are genuinely ambiguous — e.g., acronyms with multiple expansions, words with common alternate meanings, or unfamiliar jargon. Do not include common unambiguous words."),
});

export const disambiguateTool = createDisambiguateTool(fetch);
