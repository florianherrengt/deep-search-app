export abstract class PageExtractor {
  abstract canHandle(url: string): boolean;
  abstract extract(url: string): Promise<string>;
}
