import { describe, expect, it } from "vitest";
import {
  isValidServiceUrl,
  isValidUrl,
  UrlValidationError,
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

  it("rejects private IPv4 ranges", () => {
    expect(isValidUrl("https://10.0.0.1")).toBe(false);
    expect(isValidUrl("https://172.16.0.1")).toBe(false);
    expect(isValidUrl("https://172.31.255.255")).toBe(false);
    expect(isValidUrl("https://192.168.0.1")).toBe(false);
    expect(isValidUrl("https://169.254.169.254")).toBe(false);
    expect(isValidUrl("https://100.64.0.1")).toBe(false);
    expect(isValidUrl("https://198.18.0.1")).toBe(false);
    expect(isValidUrl("https://224.0.0.1")).toBe(false);
    expect(isValidUrl("https://240.0.0.1")).toBe(false);
  });

  it("rejects private IPv6 ranges", () => {
    expect(isValidUrl("https://[fc00::1]")).toBe(false);
    expect(isValidUrl("https://[fd00::1]")).toBe(false);
    expect(isValidUrl("https://[fe80::1]")).toBe(false);
    expect(isValidUrl("https://[::1]")).toBe(false);
    expect(isValidUrl("https://[ff02::1]")).toBe(false);
  });

  it("rejects IPv4-mapped IPv6 addresses", () => {
    expect(isValidUrl("https://[::ffff:127.0.0.1]")).toBe(false);
    expect(isValidUrl("https://[::ffff:192.168.1.1]")).toBe(false);
  });

  it("accepts whitespace-padded URLs", () => {
    expect(isValidUrl(" https://example.com ")).toBe(true);
    expect(isValidUrl("\nhttps://example.com\t")).toBe(true);
  });

  it("accepts uppercase scheme URLs", () => {
    expect(isValidUrl("HTTPS://example.com")).toBe(true);
    expect(isValidUrl("HTTPS://Example.Com/Path")).toBe(true);
  });

  it("rejects completely invalid strings", () => {
    expect(isValidUrl("")).toBe(false);
    expect(isValidUrl("not a url")).toBe(false);
    expect(isValidUrl("://missing-scheme.com")).toBe(false);
  });

  it("rejects service URL with non-network scheme", () => {
    expect(isValidServiceUrl("file:///etc/hosts")).toBe(false);
    expect(isValidServiceUrl("data:text/html,hello")).toBe(false);
    expect(isValidServiceUrl("javascript:alert(1)")).toBe(false);
  });

  it("sets UrlValidationError name property correctly", () => {
    const error = new UrlValidationError("test message");
    expect(error.name).toBe("UrlValidationError");
    expect(error.message).toBe("test message");
    expect(error).toBeInstanceOf(Error);
  });
});
