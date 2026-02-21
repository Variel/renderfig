import * as fs from 'fs';
import * as path from 'path';
import { FigmaNode } from 'parsefig';
import { Override } from './types';
import { findNodeByTarget, hashToHex } from './fig-reader';

export function applyOverrides(
  frame: FigmaNode,
  overrides: Override[],
  images: Map<string, Buffer>,
  framePath?: string
): void {
  for (const override of overrides) {
    const node = findNodeByTarget(frame, override.target, framePath);
    if (!node) {
      console.warn(`Warning: target "${override.target}" not found, skipping override`);
      continue;
    }

    switch (override.type) {
      case 'text':
        applyTextOverride(node, override.value);
        break;
      case 'image':
        applyImageOverride(node, override.src, images);
        break;
      case 'style':
        applyStyleOverride(node, override.props);
        break;
    }
  }
}

function applyTextOverride(node: FigmaNode, value: string): void {
  const textData = node.properties['textData'] as Record<string, unknown> | undefined;
  if (textData) {
    textData['characters'] = value;
  }
  // Also update name if it matches the old text (auto-named text layers)
  if (node.properties['autoRename']) {
    node.name = value;
  }
}

function applyImageOverride(
  node: FigmaNode,
  src: string,
  images: Map<string, Buffer>
): void {
  const absPath = path.resolve(src);
  const imageData = fs.readFileSync(absPath);

  // Generate a unique key for the override image
  const overrideKey = `override_${absPath}`;
  images.set(overrideKey, imageData);

  const fillPaints = node.properties['fillPaints'] as Array<Record<string, unknown>> | undefined;
  if (fillPaints) {
    for (const paint of fillPaints) {
      if (paint['type'] === 'IMAGE') {
        // Replace the image hash with our override key
        paint['_overrideImageKey'] = overrideKey;
      }
    }
  } else {
    // Add an image fill
    node.properties['fillPaints'] = [{
      type: 'IMAGE',
      opacity: 1,
      visible: true,
      blendMode: 'NORMAL',
      imageScaleMode: 'FILL',
      _overrideImageKey: overrideKey,
    }];
  }
}

function applyStyleOverride(
  node: FigmaNode,
  props: Record<string, string | number>
): void {
  for (const [key, value] of Object.entries(props)) {
    switch (key) {
      // --- Position & Size ---
      case 'x': {
        const transform = ensureTransform(node);
        transform['m02'] = Number(value);
        break;
      }
      case 'y': {
        const transform = ensureTransform(node);
        transform['m12'] = Number(value);
        break;
      }
      case 'width': {
        const size = ensureSize(node);
        size['x'] = Number(value);
        break;
      }
      case 'height': {
        const size = ensureSize(node);
        size['y'] = Number(value);
        break;
      }

      // --- Appearance ---
      case 'opacity':
        node.properties['opacity'] = Number(value);
        break;
      case 'visible':
        node.properties['visible'] = String(value) === 'true';
        break;
      case 'color':
      case 'backgroundColor': {
        const color = parseColor(String(value));
        if (color) {
          const fills = node.properties['fillPaints'] as Array<Record<string, unknown>> | undefined;
          if (fills && fills.length > 0) {
            fills[0]['color'] = color;
          } else {
            node.properties['fillPaints'] = [{
              type: 'SOLID',
              color,
              opacity: 1,
              visible: true,
              blendMode: 'NORMAL',
            }];
          }
        }
        break;
      }
      case 'cornerRadius': {
        const r = Number(value);
        node.properties['cornerRadius'] = r;
        node.properties['rectangleTopLeftCornerRadius'] = r;
        node.properties['rectangleTopRightCornerRadius'] = r;
        node.properties['rectangleBottomLeftCornerRadius'] = r;
        node.properties['rectangleBottomRightCornerRadius'] = r;
        break;
      }
      case 'borderRadiusTopLeft':
        node.properties['rectangleTopLeftCornerRadius'] = Number(value);
        break;
      case 'borderRadiusTopRight':
        node.properties['rectangleTopRightCornerRadius'] = Number(value);
        break;
      case 'borderRadiusBottomLeft':
        node.properties['rectangleBottomLeftCornerRadius'] = Number(value);
        break;
      case 'borderRadiusBottomRight':
        node.properties['rectangleBottomRightCornerRadius'] = Number(value);
        break;

      // --- Stroke / Border ---
      case 'strokeColor': {
        const sc = parseColor(String(value));
        if (sc) {
          const strokes = node.properties['strokePaints'] as Array<Record<string, unknown>> | undefined;
          if (strokes && strokes.length > 0) {
            strokes[0]['color'] = sc;
          } else {
            node.properties['strokePaints'] = [{
              type: 'SOLID',
              color: sc,
              opacity: 1,
              visible: true,
              blendMode: 'NORMAL',
            }];
          }
        }
        break;
      }
      case 'strokeWeight':
        node.properties['strokeWeight'] = Number(value);
        node.properties['borderTopWeight'] = Number(value);
        node.properties['borderBottomWeight'] = Number(value);
        node.properties['borderLeftWeight'] = Number(value);
        node.properties['borderRightWeight'] = Number(value);
        break;

      // --- Typography ---
      case 'fontSize':
        node.properties['fontSize'] = Number(value);
        break;
      case 'fontFamily': {
        const fontName = (node.properties['fontName'] as Record<string, string> | undefined) ?? { family: '', style: 'Regular', postscript: '' };
        fontName['family'] = String(value);
        node.properties['fontName'] = fontName;
        break;
      }
      case 'fontWeight':
      case 'fontStyle': {
        const fn = (node.properties['fontName'] as Record<string, string> | undefined) ?? { family: 'sans-serif', style: 'Regular', postscript: '' };
        fn['style'] = String(value);
        node.properties['fontName'] = fn;
        break;
      }
      case 'textAlign':
        node.properties['textAlignHorizontal'] = String(value).toUpperCase();
        break;
      case 'textAlignVertical':
        node.properties['textAlignVertical'] = String(value).toUpperCase();
        break;
      case 'lineHeight':
        node.properties['lineHeight'] = { value: Number(value), units: 'PIXELS' };
        break;
      case 'lineHeightPercent':
        node.properties['lineHeight'] = { value: Number(value), units: 'PERCENT' };
        break;
      case 'letterSpacing':
        node.properties['letterSpacing'] = { value: Number(value), units: 'PIXELS' };
        break;
      case 'textDecoration':
        node.properties['textDecoration'] = String(value).toUpperCase();
        break;

      // --- Auto Layout ---
      case 'gap':
        node.properties['stackSpacing'] = Number(value);
        break;
      case 'padding': {
        const p = Number(value);
        node.properties['stackHorizontalPadding'] = p;
        node.properties['stackVerticalPadding'] = p;
        node.properties['stackPaddingRight'] = p;
        node.properties['stackPaddingBottom'] = p;
        break;
      }
      case 'paddingHorizontal': {
        const ph = Number(value);
        node.properties['stackHorizontalPadding'] = ph;
        node.properties['stackPaddingRight'] = ph;
        break;
      }
      case 'paddingVertical': {
        const pv = Number(value);
        node.properties['stackVerticalPadding'] = pv;
        node.properties['stackPaddingBottom'] = pv;
        break;
      }
      case 'paddingTop':
        node.properties['stackVerticalPadding'] = Number(value);
        break;
      case 'paddingRight':
        node.properties['stackPaddingRight'] = Number(value);
        break;
      case 'paddingBottom':
        node.properties['stackPaddingBottom'] = Number(value);
        break;
      case 'paddingLeft':
        node.properties['stackHorizontalPadding'] = Number(value);
        break;
      case 'alignItems':
        node.properties['stackCounterAlignItems'] = String(value).toUpperCase();
        break;
      case 'justifyContent': {
        const jv = String(value).toUpperCase();
        node.properties['stackPrimaryAlignItems'] = jv === 'SPACE-BETWEEN' ? 'SPACE_BETWEEN' : jv;
        break;
      }

      default:
        // Direct property set for anything else
        node.properties[key] = value;
        break;
    }
  }
}

function ensureTransform(node: FigmaNode): Record<string, number> {
  if (!node.properties['transform']) {
    node.properties['transform'] = { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };
  }
  return node.properties['transform'] as Record<string, number>;
}

function ensureSize(node: FigmaNode): Record<string, number> {
  if (!node.properties['size']) {
    node.properties['size'] = { x: 0, y: 0 };
  }
  return node.properties['size'] as Record<string, number>;
}

function parseColor(hex: string): { r: number; g: number; b: number; a: number } | null {
  const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i);
  if (!m) return null;
  return {
    r: parseInt(m[1], 16) / 255,
    g: parseInt(m[2], 16) / 255,
    b: parseInt(m[3], 16) / 255,
    a: m[4] ? parseInt(m[4], 16) / 255 : 1,
  };
}
