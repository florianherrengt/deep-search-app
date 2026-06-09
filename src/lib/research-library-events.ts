const RESEARCH_LIBRARY_CHANGED_EVENT = "research-library-changed";

type ResearchLibraryChangeType = "write" | "delete" | "rename";

interface ResearchLibraryChangedDetail {
  changeType: ResearchLibraryChangeType;
  folderName: string;
  previousFolderName?: string;
}

export function emitResearchLibraryChanged(
  detail: ResearchLibraryChangedDetail,
) {
  if (
    typeof window === "undefined" ||
    typeof window.dispatchEvent !== "function"
  ) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<ResearchLibraryChangedDetail>(
      RESEARCH_LIBRARY_CHANGED_EVENT,
      { detail },
    ),
  );
}

export function subscribeResearchLibraryChanged(
  handler: (detail: ResearchLibraryChangedDetail) => void,
) {
  if (
    typeof window === "undefined" ||
    typeof window.addEventListener !== "function" ||
    typeof window.removeEventListener !== "function"
  ) {
    return () => {};
  }

  const listener = (event: Event) => {
    handler((event as CustomEvent<ResearchLibraryChangedDetail>).detail);
  };

  window.addEventListener(RESEARCH_LIBRARY_CHANGED_EVENT, listener);
  return () => {
    window.removeEventListener(RESEARCH_LIBRARY_CHANGED_EVENT, listener);
  };
}
