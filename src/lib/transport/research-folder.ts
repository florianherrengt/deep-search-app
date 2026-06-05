import { listAppSubfolders, SafePathSegmentSchema } from "@/lib/app-file-storage";
import { slugifyText } from "@/lib/slug";

export function slugifyFolderName(text: string): string {
  return SafePathSegmentSchema.parse(
    slugifyText(text, { maxLength: 100, fallback: "research" }),
  );
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
