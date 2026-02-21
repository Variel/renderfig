import * as path from 'path';
import { RenderOptions } from './types';
import { readFigFile, findFrameByPath } from './fig-reader';
import { applyOverrides } from './overrides';
import { renderToHtml } from './html-renderer';
import { takeScreenshot } from './screenshot';

export { RenderOptions, Override, FontMapping } from './types';

export async function renderFrame(options: RenderOptions): Promise<Buffer> {
  const { figFile, frameName, output, overrides = [] } = options;

  // Detect format from extension if not specified
  const format = options.format ?? (output.endsWith('.jpg') || output.endsWith('.jpeg') ? 'jpeg' : 'png');
  const scale = options.scale ?? 1;
  const quality = options.quality;

  // 1. Parse .fig file and extract images
  const { nodeTree, images } = readFigFile(figFile);

  // 2. Find target frame
  const frame = findFrameByPath(nodeTree, frameName);
  if (!frame) {
    throw new Error(`Frame "${frameName}" not found`);
  }

  // 3. Apply overrides
  if (overrides.length > 0) {
    applyOverrides(frame, overrides, images, frameName);
  }

  // 4. Generate HTML
  const html = renderToHtml(frame, images, options.fonts);

  // 5. Take screenshot
  const size = frame.properties['size'] as { x: number; y: number } | undefined;
  const width = size?.x ?? 100;
  const height = size?.y ?? 100;

  const buffer = await takeScreenshot(html, {
    width: Math.ceil(width),
    height: Math.ceil(height),
    scale,
    format,
    quality,
    output,
  });

  return buffer;
}
