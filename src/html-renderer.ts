import * as fs from 'fs';
import * as path from 'path';
import { FigmaNode } from 'parsefig';
import { hashToHex } from './fig-reader';
import { FontMapping } from './types';

export function renderToHtml(
  frame: FigmaNode,
  images: Map<string, Buffer>,
  fonts?: FontMapping[]
): string {
  const width = (frame.properties['size'] as any)?.x ?? 100;
  const height = (frame.properties['size'] as any)?.y ?? 100;

  // Collect all font families used in the tree
  const usedFonts = new Set<string>();
  collectFonts(frame, usedFonts);

  // Build font CSS
  const fontCss = buildFontCss(usedFonts, fonts ?? []);

  const bodyHtml = renderNode(frame, images, false);

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
${fontCss.linkTags}
<style>
${fontCss.fontFaceRules}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { width: ${width}px; height: ${height}px; overflow: hidden; }
</style>
</head>
<body>
<div id="root" style="width:${width}px;height:${height}px;position:relative;">
${bodyHtml}
</div>
</body>
</html>`;
}

function collectFonts(node: FigmaNode, fonts: Set<string>): void {
  const fontName = node.properties['fontName'] as { family: string } | undefined;
  if (fontName?.family) {
    fonts.add(fontName.family);
  }
  for (const child of node.children) {
    collectFonts(child, fonts);
  }
}

function buildFontCss(
  usedFonts: Set<string>,
  fontMappings: FontMapping[]
): { linkTags: string; fontFaceRules: string } {
  const mappingMap = new Map<string, string>();
  for (const m of fontMappings) {
    mappingMap.set(m.family, m.src);
  }

  const fontFaceRules: string[] = [];
  const googleFontFamilies: string[] = [];

  for (const family of usedFonts) {
    if (mappingMap.has(family)) {
      // Local font file → @font-face with base64 embed
      const src = mappingMap.get(family)!;
      const absPath = path.resolve(src);
      const data = fs.readFileSync(absPath);
      const ext = path.extname(absPath).toLowerCase();
      const formatMap: Record<string, string> = {
        '.woff2': 'woff2',
        '.woff': 'woff',
        '.ttf': 'truetype',
        '.otf': 'opentype',
      };
      const format = formatMap[ext] ?? 'truetype';
      const mime = ext === '.woff2' ? 'font/woff2'
        : ext === '.woff' ? 'font/woff'
        : ext === '.otf' ? 'font/otf'
        : 'font/ttf';
      const b64 = data.toString('base64');
      fontFaceRules.push(
        `@font-face { font-family: "${family}"; src: url(data:${mime};base64,${b64}) format("${format}"); }`
      );
    } else {
      // Try Google Fonts
      googleFontFamilies.push(family);
    }
  }

  let linkTags = '';
  if (googleFontFamilies.length > 0) {
    const families = googleFontFamilies
      .map(f => `family=${encodeURIComponent(f)}:ital,wght@0,100..900;1,100..900`)
      .join('&');
    linkTags = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?${families}&display=swap" rel="stylesheet">`;
  }

  return { linkTags, fontFaceRules: fontFaceRules.join('\n') };
}

function renderNode(
  node: FigmaNode,
  images: Map<string, Buffer>,
  isAbsoluteChild: boolean
): string {
  const props = node.properties;
  if (props['visible'] === false) return '';

  const type = node.type;
  const styles: string[] = [];
  const size = props['size'] as { x: number; y: number } | undefined;
  const transform = props['transform'] as { m00: number; m01: number; m02: number; m10: number; m11: number; m12: number } | undefined;

  // Determine if this is an auto-layout frame
  const stackMode = props['stackMode'] as string | undefined;
  const isAutoLayout = stackMode === 'VERTICAL' || stackMode === 'HORIZONTAL';

  // Size
  if (size) {
    const primarySizing = props['stackPrimarySizing'] as string | undefined;
    const counterSizing = props['stackCounterSizing'] as string | undefined;

    if (isAutoLayout && primarySizing === 'AUTO') {
      if (stackMode === 'VERTICAL') {
        styles.push(`width:${size.x}px`);
      } else {
        styles.push(`height:${size.y}px`);
      }
    } else if (isAutoLayout && counterSizing === 'AUTO') {
      if (stackMode === 'VERTICAL') {
        styles.push(`height:${size.y}px`);
      } else {
        styles.push(`width:${size.x}px`);
      }
    } else {
      styles.push(`width:${size.x}px`);
      styles.push(`height:${size.y}px`);
    }

    // For non-auto-layout nodes with fixed size, always set both
    if (!isAutoLayout) {
      if (!styles.some(s => s.startsWith('width:'))) styles.push(`width:${size.x}px`);
      if (!styles.some(s => s.startsWith('height:'))) styles.push(`height:${size.y}px`);
    }
  }

  // Position
  if (isAbsoluteChild && transform) {
    styles.push('position:absolute');
    styles.push(`left:${transform.m02}px`);
    styles.push(`top:${transform.m12}px`);
  }

  // Auto-layout (flex)
  if (isAutoLayout) {
    styles.push('display:flex');
    styles.push(`flex-direction:${stackMode === 'VERTICAL' ? 'column' : 'row'}`);

    const spacing = props['stackSpacing'] as number | undefined;
    if (spacing !== undefined) styles.push(`gap:${spacing}px`);

    const hPad = props['stackHorizontalPadding'] as number | undefined;
    const vPad = props['stackVerticalPadding'] as number | undefined;
    const padRight = props['stackPaddingRight'] as number | undefined;
    const padBottom = props['stackPaddingBottom'] as number | undefined;

    const top = vPad ?? 0;
    const right = padRight ?? hPad ?? 0;
    const bottom = padBottom ?? vPad ?? 0;
    const left = hPad ?? 0;
    if (top || right || bottom || left) {
      styles.push(`padding:${top}px ${right}px ${bottom}px ${left}px`);
    }

    // Alignment
    const counterAlign = props['stackCounterAlignItems'] as string | undefined;
    if (counterAlign) {
      styles.push(`align-items:${mapAlignment(counterAlign)}`);
    }

    const primaryAlign = props['stackPrimaryAlignItems'] as string | undefined;
    if (primaryAlign) {
      styles.push(`justify-content:${mapJustify(primaryAlign)}`);
    }
  }

  // Background
  const fillPaints = props['fillPaints'] as Array<Record<string, unknown>> | undefined;
  if (fillPaints) {
    for (const paint of fillPaints) {
      if (paint['visible'] === false) continue;
      const paintOpacity = paint['opacity'] as number ?? 1;

      if (paint['type'] === 'SOLID') {
        const color = paint['color'] as { r: number; g: number; b: number; a: number };
        styles.push(`background-color:${rgbaToCSS(color, paintOpacity)}`);
      } else if (paint['type'] === 'GRADIENT_LINEAR') {
        const stops = (paint['stops'] ?? paint['colorStops']) as Array<{ color: { r: number; g: number; b: number; a: number }; position: number }> | undefined;
        if (stops && stops.length > 0) {
          const angle = computeGradientAngle(paint['transform'] as { m00: number; m01: number; m10: number; m11: number } | undefined);
          const cssStops = stops.map(s =>
            `${rgbaToCSS(s.color, paintOpacity)} ${(s.position * 100).toFixed(1)}%`
          ).join(', ');
          styles.push(`background:linear-gradient(${angle}deg, ${cssStops})`);
        }
      } else if (paint['type'] === 'GRADIENT_RADIAL') {
        const stops = (paint['stops'] ?? paint['colorStops']) as Array<{ color: { r: number; g: number; b: number; a: number }; position: number }> | undefined;
        if (stops && stops.length > 0) {
          const cssStops = stops.map(s =>
            `${rgbaToCSS(s.color, paintOpacity)} ${(s.position * 100).toFixed(1)}%`
          ).join(', ');
          styles.push(`background:radial-gradient(ellipse at center, ${cssStops})`);
        }
      } else if (paint['type'] === 'IMAGE') {
        const imageDataUri = resolveImageDataUri(paint, images);
        if (imageDataUri) {
          styles.push(`background-image:url(${imageDataUri})`);
          const scaleMode = paint['imageScaleMode'] as string | undefined;
          if (scaleMode === 'FILL') {
            styles.push('background-size:cover');
            styles.push('background-position:center');
          } else if (scaleMode === 'FIT') {
            styles.push('background-size:contain');
            styles.push('background-position:center');
            styles.push('background-repeat:no-repeat');
          } else if (scaleMode === 'TILE') {
            styles.push('background-repeat:repeat');
          } else {
            styles.push('background-size:cover');
            styles.push('background-position:center');
          }
        }
      }
    }
  }

  // Opacity
  const opacity = props['opacity'] as number | undefined;
  if (opacity !== undefined && opacity < 1) {
    styles.push(`opacity:${opacity}`);
  }

  // Border radius
  const rtl = props['rectangleTopLeftCornerRadius'] as number | undefined;
  const rtr = props['rectangleTopRightCornerRadius'] as number | undefined;
  const rbl = props['rectangleBottomLeftCornerRadius'] as number | undefined;
  const rbr = props['rectangleBottomRightCornerRadius'] as number | undefined;
  if (rtl || rtr || rbl || rbr) {
    styles.push(`border-radius:${rtl ?? 0}px ${rtr ?? 0}px ${rbr ?? 0}px ${rbl ?? 0}px`);
  } else {
    const cr = props['cornerRadius'] as number | undefined;
    if (cr) styles.push(`border-radius:${cr}px`);
  }

  // Stroke / border
  const strokePaints = props['strokePaints'] as Array<Record<string, unknown>> | undefined;
  if (strokePaints && strokePaints.length > 0) {
    const stroke = strokePaints[0];
    if (stroke['visible'] !== false && stroke['type'] === 'SOLID') {
      const color = stroke['color'] as { r: number; g: number; b: number; a: number };
      const strokeOpacity = stroke['opacity'] as number ?? 1;

      const btw = props['borderTopWeight'] as number | undefined;
      const bbw = props['borderBottomWeight'] as number | undefined;
      const blw = props['borderLeftWeight'] as number | undefined;
      const brw = props['borderRightWeight'] as number | undefined;
      const sw = props['strokeWeight'] as number ?? 1;

      if (btw !== undefined || bbw !== undefined || blw !== undefined || brw !== undefined) {
        const cssColor = rgbaToCSS(color, strokeOpacity);
        styles.push('border-style:solid');
        styles.push(`border-color:${cssColor}`);
        styles.push(`border-width:${btw ?? sw}px ${brw ?? sw}px ${bbw ?? sw}px ${blw ?? sw}px`);
      } else if (sw > 0) {
        styles.push(`border:${sw}px solid ${rgbaToCSS(color, strokeOpacity)}`);
      }

      const strokeAlign = props['strokeAlign'] as string | undefined;
      if (strokeAlign === 'INSIDE') {
        // border-box is default
      } else if (strokeAlign === 'OUTSIDE') {
        styles.push(`outline:${sw}px solid ${rgbaToCSS(color, strokeOpacity)}`);
        styles.pop(); // remove the border we just added
        // Actually, let's use outline instead for outside strokes
        styles.length = styles.length; // keep as-is, outline is added
      }
    }
  }

  // Effects (shadows)
  const effects = props['effects'] as Array<Record<string, unknown>> | undefined;
  if (effects) {
    const shadows: string[] = [];
    for (const effect of effects) {
      if (effect['visible'] === false) continue;
      const effectType = effect['type'] as string;
      if (effectType === 'DROP_SHADOW' || effectType === 'INNER_SHADOW') {
        const color = effect['color'] as { r: number; g: number; b: number; a: number };
        const offset = effect['offset'] as { x: number; y: number } | undefined;
        const radius = effect['radius'] as number ?? 0;
        const spread = effect['spread'] as number ?? 0;
        const x = offset?.x ?? 0;
        const y = offset?.y ?? 0;
        const inset = effectType === 'INNER_SHADOW' ? 'inset ' : '';
        shadows.push(`${inset}${x}px ${y}px ${radius}px ${spread}px ${rgbaToCSS(color, 1)}`);
      }
    }
    if (shadows.length > 0) {
      styles.push(`box-shadow:${shadows.join(', ')}`);
    }
  }

  // Blend mode
  const blendMode = props['blendMode'] as string | undefined;
  if (blendMode && blendMode !== 'NORMAL' && blendMode !== 'PASS_THROUGH') {
    styles.push(`mix-blend-mode:${blendMode.toLowerCase().replace(/_/g, '-')}`);
  }

  // Clipping
  const frameMaskDisabled = props['frameMaskDisabled'] as boolean | undefined;
  if (type === 'FRAME' || type === 'INSTANCE' || type === 'COMPONENT') {
    if (!frameMaskDisabled) {
      styles.push('overflow:hidden');
    }
  }

  // Text-specific rendering
  if (type === 'TEXT') {
    return renderTextNode(node, styles, images);
  }

  // Ellipse
  if (type === 'ELLIPSE') {
    styles.push('border-radius:50%');
  }

  // VECTOR types - render as colored shape with fill
  if (type === 'VECTOR' || type === 'BOOLEAN_OPERATION' || type === 'STAR' || type === 'REGULAR_POLYGON') {
    const styleStr = styles.join(';');
    return `<div style="${escapeAttr(styleStr)}"></div>`;
  }

  // LINE
  if (type === 'LINE') {
    if (!styles.some(s => s.startsWith('border'))) {
      const strokeP = props['strokePaints'] as Array<Record<string, unknown>> | undefined;
      if (strokeP && strokeP.length > 0 && strokeP[0]['type'] === 'SOLID') {
        const c = strokeP[0]['color'] as { r: number; g: number; b: number; a: number };
        const sw = props['strokeWeight'] as number ?? 1;
        styles.push(`border-bottom:${sw}px solid ${rgbaToCSS(c, 1)}`);
      }
    }
    const styleStr = styles.join(';');
    return `<div style="${escapeAttr(styleStr)}"></div>`;
  }

  // Render children
  let childrenHtml = '';
  const childIsAbsolute = !isAutoLayout;

  if (node.children.length > 0) {
    if (!isAutoLayout) {
      styles.push('position:relative');
    }
    childrenHtml = node.children
      .map(child => renderNode(child, images, childIsAbsolute))
      .join('\n');
  }

  const styleStr = styles.join(';');
  return `<div style="${escapeAttr(styleStr)}">${childrenHtml}</div>`;
}

function renderTextNode(
  node: FigmaNode,
  styles: string[],
  images: Map<string, Buffer>
): string {
  const props = node.properties;

  // Handle textAutoResize - remove fixed size constraints
  const autoResize = props['textAutoResize'] as string | undefined;
  if (autoResize === 'WIDTH_AND_HEIGHT') {
    // Remove both width and height - let text flow naturally
    for (let i = styles.length - 1; i >= 0; i--) {
      if (styles[i].startsWith('width:') || styles[i].startsWith('height:')) {
        styles.splice(i, 1);
      }
    }
  } else if (autoResize === 'HEIGHT') {
    // Keep width, remove height
    for (let i = styles.length - 1; i >= 0; i--) {
      if (styles[i].startsWith('height:')) {
        styles.splice(i, 1);
      }
    }
  }

  // Font
  const fontName = props['fontName'] as { family: string; style: string } | undefined;
  if (fontName) {
    styles.push(`font-family:"${fontName.family}",sans-serif`);
    const style = fontName.style?.toLowerCase() ?? '';
    if (style.includes('bold') || style.includes('black') || style.includes('extrabold')) {
      styles.push('font-weight:700');
    } else if (style.includes('semibold') || style.includes('demibold')) {
      styles.push('font-weight:600');
    } else if (style.includes('medium')) {
      styles.push('font-weight:500');
    } else if (style.includes('light') || style.includes('thin')) {
      styles.push('font-weight:300');
    } else if (style.includes('extralight') || style.includes('ultralight')) {
      styles.push('font-weight:200');
    }
    if (style.includes('italic')) {
      styles.push('font-style:italic');
    }
  }

  // Font size
  const fontSize = props['fontSize'] as number | undefined;
  if (fontSize) styles.push(`font-size:${fontSize}px`);

  // Line height
  const lineHeight = props['lineHeight'] as { value: number; units: string } | undefined;
  if (lineHeight) {
    if (lineHeight.units === 'PERCENT') {
      styles.push(`line-height:${lineHeight.value}%`);
    } else if (lineHeight.units === 'PIXELS') {
      styles.push(`line-height:${lineHeight.value}px`);
    }
  }

  // Letter spacing
  const letterSpacing = props['letterSpacing'] as { value: number; units: string } | undefined;
  if (letterSpacing && letterSpacing.value !== 0) {
    if (letterSpacing.units === 'PIXELS') {
      styles.push(`letter-spacing:${letterSpacing.value}px`);
    } else if (letterSpacing.units === 'PERCENT' && fontSize) {
      styles.push(`letter-spacing:${(letterSpacing.value / 100) * fontSize}px`);
    }
  }

  // Text alignment
  const textAlign = props['textAlignHorizontal'] as string | undefined;
  if (textAlign) {
    styles.push(`text-align:${textAlign.toLowerCase()}`);
  }

  // Text color - use fill paint
  const fillPaints = props['fillPaints'] as Array<Record<string, unknown>> | undefined;
  if (fillPaints && fillPaints.length > 0) {
    const fill = fillPaints[0];
    if (fill['type'] === 'SOLID' && fill['visible'] !== false) {
      const color = fill['color'] as { r: number; g: number; b: number; a: number };
      const paintOpacity = fill['opacity'] as number ?? 1;
      styles.push(`color:${rgbaToCSS(color, paintOpacity)}`);
      // Remove background-color if it was set from fill (text nodes use fill for text color)
      const bgIdx = styles.findIndex(s => s.startsWith('background-color:'));
      if (bgIdx !== -1) styles.splice(bgIdx, 1);
    }
  }

  // Text decoration
  const textDecoration = props['textDecoration'] as string | undefined;
  if (textDecoration === 'UNDERLINE') {
    styles.push('text-decoration:underline');
  } else if (textDecoration === 'STRIKETHROUGH') {
    styles.push('text-decoration:line-through');
  }

  // White space
  styles.push('white-space:pre-wrap');
  styles.push('word-break:break-word');

  // Get text content
  const textData = props['textData'] as { characters: string } | undefined;
  const text = textData?.characters ?? node.name ?? '';

  const styleStr = styles.join(';');
  return `<div style="${escapeAttr(styleStr)}">${escapeHtml(text)}</div>`;
}

function resolveImageDataUri(
  paint: Record<string, unknown>,
  images: Map<string, Buffer>
): string | null {
  // Check for override image
  const overrideKey = paint['_overrideImageKey'] as string | undefined;
  if (overrideKey) {
    const buf = images.get(overrideKey);
    if (buf) {
      const mime = detectMime(buf);
      return `data:${mime};base64,${buf.toString('base64')}`;
    }
  }

  // Original image from hash
  const imageInfo = paint['image'] as { hash: Record<string, number> } | undefined;
  if (!imageInfo?.hash) return null;

  const hex = hashToHex(imageInfo.hash);
  const buf = images.get(hex);
  if (!buf) return null;

  const mime = detectMime(buf);
  return `data:${mime};base64,${buf.toString('base64')}`;
}

function detectMime(buf: Buffer): string {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf[0] === 0x47 && buf[1] === 0x49) return 'image/gif';
  if (buf[0] === 0x52 && buf[1] === 0x49) return 'image/webp';
  return 'image/png';
}

function mapAlignment(align: string): string {
  switch (align) {
    case 'MIN': return 'flex-start';
    case 'CENTER': return 'center';
    case 'MAX': return 'flex-end';
    case 'STRETCH': return 'stretch';
    case 'BASELINE': return 'baseline';
    default: return 'flex-start';
  }
}

function mapJustify(align: string): string {
  switch (align) {
    case 'MIN': return 'flex-start';
    case 'CENTER': return 'center';
    case 'MAX': return 'flex-end';
    case 'SPACE_BETWEEN': return 'space-between';
    default: return 'flex-start';
  }
}

function computeGradientAngle(transform: { m00: number; m01: number; m10: number; m11: number } | undefined): number {
  if (!transform) return 180; // default: top to bottom
  // Figma gradient transform maps from gradient space (0,0)-(1,1) to node space
  // The gradient direction in node space is determined by the transform
  // Start point = (m02, m12), end point = (m00 + m02, m10 + m12)
  const dx = transform.m00;
  const dy = transform.m10;
  // CSS gradient angle: 0deg = bottom to top, 90deg = left to right
  const radians = Math.atan2(dx, -dy);
  let degrees = Math.round(radians * 180 / Math.PI);
  if (degrees < 0) degrees += 360;
  return degrees;
}

function rgbaToCSS(color: { r: number; g: number; b: number; a: number }, opacity: number): string {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const a = color.a * opacity;
  if (a >= 1) return `rgb(${r},${g},${b})`;
  return `rgba(${r},${g},${b},${a.toFixed(3)})`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(str: string): string {
  return str.replace(/"/g, '&quot;');
}
