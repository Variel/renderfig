#!/usr/bin/env node
import { Command } from 'commander';
import { readFigFile, findFrameByPath } from './fig-reader';
import { renderFrame } from './index';
import { Override, FontMapping } from './types';
import { FigmaNode } from 'parsefig';

const program = new Command();

program
  .name('renderfig')
  .description('Render Figma .fig frames to PNG/JPG')
  .version('0.1.0');

// --- inspect command ---
program
  .command('inspect')
  .description('Inspect .fig file structure')
  .argument('<file>', '.fig file path')
  .argument('[path]', 'Page or frame path to inspect')
  .option('-d, --depth <n>', 'Tree depth (number or "all")', '1')
  .action((file: string, framePath: string | undefined, opts: { depth: string }) => {
    const { nodeTree } = readFigFile(file);
    const maxDepth = opts.depth === 'all' ? Infinity : parseInt(opts.depth, 10);

    const root = nodeTree[0];
    if (!root) {
      console.error('No nodes found in file');
      process.exit(1);
    }

    let targetNodes: FigmaNode[];
    if (framePath) {
      const frame = findFrameByPath(nodeTree, framePath);
      if (!frame) {
        console.error(`"${framePath}" not found`);
        process.exit(1);
      }
      targetNodes = frame.children;
      // Print the frame itself first
      printInspectNode(frame, 0);
      printInspectChildren(frame.children, 1, maxDepth + 1);
    } else {
      // Show canvases (pages)
      if (root.type === 'DOCUMENT') {
        targetNodes = root.children;
      } else {
        targetNodes = nodeTree;
      }
      for (const node of targetNodes) {
        printInspectNode(node, 0);
        if (maxDepth > 1) {
          printInspectChildren(node.children, 1, maxDepth);
        }
      }
    }
  });

function printInspectNode(node: FigmaNode, indent: number): void {
  const prefix = '  '.repeat(indent);
  const type = node.type ? ` [${node.type}]` : '';
  const size = node.properties['size'] as { x: number; y: number } | undefined;
  const sizeStr = size ? ` ${size.x}\u00D7${size.y}` : '';

  const extras: string[] = [];

  // Auto-layout info
  const stackMode = node.properties['stackMode'] as string | undefined;
  if (stackMode) extras.push(`auto-layout: ${stackMode}`);

  // Image detection
  const fillPaints = node.properties['fillPaints'] as Array<Record<string, unknown>> | undefined;
  if (fillPaints?.some(p => p['type'] === 'IMAGE')) extras.push('image');

  // Text content preview
  if (node.type === 'TEXT') {
    const textData = node.properties['textData'] as { characters: string } | undefined;
    const text = textData?.characters ?? '';
    if (text && text !== node.name) {
      const preview = text.length > 40 ? text.substring(0, 40) + '...' : text;
      extras.push(`"${preview}"`);
    }
  }

  const extrasStr = extras.length > 0 ? ` (${extras.join(', ')})` : '';
  console.log(`${prefix}${node.name || '(unnamed)'}${type}${sizeStr}${extrasStr}`);
}

function printInspectChildren(children: FigmaNode[], indent: number, maxDepth: number): void {
  if (indent >= maxDepth) return;
  for (const child of children) {
    printInspectNode(child, indent);
    if (child.children.length > 0 && indent + 1 < maxDepth) {
      printInspectChildren(child.children, indent + 1, maxDepth);
    } else if (child.children.length > 0 && indent + 1 >= maxDepth) {
      const prefix = '  '.repeat(indent + 1);
      console.log(`${prefix}... (${child.children.length} children)`);
    }
  }
}

// --- render command ---
program
  .command('render')
  .description('Render a frame to image')
  .argument('<file>', '.fig file path')
  .argument('<frame>', 'Frame path (e.g., "Page/Frame")')
  .requiredOption('-o, --output <path>', 'Output file path')
  .option('--format <fmt>', 'Output format: png or jpeg')
  .option('--quality <n>', 'JPEG quality (0-100)', parseInt)
  .option('--scale <n>', 'Device scale factor (1, 2, 3)', parseFloat)
  .option('--text <override...>', 'Text override: "NodeName=new text"')
  .option('--image <override...>', 'Image override: "NodeName=./path.jpg"')
  .option('--style <override...>', 'Style override: "NodeName.prop=value"')
  .option('--font <mapping...>', 'Font mapping: "FamilyName=./path/to/font.woff2"')
  .action(async (file: string, frame: string, opts: {
    output: string;
    format?: string;
    quality?: number;
    scale?: number;
    text?: string[];
    image?: string[];
    style?: string[];
    font?: string[];
  }) => {
    const overrides: Override[] = [];

    // Parse text overrides
    if (opts.text) {
      for (const t of opts.text) {
        const eqIdx = t.indexOf('=');
        if (eqIdx === -1) {
          console.error(`Invalid text override: "${t}" (expected "name=value")`);
          process.exit(1);
        }
        overrides.push({
          type: 'text',
          target: t.substring(0, eqIdx),
          value: t.substring(eqIdx + 1),
        });
      }
    }

    // Parse image overrides
    if (opts.image) {
      for (const img of opts.image) {
        const eqIdx = img.indexOf('=');
        if (eqIdx === -1) {
          console.error(`Invalid image override: "${img}" (expected "name=path")`);
          process.exit(1);
        }
        overrides.push({
          type: 'image',
          target: img.substring(0, eqIdx),
          src: img.substring(eqIdx + 1),
        });
      }
    }

    // Parse style overrides
    if (opts.style) {
      const grouped = new Map<string, Record<string, string | number>>();
      for (const s of opts.style) {
        const dotIdx = s.indexOf('.');
        const eqIdx = s.indexOf('=');
        if (dotIdx === -1 || eqIdx === -1 || dotIdx > eqIdx) {
          console.error(`Invalid style override: "${s}" (expected "name.prop=value")`);
          process.exit(1);
        }
        const target = s.substring(0, dotIdx);
        const prop = s.substring(dotIdx + 1, eqIdx);
        const val = s.substring(eqIdx + 1);

        if (!grouped.has(target)) grouped.set(target, {});
        const numVal = Number(val);
        grouped.get(target)![prop] = isNaN(numVal) ? val : numVal;
      }
      for (const [target, props] of grouped) {
        overrides.push({ type: 'style', target, props });
      }
    }

    // Parse font mappings
    const fonts: FontMapping[] = [];
    if (opts.font) {
      for (const f of opts.font) {
        const eqIdx = f.indexOf('=');
        if (eqIdx === -1) {
          console.error(`Invalid font mapping: "${f}" (expected "FamilyName=./path.woff2")`);
          process.exit(1);
        }
        fonts.push({
          family: f.substring(0, eqIdx),
          src: f.substring(eqIdx + 1),
        });
      }
    }

    try {
      await renderFrame({
        figFile: file,
        frameName: frame,
        output: opts.output,
        format: (opts.format as 'png' | 'jpeg') ?? undefined,
        quality: opts.quality,
        scale: opts.scale,
        overrides,
        fonts: fonts.length > 0 ? fonts : undefined,
      });
      console.log(`Rendered to ${opts.output}`);
    } catch (err: unknown) {
      console.error('Render failed:', (err as Error).message);
      process.exit(1);
    }
  });

program.parse();
