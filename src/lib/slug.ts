interface SlugifyTextOptions {
  maxLength?: number;
  fallback?: string;
}

export function slugifyText(
  text: string,
  { maxLength = 100, fallback = "" }: SlugifyTextOptions = {},
): string {
  const slug = text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength);

  return slug || fallback;
}
