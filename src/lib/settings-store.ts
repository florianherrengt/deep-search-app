import { z } from "zod";
import { createStore } from "./store";

export const settingsSchema = z.object({
  openrouter_api_key: z.string().nullable(),
  searxng_url: z.string().nullable(),
  brave_api_key: z.string().nullable(),
  exa_api_key: z.string().nullable(),
  serper_api_key: z.string().nullable(),
  tavily_api_key: z.string().nullable(),
  default_model: z.string().nullable(),
});

export const settingsDefaults: z.infer<typeof settingsSchema> = {
  openrouter_api_key: null,
  searxng_url: null,
  brave_api_key: null,
  exa_api_key: null,
  serper_api_key: null,
  tavily_api_key: null,
  default_model: null,
};

export const settingsStore = await createStore(
  "settings.json",
  settingsSchema,
  settingsDefaults,
);
