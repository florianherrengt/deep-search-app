import slugify from "slugify";
import { listAppSubfolders, SafePathSegmentSchema } from "@/lib/app-file-storage";

const RESEARCH_FOLDER_SLUG_MAX_LENGTH = 100;
const VALID_RESEARCH_FOLDER_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_RESEARCH_FOLDER_WORDS = 5;
const DATE_ONLY_NAME = /^\d{4}-\d{2}-\d{2}(?:-\d{2}-\d{2}-\d{2})?$/;

export function slugifyFolderName(text: string): string {
  return slugify(text.replace(/_/g, "-"), {
    lower: true,
    strict: true,
    trim: true,
  }).slice(0, RESEARCH_FOLDER_SLUG_MAX_LENGTH);
}

export function validateResearchFolderName(name: string): string | null {
  if (!name.trim()) {
    return "must not be empty";
  }

  if (!VALID_RESEARCH_FOLDER_NAME.test(name)) {
    return "must be lowercase kebab-case (letters, numbers, hyphens only)";
  }

  if (name.length < 2) {
    return "too short (min 2 characters)";
  }

  if (DATE_ONLY_NAME.test(name)) {
    return "must describe the research topic, not just a timestamp";
  }

  if (name.split("-").length > MAX_RESEARCH_FOLDER_WORDS) {
    return `too many words (max ${MAX_RESEARCH_FOLDER_WORDS})`;
  }

  const parsed = SafePathSegmentSchema.safeParse(name);
  if (!parsed.success) {
    return "must be a safe filesystem path segment";
  }

  return null;
}

export function resolveUniqueFolderNameFromExisting(
  candidate: string,
  existing: readonly string[],
  date = new Date(),
): string {
  const parsedCandidate = SafePathSegmentSchema.parse(candidate);

  if (!existing.includes(parsedCandidate)) return parsedCandidate;

  const today = date.toISOString().slice(0, 10);
  const withDate = `${parsedCandidate}-${today}`;
  if (!existing.includes(withDate)) return withDate;

  let counter = 2;
  while (existing.includes(`${withDate}-${counter}`)) {
    counter++;
  }
  return `${withDate}-${counter}`;
}

export async function resolveUniqueFolderName(
  candidate: string,
): Promise<string> {
  const existing = await listAppSubfolders({ subfolder: "search-results" });
  return resolveUniqueFolderNameFromExisting(candidate, existing);
}
