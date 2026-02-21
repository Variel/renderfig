import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { parseFigFile, FigmaNode } from 'parsefig';

export interface FigFileData {
  nodeTree: FigmaNode[];
  images: Map<string, Buffer>;
  blobs: Array<{ bytes: Uint8Array }>;
}

export function readFigFile(filePath: string): FigFileData {
  const result = parseFigFile(filePath);
  const images = extractImages(filePath);
  const blobs = (result.rawMessage as any)?.blobs ?? [];
  return { nodeTree: result.nodeTree, images, blobs };
}

function extractImages(filePath: string): Map<string, Buffer> {
  const images = new Map<string, Buffer>();
  const data = fs.readFileSync(filePath);

  if (data[0] !== 0x50 || data[1] !== 0x4b) return images;

  let eocdOffset = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) {
    if (data.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) return images;

  const cdOffset = data.readUInt32LE(eocdOffset + 16);
  let offset = cdOffset;

  while (offset + 46 < data.length && data.readUInt32LE(offset) === 0x02014b50) {
    const compressionMethod = data.readUInt16LE(offset + 10);
    const compressedSize = data.readUInt32LE(offset + 20);
    const nameLen = data.readUInt16LE(offset + 28);
    const extraLen = data.readUInt16LE(offset + 30);
    const commentLen = data.readUInt16LE(offset + 32);
    const localHeaderOffset = data.readUInt32LE(offset + 42);
    const name = data.subarray(offset + 46, offset + 46 + nameLen).toString('utf-8');

    if (name.startsWith('images/')) {
      const hash = name.slice('images/'.length);
      if (hash) {
        const localNameLen = data.readUInt16LE(localHeaderOffset + 26);
        const localExtraLen = data.readUInt16LE(localHeaderOffset + 28);
        const fileDataOffset = localHeaderOffset + 30 + localNameLen + localExtraLen;
        const fileData = data.subarray(fileDataOffset, fileDataOffset + compressedSize);

        let imageData: Buffer;
        if (compressionMethod === 0) {
          imageData = Buffer.from(fileData);
        } else if (compressionMethod === 8) {
          imageData = Buffer.from(zlib.inflateRawSync(fileData));
        } else {
          offset += 46 + nameLen + extraLen + commentLen;
          continue;
        }
        images.set(hash, imageData);
      }
    }

    offset += 46 + nameLen + extraLen + commentLen;
  }

  return images;
}

export function hashToHex(hash: Record<string, number> | Uint8Array): string {
  const bytes: number[] = [];
  if (hash instanceof Uint8Array) {
    for (const b of hash) bytes.push(b);
  } else {
    const keys = Object.keys(hash).map(Number).sort((a, b) => a - b);
    for (const k of keys) bytes.push(hash[k]);
  }
  return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
}

export function findFrameByPath(
  nodes: FigmaNode[],
  framePath: string
): FigmaNode | null {
  const parts = framePath.split('/');

  function search(nodeList: FigmaNode[], partIndex: number): FigmaNode | null {
    const target = parts[partIndex];
    for (const node of nodeList) {
      if (node.name === target) {
        if (partIndex === parts.length - 1) return node;
        return search(node.children, partIndex + 1);
      }
    }
    return null;
  }

  // Start from Document root's children (canvases)
  const root = nodes[0];
  if (root?.type === 'DOCUMENT') {
    return search(root.children, 0);
  }
  return search(nodes, 0);
}

export function findNodeByTarget(
  root: FigmaNode,
  target: string,
  framePath?: string
): FigmaNode | null {
  // Strip frame path prefix if target starts with it
  let resolved = target;
  if (framePath && resolved.startsWith(framePath + '/')) {
    resolved = resolved.slice(framePath.length + 1);
  }

  const parts = resolved.split('/');

  if (parts.length === 1) {
    // Check for index syntax: "NodeName[n]"
    const { name, index } = parseNameIndex(resolved);
    return findByNameWithIndex(root, name, index);
  }

  // Path match - last part may have index
  const lastPart = parts[parts.length - 1];
  const { name: lastName, index: lastIndex } = parseNameIndex(lastPart);
  const pathParts = [...parts.slice(0, -1), lastName];

  function searchPath(node: FigmaNode, partIndex: number): FigmaNode | null {
    if (node.name === pathParts[partIndex]) {
      if (partIndex === pathParts.length - 1) return node;
      for (const child of node.children) {
        const found = searchPath(child, partIndex + 1);
        if (found) return found;
      }
    }
    for (const child of node.children) {
      const found = searchPath(child, partIndex);
      if (found) return found;
    }
    return null;
  }

  if (lastIndex === 0) {
    return searchPath(root, 0);
  }

  // With index on last part, collect all matches and pick nth
  const matches: FigmaNode[] = [];
  function collectPathMatches(node: FigmaNode, partIndex: number): void {
    if (node.name === pathParts[partIndex]) {
      if (partIndex === pathParts.length - 1) {
        matches.push(node);
        return;
      }
      for (const child of node.children) {
        collectPathMatches(child, partIndex + 1);
      }
    }
    for (const child of node.children) {
      collectPathMatches(child, partIndex);
    }
  }
  collectPathMatches(root, 0);
  return matches[lastIndex] ?? null;
}

/**
 * Parse "NodeName[n]" syntax. Returns name and 0-based index.
 * If no index specified, returns index 0.
 */
function parseNameIndex(part: string): { name: string; index: number } {
  const m = part.match(/^(.+)\[(\d+)\]$/);
  if (m) {
    return { name: m[1], index: parseInt(m[2], 10) };
  }
  return { name: part, index: 0 };
}

function findByNameWithIndex(node: FigmaNode, name: string, index: number): FigmaNode | null {
  if (index === 0) {
    return findByName(node, name);
  }
  // Collect all matches and pick nth
  const matches: FigmaNode[] = [];
  collectByName(node, name, matches);
  return matches[index] ?? null;
}

function collectByName(node: FigmaNode, name: string, results: FigmaNode[]): void {
  if (node.name === name) results.push(node);
  for (const child of node.children) {
    collectByName(child, name, results);
  }
}

function findByName(node: FigmaNode, name: string): FigmaNode | null {
  if (node.name === name) return node;
  for (const child of node.children) {
    const found = findByName(child, name);
    if (found) return found;
  }
  return null;
}

/**
 * Decode Figma vector path blob into SVG path d attribute.
 * Format: command byte + float32LE coordinates
 *   0x00 = Z (close), 0x01 = M (2 floats), 0x02 = L (2 floats), 0x04 = C (6 floats)
 */
export function decodeFillGeometryBlob(bytes: Uint8Array): string {
  const buf = Buffer.from(bytes);
  let offset = 0;
  const parts: string[] = [];

  while (offset < buf.length) {
    const cmd = buf[offset];
    offset++;

    switch (cmd) {
      case 0: // CLOSE
        parts.push('Z');
        break;
      case 1: { // MOVE_TO
        const x = buf.readFloatLE(offset); offset += 4;
        const y = buf.readFloatLE(offset); offset += 4;
        parts.push(`M${fmt(x)} ${fmt(y)}`);
        break;
      }
      case 2: { // LINE_TO
        const x = buf.readFloatLE(offset); offset += 4;
        const y = buf.readFloatLE(offset); offset += 4;
        parts.push(`L${fmt(x)} ${fmt(y)}`);
        break;
      }
      case 3: { // QUAD_TO
        const x1 = buf.readFloatLE(offset); offset += 4;
        const y1 = buf.readFloatLE(offset); offset += 4;
        const x2 = buf.readFloatLE(offset); offset += 4;
        const y2 = buf.readFloatLE(offset); offset += 4;
        parts.push(`Q${fmt(x1)} ${fmt(y1)} ${fmt(x2)} ${fmt(y2)}`);
        break;
      }
      case 4: { // CUBIC_TO
        const x1 = buf.readFloatLE(offset); offset += 4;
        const y1 = buf.readFloatLE(offset); offset += 4;
        const x2 = buf.readFloatLE(offset); offset += 4;
        const y2 = buf.readFloatLE(offset); offset += 4;
        const x3 = buf.readFloatLE(offset); offset += 4;
        const y3 = buf.readFloatLE(offset); offset += 4;
        parts.push(`C${fmt(x1)} ${fmt(y1)} ${fmt(x2)} ${fmt(y2)} ${fmt(x3)} ${fmt(y3)}`);
        break;
      }
      default:
        // Unknown command, stop parsing
        return parts.join(' ');
    }
  }

  return parts.join(' ');
}

function fmt(n: number): string {
  const s = n.toFixed(4);
  // Strip trailing zeros after decimal
  return s.replace(/\.?0+$/, '') || '0';
}
