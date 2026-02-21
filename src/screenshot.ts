import { chromium } from 'playwright';

export async function takeScreenshot(html: string, opts: {
  width: number;
  height: number;
  scale: number;
  format: 'png' | 'jpeg';
  quality?: number;
  output: string;
}): Promise<Buffer> {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: opts.width, height: opts.height },
      deviceScaleFactor: opts.scale,
    });
    const page = await context.newPage();

    await page.setContent(html, { waitUntil: 'load' });

    // Wait for fonts and images to load
    await page.evaluate(() => (document as any).fonts.ready);
    // Small extra delay for image rendering
    await page.waitForTimeout(100);

    const root = page.locator('#root');
    const screenshotOpts: Record<string, unknown> = {
      path: opts.output,
      type: opts.format,
      omitBackground: opts.format === 'png',
    };
    if (opts.format === 'jpeg' && opts.quality !== undefined) {
      screenshotOpts['quality'] = opts.quality;
    }

    const buffer = await root.screenshot(screenshotOpts);
    return Buffer.from(buffer);
  } finally {
    await browser.close();
  }
}
