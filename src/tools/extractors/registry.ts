import { PageExtractor } from "./base-extractor";

export class ExtractorRegistry {
  private extractors: PageExtractor[] = [];

  register(extractor: PageExtractor): void {
    this.extractors.push(extractor);
  }

  find(url: string): PageExtractor | undefined {
    return this.extractors.find((e) => e.canHandle(url));
  }
}
