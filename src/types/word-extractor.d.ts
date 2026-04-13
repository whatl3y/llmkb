declare module 'word-extractor' {
  interface Document {
    getBody(): string;
    getFootnotes(): string;
    getHeaders(): string;
    getAnnotations(): string;
  }

  class WordExtractor {
    extract(input: string | Buffer): Promise<Document>;
  }

  export default WordExtractor;
}
