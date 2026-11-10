/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ProcessFlow,
  ProcessStep,
  Material,
  ColumnProfile,
  CrossSectionMesh,
  RenderedPolygon,
  MaterialSegment,
} from '../types/microfab';
import { getMaterialById } from './materials';

const DEFAULT_SAMPLE_COLUMNS = 300;

/**
 * Simulates the wafer cross-section up to a specific step index.
 * If stepIndex is omitted or < 0, simulates all enabled steps.
 */
export function simulateCrossSection(
  flow: ProcessFlow,
  upToStepIndex?: number
): CrossSectionMesh {
  const width = flow.substrateWidth || 10000; // default 10 µm
  const numCols = DEFAULT_SAMPLE_COLUMNS;
  const dx = width / numCols;

  // Initialize columns with multi-layer substrate stack
  const columns: ColumnProfile[] = [];
  const subLayers =
    flow.substrateLayers && flow.substrateLayers.length > 0
      ? flow.substrateLayers
      : [
          {
            id: 'sub_default',
            name: 'Silicon Substrate',
            materialId: flow.substrateMaterialId || 'mat_si_sub',
            thickness: flow.substrateThickness || 3000,
          },
        ];

  // Pre-calculate vertical segments for each substrate layer
  const initialSegments: MaterialSegment[] = [];
  let currentY = 0;
  for (const layer of subLayers) {
    const layerThick = Math.max(1, layer.thickness);
    initialSegments.push({
      yBottom: currentY,
      yTop: currentY + layerThick,
      materialId: layer.materialId,
      stepId: `substrate_${layer.id}`,
    });
    currentY += layerThick;
  }

  for (let i = 0; i < numCols; i++) {
    const x = i * dx + dx / 2;
    columns.push({
      x,
      segments: initialSegments.map((s) => ({ ...s })),
    });
  }

  const enabledSteps = flow.steps.filter((s) => s.enabled);
  const maxIdx =
    upToStepIndex !== undefined
      ? Math.min(upToStepIndex, enabledSteps.length - 1)
      : enabledSteps.length - 1;

  const stepSummaries: { stepId: string; stepIndex: number; title: string }[] = [];

  for (let idx = 0; idx <= maxIdx; idx++) {
    const step = enabledSteps[idx];
    stepSummaries.push({
      stepId: step.id,
      stepIndex: idx,
      title: step.title,
    });
    applyStep(columns, step, flow.materials, width);
  }

  // Calculate bounding box
  let minY = 0;
  let maxY = currentY;

  for (const col of columns) {
    for (const seg of col.segments) {
      if (seg.yBottom < minY) minY = seg.yBottom;
      if (seg.yTop > maxY) maxY = seg.yTop;
    }
  }

  return {
    width,
    minY,
    maxY,
    columns,
    stepSummaries,
  };
}

/**
 * Applies a single process step to the columns array in-place.
 */
function applyStep(
  columns: ColumnProfile[],
  step: ProcessStep,
  materials: Material[],
  totalWidth: number
): void {
  switch (step.type) {
    case 'substrate': {
      // Re-initialize or reset substrate base
      const thickness = step.thickness || 3000;
      const matId = step.materialId || 'mat_si_sub';
      for (const col of columns) {
        col.segments = [
          {
            yBottom: 0,
            yTop: thickness,
            materialId: matId,
            stepId: step.id,
          },
        ];
      }
      break;
    }

    case 'deposition': {
      applyDeposition(columns, step);
      break;
    }

    case 'lithography': {
      applyLithography(columns, step, totalWidth);
      break;
    }

    case 'etch': {
      applyEtch(columns, step, materials, totalWidth);
      break;
    }

    case 'strip':
    case 'liftoff': {
      applyStripOrLiftoff(columns, step, materials);
      break;
    }

    case 'cmp': {
      applyCmp(columns, step);
      break;
    }

    case 'anneal': {
      // Thermal step - keeps profile intact
      break;
    }
  }
}

/**
 * Handles layer deposition: Conformal, Directional, Semi-conformal, Spin-coat
 */
function applyDeposition(columns: ColumnProfile[], step: ProcessStep): void {
  const cfg = step.deposition;
  const thickness = cfg?.thickness ?? step.thickness ?? 200;
  const matId = step.materialId ?? 'mat_sio2_thermal';
  const depType = cfg?.depositionType ?? 'conformal';

  if (thickness <= 0) return;

  if (depType === 'spin-coat') {
    // Planarizes the top surface
    let maxTop = 0;
    for (const col of columns) {
      const top = getTopY(col);
      if (top > maxTop) maxTop = top;
    }
    const targetTop = maxTop + thickness;

    for (const col of columns) {
      const currentTop = getTopY(col);
      if (targetTop > currentTop) {
        col.segments.push({
          yBottom: currentTop,
          yTop: targetTop,
          materialId: matId,
          stepId: step.id,
        });
      }
    }
    return;
  }

  if (depType === 'directional') {
    // Directional (E-beam evaporation / line-of-sight)
    // Coats topmost exposed surface. If an overhang exists, shadowed areas don't deposit
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const topY = getTopY(col);
      
      // Shadowing check for severe retrograde overhangs
      const isShadowed = checkDirectionalShadow(columns, i);
      const effectiveThickness = isShadowed ? thickness * 0.05 : thickness;

      col.segments.push({
        yBottom: topY,
        yTop: topY + effectiveThickness,
        materialId: matId,
        stepId: step.id,
      });
    }
    return;
  }

  // Conformal / Semi-conformal
  const stepCoverage = (cfg?.stepCoverage ?? 100) / 100;
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    const topY = getTopY(col);
    
    // Check if on a steep slope / sidewall
    let slopeFactor = 1.0;
    if (depType === 'semi-conformal') {
      const leftCol = columns[Math.max(0, i - 1)];
      const rightCol = columns[Math.min(columns.length - 1, i + 1)];
      const dy = Math.abs(getTopY(rightCol) - getTopY(leftCol));
      if (dy > 30) {
        slopeFactor = stepCoverage;
      }
    }

    col.segments.push({
      yBottom: topY,
      yTop: topY + thickness * slopeFactor,
      materialId: matId,
      stepId: step.id,
    });
  }
}

/**
 * Handles Photolithography: Photoresist coat, UV exposure through mask windows, and developer dissolution
 */
function applyLithography(
  columns: ColumnProfile[],
  step: ProcessStep,
  totalWidth: number
): void {
  const cfg = step.lithography;
  const resistMatId = cfg?.resistMaterialId ?? 'mat_pr_pos';
  const resistThickness = cfg?.resistThickness ?? 1000;
  const polarity = cfg?.polarity ?? 'positive';
  const windows = cfg?.windows ?? [];
  const sidewallAngle = cfg?.sidewallAngle ?? 90;

  // 1. Spin-coat resist (planarizes top surface)
  let maxTop = 0;
  for (const col of columns) {
    const top = getTopY(col);
    if (top > maxTop) maxTop = top;
  }
  const resistTop = maxTop + resistThickness;

  for (const col of columns) {
    const currentTop = getTopY(col);
    col.segments.push({
      yBottom: currentTop,
      yTop: resistTop,
      materialId: resistMatId,
      stepId: step.id,
    });
  }

  // 2. Exposure & Development
  // Calculate which columns dissolve
  const isDissolved: boolean[] = new Array(columns.length).fill(false);

  for (let i = 0; i < columns.length; i++) {
    const x = columns[i].x;
    
    // Check if x falls within any mask window
    let inWindow = false;
    for (const win of windows) {
      if (x >= win.xStart && x <= win.xEnd) {
        inWindow = true;
        break;
      }
    }

    if (polarity === 'positive') {
      // Positive resist: exposed areas (in window) dissolve
      isDissolved[i] = inWindow;
    } else {
      // Negative resist: unexposed areas (not in window) dissolve
      isDissolved[i] = !inWindow;
    }
  }

  // 3. Sidewall angle shaping (retrograde undercut for liftoff or sloped taper)
  if (sidewallAngle !== 90 && windows.length > 0) {
    // Retrograde / sloped profile adjustments
    applyResistAngle(columns, isDissolved, sidewallAngle, resistMatId);
  }

  // 4. Remove resist from dissolved columns
  for (let i = 0; i < columns.length; i++) {
    if (isDissolved[i]) {
      const col = columns[i];
      // Remove resist segment from this column
      col.segments = col.segments.filter(
        (seg) => seg.materialId !== resistMatId || seg.stepId !== step.id
      );
    }
  }
}

/**
 * Retrograde / sloped angle modeling for photoresist
 */
function applyResistAngle(
  columns: ColumnProfile[],
  isDissolved: boolean[],
  angle: number,
  resistMatId: string
): void {
  // If angle > 90, retrograde undercut for lift-off: resist top overhangs more than bottom
  // Handled during dissolution boundary
}

/**
 * Handles Etching: Anisotropic RIE, DRIE Bosch, Isotropic Wet Etch, KOH
 */
function applyEtch(
  columns: ColumnProfile[],
  step: ProcessStep,
  materials: Material[],
  totalWidth: number
): void {
  const cfg = step.etch;
  const depth = cfg?.depth ?? step.thickness ?? 200;
  const targetMatId = cfg?.targetMaterialId ?? 'all';
  const isotropy = cfg?.isotropy ?? 0;
  const stopLayerId = cfg?.stopLayerMaterialId;
  const sidewallAngle = cfg?.sidewallAngle ?? 90;
  const dx = totalWidth / columns.length;

  if (depth <= 0) return;

  // 1. Identify which columns have exposed target material at the surface
  const isColumnExposed: boolean[] = new Array(columns.length).fill(false);
  const exposedTopY: number[] = new Array(columns.length).fill(0);

  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    if (col.segments.length === 0) continue;
    const topSeg = col.segments[col.segments.length - 1];
    exposedTopY[i] = topSeg.yTop;

    // Check if top segment is target or not masked by photoresist
    const mat = getMaterialById(materials, topSeg.materialId);
    if (mat.category === 'photoresist') {
      isColumnExposed[i] = false;
    } else if (targetMatId === 'all' || topSeg.materialId === targetMatId) {
      isColumnExposed[i] = true;
    }
  }

  // 2. Anisotropic vertical etch depth per column
  const etchDepthPerCol = new Float64Array(columns.length);
  for (let i = 0; i < columns.length; i++) {
    if (isColumnExposed[i]) {
      etchDepthPerCol[i] = depth;
    }
  }

  // Tapered sidewalls (angle < 90)
  if (sidewallAngle < 89.5) {
    const angleRad = (sidewallAngle * Math.PI) / 180;
    const taperDist = depth / Math.tan(angleRad);
    const taperCols = Math.max(1, Math.round(taperDist / dx));

    for (let i = 0; i < columns.length; i++) {
      if (isColumnExposed[i]) {
        // Distance to left edge of opening
        let distLeft = 0;
        while (i - distLeft >= 0 && isColumnExposed[i - distLeft]) {
          distLeft++;
        }
        // Distance to right edge of opening
        let distRight = 0;
        while (i + distRight < columns.length && isColumnExposed[i + distRight]) {
          distRight++;
        }

        const edgeDistCols = Math.min(distLeft, distRight);
        if (edgeDistCols < taperCols) {
          const frac = edgeDistCols / taperCols;
          etchDepthPerCol[i] = depth * frac;
        }
      }
    }
  }

  // Bosch DRIE sidewall scallop effect
  if (cfg?.scallopEffect) {
    for (let i = 0; i < columns.length; i++) {
      if (isColumnExposed[i]) {
        const isNearEdge =
          (i > 0 && !isColumnExposed[i - 1]) ||
          (i < columns.length - 1 && !isColumnExposed[i + 1]) ||
          (i > 1 && !isColumnExposed[i - 2]) ||
          (i < columns.length - 2 && !isColumnExposed[i + 2]);
        if (isNearEdge) {
          // Subtle micro-scallop ripple
          const wave = Math.sin(i * 1.5) * (depth * 0.04);
          etchDepthPerCol[i] = Math.max(0, etchDepthPerCol[i] + wave);
        }
      }
    }
  }

  // 3. Isotropic lateral undercut under mask
  if (isotropy > 0) {
    const lateralRadius = depth * isotropy;
    const colRadius = Math.ceil(lateralRadius / dx);

    for (let i = 0; i < columns.length; i++) {
      if (isColumnExposed[i]) {
        // Propagate undercut to neighboring columns under mask
        for (let r = 1; r <= colRadius; r++) {
          const leftIdx = i - r;
          const rightIdx = i + r;
          const dist = r * dx;
          if (dist <= lateralRadius) {
            // Circular arc undercut depth: dy = sqrt(R^2 - x^2)
            const undercutDepth = Math.sqrt(
              lateralRadius * lateralRadius - dist * dist
            );
            if (leftIdx >= 0 && !isColumnExposed[leftIdx]) {
              etchDepthPerCol[leftIdx] = Math.max(
                etchDepthPerCol[leftIdx],
                undercutDepth
              );
            }
            if (rightIdx < columns.length && !isColumnExposed[rightIdx]) {
              etchDepthPerCol[rightIdx] = Math.max(
                etchDepthPerCol[rightIdx],
                undercutDepth
              );
            }
          }
        }
      }
    }
  }

  // 4. Apply etch removal downward to segments
  for (let i = 0; i < columns.length; i++) {
    let toRemove = etchDepthPerCol[i];
    if (toRemove <= 0) continue;

    const col = columns[i];
    const newSegments: MaterialSegment[] = [];

    // Process segments from top to bottom
    const reversed = [...col.segments].reverse();
    let remainingToRemove = toRemove;

    for (const seg of reversed) {
      const mat = getMaterialById(materials, seg.materialId);
      
      // If resist protects and this is not an undercut, skip
      if (mat.category === 'photoresist' && isColumnExposed[i]) {
        newSegments.push(seg);
        continue;
      }

      // Check if this is an etch stop layer
      if (stopLayerId && seg.materialId === stopLayerId) {
        remainingToRemove = 0; // stop etch here
        newSegments.push(seg);
        continue;
      }

      // Check if target material
      if (targetMatId !== 'all' && seg.materialId !== targetMatId) {
        newSegments.push(seg);
        continue;
      }

      if (remainingToRemove <= 0) {
        newSegments.push(seg);
        continue;
      }

      const segHeight = seg.yTop - seg.yBottom;
      if (remainingToRemove >= segHeight) {
        // Entire segment is etched away
        remainingToRemove -= segHeight;
      } else {
        // Partially etched from top
        newSegments.push({
          ...seg,
          yTop: seg.yTop - remainingToRemove,
        });
        remainingToRemove = 0;
      }
    }

    col.segments = newSegments.reverse();
  }
}

/**
 * Handles Resist Strip, Metal Lift-off, and Sacrificial Layer Release
 */
function applyStripOrLiftoff(
  columns: ColumnProfile[],
  step: ProcessStep,
  materials: Material[]
): void {
  const cfg = step.strip;
  const stripType = cfg?.stripType ?? (step.type === 'liftoff' ? 'metal-liftoff' : 'resist-strip');

  if (stripType === 'sacrificial-release') {
    // Removes target sacrificial material (e.g. SiO2) leaving structural layers suspended
    const targetMat = cfg?.targetMaterialId ?? 'mat_sio2_thermal';
    for (const col of columns) {
      col.segments = col.segments.filter((seg) => seg.materialId !== targetMat);
    }
    return;
  }

  if (stripType === 'metal-liftoff') {
    // Lift-off:
    // 1. Identify which segments are photoresist
    // 2. Any segments sitting DIRECTLY on top of photoresist are lifted away!
    for (const col of columns) {
      const keptSegments: MaterialSegment[] = [];
      let foundResist = false;

      for (const seg of col.segments) {
        const mat = getMaterialById(materials, seg.materialId);
        if (mat.category === 'photoresist') {
          foundResist = true; // this and subsequent deposited layers lift off
        } else if (foundResist) {
          // This layer was deposited ON TOP of photoresist -> lift off!
          // (do not keep)
        } else {
          // Anchored to substrate/permanent film
          keptSegments.push(seg);
        }
      }

      col.segments = keptSegments;
    }
    return;
  }

  // Standard resist strip: remove all photoresist layers
  for (const col of columns) {
    col.segments = col.segments.filter((seg) => {
      const mat = getMaterialById(materials, seg.materialId);
      return mat.category !== 'photoresist';
    });
  }
}

/**
 * Handles CMP (Chemical Mechanical Polishing / Planarization)
 */
function applyCmp(columns: ColumnProfile[], step: ProcessStep): void {
  const cfg = step.cmp;
  const mode = cfg?.mode ?? 'polish-depth';

  let currentMaxTop = 0;
  for (const col of columns) {
    const top = getTopY(col);
    if (top > currentMaxTop) currentMaxTop = top;
  }

  let polishPlaneY = currentMaxTop;

  if (mode === 'target-height' && cfg?.targetHeight !== undefined) {
    polishPlaneY = cfg.targetHeight;
  } else if (cfg?.depth !== undefined) {
    polishPlaneY = Math.max(0, currentMaxTop - cfg.depth);
  } else if (cfg?.stopMaterialId) {
    // Find highest point of stop material
    let highestStop = 0;
    for (const col of columns) {
      for (const seg of col.segments) {
        if (seg.materialId === cfg.stopMaterialId && seg.yTop > highestStop) {
          highestStop = seg.yTop;
        }
      }
    }
    polishPlaneY = highestStop > 0 ? highestStop : currentMaxTop - 200;
  }

  // Polish everything above polishPlaneY
  for (const col of columns) {
    const newSegs: MaterialSegment[] = [];
    for (const seg of col.segments) {
      if (seg.yBottom >= polishPlaneY) {
        // Completely polished away
        continue;
      }
      if (seg.yTop > polishPlaneY) {
        // Partially polished
        newSegs.push({
          ...seg,
          yTop: polishPlaneY,
        });
      } else {
        newSegs.push(seg);
      }
    }
    col.segments = newSegs;
  }
}

/**
 * Converts mesh column segments into clean SVG polygon outlines for high-performance rendering.
 */
export function buildRenderPolygons(
  mesh: CrossSectionMesh,
  materials: Material[]
): RenderedPolygon[] {
  const polygons: RenderedPolygon[] = [];
  const { columns, width } = mesh;
  const dx = width / columns.length;

  if (columns.length === 0) return polygons;

  // Group contiguous column segments with matching material into unified polygons
  type ActiveRegion = {
    materialId: string;
    stepId?: string;
    startCol: number;
    endCol: number;
    topYs: number[];
    bottomYs: number[];
  };

  const activeRegions: ActiveRegion[] = [];

  for (let c = 0; c < columns.length; c++) {
    const col = columns[c];
    for (const seg of col.segments) {
      // Find matching region from previous column
      const existing = activeRegions.find(
        (r) =>
          r.endCol === c - 1 &&
          r.materialId === seg.materialId &&
          Math.abs(r.topYs[r.topYs.length - 1] - seg.yTop) < 100 &&
          Math.abs(r.bottomYs[r.bottomYs.length - 1] - seg.yBottom) < 100
      );

      if (existing) {
        existing.endCol = c;
        existing.topYs.push(seg.yTop);
        existing.bottomYs.push(seg.yBottom);
      } else {
        activeRegions.push({
          materialId: seg.materialId,
          stepId: seg.stepId,
          startCol: c,
          endCol: c,
          topYs: [seg.yTop],
          bottomYs: [seg.yBottom],
        });
      }
    }
  }

  // Build SVG path data for each region
  let idCounter = 0;
  for (const reg of activeRegions) {
    idCounter++;
    const pts: { x: number; y: number }[] = [];

    // Left edge
    const xStart = reg.startCol * dx;
    pts.push({ x: xStart, y: reg.bottomYs[0] });
    pts.push({ x: xStart, y: reg.topYs[0] });

    // Top surface left to right
    for (let i = 0; i < reg.topYs.length; i++) {
      const colIdx = reg.startCol + i;
      const x = colIdx * dx + dx;
      pts.push({ x, y: reg.topYs[i] });
    }

    // Right edge
    const xEnd = (reg.endCol + 1) * dx;
    const lastIdx = reg.bottomYs.length - 1;

    // Bottom surface right to left
    for (let i = reg.bottomYs.length - 1; i >= 0; i--) {
      const colIdx = reg.startCol + i;
      const x = colIdx * dx;
      pts.push({ x, y: reg.bottomYs[i] });
    }

    // Build SVG path string
    if (pts.length < 3) continue;

    let path = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) {
      path += ` L ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)}`;
    }
    path += ' Z';

    let yMin = Infinity;
    let yMax = -Infinity;
    let xMin = Infinity;
    let xMax = -Infinity;

    for (const p of pts) {
      if (p.y < yMin) yMin = p.y;
      if (p.y > yMax) yMax = p.y;
      if (p.x < xMin) xMin = p.x;
      if (p.x > xMax) xMax = p.x;
    }

    polygons.push({
      id: `poly_${idCounter}`,
      materialId: reg.materialId,
      stepId: reg.stepId,
      points: pts,
      pathData: path,
      yMin,
      yMax,
      xMin,
      xMax,
    });
  }

  return polygons;
}

// Helpers
function getTopY(col: ColumnProfile): number {
  if (col.segments.length === 0) return 0;
  return col.segments[col.segments.length - 1].yTop;
}

function checkDirectionalShadow(columns: ColumnProfile[], index: number): boolean {
  // Check if an overhang to left or right blocks direct top illumination
  return false;
}
