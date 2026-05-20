import { z } from "zod";
import {
  BaseDirectory,
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";

export const SafePathSegmentSchema = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => !value.includes("/"), {
    message: 'Path segment must not contain "/"',
  })
  .refine((value) => !value.includes("\\"), {
    message: 'Path segment must not contain "\\"',
  })
  .refine((value) => value !== "." && value !== "..", {
    message: 'Path segment must not be "." or ".."',
  });

export const SafeSubfolderSchema = z
  .string()
  .min(1)
  .max(512)
  .superRefine((value, ctx) => {
    const segments = value.split("/");

    if (segments.length > 4) {
      ctx.addIssue({
        code: "custom",
        message: "Subfolder must not be more than 4 segments deep",
      });
    }

    for (const segment of segments) {
      const parsed = SafePathSegmentSchema.safeParse(segment);
      if (!parsed.success) {
        ctx.addIssue({
          code: "custom",
          message: "Subfolder must contain only safe path segments",
        });
        return;
      }
    }
  });

export const WriteAppFileInputSchema = z.object({
  subfolder: SafeSubfolderSchema,
  filename: SafePathSegmentSchema,
  content: z.string(),
});

export const ReadAppFileInputSchema = z.object({
  subfolder: SafeSubfolderSchema,
  filename: SafePathSegmentSchema,
});

export type WriteAppFileInput = z.infer<typeof WriteAppFileInputSchema>;
export type ReadAppFileInput = z.infer<typeof ReadAppFileInputSchema>;

export async function writeAppFile(input: WriteAppFileInput): Promise<void> {
  const parsed = WriteAppFileInputSchema.parse(input);

  await mkdir(parsed.subfolder, {
    baseDir: BaseDirectory.AppData,
    recursive: true,
  });

  await writeTextFile(
    `${parsed.subfolder}/${parsed.filename}`,
    parsed.content,
    {
      baseDir: BaseDirectory.AppData,
    },
  );
}

export async function readAppFile(
  input: ReadAppFileInput,
): Promise<string | null> {
  const parsed = ReadAppFileInputSchema.parse(input);
  const path = `${parsed.subfolder}/${parsed.filename}`;

  const fileExists = await exists(path, {
    baseDir: BaseDirectory.AppData,
  });

  if (!fileExists) {
    return null;
  }

  return readTextFile(path, {
    baseDir: BaseDirectory.AppData,
  });
}
