// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "@/components/error-boundary";

function ThrowError(): never {
  throw new Error("test render error");
}

function NormalChild() {
  return <div>Normal content</div>;
}

describe("ErrorBoundary", () => {
  it("renders children normally when no error occurs", () => {
    render(
      <ErrorBoundary>
        <NormalChild />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Normal content")).toBeTruthy();
  });

  it("renders fallback when a child throws during render", () => {
    render(
      <ErrorBoundary fallback={<div>Custom fallback</div>}>
        <ThrowError />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Custom fallback")).toBeTruthy();
  });

  it("displays error message when no custom fallback is provided", () => {
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Render error")).toBeTruthy();
    expect(screen.getByText("test render error")).toBeTruthy();
  });

  it("calls console.error when an error is caught", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>,
    );

    expect(consoleError).toHaveBeenCalledWith(
      "[ErrorBoundary] Render error:",
      expect.any(Error),
      expect.any(String),
    );

    consoleError.mockRestore();
  });
});
