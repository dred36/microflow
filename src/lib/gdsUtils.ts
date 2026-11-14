/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  GdsLayoutData,
  GdsLayerInfo,
  GdsPatternType,
  GdsPoint,
  GdsSectionLine,
  GdsShape,
  MaskWindow,
  PhotomaskLevel,
} from '../types/microfab';
import { RETICLE_PALETTE } from './maskUtils';

export const GDS_LAYER_PALETTE = [
  ...RETICLE_PALETTE,
  '#f97316', // Orange
  '#84cc16', // Lime
  '#06b6d4', // Cyan
  '#e879f9', // Fuchsia
];

export const GDS_PATTERN_OPTIONS: {
  id: GdsPatternType;
  label: string;
  shortLabel: string;
}[] = [
  { id: 'diagonal-right', label: 'Diagonal 45° (/)', shortLabel: '45° /' },
  { id: 'diagonal-left', label: 'Diagonal -45° (\\)', shortLabel: '-45° \\' },
  { id: 'crosshatch', label: 'Crosshatch (✕)', shortLabel: 'Cross ✕' },
  { id: 'horizontal', label: 'Horizontal (≡)', shortLabel: 'Horiz ≡' },
  { id: 'vertical', label: 'Vertical (|||)', shortLabel: 'Vert |||' },
  { id: 'dots', label: 'Dots (•••)', shortLabel: 'Dots •' },
  { id: 'stipple', label: 'Stipple (∵)', shortLabel: 'Stipple' },
  { id: 'solid', label: 'Solid Tint', shortLabel: 'Solid' },
  { id: 'outline', label: 'Outline Only', shortLabel: 'Outline' },
];

export const DEFAULT_GDS_LAYER_PATTERNS: GdsPatternType[] = [
  'diagonal-right',
  'diagonal-left',
  'crosshatch',
  'horizontal',
  'vertical',
  'dots',
  'stipple',
];

/**
 * Sorts shapes so layers near index 0 of `layers` (top of the layer stack UI)
 * are returned last (drawn on top in SVG paint order), preserving relative order within each layer.
 */
export function sortShapesByLayerOrder(
  shapes: GdsShape[],
  layers: GdsLayerInfo[]
): GdsShape[] {
  const rank = new Map<number, number>();
  const n = layers.length;
  layers.forEach((l, idx) => {
    rank.set(l.layer, n - idx);
  });
  return [...shapes].sort((a, b) => (rank.get(a.layer) ?? 0) - (rank.get(b.layer) ?? 0));
}

export const SECTION_LINE_COLORS = [
  '#fbbf24', // Amber (A-A')
  '#22d3ee', // Cyan (B-B')
  '#34d399', // Emerald (C-C')
  '#f472b6', // Pink (D-D')
  '#a78bfa', // Violet (E-E')
  '#fb923c', // Orange (F-F')
];

/**
 * Extracts start & end marker tags from a section cut label (e.g. "A-A'" -> ["A", "A'"]).
 */
export function getSectionEndLabels(label: string): [string, string] {
  const trimmed = (label || "A-A'").trim();
  const dashIdx = trimmed.indexOf('-');
  if (dashIdx > 0 && dashIdx < trimmed.length - 1) {
    return [trimmed.slice(0, dashIdx).trim(), trimmed.slice(dashIdx + 1).trim()];
  }
  return [trimmed, `${trimmed}'`];
}

/**
 * Picks the next available section cut label ("A-A'", "B-B'", "C-C'", ...).
 */
export function getNextSectionLabel(existing: GdsSectionLine[]): string {
  const used = new Set(existing.map((s) => s.label.trim().toUpperCase()));
  for (let i = 0; i < 26; i++) {
    const ch = String.fromCharCode(65 + i);
    const candidate = `${ch}-${ch}'`;
    if (!used.has(candidate)) return candidate;
  }
  let idx = 1;
  while (used.has(`S${idx}-S${idx}'`)) idx++;
  return `S${idx}-S${idx}'`;
}

/**
 * Normalizes multi-cut sectionLines & activeSectionLine from GdsLayoutData
 * with full backward compatibility for legacy single `sectionLine`.
 */
export function getLayoutSectionLines(
  layout: GdsLayoutData,
  fallbackWidth: number = 10000
): { sectionLines: GdsSectionLine[]; activeSectionLine: GdsSectionLine } {
  const rawList =
    layout.sectionLines && layout.sectionLines.length > 0
      ? layout.sectionLines
      : layout.sectionLine
      ? [layout.sectionLine]
      : [
          {
            id: 'sec_default_a',
            label: "A-A'",
            x1: 0,
            y1: Math.round(fallbackWidth * 0.5),
            x2: fallbackWidth,
            y2: Math.round(fallbackWidth * 0.5),
            color: SECTION_LINE_COLORS[0],
            resizeWaferToCut: false,
          },
        ];

  const sectionLines = rawList.map((s, idx) => ({
    ...s,
    color: s.color || SECTION_LINE_COLORS[idx % SECTION_LINE_COLORS.length],
  }));

  const activeSectionLine =
    sectionLines.find((s) => s.id === layout.activeSectionId) || sectionLines[0];

  return { sectionLines, activeSectionLine };
}

/**
 * Decodes an 8-byte IBM Excess-64 floating-point number used in GDSII stream files.
 */
function readIbmFloat64(view: DataView, offset: number): number {
  const b0 = view.getUint8(offset);
  const sign = (b0 & 0x80) !== 0 ? -1 : 1;
  const exponent = (b0 & 0x7f) - 64;

  let mantissa = 0;
  for (let i = 1; i < 8; i++) {
    mantissa = mantissa * 256 + view.getUint8(offset + i);
  }
  if (mantissa === 0) return 0;

  return sign * (mantissa / 72057594037927936) * Math.pow(16, exponent);
}

interface RawGdsElement {
  kind: 'boundary' | 'path' | 'box' | 'sref' | 'aref';
  layer: number;
  datatype: number;
  points: GdsPoint[];
  width?: number;
  pathtype?: number;
  sname?: string;
  strans?: number;
  mag?: number;
  angle?: number;
  cols?: number;
  rows?: number;
}

interface RawGdsStructure {
  name: string;
  elements: RawGdsElement[];
}

/**
 * Parses a binary GDSII stream (.gds / .gds2 / .gdsii) into flattened nanometer 2D layout data.
 */
export function parseGdsFile(
  buffer: ArrayBuffer,
  fileName?: string,
  existingMasks?: PhotomaskLevel[]
): GdsLayoutData {
  const view = new DataView(buffer);
  const len = view.byteLength;
  if (len < 4) {
    throw new Error('File is too small to be a valid GDSII stream.');
  }

  let offset = 0;
  let libName = fileName?.replace(/\.(gds2?|gdsii|sf)$/i, '') || 'Imported GDS';
  let dbuToNm = 1; // Default 1 DBU = 1 nm if UNITS absent

  const structures = new Map<string, RawGdsStructure>();
  let currentStruct: RawGdsStructure | null = null;
  let currentEl: RawGdsElement | null = null;

  const readAscii = (start: number, byteLen: number): string => {
    let str = '';
    for (let i = 0; i < byteLen; i++) {
      const ch = view.getUint8(start + i);
      if (ch === 0) break;
      str += String.fromCharCode(ch);
    }
    return str.trim();
  };

  while (offset + 4 <= len) {
    const recLen = view.getUint16(offset, false);
    if (recLen < 4 || offset + recLen > len) break;

    const recType = view.getUint8(offset + 2);
    const dataType = view.getUint8(offset + 3);
    const payloadStart = offset + 4;
    const payloadLen = recLen - 4;

    switch (recType) {
      case 0x02: {
        // LIBNAME
        if (dataType === 0x06 && payloadLen > 0) {
          libName = readAscii(payloadStart, payloadLen) || libName;
        }
        break;
      }
      case 0x03: {
        // UNITS: [0] = dbu in user units, [1] = dbu in meters
        if (dataType === 0x05 && payloadLen >= 16) {
          const dbuInMeters = readIbmFloat64(view, payloadStart + 8);
          if (dbuInMeters > 0 && Number.isFinite(dbuInMeters)) {
            dbuToNm = dbuInMeters * 1e9;
          }
        }
        break;
      }
      case 0x05: {
        // BGNSTR
        currentStruct = { name: `CELL_${structures.size + 1}`, elements: [] };
        break;
      }
      case 0x06: {
        // STRNAME
        if (currentStruct && dataType === 0x06) {
          currentStruct.name = readAscii(payloadStart, payloadLen) || currentStruct.name;
        }
        break;
      }
      case 0x07: {
        // ENDSTR
        if (currentStruct) {
          structures.set(currentStruct.name, currentStruct);
          currentStruct = null;
        }
        break;
      }
      case 0x08: {
        // BOUNDARY
        currentEl = { kind: 'boundary', layer: 0, datatype: 0, points: [] };
        break;
      }
      case 0x09: {
        // PATH
        currentEl = { kind: 'path', layer: 0, datatype: 0, points: [], width: 0, pathtype: 0 };
        break;
      }
      case 0x0a: {
        // SREF
        currentEl = { kind: 'sref', layer: 0, datatype: 0, points: [], strans: 0, mag: 1, angle: 0 };
        break;
      }
      case 0x0b: {
        // AREF
        currentEl = {
          kind: 'aref',
          layer: 0,
          datatype: 0,
          points: [],
          strans: 0,
          mag: 1,
          angle: 0,
          cols: 1,
          rows: 1,
        };
        break;
      }
      case 0x2d: {
        // BOX
        currentEl = { kind: 'box', layer: 0, datatype: 0, points: [] };
        break;
      }
      case 0x0d: {
        // LAYER
        if (currentEl && dataType === 0x02 && payloadLen >= 2) {
          currentEl.layer = view.getInt16(payloadStart, false);
        }
        break;
      }
      case 0x0e: {
        // DATATYPE or NODETYPE
        if (currentEl && dataType === 0x02 && payloadLen >= 2) {
          currentEl.datatype = view.getInt16(payloadStart, false);
        }
        break;
      }
      case 0x0f: {
        // WIDTH
        if (currentEl && dataType === 0x03 && payloadLen >= 4) {
          currentEl.width = Math.abs(view.getInt32(payloadStart, false));
        }
        break;
      }
      case 0x10: {
        // XY
        if (currentEl && dataType === 0x03 && payloadLen >= 8) {
          const numPts = Math.floor(payloadLen / 8);
          for (let p = 0; p < numPts; p++) {
            const x = view.getInt32(payloadStart + p * 8, false);
            const y = view.getInt32(payloadStart + p * 8 + 4, false);
            currentEl.points.push({ x, y });
          }
        }
        break;
      }
      case 0x11: {
        // ENDEL
        if (currentEl && currentStruct) {
          currentStruct.elements.push(currentEl);
        }
        currentEl = null;
        break;
      }
      case 0x12: {
        // SNAME
        if (currentEl && dataType === 0x06) {
          currentEl.sname = readAscii(payloadStart, payloadLen);
        }
        break;
      }
      case 0x13: {
        // COLROW
        if (currentEl && dataType === 0x02 && payloadLen >= 4) {
          currentEl.cols = Math.max(1, view.getInt16(payloadStart, false));
          currentEl.rows = Math.max(1, view.getInt16(payloadStart + 2, false));
        }
        break;
      }
      case 0x1a: {
        // STRANS
        if (currentEl && dataType === 0x02 && payloadLen >= 2) {
          currentEl.strans = view.getUint16(payloadStart, false);
        }
        break;
      }
      case 0x1b: {
        // MAG
        if (currentEl && dataType === 0x05 && payloadLen >= 8) {
          const mag = readIbmFloat64(view, payloadStart);
          if (mag > 0 && Number.isFinite(mag)) currentEl.mag = mag;
        }
        break;
      }
      case 0x1c: {
        // ANGLE
        if (currentEl && dataType === 0x05 && payloadLen >= 8) {
          const angle = readIbmFloat64(view, payloadStart);
          if (Number.isFinite(angle)) currentEl.angle = angle;
        }
        break;
      }
      case 0x21: {
        // PATHTYPE
        if (currentEl && dataType === 0x02 && payloadLen >= 2) {
          currentEl.pathtype = view.getInt16(payloadStart, false);
        }
        break;
      }
      case 0x04: {
        // ENDLIB
        offset = len;
        break;
      }
    }

    offset += recLen;
  }

  if (structures.size === 0) {
    throw new Error('No GDSII cell structures found in file.');
  }

  // Determine top cell(s) (structures never referenced by SREF/AREF)
  const referenced = new Set<string>();
  for (const st of structures.values()) {
    for (const el of st.elements) {
      if ((el.kind === 'sref' || el.kind === 'aref') && el.sname) {
        referenced.add(el.sname);
      }
    }
  }
  const topCells = Array.from(structures.values()).filter((s) => !referenced.has(s.name));
  const rootCells =
    topCells.length > 0 ? topCells : [Array.from(structures.values())[structures.size - 1]];

  const shapes: GdsShape[] = [];
  const layerMap = new Map<string, GdsLayerInfo>();
  let shapeCounter = 0;

  interface Matrix2D {
    a: number;
    b: number;
    c: number;
    d: number;
    tx: number;
    ty: number;
    scale: number;
  }

  const identity: Matrix2D = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0, scale: 1 };

  const composeTransform = (
    parent: Matrix2D,
    px: number,
    py: number,
    strans: number,
    mag: number,
    angleDeg: number
  ): Matrix2D => {
    const reflectY = (strans & 0x8000) !== 0 ? -1 : 1;
    const rad = (angleDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    // Local linear matrix: R(angle) * Scale(mag) * ReflectY
    const la = cos * mag;
    const lb = -sin * mag * reflectY;
    const lc = sin * mag;
    const ld = cos * mag * reflectY;

    return {
      a: parent.a * la + parent.b * lc,
      b: parent.a * lb + parent.b * ld,
      c: parent.c * la + parent.d * lc,
      d: parent.c * lb + parent.d * ld,
      tx: parent.a * px + parent.b * py + parent.tx,
      ty: parent.c * px + parent.d * py + parent.ty,
      scale: parent.scale * mag,
    };
  };

  const applyTransform = (m: Matrix2D, pt: GdsPoint): GdsPoint => ({
    x: (m.a * pt.x + m.b * pt.y + m.tx) * dbuToNm,
    y: (m.c * pt.x + m.d * pt.y + m.ty) * dbuToNm,
  });

  const ensureLayer = (layer: number, datatype: number) => {
    const key = `${layer}:${datatype}`;
    if (!layerMap.has(key)) {
      const idx = layerMap.size;
      const linkedMask = existingMasks?.[idx];
      layerMap.set(key, {
        layer,
        datatype,
        name: `L${layer}/${datatype}`,
        color: GDS_LAYER_PALETTE[idx % GDS_LAYER_PALETTE.length],
        visible: true,
        pattern: DEFAULT_GDS_LAYER_PATTERNS[idx % DEFAULT_GDS_LAYER_PATTERNS.length],
        assignedMaskId: linkedMask?.id,
      });
    }
  };

  const MAX_SHAPES = 8000;
  const flattenCell = (cell: RawGdsStructure, xform: Matrix2D, depth: number) => {
    if (depth > 16 || shapes.length >= MAX_SHAPES) return;

    for (const el of cell.elements) {
      if (shapes.length >= MAX_SHAPES) break;

      if (el.kind === 'sref' && el.sname && el.points.length > 0) {
        const child = structures.get(el.sname);
        if (child) {
          const p0 = el.points[0];
          const childXform = composeTransform(
            xform,
            p0.x,
            p0.y,
            el.strans || 0,
            el.mag || 1,
            el.angle || 0
          );
          flattenCell(child, childXform, depth + 1);
        }
        continue;
      }

      if (el.kind === 'aref' && el.sname && el.points.length >= 3) {
        const child = structures.get(el.sname);
        if (child) {
          const cols = Math.min(200, Math.max(1, el.cols || 1));
          const rows = Math.min(200, Math.max(1, el.rows || 1));
          const p0 = el.points[0];
          const p1 = el.points[1];
          const p2 = el.points[2];
          const colStepX = (p1.x - p0.x) / cols;
          const colStepY = (p1.y - p0.y) / cols;
          const rowStepX = (p2.x - p0.x) / rows;
          const rowStepY = (p2.y - p0.y) / rows;

          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              if (shapes.length >= MAX_SHAPES) break;
              const px = p0.x + c * colStepX + r * rowStepX;
              const py = p0.y + c * colStepY + r * rowStepY;
              const childXform = composeTransform(
                xform,
                px,
                py,
                el.strans || 0,
                el.mag || 1,
                el.angle || 0
              );
              flattenCell(child, childXform, depth + 1);
            }
          }
        }
        continue;
      }

      if (el.kind === 'boundary' || el.kind === 'box') {
        if (el.points.length < 3) continue;
        const pts = el.points.map((pt) => applyTransform(xform, pt));
        // Strip duplicate closing vertex if present
        if (
          pts.length > 3 &&
          Math.abs(pts[0].x - pts[pts.length - 1].x) < 1e-4 &&
          Math.abs(pts[0].y - pts[pts.length - 1].y) < 1e-4
        ) {
          pts.pop();
        }
        if (pts.length < 3) continue;

        ensureLayer(el.layer, el.datatype);
        shapeCounter++;

        // Detect axis-aligned rectangle for cleaner editing
        if (pts.length === 4) {
          const xs = pts.map((p) => p.x);
          const ys = pts.map((p) => p.y);
          const uniqueXs = new Set(xs.map((v) => Math.round(v * 10)));
          const uniqueYs = new Set(ys.map((v) => Math.round(v * 10)));
          if (uniqueXs.size === 2 && uniqueYs.size === 2) {
            const minX = Math.min(...xs);
            const maxX = Math.max(...xs);
            const minY = Math.min(...ys);
            const maxY = Math.max(...ys);
            shapes.push({
              id: `gds_s_${Date.now()}_${shapeCounter}`,
              type: 'rect',
              layer: el.layer,
              datatype: el.datatype,
              x: Math.round(minX * 10) / 10,
              y: Math.round(minY * 10) / 10,
              width: Math.round((maxX - minX) * 10) / 10,
              height: Math.round((maxY - minY) * 10) / 10,
            });
            continue;
          }
        }

        shapes.push({
          id: `gds_s_${Date.now()}_${shapeCounter}`,
          type: 'polygon',
          layer: el.layer,
          datatype: el.datatype,
          points: pts.map((p) => ({
            x: Math.round(p.x * 10) / 10,
            y: Math.round(p.y * 10) / 10,
          })),
        });
      } else if (el.kind === 'path' && el.points.length >= 2) {
        const pts = el.points.map((pt) => applyTransform(xform, pt));
        const pathWidthNm = Math.max(10, (el.width || 100) * xform.scale * dbuToNm);
        ensureLayer(el.layer, el.datatype);
        shapeCounter++;
        shapes.push({
          id: `gds_s_${Date.now()}_${shapeCounter}`,
          type: 'path',
          layer: el.layer,
          datatype: el.datatype,
          points: pts.map((p) => ({
            x: Math.round(p.x * 10) / 10,
            y: Math.round(p.y * 10) / 10,
          })),
          pathWidth: Math.round(pathWidthNm * 10) / 10,
        });
      }
    }
  };

  flattenCell(rootCells[0], identity, 0);

  const layers = Array.from(layerMap.values()).sort((a, b) => a.layer - b.layer);
  const bounds = computeGdsBounds(shapes);
  const midY = Math.round((bounds.minY + bounds.maxY) * 0.5);
  const initialCut: GdsSectionLine = {
    id: `sec_${Date.now()}`,
    label: "A-A'",
    x1: Math.round(bounds.minX),
    y1: midY,
    x2: Math.round(bounds.maxX),
    y2: midY,
    color: SECTION_LINE_COLORS[0],
    resizeWaferToCut: false,
  };

  return {
    name: libName,
    layers,
    shapes,
    sectionLine: initialCut,
    sectionLines: [initialCut],
    activeSectionId: initialCut.id,
  };
}

/**
 * Computes the bounding box of all GDS shapes in nm.
 */
export function computeGdsBounds(
  shapes: GdsShape[],
  fallbackWidth: number = 10000
): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const s of shapes) {
    if (s.type === 'rect') {
      const x = s.x ?? 0;
      const y = s.y ?? 0;
      const w = s.width ?? 0;
      const h = s.height ?? 0;
      if (x < minX) minX = x;
      if (x + w > maxX) maxX = x + w;
      if (y < minY) minY = y;
      if (y + h > maxY) maxY = y + h;
    } else if (s.type === 'circle') {
      const cx = s.cx ?? 0;
      const cy = s.cy ?? 0;
      const r = s.radius ?? 0;
      if (cx - r < minX) minX = cx - r;
      if (cx + r > maxX) maxX = cx + r;
      if (cy - r < minY) minY = cy - r;
      if (cy + r > maxY) maxY = cy + r;
    } else if (s.points && s.points.length > 0) {
      const pad = s.type === 'path' ? (s.pathWidth ?? 200) * 0.5 : 0;
      for (const p of s.points) {
        if (p.x - pad < minX) minX = p.x - pad;
        if (p.x + pad > maxX) maxX = p.x + pad;
        if (p.y - pad < minY) minY = p.y - pad;
        if (p.y + pad > maxY) maxY = p.y + pad;
      }
    }
  }

  if (!Number.isFinite(minX)) {
    return { minX: 0, maxX: fallbackWidth, minY: 0, maxY: fallbackWidth };
  }
  return { minX, maxX, minY, maxY };
}

/**
 * Converts any GdsShape into one or more closed polygons for rendering and exact section slicing.
 */
export function shapeToPolygons(shape: GdsShape): GdsPoint[][] {
  if (shape.type === 'rect') {
    const x = shape.x ?? 0;
    const y = shape.y ?? 0;
    const w = Math.max(0, shape.width ?? 0);
    const h = Math.max(0, shape.height ?? 0);
    if (w <= 0 || h <= 0) return [];
    return [
      [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
      ],
    ];
  }

  if (shape.type === 'circle') {
    const cx = shape.cx ?? 0;
    const cy = shape.cy ?? 0;
    const r = Math.max(0, shape.radius ?? 0);
    if (r <= 0) return [];
    const pts: GdsPoint[] = [];
    const N = 32;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    return [pts];
  }

  if (shape.type === 'polygon') {
    if (!shape.points || shape.points.length < 3) return [];
    return [shape.points];
  }

  if (shape.type === 'path') {
    const pts = shape.points;
    if (!pts || pts.length < 2) return [];
    const halfW = Math.max(5, (shape.pathWidth ?? 200) * 0.5);
    const polys: GdsPoint[][] = [];

    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i];
      const p1 = pts[i + 1];
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-3) continue;
      const nx = (-dy / len) * halfW;
      const ny = (dx / len) * halfW;
      polys.push([
        { x: p0.x + nx, y: p0.y + ny },
        { x: p1.x + nx, y: p1.y + ny },
        { x: p1.x - nx, y: p1.y - ny },
        { x: p0.x - nx, y: p0.y - ny },
      ]);
    }

    // Add circular joint caps at interior/end vertices so bends have zero gaps
    for (let i = 0; i < pts.length; i++) {
      const c = pts[i];
      const cap: GdsPoint[] = [];
      const N = 16;
      for (let k = 0; k < N; k++) {
        const a = (k / N) * Math.PI * 2;
        cap.push({ x: c.x + halfW * Math.cos(a), y: c.y + halfW * Math.sin(a) });
      }
      polys.push(cap);
    }
    return polys;
  }

  return [];
}

/**
 * Intersects a finite section line P1->P2 with a closed polygon using exact rotated scanline crossings.
 * Returns normalized distance intervals [sStart, sEnd] in [0, lineLength].
 */
function intersectLineWithPolygon(
  x1: number,
  y1: number,
  ux: number,
  uy: number,
  lineLen: number,
  poly: GdsPoint[]
): [number, number][] {
  if (poly.length < 3 || lineLen <= 1e-3) return [];

  // Transform vertices to section-line frame: s along cut, d perpendicular distance
  const vx = -uy;
  const vy = ux;
  const local = poly.map((p) => {
    const dx = p.x - x1;
    const dy = p.y - y1;
    return {
      s: dx * ux + dy * uy,
      d: dx * vx + dy * vy,
    };
  });

  const crossings: number[] = [];
  for (let i = 0; i < local.length; i++) {
    const a = local[i];
    const b = local[(i + 1) % local.length];

    // Standard half-open crossing rule avoids double-counting vertices
    if ((a.d <= 0 && b.d > 0) || (b.d <= 0 && a.d > 0)) {
      const t = (0 - a.d) / (b.d - a.d);
      crossings.push(a.s + t * (b.s - a.s));
    }
  }

  if (crossings.length < 2) return [];
  crossings.sort((a, b) => a - b);

  const intervals: [number, number][] = [];
  for (let i = 0; i + 1 < crossings.length; i += 2) {
    const sA = Math.max(0, crossings[i]);
    const sB = Math.min(lineLen, crossings[i + 1]);
    if (sB - sA > 1) {
      intervals.push([sA, sB]);
    }
  }
  return intervals;
}

/**
 * Returns the ordered polyline vertices (>= 2) of a GdsSectionLine, falling back to (x1,y1)->(x2,y2).
 */
export function getSectionPoints(section: GdsSectionLine): GdsPoint[] {
  if (section.points && section.points.length >= 2) {
    return section.points;
  }
  return [
    { x: section.x1, y: section.y1 },
    { x: section.x2, y: section.y2 },
  ];
}

/**
 * Returns a GdsSectionLine with `points` updated and legacy `x1/y1/x2/y2` synced to first/last point.
 */
export function withSectionPoints(
  section: GdsSectionLine,
  pts: GdsPoint[]
): GdsSectionLine {
  const safePts = pts.length >= 2 ? pts : getSectionPoints(section);
  const first = safePts[0];
  const last = safePts[safePts.length - 1];
  return {
    ...section,
    x1: first.x,
    y1: first.y,
    x2: last.x,
    y2: last.y,
    points: safePts,
  };
}

/**
 * Computes total arc length along all segments of a section cut.
 */
export function getSectionTotalLength(section: GdsSectionLine): number {
  const pts = getSectionPoints(section);
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    total += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
  }
  return total;
}

/**
 * Returns the world coordinate at 50% arc length along a (possibly bent) section cut polyline.
 */
export function getSectionMidpoint(section: GdsSectionLine): GdsPoint {
  const pts = getSectionPoints(section);
  const total = getSectionTotalLength(section);
  if (total <= 1e-3 || pts.length < 2) {
    return {
      x: (section.x1 + section.x2) * 0.5,
      y: (section.y1 + section.y2) * 0.5,
    };
  }
  const target = total * 0.5;
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const segLen = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    if (acc + segLen >= target && segLen > 1e-6) {
      const t = (target - acc) / segLen;
      return {
        x: pts[i].x + (pts[i + 1].x - pts[i].x) * t,
        y: pts[i].y + (pts[i + 1].y - pts[i].y) * t,
      };
    }
    acc += segLen;
  }
  return pts[pts.length - 1];
}

/**
 * Maps an arc-length interval [sA, sB] onto concrete 2D subsegments along a polyline section cut.
 */
export function arcIntervalToPolylineSegments(
  pts: GdsPoint[],
  sA: number,
  sB: number
): { p1: GdsPoint; p2: GdsPoint }[] {
  const out: { p1: GdsPoint; p2: GdsPoint }[] = [];
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    if (segLen <= 1e-3) continue;
    const segStart = acc;
    const segEnd = acc + segLen;
    const ovA = Math.max(sA, segStart);
    const ovB = Math.min(sB, segEnd);
    if (ovB - ovA > 1e-3) {
      const tA = (ovA - segStart) / segLen;
      const tB = (ovB - segStart) / segLen;
      out.push({
        p1: { x: a.x + (b.x - a.x) * tA, y: a.y + (b.y - a.y) * tA },
        p2: { x: a.x + (b.x - a.x) * tB, y: a.y + (b.y - a.y) * tB },
      });
    }
    acc = segEnd;
  }
  return out;
}

/**
 * Computes exact merged 1D intervals [sStart, sEnd] (in cut arc-length coordinates [0, cutLength])
 * where the (possibly multi-point) section cut crosses shapes on the specified GDS layer.
 */
export function computeRawSectionIntervals(
  shapes: GdsShape[],
  layer: number,
  section: GdsSectionLine
): { cutLength: number; intervals: [number, number][] } {
  const pts = getSectionPoints(section);
  if (pts.length < 2) return { cutLength: 0, intervals: [] };

  // Pre-collect polygons on the target layer once
  const layerPolys: GdsPoint[][] = [];
  for (const shape of shapes) {
    if (shape.layer !== layer) continue;
    layerPolys.push(...shapeToPolygons(shape));
  }

  let cutLength = 0;
  const raw: [number, number][] = [];

  for (let i = 0; i < pts.length - 1; i++) {
    const pA = pts[i];
    const pB = pts[i + 1];
    const dx = pB.x - pA.x;
    const dy = pB.y - pA.y;
    const segLen = Math.hypot(dx, dy);
    if (segLen <= 1) continue;

    const ux = dx / segLen;
    const uy = dy / segLen;

    for (const poly of layerPolys) {
      const segHits = intersectLineWithPolygon(pA.x, pA.y, ux, uy, segLen, poly);
      for (const [hA, hB] of segHits) {
        raw.push([cutLength + hA, cutLength + hB]);
      }
    }
    cutLength += segLen;
  }

  if (cutLength <= 1) return { cutLength: 0, intervals: [] };
  if (raw.length === 0) return { cutLength, intervals: [] };

  raw.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [raw[0]];
  for (let i = 1; i < raw.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = raw[i];
    if (curr[0] <= prev[1] + 1) {
      prev[1] = Math.max(prev[1], curr[1]);
    } else {
      merged.push([...curr]);
    }
  }

  return { cutLength, intervals: merged };
}

/**
 * Converts GDS shapes on a layer sliced by a section line into MaskWindow[] apertures.
 */
export function sliceGdsLayoutAlongSection(
  shapes: GdsShape[],
  layer: number,
  section: GdsSectionLine,
  targetWaferWidth: number
): { windows: MaskWindow[]; cutLength: number } {
  const { cutLength, intervals } = computeRawSectionIntervals(shapes, layer, section);
  if (cutLength <= 1) return { windows: [], cutLength: 0 };

  const scale = section.resizeWaferToCut ? 1 : targetWaferWidth / cutLength;
  const maxSpan = section.resizeWaferToCut ? Math.round(cutLength) : targetWaferWidth;

  const windows: MaskWindow[] = intervals
    .map(([sA, sB], idx) => {
      const xStart = Math.max(0, Math.round(sA * scale));
      const xEnd = Math.min(maxSpan, Math.round(sB * scale));
      return {
        id: `w_gds_${Date.now()}_${idx}`,
        xStart,
        xEnd,
      };
    })
    .filter((w) => w.xEnd - w.xStart >= 5);

  return { windows, cutLength: Math.round(cutLength) };
}

export interface ConcatSegmentMeta {
  section: GdsSectionLine;
  rawOffsetStart: number;
  rawOffsetEnd: number;
  cutLength: number;
  startPct: number;
  widthPct: number;
}

/**
 * Concatenates multiple ordered GDS section cuts (separated by `gapNm`) on a given layer
 * into a single continuous sequence of MaskWindow[] apertures.
 */
export function sliceGdsLayoutConcatenated(
  shapes: GdsShape[],
  layer: number,
  sections: GdsSectionLine[],
  gapNm: number,
  resizeWaferToCut: boolean,
  targetWaferWidth: number
): { windows: MaskWindow[]; totalLength: number; segments: ConcatSegmentMeta[] } {
  const safeGap = Math.max(0, Math.round(gapNm || 0));
  const rawIntervals: [number, number][] = [];
  const rawSegments: {
    section: GdsSectionLine;
    rawOffsetStart: number;
    rawOffsetEnd: number;
    cutLength: number;
  }[] = [];

  // Pre-filter valid sections (polyline arc length > 1nm) so trailing gap is never added
  const validSections = sections.filter((s) => getSectionTotalLength(s) > 1);
  if (validSections.length === 0) {
    return { windows: [], totalLength: 0, segments: [] };
  }

  let cursor = 0;
  for (let i = 0; i < validSections.length; i++) {
    const sec = validSections[i];
    const { cutLength, intervals } = computeRawSectionIntervals(shapes, layer, sec);
    rawSegments.push({
      section: sec,
      rawOffsetStart: cursor,
      rawOffsetEnd: cursor + cutLength,
      cutLength,
    });
    for (const [sA, sB] of intervals) {
      rawIntervals.push([cursor + sA, cursor + sB]);
    }
    cursor += cutLength + (i < validSections.length - 1 ? safeGap : 0);
  }

  const totalLength = cursor;
  if (totalLength <= 1) {
    return { windows: [], totalLength: 0, segments: [] };
  }

  const scale = resizeWaferToCut ? 1 : targetWaferWidth / totalLength;
  const maxSpan = resizeWaferToCut ? Math.round(totalLength) : targetWaferWidth;

  const windows: MaskWindow[] = rawIntervals
    .map(([sA, sB], idx) => {
      const xStart = Math.max(0, Math.round(sA * scale));
      const xEnd = Math.min(maxSpan, Math.round(sB * scale));
      return {
        id: `w_gds_cat_${Date.now()}_${idx}`,
        xStart,
        xEnd,
      };
    })
    .filter((w) => w.xEnd - w.xStart >= 5);

  const segments: ConcatSegmentMeta[] = rawSegments.map((seg) => ({
    ...seg,
    startPct: (seg.rawOffsetStart / totalLength) * 100,
    widthPct: ((seg.rawOffsetEnd - seg.rawOffsetStart) / totalLength) * 100,
  }));

  return {
    windows,
    totalLength: Math.round(totalLength),
    segments,
  };
}

/**
 * Translates a GdsShape by (dx, dy) in nm.
 */
export function moveGdsShape(shape: GdsShape, dx: number, dy: number): GdsShape {
  if (shape.type === 'rect') {
    return {
      ...shape,
      x: (shape.x ?? 0) + dx,
      y: (shape.y ?? 0) + dy,
    };
  }
  if (shape.type === 'circle') {
    return {
      ...shape,
      cx: (shape.cx ?? 0) + dx,
      cy: (shape.cy ?? 0) + dy,
    };
  }
  return {
    ...shape,
    points: (shape.points || []).map((p) => ({ x: p.x + dx, y: p.y + dy })),
  };
}

/**
 * Translates a GdsSectionLine by (dx, dy) in nm.
 */
export function moveGdsSectionLine(
  section: GdsSectionLine,
  dx: number,
  dy: number
): GdsSectionLine {
  const shiftedPts = getSectionPoints(section).map((p) => ({
    x: p.x + dx,
    y: p.y + dy,
  }));
  return withSectionPoints(section, shiftedPts);
}

/**
 * Computes axis-aligned bounding box of a single GdsShape in nm.
 */
export function getGdsShapeBounds(shape: GdsShape): {
  minX: number;
  minY: number;
  width: number;
  height: number;
} {
  if (shape.type === 'rect') {
    return {
      minX: shape.x ?? 0,
      minY: shape.y ?? 0,
      width: shape.width ?? 0,
      height: shape.height ?? 0,
    };
  }
  if (shape.type === 'circle') {
    const r = shape.radius ?? 0;
    return {
      minX: (shape.cx ?? 0) - r,
      minY: (shape.cy ?? 0) - r,
      width: r * 2,
      height: r * 2,
    };
  }
  const pts = shape.points || [];
  if (pts.length === 0) {
    return { minX: 0, minY: 0, width: 0, height: 0 };
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    minX,
    minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
}

/**
 * Translates and/or proportionally scales a point-based shape (polygon or path)
 * to fit a target bounding box in nm.
 */
export function resizePointShapeToBounds(
  shape: GdsShape,
  targetMinX: number,
  targetMinY: number,
  targetWidth: number,
  targetHeight: number
): GdsShape {
  const pts = shape.points || [];
  if (pts.length === 0) return shape;
  const b = getGdsShapeBounds(shape);
  const scaleX = b.width > 1 ? targetWidth / b.width : 1;
  const scaleY = b.height > 1 ? targetHeight / b.height : 1;
  return {
    ...shape,
    points: pts.map((p) => ({
      x: Math.round(targetMinX + (p.x - b.minX) * scaleX),
      y: Math.round(targetMinY + (p.y - b.minY) * scaleY),
    })),
  };
}

/**
 * Creates a clean initial GDS layout linked to the flow's existing photomask levels.
 */
export function createDefaultGdsLayout(
  masks: PhotomaskLevel[],
  waferWidth: number
): GdsLayoutData {
  const layers: GdsLayerInfo[] =
    masks.length > 0
      ? masks.map((m, idx) => ({
          layer: idx + 1,
          datatype: 0,
          name: m.layerCode || `L${idx + 1}`,
          color: m.color || GDS_LAYER_PALETTE[idx % GDS_LAYER_PALETTE.length],
          visible: true,
          pattern: DEFAULT_GDS_LAYER_PATTERNS[idx % DEFAULT_GDS_LAYER_PATTERNS.length],
          assignedMaskId: m.id,
        }))
      : [
          {
            layer: 1,
            datatype: 0,
            name: 'L1',
            color: GDS_LAYER_PALETTE[0],
            visible: true,
            pattern: DEFAULT_GDS_LAYER_PATTERNS[0],
          },
        ];

  const midY = Math.round(waferWidth * 0.5);
  const initialCut: GdsSectionLine = {
    id: `sec_${Date.now()}`,
    label: "A-A'",
    x1: 0,
    y1: midY,
    x2: waferWidth,
    y2: midY,
    color: SECTION_LINE_COLORS[0],
    resizeWaferToCut: false,
  };
  return {
    name: 'Custom Reticle Layout',
    layers,
    shapes: [],
    sectionLine: initialCut,
    sectionLines: [initialCut],
    activeSectionId: initialCut.id,
  };
}

/**
 * Creates an illustrative multi-layer CMOS / MEMS sample GDS layout scaled to waferWidth
 * so users can test section cuts immediately.
 */
export function createSampleGdsLayout(
  masks: PhotomaskLevel[],
  waferWidth: number
): GdsLayoutData {
  const W = waferWidth || 10000;
  const s = W / 10000;

  const layers: GdsLayerInfo[] = [
    {
      layer: 1,
      datatype: 0,
      name: masks[0]?.layerCode || 'ACTV-1',
      color: masks[0]?.color || GDS_LAYER_PALETTE[0],
      visible: true,
      pattern: 'diagonal-right',
      assignedMaskId: masks[0]?.id,
    },
    {
      layer: 2,
      datatype: 0,
      name: masks[1]?.layerCode || 'POLY-2',
      color: masks[1]?.color || GDS_LAYER_PALETTE[1],
      visible: true,
      pattern: 'diagonal-left',
      assignedMaskId: masks[1]?.id,
    },
    {
      layer: 3,
      datatype: 0,
      name: masks[2]?.layerCode || 'MET1-3',
      color: masks[2]?.color || GDS_LAYER_PALETTE[2],
      visible: true,
      pattern: 'crosshatch',
      assignedMaskId: masks[2]?.id,
    },
  ];

  // Add any remaining flow masks as extra GDS layers
  for (let i = 3; i < masks.length; i++) {
    layers.push({
      layer: i + 1,
      datatype: 0,
      name: masks[i].layerCode || `L${i + 1}`,
      color: masks[i].color || GDS_LAYER_PALETTE[i % GDS_LAYER_PALETTE.length],
      visible: true,
      pattern: DEFAULT_GDS_LAYER_PATTERNS[i % DEFAULT_GDS_LAYER_PATTERNS.length],
      assignedMaskId: masks[i].id,
    });
  }

  const shapes: GdsShape[] = [
    // Layer 1: Active area well + guard ring
    {
      id: `gds_ex_1`,
      type: 'rect',
      layer: 1,
      datatype: 0,
      x: Math.round(1800 * s),
      y: Math.round(2500 * s),
      width: Math.round(6400 * s),
      height: Math.round(5000 * s),
    },
    // Layer 2: Dual Polysilicon Gate fingers + Routing path
    {
      id: `gds_ex_2`,
      type: 'rect',
      layer: 2,
      datatype: 0,
      x: Math.round(3500 * s),
      y: Math.round(1400 * s),
      width: Math.round(900 * s),
      height: Math.round(7200 * s),
    },
    {
      id: `gds_ex_3`,
      type: 'rect',
      layer: 2,
      datatype: 0,
      x: Math.round(5600 * s),
      y: Math.round(1400 * s),
      width: Math.round(900 * s),
      height: Math.round(7200 * s),
    },
    {
      id: `gds_ex_4`,
      type: 'path',
      layer: 2,
      datatype: 0,
      pathWidth: Math.round(600 * s),
      points: [
        { x: Math.round(3950 * s), y: Math.round(8200 * s) },
        { x: Math.round(3950 * s), y: Math.round(9000 * s) },
        { x: Math.round(6050 * s), y: Math.round(9000 * s) },
        { x: Math.round(6050 * s), y: Math.round(8200 * s) },
      ],
    },
    // Layer 3: Source/Drain contacts & Metal-1 buses
    {
      id: `gds_ex_5`,
      type: 'rect',
      layer: 3,
      datatype: 0,
      x: Math.round(2200 * s),
      y: Math.round(3800 * s),
      width: Math.round(900 * s),
      height: Math.round(2400 * s),
    },
    {
      id: `gds_ex_6`,
      type: 'rect',
      layer: 3,
      datatype: 0,
      x: Math.round(6900 * s),
      y: Math.round(3800 * s),
      width: Math.round(900 * s),
      height: Math.round(2400 * s),
    },
    {
      id: `gds_ex_7`,
      type: 'circle',
      layer: 3,
      datatype: 0,
      cx: Math.round(5000 * s),
      cy: Math.round(5000 * s),
      radius: Math.round(350 * s),
    },
  ];

  const cutA: GdsSectionLine = {
    id: `sec_ex_a_${Date.now()}`,
    label: "A-A'",
    x1: 0,
    y1: Math.round(5000 * s),
    x2: W,
    y2: Math.round(5000 * s),
    color: SECTION_LINE_COLORS[0],
    resizeWaferToCut: false,
  };
  const cutB: GdsSectionLine = {
    id: `sec_ex_b_${Date.now() + 1}`,
    label: "B-B'",
    x1: Math.round(3950 * s),
    y1: Math.round(1000 * s),
    x2: Math.round(3950 * s),
    y2: Math.round(9500 * s),
    color: SECTION_LINE_COLORS[1],
    resizeWaferToCut: false,
  };

  return {
    name: 'Dual-Gate Fin/CMOS Example',
    layers,
    shapes,
    sectionLine: cutA,
    sectionLines: [cutA, cutB],
    activeSectionId: cutA.id,
  };
}
