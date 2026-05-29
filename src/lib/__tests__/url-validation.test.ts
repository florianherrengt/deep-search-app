import { describe, expect, it } from "vitest";
import {
  isValidServiceUrl,
  isValidUrl,
  validateUrl,
} from "@/lib/url-validation";

describe("validateUrl", () => {
  it("accepts public https URLs", () => {
    expect(validateUrl("https://example.com/page").hostname).toBe("example.com");
  });

  it("rejects non-https URLs", () => {
    expect(isValidUrl("http://example.com")).toBe(false);
  });

  it("rejects local and private targets", () => {
    expect(isValidUrl("https://localhost:8080")).toBe(false);
    expect(isValidUrl("https://127.0.0.1")).toBe(false);
    expect(isValidUrl("https://192.168.1.10")).toBe(false);
    expect(isValidUrl("https://example.local")).toBe(false);
  });

  it("rejects non-network schemes", () => {
    expect(isValidUrl("file:///etc/passwd")).toBe(false);
    expect(isValidUrl("javascript:alert(1)")).toBe(false);
    expect(isValidUrl("tauri://localhost")).toBe(false);
  });

  it("allows local http URLs only for configured service endpoints", () => {
    expect(isValidUrl("http://localhost:8080")).toBe(false);
    expect(isValidServiceUrl("http://localhost:8080")).toBe(true);
    expect(isValidServiceUrl("https://search.example.com")).toBe(true);
    expect(isValidServiceUrl("file:///etc/passwd")).toBe(false);
  });
});
