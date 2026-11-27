/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import JSZip from 'jszip';
import {
  CrossSectionMesh,
  Material,
  ProcessFlow,
  ProcessSide,
  ProcessStep,
  RenderedPolygon,
} from '../types/microfab';
import { DEFAULT_MATERIALS, getMaterialById } from './materials';
import { simulateCrossSection, buildRenderPolygons } from './simulationEngine';
import { resolveFlowParameters } from './variableUtils';
import { formatThickness, ThicknessUnit } from './units';
import {
  computePiecewiseZTransform,
  formatLocalGain,
  subdividePolygonAtBreakpoints,
} from './piecewiseZScale';

export type BatchExportFormat = 'svg' | 'png';
export type BatchExportTheme = 'paper' | 'dark';
export type BatchExportDelivery = 'zip' | 'individual';

export interface BatchExportOptions {
  format: BatchExportFormat;
  theme: BatchExportTheme;
  delivery: BatchExportDelivery;
  pngScale: 1 | 2 | 3;
  renderMode: 'hatch' | 'solid';
  showOutlines: boolean;
  showHeader: boolean;
  showAxes: boolean;
  showLegend: boolean;
  sharedScale: boolean;
  zScaleMode: 'linear' | 'auto-piecewise';
  thicknessUnit: ThicknessUnit;
}

export interface BatchStepItem {
  key: string;
  indexLabel: string;
  stepNumber: number;
  title: string;
  subtitle: string;
  side?: ProcessSide;
  stepType: string;
  bookmarked: boolean;
  filenameBase: string;
  mesh: CrossSectionMesh;
  polygons: RenderedPolygon[];
}

export interface BatchExportProgress {
  completed: number;
  total: number;
  currentFile: string;
}

function escapeXml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function slugifyFilename(str: string, fallback: string = 'step'): string {
  const cleaned = str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return cleaned || fallback;
}

function describeStepBrief(
  step: ProcessStep,
  materials: Material[],
  unit: ThicknessUnit
): string {
  const sideTag =
    step.side === 'back' ? 'Backside (-Z)' : step.side === 'both' ? 'Double-Sided (±Z)' : 'Frontside (+Z)';

  switch (step.type) {
    case 'deposition': {
      const matId = step.materialId;
      const mat = matId ? getMaterialById(materials, matId) : null;
      const thick = step.deposition?.thickness ?? step.thickness ?? 0;
      const mode = step.deposition?.depositionType || step.deposition?.method || 'conformal';
      return `${sideTag} · ${mat?.name || 'Film'} · ${formatThickness(thick, unit)} (${mode})`;
    }
    case 'lithography': {
      const pol = step.lithography?.polarity === 'negative' ? 'Negative' : 'Positive';
      const wins = step.lithography?.windows?.length ?? 0;
      const resist = step.lithography?.resistThickness ?? 1000;
      return `${sideTag} · ${pol} Resist (${formatThickness(resist, unit)}) · ${wins} ${wins === 1 ? 'window' : 'windows'}`;
    }
    case 'etch': {
      const mode = step.etch?.etchType || 'rie';
      const depth = step.etch?.depth ?? step.thickness ?? 0;
      const matId =
        step.etch?.targetMaterialId && step.etch.targetMaterialId !== 'all'
          ? step.etch.targetMaterialId
          : step.materialId;
      const target = matId ? getMaterialById(materials, matId).name : 'All exposed';
      return `${sideTag} · ${mode} · ${formatThickness(depth, unit)} · ${target}`;
    }
    case 'strip':
    case 'liftoff': {
      if (step.strip?.stripType === 'sacrificial-release') {
        const target = step.strip.targetMaterialId
          ? getMaterialById(materials, step.strip.targetMaterialId).name
          : 'Sacrificial';
        return `${sideTag} · Sacrificial Release (${target})`;
      }
      if (step.type === 'liftoff' || step.strip?.stripType === 'metal-liftoff') {
        return `${sideTag} · Metal Lift-Off`;
      }
      return `${sideTag} · Resist Strip (${step.strip?.solvent || 'Solvent'})`;
    }
    case 'cmp': {
      const mode = step.cmp?.mode || 'polish-depth';
      const op = step.cmp?.operation === 'grind' ? 'Backgrind' : step.cmp?.operation === 'polish' ? 'Polish' : 'CMP';
      if (mode === 'stop-on-layer' && step.cmp?.stopMaterialId) {
        return `${sideTag} · ${op} Stop on ${getMaterialById(materials, step.cmp.stopMaterialId).name}`;
      }
      return `${sideTag} · ${op} (${formatThickness(step.cmp?.depth ?? 500, unit)})`;
    }
    case 'anneal':
      return `Thermal Anneal${step.toolRecipe?.temperature ? ` · ${step.toolRecipe.temperature}` : ''}`;
    case 'bonding': {
      const method = step.bonding?.bondingMethod || 'fusion';
      const src =
        step.bonding?.sourceType === 'imported-flow'
          ? step.bonding.importedFlowTitle || step.bonding.importedFlow?.title || 'Imported Wafer'
          : 'Bonded Substrate';
      return `${sideTag} · ${method} bond · ${src}`;
    }
    case 'dicing': {
      const streets = step.dicing?.streets?.length ?? 0;
      const kerf = step.dicing?.kerfWidth ?? 500;
      return `${sideTag} · ${step.dicing?.method || 'blade'} dicing · ${streets} streets (kerf ${formatThickness(kerf, unit)})`;
    }
    case 'tape-frame':
      return `${sideTag} · ${step.tapeFrame?.action === 'demount' ? 'Demount Tape Frame' : 'Mount on Tape Frame'}`;
    default:
      return sideTag;
  }
}

export function buildBatchStepItems(
  rawFlow: ProcessFlow,
  includeSubstrate: boolean,
  bookmarkedOnly: boolean,
  thicknessUnit: ThicknessUnit
): BatchStepItem[] {
  const flow = resolveFlowParameters(rawFlow);
  const items: BatchStepItem[] = [];
  const enabledSteps = flow.steps.filter((s) => s.enabled);
  const hasBookmarked = enabledSteps.some((s) => Boolean(s.bookmarked));
  const totalDigits = Math.max(2, String(enabledSteps.length).length);
  const padIdx = (n: number) => String(n).padStart(totalDigits, '0');

  if (includeSubstrate && !(bookmarkedOnly && hasBookmarked)) {
    const mesh = simulateCrossSection(flow, -1);
    const polygons = buildRenderPolygons(mesh, flow.materials);
    const subLayers =
      flow.substrateLayers && flow.substrateLayers.length > 0
        ? flow.substrateLayers
        : [
            {
              id: 'sub_default',
              name: 'Bulk Silicon <100>',
              materialId: flow.substrateMaterialId || 'mat_si_sub',
              thickness: flow.substrateThickness || 3000,
            },
          ];
    const subSummary = subLayers
      .map((l) => `${l.name || getMaterialById(flow.materials, l.materialId).name} (${formatThickness(l.thickness, thicknessUnit)})`)
      .join(' · ');

    items.push({
      key: 'step_00_substrate',
      indexLabel: padIdx(0),
      stepNumber: 0,
      title: 'Starting Substrate Stack',
      subtitle: subSummary,
      stepType: 'substrate',
      bookmarked: false,
      filenameBase: `${padIdx(0)}-starting-substrate`,
      mesh,
      polygons,
    });
  }

  enabledSteps.forEach((step, idx) => {
    if (bookmarkedOnly && hasBookmarked && !step.bookmarked) {
      return;
    }
    const stepNum = idx + 1;
    const label = padIdx(stepNum);
    const mesh = simulateCrossSection(flow, idx);
    const polygons = buildRenderPolygons(mesh, flow.materials);

    items.push({
      key: step.id,
      indexLabel: label,
      stepNumber: stepNum,
      title: step.title || `Step ${stepNum}`,
      subtitle: describeStepBrief(step, flow.materials, thicknessUnit),
      side: step.side,
      stepType: step.type,
      bookmarked: Boolean(step.bookmarked),
      filenameBase: `${label}-${slugifyFilename(step.title, `step-${stepNum}`)}`,
      mesh,
      polygons,
    });
  });

  return items;
}

export function computeGlobalVerticalBounds(
  items: BatchStepItem[]
): { minY: number; maxY: number } {
  let minY = Infinity;
  let maxY = -Infinity;

  for (const item of items) {
    if (item.mesh.minY < minY) minY = item.mesh.minY;
    if (item.mesh.maxY > maxY) maxY = item.mesh.maxY;
    for (const poly of item.polygons) {
      if (poly.yMin < minY) minY = poly.yMin;
      if (poly.yMax > maxY) maxY = poly.yMax;
    }
  }

  if (minY === Infinity) minY = 0;
  if (maxY === -Infinity) maxY = 3000;
  if (maxY - minY < 300) {
    maxY = minY + 300;
  }

  return { minY, maxY };
}

function buildPatternDefsXml(materials: Material[]): string {
  const materialIds = new Set(materials.map((m) => m.id));
  const patternMaterials = [
    ...materials,
    ...DEFAULT_MATERIALS.filter((m) => !materialIds.has(m.id)),
  ];

  const entries = patternMaterials.map((mat) => {
    const pid = `mat-fill-${escapeXml(mat.id)}`;
    const baseColor = escapeXml(mat.color || '#64748b');
    let overlay = '';
    switch (mat.pattern) {
      case 'diagonal-right':
        overlay = `<line x1="0" y1="0" x2="12" y2="12" stroke="#000" stroke-width="1.2" stroke-opacity="0.22" />`;
        break;
      case 'diagonal-left':
        overlay = `<line x1="12" y1="0" x2="0" y2="12" stroke="#000" stroke-width="1.2" stroke-opacity="0.22" />`;
        break;
      case 'crosshatch':
        overlay = `<path d="M 0 0 L 12 12 M 12 0 L 0 12" stroke="#000" stroke-width="1" stroke-opacity="0.24" />`;
        break;
      case 'dots':
        overlay = `<circle cx="6" cy="6" r="1.5" fill="#000" fill-opacity="0.25" />`;
        break;
      case 'horizontal':
        overlay = `<line x1="0" y1="6" x2="12" y2="6" stroke="#000" stroke-width="1" stroke-opacity="0.22" />`;
        break;
      case 'vertical':
        overlay = `<line x1="6" y1="0" x2="6" y2="12" stroke="#000" stroke-width="1" stroke-opacity="0.22" />`;
        break;
      case 'stipple':
        overlay = `<circle cx="3" cy="3" r="1" fill="#000" fill-opacity="0.25" /><circle cx="9" cy="9" r="1" fill="#000" fill-opacity="0.25" />`;
        break;
      default:
        break;
    }

    return `<pattern id="${pid}" width="12" height="12" patternUnits="userSpaceOnUse"><rect width="12" height="12" fill="${baseColor}" />${overlay}</pattern>`;
  });

  return `<defs>${entries.join('')}</defs>`;
}

const STEP_ACCENT_COLORS: Record<string, string> = {
  substrate: '#10b981',
  deposition: '#0284c7',
  lithography: '#e11d48',
  etch: '#d97706',
  strip: '#059669',
  liftoff: '#10b981',
  cmp: '#0891b2',
  bonding: '#4f46e5',
  dicing: '#ea580c',
  'tape-frame': '#0ea5e9',
  anneal: '#9333ea',
};

export function renderBatchStepSvg(
  item: BatchStepItem,
  flow: ProcessFlow,
  options: BatchExportOptions,
  globalBounds?: { minY: number; maxY: number }
): { svg: string; width: number; height: number } {
  const isPaper = options.theme === 'paper';
  const waferWidth = item.mesh.width || flow.substrateWidth || 10000;

  const svgWidth = 960;
  const headerH = options.showHeader ? 62 : 0;
  const viewportTop = headerH + 18;
  const viewportH = 380;
  const axesPadBottom = options.showAxes ? 48 : 20;

  // Materials actually present in this cross-section for a clean, focused legend
  const usedMatIds = new Set<string>();
  for (const poly of item.polygons) {
    usedMatIds.add(poly.materialId);
  }
  const legendMaterials = Array.from(usedMatIds).map((id) =>
    getMaterialById(flow.materials, id)
  );

  const legendCols = 4;
  const legendRows =
    options.showLegend && legendMaterials.length > 0
      ? Math.ceil(legendMaterials.length / legendCols)
      : 0;
  const legendBlockH = legendRows > 0 ? 34 + legendRows * 22 : 0;
  const svgHeight = viewportTop + viewportH + axesPadBottom + legendBlockH + 10;

  // Determine vertical bounds
  let rawMinY = globalBounds ? globalBounds.minY : item.mesh.minY;
  let rawMaxY = globalBounds ? globalBounds.maxY : item.mesh.maxY;
  if (!globalBounds) {
    for (const poly of item.polygons) {
      if (poly.yMin < rawMinY) rawMinY = poly.yMin;
      if (poly.yMax > rawMaxY) rawMaxY = poly.yMax;
    }
    if (!Number.isFinite(rawMinY)) rawMinY = 0;
    if (!Number.isFinite(rawMaxY)) rawMaxY = 3000;
    if (rawMaxY - rawMinY < 300) rawMaxY = rawMinY + 300;
  }

  // Optional piecewise Z transform per step
  const zTransform = computePiecewiseZTransform({
    mode: options.zScaleMode === 'auto-piecewise' ? 'auto' : 'linear',
    polygons: item.polygons,
    rawMinY,
    rawMaxY,
    waferWidth,
    autoCompression: 0.72,
  });

  const renderPolys = zTransform.isActive
    ? item.polygons.map((poly) => ({
        ...poly,
        points: subdividePolygonAtBreakpoints(poly.points, zTransform.breakpoints),
      }))
    : item.polygons;

  const hasFrames = (item.mesh.mountedFrames?.length ?? 0) > 0;
  const padLeft = (options.showAxes && zTransform.isActive ? 92 : 68) + (hasFrames ? 28 : 0);
  const padRight = 56 + (hasFrames ? 28 : 0);
  const availW = svgWidth - padLeft - padRight;
  const availH = viewportH - 34;

  const worldSpanY = Math.max(100, rawMaxY - rawMinY);
  const sx = availW / Math.max(100, waferWidth);
  const sy = (availH * 0.88) / worldSpanY;
  const waferDrawTop = viewportTop + 18 + (availH - worldSpanY * sy) / 2;
  const waferDrawBottom = waferDrawTop + worldSpanY * sy;

  const toScreen = (x: number, y: number) => {
    const visY = zTransform.isActive ? zTransform.mapY(y) : y;
    return {
      x: padLeft + x * sx,
      y: waferDrawBottom - (visY - rawMinY) * sy,
    };
  };

  const bgMain = isPaper ? '#ffffff' : '#060a12';
  const bgHeader = isPaper ? '#f8fafc' : '#0f172a';
  const borderCol = isPaper ? '#cbd5e1' : '#1e293b';
  const titleColor = isPaper ? '#0f172a' : '#f8fafc';
  const subColor = isPaper ? '#475569' : '#94a3b8';
  const axisColor = isPaper ? '#475569' : '#64748b';
  const tickTextColor = isPaper ? '#334155' : '#94a3b8';
  const gridColor = isPaper ? '#cbd5e1' : '#334155';
  const accentColor = STEP_ACCENT_COLORS[item.stepType] || '#0284c7';

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgWidth} ${svgHeight}" width="${svgWidth}" height="${svgHeight}">`
  );
  parts.push(buildPatternDefsXml(flow.materials));

  // Background
  parts.push(`<rect x="0" y="0" width="${svgWidth}" height="${svgHeight}" fill="${bgMain}" />`);

  // Header Banner
  if (options.showHeader) {
    parts.push(
      `<rect x="0" y="0" width="${svgWidth}" height="${headerH}" fill="${bgHeader}" />`,
      `<line x1="0" y1="${headerH}" x2="${svgWidth}" y2="${headerH}" stroke="${borderCol}" stroke-width="1" />`,
      `<rect x="0" y="0" width="6" height="${headerH}" fill="${accentColor}" />`,
      `<rect x="20" y="13" width="68" height="20" rx="5" fill="${isPaper ? '#e0f2fe' : '#0c4a6e'}" stroke="${accentColor}" stroke-width="0.8" />`,
      `<text x="54" y="26.5" text-anchor="middle" fill="${isPaper ? '#0369a1' : '#bae6fd'}" font-size="11" font-weight="700" font-family="JetBrains Mono, ui-monospace, monospace">${item.stepNumber === 0 ? 'INIT' : `STEP ${item.indexLabel}`}</text>`,
      `<text x="100" y="27" fill="${titleColor}" font-size="15" font-weight="700" font-family="Plus Jakarta Sans, system-ui, sans-serif">${escapeXml(item.title)}</text>`,
      `<text x="100" y="45" fill="${subColor}" font-size="11" font-family="JetBrains Mono, ui-monospace, monospace">${escapeXml(item.subtitle)}</text>`,
      `<text x="${svgWidth - 20}" y="27" text-anchor="end" fill="${subColor}" font-size="10.5" font-family="JetBrains Mono, ui-monospace, monospace">W: ${(waferWidth / 1000).toFixed(2)} µm</text>`,
      `<text x="${svgWidth - 20}" y="45" text-anchor="end" fill="${subColor}" font-size="10.5" font-family="JetBrains Mono, ui-monospace, monospace">H: ${escapeXml(formatThickness(item.mesh.maxY - item.mesh.minY, options.thicknessUnit))}</text>`
    );
  }

  // Optional Subtle Vertical Grid Lines
  if (options.showAxes) {
    const datumY = toScreen(0, rawMinY).y;
    const gridTopY = toScreen(0, rawMaxY).y - 16;
    parts.push(`<g opacity="${isPaper ? '0.45' : '0.28'}">`);
    for (let i = 0; i <= 10; i++) {
      const gx = toScreen((waferWidth / 10) * i, 0).x;
      parts.push(
        `<line x1="${gx.toFixed(1)}" y1="${gridTopY.toFixed(1)}" x2="${gx.toFixed(1)}" y2="${(datumY + 8).toFixed(1)}" stroke="${gridColor}" stroke-width="0.9" stroke-dasharray="3 3" />`
      );
    }
    parts.push(`</g>`);
  }

  // Material Polygons
  parts.push(`<g id="wafer-layers">`);
  for (const poly of renderPolys) {
    if (poly.points.length < 3) continue;
    const mat = getMaterialById(flow.materials, poly.materialId);
    const p0 = toScreen(poly.points[0].x, poly.points[0].y);
    let d = `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)}`;
    for (let i = 1; i < poly.points.length; i++) {
      const pt = toScreen(poly.points[i].x, poly.points[i].y);
      d += ` L ${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`;
    }
    d += ' Z';

    const fillVal =
      options.renderMode === 'hatch'
        ? `url(#mat-fill-${escapeXml(mat.id)})`
        : escapeXml(mat.color || '#64748b');
    const strokeVal = options.showOutlines
      ? isPaper
        ? '#0f172a'
        : escapeXml(mat.strokeColor || '#1e293b')
      : 'none';
    const strokeW = options.showOutlines ? '1.15' : '0';
    parts.push(
      `<path d="${d}" fill="${fillVal}" stroke="${strokeVal}" stroke-width="${strokeW}" stroke-linejoin="round" />`
    );
  }
  parts.push(`</g>`);

  // Mounted Tape & Ring Frame Brackets
  if (item.mesh.mountedFrames && item.mesh.mountedFrames.length > 0) {
    parts.push(`<g id="mounted-tape-frames">`);
    const leftX = toScreen(0, 0).x;
    const rightX = toScreen(waferWidth, 0).x;
    for (const frame of item.mesh.mountedFrames) {
      const yTopPx = toScreen(0, frame.yTop).y;
      const yBotPx = toScreen(0, frame.yBottom).y;
      const yMinPx = Math.min(yTopPx, yBotPx);
      const clampH = Math.max(6, Math.abs(yBotPx - yTopPx));
      const extW = 20;
      const jawW = 8;
      const lip = 3;
      parts.push(
        `<rect x="${(leftX - extW).toFixed(1)}" y="${yMinPx.toFixed(1)}" width="${extW}" height="${clampH.toFixed(1)}" fill="#0284c7" fill-opacity="0.65" stroke="#38bdf8" stroke-width="0.9" />`,
        `<rect x="${rightX.toFixed(1)}" y="${yMinPx.toFixed(1)}" width="${extW}" height="${clampH.toFixed(1)}" fill="#0284c7" fill-opacity="0.65" stroke="#38bdf8" stroke-width="0.9" />`,
        `<rect x="${(leftX - extW - jawW).toFixed(1)}" y="${(yMinPx - lip).toFixed(1)}" width="${jawW + 5}" height="${(clampH + lip * 2).toFixed(1)}" rx="2" fill="#475569" stroke="#94a3b8" stroke-width="1" />`,
        `<rect x="${(rightX + extW - 5).toFixed(1)}" y="${(yMinPx - lip).toFixed(1)}" width="${jawW + 5}" height="${(clampH + lip * 2).toFixed(1)}" rx="2" fill="#475569" stroke="#94a3b8" stroke-width="1" />`
      );
    }
    parts.push(`</g>`);
  }

  // X Axis, Orientation Markers, & Piecewise Z-Spine
  if (options.showAxes) {
    const datumY = toScreen(0, rawMinY).y;
    const xStart = toScreen(0, 0).x;
    const xEnd = toScreen(waferWidth, 0).x;
    const topY = toScreen(0, rawMaxY).y;

    parts.push(`<g id="wafer-axes">`);
    parts.push(
      `<line x1="${xStart.toFixed(1)}" y1="${datumY.toFixed(1)}" x2="${xEnd.toFixed(1)}" y2="${datumY.toFixed(1)}" stroke="${axisColor}" stroke-width="1.3" />`
    );

    for (let i = 0; i <= 10; i++) {
      const xNm = (waferWidth / 10) * i;
      const xUm = (xNm / 1000).toFixed(1).replace(/\.0$/, '');
      const tx = toScreen(xNm, 0).x;
      parts.push(
        `<line x1="${tx.toFixed(1)}" y1="${datumY.toFixed(1)}" x2="${tx.toFixed(1)}" y2="${(datumY + 5).toFixed(1)}" stroke="${axisColor}" stroke-width="1" />`,
        `<text x="${tx.toFixed(1)}" y="${(datumY + 18).toFixed(1)}" text-anchor="middle" fill="${tickTextColor}" font-size="9.5" font-family="JetBrains Mono, ui-monospace, monospace">${xUm} µm</text>`
      );
    }

    parts.push(
      `<text x="${xStart.toFixed(1)}" y="${(topY - 7).toFixed(1)}" fill="${isPaper ? '#0284c7' : '#38bdf8'}" font-size="9" font-weight="600" font-family="JetBrains Mono, ui-monospace, monospace">▲ FRONTSIDE (+Z)</text>`
    );

    if (zTransform.isActive) {
      const spineX = xStart - (hasFrames ? 38 : 14);
      parts.push(
        `<line x1="${(spineX - 4).toFixed(1)}" y1="${topY.toFixed(1)}" x2="${(spineX + 4).toFixed(1)}" y2="${topY.toFixed(1)}" stroke="${axisColor}" stroke-width="1.1" />`,
        `<text x="${(spineX - 7).toFixed(1)}" y="${(topY + 3).toFixed(1)}" text-anchor="end" fill="${tickTextColor}" font-size="8.5" font-family="JetBrains Mono, ui-monospace, monospace">${escapeXml(formatThickness(rawMaxY - rawMinY, options.thicknessUnit))}</text>`,
        `<line x1="${(spineX - 4).toFixed(1)}" y1="${datumY.toFixed(1)}" x2="${(spineX + 4).toFixed(1)}" y2="${datumY.toFixed(1)}" stroke="${axisColor}" stroke-width="1.1" />`,
        `<text x="${(spineX - 7).toFixed(1)}" y="${(datumY + 3).toFixed(1)}" text-anchor="end" fill="${tickTextColor}" font-size="8.5" font-family="JetBrains Mono, ui-monospace, monospace">0</text>`
      );

      for (const bp of zTransform.breakpoints) {
        const bpY = toScreen(0, bp).y;
        parts.push(
          `<line x1="${spineX.toFixed(1)}" y1="${bpY.toFixed(1)}" x2="${xEnd.toFixed(1)}" y2="${bpY.toFixed(1)}" stroke="#0284c7" stroke-opacity="0.28" stroke-width="1" stroke-dasharray="4 3" />`,
          `<text x="${(spineX - 7).toFixed(1)}" y="${(bpY + 3).toFixed(1)}" text-anchor="end" fill="${isPaper ? '#0369a1' : '#7dd3fc'}" font-size="8.5" font-family="JetBrains Mono, ui-monospace, monospace">${escapeXml(formatThickness(bp - rawMinY, options.thicknessUnit))}</text>`
        );
      }

      for (const band of zTransform.bands) {
        const yTopPx = toScreen(0, band.yMax).y;
        const yBotPx = toScreen(0, band.yMin).y;
        const segTop = yTopPx + (band.yMax < rawMaxY ? 3 : 0);
        const segBot = yBotPx - (band.yMin > rawMinY ? 3 : 0);
        const col =
          band.localGain > 1.15 ? '#0891b2' : band.localGain < 0.85 ? '#d97706' : axisColor;
        if (segBot > segTop) {
          parts.push(
            `<line x1="${spineX.toFixed(1)}" y1="${segTop.toFixed(1)}" x2="${spineX.toFixed(1)}" y2="${segBot.toFixed(1)}" stroke="${col}" stroke-width="2" />`
          );
        }
        if (segBot - segTop >= 14) {
          parts.push(
            `<text x="${(spineX - 7).toFixed(1)}" y="${(((segTop + segBot) / 2) + 3).toFixed(1)}" text-anchor="end" fill="${col}" font-size="8" font-weight="600" font-family="JetBrains Mono, ui-monospace, monospace">${escapeXml(formatLocalGain(band.localGain))}</text>`
          );
        }
      }
    }

    parts.push(`</g>`);
  }

  // Materials Legend
  if (options.showLegend && legendMaterials.length > 0) {
    const legendY = viewportTop + viewportH + axesPadBottom + 4;
    const colW = (svgWidth - 40) / legendCols;
    parts.push(
      `<line x1="20" y1="${legendY - 10}" x2="${svgWidth - 20}" y2="${legendY - 10}" stroke="${borderCol}" stroke-width="0.8" />`,
      `<text x="20" y="${legendY + 6}" fill="${subColor}" font-size="10.5" font-weight="700" font-family="Plus Jakarta Sans, system-ui, sans-serif">MATERIALS</text>`
    );

    legendMaterials.forEach((mat, idx) => {
      const col = idx % legendCols;
      const row = Math.floor(idx / legendCols);
      const lx = 20 + col * colW;
      const ly = legendY + 18 + row * 22;
      const fillVal =
        options.renderMode === 'hatch'
          ? `url(#mat-fill-${escapeXml(mat.id)})`
          : escapeXml(mat.color || '#64748b');
      const label =
        mat.name.length > 26 ? `${mat.name.slice(0, 24)}…` : mat.name;
      parts.push(
        `<rect x="${lx.toFixed(1)}" y="${ly}" width="13" height="13" rx="2" fill="${fillVal}" stroke="${isPaper ? '#334155' : '#64748b'}" stroke-width="0.9" />`,
        `<text x="${(lx + 19).toFixed(1)}" y="${ly + 10.5}" fill="${titleColor}" font-size="10.5" font-family="Plus Jakarta Sans, system-ui, sans-serif">${escapeXml(label)}</text>`
      );
    });
  }

  parts.push(`</svg>`);
  return { svg: parts.join(''), width: svgWidth, height: svgHeight };
}

export function svgToPngBlob(
  svgString: string,
  width: number,
  height: number,
  scale: number,
  backgroundColor: string
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(url);
          reject(new Error('Could not initialize 2D canvas context.'));
          return;
        }
        ctx.scale(scale, scale);
        ctx.fillStyle = backgroundColor;
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(url);

        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Canvas PNG conversion returned empty blob.'));
          }
        }, 'image/png');
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to rasterize SVG image for PNG export.'));
    };

    img.src = url;
  });
}

export async function copySvgElementToClipboard(
  svgEl: SVGSVGElement,
  width: number,
  height: number,
  backgroundColor: string
): Promise<'png' | 'svg'> {
  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  if (!clone.getAttribute('xmlns')) {
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  }
  if (!clone.getAttribute('viewBox')) {
    clone.setAttribute('viewBox', `0 0 ${width} ${height}`);
  }
  clone.setAttribute('width', String(Math.max(1, Math.round(width))));
  clone.setAttribute('height', String(Math.max(1, Math.round(height))));

  const serializer = new XMLSerializer();
  const svgStr = serializer.serializeToString(clone);

  const safeScale = Math.min(2, 12000 / Math.max(width, height, 1));

  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    typeof navigator.clipboard.write === 'function' &&
    typeof ClipboardItem !== 'undefined'
  ) {
    try {
      const pngBlobPromise = svgToPngBlob(svgStr, width, height, safeScale, backgroundColor);
      await navigator.clipboard.write([
        new ClipboardItem({
          'image/png': pngBlobPromise,
        }),
      ]);
      return 'png';
    } catch {
      try {
        const pngBlob = await svgToPngBlob(svgStr, width, height, safeScale, backgroundColor);
        await navigator.clipboard.write([
          new ClipboardItem({
            'image/png': pngBlob,
          }),
        ]);
        return 'png';
      } catch {
        if (typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(svgStr);
          return 'svg';
        }
        throw new Error('Clipboard write failed');
      }
    }
  }

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(svgStr);
    return 'svg';
  }

  throw new Error('Clipboard API is unavailable in this browser context.');
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function runBatchCrossSectionExport(
  items: BatchStepItem[],
  flow: ProcessFlow,
  options: BatchExportOptions,
  onProgress?: (progress: BatchExportProgress) => void
): Promise<void> {
  if (items.length === 0) return;

  const globalBounds = options.sharedScale
    ? computeGlobalVerticalBounds(items)
    : undefined;
  const bg = options.theme === 'paper' ? '#ffffff' : '#060a12';
  const ext = options.format;

  if (options.delivery === 'zip') {
    const zip = new JSZip();
    const folderSlug = slugifyFilename(flow.title, 'microflow');
    const folder = zip.folder(`${folderSlug}-steps`) || zip;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const filename = `${item.filenameBase}.${ext}`;
      onProgress?.({ completed: i, total: items.length, currentFile: filename });

      const { svg, width, height } = renderBatchStepSvg(
        item,
        flow,
        options,
        globalBounds
      );

      if (options.format === 'svg') {
        folder.file(filename, svg);
      } else {
        const pngBlob = await svgToPngBlob(svg, width, height, options.pngScale, bg);
        folder.file(filename, pngBlob);
      }
    }

    onProgress?.({
      completed: items.length,
      total: items.length,
      currentFile: 'Packaging ZIP archive…',
    });

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    triggerBlobDownload(
      zipBlob,
      `${folderSlug}-cross-sections-${options.format}.zip`
    );
  } else {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const filename = `${item.filenameBase}.${ext}`;
      onProgress?.({ completed: i, total: items.length, currentFile: filename });

      const { svg, width, height } = renderBatchStepSvg(
        item,
        flow,
        options,
        globalBounds
      );

      if (options.format === 'svg') {
        const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
        triggerBlobDownload(svgBlob, filename);
      } else {
        const pngBlob = await svgToPngBlob(svg, width, height, options.pngScale, bg);
        triggerBlobDownload(pngBlob, filename);
      }

      if (i < items.length - 1) {
        await new Promise((r) => setTimeout(r, 180));
      }
    }
    onProgress?.({
      completed: items.length,
      total: items.length,
      currentFile: 'Done',
    });
  }
}
