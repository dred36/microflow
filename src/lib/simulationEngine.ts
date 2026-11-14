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
  ScallopWall,
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
  const scallopWalls: ScallopWall[] = [];

  for (let idx = 0; idx <= maxIdx; idx++) {
    const step = enabledSteps[idx];
    stepSummaries.push({
      stepId: step.id,
      stepIndex: idx,
      title: step.title,
    });
    applyStep(columns, step, flow.materials, width, recursionDepth, scallopWalls);
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
    scallopWalls,
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
  recursionDepth: number = 0,
  scallopWalls: ScallopWall[] = []
): void {
  const side = step.side || 'front';

  switch (step.type) {
    case 'substrate': {
      scallopWalls.length = 0;
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
        applyDepositionSide(columns, step, totalWidth, 'front');
      }
      if (side === 'back' || side === 'both') {
        applyDepositionSide(columns, step, totalWidth, 'back');
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
        applyEtchSide(columns, step, materials, totalWidth, 'front', scallopWalls);
      }
      if (side === 'back' || side === 'both') {
        applyEtchSide(columns, step, materials, totalWidth, 'back', scallopWalls);
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
  totalWidth: number,
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
      const rawTilt = cfg?.tiltAngle ?? 0;
      const clampedTilt = Math.max(-80, Math.min(80, rawTilt));
      const tiltRad = (clampedTilt * Math.PI) / 180;
      const cosA = Math.cos(tiltRad);
      const sinAbs = Math.abs(Math.sin(tiltRad));
      const th = thickness * cosA;
      const tw = thickness * sinAbs;

      // Normal incidence (0°): purely vertical line-of-sight
      if (Math.abs(clampedTilt) < 0.25 || sinAbs < 1e-4) {
        for (let i = 0; i < columns.length; i++) {
          const col = columns[i];
          if (col.segments.length === 0) continue;
          const topY = getTopY(col);
          col.segments.push({
            yBottom: topY,
            yTop: topY + th,
            materialId: matId,
            stepId: step.id,
            side: 'front',
          });
        }
        return;
      }

      const n = columns.length;
      const dx = totalWidth / Math.max(1, n);
      const slope = cosA / sinAbs; // cot(|tilt|): ray rise per horizontal dx

      const baseTops = new Float64Array(n);
      const hasCol = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        if (columns[i].segments.length > 0) {
          hasCol[i] = 1;
          baseTops[i] = getTopY(columns[i]);
        }
      }

      // Compute incoming-ray shadow ceiling height at each column center
      const shadowHeight = new Float64Array(n);
      const beamFromRight = clampedTilt > 0;
      let runningEdge = -Infinity;

      if (beamFromRight) {
        for (let k = n - 1; k >= 0; k--) {
          shadowHeight[k] = runningEdge - slope * 0.5 * dx;
          const afterK = runningEdge - slope * dx;
          runningEdge = hasCol[k] ? Math.max(afterK, baseTops[k]) : afterK;
        }
      } else {
        for (let k = 0; k < n; k++) {
          shadowHeight[k] = runningEdge - slope * 0.5 * dx;
          const afterK = runningEdge - slope * dx;
          runningEdge = hasCol[k] ? Math.max(afterK, baseTops[k]) : afterK;
        }
      }

      const newBottoms = new Float64Array(n).fill(Infinity);
      const newTops = new Float64Array(n).fill(-Infinity);

      // 1. Horizontal surface deposition where unshadowed
      for (let i = 0; i < n; i++) {
        if (!hasCol[i]) continue;
        if (shadowHeight[i] <= baseTops[i] + 1e-3) {
          newBottoms[i] = baseTops[i];
          newTops[i] = baseTops[i] + th;
        }
      }

      // 2. Sidewall deposition on illuminated vertical/sloped faces facing the beam
      if (tw > 0) {
        const dir = beamFromRight ? 1 : -1;
        const colRadius = Math.max(1, Math.ceil(tw / dx + 0.5));

        for (let i = 0; i < n; i++) {
          if (!hasCol[i]) continue;
          if (shadowHeight[i] > baseTops[i] + 1e-3) continue;

          for (let stepIdx = 1; stepIdx <= colRadius; stepIdx++) {
            const j = i + dir * stepIdx;
            if (j < 0 || j >= n || !hasCol[j]) break;
            if (baseTops[j] >= baseTops[i]) break;

            const distX = (stepIdx - 0.5) * dx;
            let candidateTop: number;
            if (distX <= tw) {
              const normX = Math.max(0, distX / tw);
              candidateTop =
                baseTops[i] + th * Math.sqrt(Math.max(0, 1 - normX * normX));
            } else if (
              stepIdx === 1 &&
              baseTops[i] - baseTops[j] > 1 &&
              tw >= dx * 0.15
            ) {
              candidateTop = baseTops[i] + Math.min(th * 0.15, tw * 0.5);
            } else {
              break;
            }

            const candidateBottom = Math.max(baseTops[j], shadowHeight[j]);
            if (candidateTop <= candidateBottom + 1e-3) continue;

            if (newBottoms[j] === Infinity) {
              newBottoms[j] = candidateBottom;
              newTops[j] = candidateTop;
            } else {
              newBottoms[j] = Math.min(newBottoms[j], candidateBottom);
              newTops[j] = Math.max(newTops[j], candidateTop);
            }
          }
        }
      }

      for (let i = 0; i < n; i++) {
        if (!hasCol[i]) continue;
        if (newBottoms[i] < Infinity && newTops[i] > newBottoms[i]) {
          columns[i].segments.push({
            yBottom: newBottoms[i],
            yTop: newTops[i],
            materialId: matId,
            stepId: step.id,
            side: 'front',
          });
        }
      }
      return;
    }

    const stepCoverage =
      depType === 'semi-conformal'
        ? Math.max(0, Math.min(1, (cfg?.stepCoverage ?? 60) / 100))
        : 1.0;
    const cornerBoostEnabled =
      Boolean(cfg?.convexCornerEffect) &&
      (depType === 'conformal' || depType === 'semi-conformal');
    const cornerBoostStrength = Math.max(0.05, cfg?.convexCornerStrength ?? 0.6);
    const cornerFactors = cornerBoostEnabled
      ? computeConvexCornerFactors(columns, totalWidth, 'front', thickness)
      : null;

    const dx = totalWidth / Math.max(1, columns.length);
    const baseTops = new Float64Array(columns.length);
    const newTops = new Float64Array(columns.length);

    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      if (col.segments.length === 0) continue;
      const topY = getTopY(col);
      baseTops[i] = topY;

      const cFactor = cornerFactors ? cornerFactors[i] : 0;
      const verticalThick = thickness * (1 + cornerBoostStrength * cFactor);
      newTops[i] = topY + verticalThick;
    }

    // 2D ellipsoidal lateral sidewall coverage:
    // Top surface stays at 100% vertical thickness; sidewall step coverage scales ONLY lateral thickness (Tx).
    if (stepCoverage > 0) {
      for (let i = 0; i < columns.length; i++) {
        if (columns[i].segments.length === 0) continue;
        const cFactor = cornerFactors ? cornerFactors[i] : 0;
        const tz = thickness * (1 + cornerBoostStrength * cFactor);
        const tx = tz * stepCoverage;
        if (tx <= 0) continue;

        const colRadius = Math.ceil(tx / dx + 0.5);
        const startJ = Math.max(0, i - colRadius);
        const endJ = Math.min(columns.length - 1, i + colRadius);

        for (let j = startJ; j <= endJ; j++) {
          if (j === i || columns[j].segments.length === 0) continue;
          // Only dilate laterally across step sidewalls where neighbor surface is lower
          if (baseTops[j] >= baseTops[i]) continue;

          const distX = (Math.abs(j - i) - 0.5) * dx;
          let candidateTop: number;
          if (distX > tx) {
            // Keep sub-column sidewall film continuous down vertical steps when tx < 0.5 * dx
            if (Math.abs(j - i) === 1 && baseTops[i] - baseTops[j] > 1) {
              candidateTop = baseTops[i] + Math.min(tz * 0.15, tx * 0.5);
            } else {
              continue;
            }
          } else {
            const normX = Math.max(0, distX / tx);
            candidateTop =
              baseTops[i] + tz * Math.sqrt(Math.max(0, 1 - normX * normX));
          }
          if (candidateTop > newTops[j]) {
            newTops[j] = candidateTop;
          }
        }
      }
    }

    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      if (col.segments.length === 0) continue;
      if (newTops[i] > baseTops[i]) {
        col.segments.push({
          yBottom: baseTops[i],
          yTop: newTops[i],
          materialId: matId,
          stepId: step.id,
          side: 'front',
        });
      }
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
    const rawTilt = cfg?.tiltAngle ?? 0;
    const clampedTilt = Math.max(-80, Math.min(80, rawTilt));
    const tiltRad = (clampedTilt * Math.PI) / 180;
    const cosA = Math.cos(tiltRad);
    const sinAbs = Math.abs(Math.sin(tiltRad));
    const th = thickness * cosA;
    const tw = thickness * sinAbs;

    if (Math.abs(clampedTilt) < 0.25 || sinAbs < 1e-4) {
      for (let i = 0; i < columns.length; i++) {
        const col = columns[i];
        if (col.segments.length === 0) continue;
        const bottomY = getBottomY(col);
        col.segments.unshift({
          yBottom: bottomY - th,
          yTop: bottomY,
          materialId: matId,
          stepId: step.id,
          side: 'back',
        });
      }
      return;
    }

    const n = columns.length;
    const dx = totalWidth / Math.max(1, n);
    const slope = cosA / sinAbs;

    const baseBottoms = new Float64Array(n);
    const hasCol = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (columns[i].segments.length > 0) {
        hasCol[i] = 1;
        baseBottoms[i] = getBottomY(columns[i]);
      }
    }

    // Shadow ceiling (lowest Y reachable by upward beam from below)
    const shadowCeiling = new Float64Array(n);
    const beamFromRight = clampedTilt > 0;
    let runningEdge = Infinity;

    if (beamFromRight) {
      for (let k = n - 1; k >= 0; k--) {
        shadowCeiling[k] = runningEdge + slope * 0.5 * dx;
        const afterK = runningEdge + slope * dx;
        runningEdge = hasCol[k] ? Math.min(afterK, baseBottoms[k]) : afterK;
      }
    } else {
      for (let k = 0; k < n; k++) {
        shadowCeiling[k] = runningEdge + slope * 0.5 * dx;
        const afterK = runningEdge + slope * dx;
        runningEdge = hasCol[k] ? Math.min(afterK, baseBottoms[k]) : afterK;
      }
    }

    const newBottoms = new Float64Array(n).fill(Infinity);
    const newTops = new Float64Array(n).fill(-Infinity);

    for (let i = 0; i < n; i++) {
      if (!hasCol[i]) continue;
      if (shadowCeiling[i] >= baseBottoms[i] - 1e-3) {
        newBottoms[i] = baseBottoms[i] - th;
        newTops[i] = baseBottoms[i];
      }
    }

    if (tw > 0) {
      const dir = beamFromRight ? 1 : -1;
      const colRadius = Math.max(1, Math.ceil(tw / dx + 0.5));

      for (let i = 0; i < n; i++) {
        if (!hasCol[i]) continue;
        if (shadowCeiling[i] < baseBottoms[i] - 1e-3) continue;

        for (let stepIdx = 1; stepIdx <= colRadius; stepIdx++) {
          const j = i + dir * stepIdx;
          if (j < 0 || j >= n || !hasCol[j]) break;
          if (baseBottoms[j] <= baseBottoms[i]) break;

          const distX = (stepIdx - 0.5) * dx;
          let candidateBottom: number;
          if (distX <= tw) {
            const normX = Math.max(0, distX / tw);
            candidateBottom =
              baseBottoms[i] - th * Math.sqrt(Math.max(0, 1 - normX * normX));
          } else if (
            stepIdx === 1 &&
            baseBottoms[j] - baseBottoms[i] > 1 &&
            tw >= dx * 0.15
          ) {
            candidateBottom = baseBottoms[i] - Math.min(th * 0.15, tw * 0.5);
          } else {
            break;
          }

          const candidateTop = Math.min(baseBottoms[j], shadowCeiling[j]);
          if (candidateTop <= candidateBottom + 1e-3) continue;

          if (newTops[j] === -Infinity) {
            newBottoms[j] = candidateBottom;
            newTops[j] = candidateTop;
          } else {
            newBottoms[j] = Math.min(newBottoms[j], candidateBottom);
            newTops[j] = Math.max(newTops[j], candidateTop);
          }
        }
      }
    }

    for (let i = 0; i < n; i++) {
      if (!hasCol[i]) continue;
      if (newTops[i] > -Infinity && newTops[i] > newBottoms[i]) {
        columns[i].segments.unshift({
          yBottom: newBottoms[i],
          yTop: newTops[i],
          materialId: matId,
          stepId: step.id,
          side: 'back',
        });
      }
    }
    return;
  }

  const stepCoverage =
    depType === 'semi-conformal'
      ? Math.max(0, Math.min(1, (cfg?.stepCoverage ?? 60) / 100))
      : 1.0;
  const cornerBoostEnabled =
    Boolean(cfg?.convexCornerEffect) &&
    (depType === 'conformal' || depType === 'semi-conformal');
  const cornerBoostStrength = Math.max(0.05, cfg?.convexCornerStrength ?? 0.6);
  const cornerFactors = cornerBoostEnabled
    ? computeConvexCornerFactors(columns, totalWidth, 'back', thickness)
    : null;

  const dx = totalWidth / Math.max(1, columns.length);
  const baseBottoms = new Float64Array(columns.length);
  const newBottoms = new Float64Array(columns.length);

  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    if (col.segments.length === 0) continue;
    const bottomY = getBottomY(col);
    baseBottoms[i] = bottomY;

    const cFactor = cornerFactors ? cornerFactors[i] : 0;
    const verticalThick = thickness * (1 + cornerBoostStrength * cFactor);
    newBottoms[i] = bottomY - verticalThick;
  }

  if (stepCoverage > 0) {
    for (let i = 0; i < columns.length; i++) {
      if (columns[i].segments.length === 0) continue;
      const cFactor = cornerFactors ? cornerFactors[i] : 0;
      const tz = thickness * (1 + cornerBoostStrength * cFactor);
      const tx = tz * stepCoverage;
      if (tx <= 0) continue;

      const colRadius = Math.ceil(tx / dx + 0.5);
      const startJ = Math.max(0, i - colRadius);
      const endJ = Math.min(columns.length - 1, i + colRadius);

      for (let j = startJ; j <= endJ; j++) {
        if (j === i || columns[j].segments.length === 0) continue;
        if (baseBottoms[j] <= baseBottoms[i]) continue;

        const distX = (Math.abs(j - i) - 0.5) * dx;
        let candidateBottom: number;
        if (distX > tx) {
          if (Math.abs(j - i) === 1 && baseBottoms[j] - baseBottoms[i] > 1) {
            candidateBottom = baseBottoms[i] - Math.min(tz * 0.15, tx * 0.5);
          } else {
            continue;
          }
        } else {
          const normX = Math.max(0, distX / tx);
          candidateBottom =
            baseBottoms[i] - tz * Math.sqrt(Math.max(0, 1 - normX * normX));
        }
        if (candidateBottom < newBottoms[j]) {
          newBottoms[j] = candidateBottom;
        }
      }
    }
  }

  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    if (col.segments.length === 0) continue;
    if (newBottoms[i] < baseBottoms[i]) {
      col.segments.unshift({
        yBottom: newBottoms[i],
        yTop: baseBottoms[i],
        materialId: matId,
        stepId: step.id,
        side: 'back',
      });
    }
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
  targetSide: 'front' | 'back',
  scallopWalls?: ScallopWall[]
): void {
  const cfg = step.etch;
  const depth = cfg?.depth ?? step.thickness ?? 200;
  const targetMatId = cfg?.targetMaterialId ?? 'all';
  const isotropy =
    cfg?.isotropy ?? (cfg?.etchType === 'wet-isotropic' ? 0.95 : 0);
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

  // Convex corner acceleration for isotropic etching (wet-isotropic or isotropy >= 0.15)
  const isIsotropicEtch = cfg?.etchType === 'wet-isotropic' || isotropy >= 0.15;
  if (cfg?.convexCornerEffect && isIsotropicEtch) {
    const cornerBoostStrength = Math.max(0.05, cfg.convexCornerStrength ?? 0.6);
    const cornerFactors = computeConvexCornerFactors(
      columns,
      totalWidth,
      targetSide,
      depth
    );
    for (let i = 0; i < columns.length; i++) {
      if (isColumnExposed[i] && cornerFactors[i] > 0) {
        baseDepthPerCol[i] *= 1 + cornerBoostStrength * cornerFactors[i];
      }
    }
  }

  const isCrystallographic =
    cfg?.etchType === 'wet-koh' || sidewallAngle < 89.5;
  const etchDepthPerCol = new Float64Array(baseDepthPerCol);

  // Tapered / crystallographic sidewalls (e.g. KOH 54.74°):
  // Non-zero isotropy shifts the sloped crystal wall laterally outward by U = D * isotropy
  // while preserving the target sidewall angle.
  if (isCrystallographic) {
    const clampedAngle = Math.max(15, Math.min(89.5, sidewallAngle));
    const angleRad = (clampedAngle * Math.PI) / 180;
    const tanAngle = Math.tan(angleRad);

    for (let i = 0; i < columns.length; i++) {
      if (!isColumnExposed[i]) continue;
      const localDepth = baseDepthPerCol[i];
      const lateralUndercut = localDepth * Math.max(0, isotropy);

      let stepsLeft = 0;
      while (i - stepsLeft >= 0 && isColumnExposed[i - stepsLeft]) {
        stepsLeft++;
      }
      let stepsRight = 0;
      while (i + stepsRight < columns.length && isColumnExposed[i + stepsRight]) {
        stepsRight++;
      }

      const distToLeftEdge =
        i - stepsLeft < 0 ? Infinity : (stepsLeft - 0.5) * dx;
      const distToRightEdge =
        i + stepsRight >= columns.length ? Infinity : (stepsRight - 0.5) * dx;
      const nearestEdgeDist = Math.min(distToLeftEdge, distToRightEdge);

      if (Number.isFinite(nearestEdgeDist)) {
        const effHorizontalRun = nearestEdgeDist + lateralUndercut;
        etchDepthPerCol[i] = Math.min(localDepth, effHorizontalRun * tanAngle);
      }
    }
  }

  // Bosch DRIE sidewall scallops are modeled geometrically along the etched trench walls after step 5.

  // 3. Determine vertical etch reach per column before applying 2D lateral wavefront
  const verticalEtchFloor = new Float64Array(columns.length);
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    if (col.segments.length === 0) {
      verticalEtchFloor[i] = 0;
      continue;
    }
    const surfaceY = targetSide === 'front' ? getTopY(col) : getBottomY(col);
    const budget = etchDepthPerCol[i];
    if (budget <= 0 || !isColumnExposed[i]) {
      verticalEtchFloor[i] = surfaceY;
      continue;
    }

    const orderedSegments =
      targetSide === 'front' ? [...col.segments].reverse() : [...col.segments];
    let remaining = budget;
    let reachedY = surfaceY;

    for (const seg of orderedSegments) {
      const mat = getMaterialById(materials, seg.materialId);
      if (mat.category === 'photoresist' && cfg?.etchType !== 'ashing') break;
      if (stopLayerId && seg.materialId === stopLayerId) break;
      if (targetMatId !== 'all' && seg.materialId !== targetMatId) break;

      const segHeight = seg.yTop - seg.yBottom;
      if (remaining >= segHeight) {
        remaining -= segHeight;
        reachedY = targetSide === 'front' ? seg.yBottom : seg.yTop;
      } else {
        reachedY =
          targetSide === 'front' ? seg.yTop - remaining : seg.yBottom + remaining;
        remaining = 0;
        break;
      }
    }

    verticalEtchFloor[i] = reachedY;
  }

  // 4. 2D Lateral Wavefront (Crystallographic angled undercut for KOH, or Huygens circular for RIE/Wet)
  const finalFrontReachY = new Float64Array(columns.length);
  const openAmbientReachY = new Float64Array(columns.length);
  const lateralReachY = new Float64Array(columns.length);
  const hasLateralUndercut = new Uint8Array(columns.length);

  for (let j = 0; j < columns.length; j++) {
    const col = columns[j];
    const surfaceY =
      col.segments.length === 0
        ? 0
        : targetSide === 'front'
        ? getTopY(col)
        : getBottomY(col);
    finalFrontReachY[j] = verticalEtchFloor[j];
    openAmbientReachY[j] = surfaceY;
    lateralReachY[j] = surfaceY;
  }

  const isReentrant =
    sidewallAngle > 90.5 &&
    (cfg?.etchType === 'rie' || cfg?.etchType === 'drie-bosch');

  if (isotropy > 0 && isCrystallographic) {
    const clampedAngle = Math.max(15, Math.min(89.5, sidewallAngle));
    const tanAngle = Math.tan((clampedAngle * Math.PI) / 180);

    for (let i = 0; i < columns.length; i++) {
      if (!isColumnExposed[i]) continue;
      const colI = columns[i];
      if (colI.segments.length === 0) continue;

      const yAirI = targetSide === 'front' ? getTopY(colI) : getBottomY(colI);
      const localDepth = baseDepthPerCol[i];
      const lateralUndercut = localDepth * isotropy;
      if (lateralUndercut <= 0) continue;

      // Max vertical penetration allowed by stopLayerId / targetMatId at source column i
      const orderedSegsI =
        targetSide === 'front' ? [...colI.segments].reverse() : [...colI.segments];
      let rem = localDepth;
      let maxReachedY = yAirI;
      for (const seg of orderedSegsI) {
        const mat = getMaterialById(materials, seg.materialId);
        if (mat.category === 'photoresist' && cfg?.etchType !== 'ashing') break;
        if (stopLayerId && seg.materialId === stopLayerId) break;
        if (targetMatId !== 'all' && seg.materialId !== targetMatId) break;
        const h = seg.yTop - seg.yBottom;
        if (rem >= h) {
          rem -= h;
          maxReachedY = targetSide === 'front' ? seg.yBottom : seg.yTop;
        } else {
          maxReachedY =
            targetSide === 'front' ? seg.yTop - rem : seg.yBottom + rem;
          rem = 0;
          break;
        }
      }
      const maxEtchableSpan = Math.abs(maxReachedY - yAirI);

      const isLeftMaskEdge = i > 0 && !isColumnExposed[i - 1];
      const isRightMaskEdge =
        i < columns.length - 1 && !isColumnExposed[i + 1];
      const colRadius = Math.ceil(lateralUndercut / dx + 0.5);

      // 4A. Mask undercut preserving crystallographic sidewallAngle
      if (isLeftMaskEdge) {
        const maskEdgeX = i * dx;
        for (let stepCols = 1; stepCols <= colRadius; stepCols++) {
          const j = i - stepCols;
          if (j < 0 || isColumnExposed[j]) break;
          const distUnderMask = maskEdgeX - columns[j].x;
          const remainingRun = lateralUndercut - distUnderMask;
          if (remainingRun <= 0) break;

          const undercutDepth = Math.min(maxEtchableSpan, remainingRun * tanAngle);
          if (undercutDepth <= 0) continue;

          if (targetSide === 'front') {
            if (yAirI < openAmbientReachY[j]) openAmbientReachY[j] = yAirI;
            const targetY = yAirI - undercutDepth;
            if (targetY < lateralReachY[j]) {
              lateralReachY[j] = targetY;
              hasLateralUndercut[j] = 1;
            }
            if (targetY < finalFrontReachY[j]) finalFrontReachY[j] = targetY;
          } else {
            if (yAirI > openAmbientReachY[j]) openAmbientReachY[j] = yAirI;
            const targetY = yAirI + undercutDepth;
            if (targetY > lateralReachY[j]) {
              lateralReachY[j] = targetY;
              hasLateralUndercut[j] = 1;
            }
            if (targetY > finalFrontReachY[j]) finalFrontReachY[j] = targetY;
          }
        }
      }

      if (isRightMaskEdge) {
        const maskEdgeX = (i + 1) * dx;
        for (let stepCols = 1; stepCols <= colRadius; stepCols++) {
          const j = i + stepCols;
          if (j >= columns.length || isColumnExposed[j]) break;
          const distUnderMask = columns[j].x - maskEdgeX;
          const remainingRun = lateralUndercut - distUnderMask;
          if (remainingRun <= 0) break;

          const undercutDepth = Math.min(maxEtchableSpan, remainingRun * tanAngle);
          if (undercutDepth <= 0) continue;

          if (targetSide === 'front') {
            if (yAirI < openAmbientReachY[j]) openAmbientReachY[j] = yAirI;
            const targetY = yAirI - undercutDepth;
            if (targetY < lateralReachY[j]) {
              lateralReachY[j] = targetY;
              hasLateralUndercut[j] = 1;
            }
            if (targetY < finalFrontReachY[j]) finalFrontReachY[j] = targetY;
          } else {
            if (yAirI > openAmbientReachY[j]) openAmbientReachY[j] = yAirI;
            const targetY = yAirI + undercutDepth;
            if (targetY > lateralReachY[j]) {
              lateralReachY[j] = targetY;
              hasLateralUndercut[j] = 1;
            }
            if (targetY > finalFrontReachY[j]) finalFrontReachY[j] = targetY;
          }
        }
      }

      // 4B. Open-topography sidewall recession at sidewallAngle
      const vReachI = verticalEtchFloor[i];
      for (const dir of [-1, 1] as const) {
        const wallEdgeX = dir === -1 ? i * dx : (i + 1) * dx;
        for (let stepCols = 1; stepCols <= colRadius; stepCols++) {
          const j = i + dir * stepCols;
          if (j < 0 || j >= columns.length || !isColumnExposed[j]) break;
          const yAirJ =
            targetSide === 'front' ? getTopY(columns[j]) : getBottomY(columns[j]);
          const standsTaller =
            targetSide === 'front' ? yAirJ > yAirI + 1 : yAirJ < yAirI - 1;
          if (!standsTaller) break;

          const distIntoWall = Math.abs(columns[j].x - wallEdgeX);
          const remainingRun = lateralUndercut - distIntoWall;
          if (remainingRun <= 0) break;

          const extraDrop = remainingRun * tanAngle;
          if (targetSide === 'front') {
            const targetY = Math.max(vReachI, verticalEtchFloor[j] - extraDrop);
            if (targetY < finalFrontReachY[j]) finalFrontReachY[j] = targetY;
          } else {
            const targetY = Math.min(vReachI, verticalEtchFloor[j] + extraDrop);
            if (targetY > finalFrontReachY[j]) finalFrontReachY[j] = targetY;
          }
        }
      }
    }
  } else if (isotropy > 0 && !isReentrant) {
    for (let i = 0; i < columns.length; i++) {
      const colI = columns[i];
      if (colI.segments.length === 0) continue;

      const topSurfaceMat = getMaterialById(
        materials,
        targetSide === 'front'
          ? colI.segments[colI.segments.length - 1].materialId
          : colI.segments[0].materialId
      );
      const hasProtectiveResist =
        topSurfaceMat.category === 'photoresist' && cfg?.etchType !== 'ashing';
      if (hasProtectiveResist) continue;

      const yAirI = targetSide === 'front' ? getTopY(colI) : getBottomY(colI);
      const vReachI = verticalEtchFloor[i];
      const localRz = Math.max(baseDepthPerCol[i], etchDepthPerCol[i]);
      const effectiveRz = localRz > 0 ? localRz : depth;
      const effectiveRx = effectiveRz * isotropy;
      if (effectiveRx <= 0) continue;

      const colRadius = Math.ceil(effectiveRx / dx);
      const startJ = Math.max(0, i - colRadius);
      const endJ = Math.min(columns.length - 1, i + colRadius);

      for (let j = startJ; j <= endJ; j++) {
        if (j === i) continue;
        const distX = Math.abs(j - i) * dx;
        if (distX > effectiveRx) continue;

        const normX = distX / effectiveRx;
        const curveDrop =
          effectiveRz * Math.sqrt(Math.max(0, 1 - normX * normX));

        if (targetSide === 'front') {
          if (yAirI < openAmbientReachY[j]) {
            openAmbientReachY[j] = yAirI;
          }
          const curvedY =
            vReachI < yAirI
              ? Math.max(vReachI, yAirI - curveDrop)
              : yAirI;
          if (curvedY < finalFrontReachY[j]) {
            finalFrontReachY[j] = curvedY;
          }
          if (isColumnExposed[i] && curvedY < lateralReachY[j]) {
            lateralReachY[j] = curvedY;
            hasLateralUndercut[j] = 1;
          }
        } else {
          if (yAirI > openAmbientReachY[j]) {
            openAmbientReachY[j] = yAirI;
          }
          const curvedY =
            vReachI > yAirI
              ? Math.min(vReachI, yAirI + curveDrop)
              : yAirI;
          if (curvedY > finalFrontReachY[j]) {
            finalFrontReachY[j] = curvedY;
          }
          if (isColumnExposed[i] && curvedY > lateralReachY[j]) {
            lateralReachY[j] = curvedY;
            hasLateralUndercut[j] = 1;
          }
        }
      }
    }
  }

  // 5. Apply combined vertical + horizontal etch removal to column segments
  const etchedDelta = new Float64Array(columns.length);
  const etchedTopY = new Float64Array(columns.length).fill(NaN);
  const etchedFloorY = new Float64Array(columns.length).fill(NaN);

  for (let j = 0; j < columns.length; j++) {
    const col = columns[j];
    if (col.segments.length === 0) continue;

    const targetReach = finalFrontReachY[j];
    const ambientReach = openAmbientReachY[j];
    const latReach = lateralReachY[j];
    const surfaceY = targetSide === 'front' ? getTopY(col) : getBottomY(col);

    if (
      targetSide === 'front' &&
      targetReach >= surfaceY &&
      ambientReach >= surfaceY &&
      !hasLateralUndercut[j]
    ) {
      continue;
    }
    if (
      targetSide === 'back' &&
      targetReach <= surfaceY &&
      ambientReach <= surfaceY &&
      !hasLateralUndercut[j]
    ) {
      continue;
    }

    const orderedSegments =
      targetSide === 'front' ? [...col.segments].reverse() : [...col.segments];
    const processedSegments: MaterialSegment[] = [];
    let blockedBelow = false;

    for (const seg of orderedSegments) {
      const mat = getMaterialById(materials, seg.materialId);

      // Protect photoresist mask unless O2 plasma ashing
      if (mat.category === 'photoresist' && cfg?.etchType !== 'ashing') {
        processedSegments.push(seg);
        continue;
      }

      const isLaterallyExposed =
        targetSide === 'front'
          ? seg.yTop > ambientReach
          : seg.yBottom < ambientReach;

      if (stopLayerId && seg.materialId === stopLayerId) {
        blockedBelow = true;
        processedSegments.push(seg);
        continue;
      }

      if (targetMatId !== 'all' && seg.materialId !== targetMatId) {
        if (!isLaterallyExposed) {
          blockedBelow = true;
        }
        processedSegments.push(seg);
        continue;
      }

      // When vertically blocked by an overlying hardmask cap, lateral undercut from adjacent
      // exposed columns can still etch segments whose elevation meets the opening entry window.
      const canUndercutBeneathCap =
        hasLateralUndercut[j] &&
        (targetSide === 'front'
          ? ambientReach > seg.yBottom && latReach < seg.yTop
          : ambientReach < seg.yTop && latReach > seg.yBottom);

      const effectiveReach = blockedBelow
        ? canUndercutBeneathCap
          ? latReach
          : isLaterallyExposed
          ? ambientReach
          : targetSide === 'front'
          ? seg.yTop
          : seg.yBottom
        : targetReach;

      if (targetSide === 'front') {
        if (effectiveReach < seg.yTop) {
          const newFloor = Math.max(seg.yBottom, effectiveReach);
          const removed = seg.yTop - newFloor;
          if (removed > 0.5) {
            etchedDelta[j] += removed;
            if (Number.isNaN(etchedTopY[j])) etchedTopY[j] = seg.yTop;
            etchedFloorY[j] = newFloor;
          }
        }
        if (effectiveReach <= seg.yBottom) {
          // Segment completely etched away
        } else if (effectiveReach < seg.yTop) {
          processedSegments.push({
            ...seg,
            yTop: effectiveReach,
          });
        } else {
          processedSegments.push(seg);
        }
      } else {
        if (effectiveReach > seg.yBottom) {
          const newFloor = Math.min(seg.yTop, effectiveReach);
          const removed = newFloor - seg.yBottom;
          if (removed > 0.5) {
            etchedDelta[j] += removed;
            if (Number.isNaN(etchedTopY[j])) etchedTopY[j] = seg.yBottom;
            etchedFloorY[j] = newFloor;
          }
        }
        if (effectiveReach >= seg.yTop) {
          // Segment completely etched away
        } else if (effectiveReach > seg.yBottom) {
          processedSegments.push({
            ...seg,
            yBottom: effectiveReach,
          });
        } else {
          processedSegments.push(seg);
        }
      }
    }

    col.segments =
      targetSide === 'front' ? processedSegments.reverse() : processedSegments;
  }

  // 6. Record Bosch DRIE sidewall scallop geometry & re-entrant wall profiles for 2D polygon rendering
  const shouldEmitScallops =
    cfg?.etchType === 'drie-bosch' && Boolean(cfg?.scallopEffect);
  if ((shouldEmitScallops || isReentrant) && scallopWalls) {
    const rawScallopDepth = shouldEmitScallops
      ? Math.max(5, Math.min(300, cfg?.scallopDepth ?? 45))
      : 0;
    const rawScallopPitch = Math.max(20, Math.min(1000, cfg?.scallopPitch ?? 200));
    const clampedPosAngle = Math.max(15, Math.min(89.5, sidewallAngle));
    const tanPosAngle = Math.tan((clampedPosAngle * Math.PI) / 180);
    const tanReentrantOverhang = isReentrant
      ? Math.tan(((Math.min(135, sidewallAngle) - 90) * Math.PI) / 180)
      : 0;

    let idx = 0;
    while (idx < columns.length) {
      if (etchedDelta[idx] <= 5) {
        idx++;
        continue;
      }
      const runStart = idx;
      while (idx < columns.length && etchedDelta[idx] > 5) {
        idx++;
      }
      const runEnd = idx - 1;
      const mid = Math.floor((runStart + runEnd) / 2);

      // Left trench wall
      if (runStart > 0 && columns[runStart - 1].segments.length > 0) {
        const colTop = runStart - 1;
        const yTopEntry = etchedTopY[runStart];

        let bestFloor = etchedFloorY[runStart];
        for (let c = runStart; c <= mid; c++) {
          if (Number.isNaN(etchedFloorY[c])) continue;
          if (
            targetSide === 'front'
              ? etchedFloorY[c] < bestFloor
              : etchedFloorY[c] > bestFloor
          ) {
            bestFloor = etchedFloorY[c];
          }
        }

        let colBot = runStart;
        for (let c = runStart; c <= mid; c++) {
          if (
            !Number.isNaN(etchedFloorY[c]) &&
            Math.abs(etchedFloorY[c] - bestFloor) <= 1.5
          ) {
            colBot = c;
            break;
          }
        }
        const yBotFloor = etchedFloorY[colBot];
        const wallHeight =
          targetSide === 'front' ? yTopEntry - yBotFloor : yBotFloor - yTopEntry;
        const shoulderStandsTaller =
          targetSide === 'front'
            ? getTopY(columns[colTop]) > yBotFloor + 10
            : getBottomY(columns[colTop]) < yBotFloor - 10;

        if (
          Number.isFinite(wallHeight) &&
          wallHeight > 15 &&
          shoulderStandsTaller
        ) {
          // Measure solid width to the left to prevent adjacent trench self-intersection
          let solidLeftCols = 0;
          for (let k = colTop; k >= 0; k--) {
            if (etchedDelta[k] > 5 || columns[k].segments.length === 0) break;
            solidLeftCols++;
          }
          const solidLeftWidth = solidLeftCols * dx;
          const safeDepth = shouldEmitScallops
            ? Math.min(rawScallopDepth, solidLeftWidth * 0.35)
            : 0;

          const baseMaskEdgeX = (colTop + 1) * dx;
          const undercutShift = isReentrant
            ? Math.min(
                solidLeftWidth * 0.3,
                wallHeight * Math.max(0, isotropy)
              )
            : 0;
          const xTop = baseMaskEdgeX - undercutShift;

          let xBot: number;
          if (isReentrant) {
            const maxAvailLeft = Math.max(
              0,
              solidLeftWidth - undercutShift - safeDepth - dx * 0.25
            );
            const reentrantRun = Math.min(
              maxAvailLeft,
              wallHeight * tanReentrantOverhang
            );
            xBot = xTop - reentrantRun;
          } else if (sidewallAngle >= 89.5) {
            xBot = colBot === runStart ? xTop : colBot * dx;
          } else {
            xBot = Math.min((colBot + 1) * dx, xTop + wallHeight / tanPosAngle);
          }

          if (safeDepth > 1 || (isReentrant && xTop - xBot > 1)) {
            scallopWalls.push({
              stepId: step.id,
              targetSide,
              wallSide: 'left',
              colTop,
              colBot,
              xTop,
              xBot,
              yTop: yTopEntry,
              yBot: yBotFloor,
              scallopDepth: safeDepth,
              scallopPitch: rawScallopPitch,
              isReentrant,
            });
          }
        }
      }

      // Right trench wall
      if (runEnd < columns.length - 1 && columns[runEnd + 1].segments.length > 0) {
        const colTop = runEnd + 1;
        const yTopEntry = etchedTopY[runEnd];

        let bestFloor = etchedFloorY[runEnd];
        for (let c = runEnd; c >= mid; c--) {
          if (Number.isNaN(etchedFloorY[c])) continue;
          if (
            targetSide === 'front'
              ? etchedFloorY[c] < bestFloor
              : etchedFloorY[c] > bestFloor
          ) {
            bestFloor = etchedFloorY[c];
          }
        }

        let colBot = runEnd;
        for (let c = runEnd; c >= mid; c--) {
          if (
            !Number.isNaN(etchedFloorY[c]) &&
            Math.abs(etchedFloorY[c] - bestFloor) <= 1.5
          ) {
            colBot = c;
            break;
          }
        }
        const yBotFloor = etchedFloorY[colBot];
        const wallHeight =
          targetSide === 'front' ? yTopEntry - yBotFloor : yBotFloor - yTopEntry;
        const shoulderStandsTaller =
          targetSide === 'front'
            ? getTopY(columns[colTop]) > yBotFloor + 10
            : getBottomY(columns[colTop]) < yBotFloor - 10;

        if (
          Number.isFinite(wallHeight) &&
          wallHeight > 15 &&
          shoulderStandsTaller
        ) {
          let solidRightCols = 0;
          for (let k = colTop; k < columns.length; k++) {
            if (etchedDelta[k] > 5 || columns[k].segments.length === 0) break;
            solidRightCols++;
          }
          const solidRightWidth = solidRightCols * dx;
          const safeDepth = shouldEmitScallops
            ? Math.min(rawScallopDepth, solidRightWidth * 0.35)
            : 0;

          const baseMaskEdgeX = colTop * dx;
          const undercutShift = isReentrant
            ? Math.min(
                solidRightWidth * 0.3,
                wallHeight * Math.max(0, isotropy)
              )
            : 0;
          const xTop = baseMaskEdgeX + undercutShift;

          let xBot: number;
          if (isReentrant) {
            const maxAvailRight = Math.max(
              0,
              solidRightWidth - undercutShift - safeDepth - dx * 0.25
            );
            const reentrantRun = Math.min(
              maxAvailRight,
              wallHeight * tanReentrantOverhang
            );
            xBot = xTop + reentrantRun;
          } else if (sidewallAngle >= 89.5) {
            xBot = colBot === runEnd ? xTop : (colBot + 1) * dx;
          } else {
            xBot = Math.max(colBot * dx, xTop - wallHeight / tanPosAngle);
          }

          if (safeDepth > 1 || (isReentrant && xBot - xTop > 1)) {
            scallopWalls.push({
              stepId: step.id,
              targetSide,
              wallSide: 'right',
              colTop,
              colBot,
              xTop,
              xBot,
              yTop: yTopEntry,
              yBot: yBotFloor,
              scallopDepth: safeDepth,
              scallopPitch: rawScallopPitch,
              isReentrant,
            });
          }
        }
      }
    }
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

    const mirrorHoriz = Boolean(cfg.mirrorHorizontal);

    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const rawIdxB = Math.min(
        colsB.length - 1,
        Math.floor((i / columns.length) * colsB.length)
      );
      const idxB = mirrorHoriz ? colsB.length - 1 - rawIdxB : rawIdxB;
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
 * Evaluates straight or scalloped wall position at a given Y elevation along [wall.yTop -> wall.yBot].
 */
function evalWallXAtY(wall: ScallopWall, y: number): number {
  const dyWall = wall.yBot - wall.yTop;
  if (Math.abs(dyWall) < 1e-5) return wall.xTop;
  const tc = Math.max(0, Math.min(1, (y - wall.yTop) / dyWall));
  return wall.xTop + tc * (wall.xBot - wall.xTop);
}

/**
 * Samples semicircular Bosch DRIE sidewall scallops (or straight tapered/re-entrant segments when scallopDepth == 0)
 * between yStart and yEnd anchored in phase to [wall.yTop -> wall.yBot].
 */
function sampleScallopWallPoints(
  wall: ScallopWall,
  yStart: number,
  yEnd: number,
  includeStart: boolean = false
): { x: number; y: number }[] {
  const dyWall = wall.yBot - wall.yTop;
  const wallHeight = Math.abs(dyWall);
  if (wallHeight <= 1) {
    return [];
  }

  const tStart = Math.max(0, Math.min(1, (yStart - wall.yTop) / dyWall));
  const tEnd = Math.max(0, Math.min(1, (yEnd - wall.yTop) / dyWall));
  if (Math.abs(tEnd - tStart) < 1e-5) return [];

  if (wall.scallopDepth <= 0.5) {
    const evalStraight = (t: number) => ({
      x: wall.xTop + t * (wall.xBot - wall.xTop),
      y: wall.yTop + t * dyWall,
    });
    const pts: { x: number; y: number }[] = [];
    if (includeStart) pts.push(evalStraight(tStart));
    pts.push(evalStraight(tEnd));
    return pts;
  }

  const rawCycles = Math.max(1, Math.round(wallHeight / Math.max(20, wall.scallopPitch)));
  const numCycles = Math.min(80, rawCycles);
  const ptsPerCycle = numCycles > 35 ? 6 : 10;
  const totalSteps = numCycles * ptsPerCycle;
  const dir = wall.wallSide === 'left' ? -1 : 1;

  const evalPointAtT = (t: number) => {
    const tc = Math.max(0, Math.min(1, t));
    const y = wall.yTop + tc * dyWall;
    const xBase = wall.xTop + tc * (wall.xBot - wall.xTop);
    const cyclePos = tc * numCycles;
    const u = cyclePos - Math.floor(cyclePos);
    const indent = wall.scallopDepth * 2 * Math.sqrt(Math.max(0, u * (1 - u)));
    return { x: xBase + dir * indent, y };
  };

  const result: { x: number; y: number }[] = [];
  if (includeStart) {
    result.push(evalPointAtT(tStart));
  }

  if (tEnd > tStart) {
    for (let k = 1; k < totalSteps; k++) {
      const t = k / totalSteps;
      if (t > tStart + 1e-5 && t < tEnd - 1e-5) {
        result.push(evalPointAtT(t));
      }
    }
  } else {
    for (let k = totalSteps - 1; k >= 1; k--) {
      const t = k / totalSteps;
      if (t < tStart - 1e-5 && t > tEnd + 1e-5) {
        result.push(evalPointAtT(t));
      }
    }
  }

  result.push(evalPointAtT(tEnd));
  return result;
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
  const scallopWalls = mesh.scallopWalls || [];

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
    const lastIdx = reg.bottomYs.length - 1;

    // Left boundary edge (x = reg.startCol * dx): goes bottom -> top
    const xStart = reg.startCol * dx;
    const leftEdgeWall = scallopWalls.find(
      (w) =>
        w.wallSide === 'right' &&
        (w.colTop === reg.startCol || Math.abs(w.xTop - xStart) < dx * 0.6) &&
        (w.isReentrant || Math.abs(w.xBot - xStart) < dx * 0.6) &&
        Math.min(reg.topYs[0], Math.max(w.yTop, w.yBot)) -
          Math.max(reg.bottomYs[0], Math.min(w.yTop, w.yBot)) >
          5
    );

    let leftTopTrimX = -Infinity;
    let leftBottomTrimX = -Infinity;
    if (leftEdgeWall) {
      const yMinWall = Math.min(leftEdgeWall.yTop, leftEdgeWall.yBot);
      const yMaxWall = Math.max(leftEdgeWall.yTop, leftEdgeWall.yBot);
      const yA = Math.max(reg.bottomYs[0], yMinWall);
      const yB = Math.min(reg.topYs[0], yMaxWall);
      if (yA > reg.bottomYs[0] + 0.5) {
        pts.push({ x: xStart, y: reg.bottomYs[0] });
      }
      pts.push(...sampleScallopWallPoints(leftEdgeWall, yA, yB, true));
      leftBottomTrimX = evalWallXAtY(leftEdgeWall, yA);
      leftTopTrimX = evalWallXAtY(leftEdgeWall, yB);
      if (yB < reg.topYs[0] - 0.5) {
        pts.push({ x: xStart, y: reg.topYs[0] });
        leftTopTrimX = -Infinity;
      }
    } else {
      pts.push({ x: xStart, y: reg.bottomYs[0] });
      pts.push({ x: xStart, y: reg.topYs[0] });
    }

    // Check right boundary edge early so top surface can be trimmed cleanly if re-entrant at top
    const xEnd = (reg.endCol + 1) * dx;
    const rightEdgeWall = scallopWalls.find(
      (w) =>
        w.wallSide === 'left' &&
        (w.colTop === reg.endCol || Math.abs(w.xTop - xEnd) < dx * 0.6) &&
        (w.isReentrant || Math.abs(w.xBot - xEnd) < dx * 0.6) &&
        Math.min(reg.topYs[lastIdx], Math.max(w.yTop, w.yBot)) -
          Math.max(reg.bottomYs[lastIdx], Math.min(w.yTop, w.yBot)) >
          5
    );

    // Top surface left to right
    let minTopXAllowed = leftTopTrimX;
    for (let i = 0; i < reg.topYs.length; i++) {
      const colIdx = reg.startCol + i;

      // Check for frontside left trench wall starting at colTop
      const frontLeftWall = scallopWalls.find(
        (w) =>
          w.targetSide === 'front' &&
          w.wallSide === 'left' &&
          w.colTop === colIdx &&
          reg.endCol >= w.colBot &&
          reg.topYs[i] > w.yBot + 5 &&
          reg.bottomYs[i] < w.yTop - 5
      );
      if (frontLeftWall) {
        const yStart = Math.min(frontLeftWall.yTop, reg.topYs[i]);
        const botLocalIdx = frontLeftWall.colBot - reg.startCol;
        const yEnd = Math.max(frontLeftWall.yBot, reg.topYs[botLocalIdx]);
        if (yStart - yEnd > 5) {
          const xWallStart = evalWallXAtY(frontLeftWall, yStart);
          while (
            pts.length > 2 &&
            pts[pts.length - 1].x >= xWallStart - 0.1 &&
            Math.abs(pts[pts.length - 1].y - yStart) < 5
          ) {
            pts.pop();
          }
          const wallPts = sampleScallopWallPoints(frontLeftWall, yStart, yEnd, true);
          if (wallPts.length > 0) {
            pts.push(...wallPts);
            minTopXAllowed = -Infinity;
            i = Math.max(i, botLocalIdx - 1);
            continue;
          }
        }
      }

      // Check for frontside right trench wall starting at colBot
      const frontRightWall = scallopWalls.find(
        (w) =>
          w.targetSide === 'front' &&
          w.wallSide === 'right' &&
          w.colBot === colIdx &&
          reg.endCol >= w.colTop &&
          reg.topYs[w.colTop - reg.startCol] > w.yBot + 5 &&
          reg.bottomYs[w.colTop - reg.startCol] < w.yTop - 5
      );
      if (frontRightWall) {
        const topLocalIdx = frontRightWall.colTop - reg.startCol;
        const yStart = Math.max(frontRightWall.yBot, reg.topYs[i]);
        const yEnd = Math.min(frontRightWall.yTop, reg.topYs[topLocalIdx]);
        if (yEnd - yStart > 5) {
          const wallPts = sampleScallopWallPoints(frontRightWall, yStart, yEnd, true);
          if (wallPts.length > 0) {
            pts.push(...wallPts);
            minTopXAllowed = evalWallXAtY(frontRightWall, yEnd);
            i = Math.max(i, topLocalIdx - 1);
            continue;
          }
        }
      }

      const x = colIdx * dx + dx;
      if (x <= minTopXAllowed + 0.1) continue;
      minTopXAllowed = -Infinity;
      pts.push({ x, y: reg.topYs[i] });
    }

    // Right boundary edge (x = (reg.endCol + 1) * dx): goes top -> bottom
    let rightBottomTrimX = Infinity;
    if (rightEdgeWall) {
      const yMinWall = Math.min(rightEdgeWall.yTop, rightEdgeWall.yBot);
      const yMaxWall = Math.max(rightEdgeWall.yTop, rightEdgeWall.yBot);
      const yA = Math.min(reg.topYs[lastIdx], yMaxWall);
      const yB = Math.max(reg.bottomYs[lastIdx], yMinWall);
      const xEdgeTop = evalWallXAtY(rightEdgeWall, yA);
      while (
        pts.length > 2 &&
        pts[pts.length - 1].x >= xEdgeTop - 0.1 &&
        Math.abs(pts[pts.length - 1].y - yA) < 5
      ) {
        pts.pop();
      }
      if (yA < reg.topYs[lastIdx] - 0.5) {
        pts.push({ x: xEnd, y: reg.topYs[lastIdx] });
      }
      pts.push(...sampleScallopWallPoints(rightEdgeWall, yA, yB, true));
      rightBottomTrimX = evalWallXAtY(rightEdgeWall, yB);
      if (yB > reg.bottomYs[lastIdx] + 0.5) {
        pts.push({ x: xEnd, y: reg.bottomYs[lastIdx] });
        rightBottomTrimX = Infinity;
      }
    } else {
      pts.push({ x: xEnd, y: reg.bottomYs[lastIdx] });
    }

    // Bottom surface right to left
    let maxBotXAllowed = rightBottomTrimX;
    for (let i = lastIdx; i >= 0; i--) {
      const colIdx = reg.startCol + i;

      // Backside right trench wall (iterating right-to-left: meets colTop first, goes up to colBot)
      const backRightWall = scallopWalls.find(
        (w) =>
          w.targetSide === 'back' &&
          w.wallSide === 'right' &&
          w.colTop === colIdx &&
          reg.startCol <= w.colBot &&
          reg.bottomYs[w.colBot - reg.startCol] > w.yTop + 5
      );
      if (backRightWall) {
        const botLocalIdx = backRightWall.colBot - reg.startCol;
        const yStart = Math.max(backRightWall.yTop, reg.bottomYs[i]);
        const yEnd = Math.min(backRightWall.yBot, reg.bottomYs[botLocalIdx]);
        if (yEnd - yStart > 5) {
          const xWallStart = evalWallXAtY(backRightWall, yStart);
          while (
            pts.length > 2 &&
            pts[pts.length - 1].x <= xWallStart + 0.1 &&
            Math.abs(pts[pts.length - 1].y - yStart) < 5
          ) {
            pts.pop();
          }
          const wallPts = sampleScallopWallPoints(backRightWall, yStart, yEnd, true);
          if (wallPts.length > 0) {
            pts.push(...wallPts);
            maxBotXAllowed = Infinity;
            i = Math.min(i, botLocalIdx + 1);
            continue;
          }
        }
      }

      // Backside left trench wall (iterating right-to-left: meets colBot first, goes down to colTop)
      const backLeftWall = scallopWalls.find(
        (w) =>
          w.targetSide === 'back' &&
          w.wallSide === 'left' &&
          w.colBot === colIdx &&
          reg.startCol <= w.colTop &&
          reg.bottomYs[i] > w.yTop + 5
      );
      if (backLeftWall) {
        const topLocalIdx = backLeftWall.colTop - reg.startCol;
        const yStart = Math.min(backLeftWall.yBot, reg.bottomYs[i]);
        const yEnd = Math.max(backLeftWall.yTop, reg.bottomYs[topLocalIdx]);
        if (yStart - yEnd > 5) {
          const wallPts = sampleScallopWallPoints(backLeftWall, yStart, yEnd, true);
          if (wallPts.length > 0) {
            pts.push(...wallPts);
            maxBotXAllowed = evalWallXAtY(backLeftWall, yEnd);
            i = Math.min(i, topLocalIdx + 1);
            continue;
          }
        }
      }

      const x = colIdx * dx;
      if (x >= maxBotXAllowed - 0.1) continue;
      if (leftBottomTrimX > -Infinity && x <= leftBottomTrimX + 0.1) continue;
      maxBotXAllowed = Infinity;
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

/**
 * Computes normalized surface convexity [0..1.25] at each column for convex corner acceleration.
 * Returns positive values strictly at outer/convex corners protruding into the ambient/etchant.
 */
function computeConvexCornerFactors(
  columns: ColumnProfile[],
  totalWidth: number,
  targetSide: 'front' | 'back',
  processScale: number
): Float64Array {
  const n = columns.length;
  const factors = new Float64Array(n);
  if (n < 3 || processScale <= 0) return factors;

  const dx = totalWidth / n;
  const heights = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (columns[i].segments.length === 0) continue;
    heights[i] =
      targetSide === 'front' ? getTopY(columns[i]) : -getBottomY(columns[i]);
  }

  const radiusNm = Math.max(
    dx * 3,
    Math.min(totalWidth * 0.12, Math.max(processScale * 1.1, dx * 4))
  );
  const kernelCols = Math.max(2, Math.round(radiusNm / dx));

  for (let i = 0; i < n; i++) {
    if (columns[i].segments.length === 0) continue;

    let weightedSum = 0;
    let weightTotal = 0;
    let minH = heights[i];
    let maxH = heights[i];

    for (let offset = -kernelCols; offset <= kernelCols; offset++) {
      const j = Math.max(0, Math.min(n - 1, i + offset));
      if (columns[j].segments.length === 0) continue;
      const h = heights[j];
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;

      const distRatio = Math.abs(offset) / (kernelCols + 1);
      const w = 1 - distRatio;
      weightedSum += h * w;
      weightTotal += w;
    }

    if (weightTotal <= 0) continue;
    const avgH = weightedSum / weightTotal;
    const delta = heights[i] - avgH;
    if (delta <= 1) continue;

    const localRelief = maxH - minH;
    const denom = Math.max(processScale * 0.5, localRelief * 0.5, 1);
    factors[i] = Math.max(0, Math.min(1.25, delta / denom));
  }

  return factors;
}
