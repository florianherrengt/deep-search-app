export const BROWSER_TAB_OPENED_EVENT = "deep-search:browser-tab-opened";
export const BROWSER_TAB_CLOSED_EVENT = "deep-search:browser-tab-closed";
export const BROWSER_TAB_VERIFICATION_REQUIRED_EVENT =
  "deep-search:browser-tab-verification-required";
export const BROWSER_TAB_VERIFICATION_CLEARED_EVENT =
  "deep-search:browser-tab-verification-cleared";

export interface BrowserTabOpenedDetail {
  id: string;
  url: string;
  title: string;
  activate?: boolean;
}

export interface BrowserTabClosedDetail {
  id: string;
}

export interface BrowserTabVerificationDetail {
  id: string;
}

export function emitBrowserTabOpened(detail: BrowserTabOpenedDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<BrowserTabOpenedDetail>(BROWSER_TAB_OPENED_EVENT, {
      detail,
    }),
  );
}

export function emitBrowserTabClosed(detail: BrowserTabClosedDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<BrowserTabClosedDetail>(BROWSER_TAB_CLOSED_EVENT, {
      detail,
    }),
  );
}

export function emitBrowserTabVerificationRequired(
  detail: BrowserTabVerificationDetail,
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<BrowserTabVerificationDetail>(
      BROWSER_TAB_VERIFICATION_REQUIRED_EVENT,
      { detail },
    ),
  );
}

export function emitBrowserTabVerificationCleared(
  detail: BrowserTabVerificationDetail,
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<BrowserTabVerificationDetail>(
      BROWSER_TAB_VERIFICATION_CLEARED_EVENT,
      { detail },
    ),
  );
}
