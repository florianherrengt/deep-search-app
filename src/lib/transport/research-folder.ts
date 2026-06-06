import slugify from "slugify";
import { listAppSubfolders, SafePathSegmentSchema } from "@/lib/app-file-storage";

const RESEARCH_FOLDER_SLUG_MAX_LENGTH = 100;
const RESEARCH_FOLDER_SLUG_FALLBACK = "research";

export function slugifyFolderName(text: string): string {
  const slug = slugify(text.replace(/_/g, "-"), {
    lower: true,
    strict: true,
    trim: true,
  }).slice(0, RESEARCH_FOLDER_SLUG_MAX_LENGTH);
  return SafePathSegmentSchema.parse(slug || RESEARCH_FOLDER_SLUG_FALLBACK);
}

export async function resolveUniqueFolderName(
  candidate: string,
): Promise<string> {
  const existing = await listAppSubfolders({ subfolder: "search-results" });
  if (!existing.includes(candidate)) return candidate;

  const today = new Date().toISOString().slice(0, 10);
  const withDate = `${candidate}-${today}`;
  if (!existing.includes(withDate)) return withDate;

  let counter = 2;
  while (existing.includes(`${withDate}-${counter}`)) {
    counter++;
  }
  return `${withDate}-${counter}`;
}
