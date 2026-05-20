import { z } from "zod";
import { createStore } from "./store";

export const settingsSchema = z.object({
  openrouter_api_key: z.string(),
  searxng_url: z.string(),
  brave_api_key: z.string(),
  exa_api_key: z.string(),
  serper_api_key: z.string(),
  tavily_api_key: z.string(),
  default_model: z.string(),
});

export const settingsDefaults: z.infer<typeof settingsSchema> = {
  openrouter_api_key: "",
  searxng_url: "",
  brave_api_key: "",
  exa_api_key: "",
  serper_api_key: "",
  tavily_api_key: "",
  default_model: "openrouter/free",
};

export const settingsStore = createStore(
  "settings.json",
  settingsSchema,
  settingsDefaults,
);
