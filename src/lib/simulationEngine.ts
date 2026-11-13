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
  return simulateCrossSectionInternal(flow, upToStepIndex, 0);
}

function simulateCrossSectionInternal(
  flow: ProcessFlow,
  upToStepIndex?: number,
  recursionDepth: number = 0
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
    applyStep(columns, step, flow.materials, width, recursionDepth);
  }

  // Calculate bounding box from actual remaining geometry
  let minY = Infinity;
  let maxY = -Infinity;

  for (const col of columns) {
    for (const seg of col.segments) {
      if (seg.yBottom < minY) minY = seg.yBottom;
      if (seg.yTop > maxY) maxY = seg.yTop;
    }
  }

  if (minY === Infinity) minY = 0;
  if (maxY === -Infinity) maxY = currentY;

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
  totalWidth: number,
  recursionDepth: number = 0
): void {
  const side = step.side || 'front';

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
      if (side === 'front' || side === 'both') {
        applyDepositionSide(columns, step, 'front');
      }
      if (side === 'back' || side === 'both') {
        applyDepositionSide(columns, step, 'back');
      }
      break;
    }

    case 'lithography': {
      if (side === 'front' || side === 'both') {
        applyLithographySide(columns, step, totalWidth, 'front');
      }
      if (side === 'back' || side === 'both') {
        applyLithographySide(columns, step, totalWidth, 'back');
      }
      break;
    }

    case 'etch': {
      if (side === 'front' || side === 'both') {
        applyEtchSide(columns, step, materials, totalWidth, 'front');
      }
      if (side === 'back' || side === 'both') {
        applyEtchSide(columns, step, materials, totalWidth, 'back');
      }
      break;
    }

    case 'strip':
    case 'liftoff': {
      applyStripOrLiftoff(columns, step, materials, side);
      break;
    }

    case 'cmp': {
      if (side === 'front' || side === 'both') {
        applyCmpSide(columns, step, 'front');
      }
      if (side === 'back' || side === 'both') {
        applyCmpSide(columns, step, 'back');
      }
      break;
    }

    case 'anneal': {
      // Thermal step - keeps profile intact
      break;
    }

    case 'bonding': {
      applyBonding(columns, step, totalWidth, recursionDepth);
      break;
    }
  }
}

/**
 * Handles layer deposition on either the frontside (top) or backside (bottom):
 * Conformal, Directional, Semi-conformal, Spin-coat
 */
function applyDepositionSide(
  columns: ColumnProfile[],
  step: ProcessStep,
  targetSide: 'front' | 'back'
): void {
  const cfg = step.deposition;
  const thickness = cfg?.thickness ?? step.thickness ?? 200;
  const matId = step.materialId ?? 'mat_sio2_thermal';
  const depType = cfg?.depositionType ?? 'conformal';

  if (thickness <= 0) return;

  if (targetSide === 'front') {
    if (depType === 'spin-coat') {
      let maxTop = -Infinity;
      for (const col of columns) {
        if (col.segments.length === 0) continue;
        const top = getTopY(col);
        if (top > maxTop) maxTop = top;
      }
      if (maxTop === -Infinity) return;
      const targetTop = maxTop + thickness;

      for (const col of columns) {
        if (col.segments.length === 0) continue;
        const currentTop = getTopY(col);
        if (targetTop > currentTop) {
          col.segments.push({
            yBottom: currentTop,
            yTop: targetTop,
            materialId: matId,
            stepId: step.id,
            side: 'front',
          });
        }
      }
      return;
    }

    if (depType === 'directional') {
      for (let i = 0; i < columns.length; i++) {
        const col = columns[i];
        if (col.segments.length === 0) continue;
        const topY = getTopY(col);
        const isShadowed = checkDirectionalShadow(columns, i);
        const effectiveThickness = isShadowed ? thickness * 0.05 : thickness;

        col.segments.push({
          yBottom: topY,
          yTop: topY + effectiveThickness,
          materialId: matId,
          stepId: step.id,
          side: 'front',
        });
      }
      return;
    }

    const stepCoverage = (cfg?.stepCoverage ?? 100) / 100;
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      if (col.segments.length === 0) continue;
      const topY = getTopY(col);

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
        side: 'front',
      });
    }
    return;
  }

  // Backside deposition (grows downward from yBottom of lowest segment)
  if (depType === 'spin-coat') {
    let minBottom = Infinity;
    for (const col of columns) {
      if (col.segments.length === 0) continue;
      const bot = getBottomY(col);
      if (bot < minBottom) minBottom = bot;
    }
    if (minBottom === Infinity) return;
    const targetBottom = minBottom - thickness;

    for (const col of columns) {
      if (col.segments.length === 0) continue;
      const currentBottom = getBottomY(col);
      if (targetBottom < currentBottom) {
        col.segments.unshift({
          yBottom: targetBottom,
          yTop: currentBottom,
          materialId: matId,
          stepId: step.id,
          side: 'back',
        });
      }
    }
    return;
  }

  if (depType === 'directional') {
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      if (col.segments.length === 0) continue;
      const bottomY = getBottomY(col);
      const isShadowed = checkDirectionalShadow(columns, i);
      const effectiveThickness = isShadowed ? thickness * 0.05 : thickness;

      col.segments.unshift({
        yBottom: bottomY - effectiveThickness,
        yTop: bottomY,
        materialId: matId,
        stepId: step.id,
        side: 'back',
      });
    }
    return;
  }

  const stepCoverage = (cfg?.stepCoverage ?? 100) / 100;
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    if (col.segments.length === 0) continue;
    const bottomY = getBottomY(col);

    let slopeFactor = 1.0;
    if (depType === 'semi-conformal') {
      const leftCol = columns[Math.max(0, i - 1)];
      const rightCol = columns[Math.min(columns.length - 1, i + 1)];
      const dy = Math.abs(getBottomY(rightCol) - getBottomY(leftCol));
      if (dy > 30) {
        slopeFactor = stepCoverage;
      }
    }

    col.segments.unshift({
      yBottom: bottomY - thickness * slopeFactor,
      yTop: bottomY,
      materialId: matId,
      stepId: step.id,
      side: 'back',
    });
  }
}

/**
 * Handles Photolithography on either frontside or backside:
 * Photoresist coat, UV exposure through mask windows, and developer dissolution
 */
function applyLithographySide(
  columns: ColumnProfile[],
  step: ProcessStep,
  _totalWidth: number,
  targetSide: 'front' | 'back'
): void {
  const cfg = step.lithography;
  const resistMatId = cfg?.resistMaterialId ?? 'mat_pr_pos';
  const resistThickness = cfg?.resistThickness ?? 1000;
  const polarity = cfg?.polarity ?? 'positive';
  const windows = cfg?.windows ?? [];
  const sidewallAngle = cfg?.sidewallAngle ?? 90;

  // 1. Spin-coat resist
  if (targetSide === 'front') {
    let maxTop = -Infinity;
    for (const col of columns) {
      if (col.segments.length === 0) continue;
      const top = getTopY(col);
      if (top > maxTop) maxTop = top;
    }
    if (maxTop === -Infinity) return;
    const resistTop = maxTop + resistThickness;

    for (const col of columns) {
      if (col.segments.length === 0) continue;
      const currentTop = getTopY(col);
      col.segments.push({
        yBottom: currentTop,
        yTop: resistTop,
        materialId: resistMatId,
        stepId: step.id,
        side: 'front',
      });
    }
  } else {
    let minBottom = Infinity;
    for (const col of columns) {
      if (col.segments.length === 0) continue;
      const bot = getBottomY(col);
      if (bot < minBottom) minBottom = bot;
    }
    if (minBottom === Infinity) return;
    const resistBottom = minBottom - resistThickness;

    for (const col of columns) {
      if (col.segments.length === 0) continue;
      const currentBottom = getBottomY(col);
      col.segments.unshift({
        yBottom: resistBottom,
        yTop: currentBottom,
        materialId: resistMatId,
        stepId: step.id,
        side: 'back',
      });
    }
  }

  // 2. Exposure & Development
  const isDissolved: boolean[] = new Array(columns.length).fill(false);

  for (let i = 0; i < columns.length; i++) {
    const x = columns[i].x;

    let inWindow = false;
    for (const win of windows) {
      if (x >= win.xStart && x <= win.xEnd) {
        inWindow = true;
        break;
      }
    }

    if (polarity === 'positive') {
      isDissolved[i] = inWindow;
    } else {
      isDissolved[i] = !inWindow;
    }
  }

  // 3. Sidewall angle shaping (tapered < 90° or retrograde undercut > 90°)
  if (Math.abs(sidewallAngle - 90) >= 0.25) {
    applyResistAngle(
      columns,
      isDissolved,
      sidewallAngle,
      resistMatId,
      step.id,
      targetSide,
      _totalWidth
    );
  }

  // 4. Remove resist from dissolved columns on this side
  for (let i = 0; i < columns.length; i++) {
    if (isDissolved[i]) {
      const col = columns[i];
      col.segments = col.segments.filter(
        (seg) =>
          seg.materialId !== resistMatId ||
          seg.stepId !== step.id ||
          seg.side !== targetSide
      );
    }
  }
}

/**
 * Tapered (< 90°) and Retrograde / Lift-off Undercut (> 90°) modeling for photoresist sidewalls
 */
function applyResistAngle(
  columns: ColumnProfile[],
  isDissolved: boolean[],
  angle: number,
  resistMatId: string,
  stepId: string,
  targetSide: 'front' | 'back',
  totalWidth: number
): void {
  const numCols = columns.length;
  if (numCols === 0) return;

  const dx = totalWidth / numCols;
  const clampedAngle = Math.max(45, Math.min(135, angle));
  const absTan = Math.abs(Math.tan((clampedAngle * Math.PI) / 180));
  if (absTan < 1e-4) return;

  const isRetrograde = clampedAngle > 90;

  // Compute nearest dissolved-mask-edge distance (nm) for every kept column
  const distToOpeningLeft = new Float64Array(numCols);
  const distToOpeningRight = new Float64Array(numCols);

  let lastDissolvedIdx = -1;
  for (let i = 0; i < numCols; i++) {
    if (isDissolved[i]) {
      lastDissolvedIdx = i;
      distToOpeningLeft[i] = 0;
    } else if (lastDissolvedIdx === -1) {
      distToOpeningLeft[i] = Infinity;
    } else {
      const boundX = (lastDissolvedIdx + 1) * dx;
      distToOpeningLeft[i] = columns[i].x - boundX;
    }
  }

  let nextDissolvedIdx = -1;
  for (let i = numCols - 1; i >= 0; i--) {
    if (isDissolved[i]) {
      nextDissolvedIdx = i;
      distToOpeningRight[i] = 0;
    } else if (nextDissolvedIdx === -1) {
      distToOpeningRight[i] = Infinity;
    } else {
      const boundX = nextDissolvedIdx * dx;
      distToOpeningRight[i] = boundX - columns[i].x;
    }
  }

  for (let i = 0; i < numCols; i++) {
    if (isDissolved[i]) continue;
    const dEdge = Math.min(distToOpeningLeft[i], distToOpeningRight[i]);
    if (!Number.isFinite(dEdge)) continue;

    const col = columns[i];
    const seg = col.segments.find(
      (s) =>
        s.materialId === resistMatId &&
        s.stepId === stepId &&
        s.side === targetSide
    );
    if (!seg) continue;

    const resistHeight = seg.yTop - seg.yBottom;
    if (resistHeight <= 0) continue;

    const lateralRun = resistHeight / absTan;
    if (lateralRun <= 0 || dEdge >= lateralRun) continue;

    const frac = Math.max(0.03, Math.min(1, dEdge / lateralRun));

    if (!isRetrograde) {
      // Tapered (< 90°): base footprint preserved, outer surface slopes inward
      if (targetSide === 'front') {
        seg.yTop = seg.yBottom + resistHeight * frac;
      } else {
        seg.yBottom = seg.yTop - resistHeight * frac;
      }
    } else {
      // Retrograde / Lift-off Undercut (> 90°): outer lip preserved, base undercut inward
      const cutFrac = 1 - frac;
      if (targetSide === 'front') {
        seg.yBottom = seg.yBottom + resistHeight * cutFrac;
      } else {
        seg.yTop = seg.yTop - resistHeight * cutFrac;
      }
      seg.isOverhang = true;
    }
  }
}

/**
 * Handles Etching on either frontside (top-down) or backside (bottom-up):
 * Anisotropic RIE, DRIE Bosch, Isotropic Wet Etch, KOH
 */
function applyEtchSide(
  columns: ColumnProfile[],
  step: ProcessStep,
  materials: Material[],
  totalWidth: number,
  targetSide: 'front' | 'back'
): void {
  const cfg = step.etch;
  const depth = cfg?.depth ?? step.thickness ?? 200;
  const targetMatId = cfg?.targetMaterialId ?? 'all';
  const isotropy = cfg?.isotropy ?? 0;
  const stopLayerId = cfg?.stopLayerMaterialId;
  const sidewallAngle = cfg?.sidewallAngle ?? 90;
  const dx = totalWidth / columns.length;

  if (depth <= 0) return;

  // 1. Identify which columns have exposed target material at the active surface
  const isColumnExposed: boolean[] = new Array(columns.length).fill(false);

  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    if (col.segments.length === 0) continue;
    const surfaceSeg =
      targetSide === 'front'
        ? col.segments[col.segments.length - 1]
        : col.segments[0];

    const mat = getMaterialById(materials, surfaceSeg.materialId);
    if (mat.category === 'photoresist' && cfg?.etchType !== 'ashing') {
      isColumnExposed[i] = false;
    } else if (targetMatId === 'all' || surfaceSeg.materialId === targetMatId) {
      isColumnExposed[i] = true;
    }
  }

  // 2. Nominal vertical etch depth per column (optionally modulated by ARDE / RIE Lag)
  const baseDepthPerCol = new Float64Array(columns.length);
  for (let i = 0; i < columns.length; i++) {
    if (isColumnExposed[i]) {
      baseDepthPerCol[i] = depth;
    }
  }

  const isDryEtch = ['rie', 'drie-bosch', 'ion-beam', 'ashing'].includes(
    cfg?.etchType || 'rie'
  );
  if (cfg?.ardeEnabled && isDryEtch) {
    const kLag = Math.max(0.05, cfg.ardeStrength ?? 0.5);
    const openings: {
      runStart: number;
      runEnd: number;
      effectiveWidth: number;
      preDepth: number;
      requiredDose: number;
    }[] = [];

    let idx = 0;
    while (idx < columns.length) {
      if (!isColumnExposed[idx]) {
        idx++;
        continue;
      }
      const runStart = idx;
      while (idx < columns.length && isColumnExposed[idx]) {
        idx++;
      }
      const runEnd = idx - 1;

      // Blanket (completely unmasked) wafer experiences no feature-scale ARDE lag
      if (runStart === 0 && runEnd === columns.length - 1) {
        continue;
      }

      const rawWidth = (runEnd - runStart + 1) * dx;
      const touchesBoundary = runStart === 0 || runEnd === columns.length - 1;
      const effectiveWidth = Math.max(10, touchesBoundary ? rawWidth * 2 : rawWidth);

      // Estimate pre-existing mask/trench shoulder height above the opening floor
      let floorSum = 0;
      for (let c = runStart; c <= runEnd; c++) {
        floorSum +=
          targetSide === 'front' ? getTopY(columns[c]) : getBottomY(columns[c]);
      }
      const avgFloorY = floorSum / (runEnd - runStart + 1);

      let shoulderSum = 0;
      let shoulderCount = 0;
      if (runStart > 0 && columns[runStart - 1].segments.length > 0) {
        shoulderSum +=
          targetSide === 'front'
            ? getTopY(columns[runStart - 1])
            : getBottomY(columns[runStart - 1]);
        shoulderCount++;
      }
      if (runEnd < columns.length - 1 && columns[runEnd + 1].segments.length > 0) {
        shoulderSum +=
          targetSide === 'front'
            ? getTopY(columns[runEnd + 1])
            : getBottomY(columns[runEnd + 1]);
        shoulderCount++;
      }
      const avgShoulderY = shoulderCount > 0 ? shoulderSum / shoulderCount : avgFloorY;
      const preDepth =
        targetSide === 'front'
          ? Math.max(0, avgShoulderY - avgFloorY)
          : Math.max(0, avgFloorY - avgShoulderY);

      // Open-field dose needed for this feature to reach full requested etch `depth`
      const requiredDose =
        depth + (kLag / effectiveWidth) * (preDepth * depth + (depth * depth) / 2);

      openings.push({
        runStart,
        runEnd,
        effectiveWidth,
        preDepth,
        requiredDose,
      });
    }

    if (openings.length > 0) {
      // Calibrate etch time/dose to the widest/deepest feature so it always reaches exact `depth`
      const calibratedDose = Math.min(...openings.map((o) => o.requiredDose));

      for (const op of openings) {
        const a = kLag / (2 * op.effectiveWidth);
        const b = 1 + (kLag * op.preDepth) / op.effectiveWidth;
        const laggedDepth =
          (2 * calibratedDose) / (b + Math.sqrt(b * b + 4 * a * calibratedDose));

        for (let c = op.runStart; c <= op.runEnd; c++) {
          baseDepthPerCol[c] = laggedDepth;
        }
      }
    }
  }

  const etchDepthPerCol = new Float64Array(baseDepthPerCol);

  // Tapered sidewalls (angle < 90, e.g. KOH 54.74 deg)
  if (sidewallAngle < 89.5) {
    const angleRad = (sidewallAngle * Math.PI) / 180;

    for (let i = 0; i < columns.length; i++) {
      if (isColumnExposed[i]) {
        const localDepth = baseDepthPerCol[i];
        const taperDist = localDepth / Math.tan(angleRad);
        const taperCols = Math.max(1, Math.round(taperDist / dx));

        let distLeft = 0;
        while (i - distLeft >= 0 && isColumnExposed[i - distLeft]) {
          distLeft++;
        }
        let distRight = 0;
        while (i + distRight < columns.length && isColumnExposed[i + distRight]) {
          distRight++;
        }

        const edgeDistCols = Math.min(distLeft, distRight);
        if (edgeDistCols < taperCols) {
          const frac = edgeDistCols / taperCols;
          etchDepthPerCol[i] = localDepth * frac;
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
          const wave = Math.sin(i * 1.5) * (baseDepthPerCol[i] * 0.04);
          etchDepthPerCol[i] = Math.max(0, etchDepthPerCol[i] + wave);
        }
      }
    }
  }

  // 3. Isotropic lateral undercut under mask
  if (isotropy > 0) {
    for (let i = 0; i < columns.length; i++) {
      if (isColumnExposed[i]) {
        const lateralRadius = baseDepthPerCol[i] * isotropy;
        const colRadius = Math.ceil(lateralRadius / dx);
        for (let r = 1; r <= colRadius; r++) {
          const leftIdx = i - r;
          const rightIdx = i + r;
          const dist = r * dx;
          if (dist <= lateralRadius) {
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

  // 4. Apply etch removal to segments from the active surface inward
  for (let i = 0; i < columns.length; i++) {
    const toRemove = etchDepthPerCol[i];
    if (toRemove <= 0) continue;

    const col = columns[i];
    if (col.segments.length === 0) continue;

    const orderedSegments =
      targetSide === 'front' ? [...col.segments].reverse() : [...col.segments];
    const processedSegments: MaterialSegment[] = [];
    let remainingToRemove = toRemove;

    for (const seg of orderedSegments) {
      const mat = getMaterialById(materials, seg.materialId);

      // Protect photoresist mask from lateral undercut unless O2 plasma ashing
      if (mat.category === 'photoresist' && cfg?.etchType !== 'ashing') {
        processedSegments.push(seg);
        continue;
      }

      if (stopLayerId && seg.materialId === stopLayerId) {
        remainingToRemove = 0;
        processedSegments.push(seg);
        continue;
      }

      if (targetMatId !== 'all' && seg.materialId !== targetMatId) {
        processedSegments.push(seg);
        continue;
      }

      if (remainingToRemove <= 0) {
        processedSegments.push(seg);
        continue;
      }

      const segHeight = seg.yTop - seg.yBottom;
      if (remainingToRemove >= segHeight) {
        remainingToRemove -= segHeight;
      } else {
        if (targetSide === 'front') {
          processedSegments.push({
            ...seg,
            yTop: seg.yTop - remainingToRemove,
          });
        } else {
          processedSegments.push({
            ...seg,
            yBottom: seg.yBottom + remainingToRemove,
          });
        }
        remainingToRemove = 0;
      }
    }

    col.segments =
      targetSide === 'front' ? processedSegments.reverse() : processedSegments;
  }
}

/**
 * Handles Resist Strip, Metal Lift-off, and Sacrificial Layer Release
 * respecting front, back, or both sides.
 */
function applyStripOrLiftoff(
  columns: ColumnProfile[],
  step: ProcessStep,
  materials: Material[],
  side: 'front' | 'back' | 'both'
): void {
  const cfg = step.strip;
  const stripType =
    cfg?.stripType ?? (step.type === 'liftoff' ? 'metal-liftoff' : 'resist-strip');

  if (stripType === 'sacrificial-release') {
    const targetMat = cfg?.targetMaterialId ?? 'mat_sio2_thermal';
    for (const col of columns) {
      col.segments = col.segments.filter((seg) => {
        if (seg.materialId !== targetMat) return true;
        if (side === 'both') return false;
        if (side === 'front') return seg.side === 'back';
        return seg.side !== 'back';
      });
    }
    return;
  }

  if (stripType === 'metal-liftoff') {
    if (side === 'front' || side === 'both') {
      for (const col of columns) {
        const keptSegments: MaterialSegment[] = [];
        let foundFrontResist = false;

        for (const seg of col.segments) {
          const mat = getMaterialById(materials, seg.materialId);
          if (mat.category === 'photoresist' && seg.side !== 'back') {
            foundFrontResist = true;
          } else if (foundFrontResist && seg.side !== 'back') {
            // Lifted off on frontside
          } else {
            keptSegments.push(seg);
          }
        }
        col.segments = keptSegments;
      }
    }

    if (side === 'back' || side === 'both') {
      for (const col of columns) {
        const keptReversed: MaterialSegment[] = [];
        let foundBackResist = false;

        // Scan from top downward toward backside
        const topDown = [...col.segments].reverse();
        for (const seg of topDown) {
          const mat = getMaterialById(materials, seg.materialId);
          if (mat.category === 'photoresist' && seg.side === 'back') {
            foundBackResist = true;
          } else if (foundBackResist && seg.side === 'back') {
            // Lifted off on backside
          } else {
            keptReversed.push(seg);
          }
        }
        col.segments = keptReversed.reverse();
      }
    }
    return;
  }

  // Standard resist strip: remove photoresist layers on selected side(s)
  for (const col of columns) {
    col.segments = col.segments.filter((seg) => {
      const mat = getMaterialById(materials, seg.materialId);
      if (mat.category !== 'photoresist') return true;
      if (side === 'both') return false;
      if (side === 'front') return seg.side === 'back';
      return seg.side !== 'back';
    });
  }
}

/**
 * Handles CMP (Chemical Mechanical Polishing / Backside Grinding & Planarization)
 */
function applyCmpSide(
  columns: ColumnProfile[],
  step: ProcessStep,
  targetSide: 'front' | 'back'
): void {
  const cfg = step.cmp;
  const mode = cfg?.mode ?? 'polish-depth';

  if (targetSide === 'front') {
    let currentMaxTop = -Infinity;
    for (const col of columns) {
      if (col.segments.length === 0) continue;
      const top = getTopY(col);
      if (top > currentMaxTop) currentMaxTop = top;
    }
    if (currentMaxTop === -Infinity) return;

    let polishPlaneY = currentMaxTop;

    if (mode === 'target-height' && cfg?.targetHeight !== undefined) {
      polishPlaneY = cfg.targetHeight;
    } else if (mode === 'stop-on-layer' && cfg?.stopMaterialId) {
      let highestStop = -Infinity;
      for (const col of columns) {
        for (const seg of col.segments) {
          if (seg.materialId === cfg.stopMaterialId && seg.yTop > highestStop) {
            highestStop = seg.yTop;
          }
        }
      }
      polishPlaneY = highestStop > -Infinity ? highestStop : currentMaxTop - 200;
    } else if (cfg?.depth !== undefined) {
      polishPlaneY = Math.max(0, currentMaxTop - cfg.depth);
    }

    for (const col of columns) {
      const newSegs: MaterialSegment[] = [];
      for (const seg of col.segments) {
        if (seg.yBottom >= polishPlaneY) {
          continue;
        }
        if (seg.yTop > polishPlaneY) {
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
    return;
  }

  // Backside grinding / CMP planarization (bottom-up)
  let currentMinBottom = Infinity;
  for (const col of columns) {
    if (col.segments.length === 0) continue;
    const bot = getBottomY(col);
    if (bot < currentMinBottom) currentMinBottom = bot;
  }
  if (currentMinBottom === Infinity) return;

  let polishPlaneY = currentMinBottom;

  if (mode === 'target-height' && cfg?.targetHeight !== undefined) {
    polishPlaneY = cfg.targetHeight;
  } else if (mode === 'stop-on-layer' && cfg?.stopMaterialId) {
    let lowestStop = Infinity;
    for (const col of columns) {
      for (const seg of col.segments) {
        if (seg.materialId === cfg.stopMaterialId && seg.yBottom < lowestStop) {
          lowestStop = seg.yBottom;
        }
      }
    }
    polishPlaneY = lowestStop < Infinity ? lowestStop : currentMinBottom + 200;
  } else if (cfg?.depth !== undefined) {
    polishPlaneY = currentMinBottom + cfg.depth;
  }

  for (const col of columns) {
    const newSegs: MaterialSegment[] = [];
    for (const seg of col.segments) {
      if (seg.yTop <= polishPlaneY) {
        continue;
      }
      if (seg.yBottom < polishPlaneY) {
        newSegs.push({
          ...seg,
          yBottom: polishPlaneY,
        });
      } else {
        newSegs.push(seg);
      }
    }
    col.segments = newSegs;
  }
}

/**
 * Handles Wafer Bonding:
 * Bonds either a newly user-defined multi-layer substrate or an imported pre-processed wafer flow
 * onto the frontside or backside of the active wafer, preserving enclosed cavities/topography.
 */
function applyBonding(
  columns: ColumnProfile[],
  step: ProcessStep,
  _totalWidth: number,
  recursionDepth: number
): void {
  if (recursionDepth > 4) return;

  const cfg = step.bonding;
  const targetSide: 'front' | 'back' = step.side === 'back' ? 'back' : 'front';
  const incomingFace: 'front' | 'back' = cfg?.incomingFace || 'front';

  // Determine the flat contact plane on the current wafer (rests on highest/lowest point)
  let bondPlaneY = targetSide === 'front' ? -Infinity : Infinity;
  for (const col of columns) {
    if (col.segments.length === 0) continue;
    if (targetSide === 'front') {
      const top = getTopY(col);
      if (top > bondPlaneY) bondPlaneY = top;
    } else {
      const bot = getBottomY(col);
      if (bot < bondPlaneY) bondPlaneY = bot;
    }
  }

  if (bondPlaneY === -Infinity || bondPlaneY === Infinity) {
    bondPlaneY = 0;
  }

  const iface = cfg?.interfaceLayer;
  const ifaceThick =
    iface?.enabled && (iface.thickness ?? 0) > 0 ? iface.thickness : 0;

  const incomingContactY =
    targetSide === 'front'
      ? bondPlaneY + ifaceThick
      : bondPlaneY - ifaceThick;

  // Helper to append/prepend interface layer if enabled
  const buildInterfaceSeg = (): MaterialSegment | null => {
    if (ifaceThick <= 0 || !iface) return null;
    return targetSide === 'front'
      ? {
          yBottom: bondPlaneY,
          yTop: bondPlaneY + ifaceThick,
          materialId: iface.materialId || 'mat_sio2_thermal',
          stepId: step.id,
          side: 'front',
        }
      : {
          yBottom: bondPlaneY - ifaceThick,
          yTop: bondPlaneY,
          materialId: iface.materialId || 'mat_sio2_thermal',
          stepId: step.id,
          side: 'back',
        };
  };

  if (cfg?.sourceType === 'imported-flow' && cfg.importedFlow) {
    const meshB = simulateCrossSectionInternal(
      cfg.importedFlow,
      undefined,
      recursionDepth + 1
    );
    const colsB = meshB.columns;
    if (colsB.length === 0) return;

    const minYB = meshB.minY;
    const maxYB = meshB.maxY;

    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const idxB = Math.min(
        colsB.length - 1,
        Math.floor((i / columns.length) * colsB.length)
      );
      const segsB = colsB[idxB].segments;

      const addedSegs: MaterialSegment[] = [];
      const ifaceSeg = buildInterfaceSeg();

      if (targetSide === 'front') {
        if (ifaceSeg && segsB.length > 0) addedSegs.push(ifaceSeg);
        if (incomingFace === 'front') {
          // Flip Wafer B upside-down so its front (maxYB) mates with incomingContactY
          for (let k = segsB.length - 1; k >= 0; k--) {
            const s = segsB[k];
            addedSegs.push({
              yBottom: incomingContactY + (maxYB - s.yTop),
              yTop: incomingContactY + (maxYB - s.yBottom),
              materialId: s.materialId,
              stepId: step.id,
              side: 'front',
            });
          }
        } else {
          // Wafer B upright so its back (minYB) mates with incomingContactY
          for (const s of segsB) {
            addedSegs.push({
              yBottom: incomingContactY + (s.yBottom - minYB),
              yTop: incomingContactY + (s.yTop - minYB),
              materialId: s.materialId,
              stepId: step.id,
              side: 'front',
            });
          }
        }
        col.segments = [...col.segments, ...addedSegs];
      } else {
        // Bonding onto current wafer's backside
        if (incomingFace === 'front') {
          // Wafer B upright below incomingContactY so its front (maxYB) touches incomingContactY
          for (const s of segsB) {
            addedSegs.push({
              yBottom: incomingContactY - (maxYB - s.yBottom),
              yTop: incomingContactY - (maxYB - s.yTop),
              materialId: s.materialId,
              stepId: step.id,
              side: 'back',
            });
          }
        } else {
          // Wafer B flipped below incomingContactY so its back (minYB) touches incomingContactY
          for (let k = segsB.length - 1; k >= 0; k--) {
            const s = segsB[k];
            addedSegs.push({
              yBottom: incomingContactY - (s.yTop - minYB),
              yTop: incomingContactY - (s.yBottom - minYB),
              materialId: s.materialId,
              stepId: step.id,
              side: 'back',
            });
          }
        }
        if (ifaceSeg && segsB.length > 0) addedSegs.push(ifaceSeg);
        col.segments = [...addedSegs, ...col.segments];
      }
    }
    return;
  }

  // Custom user-defined multi-layer substrate
  const layers =
    cfg?.customLayers && cfg.customLayers.length > 0
      ? cfg.customLayers
      : [
          {
            id: 'bond_sub_default',
            name: 'Bonded Silicon Wafer',
            materialId: 'mat_si_sub',
            thickness: 2500,
          },
        ];

  const orderedLayers =
    (targetSide === 'front' && incomingFace === 'front') ||
    (targetSide === 'back' && incomingFace === 'back')
      ? [...layers].reverse()
      : [...layers];

  for (const col of columns) {
    const addedSegs: MaterialSegment[] = [];
    const ifaceSeg = buildInterfaceSeg();

    if (targetSide === 'front') {
      if (ifaceSeg) addedSegs.push(ifaceSeg);
      let cursorY = incomingContactY;
      for (const l of orderedLayers) {
        const thick = Math.max(1, l.thickness);
        addedSegs.push({
          yBottom: cursorY,
          yTop: cursorY + thick,
          materialId: l.materialId,
          stepId: step.id,
          side: 'front',
        });
        cursorY += thick;
      }
      col.segments = [...col.segments, ...addedSegs];
    } else {
      // Extending downward from incomingContactY (build top-to-bottom, then reverse to bottom-to-top)
      let cursorY = incomingContactY;
      const topDownSegs: MaterialSegment[] = [];
      for (let idx = orderedLayers.length - 1; idx >= 0; idx--) {
        const l = orderedLayers[idx];
        const thick = Math.max(1, l.thickness);
        topDownSegs.push({
          yBottom: cursorY - thick,
          yTop: cursorY,
          materialId: l.materialId,
          stepId: step.id,
          side: 'back',
        });
        cursorY -= thick;
      }
      addedSegs.push(...topDownSegs.reverse());
      if (ifaceSeg) addedSegs.push(ifaceSeg);
      col.segments = [...addedSegs, ...col.segments];
    }
  }
}

/**
 * Converts mesh column segments into clean SVG polygon outlines for high-performance rendering.
 */
export function buildRenderPolygons(
  mesh: CrossSectionMesh,
  _materials: Material[]
): RenderedPolygon[] {
  const polygons: RenderedPolygon[] = [];
  const { columns, width } = mesh;
  const dx = width / columns.length;

  if (columns.length === 0) return polygons;

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
      const existing = activeRegions.find((r) => {
        if (r.endCol !== c - 1 || r.materialId !== seg.materialId) return false;
        const prevTop = r.topYs[r.topYs.length - 1];
        const prevBottom = r.bottomYs[r.bottomYs.length - 1];

        // Keep sloped polygons (e.g. tapered/retrograde resist, KOH trenches) continuous
        // when adjacent segments belong to the same step and overlap vertically
        if (r.stepId && seg.stepId && r.stepId === seg.stepId) {
          const overlaps =
            Math.max(prevBottom, seg.yBottom) <= Math.min(prevTop, seg.yTop) + 5;
          if (overlaps) return true;
        }

        return (
          Math.abs(prevTop - seg.yTop) < 100 &&
          Math.abs(prevBottom - seg.yBottom) < 100
        );
      });

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

    // Right edge down to bottom-right
    const xEnd = (reg.endCol + 1) * dx;
    const lastIdx = reg.bottomYs.length - 1;
    pts.push({ x: xEnd, y: reg.bottomYs[lastIdx] });

    // Bottom surface right to left
    for (let i = reg.bottomYs.length - 1; i >= 0; i--) {
      const colIdx = reg.startCol + i;
      const x = colIdx * dx;
      pts.push({ x, y: reg.bottomYs[i] });
    }

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

function getBottomY(col: ColumnProfile): number {
  if (col.segments.length === 0) return 0;
  return col.segments[0].yBottom;
}

function checkDirectionalShadow(_columns: ColumnProfile[], _index: number): boolean {
  return false;
}
