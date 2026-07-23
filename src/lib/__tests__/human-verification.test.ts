// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const notificationMocks = vi.hoisted(() => ({
  isGranted: vi.fn(),
  requestPermission: vi.fn(),
  send: vi.fn(),
}));

vi.mock("@/lib/tauri-bridge", () => ({
  isNotificationPermissionGranted: notificationMocks.isGranted,
  requestNotificationPermission: notificationMocks.requestPermission,
  sendNotification: notificationMocks.send,
}));

import {
  detectHumanVerification,
  notifyHumanVerification,
  waitForHumanVerification,
} from "@/lib/human-verification";

const CAPTCHA_HTML = `
  <html><body>
    <form id="challenge-form"><div class="g-recaptcha"></div></form>
  </body></html>
`;

describe("human verification detection", () => {
  it("detects known challenge URLs, selectors, and interactive phrases", async () => {
    expect(
      await detectHumanVerification({
        url: "https://www.google.co.uk/sorry/index?continue=1",
        html: "<html><body></body></html>",
      }),
    ).toMatchObject({ kind: "captcha" });
    expect(await detectHumanVerification({ html: CAPTCHA_HTML })).toMatchObject({
      kind: "captcha",
    });
    expect(
      await detectHumanVerification({
        url: "https://example.com/cdn-cgi/challenge-platform/h/b/orchestrate",
        html: "<html><body></body></html>",
      }),
    ).toMatchObject({ kind: "captcha" });
    expect(
      await detectHumanVerification({
        url: "https://www.recaptcha.net/recaptcha/api2/anchor?k=site-key",
        html: "<html><body></body></html>",
      }),
    ).toMatchObject({ kind: "captcha" });
    expect(
      await detectHumanVerification({
        html: "<html><body><form>Verify you are human<div class='g-recaptcha'></div></form></body></html>",
      }),
    ).toMatchObject({ kind: "captcha" });
  });

  it("detects Google consent as a human action", async () => {
    expect(
      await detectHumanVerification({
        url: "https://consent.google.com/m?continue=1",
        html: "<html><body>Before you continue to Google<form action='/save'></form></body></html>",
      }),
    ).toMatchObject({ kind: "consent" });
  });

  it("does not match an ordinary article that discusses CAPTCHAs", async () => {
    expect(
      await detectHumanVerification({
        url: "https://example.com/what-is-captcha",
        html: "<html><article><h1>What is a CAPTCHA?</h1><p>This article explains how CAPTCHA verification works.</p></article></html>",
      }),
    ).toBeNull();
  });

  it("does not block on an embedded contact-form CAPTCHA widget", async () => {
    expect(
      await detectHumanVerification({
        url: "https://example.com/contact",
        html: "<html><body><main><h1>Contact us</h1><form><input name='message'><div class='g-recaptcha' data-sitekey='public-key'></div><button>Send</button></form></main></body></html>",
      }),
    ).toBeNull();
  });

  it("does not combine CAPTCHA discussion text with an unrelated form", async () => {
    expect(
      await detectHumanVerification({
        url: "https://example.com/security-guide",
        html: "<html><body><article><p>Some sites ask you to verify you are human.</p></article><form action='/newsletter'><input type='email'><button>Subscribe</button></form></body></html>",
      }),
    ).toBeNull();
  });

  it("does not combine CAPTCHA discussion text with a separate protected form", async () => {
    expect(
      await detectHumanVerification({
        url: "https://example.com/security-guide",
        html: "<html><body><article><p>Some sites ask you to verify you are human.</p></article><form action='/contact'><input name='message'><div class='g-recaptcha' data-sitekey='public-key'></div><button>Send</button></form></body></html>",
      }),
    ).toBeNull();
  });

  it("does not treat CAPTCHA documentation URLs or vendor sites as challenges", async () => {
    const documentation =
      "<html><body><article><h1>CAPTCHA documentation</h1></article></body></html>";

    expect(
      await detectHumanVerification({
        url: "https://example.com/captcha/?next=/recaptcha",
        html: documentation,
      }),
    ).toBeNull();
    expect(
      await detectHumanVerification({
        url: "https://www.hcaptcha.com/docs",
        html: documentation,
      }),
    ).toBeNull();
    expect(
      await detectHumanVerification({
        url: "https://www.recaptcha.net/about/",
        html: documentation,
      }),
    ).toBeNull();
    expect(
      await detectHumanVerification({
        url: "https://google.evil.com/sorry/index",
        html: documentation,
      }),
    ).toBeNull();
  });

  it("does not match challenge markup shown in code or script text", async () => {
    expect(
      await detectHumanVerification({
        url: "https://example.com/security-guide",
        html: `<html><body>
          <article><code>&lt;form id="challenge-form"&gt;&lt;/form&gt;</code></article>
          <script>const example = '<div class="cf-challenge"></div>';</script>
        </body></html>`,
      }),
    ).toBeNull();
  });

  it("detects instructions in an explicit dialog around a protected form", async () => {
    expect(
      await detectHumanVerification({
        html: "<html><body><div role='dialog'><p>Verify you are human</p><form><div class='g-recaptcha' data-sitekey='public-key'></div></form></div></body></html>",
      }),
    ).toMatchObject({ kind: "captcha" });
  });
});

describe("human verification waiting", () => {
  it("notifies once for a continuous challenge and resumes when it clears", async () => {
    const onRequired = vi.fn();
    const onCleared = vi.fn();
    const getSnapshot = vi
      .fn()
      .mockResolvedValueOnce({ html: CAPTCHA_HTML })
      .mockResolvedValueOnce({ html: "<html><body>Results</body></html>" });

    await expect(
      waitForHumanVerification(
        { html: CAPTCHA_HTML },
        { getSnapshot, onRequired, onCleared, pollIntervalMs: 0 },
      ),
    ).resolves.toEqual({ html: "<html><body>Results</body></html>" });
    expect(onRequired).toHaveBeenCalledTimes(1);
    expect(onCleared).toHaveBeenCalledTimes(1);
    expect(getSnapshot).toHaveBeenCalledTimes(2);
  });

  it("waits until cancellation and clears attention during cleanup", async () => {
    const controller = new AbortController();
    const onCleared = vi.fn();
    const getSnapshot = vi.fn(async () => {
      controller.abort();
      return { html: CAPTCHA_HTML };
    });

    await expect(
      waitForHumanVerification(
        { html: CAPTCHA_HTML },
        {
          getSnapshot,
          signal: controller.signal,
          onCleared,
          pollIntervalMs: 0,
        },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(onCleared).toHaveBeenCalledTimes(1);
  });
});

describe("human verification notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notificationMocks.isGranted.mockResolvedValue(false);
    notificationMocks.requestPermission.mockResolvedValue("granted");
  });

  it("requests permission and routes WebView notification clicks to the tab", async () => {
    await notifyHumanVerification({
      backend: "webview",
      browserTabId: "tab-7",
      message: "Human verification is required in the browser.",
    });

    expect(notificationMocks.requestPermission).toHaveBeenCalledTimes(1);
    expect(notificationMocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Browser verification required",
        extra: expect.objectContaining({
          kind: "human-verification",
          backend: "webview",
          browserTabId: "tab-7",
        }),
      }),
    );
  });

  it("explicitly directs Chrome-backed verification to Chrome", async () => {
    notificationMocks.isGranted.mockResolvedValue(true);

    await notifyHumanVerification({
      backend: "chrome-mcp",
      message: "Human verification is required in the browser.",
    });

    expect(notificationMocks.requestPermission).not.toHaveBeenCalled();
    expect(notificationMocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("Open Chrome"),
        extra: expect.objectContaining({ backend: "chrome-mcp" }),
      }),
    );
  });
});
