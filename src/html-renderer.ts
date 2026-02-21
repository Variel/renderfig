import * as fs from 'fs';
import * as path from 'path';
import { FigmaNode } from 'parsefig';
import { hashToHex, decodeFillGeometryBlob } from './fig-reader';
import { FontMapping } from './types';

export function renderToHtml(
  frame: FigmaNode,
  images: Map<string, Buffer>,
  blobs: Array<{ bytes: Uint8Array }>,
  fonts?: FontMapping[]
): string {
  const width = (frame.properties['size'] as any)?.x ?? 100;
  const height = (frame.properties['size'] as any)?.y ?? 100;

  // Collect all font families used in the tree
  const usedFonts = new Set<string>();
  collectFonts(frame, usedFonts);

  // Build font CSS
  const fontCss = buildFontCss(usedFonts, fonts ?? []);

  const bodyHtml = renderNode(frame, images, blobs, false);

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
  // Collect fonts from styleOverrideTable
  const textData = node.properties['textData'] as { styleOverrideTable?: TextStyleOverride[] } | undefined;
  if (textData?.styleOverrideTable) {
    for (const entry of textData.styleOverrideTable) {
      if (entry.fontName?.family) {
        fonts.add(entry.fontName.family);
      }
    }
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
  blobs: Array<{ bytes: Uint8Array }>,
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

  // Size - handle hug (RESIZE_TO_FIT_WITH_IMPLICIT_SIZE) and fixed sizing
  if (size) {
    const primarySizing = props['stackPrimarySizing'] as string | undefined;
    const counterSizing = props['stackCounterSizing'] as string | undefined;
    const isHugPrimary = primarySizing === 'AUTO' || primarySizing === 'RESIZE_TO_FIT_WITH_IMPLICIT_SIZE';
    const isHugCounter = counterSizing === 'AUTO' || counterSizing === 'RESIZE_TO_FIT_WITH_IMPLICIT_SIZE';

    if (isAutoLayout && isHugPrimary && isHugCounter) {
      // Both axes hug: no fixed dimensions
    } else if (isAutoLayout && isHugPrimary) {
      // Primary hug: fix counter axis only
      if (stackMode === 'VERTICAL') {
        styles.push(`width:${size.x}px`);
      } else {
        styles.push(`height:${size.y}px`);
      }
    } else if (isAutoLayout && isHugCounter) {
      // Counter hug: fix primary axis only
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
    return renderTextNode(node, styles, images, blobs);
  }

  // Ellipse
  if (type === 'ELLIPSE') {
    styles.push('border-radius:50%');
  }

  // VECTOR types - render as SVG if path data available, else colored div
  if (type === 'VECTOR' || type === 'BOOLEAN_OPERATION' || type === 'STAR' || type === 'REGULAR_POLYGON') {
    const fillGeometry = props['fillGeometry'] as Array<{ commandsBlob?: number; windingRule?: string }> | undefined;
    if (fillGeometry && fillGeometry.length > 0 && size) {
      const svgDefs: string[] = [];
      const svgElements: string[] = [];
      let defIdCounter = 0;

      // --- Fill paths ---
      for (const geom of fillGeometry) {
        const blobIdx = geom.commandsBlob;
        if (blobIdx === undefined || !blobs[blobIdx]?.bytes) continue;
        const d = decodeFillGeometryBlob(blobs[blobIdx].bytes);
        if (!d) continue;

        const rule = geom.windingRule === 'ODD' ? 'evenodd' : 'nonzero';

        if (fillPaints && fillPaints.length > 0) {
          for (const fp of fillPaints) {
            if (fp['visible'] === false) continue;
            const paintOpacity = fp['opacity'] as number ?? 1;

            if (fp['type'] === 'SOLID') {
              const c = fp['color'] as { r: number; g: number; b: number; a: number };
              svgElements.push(`<path d="${escapeAttr(d)}" fill="${rgbaToCSS(c, paintOpacity)}" fill-rule="${rule}"/>`);
            } else if (fp['type'] === 'GRADIENT_LINEAR') {
              const stops = (fp['stops'] ?? fp['colorStops']) as Array<{ color: { r: number; g: number; b: number; a: number }; position: number }> | undefined;
              const gradTransform = fp['transform'] as { m00: number; m01: number; m02: number; m10: number; m11: number; m12: number } | undefined;
              if (stops && stops.length > 0) {
                const gradId = `vg${defIdCounter++}`;
                // Figma gradient transform: start=(m02,m12), end=(m00+m02, m10+m12)
                const x1 = gradTransform ? gradTransform.m02 : 0;
                const y1 = gradTransform ? gradTransform.m12 : 0;
                const x2 = gradTransform ? (gradTransform.m00 + gradTransform.m02) : 1;
                const y2 = gradTransform ? (gradTransform.m10 + gradTransform.m12) : 1;
                const gradStops = stops.map(s =>
                  `<stop offset="${(s.position * 100).toFixed(1)}%" stop-color="${rgbaToCSS(s.color, paintOpacity)}"/>`
                ).join('');
                svgDefs.push(`<linearGradient id="${gradId}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" gradientUnits="objectBoundingBox">${gradStops}</linearGradient>`);
                svgElements.push(`<path d="${escapeAttr(d)}" fill="url(#${gradId})" fill-rule="${rule}"/>`);
              }
            } else if (fp['type'] === 'GRADIENT_RADIAL') {
              const stops = (fp['stops'] ?? fp['colorStops']) as Array<{ color: { r: number; g: number; b: number; a: number }; position: number }> | undefined;
              if (stops && stops.length > 0) {
                const gradId = `vg${defIdCounter++}`;
                const gradStops = stops.map(s =>
                  `<stop offset="${(s.position * 100).toFixed(1)}%" stop-color="${rgbaToCSS(s.color, paintOpacity)}"/>`
                ).join('');
                svgDefs.push(`<radialGradient id="${gradId}" cx="0.5" cy="0.5" r="0.5" gradientUnits="objectBoundingBox">${gradStops}</radialGradient>`);
                svgElements.push(`<path d="${escapeAttr(d)}" fill="url(#${gradId})" fill-rule="${rule}"/>`);
              }
            }
          }
        } else {
          svgElements.push(`<path d="${escapeAttr(d)}" fill="currentColor" fill-rule="${rule}"/>`);
        }
      }

      // --- Stroke paths ---
      const strokeGeometry = props['strokeGeometry'] as Array<{ commandsBlob?: number; windingRule?: string }> | undefined;
      if (strokeGeometry && strokeGeometry.length > 0 && strokePaints && strokePaints.length > 0) {
        for (const geom of strokeGeometry) {
          const blobIdx = geom.commandsBlob;
          if (blobIdx === undefined || !blobs[blobIdx]?.bytes) continue;
          const d = decodeFillGeometryBlob(blobs[blobIdx].bytes);
          if (!d) continue;
          const rule = geom.windingRule === 'ODD' ? 'evenodd' : 'nonzero';

          for (const sp of strokePaints) {
            if (sp['visible'] === false) continue;
            if (sp['type'] === 'SOLID') {
              const c = sp['color'] as { r: number; g: number; b: number; a: number };
              const sOpacity = sp['opacity'] as number ?? 1;
              svgElements.push(`<path d="${escapeAttr(d)}" fill="${rgbaToCSS(c, sOpacity)}" fill-rule="${rule}"/>`);
            }
          }
        }
      } else if (strokePaints && strokePaints.length > 0 && fillGeometry) {
        // No strokeGeometry blob: use fill path with SVG stroke attribute
        const sw = props['strokeWeight'] as number ?? 0;
        if (sw > 0) {
          for (const sp of strokePaints) {
            if (sp['visible'] === false) continue;
            if (sp['type'] === 'SOLID') {
              const c = sp['color'] as { r: number; g: number; b: number; a: number };
              const sOpacity = sp['opacity'] as number ?? 1;
              const firstGeom = fillGeometry[0];
              if (firstGeom?.commandsBlob !== undefined && blobs[firstGeom.commandsBlob]?.bytes) {
                const d = decodeFillGeometryBlob(blobs[firstGeom.commandsBlob].bytes);
                if (d) {
                  svgElements.push(`<path d="${escapeAttr(d)}" fill="none" stroke="${rgbaToCSS(c, sOpacity)}" stroke-width="${sw}"/>`);
                }
              }
            }
          }
        }
      }

      if (svgElements.length > 0) {
        const filteredStyles = styles.filter(s => !s.startsWith('background-color:') && !s.startsWith('background:'));
        const styleStr = filteredStyles.join(';');
        const defs = svgDefs.length > 0 ? `<defs>${svgDefs.join('')}</defs>` : '';
        return `<svg style="${escapeAttr(styleStr)}" viewBox="0 0 ${size.x} ${size.y}" xmlns="http://www.w3.org/2000/svg">${defs}${svgElements.join('')}</svg>`;
      }
    }
    // Fallback: colored div
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
      .map(child => renderNode(child, images, blobs, childIsAbsolute))
      .join('\n');
  }

  const styleStr = styles.join(';');
  return `<div style="${escapeAttr(styleStr)}">${childrenHtml}</div>`;
}

interface TextStyleOverride {
  styleID: number;
  fontSize?: number;
  fontName?: { family: string; style: string; postscript?: string };
  lineHeight?: { value: number; units: string };
  letterSpacing?: { value: number; units: string };
  fillPaints?: Array<Record<string, unknown>>;
  textDecoration?: string;
}

function renderTextNode(
  node: FigmaNode,
  styles: string[],
  images: Map<string, Buffer>,
  blobs: Array<{ bytes: Uint8Array }>
): string {
  const props = node.properties;

  // Handle textAutoResize - remove fixed size constraints
  const autoResize = props['textAutoResize'] as string | undefined;
  if (autoResize === 'WIDTH_AND_HEIGHT') {
    for (let i = styles.length - 1; i >= 0; i--) {
      if (styles[i].startsWith('width:') || styles[i].startsWith('height:')) {
        styles.splice(i, 1);
      }
    }
  } else if (autoResize === 'HEIGHT') {
    for (let i = styles.length - 1; i >= 0; i--) {
      if (styles[i].startsWith('height:')) {
        styles.splice(i, 1);
      }
    }
  }

  // Default text styles from node properties
  const defaultFontName = props['fontName'] as { family: string; style: string } | undefined;
  const defaultFontSize = props['fontSize'] as number | undefined;
  const defaultLineHeight = props['lineHeight'] as { value: number; units: string } | undefined;
  const defaultLetterSpacing = props['letterSpacing'] as { value: number; units: string } | undefined;
  const defaultFillPaints = props['fillPaints'] as Array<Record<string, unknown>> | undefined;

  // Apply default font styles to container
  if (defaultFontName) {
    styles.push(`font-family:"${defaultFontName.family}",sans-serif`);
    styles.push(`font-weight:${mapFontWeight(defaultFontName.style)}`);
    if (defaultFontName.style?.toLowerCase().includes('italic')) {
      styles.push('font-style:italic');
    }
  }
  if (defaultFontSize) styles.push(`font-size:${defaultFontSize}px`);

  if (defaultLineHeight) {
    if (defaultLineHeight.units === 'PERCENT') {
      styles.push(`line-height:${defaultLineHeight.value}%`);
    } else if (defaultLineHeight.units === 'PIXELS') {
      styles.push(`line-height:${defaultLineHeight.value}px`);
    } else if (defaultLineHeight.units === 'RAW') {
      styles.push(`line-height:${defaultLineHeight.value}`);
    }
  }

  if (defaultLetterSpacing && defaultLetterSpacing.value !== 0) {
    if (defaultLetterSpacing.units === 'PIXELS') {
      styles.push(`letter-spacing:${defaultLetterSpacing.value}px`);
    } else if (defaultLetterSpacing.units === 'PERCENT' && defaultFontSize) {
      styles.push(`letter-spacing:${(defaultLetterSpacing.value / 100) * defaultFontSize}px`);
    }
  }

  // Text alignment
  const textAlign = props['textAlignHorizontal'] as string | undefined;
  if (textAlign) {
    styles.push(`text-align:${textAlign.toLowerCase()}`);
  }

  // Text color from fill paint
  if (defaultFillPaints && defaultFillPaints.length > 0) {
    const fill = defaultFillPaints[0];
    if (fill['type'] === 'SOLID' && fill['visible'] !== false) {
      const color = fill['color'] as { r: number; g: number; b: number; a: number };
      const paintOpacity = fill['opacity'] as number ?? 1;
      styles.push(`color:${rgbaToCSS(color, paintOpacity)}`);
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

  styles.push('white-space:pre-wrap');
  styles.push('word-break:break-word');

  // Get text content
  const textData = props['textData'] as {
    characters: string;
    characterStyleIDs?: number[];
    styleOverrideTable?: TextStyleOverride[];
  } | undefined;
  const text = textData?.characters ?? node.name ?? '';

  // Check for mixed styles
  const styleIDs = textData?.characterStyleIDs;
  const overrideTable = textData?.styleOverrideTable;

  if (styleIDs && overrideTable && styleIDs.length > 0 && hasMixedStyles(styleIDs)) {
    // Build style map from override table
    const styleMap = new Map<number, TextStyleOverride>();
    for (const entry of overrideTable) {
      styleMap.set(entry.styleID, entry);
    }

    // Group consecutive characters with same styleID into runs
    const runs = buildTextRuns(text, styleIDs);
    const innerHtml = runs.map(run => {
      const override = styleMap.get(run.styleID);
      if (!override || !hasVisualOverride(override, defaultFontName, defaultFontSize, defaultLineHeight, defaultLetterSpacing)) {
        return escapeHtml(run.text);
      }
      const spanStyles = buildSpanStyles(override, defaultFontName, defaultFontSize);
      if (spanStyles.length === 0) return escapeHtml(run.text);
      return `<span style="${escapeAttr(spanStyles.join(';'))}">${escapeHtml(run.text)}</span>`;
    }).join('');

    const styleStr = styles.join(';');
    return `<div style="${escapeAttr(styleStr)}">${innerHtml}</div>`;
  }

  // Simple text (no mixed styles)
  const styleStr = styles.join(';');
  return `<div style="${escapeAttr(styleStr)}">${escapeHtml(text)}</div>`;
}

function hasMixedStyles(styleIDs: number[]): boolean {
  const first = styleIDs[0];
  return styleIDs.some(id => id !== first);
}

function buildTextRuns(text: string, styleIDs: number[]): Array<{ text: string; styleID: number }> {
  const runs: Array<{ text: string; styleID: number }> = [];
  let i = 0;
  while (i < text.length && i < styleIDs.length) {
    const styleID = styleIDs[i];
    let j = i;
    while (j < text.length && j < styleIDs.length && styleIDs[j] === styleID) {
      j++;
    }
    runs.push({ text: text.substring(i, j), styleID });
    i = j;
  }
  // Any remaining text without style IDs
  if (i < text.length) {
    runs.push({ text: text.substring(i), styleID: styleIDs[styleIDs.length - 1] ?? 0 });
  }
  return runs;
}

function hasVisualOverride(
  override: TextStyleOverride,
  defaultFont: { family: string; style: string } | undefined,
  defaultSize: number | undefined,
  defaultLH: { value: number; units: string } | undefined,
  defaultLS: { value: number; units: string } | undefined
): boolean {
  if (override.fontSize && override.fontSize !== defaultSize) return true;
  if (override.fontName && defaultFont) {
    if (override.fontName.family !== defaultFont.family || override.fontName.style !== defaultFont.style) return true;
  }
  if (override.lineHeight) return true;
  if (override.letterSpacing) return true;
  if (override.fillPaints) return true;
  if (override.textDecoration) return true;
  return false;
}

function buildSpanStyles(
  override: TextStyleOverride,
  defaultFont: { family: string; style: string } | undefined,
  defaultFontSize: number | undefined
): string[] {
  const spanStyles: string[] = [];

  if (override.fontName) {
    if (!defaultFont || override.fontName.family !== defaultFont.family) {
      spanStyles.push(`font-family:"${override.fontName.family}",sans-serif`);
    }
    if (!defaultFont || override.fontName.style !== defaultFont.style) {
      spanStyles.push(`font-weight:${mapFontWeight(override.fontName.style)}`);
      if (override.fontName.style?.toLowerCase().includes('italic')) {
        spanStyles.push('font-style:italic');
      }
    }
  }

  if (override.fontSize && override.fontSize !== defaultFontSize) {
    spanStyles.push(`font-size:${override.fontSize}px`);
  }

  if (override.lineHeight) {
    if (override.lineHeight.units === 'PERCENT') {
      spanStyles.push(`line-height:${override.lineHeight.value}%`);
    } else if (override.lineHeight.units === 'PIXELS') {
      spanStyles.push(`line-height:${override.lineHeight.value}px`);
    } else if (override.lineHeight.units === 'RAW') {
      spanStyles.push(`line-height:${override.lineHeight.value}`);
    }
  }

  if (override.letterSpacing && override.letterSpacing.value !== 0) {
    const fs = override.fontSize ?? defaultFontSize ?? 16;
    if (override.letterSpacing.units === 'PIXELS') {
      spanStyles.push(`letter-spacing:${override.letterSpacing.value}px`);
    } else if (override.letterSpacing.units === 'PERCENT') {
      spanStyles.push(`letter-spacing:${(override.letterSpacing.value / 100) * fs}px`);
    }
  }

  if (override.fillPaints && override.fillPaints.length > 0) {
    const fill = override.fillPaints[0];
    if (fill['type'] === 'SOLID' && fill['visible'] !== false) {
      const color = fill['color'] as { r: number; g: number; b: number; a: number };
      const paintOpacity = fill['opacity'] as number ?? 1;
      spanStyles.push(`color:${rgbaToCSS(color, paintOpacity)}`);
    }
  }

  if (override.textDecoration === 'UNDERLINE') {
    spanStyles.push('text-decoration:underline');
  } else if (override.textDecoration === 'STRIKETHROUGH') {
    spanStyles.push('text-decoration:line-through');
  }

  return spanStyles;
}

function mapFontWeight(style: string | undefined): number {
  const s = (style ?? '').toLowerCase();
  if (s.includes('black') || s.includes('extrabold') || s.includes('extra bold')) return 800;
  if (s.includes('bold')) return 700;
  if (s.includes('semibold') || s.includes('semi bold') || s.includes('demibold')) return 600;
  if (s.includes('medium')) return 500;
  if (s.includes('regular') || s.includes('normal') || s === '') return 400;
  if (s.includes('light') && !s.includes('extra') && !s.includes('ultra')) return 300;
  if (s.includes('extralight') || s.includes('extra light') || s.includes('ultralight') || s.includes('ultra light')) return 200;
  if (s.includes('thin') || s.includes('hairline')) return 100;
  return 400;
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
