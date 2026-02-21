import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { parseFigFile, FigmaNode } from 'parsefig';

export interface FigFileData {
  nodeTree: FigmaNode[];
  images: Map<string, Buffer>;
}

export function readFigFile(filePath: string): FigFileData {
  const result = parseFigFile(filePath);
  const images = extractImages(filePath);
  return { nodeTree: result.nodeTree, images };
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
    // Simple name match - search recursively
    return findByName(root, resolved);
  }

  // Path match
  function searchPath(node: FigmaNode, partIndex: number): FigmaNode | null {
    if (node.name === parts[partIndex]) {
      if (partIndex === parts.length - 1) return node;
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

  return searchPath(root, 0);
}

function findByName(node: FigmaNode, name: string): FigmaNode | null {
  if (node.name === name) return node;
  for (const child of node.children) {
    const found = findByName(child, name);
    if (found) return found;
  }
  return null;
}
