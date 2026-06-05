import { z } from "zod";
import { createStore } from "./store";

const templateSchema = z.object({
  name: z.string().min(1),
  text: z.string().min(1),
});

export type Template = z.infer<typeof templateSchema>;

export const promptTemplatesSchema = z.object({
  templates: z.array(templateSchema),
  lastSelectedTemplate: z.string().nullable(),
});

export type PromptTemplatesState = z.infer<typeof promptTemplatesSchema>;

export const promptTemplatesDefaults: PromptTemplatesState = {
  templates: [],
  lastSelectedTemplate: null,
};

export const promptTemplatesStore = createStore(
  "prompt-templates.json",
  promptTemplatesSchema,
  promptTemplatesDefaults,
);
