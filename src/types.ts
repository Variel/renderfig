export interface RenderOptions {
  figFile: string;
  frameName: string;
  output: string;
  format?: 'png' | 'jpeg';
  quality?: number;
  scale?: number;
  overrides?: Override[];
  fonts?: FontMapping[];
}

export interface FontMapping {
  family: string;
  src: string;  // local file path to .woff2/.woff/.ttf/.otf
}

export type Override =
  | { type: 'text'; target: string; value: string; search?: string }
  | { type: 'image'; target: string; src: string }
  | { type: 'style'; target: string; props: Record<string, string | number>; search?: string };
