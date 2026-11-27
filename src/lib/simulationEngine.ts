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
  MountedTapeFrame,
  EtchRecipe,
} from '../types/microfab';
import {
  getMaterialById,
  resolveResistMaterialId,
  CARRIER_TAPE_IDS,
  isCrystallineKohMaterial,
} from './materials';
import { getEtchRecipeById, getEtchRateNmMin } from './etchRates';
import { resolveFlowParameters } from './variableUtils';

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

function initSubstrateColumns(
  flow: ProcessFlow
): { width: number; currentY: number; columns: ColumnProfile[] } {
  const width = flow.substrateWidth || 10000; // default 10 µm
  const numCols = DEFAULT_SAMPLE_COLUMNS;
  const dx = width / numCols;

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

  let coreLayerIdx = -1;
  if (subLayers.length > 1) {
    let bestCoreScore = -1;
    for (let i = 0; i < subLayers.length; i++) {
      const mat = getMaterialById(flow.materials, subLayers[i].materialId);
      const isBulkCat = mat.category === 'substrate' || mat.category === 'semiconductor';
      const thick = Math.max(1, subLayers[i].thickness);
      const score = (isBulkCat ? 1e9 : 0) + thick;
      if (score > bestCoreScore) {
        bestCoreScore = score;
        coreLayerIdx = i;
      }
    }
  }

  const initialSegments: MaterialSegment[] = [];
  let currentY = 0;
  for (let i = 0; i < subLayers.length; i++) {
    const layer = subLayers[i];
    const layerThick = Math.max(1, layer.thickness);
    const inferredSide: 'front' | 'back' | undefined =
      coreLayerIdx >= 0
        ? i < coreLayerIdx
          ? 'back'
          : i > coreLayerIdx
          ? 'front'
          : undefined
        : undefined;
    initialSegments.push({
      yBottom: currentY,
      yTop: currentY + layerThick,
      materialId: layer.materialId,
      stepId: `substrate_${layer.id}`,
      ...(inferredSide ? { side: inferredSide } : {}),
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

  return { width, currentY, columns };
}

interface SimCheckpointState {
  width: number;
  currentY: number;
  columns: ColumnProfile[];
  stepSummaries: { stepId: string; stepIndex: number; title: string }[];
  scallopWalls: ScallopWall[];
  activeFrames: { stepId: string; side: 'front' | 'back'; materialId: string }[];
}

interface CachedPrefixStep {
  stepRef: ProcessStep;
  stepSig: string;
  state: SimCheckpointState;
  rawMinY: number;
  rawMaxY: number;
}

interface PrefixSimCache {
  substrateSig: string;
  materialsRef: Material[];
  materialsSig: string;
  etchLibraryRef: EtchRecipe[] | undefined;
  etchLibrarySig: string;
  initState: SimCheckpointState;
  initRawMinY: number;
  initRawMaxY: number;
  steps: CachedPrefixStep[];
}

const MAX_PREFIX_CACHES = 4;
const prefixSimCaches: PrefixSimCache[] = [];
const stepSimSigCache = new WeakMap<ProcessStep, string>();
const materialsSimSigCache = new WeakMap<Material[], string>();
const etchLibSimSigCache = new WeakMap<EtchRecipe[], string>();

function cloneSimCheckpointState(state: SimCheckpointState): SimCheckpointState {
  const srcCols = state.columns;
  const colsLen = srcCols.length;
  const columns: ColumnProfile[] = new Array(colsLen);
  for (let i = 0; i < colsLen; i++) {
    const col = srcCols[i];
    const srcSegs = col.segments;
    const segsLen = srcSegs.length;
    const segments: MaterialSegment[] = new Array(segsLen);
    for (let j = 0; j < segsLen; j++) {
      segments[j] = { ...srcSegs[j] };
    }
    columns[i] = { x: col.x, segments };
  }
  return {
    width: state.width,
    currentY: state.currentY,
    columns,
    stepSummaries: state.stepSummaries.map((s) => ({ ...s })),
    scallopWalls: state.scallopWalls.map((w) => ({ ...w })),
    activeFrames: state.activeFrames.map((f) => ({ ...f })),
  };
}

function computeColumnBounds(columns: ColumnProfile[]): { rawMinY: number; rawMaxY: number } {
  let rawMinY = Infinity;
  let rawMaxY = -Infinity;
  for (let i = 0; i < columns.length; i++) {
    const segs = columns[i].segments;
    for (let j = 0; j < segs.length; j++) {
      const seg = segs[j];
      if (seg.yBottom < rawMinY) rawMinY = seg.yBottom;
      if (seg.yTop > rawMaxY) rawMaxY = seg.yTop;
    }
  }
  return { rawMinY, rawMaxY };
}

function getSubstrateSig(flow: ProcessFlow): string {
  const layers = flow.substrateLayers;
  if (layers && layers.length > 0) {
    let s = `${flow.substrateWidth || 10000}|`;
    for (let i = 0; i < layers.length; i++) {
      const l = layers[i];
      s += `${l.id}:${l.materialId}:${l.thickness};`;
    }
    return s;
  }
  return `${flow.substrateWidth || 10000}|sub:${flow.substrateMaterialId || 'mat_si_sub'}:${flow.substrateThickness || 3000}`;
}

function getMaterialsSimSig(materials: Material[]): string {
  let sig = materialsSimSigCache.get(materials);
  if (sig === undefined) {
    sig = JSON.stringify(materials);
    materialsSimSigCache.set(materials, sig);
  }
  return sig;
}

function getEtchLibSimSig(etchLibrary: EtchRecipe[] | undefined): string {
  if (!etchLibrary || etchLibrary.length === 0) return '';
  let sig = etchLibSimSigCache.get(etchLibrary);
  if (sig === undefined) {
    sig = JSON.stringify(etchLibrary);
    etchLibSimSigCache.set(etchLibrary, sig);
  }
  return sig;
}

function getStepSimSig(step: ProcessStep): string {
  let sig = stepSimSigCache.get(step);
  if (sig === undefined) {
    sig = JSON.stringify({
      id: step.id,
      type: step.type,
      enabled: step.enabled,
      side: step.side,
      title: step.title,
      thickness: step.thickness,
      materialId: step.materialId,
      deposition: step.deposition,
      lithography: step.lithography,
      etch: step.etch,
      strip: step.strip,
      cmp: step.cmp,
      bonding: step.bonding,
      dicing: step.dicing,
      tapeFrame: step.tapeFrame,
    });
    stepSimSigCache.set(step, sig);
  }
  return sig;
}

function getOrCreatePrefixCache(flow: ProcessFlow): PrefixSimCache {
  const substrateSig = getSubstrateSig(flow);
  const materials = flow.materials;
  const etchLibrary = flow.etchLibrary;

  let hitIndex = prefixSimCaches.findIndex(
    (c) =>
      c.substrateSig === substrateSig &&
      c.materialsRef === materials &&
      c.etchLibraryRef === etchLibrary
  );

  if (hitIndex < 0) {
    const materialsSig = getMaterialsSimSig(materials);
    const etchLibrarySig = getEtchLibSimSig(etchLibrary);
    hitIndex = prefixSimCaches.findIndex(
      (c) =>
        c.substrateSig === substrateSig &&
        c.materialsSig === materialsSig &&
        c.etchLibrarySig === etchLibrarySig
    );
    if (hitIndex >= 0) {
      prefixSimCaches[hitIndex].materialsRef = materials;
      prefixSimCaches[hitIndex].etchLibraryRef = etchLibrary;
    }
  }

  if (hitIndex >= 0) {
    const hit = prefixSimCaches[hitIndex];
    if (hitIndex !== 0) {
      prefixSimCaches.splice(hitIndex, 1);
      prefixSimCaches.unshift(hit);
    }
    return hit;
  }

  const { width, currentY, columns } = initSubstrateColumns(flow);
  const { rawMinY, rawMaxY } = computeColumnBounds(columns);
  const entry: PrefixSimCache = {
    substrateSig,
    materialsRef: materials,
    materialsSig: getMaterialsSimSig(materials),
    etchLibraryRef: etchLibrary,
    etchLibrarySig: getEtchLibSimSig(etchLibrary),
    initState: {
      width,
      currentY,
      columns,
      stepSummaries: [],
      scallopWalls: [],
      activeFrames: [],
    },
    initRawMinY: rawMinY,
    initRawMaxY: rawMaxY,
    steps: [],
  };

  prefixSimCaches.unshift(entry);
  if (prefixSimCaches.length > MAX_PREFIX_CACHES) {
    prefixSimCaches.length = MAX_PREFIX_CACHES;
  }
  return entry;
}

function runCachedPrefixSteps(
  flow: ProcessFlow,
  enabledSteps: ProcessStep[],
  maxIdx: number
): { cache: PrefixSimCache; workingState: SimCheckpointState; rawMinY: number; rawMaxY: number } {
  const cache = getOrCreatePrefixCache(flow);

  let matchedCount = 0;
  const checkLimit = Math.min(Math.max(0, maxIdx + 1), cache.steps.length);
  while (matchedCount < checkLimit) {
    const step = enabledSteps[matchedCount];
    const cached = cache.steps[matchedCount];
    if (step === cached.stepRef) {
      matchedCount++;
    } else {
      const sig = getStepSimSig(step);
      if (sig === cached.stepSig) {
        cached.stepRef = step;
        matchedCount++;
      } else {
        break;
      }
    }
  }

  if (maxIdx < 0) {
    return {
      cache,
      workingState: cloneSimCheckpointState(cache.initState),
      rawMinY: cache.initRawMinY,
      rawMaxY: cache.initRawMaxY,
    };
  }

  const baseSnapshot =
    matchedCount > 0 ? cache.steps[matchedCount - 1].state : cache.initState;
  const workingState = cloneSimCheckpointState(baseSnapshot);
  let lastRawMinY =
    matchedCount > 0 ? cache.steps[matchedCount - 1].rawMinY : cache.initRawMinY;
  let lastRawMaxY =
    matchedCount > 0 ? cache.steps[matchedCount - 1].rawMaxY : cache.initRawMaxY;

  if (matchedCount <= maxIdx) {
    cache.steps.length = matchedCount;
    for (let idx = matchedCount; idx <= maxIdx; idx++) {
      const step = enabledSteps[idx];
      workingState.stepSummaries.push({
        stepId: step.id,
        stepIndex: idx,
        title: step.title,
      });
      applyStep(
        workingState.columns,
        step,
        flow.materials,
        workingState.width,
        0,
        workingState.scallopWalls,
        workingState.activeFrames,
        flow.etchLibrary
      );
      const bounds = computeColumnBounds(workingState.columns);
      lastRawMinY = bounds.rawMinY;
      lastRawMaxY = bounds.rawMaxY;
      cache.steps.push({
        stepRef: step,
        stepSig: getStepSimSig(step),
        state: cloneSimCheckpointState(workingState),
        rawMinY: lastRawMinY,
        rawMaxY: lastRawMaxY,
      });
    }
  }

  return {
    cache,
    workingState,
    rawMinY: lastRawMinY,
    rawMaxY: lastRawMaxY,
  };
}

/**
 * Computes the global vertical bounds (minY, maxY in nm) across the starting substrate
 * and every enabled step, reusing cached pre-step simulation checkpoints when possible.
 */
export function computeFlowSharedYBounds(
  rawFlow: ProcessFlow
): { minY: number; maxY: number } {
  const flow = resolveFlowParameters(rawFlow);
  const enabledSteps = flow.steps.filter((s) => s.enabled);
  const maxIdx = enabledSteps.length - 1;
  const { cache } = runCachedPrefixSteps(flow, enabledSteps, maxIdx);

  let minY = cache.initRawMinY;
  let maxY = cache.initRawMaxY;

  for (let idx = 0; idx <= maxIdx; idx++) {
    const cached = cache.steps[idx];
    if (cached.rawMinY < minY) minY = cached.rawMinY;
    if (cached.rawMaxY > maxY) maxY = cached.rawMaxY;
  }

  if (minY === Infinity) minY = 0;
  if (maxY === -Infinity) maxY = cache.initState.currentY;

  return { minY, maxY };
}

function simulateCrossSectionInternal(
  flow: ProcessFlow,
  upToStepIndex?: number,
  recursionDepth: number = 0
): CrossSectionMesh {
  const enabledSteps = flow.steps.filter((s) => s.enabled);
  const maxIdx =
    upToStepIndex !== undefined
      ? Math.min(upToStepIndex, enabledSteps.length - 1)
      : enabledSteps.length - 1;

  let width: number;
  let currentY: number;
  let columns: ColumnProfile[];
  let stepSummaries: { stepId: string; stepIndex: number; title: string }[];
  let scallopWalls: ScallopWall[];
  let activeFrames: { stepId: string; side: 'front' | 'back'; materialId: string }[];
  let minY: number;
  let maxY: number;

  if (recursionDepth === 0) {
    const res = runCachedPrefixSteps(flow, enabledSteps, maxIdx);
    width = res.workingState.width;
    currentY = res.workingState.currentY;
    columns = res.workingState.columns;
    stepSummaries = res.workingState.stepSummaries;
    scallopWalls = res.workingState.scallopWalls;
    activeFrames = res.workingState.activeFrames;
    minY = res.rawMinY;
    maxY = res.rawMaxY;
  } else {
    const init = initSubstrateColumns(flow);
    width = init.width;
    currentY = init.currentY;
    columns = init.columns;
    stepSummaries = [];
    scallopWalls = [];
    activeFrames = [];

    for (let idx = 0; idx <= maxIdx; idx++) {
      const step = enabledSteps[idx];
      stepSummaries.push({
        stepId: step.id,
        stepIndex: idx,
        title: step.title,
      });
      applyStep(
        columns,
        step,
        flow.materials,
        width,
        recursionDepth,
        scallopWalls,
        activeFrames,
        flow.etchLibrary
      );
    }

    const bounds = computeColumnBounds(columns);
    minY = bounds.rawMinY;
    maxY = bounds.rawMaxY;
  }

  // Resolve surviving mounted tape frame edge geometry for canvas bracket rendering
  const mountedFrames: MountedTapeFrame[] = [];
  if (columns.length > 0 && activeFrames.length > 0) {
    const leftSegs = columns[0].segments;
    const rightSegs = columns[columns.length - 1].segments;
    for (const frame of activeFrames) {
      const matchLeft =
        frame.side === 'back'
          ? leftSegs.find((s) => s.materialId === frame.materialId)
          : [...leftSegs].reverse().find((s) => s.materialId === frame.materialId);
      const matchRight =
        frame.side === 'back'
          ? rightSegs.find((s) => s.materialId === frame.materialId)
          : [...rightSegs].reverse().find((s) => s.materialId === frame.materialId);
      const refSeg = matchLeft || matchRight;
      if (refSeg) {
        mountedFrames.push({
          side: frame.side,
          yBottom: refSeg.yBottom,
          yTop: refSeg.yTop,
          materialId: frame.materialId,
        });
      }
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
    mountedFrames: mountedFrames.length > 0 ? mountedFrames : undefined,
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
  scallopWalls: ScallopWall[] = [],
  activeFrames: { stepId: string; side: 'front' | 'back'; materialId: string }[] = [],
  etchLibrary?: EtchRecipe[]
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
        applyDepositionSide(columns, step, materials, totalWidth, 'front', scallopWalls);
      }
      if (side === 'back' || side === 'both') {
        applyDepositionSide(columns, step, materials, totalWidth, 'back', scallopWalls);
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
        applyEtchSide(columns, step, materials, totalWidth, 'front', scallopWalls, etchLibrary);
      }
      if (side === 'back' || side === 'both') {
        applyEtchSide(columns, step, materials, totalWidth, 'back', scallopWalls, etchLibrary);
      }
      break;
    }

    case 'strip':
    case 'liftoff': {
      applyStripOrLiftoff(columns, step, materials, side, scallopWalls);
      break;
    }

    case 'cmp': {
      if (side === 'front' || side === 'both') {
        applyCmpSide(columns, step, materials, totalWidth, 'front', scallopWalls);
      }
      if (side === 'back' || side === 'both') {
        applyCmpSide(columns, step, materials, totalWidth, 'back', scallopWalls);
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

    case 'dicing': {
      if (side === 'front' || side === 'both') {
        applyDicingSide(columns, step, totalWidth, 'front');
      }
      if (side === 'back' || side === 'both') {
        applyDicingSide(columns, step, totalWidth, 'back');
      }
      break;
    }

    case 'tape-frame': {
      applyTapeFrame(columns, step, totalWidth, activeFrames);
      break;
    }
  }
}

/**
 * Handles layer deposition on either the frontside (top) or backside (bottom):
 * Conformal, Directional, Semi-conformal, Spin-coat, and Bottom-up / Selective Plating
 */
function applyDepositionSide(
  columns: ColumnProfile[],
  step: ProcessStep,
  materials: Material[],
  totalWidth: number,
  targetSide: 'front' | 'back',
  scallopWalls: ScallopWall[] = []
): void {
  const cfg = step.deposition;
  const thickness = cfg?.thickness ?? step.thickness ?? 200;
  const matId = step.materialId ?? 'mat_sio2_thermal';
  const depType = cfg?.depositionType ?? 'conformal';

  if (thickness <= 0) return;

  const isPlatingMethod =
    cfg?.method === 'Electroplating' || cfg?.method === 'Electroless Plating';
  const selectivePlating = Boolean(cfg?.platingSelective) && isPlatingMethod;
  const seedScope = cfg?.platingSeedScope ?? 'conductive';
  const matCategoryById = new Map(materials.map((m) => [m.id, m.category]));

  const isSeedMaterialId = (materialId: string): boolean => {
    if (!selectivePlating) return true;
    const cat = matCategoryById.get(materialId);
    if (!cat) return false;
    if (seedScope === 'metal-only') {
      return cat === 'metal';
    }
    return cat === 'metal' || cat === 'semiconductor' || cat === 'substrate';
  };

  const isSeedColumn = (col: ColumnProfile): boolean => {
    if (col.segments.length === 0) return false;
    if (!selectivePlating) return true;
    const exposedSeg =
      targetSide === 'front' ? col.segments[col.segments.length - 1] : col.segments[0];
    return isSeedMaterialId(exposedSeg.materialId);
  };

  if (targetSide === 'front') {
    if (depType === 'bottom-up') {
      for (const col of columns) {
        if (!isSeedColumn(col)) continue;
        const currentTop = getTopY(col);
        col.segments.push({
          yBottom: currentTop,
          yTop: currentTop + thickness,
          materialId: matId,
          stepId: step.id,
          side: 'front',
        });
      }
      return;
    }

    if (depType === 'dry-film') {
      const sag = cfg?.laminationSag ?? 0;
      const { yBottom, yTop } = computeDryFilmProfile(
        columns,
        totalWidth,
        'front',
        thickness,
        sag
      );
      for (let i = 0; i < columns.length; i++) {
        const col = columns[i];
        if (col.segments.length === 0) continue;
        if (yTop[i] > yBottom[i]) {
          col.segments.push({
            yBottom: yBottom[i],
            yTop: yTop[i],
            materialId: matId,
            stepId: step.id,
            side: 'front',
          });
        }
      }
      return;
    }

    if (depType === 'spin-coat') {
      const planarization = cfg?.planarization ?? 100;
      const targetTops = computeSpinCoatSurface(
        columns,
        totalWidth,
        'front',
        thickness,
        planarization
      );
      for (let i = 0; i < columns.length; i++) {
        const col = columns[i];
        if (!isSeedColumn(col)) continue;
        const currentTop = getTopY(col);
        if (targetTops[i] > currentTop) {
          col.segments.push({
            yBottom: currentTop,
            yTop: targetTops[i],
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
        if (!hasCol[i] || !isSeedColumn(columns[i])) continue;
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

    applyConformalOrSemiConformalDeposition(
      columns,
      step,
      totalWidth,
      'front',
      thickness,
      matId,
      depType,
      isSeedMaterialId,
      scallopWalls
    );
    return;
  }

  // Backside deposition (grows downward from yBottom of lowest segment)
  if (depType === 'bottom-up') {
    for (const col of columns) {
      if (!isSeedColumn(col)) continue;
      const currentBottom = getBottomY(col);
      col.segments.unshift({
        yBottom: currentBottom - thickness,
        yTop: currentBottom,
        materialId: matId,
        stepId: step.id,
        side: 'back',
      });
    }
    return;
  }

  if (depType === 'dry-film') {
    const sag = cfg?.laminationSag ?? 0;
    const { yBottom, yTop } = computeDryFilmProfile(
      columns,
      totalWidth,
      'back',
      thickness,
      sag
    );
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      if (col.segments.length === 0) continue;
      if (yTop[i] > yBottom[i]) {
        col.segments.unshift({
          yBottom: yBottom[i],
          yTop: yTop[i],
          materialId: matId,
          stepId: step.id,
          side: 'back',
        });
      }
    }
    return;
  }

  if (depType === 'spin-coat') {
    const planarization = cfg?.planarization ?? 100;
    const targetBottoms = computeSpinCoatSurface(
      columns,
      totalWidth,
      'back',
      thickness,
      planarization
    );
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      if (!isSeedColumn(col)) continue;
      const currentBottom = getBottomY(col);
      if (targetBottoms[i] < currentBottom) {
        col.segments.unshift({
          yBottom: targetBottoms[i],
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
      if (!hasCol[i] || !isSeedColumn(columns[i])) continue;
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

  applyConformalOrSemiConformalDeposition(
    columns,
    step,
    totalWidth,
    'back',
    thickness,
    matId,
    depType,
    isSeedMaterialId,
    scallopWalls
  );
}

type VoidSpan = [number, number];

function intersectVoidSpans(a: VoidSpan[], b: VoidSpan[]): VoidSpan[] {
  const res: VoidSpan[] = [];
  let ia = 0;
  let ib = 0;
  while (ia < a.length && ib < b.length) {
    const lo = Math.max(a[ia][0], b[ib][0]);
    const hi = Math.min(a[ia][1], b[ib][1]);
    if (hi - lo > 0.25) {
      res.push([lo, hi]);
    }
    if (a[ia][1] < b[ib][1]) {
      ia++;
    } else {
      ib++;
    }
  }
  return res;
}

function mergeVoidSpans(spans: VoidSpan[]): VoidSpan[] {
  if (spans.length === 0) return [];
  const sorted = [...spans].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: VoidSpan[] = [[sorted[0][0], sorted[0][1]]];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    const last = merged[merged.length - 1];
    if (cur[0] <= last[1] + 0.25) {
      if (cur[1] > last[1]) last[1] = cur[1];
    } else {
      merged.push([cur[0], cur[1]]);
    }
  }
  return merged;
}

function clipSpanToIntervals(
  bot: number,
  top: number,
  clipList: VoidSpan[],
  out: VoidSpan[]
): void {
  for (let c = 0; c < clipList.length; c++) {
    const lo = Math.max(bot, clipList[c][0]);
    const hi = Math.min(top, clipList[c][1]);
    if (hi - lo > 0.25) {
      out.push([lo, hi]);
    }
  }
}

function extractOpenVoidsFromSolids(
  solids: VoidSpan[][],
  targetSide: 'front' | 'back',
  globalMinY: number,
  globalMaxY: number
): VoidSpan[][] {
  const n = solids.length;
  const rawVoids: VoidSpan[][] = new Array(n);

  for (let i = 0; i < n; i++) {
    const segs = solids[i];
    const voids: VoidSpan[] = [];
    if (segs.length === 0) {
      if (targetSide === 'front') {
        voids.push([globalMinY, Infinity]);
      } else {
        voids.push([-Infinity, globalMaxY]);
      }
    } else {
      if (targetSide === 'back') {
        voids.push([-Infinity, segs[0][0]]);
      }
      for (let m = 0; m < segs.length - 1; m++) {
        const gapBot = segs[m][1];
        const gapTop = segs[m + 1][0];
        if (gapTop - gapBot > 0.25) {
          voids.push([gapBot, gapTop]);
        }
      }
      if (targetSide === 'front') {
        voids.push([segs[segs.length - 1][1], Infinity]);
      }
    }
    rawVoids[i] = voids;
  }

  const openFlags: Uint8Array[] = rawVoids.map((v) => new Uint8Array(v.length));
  const queueC: number[] = [];
  const queueV: number[] = [];

  for (let i = 0; i < n; i++) {
    const voids = rawVoids[i];
    if (voids.length === 0) continue;
    if (targetSide === 'front') {
      const lastIdx = voids.length - 1;
      if (voids[lastIdx][1] === Infinity) {
        openFlags[i][lastIdx] = 1;
        queueC.push(i);
        queueV.push(lastIdx);
      }
    } else {
      if (voids[0][0] === -Infinity) {
        openFlags[i][0] = 1;
        queueC.push(i);
        queueV.push(0);
      }
    }
  }

  let head = 0;
  while (head < queueC.length) {
    const c = queueC[head];
    const vi = queueV[head];
    head++;
    const [a, b] = rawVoids[c][vi];

    for (const nc of [c - 1, c + 1]) {
      if (nc < 0 || nc >= n) continue;
      const nVoids = rawVoids[nc];
      const nFlags = openFlags[nc];
      for (let nvi = 0; nvi < nVoids.length; nvi++) {
        if (nFlags[nvi]) continue;
        const [na, nb] = nVoids[nvi];
        if (Math.min(b, nb) > Math.max(a, na) + 0.25) {
          nFlags[nvi] = 1;
          queueC.push(nc);
          queueV.push(nvi);
        }
      }
    }
  }

  return rawVoids.map((v, i) => v.filter((_, vi) => openFlags[i][vi] === 1));
}

function voidContainsY(voids: VoidSpan[], y: number, tol: number = 1): boolean {
  for (let i = 0; i < voids.length; i++) {
    if (voids[i][0] <= y + tol && voids[i][1] >= y - tol) {
      return true;
    }
  }
  return false;
}

function findContainingVoid(
  voids: VoidSpan[],
  y: number,
  tol: number = 1
): VoidSpan | null {
  for (let i = 0; i < voids.length; i++) {
    if (voids[i][0] <= y + tol && voids[i][1] >= y - tol) {
      return voids[i];
    }
  }
  return null;
}

/**
 * 2D void-aware progressive Huygens conformal / semi-conformal deposition solver.
 * Handles overhangs, wet/DRIE undercuts, retrograde lift-off profiles,
 * interior ceilings & recessed sidewalls, progressive pinch-off freeze (zero deposition
 * inside sealed cavities once pinched), and Huygens-attenuated scalloped / re-entrant walls.
 */
function applyConformalOrSemiConformalDeposition(
  columns: ColumnProfile[],
  step: ProcessStep,
  totalWidth: number,
  targetSide: 'front' | 'back',
  thickness: number,
  matId: string,
  depType: string,
  isSeedMaterialId: (materialId: string) => boolean,
  scallopWalls: ScallopWall[] = []
): void {
  const n = columns.length;
  if (n === 0 || thickness <= 0) return;

  const cfg = step.deposition;
  const isConformal = depType !== 'semi-conformal';
  const stepCoverage = isConformal
    ? 1.0
    : Math.max(0, Math.min(1, (cfg?.stepCoverage ?? 60) / 100));
  const cornerBoostEnabled = Boolean(cfg?.convexCornerEffect);
  const cornerBoostStrength = Math.max(0.05, cfg?.convexCornerStrength ?? 0.6);
  const cornerFactors = cornerBoostEnabled
    ? computeConvexCornerFactors(columns, totalWidth, targetSide, thickness)
    : null;
  const selectivePlating = Boolean(
    cfg?.platingSelective &&
      (cfg?.method === 'Electroplating' || cfg?.method === 'Electroless Plating')
  );

  // 1. Sort segments per column bottom-to-top and determine substrate Y bounds
  let globalMinY = Infinity;
  let globalMaxY = -Infinity;
  const origSortedSegs: MaterialSegment[][] = new Array(n);
  const origSolids: VoidSpan[][] = new Array(n);

  for (let i = 0; i < n; i++) {
    const segs = [...columns[i].segments].sort((a, b) => a.yBottom - b.yBottom);
    origSortedSegs[i] = segs;
    const solidSpans: VoidSpan[] = [];
    for (const s of segs) {
      if (s.yBottom < globalMinY) globalMinY = s.yBottom;
      if (s.yTop > globalMaxY) globalMaxY = s.yTop;
      if (s.yTop - s.yBottom > 0.1) {
        solidSpans.push([s.yBottom, s.yTop]);
      }
    }
    origSolids[i] = mergeVoidSpans(solidSpans);
  }
  if (globalMinY === Infinity) return;

  // 2. Chamber-reachable open voids at t = 0
  const origOpenVoids = extractOpenVoidsFromSolids(
    origSolids,
    targetSide,
    globalMinY,
    globalMaxY
  );
  const currentSolids: VoidSpan[][] = origSolids.map((list) =>
    list.map(([a, b]) => [a, b] as VoidSpan)
  );

  const dx = totalWidth / Math.max(1, n);

  // 3. Identify currently exposed active ScallopWalls to track pinch-off & propagate inner walls
  interface ActiveWallTracker {
    w: ScallopWall;
    dir: 1 | -1;
    sampleYs: number[];
    openTau: Float64Array;
  }
  const activeWalls: ActiveWallTracker[] = [];
  if (scallopWalls && scallopWalls.length > 0 && stepCoverage > 0) {
    for (const w of scallopWalls) {
      if (w.targetSide !== targetSide) continue;
      const wallHeight = Math.abs(w.yBot - w.yTop);
      if (wallHeight <= 5) continue;

      const dir: 1 | -1 = w.wallSide === 'left' ? 1 : -1;
      const yMid = 0.5 * (w.yTop + w.yBot);
      const xBaseMid = evalWallXAtY(w, yMid);
      const wMinY = Math.min(w.yTop, w.yBot);
      const wMaxY = Math.max(w.yTop, w.yBot);

      // Skip walls already covered by a later wall further into the trench
      const shadowed = scallopWalls.some((w2) => {
        if (w2 === w || w2.targetSide !== w.targetSide || w2.wallSide !== w.wallSide) {
          return false;
        }
        const ov = Math.min(wMaxY, Math.max(w2.yTop, w2.yBot)) -
          Math.max(wMinY, Math.min(w2.yTop, w2.yBot));
        if (ov <= wallHeight * 0.4) return false;
        return dir * (evalWallXAtY(w2, yMid) - xBaseMid) > 0.5;
      });
      if (shadowed) continue;

      // Selective plating check against underlying wall material
      if (selectivePlating) {
        const cSolid = Math.max(
          0,
          Math.min(n - 1, Math.floor((xBaseMid - dir * dx * 0.45) / dx))
        );
        const seedSeg = origSortedSegs[cSolid].find(
          (s) => s.yBottom <= yMid + 1 && s.yTop >= yMid - 1
        );
        if (!seedSeg || !isSeedMaterialId(seedSeg.materialId)) continue;
      }

      const cProbeA = Math.max(
        0,
        Math.min(n - 1, Math.floor((xBaseMid + dir * dx * 0.55) / dx))
      );
      const cProbeB = Math.max(
        0,
        Math.min(n - 1, Math.floor((xBaseMid + dir * dx * 1.1) / dx))
      );
      const isExposed =
        voidContainsY(origOpenVoids[cProbeA], yMid) ||
        voidContainsY(origOpenVoids[cProbeB], yMid);
      if (!isExposed) continue;

      const numSamples = 9;
      const sampleYs: number[] = [];
      for (let s = 0; s < numSamples; s++) {
        const frac = (s + 0.5) / numSamples;
        sampleYs.push(w.yTop + frac * (w.yBot - w.yTop));
      }
      activeWalls.push({
        w,
        dir,
        sampleYs,
        openTau: new Float64Array(numSamples),
      });
    }
  }

  // 4. Progressive checkpointed Huygens dilation + BFS chamber reachability
  // Once a throat/mouth pinches off at t_pinch < thickness, cavities behind it drop
  // out of reachableVoids and receive zero further growth.
  const stepBudget = Math.max(4, Math.min(12, dx * 0.4));
  const numSteps =
    thickness <= 1
      ? 1
      : Math.max(4, Math.min(35, Math.ceil(thickness / stepBudget)));

  for (let m = 1; m <= numSteps; m++) {
    const prevTau = (thickness * (m - 1)) / numSteps;
    const tau = (thickness * m) / numSteps;
    const scale = tau / thickness;
    const reachableVoids =
      m === 1
        ? origOpenVoids
        : extractOpenVoidsFromSolids(
            currentSolids,
            targetSide,
            globalMinY,
            globalMaxY
          );

    // Track per-wall sample openness before growing increment [prevTau -> tau]
    for (const aw of activeWalls) {
      const probeOffset = Math.max(dx * 0.55, prevTau * stepCoverage + dx * 0.35);
      for (let s = 0; s < aw.sampleYs.length; s++) {
        const ys = aw.sampleYs[s];
        const xBase = evalWallXAtY(aw.w, ys);
        const cProbe1 = Math.max(
          0,
          Math.min(n - 1, Math.floor((xBase + aw.dir * probeOffset) / dx))
        );
        const cProbe2 = Math.max(
          0,
          Math.min(n - 1, Math.floor((xBase + aw.dir * (probeOffset + dx * 0.6)) / dx))
        );
        if (
          voidContainsY(reachableVoids[cProbe1], ys) ||
          voidContainsY(reachableVoids[cProbe2], ys)
        ) {
          aw.openTau[s] = tau;
        }
      }
    }

    const stepGrown: VoidSpan[][] = Array.from({ length: n }, () => []);

    // 4a. Direct horizontal face growth (floors & undercut ceilings) from origSolids
    for (let i = 0; i < n; i++) {
      const segs = origSortedSegs[i];
      const voids0 = origOpenVoids[i];
      const voidsReach = reachableVoids[i];
      if (voids0.length === 0 || voidsReach.length === 0 || segs.length === 0) {
        continue;
      }

      const cFactor = cornerFactors ? cornerFactors[i] : 0;
      const outerThick = thickness * (1 + cornerBoostStrength * cFactor);

      for (let vi = 0; vi < voids0.length; vi++) {
        const [vBot, vTop] = voids0[vi];

        if (vBot > -Infinity) {
          const floorSeg = segs.find((s) => Math.abs(s.yTop - vBot) < 0.5);
          if (floorSeg && isSeedMaterialId(floorSeg.materialId)) {
            const isOuterSurface = targetSide === 'front' && vTop === Infinity;
            const tFloor =
              scale *
              (isOuterSurface
                ? outerThick
                : thickness * (isConformal ? 1.0 : stepCoverage));
            if (tFloor > 0.25) {
              clipSpanToIntervals(
                vBot,
                Math.min(vTop, vBot + tFloor),
                voidsReach,
                stepGrown[i]
              );
            }
          }
        }

        if (vTop < Infinity) {
          const ceilSeg = segs.find((s) => Math.abs(s.yBottom - vTop) < 0.5);
          if (ceilSeg && isSeedMaterialId(ceilSeg.materialId)) {
            const isOuterSurface = targetSide === 'back' && vBot === -Infinity;
            const tCeil =
              scale *
              (isOuterSurface
                ? outerThick
                : thickness * (isConformal ? 1.0 : stepCoverage * 0.7));
            if (tCeil > 0.25) {
              clipSpanToIntervals(
                Math.max(vBot, vTop - tCeil),
                vTop,
                voidsReach,
                stepGrown[i]
              );
            }
          }
        }
      }
    }

    // 4b. 2D Corridor-Aware Huygens Ellipsoidal Sidewall & Corner Growth
    if (stepCoverage > 0) {
      for (let i = 0; i < n; i++) {
        const segs = origSortedSegs[i];
        if (segs.length === 0) continue;

        const voidsI = origOpenVoids[i];
        const cFactor = cornerFactors ? cornerFactors[i] : 0;
        const outerThick = thickness * (1 + cornerBoostStrength * cFactor);

        for (const seg of segs) {
          if (!isSeedMaterialId(seg.materialId)) continue;
          const sBot = seg.yBottom;
          const sTop = seg.yTop;
          if (sTop - sBot <= 0.25) continue;

          const topVoid = voidsI.find((v) => Math.abs(v[0] - sTop) < 0.5);
          const botVoid = voidsI.find((v) => Math.abs(v[1] - sBot) < 0.5);

          const tzTop = topVoid
            ? scale *
              (topVoid[1] === Infinity && targetSide === 'front'
                ? outerThick
                : thickness * (isConformal ? 1.0 : stepCoverage))
            : 0;
          const tzBot = botVoid
            ? scale *
              (botVoid[0] === -Infinity && targetSide === 'back'
                ? outerThick
                : thickness * (isConformal ? 1.0 : stepCoverage * 0.7))
            : 0;

          const isOuterSegment =
            (targetSide === 'front' && topVoid?.[1] === Infinity) ||
            (targetSide === 'back' && botVoid?.[0] === -Infinity);
          const tx =
            scale * (isOuterSegment ? outerThick : thickness) * stepCoverage;
          if (tx <= 0.25) continue;

          const colRadius = Math.max(1, Math.ceil(tx / dx + 0.5));
          const initCorridor: VoidSpan[] = [
            [botVoid ? botVoid[0] : sBot, topVoid ? topVoid[1] : sTop],
          ];

          for (const dir of [-1, 1] as const) {
            const adjIdx = i + dir;
            if (adjIdx < 0 || adjIdx >= n) continue;

            const wallSpans = intersectVoidSpans(
              [[sBot, sTop]],
              origOpenVoids[adjIdx]
            );
            const hasExposedWall = wallSpans.length > 0;

            let corridor: VoidSpan[] = initCorridor;

            for (let stepCols = 1; stepCols <= colRadius; stepCols++) {
              const k = i + dir * stepCols;
              if (k < 0 || k >= n) break;

              corridor = intersectVoidSpans(corridor, origOpenVoids[k]);
              if (corridor.length === 0) break;

              const emitIntervals =
                reachableVoids[k].length > 0
                  ? intersectVoidSpans(corridor, reachableVoids[k])
                  : [];
              if (emitIntervals.length === 0) continue;

              const distX = (stepCols - 0.5) * dx;
              const withinRx = distX <= tx;
              const dropFactor = withinRx
                ? Math.sqrt(Math.max(0, 1 - (distX / tx) * (distX / tx)))
                : 0;

              if (hasExposedWall) {
                for (const [wBot, wTop] of wallSpans) {
                  const topCornerOpen =
                    Boolean(topVoid) && Math.abs(wTop - sTop) < 0.5;
                  const botCornerOpen =
                    Boolean(botVoid) && Math.abs(wBot - sBot) < 0.5;

                  if (withinRx) {
                    const extTop = topCornerOpen ? tzTop * dropFactor : 0;
                    const extBot = botCornerOpen ? tzBot * dropFactor : 0;
                    clipSpanToIntervals(
                      wBot - extBot,
                      wTop + extTop,
                      emitIntervals,
                      stepGrown[k]
                    );
                  } else if (
                    m === numSteps &&
                    stepCols === 1 &&
                    wTop - wBot > 1 &&
                    tx >= dx * 0.08
                  ) {
                    // Sub-column continuous sidewall strip for very thin (< 0.5*dx) conformal liners,
                    // applied only at the final step when adjacent column remains open so thin films
                    // never prematurely pinch narrow slots.
                    const kNext = k + dir;
                    const hasRoomToStayOpen =
                      kNext >= 0 &&
                      kNext < n &&
                      intersectVoidSpans(reachableVoids[kNext], emitIntervals).length > 0;
                    if (hasRoomToStayOpen) {
                      const bevelTop = topCornerOpen
                        ? Math.min(tzTop * 0.15, tx * 0.5)
                        : 0;
                      const bevelBot = botCornerOpen
                        ? Math.min(tzBot * 0.15, tx * 0.5)
                        : 0;
                      clipSpanToIntervals(
                        wBot - bevelBot,
                        wTop + bevelTop,
                        emitIntervals,
                        stepGrown[k]
                      );
                    }
                  }
                }
              } else if (withinRx) {
                if (topVoid && tzTop > 0.25) {
                  const segTopAtK = origSortedSegs[k].find(
                    (s) => Math.abs(s.yTop - sTop) < 0.5
                  );
                  const allowTopCorner =
                    !selectivePlating ||
                    !segTopAtK ||
                    isSeedMaterialId(segTopAtK.materialId);
                  if (allowTopCorner) {
                    clipSpanToIntervals(
                      sTop,
                      sTop + tzTop * dropFactor,
                      emitIntervals,
                      stepGrown[k]
                    );
                  }
                }
                if (botVoid && tzBot > 0.25) {
                  const segBotAtK = origSortedSegs[k].find(
                    (s) => Math.abs(s.yBottom - sBot) < 0.5
                  );
                  const allowBotCorner =
                    !selectivePlating ||
                    !segBotAtK ||
                    isSeedMaterialId(segBotAtK.materialId);
                  if (allowBotCorner) {
                    clipSpanToIntervals(
                      sBot - tzBot * dropFactor,
                      sBot,
                      emitIntervals,
                      stepGrown[k]
                    );
                  }
                }
              }
            }
          }
        }
      }
    }

    for (let i = 0; i < n; i++) {
      if (stepGrown[i].length > 0) {
        currentSolids[i] = mergeVoidSpans([...currentSolids[i], ...stepGrown[i]]);
      }
    }
  }

  // Heal isolated 1-column sub-grid (<= 1.1*dx) corner pinholes enclosed on all sides
  // by newly deposited film (discretization artifact at acute concave corners).
  for (let i = 1; i < n - 1; i++) {
    const solids = currentSolids[i];
    if (solids.length < 2) continue;
    const bridges: VoidSpan[] = [];
    for (let s = 0; s < solids.length - 1; s++) {
      const gBot = solids[s][1];
      const gTop = solids[s + 1][0];
      if (gTop - gBot > dx * 1.1 || gTop - gBot <= 0.1) continue;
      // Only bridge gaps inside originally open voids whose flanking columns are now completely solid
      const wasOpen = origOpenVoids[i].some(([ob, ot]) => ob <= gBot + 0.5 && ot >= gTop - 0.5);
      if (!wasOpen) continue;
      const leftSolid = currentSolids[i - 1].some(([sb, st]) => sb <= gBot + 0.5 && st >= gTop - 0.5);
      const rightSolid = currentSolids[i + 1].some(([sb, st]) => sb <= gBot + 0.5 && st >= gTop - 0.5);
      if (leftSolid && rightSolid) {
        bridges.push([gBot, gTop]);
      }
    }
    if (bridges.length > 0) {
      currentSolids[i] = mergeVoidSpans([...solids, ...bridges]);
    }
  }

  // 5. Commit deposited film intervals (currentSolids minus origSolids) into columns
  for (let i = 0; i < n; i++) {
    const solids0 = origSolids[i];
    const finalSolids = currentSolids[i];
    const col = columns[i];

    let changed = false;
    for (let [gBot, gTop] of finalSolids) {
      for (const [sBot, sTop] of solids0) {
        if (sTop <= gBot + 0.1) continue;
        if (sBot >= gTop - 0.1) break;
        if (sBot > gBot + 0.25) {
          col.segments.push({
            yBottom: gBot,
            yTop: sBot,
            materialId: matId,
            stepId: step.id,
            side: targetSide,
          });
          changed = true;
        }
        gBot = Math.max(gBot, sTop);
        if (gBot >= gTop - 0.25) break;
      }
      if (gTop - gBot > 0.25) {
        col.segments.push({
          yBottom: gBot,
          yTop: gTop,
          materialId: matId,
          stepId: step.id,
          side: targetSide,
        });
        changed = true;
      }
    }

    if (changed) {
      col.segments.sort((a, b) => a.yBottom - b.yBottom);
    }
  }

  // 6. Propagate inner Huygens-attenuated & pinch-aware ScallopWalls for remaining open walls
  if (activeWalls.length > 0 && scallopWalls) {
    const finalOpenVoids = extractOpenVoidsFromSolids(
      currentSolids,
      targetSide,
      globalMinY,
      globalMaxY
    );
    const rawFinalVoids = (() => {
      // Also capture surviving keyhole pockets that were partially open before pinch-off
      const allVoids: VoidSpan[][] = new Array(n);
      for (let i = 0; i < n; i++) {
        const segs = currentSolids[i];
        const v: VoidSpan[] = [];
        if (segs.length === 0) {
          v.push(
            targetSide === 'front' ? [globalMinY, Infinity] : [-Infinity, globalMaxY]
          );
        } else {
          if (targetSide === 'back') v.push([-Infinity, segs[0][0]]);
          for (let m = 0; m < segs.length - 1; m++) {
            if (segs[m + 1][0] - segs[m][1] > 1) {
              v.push([segs[m][1], segs[m + 1][0]]);
            }
          }
          if (targetSide === 'front') v.push([segs[segs.length - 1][1], Infinity]);
        }
        allVoids[i] = v;
      }
      return allVoids;
    })();

    const attenuateScallop = (d0: number, pitch: number, t: number): number => {
      if (d0 <= 0.5) return 0;
      const halfP = Math.max(2, pitch * 0.5);
      const R0 = (d0 * d0 + halfP * halfP) / (2 * d0);
      const R1 = R0 + t;
      const rad = Math.sqrt(Math.max(0, R1 * R1 - halfP * halfP));
      return Math.max(0, R1 - rad);
    };

    for (const aw of activeWalls) {
      const w = aw.w;
      const dir = aw.dir;
      let maxTau = 0;
      let sumOpenTau = 0;
      let countOpen = 0;
      let openMidVoid: VoidSpan | null = null;

      // Scan mid-to-bottom samples to determine surviving trench/keyhole openness
      for (let s = 0; s < aw.sampleYs.length; s++) {
        if (aw.openTau[s] > maxTau) maxTau = aw.openTau[s];
        const ys = aw.sampleYs[s];
        const xProbe =
          evalWallXAtY(w, ys) + dir * (aw.openTau[s] * stepCoverage + dx * 0.65);
        const cProbe = Math.max(0, Math.min(n - 1, Math.floor(xProbe / dx)));
        const vOpen =
          findContainingVoid(finalOpenVoids[cProbe], ys, 2) ||
          findContainingVoid(rawFinalVoids[cProbe], ys, 2);
        if (vOpen) {
          sumOpenTau += aw.openTau[s];
          countOpen++;
          if (
            !openMidVoid ||
            (targetSide === 'front' ? vOpen[0] < openMidVoid[0] : vOpen[1] > openMidVoid[1])
          ) {
            openMidVoid = vOpen;
          }
        }
      }
      if (countOpen === 0 || maxTau <= 0.5 || !openMidVoid) continue;

      const effTau = Math.min(thickness, sumOpenTau / countOpen);
      const tWall = effTau * stepCoverage;
      if (tWall <= 0.25) continue;

      const dxLine = w.xBot - w.xTop;
      const dyLine = w.yBot - w.yTop;
      const segLen = Math.hypot(dxLine, dyLine);
      if (segLen <= 1) continue;
      const secAlpha = segLen / Math.max(1, Math.abs(dyLine));

      // Check whether mouth at w.yTop stayed open to ambient or pinched into a keyhole
      const topProbeX = w.xTop + dir * (thickness * stepCoverage + dx * 0.55);
      const cTopProbe = Math.max(0, Math.min(n - 1, Math.floor(topProbeX / dx)));
      const topVoidOpen = findContainingVoid(finalOpenVoids[cTopProbe], w.yTop, 2);
      const topAmbientConnected =
        topVoidOpen !== null &&
        (targetSide === 'front'
          ? topVoidOpen[1] === Infinity
          : topVoidOpen[0] === -Infinity);

      let yTopInner: number;
      let xTopInner: number;
      let yBotInner: number;
      let xBotInner: number;

      if (topAmbientConnected) {
        if (!w.isReentrant && Math.abs(dxLine) > 0.5) {
          // Positive taper (<90°): Huygens tangent point sits slightly into the top slope
          const nyMag = (tWall * Math.abs(dxLine)) / segLen;
          yTopInner =
            targetSide === 'front' ? w.yTop + nyMag : w.yTop - nyMag;
          xTopInner = w.xTop + (dir * tWall * Math.abs(dyLine)) / segLen;
        } else {
          yTopInner = w.yTop;
          xTopInner = w.xTop + dir * tWall;
        }
      } else {
        // Mouth pinched off — keyhole roof closes below w.yTop
        yTopInner =
          targetSide === 'front'
            ? Math.min(w.yTop, openMidVoid[1])
            : Math.max(w.yTop, openMidVoid[0]);
        xTopInner = evalWallXAtY(w, yTopInner) + dir * tWall * secAlpha;
      }

      // Compute floor/pocket bottom along openMidVoid
      const expectedFloorT = effTau * (isConformal ? 1.0 : stepCoverage);
      const nominalYBot =
        targetSide === 'front'
          ? w.yBot + expectedFloorT
          : w.yBot - expectedFloorT;
      if (Number.isFinite(openMidVoid[0]) && Number.isFinite(openMidVoid[1])) {
        yBotInner =
          targetSide === 'front'
            ? Math.max(w.yBot, openMidVoid[0])
            : Math.min(w.yBot, openMidVoid[1]);
      } else {
        const toeProbeX =
          w.xBot + dir * (tWall * secAlpha + dx * 1.05);
        const cToe = Math.max(0, Math.min(n - 1, Math.floor(toeProbeX / dx)));
        const toeVoid = findContainingVoid(finalOpenVoids[cToe], nominalYBot, 2);
        const floorLim =
          targetSide === 'front'
            ? Math.max(
                w.yBot,
                toeVoid ? Math.min(openMidVoid[0], toeVoid[0]) : openMidVoid[0]
              )
            : Math.min(
                w.yBot,
                toeVoid ? Math.max(openMidVoid[1], toeVoid[1]) : openMidVoid[1]
              );
        yBotInner = Number.isFinite(floorLim) ? floorLim : nominalYBot;
      }
      xBotInner = evalWallXAtY(w, yBotInner) + dir * tWall * secAlpha;

      const innerHeight =
        targetSide === 'front'
          ? yTopInner - yBotInner
          : yBotInner - yTopInner;
      if (innerHeight <= 10) continue;

      let colTopInner: number;
      let colBotInner: number;
      const isVerticalInner = !w.isReentrant && Math.abs(xTopInner - xBotInner) <= 0.5;
      if (w.wallSide === 'left') {
        if (isVerticalInner) {
          colTopInner = Math.max(
            0,
            Math.min(n - 2, Math.floor(xTopInner / dx - 0.5 + 1e-6))
          );
          colBotInner = colTopInner + 1;
        } else {
          colTopInner = Math.max(
            0,
            Math.min(n - 1, Math.floor((xTopInner - 1e-6) / dx))
          );
          if (w.isReentrant) {
            colBotInner = Math.max(
              0,
              Math.min(colTopInner, Math.floor((xBotInner + 1e-6) / dx))
            );
          } else {
            colBotInner = Math.max(
              colTopInner + 1,
              Math.min(n - 1, Math.ceil(xBotInner / dx - 0.5 - 1e-6))
            );
          }
        }
      } else {
        if (isVerticalInner) {
          colTopInner = Math.max(
            1,
            Math.min(n - 1, Math.ceil(xTopInner / dx - 0.5 - 1e-6))
          );
          colBotInner = colTopInner - 1;
        } else {
          colTopInner = Math.max(
            0,
            Math.min(n - 1, Math.floor((xTopInner + 1e-6) / dx))
          );
          if (w.isReentrant) {
            colBotInner = Math.max(
              colTopInner,
              Math.min(n - 1, Math.floor((xBotInner - 1e-6) / dx))
            );
          } else {
            colBotInner = Math.max(
              0,
              Math.min(colTopInner - 1, Math.floor(xBotInner / dx - 0.5 + 1e-6))
            );
          }
        }
      }

      const dTopInner = attenuateScallop(w.scallopDepth, w.scallopPitch, tWall);
      const dBotInner = attenuateScallop(
        w.scallopBottomDepth ?? w.scallopDepth,
        w.scallopPitch,
        tWall
      );

      if (
        dTopInner > 0.5 ||
        w.isReentrant ||
        Math.abs(xTopInner - xBotInner) > 0.5 ||
        isVerticalInner
      ) {
        scallopWalls.push({
          stepId: step.id,
          targetSide,
          wallSide: w.wallSide,
          colTop: colTopInner,
          colBot: colBotInner,
          xTop: xTopInner,
          xBot: xBotInner,
          yTop: yTopInner,
          yBot: yBotInner,
          scallopDepth: dTopInner,
          scallopBottomDepth: dBotInner,
          scallopPitch: w.scallopPitch,
          isReentrant: w.isReentrant,
          isDepositionWall: true,
        });
      }
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
  const polarity = cfg?.polarity ?? 'positive';
  const maskField = cfg?.maskField ?? 'dark-field';
  const resistMatId = resolveResistMaterialId(polarity, cfg?.resistMaterialId);
  const resistThickness = cfg?.resistThickness ?? 1000;
  const windows = cfg?.windows ?? [];
  const sidewallAngle = cfg?.sidewallAngle ?? 90;

  const coatMethod = cfg?.coatMethod ?? 'spin-coat';
  const isLorBilayer = coatMethod === 'lor-bilayer';
  const lorMatId = cfg?.lorMaterialId || 'mat_pr_lor';
  const lorThickness = isLorBilayer ? Math.max(0, cfg?.lorThickness ?? 400) : 0;
  const lorUndercut = isLorBilayer ? Math.max(0, cfg?.lorUndercut ?? 350) : 0;

  const applySpinCoatLayer = (matId: string, layerThickness: number, planarization: number) => {
    if (layerThickness <= 0) return;
    if (targetSide === 'front') {
      const layerTops = computeSpinCoatSurface(
        columns,
        _totalWidth,
        'front',
        layerThickness,
        planarization
      );
      for (let i = 0; i < columns.length; i++) {
        const col = columns[i];
        if (col.segments.length === 0) continue;
        const currentTop = getTopY(col);
        if (layerTops[i] > currentTop) {
          col.segments.push({
            yBottom: currentTop,
            yTop: layerTops[i],
            materialId: matId,
            stepId: step.id,
            side: 'front',
          });
        }
      }
    } else {
      const layerBottoms = computeSpinCoatSurface(
        columns,
        _totalWidth,
        'back',
        layerThickness,
        planarization
      );
      for (let i = 0; i < columns.length; i++) {
        const col = columns[i];
        if (col.segments.length === 0) continue;
        const currentBottom = getBottomY(col);
        if (layerBottoms[i] < currentBottom) {
          col.segments.unshift({
            yBottom: layerBottoms[i],
            yTop: currentBottom,
            materialId: matId,
            stepId: step.id,
            side: 'back',
          });
        }
      }
    }
  };

  // 1. Apply photoresist (Single Spin-Coat, LOR Double-Coat Bilayer, OR Dry Film Lamination)
  if (coatMethod === 'dry-film') {
    const sag = cfg?.laminationSag ?? 0;
    const { yBottom, yTop } = computeDryFilmProfile(
      columns,
      _totalWidth,
      targetSide,
      resistThickness,
      sag
    );
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      if (col.segments.length === 0 || yTop[i] <= yBottom[i]) continue;
      const seg: MaterialSegment = {
        yBottom: yBottom[i],
        yTop: yTop[i],
        materialId: resistMatId,
        stepId: step.id,
        side: targetSide,
      };
      if (targetSide === 'front') {
        col.segments.push(seg);
      } else {
        col.segments.unshift(seg);
      }
    }
  } else {
    const planarization = cfg?.planarization ?? 100;
    // First coat (if LOR double coat): sacrificial Lift-Off Resist underlayer
    if (isLorBilayer && lorThickness > 0) {
      applySpinCoatLayer(lorMatId, lorThickness, planarization);
    }
    // Second / top coat: imaging photoresist
    applySpinCoatLayer(resistMatId, resistThickness, planarization);
  }

  // 2. Exposure (Mask Field Polarity) & Development (Resist Tone)
  // Dark-field: windows = clear apertures (exposed inside windows).
  // Light-field: windows = opaque chrome blockers (exposed outside windows).
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

    const isExposed = maskField === 'light-field' ? !inWindow : inWindow;
    isDissolved[i] = polarity === 'positive' ? isExposed : !isExposed;
  }

  // 3. Sidewall angle shaping (tapered < 90° or retrograde undercut > 90°) on top imaging resist
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

  // 4. Remove resist (and LOR underlayer if bilayer) from dissolved columns on this side
  for (let i = 0; i < columns.length; i++) {
    if (isDissolved[i]) {
      const col = columns[i];
      col.segments = col.segments.filter((seg) => {
        if (seg.stepId !== step.id || seg.side !== targetSide) return true;
        if (seg.materialId === resistMatId) return false;
        if (isLorBilayer && seg.materialId === lorMatId) return false;
        return true;
      });
    }
  }

  // 5. Adjustable lateral LOR undercut beneath top imaging resist overhang
  if (isLorBilayer && lorThickness > 0 && lorUndercut > 0) {
    applyLorUndercut(
      columns,
      isDissolved,
      lorUndercut,
      lorMatId,
      resistMatId,
      step.id,
      targetSide,
      _totalWidth
    );
  }
}

function computeDistanceToDissolvedEdge(
  columns: ColumnProfile[],
  isDissolved: boolean[],
  totalWidth: number
): Float64Array {
  const numCols = columns.length;
  const distToEdge = new Float64Array(numCols);
  if (numCols === 0) return distToEdge;

  const dx = totalWidth / numCols;
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
    distToEdge[i] = Math.min(distToOpeningLeft[i], distToOpeningRight[i]);
  }
  return distToEdge;
}

/**
 * Isotropic alkaline developer lateral undercut of LOR underlayer beneath the top imaging resist
 */
function applyLorUndercut(
  columns: ColumnProfile[],
  isDissolved: boolean[],
  undercutNm: number,
  lorMatId: string,
  resistMatId: string,
  stepId: string,
  targetSide: 'front' | 'back',
  totalWidth: number
): void {
  const numCols = columns.length;
  if (numCols === 0 || undercutNm <= 0) return;

  const distToEdge = computeDistanceToDissolvedEdge(columns, isDissolved, totalWidth);

  for (let i = 0; i < numCols; i++) {
    if (isDissolved[i]) continue;
    const dEdge = distToEdge[i];
    if (!Number.isFinite(dEdge) || dEdge >= undercutNm) continue;

    const col = columns[i];
    const prSeg = col.segments.find(
      (s) =>
        s.materialId === resistMatId &&
        s.stepId === stepId &&
        s.side === targetSide
    );
    if (prSeg) {
      prSeg.isOverhang = true;
    }

    const lorIdx = col.segments.findIndex(
      (s) =>
        s.materialId === lorMatId &&
        s.stepId === stepId &&
        s.side === targetSide
    );
    if (lorIdx === -1) continue;

    const lorSeg = col.segments[lorIdx];
    const lorHeight = lorSeg.yTop - lorSeg.yBottom;
    if (lorHeight <= 0) {
      col.segments.splice(lorIdx, 1);
      continue;
    }

    // Concave isotropic wet-development fillet near the LOR undercut front,
    // leaving full clear overhang cavity of width `undercutNm` at the LOR/PR interface
    const footRadius = Math.min(undercutNm * 0.4, lorHeight * 0.65);
    if (footRadius <= 1 || dEdge <= undercutNm - footRadius) {
      col.segments.splice(lorIdx, 1);
      continue;
    }

    const u = Math.max(0, Math.min(1, (dEdge - (undercutNm - footRadius)) / footRadius));
    const frac = 1 - Math.sqrt(Math.max(0, 1 - u * u));
    if (lorHeight * frac < 1) {
      col.segments.splice(lorIdx, 1);
      continue;
    }

    if (targetSide === 'front') {
      lorSeg.yTop = lorSeg.yBottom + lorHeight * frac;
    } else {
      lorSeg.yBottom = lorSeg.yTop - lorHeight * frac;
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

  const clampedAngle = Math.max(45, Math.min(135, angle));
  const absTan = Math.abs(Math.tan((clampedAngle * Math.PI) / 180));
  if (absTan < 1e-4) return;

  const isRetrograde = clampedAngle > 90;
  const distToEdge = computeDistanceToDissolvedEdge(columns, isDissolved, totalWidth);

  for (let i = 0; i < numCols; i++) {
    if (isDissolved[i]) continue;
    const dEdge = distToEdge[i];
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
  scallopWalls?: ScallopWall[],
  etchLibrary?: EtchRecipe[]
): void {
  const cfg = step.etch;
  const linkedRecipe = cfg?.etchRecipeId
    ? getEtchRecipeById(etchLibrary, cfg.etchRecipeId)
    : undefined;
  const activeRecipe = linkedRecipe;
  const isRateDriven = Boolean(activeRecipe);
  const depth = cfg?.depth ?? step.thickness ?? 200;
  const targetMatId = cfg?.targetMaterialId ?? 'all';
  const isotropy =
    cfg?.isotropy ?? (cfg?.etchType === 'wet-isotropic' ? 0.95 : 0);
  const stopLayerId = cfg?.stopLayerMaterialId;
  const sidewallAngle = cfg?.sidewallAngle ?? 90;
  const dx = totalWidth / columns.length;

  const etchTimeMin = (() => {
    if (!linkedRecipe) return 0;
    if (cfg?.rateMode === 'time-rate') {
      return Math.max(0.001, (cfg?.etchTimeSec ?? 60) / 60);
    }
    if (depth <= 0) return 0;
    const refMatId =
      cfg?.referenceMaterialId ||
      (targetMatId !== 'all' ? targetMatId : linkedRecipe.primaryMaterialId);
    const refRate = getEtchRateNmMin(linkedRecipe, refMatId);
    return refRate > 0 ? depth / refRate : 0;
  })();

  if (!isRateDriven && depth <= 0) return;
  if (isRateDriven && etchTimeMin <= 0) return;

  const maskEtchTimeMin = linkedRecipe ? etchTimeMin : 0;

  // 1. Identify which columns have exposed target material at the active surface
  const isColumnExposed: boolean[] = new Array(columns.length).fill(false);
  const wasProtectedResistCol = new Uint8Array(columns.length);

  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    if (col.segments.length === 0) continue;
    const surfaceSeg =
      targetSide === 'front'
        ? col.segments[col.segments.length - 1]
        : col.segments[0];

    const mat = getMaterialById(materials, surfaceSeg.materialId);
    const isProtectedResist =
      mat.category === 'photoresist' &&
      cfg?.etchType !== 'ashing' &&
      targetMatId !== surfaceSeg.materialId;

    if (isProtectedResist) {
      isColumnExposed[i] = false;
      wasProtectedResistCol[i] = 1;
    } else if (targetMatId === 'all' || surfaceSeg.materialId === targetMatId) {
      if (activeRecipe) {
        isColumnExposed[i] =
          getEtchRateNmMin(activeRecipe, surfaceSeg.materialId) > 0;
      } else {
        isColumnExposed[i] = true;
      }
    }
  }

  // 2. Nominal vertical etch depth per column (time-and-rate integrated when recipe-driven)
  const baseDepthPerCol = new Float64Array(columns.length);
  let maxBaseDepth = 0;
  for (let i = 0; i < columns.length; i++) {
    if (!isColumnExposed[i]) continue;
    if (!activeRecipe) {
      baseDepthPerCol[i] = depth;
      if (depth > maxBaseDepth) maxBaseDepth = depth;
      continue;
    }

    const col = columns[i];
    const orderedSegs =
      targetSide === 'front' ? [...col.segments].reverse() : [...col.segments];
    let remTime = etchTimeMin;
    let accumDepth = 0;
    for (const seg of orderedSegs) {
      const mat = getMaterialById(materials, seg.materialId);
      if (
        mat.category === 'photoresist' &&
        cfg?.etchType !== 'ashing' &&
        targetMatId !== seg.materialId
      ) {
        break;
      }
      if (stopLayerId && seg.materialId === stopLayerId) break;
      if (targetMatId !== 'all' && seg.materialId !== targetMatId) break;

      const rate = getEtchRateNmMin(activeRecipe, seg.materialId);
      if (rate <= 0) break;

      const segH = seg.yTop - seg.yBottom;
      const timeNeeded = segH / rate;
      if (remTime >= timeNeeded) {
        remTime -= timeNeeded;
        accumDepth += segH;
      } else {
        accumDepth += remTime * rate;
        remTime = 0;
        break;
      }
    }
    baseDepthPerCol[i] = accumDepth;
    if (accumDepth > maxBaseDepth) maxBaseDepth = accumDepth;
  }

  const refDepthForScale = isRateDriven ? maxBaseDepth : depth;
  if (refDepthForScale <= 0) {
    if (linkedRecipe && maskEtchTimeMin > 0) {
      applyPhotoresistMaskConsumption(
        columns,
        wasProtectedResistCol,
        materials,
        linkedRecipe,
        maskEtchTimeMin,
        targetSide,
        targetMatId,
        stopLayerId
      );
    }
    return;
  }

  const rawEtchType = cfg?.etchType || 'rie';
  const isBoschDrie = rawEtchType === 'drie-bosch';
  const isKohEtch = rawEtchType === 'wet-koh';
  const isDryEtch = ['rie', 'drie-bosch', 'ion-beam', 'ashing'].includes(rawEtchType);

  const colSurfaceRate = new Float64Array(columns.length);
  let maxExposedFastRate = 0;
  let fastOpenRefDepth = 0;
  for (let i = 0; i < columns.length; i++) {
    if (!isColumnExposed[i] || columns[i].segments.length === 0) continue;
    if (!activeRecipe) {
      colSurfaceRate[i] = 1;
      maxExposedFastRate = 1;
      if (baseDepthPerCol[i] > fastOpenRefDepth) fastOpenRefDepth = baseDepthPerCol[i];
      continue;
    }
    const surfSeg =
      targetSide === 'front'
        ? columns[i].segments[columns[i].segments.length - 1]
        : columns[i].segments[0];
    const r = getEtchRateNmMin(activeRecipe, surfSeg.materialId);
    colSurfaceRate[i] = r;
    if (r > maxExposedFastRate) maxExposedFastRate = r;
    if (baseDepthPerCol[i] > fastOpenRefDepth) fastOpenRefDepth = baseDepthPerCol[i];
  }
  if (fastOpenRefDepth <= 0) fastOpenRefDepth = refDepthForScale;

  // Classify columns acting as a selective hardmask / slow shoulder relative to fast trench layers
  const isMaskShoulderCol = (colIdx: number): boolean => {
    if (!isColumnExposed[colIdx]) return true;
    if (
      activeRecipe &&
      maxExposedFastRate > 0 &&
      colSurfaceRate[colIdx] < 0.2 * maxExposedFastRate &&
      baseDepthPerCol[colIdx] <= 0.35 * fastOpenRefDepth
    ) {
      return true;
    }
    return false;
  };

  // True Knudsen neutral/radical conductance ARDE solver referenced to open-field dose:
  // dz/dt = R0 / (1 + k * (z + z_pre) / W)  =>  z + (k / W) * (z_pre * z + z^2 / 2) = D0
  const colArdeLagRatio = new Float64Array(columns.length).fill(1);
  const colLocalAR = new Float64Array(columns.length).fill(0);

  if (cfg?.ardeEnabled && isDryEtch) {
    const kLag = Math.max(0.05, cfg.ardeStrength ?? 0.5);
    const dOpenField =
      isRateDriven && activeRecipe
        ? Math.max(
            fastOpenRefDepth,
            getEtchRateNmMin(
              activeRecipe,
              cfg?.referenceMaterialId || activeRecipe.primaryMaterialId
            ) * etchTimeMin
          )
        : refDepthForScale;

    let idx = 0;
    while (idx < columns.length) {
      if (isMaskShoulderCol(idx)) {
        idx++;
        continue;
      }
      const runStart = idx;
      while (idx < columns.length && !isMaskShoulderCol(idx)) {
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

      const a = kLag / (2 * effectiveWidth);
      const b = 1 + (kLag * preDepth) / effectiveWidth;
      const D0 = Math.max(1e-6, dOpenField);
      const laggedRefDepth = (2 * D0) / (b + Math.sqrt(b * b + 4 * a * D0));
      const lagFactor = Math.max(0.02, Math.min(1, laggedRefDepth / D0));

      for (let c = runStart; c <= runEnd; c++) {
        if (activeRecipe) {
          const col = columns[c];
          const orderedSegs =
            targetSide === 'front' ? [...col.segments].reverse() : [...col.segments];
          let remTime = etchTimeMin * lagFactor;
          let accumDepth = 0;
          for (const seg of orderedSegs) {
            const mat = getMaterialById(materials, seg.materialId);
            if (
              mat.category === 'photoresist' &&
              cfg?.etchType !== 'ashing' &&
              targetMatId !== seg.materialId
            ) {
              break;
            }
            if (stopLayerId && seg.materialId === stopLayerId) break;
            if (targetMatId !== 'all' && seg.materialId !== targetMatId) break;

            const rate = getEtchRateNmMin(activeRecipe, seg.materialId);
            if (rate <= 0) break;

            const segH = seg.yTop - seg.yBottom;
            const timeNeeded = segH / rate;
            if (remTime >= timeNeeded) {
              remTime -= timeNeeded;
              accumDepth += segH;
            } else {
              accumDepth += remTime * rate;
              remTime = 0;
              break;
            }
          }
          baseDepthPerCol[c] = accumDepth;
        } else {
          const Dcol = Math.max(1e-6, baseDepthPerCol[c]);
          baseDepthPerCol[c] = (2 * Dcol) / (b + Math.sqrt(b * b + 4 * a * Dcol));
        }
        colArdeLagRatio[c] = lagFactor;
        colLocalAR[c] = (preDepth + baseDepthPerCol[c]) / effectiveWidth;
      }
    }
  }

  const isCrystalMat = (materialId: string): boolean => {
    if (!isKohEtch) return true;
    return isCrystallineKohMaterial(getMaterialById(materials, materialId));
  };

  const isBarrierSegment = (seg: MaterialSegment): boolean => {
    const mat = getMaterialById(materials, seg.materialId);
    if (
      mat.category === 'photoresist' &&
      cfg?.etchType !== 'ashing' &&
      targetMatId !== seg.materialId
    ) {
      return true;
    }
    if (stopLayerId && seg.materialId === stopLayerId) return true;
    if (targetMatId !== 'all' && seg.materialId !== targetMatId) return true;
    if (activeRecipe && getEtchRateNmMin(activeRecipe, seg.materialId) <= 0) {
      return true;
    }
    return false;
  };

  const computeVerticalReach = (colIdx: number, budget: number): number => {
    const col = columns[colIdx];
    if (col.segments.length === 0) return 0;
    const surfaceY = targetSide === 'front' ? getTopY(col) : getBottomY(col);
    if (budget <= 0 || !isColumnExposed[colIdx]) return surfaceY;

    const ordered =
      targetSide === 'front' ? [...col.segments].reverse() : [...col.segments];
    let rem = budget;
    let reachedY = surfaceY;
    for (const seg of ordered) {
      if (isBarrierSegment(seg)) break;
      const segH = seg.yTop - seg.yBottom;
      if (rem >= segH) {
        rem -= segH;
        reachedY = targetSide === 'front' ? seg.yBottom : seg.yTop;
      } else {
        reachedY =
          targetSide === 'front' ? seg.yTop - rem : seg.yBottom + rem;
        rem = 0;
        break;
      }
    }
    return reachedY;
  };

  // Convex corner acceleration for isotropic etching (wet-isotropic, isotropy >= 0.15, or isotropic materials in wet-koh)
  const isIsotropicEtch =
    cfg?.etchType === 'wet-isotropic' || isotropy >= 0.15 || isKohEtch;
  if (cfg?.convexCornerEffect && isIsotropicEtch) {
    const cornerBoostStrength = Math.max(0.05, cfg.convexCornerStrength ?? 0.6);
    const cornerFactors = computeConvexCornerFactors(
      columns,
      totalWidth,
      targetSide,
      refDepthForScale
    );
    for (let i = 0; i < columns.length; i++) {
      if (!isColumnExposed[i] || cornerFactors[i] <= 0) continue;
      if (isKohEtch && isotropy < 0.15 && columns[i].segments.length > 0) {
        const surfSeg =
          targetSide === 'front'
            ? columns[i].segments[columns[i].segments.length - 1]
            : columns[i].segments[0];
        if (surfSeg && isCrystalMat(surfSeg.materialId)) continue;
      }
      baseDepthPerCol[i] *= 1 + cornerBoostStrength * cornerFactors[i];
    }
  }

  const supportsPositiveTaper =
    rawEtchType === 'wet-koh' ||
    rawEtchType === 'rie' ||
    rawEtchType === 'ion-beam';
  const isReentrant =
    sidewallAngle > 90.5 &&
    (rawEtchType === 'rie' || rawEtchType === 'drie-bosch');
  const isCrystallographic =
    rawEtchType === 'wet-koh' || (supportsPositiveTaper && sidewallAngle < 89.5);
  const etchDepthPerCol = new Float64Array(baseDepthPerCol);

  // Tapered sidewalls for non-Bosch dry etch (< 89.5°):
  // Non-zero isotropy shifts the sloped wall laterally outward by U = D * isotropy
  // while preserving the target sidewall angle.
  if (isCrystallographic && !isKohEtch) {
    const clampedAngle = Math.max(15, Math.min(89.5, sidewallAngle));
    const angleRad = (clampedAngle * Math.PI) / 180;
    const tanAngle = Math.tan(angleRad);

    for (let i = 0; i < columns.length; i++) {
      if (isMaskShoulderCol(i)) continue;
      const col = columns[i];
      const surfaceY = targetSide === 'front' ? getTopY(col) : getBottomY(col);
      const localDepth = baseDepthPerCol[i];
      const lateralUndercut = localDepth * Math.max(0, isotropy);

      // Only count a masking/shoulder neighbor if it stands at or above this column's surface elevation
      let stepsLeft = 0;
      let leftMaskFound = false;
      while (i - stepsLeft >= 0) {
        const k = i - stepsLeft;
        if (isMaskShoulderCol(k)) {
          if (columns[k].segments.length > 0) {
            const kSurfY =
              targetSide === 'front' ? getTopY(columns[k]) : getBottomY(columns[k]);
            if (targetSide === 'front' ? kSurfY >= surfaceY - 1 : kSurfY <= surfaceY + 1) {
              leftMaskFound = true;
            }
          }
          break;
        }
        stepsLeft++;
      }

      let stepsRight = 0;
      let rightMaskFound = false;
      while (i + stepsRight < columns.length) {
        const k = i + stepsRight;
        if (isMaskShoulderCol(k)) {
          if (columns[k].segments.length > 0) {
            const kSurfY =
              targetSide === 'front' ? getTopY(columns[k]) : getBottomY(columns[k]);
            if (targetSide === 'front' ? kSurfY >= surfaceY - 1 : kSurfY <= surfaceY + 1) {
              rightMaskFound = true;
            }
          }
          break;
        }
        stepsRight++;
      }

      const distToLeftEdge = leftMaskFound ? (stepsLeft - 0.5) * dx : Infinity;
      const distToRightEdge = rightMaskFound ? (stepsRight - 0.5) * dx : Infinity;
      const nearestEdgeDist = Math.min(distToLeftEdge, distToRightEdge);

      if (Number.isFinite(nearestEdgeDist)) {
        const effHorizontalRun = nearestEdgeDist + lateralUndercut;
        etchDepthPerCol[i] = Math.min(localDepth, effHorizontalRun * tanAngle);
      }
    }
  } else if (isCrystallographic && isKohEtch) {
    // KOH / TMAH crystallographic clamping applies strictly to crystalline materials (e.g. Si <100>, Si:P);
    // non-crystalline layers (poly-Si, Al, SiO2, quartz) etch vertically & isotropically without crystal facets.
    const clampedAngle = Math.max(15, Math.min(89.5, sidewallAngle));
    const tanAngle = Math.tan((clampedAngle * Math.PI) / 180);
    const rawVerticalFloor = new Float64Array(columns.length);
    for (let k = 0; k < columns.length; k++) {
      rawVerticalFloor[k] = computeVerticalReach(k, baseDepthPerCol[k]);
    }

    for (let i = 0; i < columns.length; i++) {
      if (!isColumnExposed[i] || baseDepthPerCol[i] <= 0) continue;
      const col = columns[i];
      const ordered =
        targetSide === 'front' ? [...col.segments].reverse() : [...col.segments];
      let rem = baseDepthPerCol[i];
      let allowedDepth = 0;
      let inCrystalBlock = false;
      let crystalBlockStartDepth = 0;
      let crystalBlockAllowance = Infinity;

      for (const seg of ordered) {
        if (isBarrierSegment(seg) || rem <= 0) break;
        const segH = seg.yTop - seg.yBottom;
        const want = Math.min(rem, segH);

        if (!isCrystalMat(seg.materialId)) {
          inCrystalBlock = false;
          crystalBlockAllowance = Infinity;
          allowedDepth += want;
          rem -= want;
          continue;
        }

        if (!inCrystalBlock) {
          inCrystalBlock = true;
          crystalBlockStartDepth = allowedDepth;
          const crystalSurfY = targetSide === 'front' ? seg.yTop : seg.yBottom;

          let stepsLeft = 1;
          let leftMaskFound = false;
          while (i - stepsLeft >= 0) {
            const k = i - stepsLeft;
            if (!isColumnExposed[k]) {
              if (columns[k].segments.length > 0) {
                const kSurfY =
                  targetSide === 'front' ? getTopY(columns[k]) : getBottomY(columns[k]);
                if (
                  targetSide === 'front'
                    ? kSurfY >= crystalSurfY - 1
                    : kSurfY <= crystalSurfY + 1
                ) {
                  leftMaskFound = true;
                }
              }
              break;
            } else if (columns[k].segments.length > 0) {
              const kRawFloor = rawVerticalFloor[k];
              if (
                targetSide === 'front'
                  ? kRawFloor > crystalSurfY + 1
                  : kRawFloor < crystalSurfY - 1
              ) {
                leftMaskFound = true;
                break;
              }
            }
            stepsLeft++;
          }

          let stepsRight = 1;
          let rightMaskFound = false;
          while (i + stepsRight < columns.length) {
            const k = i + stepsRight;
            if (!isColumnExposed[k]) {
              if (columns[k].segments.length > 0) {
                const kSurfY =
                  targetSide === 'front' ? getTopY(columns[k]) : getBottomY(columns[k]);
                if (
                  targetSide === 'front'
                    ? kSurfY >= crystalSurfY - 1
                    : kSurfY <= crystalSurfY + 1
                ) {
                  rightMaskFound = true;
                }
              }
              break;
            } else if (columns[k].segments.length > 0) {
              const kRawFloor = rawVerticalFloor[k];
              if (
                targetSide === 'front'
                  ? kRawFloor > crystalSurfY + 1
                  : kRawFloor < crystalSurfY - 1
              ) {
                rightMaskFound = true;
                break;
              }
            }
            stepsRight++;
          }

          const distToLeftEdge = leftMaskFound ? (stepsLeft - 0.5) * dx : Infinity;
          const distToRightEdge = rightMaskFound ? (stepsRight - 0.5) * dx : Infinity;
          const nearestEdgeDist = Math.min(distToLeftEdge, distToRightEdge);

          if (Number.isFinite(nearestEdgeDist)) {
            const lateralUndercut = rem * Math.max(0, isotropy);
            crystalBlockAllowance = (nearestEdgeDist + lateralUndercut) * tanAngle;
          } else {
            crystalBlockAllowance = Infinity;
          }
        }

        const remAllowance = Math.max(
          0,
          crystalBlockAllowance - (allowedDepth - crystalBlockStartDepth)
        );
        const crystalCap = Math.min(want, remAllowance);
        allowedDepth += crystalCap;
        if (crystalCap < segH - 1e-4) {
          rem = 0;
          break;
        }
        rem -= crystalCap;
      }

      etchDepthPerCol[i] = allowedDepth;
    }
  }

  // Bosch DRIE sidewall scallops are modeled geometrically along the etched trench walls after step 5.

  // 3. Determine vertical etch reach per column before applying 2D lateral wavefront
  const verticalEtchFloor = new Float64Array(columns.length);
  for (let i = 0; i < columns.length; i++) {
    verticalEtchFloor[i] = computeVerticalReach(i, etchDepthPerCol[i]);
  }

  // 4. 2D Lateral Wavefront (Barrier-aware interval propagation for KOH & RIE/Wet)
  const finalFrontReachY = new Float64Array(columns.length);
  interface LateralReachWindow {
    winBot: number;
    winTop: number;
    reachY: number;
    kind: 'all' | 'crystal' | 'isotropic';
  }
  const colLateralWindows: (LateralReachWindow[] | undefined)[] = new Array(
    columns.length
  );

  for (let j = 0; j < columns.length; j++) {
    finalFrontReachY[j] = verticalEtchFloor[j];
  }

  const subtractBarrierInterval = (
    intervals: [number, number][],
    barBot: number,
    barTop: number
  ): [number, number][] => {
    if (barTop <= barBot || intervals.length === 0) return intervals;
    const next: [number, number][] = [];
    for (const [a, b] of intervals) {
      if (barTop <= a || barBot >= b) {
        next.push([a, b]);
      } else {
        if (a < barBot) next.push([a, barBot]);
        if (barTop < b) next.push([barTop, b]);
      }
    }
    return next;
  };

  const subtractColBarriers = (
    intervals: [number, number][],
    col: ColumnProfile
  ): [number, number][] => {
    let curr = intervals;
    for (const seg of col.segments) {
      if (curr.length === 0) break;
      if (isBarrierSegment(seg)) {
        curr = subtractBarrierInterval(curr, seg.yBottom, seg.yTop);
      }
    }
    return curr;
  };

  const mergeInterval = (
    intervals: [number, number][],
    addBot: number,
    addTop: number
  ): [number, number][] => {
    if (addTop <= addBot) return intervals;
    const combined = [...intervals, [addBot, addTop] as [number, number]].sort(
      (a, b) => a[0] - b[0]
    );
    const merged: [number, number][] = [combined[0]];
    for (let k = 1; k < combined.length; k++) {
      const prev = merged[merged.length - 1];
      const curr = combined[k];
      if (curr[0] <= prev[1] + 1e-4) {
        prev[1] = Math.max(prev[1], curr[1]);
      } else {
        merged.push(curr);
      }
    }
    return merged;
  };

  const addLateralWindow = (
    colIdx: number,
    winBot: number,
    winTop: number,
    reachY: number,
    kind: 'all' | 'crystal' | 'isotropic' = 'all'
  ) => {
    if (targetSide === 'front') {
      if (reachY >= winTop) return;
    } else {
      if (reachY <= winBot) return;
    }
    let list = colLateralWindows[colIdx];
    if (!list) {
      list = [];
      colLateralWindows[colIdx] = list;
    }
    for (const existing of list) {
      if (
        existing.kind === kind &&
        Math.abs(existing.winBot - winBot) < 1e-4 &&
        Math.abs(existing.winTop - winTop) < 1e-4
      ) {
        if (targetSide === 'front') {
          if (reachY < existing.reachY) existing.reachY = reachY;
        } else {
          if (reachY > existing.reachY) existing.reachY = reachY;
        }
        return;
      }
    }
    list.push({ winBot, winTop, reachY, kind });
  };

  if (isotropy > 0 && isCrystallographic) {
    const clampedAngle = Math.max(15, Math.min(89.5, sidewallAngle));
    const tanAngle = Math.tan((clampedAngle * Math.PI) / 180);

    for (let i = 0; i < columns.length; i++) {
      if (!isColumnExposed[i]) continue;
      const colI = columns[i];
      if (colI.segments.length === 0) continue;

      const yAirI = targetSide === 'front' ? getTopY(colI) : getBottomY(colI);
      let yCrystalAirI = yAirI;
      let localCrystalDepth = baseDepthPerCol[i];
      let maxReachedY = yAirI;

      const orderedSegsI =
        targetSide === 'front' ? [...colI.segments].reverse() : [...colI.segments];

      if (isKohEtch) {
        let rem = baseDepthPerCol[i];
        let foundCrystal = false;
        let crystalDepthAccum = 0;
        let lastCrystalReach = yAirI;
        for (const seg of orderedSegsI) {
          if (isBarrierSegment(seg) || rem <= 0) break;
          const h = seg.yTop - seg.yBottom;
          const used = Math.min(rem, h);
          if (!isCrystalMat(seg.materialId)) {
            if (foundCrystal) break;
            rem -= used;
            continue;
          }
          if (!foundCrystal) {
            foundCrystal = true;
            yCrystalAirI = targetSide === 'front' ? seg.yTop : seg.yBottom;
          }
          crystalDepthAccum += used;
          if (used >= h) {
            lastCrystalReach = targetSide === 'front' ? seg.yBottom : seg.yTop;
            rem -= h;
          } else {
            lastCrystalReach =
              targetSide === 'front' ? seg.yTop - used : seg.yBottom + used;
            rem = 0;
            break;
          }
        }
        if (!foundCrystal || crystalDepthAccum <= 0) continue;
        localCrystalDepth = crystalDepthAccum;
        maxReachedY = lastCrystalReach;
      } else {
        let rem = baseDepthPerCol[i];
        for (const seg of orderedSegsI) {
          if (isBarrierSegment(seg)) break;
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
      }

      const lateralUndercut = localCrystalDepth * isotropy;
      if (lateralUndercut <= 0) continue;
      const maxEtchableSpan = Math.abs(maxReachedY - yCrystalAirI);
      const winKind: 'all' | 'crystal' = isKohEtch ? 'crystal' : 'all';

      const isLeftMaskEdge = i > 0 && !isColumnExposed[i - 1];
      const isRightMaskEdge =
        i < columns.length - 1 && !isColumnExposed[i + 1];
      const colRadius = Math.ceil(lateralUndercut / dx + 0.5);

      // 4A. Mask undercut preserving crystallographic sidewallAngle (barrier-aware)
      if (isLeftMaskEdge) {
        const maskEdgeX = i * dx;
        let activeIntervals: [number, number][] =
          targetSide === 'front'
            ? [[maxReachedY, Infinity]]
            : [[-Infinity, maxReachedY]];
        activeIntervals = subtractColBarriers(activeIntervals, colI);

        for (let stepCols = 1; stepCols <= colRadius; stepCols++) {
          const j = i - stepCols;
          if (j < 0 || isColumnExposed[j] || activeIntervals.length === 0) break;
          const distUnderMask = maskEdgeX - columns[j].x;
          const remainingRun = lateralUndercut - distUnderMask;
          if (remainingRun <= 0) break;

          activeIntervals = subtractColBarriers(activeIntervals, columns[j]);
          if (activeIntervals.length === 0) break;

          const undercutDepth = Math.min(maxEtchableSpan, remainingRun * tanAngle);
          if (undercutDepth <= 0) continue;

          if (targetSide === 'front') {
            const rawTargetY = yCrystalAirI - undercutDepth;
            for (const [winBot, winTop] of activeIntervals) {
              const reachY = Math.max(winBot, rawTargetY);
              if (!isKohEtch && winTop === Infinity && reachY < finalFrontReachY[j]) {
                finalFrontReachY[j] = reachY;
              }
              addLateralWindow(j, winBot, winTop, reachY, winKind);
            }
          } else {
            const rawTargetY = yCrystalAirI + undercutDepth;
            for (const [winBot, winTop] of activeIntervals) {
              const reachY = Math.min(winTop, rawTargetY);
              if (!isKohEtch && winBot === -Infinity && reachY > finalFrontReachY[j]) {
                finalFrontReachY[j] = reachY;
              }
              addLateralWindow(j, winBot, winTop, reachY, winKind);
            }
          }
        }
      }

      if (isRightMaskEdge) {
        const maskEdgeX = (i + 1) * dx;
        let activeIntervals: [number, number][] =
          targetSide === 'front'
            ? [[maxReachedY, Infinity]]
            : [[-Infinity, maxReachedY]];
        activeIntervals = subtractColBarriers(activeIntervals, colI);

        for (let stepCols = 1; stepCols <= colRadius; stepCols++) {
          const j = i + stepCols;
          if (j >= columns.length || isColumnExposed[j] || activeIntervals.length === 0) break;
          const distUnderMask = columns[j].x - maskEdgeX;
          const remainingRun = lateralUndercut - distUnderMask;
          if (remainingRun <= 0) break;

          activeIntervals = subtractColBarriers(activeIntervals, columns[j]);
          if (activeIntervals.length === 0) break;

          const undercutDepth = Math.min(maxEtchableSpan, remainingRun * tanAngle);
          if (undercutDepth <= 0) continue;

          if (targetSide === 'front') {
            const rawTargetY = yCrystalAirI - undercutDepth;
            for (const [winBot, winTop] of activeIntervals) {
              const reachY = Math.max(winBot, rawTargetY);
              if (!isKohEtch && winTop === Infinity && reachY < finalFrontReachY[j]) {
                finalFrontReachY[j] = reachY;
              }
              addLateralWindow(j, winBot, winTop, reachY, winKind);
            }
          } else {
            const rawTargetY = yCrystalAirI + undercutDepth;
            for (const [winBot, winTop] of activeIntervals) {
              const reachY = Math.min(winTop, rawTargetY);
              if (!isKohEtch && winBot === -Infinity && reachY > finalFrontReachY[j]) {
                finalFrontReachY[j] = reachY;
              }
              addLateralWindow(j, winBot, winTop, reachY, winKind);
            }
          }
        }
      }

      // 4B. Open-topography sidewall recession at sidewallAngle
      const vReachI = verticalEtchFloor[i];
      for (const dir of [-1, 1] as const) {
        const wallEdgeX = dir === -1 ? i * dx : (i + 1) * dx;
        let activeIntervals: [number, number][] =
          targetSide === 'front'
            ? [[vReachI, Infinity]]
            : [[-Infinity, vReachI]];
        activeIntervals = subtractColBarriers(activeIntervals, colI);

        for (let stepCols = 1; stepCols <= colRadius; stepCols++) {
          const j = i + dir * stepCols;
          if (j < 0 || j >= columns.length || !isColumnExposed[j]) break;
          const yAirJ =
            targetSide === 'front' ? getTopY(columns[j]) : getBottomY(columns[j]);
          const standsTaller =
            targetSide === 'front' ? yAirJ > yCrystalAirI + 1 : yAirJ < yCrystalAirI - 1;
          if (!standsTaller) break;

          activeIntervals = subtractColBarriers(activeIntervals, columns[j]);
          if (activeIntervals.length === 0) break;

          const distIntoWall = Math.abs(columns[j].x - wallEdgeX);
          const remainingRun = lateralUndercut - distIntoWall;
          if (remainingRun <= 0) break;

          const extraDrop = remainingRun * tanAngle;
          if (targetSide === 'front') {
            const rawTargetY = Math.max(vReachI, verticalEtchFloor[j] - extraDrop);
            const topOpen = activeIntervals.find((iv) => iv[1] === Infinity);
            if (topOpen) {
              const targetY = Math.max(topOpen[0], rawTargetY);
              if (isKohEtch) {
                addLateralWindow(j, topOpen[0], Infinity, targetY, 'crystal');
              } else if (targetY < finalFrontReachY[j]) {
                finalFrontReachY[j] = targetY;
              }
            }
          } else {
            const rawTargetY = Math.min(vReachI, verticalEtchFloor[j] + extraDrop);
            const botOpen = activeIntervals.find((iv) => iv[0] === -Infinity);
            if (botOpen) {
              const targetY = Math.min(botOpen[1], rawTargetY);
              if (isKohEtch) {
                addLateralWindow(j, -Infinity, botOpen[1], targetY, 'crystal');
              } else if (targetY > finalFrontReachY[j]) {
                finalFrontReachY[j] = targetY;
              }
            }
          }
        }
      }
    }
  }

  // Non-crystalline materials in KOH/TMAH (e.g., poly-Si, Al, SiO2, quartz) still etch isotropically
  if (isKohEtch) {
    let maxIsoRadiusAll = 0;
    if (!activeRecipe) {
      maxIsoRadiusAll = refDepthForScale;
    } else {
      const seenNonCrystalMats = new Set<string>();
      for (const col of columns) {
        for (const seg of col.segments) {
          if (isBarrierSegment(seg) || isCrystalMat(seg.materialId)) continue;
          if (seenNonCrystalMats.has(seg.materialId)) continue;
          seenNonCrystalMats.add(seg.materialId);
          const r = getEtchRateNmMin(activeRecipe, seg.materialId) * etchTimeMin;
          if (r > maxIsoRadiusAll) maxIsoRadiusAll = r;
        }
      }
      if (cfg?.convexCornerEffect && maxBaseDepth > maxIsoRadiusAll) {
        maxIsoRadiusAll = maxBaseDepth;
      }
    }

    if (maxIsoRadiusAll > 0) {
      const globalColRadius = Math.min(
        columns.length,
        Math.ceil(maxIsoRadiusAll / dx + 0.5)
      );

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
        const maxIsoI = !activeRecipe
          ? baseDepthPerCol[i] > 0
            ? baseDepthPerCol[i]
            : refDepthForScale
          : maxIsoRadiusAll;
        if (maxIsoI <= 0) continue;

        let baseIntervals: [number, number][] =
          targetSide === 'front'
            ? [[vReachI, Infinity]]
            : [[-Infinity, vReachI]];
        baseIntervals = subtractColBarriers(baseIntervals, colI);
        if (baseIntervals.length === 0) continue;

        const colRadiusI = Math.min(
          globalColRadius,
          Math.ceil(maxIsoI / dx + 0.5)
        );

        for (const dir of [-1, 1] as const) {
          let activeIntervals = baseIntervals;

          for (let stepCols = 1; stepCols <= colRadiusI; stepCols++) {
            const j = i + dir * stepCols;
            if (j < 0 || j >= columns.length) break;
            const distX = (stepCols - 0.5) * dx;
            if (distX > maxIsoI) break;

            activeIntervals = subtractColBarriers(activeIntervals, columns[j]);
            // Solid unetched crystal silicon blocks lateral isotropic attack behind it
            for (const seg of columns[j].segments) {
              if (!isCrystalMat(seg.materialId)) continue;
              if (targetSide === 'front') {
                const solidTop = Math.min(seg.yTop, verticalEtchFloor[j]);
                if (solidTop > seg.yBottom) {
                  activeIntervals = subtractBarrierInterval(
                    activeIntervals,
                    seg.yBottom,
                    solidTop
                  );
                }
              } else {
                const solidBot = Math.max(seg.yBottom, verticalEtchFloor[j]);
                if (seg.yTop > solidBot) {
                  activeIntervals = subtractBarrierInterval(
                    activeIntervals,
                    solidBot,
                    seg.yTop
                  );
                }
              }
              if (activeIntervals.length === 0) break;
            }
            if (activeIntervals.length === 0) break;

            for (const seg of columns[j].segments) {
              if (isBarrierSegment(seg) || isCrystalMat(seg.materialId)) continue;

              const rawMatR = activeRecipe
                ? getEtchRateNmMin(activeRecipe, seg.materialId) * etchTimeMin
                : baseDepthPerCol[i] > 0
                ? baseDepthPerCol[i]
                : refDepthForScale;
              let matR = rawMatR;
              if (activeRecipe && cfg?.convexCornerEffect) {
                const surfSeg =
                  targetSide === 'front'
                    ? colI.segments[colI.segments.length - 1]
                    : colI.segments[0];
                if (
                  surfSeg &&
                  surfSeg.materialId === seg.materialId &&
                  baseDepthPerCol[i] > rawMatR
                ) {
                  matR = baseDepthPerCol[i];
                }
              }
              if (matR <= 0 || distX > matR) continue;

              const normX = distX / matR;
              const curveDrop = matR * Math.sqrt(Math.max(0, 1 - normX * normX));

              for (const [ivBot, ivTop] of activeIntervals) {
                const ovBot = Math.max(seg.yBottom, ivBot);
                const ovTop = Math.min(seg.yTop, ivTop);
                if (ovTop <= ovBot) continue;

                if (targetSide === 'front') {
                  if (ovBot >= yAirI) {
                    addLateralWindow(j, ovBot, ovTop, ovBot, 'isotropic');
                  } else if (vReachI < yAirI) {
                    const entryY = Math.min(yAirI, ovTop);
                    const rawY = Math.max(ovBot, vReachI, entryY - curveDrop);
                    if (rawY < ovTop) {
                      addLateralWindow(j, ovBot, ovTop, rawY, 'isotropic');
                    }
                  }
                } else {
                  if (ovTop <= yAirI) {
                    addLateralWindow(j, ovBot, ovTop, ovTop, 'isotropic');
                  } else if (vReachI > yAirI) {
                    const entryY = Math.max(yAirI, ovBot);
                    const rawY = Math.min(ovTop, vReachI, entryY + curveDrop);
                    if (rawY > ovBot) {
                      addLateralWindow(j, ovBot, ovTop, rawY, 'isotropic');
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  const boschPendingWalls: ScallopWall[] = [];

  if (isBoschDrie) {
    // Unified Physics-Based Bosch DRIE Solver:
    // Combines cyclic C4F8 passivation protection, SF6 mask undercut, ion/passivation sidewall taper
    // (80° positive taper w/ V-pinch-off, 90° vertical, >90° re-entrant), hardmask selectivity,
    // and Knudsen ARDE pitch/scallop attenuation into one self-consistent column + wall solution.
    const shouldEmitScallops = Boolean(cfg?.scallopEffect);
    const rawScallopDepth = shouldEmitScallops
      ? Math.max(5, Math.min(300, cfg?.scallopDepth ?? 45))
      : 0;
    const rawScallopPitch = Math.max(20, Math.min(1000, cfg?.scallopPitch ?? 200));
    const isBoschPosTaper = sidewallAngle < 89.5;
    const isBoschReentrant = sidewallAngle > 90.5;
    const tanPosAngle = isBoschPosTaper
      ? Math.tan((Math.max(15, sidewallAngle) * Math.PI) / 180)
      : Infinity;
    const tanReentrantOverhang = isBoschReentrant
      ? Math.tan(((Math.min(135, sidewallAngle) - 90) * Math.PI) / 180)
      : 0;
    const kKn = cfg?.ardeEnabled ? Math.max(0.05, cfg?.ardeStrength ?? 0.5) : 0;

    const hasFastEtchableInSpan = (
      col: ColumnProfile,
      spanBot: number,
      spanTop: number
    ): boolean => {
      for (const seg of col.segments) {
        if (Math.min(seg.yTop, spanTop) <= Math.max(seg.yBottom, spanBot) + 1) continue;
        if (isBarrierSegment(seg)) continue;
        if (activeRecipe && maxExposedFastRate > 0) {
          if (getEtchRateNmMin(activeRecipe, seg.materialId) < 0.2 * maxExposedFastRate) {
            continue;
          }
        }
        return true;
      }
      return false;
    };

    const getFastEtchableIntervals = (
      col: ColumnProfile,
      spanBot: number,
      spanTop: number
    ): [number, number][] => {
      let ivs: [number, number][] = [[spanBot, spanTop]];
      for (const seg of col.segments) {
        if (ivs.length === 0) break;
        const isFastTarget =
          !isBarrierSegment(seg) &&
          (!activeRecipe ||
            maxExposedFastRate <= 0 ||
            getEtchRateNmMin(activeRecipe, seg.materialId) >= 0.2 * maxExposedFastRate);
        if (!isFastTarget) {
          ivs = subtractBarrierInterval(ivs, seg.yBottom, seg.yTop);
        }
      }
      return ivs;
    };

    let idx = 0;
    while (idx < columns.length) {
      if (isMaskShoulderCol(idx)) {
        idx++;
        continue;
      }
      const runStart = idx;
      while (idx < columns.length && !isMaskShoulderCol(idx)) {
        idx++;
      }
      const runEnd = idx - 1;
      if (runStart === 0 && runEnd === columns.length - 1) continue;

      const xMaskLeft = runStart * dx;
      const xMaskRight = (runEnd + 1) * dx;
      const lagRatioOp = colArdeLagRatio[runStart];
      const arOp = colLocalAR[runStart];
      const localPitch = Math.max(5, rawScallopPitch * lagRatioOp);
      const knScallopBotFactor = cfg?.ardeEnabled ? 1 / (1 + 0.55 * kKn * arOp) : 1;

      // Left boundary metrics
      const hasLeftShoulder =
        runStart > 0 &&
        columns[runStart - 1].segments.length > 0 &&
        isMaskShoulderCol(runStart - 1);
      const yEntryL =
        targetSide === 'front'
          ? getTopY(columns[runStart])
          : getBottomY(columns[runStart]);
      const yFloorL = verticalEtchFloor[runStart];
      const shoulderFloorL = hasLeftShoulder
        ? verticalEtchFloor[runStart - 1]
        : yEntryL;
      const yTopL =
        targetSide === 'front'
          ? Math.min(yEntryL, shoulderFloorL)
          : Math.max(yEntryL, shoulderFloorL);
      const wallHeightL =
        targetSide === 'front' ? yTopL - yFloorL : yFloorL - yTopL;
      const shoulderTallerL =
        hasLeftShoulder &&
        (targetSide === 'front'
          ? shoulderFloorL > yFloorL + 10
          : shoulderFloorL < yFloorL - 10);

      // Right boundary metrics
      const hasRightShoulder =
        runEnd < columns.length - 1 &&
        columns[runEnd + 1].segments.length > 0 &&
        isMaskShoulderCol(runEnd + 1);
      const yEntryR =
        targetSide === 'front' ? getTopY(columns[runEnd]) : getBottomY(columns[runEnd]);
      const yFloorR = verticalEtchFloor[runEnd];
      const shoulderFloorR = hasRightShoulder
        ? verticalEtchFloor[runEnd + 1]
        : yEntryR;
      const yTopR =
        targetSide === 'front'
          ? Math.min(yEntryR, shoulderFloorR)
          : Math.max(yEntryR, shoulderFloorR);
      const wallHeightR =
        targetSide === 'front' ? yTopR - yFloorR : yFloorR - yTopR;
      const shoulderTallerR =
        hasRightShoulder &&
        (targetSide === 'front'
          ? shoulderFloorR > yFloorR + 10
          : shoulderFloorR < yFloorR - 10);

      const leftActive =
        hasLeftShoulder &&
        shoulderTallerL &&
        Number.isFinite(wallHeightL) &&
        wallHeightL > 10;
      const rightActive =
        hasRightShoulder &&
        shoulderTallerR &&
        Number.isFinite(wallHeightR) &&
        wallHeightR > 10;

      if (!leftActive && !rightActive) continue;

      // Measure solid etchable silicon shoulder widths to prevent pillar self-intersection
      let budgetWidthL = 0;
      let leftEtchable = false;
      if (leftActive) {
        const spanMinL = Math.min(yTopL, yFloorL);
        const spanMaxL = Math.max(yTopL, yFloorL);
        leftEtchable = hasFastEtchableInSpan(columns[runStart - 1], spanMinL, spanMaxL);
        let solidLeftCols = 0;
        let k = runStart - 1;
        for (; k >= 0; k--) {
          if (
            !isMaskShoulderCol(k) ||
            columns[k].segments.length === 0 ||
            !hasFastEtchableInSpan(columns[k], spanMinL, spanMaxL)
          ) {
            break;
          }
          solidLeftCols++;
        }
        const oppositeIsTrench =
          k >= 0 && (!isMaskShoulderCol(k) || columns[k].segments.length === 0);
        budgetWidthL = solidLeftCols * dx * (oppositeIsTrench ? 0.48 : 0.92);
      }

      let budgetWidthR = 0;
      let rightEtchable = false;
      if (rightActive) {
        const spanMinR = Math.min(yTopR, yFloorR);
        const spanMaxR = Math.max(yTopR, yFloorR);
        rightEtchable = hasFastEtchableInSpan(columns[runEnd + 1], spanMinR, spanMaxR);
        let solidRightCols = 0;
        let k = runEnd + 1;
        for (; k < columns.length; k++) {
          if (
            !isMaskShoulderCol(k) ||
            columns[k].segments.length === 0 ||
            !hasFastEtchableInSpan(columns[k], spanMinR, spanMaxR)
          ) {
            break;
          }
          solidRightCols++;
        }
        const oppositeIsTrench =
          k < columns.length &&
          (!isMaskShoulderCol(k) || columns[k].segments.length === 0);
        budgetWidthR = solidRightCols * dx * (oppositeIsTrench ? 0.48 : 0.92);
      }

      // Compute mask undercut (U_mask) & endpoint coordinates (xTop, xBot, yBot)
      let xTopL = xMaskLeft;
      let xBotL = xMaskLeft;
      let yBotL = yFloorL;
      let uMaskL = 0;
      let safeDepthL = 0;
      let safeBotDepthL = 0;

      if (leftActive) {
        safeDepthL = shouldEmitScallops
          ? Math.min(rawScallopDepth, budgetWidthL * 0.35, wallHeightL * 0.5)
          : 0;
        safeBotDepthL = safeDepthL * knScallopBotFactor;
        const effIsoDepthL = Math.max(
          wallHeightL,
          Math.min(baseDepthPerCol[runStart] || refDepthForScale, wallHeightL * 2.5)
        );
        uMaskL = leftEtchable
          ? Math.min(budgetWidthL * 0.45, effIsoDepthL * Math.max(0, isotropy))
          : 0;
        xTopL = xMaskLeft - uMaskL;

        if (isBoschReentrant) {
          const maxAvailL = leftEtchable
            ? Math.max(0, budgetWidthL - uMaskL - safeDepthL - dx * 0.1)
            : 0;
          xBotL = xTopL - Math.min(maxAvailL, wallHeightL * tanReentrantOverhang);
        } else if (isBoschPosTaper) {
          xBotL = Math.min(totalWidth, xTopL + wallHeightL / tanPosAngle);
        } else {
          xBotL = xTopL;
        }
      }

      let xTopR = xMaskRight;
      let xBotR = xMaskRight;
      let yBotR = yFloorR;
      let uMaskR = 0;
      let safeDepthR = 0;
      let safeBotDepthR = 0;

      if (rightActive) {
        safeDepthR = shouldEmitScallops
          ? Math.min(rawScallopDepth, budgetWidthR * 0.35, wallHeightR * 0.5)
          : 0;
        safeBotDepthR = safeDepthR * knScallopBotFactor;
        const effIsoDepthR = Math.max(
          wallHeightR,
          Math.min(baseDepthPerCol[runEnd] || refDepthForScale, wallHeightR * 2.5)
        );
        uMaskR = rightEtchable
          ? Math.min(budgetWidthR * 0.45, effIsoDepthR * Math.max(0, isotropy))
          : 0;
        xTopR = xMaskRight + uMaskR;

        if (isBoschReentrant) {
          const maxAvailR = rightEtchable
            ? Math.max(0, budgetWidthR - uMaskR - safeDepthR - dx * 0.1)
            : 0;
          xBotR = xTopR + Math.min(maxAvailR, wallHeightR * tanReentrantOverhang);
        } else if (isBoschPosTaper) {
          xBotR = Math.max(0, xTopR - wallHeightR / tanPosAngle);
        } else {
          xBotR = xTopR;
        }
      }

      // Check narrow-trench V-pinch-off when opposite positive-taper walls intersect
      if (isBoschPosTaper && leftActive && rightActive && xBotL > xBotR) {
        const signY = targetSide === 'front' ? -1 : 1;
        const xPinchRaw =
          (xTopL + xTopR) * 0.5 +
          (signY === -1 ? yTopL - yTopR : yTopR - yTopL) / (2 * tanPosAngle);
        const xPinch = Math.max(xTopL, Math.min(xTopR, xPinchRaw));
        const yPinch = yTopL + signY * (xPinch - xTopL) * tanPosAngle;
        xBotL = xPinch;
        xBotR = xPinch;
        yBotL = yPinch;
        yBotR = yPinch;
        if (shouldEmitScallops) {
          const actualH = Math.abs(yPinch - yTopL);
          safeDepthL = Math.min(safeDepthL, actualH * 0.5);
          safeBotDepthL = safeDepthL * knScallopBotFactor;
          safeDepthR = Math.min(safeDepthR, actualH * 0.5);
          safeBotDepthR = safeDepthR * knScallopBotFactor;
        }
      }

      // Carve coherent mask-undercut & re-entrant wedge windows into columns[j] beneath overhanging masks
      if (leftActive && (uMaskL > 0 || (isBoschReentrant && xBotL < xTopL - 1e-6))) {
        const spanMinL = Math.min(yTopL, yBotL);
        const spanMaxL = Math.max(yTopL, yBotL);
        const minEdgeL = Math.min(xTopL, xBotL);
        for (let j = runStart - 1; j >= 0; j--) {
          if (columns[j].x < minEdgeL - 1e-6) break;
          if (!isMaskShoulderCol(j) || columns[j].segments.length === 0) break;
          if (columns[j].x >= xTopL - 1e-6) {
            const cutReach =
              isBoschPosTaper && columns[j].x < xBotL
                ? targetSide === 'front'
                  ? yTopL - (columns[j].x - xTopL) * tanPosAngle
                  : yTopL + (columns[j].x - xTopL) * tanPosAngle
                : yBotL;
            const ivs = getFastEtchableIntervals(columns[j], spanMinL, spanMaxL);
            for (const [winBot, winTop] of ivs) {
              addLateralWindow(j, winBot, winTop, cutReach);
            }
          } else if (isBoschReentrant && xBotL < xTopL - 1e-6) {
            const frac = (xTopL - columns[j].x) / (xTopL - xBotL);
            const yWallJ = yTopL + frac * (yBotL - yTopL);
            if (targetSide === 'front') {
              const ivs = getFastEtchableIntervals(columns[j], yBotL, yWallJ);
              for (const [winBot, winTop] of ivs) {
                addLateralWindow(j, winBot, winTop, winBot);
              }
            } else {
              const ivs = getFastEtchableIntervals(columns[j], yWallJ, yBotL);
              for (const [winBot, winTop] of ivs) {
                addLateralWindow(j, winBot, winTop, winTop);
              }
            }
          }
        }
      }

      if (rightActive && (uMaskR > 0 || (isBoschReentrant && xBotR > xTopR + 1e-6))) {
        const spanMinR = Math.min(yTopR, yBotR);
        const spanMaxR = Math.max(yTopR, yBotR);
        const maxEdgeR = Math.max(xTopR, xBotR);
        for (let j = runEnd + 1; j < columns.length; j++) {
          if (columns[j].x > maxEdgeR + 1e-6) break;
          if (!isMaskShoulderCol(j) || columns[j].segments.length === 0) break;
          if (columns[j].x <= xTopR + 1e-6) {
            const cutReach =
              isBoschPosTaper && columns[j].x > xBotR
                ? targetSide === 'front'
                  ? yTopR - (xTopR - columns[j].x) * tanPosAngle
                  : yTopR + (xTopR - columns[j].x) * tanPosAngle
                : yBotR;
            const ivs = getFastEtchableIntervals(columns[j], spanMinR, spanMaxR);
            for (const [winBot, winTop] of ivs) {
              addLateralWindow(j, winBot, winTop, cutReach);
            }
          } else if (isBoschReentrant && xBotR > xTopR + 1e-6) {
            const frac = (columns[j].x - xTopR) / (xBotR - xTopR);
            const yWallJ = yTopR + frac * (yBotR - yTopR);
            if (targetSide === 'front') {
              const ivs = getFastEtchableIntervals(columns[j], yBotR, yWallJ);
              for (const [winBot, winTop] of ivs) {
                addLateralWindow(j, winBot, winTop, winBot);
              }
            } else {
              const ivs = getFastEtchableIntervals(columns[j], yWallJ, yBotR);
              for (const [winBot, winTop] of ivs) {
                addLateralWindow(j, winBot, winTop, winTop);
              }
            }
          }
        }
      }

      // Apply positive-taper wall slope cleanly onto exposed trench columns [runStart .. runEnd]
      if (isBoschPosTaper) {
        for (let j = runStart; j <= runEnd; j++) {
          const xj = columns[j].x;
          let reach = finalFrontReachY[j];
          if (leftActive && xj < xBotL) {
            const yL =
              targetSide === 'front'
                ? yTopL - (xj - xTopL) * tanPosAngle
                : yTopL + (xj - xTopL) * tanPosAngle;
            reach = targetSide === 'front' ? Math.max(reach, yL) : Math.min(reach, yL);
          }
          if (rightActive && xj > xBotR) {
            const yR =
              targetSide === 'front'
                ? yTopR - (xTopR - xj) * tanPosAngle
                : yTopR + (xTopR - xj) * tanPosAngle;
            reach = targetSide === 'front' ? Math.max(reach, yR) : Math.min(reach, yR);
          }
          finalFrontReachY[j] = reach;
        }
      }

      // Compute exact colTop / colBot indices consistent with columns[] for ScallopWall rendering
      let colBotL = runStart;
      if (leftActive) {
        let colTopL = runStart - 1;
        while (colTopL > 0 && columns[colTopL].x >= xTopL - 1e-6) {
          colTopL--;
        }
        if (xBotL <= xTopL + 1e-6) {
          colBotL = Math.min(runEnd, colTopL + 1);
        } else {
          colBotL = colTopL + 1;
          while (colBotL < runEnd && columns[colBotL].x < xBotL - 1e-6) {
            colBotL++;
          }
        }
        if (
          Math.abs(yBotL - yTopL) > 10 &&
          (safeDepthL > 0.5 ||
            Math.abs(xTopL - xBotL) > 0.5 ||
            uMaskL > 0.5 ||
            (!isBoschPosTaper && !isBoschReentrant))
        ) {
          boschPendingWalls.push({
            stepId: step.id,
            targetSide,
            wallSide: 'left',
            colTop: colTopL,
            colBot: colBotL,
            xTop: xTopL,
            xBot: xBotL,
            yTop: yTopL,
            yBot: yBotL,
            scallopDepth: safeDepthL,
            scallopBottomDepth: safeBotDepthL,
            scallopPitch: localPitch,
            isReentrant: isBoschReentrant && Math.abs(xTopL - xBotL) > 0.5,
          });
        }
      }

      if (rightActive) {
        let colTopR = runEnd + 1;
        while (colTopR < columns.length - 1 && columns[colTopR].x <= xTopR + 1e-6) {
          colTopR++;
        }
        let colBotR = runEnd;
        if (xBotR >= xTopR - 1e-6) {
          colBotR = Math.max(runStart, colTopR - 1);
        } else {
          colBotR = colTopR - 1;
          while (colBotR > runStart && columns[colBotR].x > xBotR + 1e-6) {
            colBotR--;
          }
          if (leftActive && colBotR < colBotL) {
            colBotR = colBotL;
          }
        }
        if (
          Math.abs(yBotR - yTopR) > 10 &&
          (safeDepthR > 0.5 ||
            Math.abs(xTopR - xBotR) > 0.5 ||
            uMaskR > 0.5 ||
            (!isBoschPosTaper && !isBoschReentrant))
        ) {
          boschPendingWalls.push({
            stepId: step.id,
            targetSide,
            wallSide: 'right',
            colTop: colTopR,
            colBot: colBotR,
            xTop: xTopR,
            xBot: xBotR,
            yTop: yTopR,
            yBot: yBotR,
            scallopDepth: safeDepthR,
            scallopBottomDepth: safeBotDepthR,
            scallopPitch: localPitch,
            isReentrant: isBoschReentrant && Math.abs(xTopR - xBotR) > 0.5,
          });
        }
      }
    }
  } else if (isotropy > 0 && !isReentrant && !isCrystallographic) {
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
      const effectiveRz = localRz > 0 ? localRz : refDepthForScale;
      const effectiveRx = effectiveRz * isotropy;
      if (effectiveRx <= 0) continue;

      const colRadius = Math.ceil(effectiveRx / dx + 0.5);
      let baseIntervals: [number, number][] =
        targetSide === 'front'
          ? [[vReachI, Infinity]]
          : [[-Infinity, vReachI]];
      baseIntervals = subtractColBarriers(baseIntervals, colI);
      if (baseIntervals.length === 0) continue;

      for (const dir of [-1, 1] as const) {
        let activeIntervals = baseIntervals;

        for (let stepCols = 1; stepCols <= colRadius; stepCols++) {
          const j = i + dir * stepCols;
          if (j < 0 || j >= columns.length) break;
          const distX = (stepCols - 0.5) * dx;
          if (distX > effectiveRx) break;

          activeIntervals = subtractColBarriers(activeIntervals, columns[j]);
          // Protect slow-rate hardmask segments in neighbor columns from fast-layer lateral blowout
          if (activeRecipe && colSurfaceRate[i] > 0) {
            for (const seg of columns[j].segments) {
              if (isBarrierSegment(seg)) continue;
              if (getEtchRateNmMin(activeRecipe, seg.materialId) < 0.25 * colSurfaceRate[i]) {
                activeIntervals = subtractBarrierInterval(
                  activeIntervals,
                  seg.yBottom,
                  seg.yTop
                );
              }
            }
          }
          if (activeIntervals.length === 0) break;

          const normX = distX / effectiveRx;
          const curveDrop =
            effectiveRz * Math.sqrt(Math.max(0, 1 - normX * normX));

          if (targetSide === 'front') {
            const rawCurvedY =
              vReachI < yAirI
                ? Math.max(vReachI, yAirI - curveDrop)
                : yAirI;
            // Expand along any contiguous etchable segment already reached by the wavefront
            // (e.g., top poly rising slightly beneath a sloped mask ceiling) without crossing barriers.
            if (vReachI < yAirI) {
              const upperCurveY = yAirI + curveDrop;
              for (const seg of columns[j].segments) {
                if (isBarrierSegment(seg)) continue;
                if (
                  activeRecipe &&
                  colSurfaceRate[i] > 0 &&
                  getEtchRateNmMin(activeRecipe, seg.materialId) < 0.25 * colSurfaceRate[i]
                ) {
                  continue;
                }
                const overlapsReached = activeIntervals.some(([a, b]) => {
                  const ovBot = Math.max(seg.yBottom, a);
                  const ovTop = Math.min(seg.yTop, b);
                  return ovTop > ovBot && rawCurvedY < ovTop;
                });
                if (overlapsReached) {
                  const expandTop = Math.min(seg.yTop, upperCurveY);
                  const expandBot = Math.max(seg.yBottom, rawCurvedY);
                  activeIntervals = mergeInterval(activeIntervals, expandBot, expandTop);
                }
              }
            }
            for (const [winBot, winTop] of activeIntervals) {
              const reachY = Math.max(winBot, rawCurvedY);
              if (winTop === Infinity && reachY < finalFrontReachY[j]) {
                finalFrontReachY[j] = reachY;
              }
              addLateralWindow(j, winBot, winTop, reachY);
            }
          } else {
            const rawCurvedY =
              vReachI > yAirI
                ? Math.min(vReachI, yAirI + curveDrop)
                : yAirI;
            if (vReachI > yAirI) {
              const lowerCurveY = yAirI - curveDrop;
              for (const seg of columns[j].segments) {
                if (isBarrierSegment(seg)) continue;
                if (
                  activeRecipe &&
                  colSurfaceRate[i] > 0 &&
                  getEtchRateNmMin(activeRecipe, seg.materialId) < 0.25 * colSurfaceRate[i]
                ) {
                  continue;
                }
                const overlapsReached = activeIntervals.some(([a, b]) => {
                  const ovBot = Math.max(seg.yBottom, a);
                  const ovTop = Math.min(seg.yTop, b);
                  return ovTop > ovBot && rawCurvedY > ovBot;
                });
                if (overlapsReached) {
                  const expandBot = Math.max(seg.yBottom, lowerCurveY);
                  const expandTop = Math.min(seg.yTop, rawCurvedY);
                  activeIntervals = mergeInterval(activeIntervals, expandBot, expandTop);
                }
              }
            }
            for (const [winBot, winTop] of activeIntervals) {
              const reachY = Math.min(winTop, rawCurvedY);
              if (winBot === -Infinity && reachY > finalFrontReachY[j]) {
                finalFrontReachY[j] = reachY;
              }
              addLateralWindow(j, winBot, winTop, reachY);
            }
          }
        }
      }
    }
  }

  // Snapshot protected resist columns BEFORE Step 5 so burn-through never double-subtracts lateral undercut
  const preMaskSegments: (MaterialSegment[] | undefined)[] = new Array(columns.length);
  if (linkedRecipe && maskEtchTimeMin > 0) {
    for (let j = 0; j < columns.length; j++) {
      if (wasProtectedResistCol[j]) {
        preMaskSegments[j] = columns[j].segments.map((s) => ({ ...s }));
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
    const latWindows = colLateralWindows[j];
    const hasLatWindows = latWindows !== undefined && latWindows.length > 0;
    const surfaceY = targetSide === 'front' ? getTopY(col) : getBottomY(col);

    if (
      targetSide === 'front' &&
      targetReach >= surfaceY &&
      !hasLatWindows
    ) {
      continue;
    }
    if (
      targetSide === 'back' &&
      targetReach <= surfaceY &&
      !hasLatWindows
    ) {
      continue;
    }

    const orderedSegments =
      targetSide === 'front' ? [...col.segments].reverse() : [...col.segments];
    const processedSegments: MaterialSegment[] = [];
    let blockedBelow = false;

    for (const seg of orderedSegments) {
      const mat = getMaterialById(materials, seg.materialId);

      // Protect photoresist mask unless O2 plasma ashing or explicitly targeting resist
      if (
        mat.category === 'photoresist' &&
        cfg?.etchType !== 'ashing' &&
        targetMatId !== seg.materialId
      ) {
        blockedBelow = true;
        processedSegments.push(seg);
        continue;
      }

      if (stopLayerId && seg.materialId === stopLayerId) {
        blockedBelow = true;
        processedSegments.push(seg);
        continue;
      }

      if (activeRecipe && getEtchRateNmMin(activeRecipe, seg.materialId) <= 0) {
        blockedBelow = true;
        processedSegments.push(seg);
        continue;
      }

      if (targetMatId !== 'all' && seg.materialId !== targetMatId) {
        blockedBelow = true;
        processedSegments.push(seg);
        continue;
      }

      if (blockedBelow || isKohEtch || hasLatWindows) {
        // Check lateral wavefront windows (filtered by crystal vs isotropic kind in wet-koh)
        // plus vertical reach when not vertically blocked.
        const segKind: 'crystal' | 'isotropic' = isCrystalMat(seg.materialId)
          ? 'crystal'
          : 'isotropic';
        let keptPieces: [number, number][] = [[seg.yBottom, seg.yTop]];

        if (!blockedBelow) {
          const verticalReach = targetReach;
          if (targetSide === 'front') {
            if (verticalReach < seg.yTop) {
              const cutBot = Math.max(seg.yBottom, verticalReach);
              keptPieces = subtractBarrierInterval(keptPieces, cutBot, seg.yTop);
              if (verticalReach > seg.yBottom + 0.5) {
                blockedBelow = true;
              }
            } else {
              blockedBelow = true;
            }
          } else {
            if (verticalReach > seg.yBottom) {
              const cutTop = Math.min(seg.yTop, verticalReach);
              keptPieces = subtractBarrierInterval(keptPieces, seg.yBottom, cutTop);
              if (verticalReach < seg.yTop - 0.5) {
                blockedBelow = true;
              }
            } else {
              blockedBelow = true;
            }
          }
        }

        if (hasLatWindows && latWindows && keptPieces.length > 0) {
          for (const w of latWindows) {
            if (w.kind !== 'all' && w.kind !== segKind) continue;
            if (w.winBot >= seg.yTop || w.winTop <= seg.yBottom) continue;
            const cutBot =
              targetSide === 'front' ? Math.max(w.winBot, w.reachY) : w.winBot;
            const cutTop =
              targetSide === 'front' ? w.winTop : Math.min(w.winTop, w.reachY);
            if (cutTop > cutBot) {
              keptPieces = subtractBarrierInterval(keptPieces, cutBot, cutTop);
              if (keptPieces.length === 0) break;
            }
          }
        }

        const origH = seg.yTop - seg.yBottom;
        const keptH = keptPieces.reduce((sum, [a, b]) => sum + Math.max(0, b - a), 0);
        const removed = origH - keptH;
        if (removed > 0.5) {
          etchedDelta[j] += removed;
          if (targetSide === 'front') {
            if (Number.isNaN(etchedTopY[j])) etchedTopY[j] = seg.yTop;
            const lowestTop =
              keptPieces.length > 0
                ? keptPieces[keptPieces.length - 1][1]
                : seg.yBottom;
            etchedFloorY[j] = Math.max(seg.yBottom, lowestTop);
          } else {
            if (Number.isNaN(etchedTopY[j])) etchedTopY[j] = seg.yBottom;
            const highestBot =
              keptPieces.length > 0 ? keptPieces[0][0] : seg.yTop;
            etchedFloorY[j] = Math.min(seg.yTop, highestBot);
          }
        }

        const orderedPieces =
          targetSide === 'front' ? [...keptPieces].reverse() : keptPieces;
        for (const [pBot, pTop] of orderedPieces) {
          if (pTop - pBot > 0.5) {
            processedSegments.push({
              ...seg,
              yBottom: pBot,
              yTop: pTop,
            });
          }
        }
        continue;
      }

      const effectiveReach = targetReach;

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

  // Invalidate any stale pre-existing scallop/re-entrant walls whose shoulder was etched/re-shaped
  if (scallopWalls && scallopWalls.length > 0) {
    for (let wIdx = scallopWalls.length - 1; wIdx >= 0; wIdx--) {
      const w = scallopWalls[wIdx];
      if (w.targetSide !== targetSide) continue;
      const shoulderCol = columns[w.colTop];
      if (!shoulderCol || shoulderCol.segments.length === 0 || etchedDelta[w.colTop] > 5) {
        scallopWalls.splice(wIdx, 1);
      } else {
        const surf = targetSide === 'front' ? getTopY(shoulderCol) : getBottomY(shoulderCol);
        if (targetSide === 'front' ? surf <= w.yBot + 10 : surf >= w.yBot - 10) {
          scallopWalls.splice(wIdx, 1);
        }
      }
    }
  }

  // 6. Photoresist mask consumption (and burn-through clamping before sidewall wall generation)
  if (linkedRecipe && maskEtchTimeMin > 0) {
    const burnedThroughCols = applyPhotoresistMaskConsumption(
      columns,
      wasProtectedResistCol,
      materials,
      linkedRecipe,
      maskEtchTimeMin,
      targetSide,
      targetMatId,
      stopLayerId,
      preMaskSegments
    );

    // If a mask burned completely through and lowered its substrate, ensure adjacent exposed
    // tapered trench columns don't finish shallower than the burned-through shoulder.
    if (isCrystallographic && burnedThroughCols.some(Boolean)) {
      for (let i = 0; i < columns.length; i++) {
        if (!isColumnExposed[i] || columns[i].segments.length === 0) continue;
        let adjBurnY = targetSide === 'front' ? Infinity : -Infinity;
        for (const neighbor of [i - 1, i + 1]) {
          if (
            neighbor >= 0 &&
            neighbor < columns.length &&
            burnedThroughCols[neighbor] &&
            columns[neighbor].segments.length > 0
          ) {
            const ny =
              targetSide === 'front'
                ? getTopY(columns[neighbor])
                : getBottomY(columns[neighbor]);
            if (targetSide === 'front') {
              if (ny < adjBurnY) adjBurnY = ny;
            } else {
              if (ny > adjBurnY) adjBurnY = ny;
            }
          }
        }
        const curY =
          targetSide === 'front' ? getTopY(columns[i]) : getBottomY(columns[i]);
        const needsClamp =
          targetSide === 'front'
            ? Number.isFinite(adjBurnY) && curY > adjBurnY + 0.5
            : Number.isFinite(adjBurnY) && curY < adjBurnY - 0.5;
        if (needsClamp) {
          const orderedSegs =
            targetSide === 'front'
              ? [...columns[i].segments].reverse()
              : [...columns[i].segments];
          const nextSegs: MaterialSegment[] = [];
          let hitBarrier = false;
          for (let idxS = 0; idxS < orderedSegs.length; idxS++) {
            const seg = orderedSegs[idxS];
            if (hitBarrier || isBarrierSegment(seg)) {
              hitBarrier = true;
              nextSegs.push(seg);
              continue;
            }
            if (targetSide === 'front') {
              if (seg.yTop <= adjBurnY) {
                nextSegs.push(seg);
              } else if (seg.yBottom < adjBurnY) {
                const removed = seg.yTop - adjBurnY;
                etchedDelta[i] += removed;
                etchedFloorY[i] = adjBurnY;
                nextSegs.push({ ...seg, yTop: adjBurnY });
              } else {
                etchedDelta[i] += seg.yTop - seg.yBottom;
                etchedFloorY[i] = seg.yBottom;
              }
            } else {
              if (seg.yBottom >= adjBurnY) {
                nextSegs.push(seg);
              } else if (seg.yTop > adjBurnY) {
                const removed = adjBurnY - seg.yBottom;
                etchedDelta[i] += removed;
                etchedFloorY[i] = adjBurnY;
                nextSegs.push({ ...seg, yBottom: adjBurnY });
              } else {
                etchedDelta[i] += seg.yTop - seg.yBottom;
                etchedFloorY[i] = seg.yTop;
              }
            }
          }
          columns[i].segments =
            targetSide === 'front' ? nextSegs.reverse() : nextSegs;
        }
      }
    }
  }

  // 7. Record Bosch DRIE sidewall scallops, re-entrant (> 90.5°) walls, and sub-column positive dry-etch taper (< 89.5°)
  if (isBoschDrie && scallopWalls) {
    for (const w of boschPendingWalls) {
      const shoulderCol = columns[w.colTop];
      if (!shoulderCol || shoulderCol.segments.length === 0) continue;
      const shoulderSurf =
        targetSide === 'front' ? getTopY(shoulderCol) : getBottomY(shoulderCol);
      const validHeight =
        targetSide === 'front'
          ? shoulderSurf > w.yBot + 10
          : shoulderSurf < w.yBot - 10;
      if (!validHeight) continue;
      if (targetSide === 'front' && shoulderSurf < w.yTop - 0.5) {
        w.xTop = evalWallXAtY(w, shoulderSurf);
        w.yTop = shoulderSurf;
      } else if (targetSide === 'back' && shoulderSurf > w.yTop + 0.5) {
        w.xTop = evalWallXAtY(w, shoulderSurf);
        w.yTop = shoulderSurf;
      }
      scallopWalls.push(w);
    }
  }

  const isDryPosTaper =
    !isBoschDrie &&
    (rawEtchType === 'rie' || rawEtchType === 'ion-beam') &&
    sidewallAngle < 89.5;
  const isNonBoschReentrant = !isBoschDrie && isReentrant;
  const isDryVertical =
    !isBoschDrie &&
    (rawEtchType === 'rie' || rawEtchType === 'ion-beam' || rawEtchType === 'ashing') &&
    sidewallAngle >= 89.5 &&
    !isReentrant;

  if ((isNonBoschReentrant || isDryPosTaper || isDryVertical) && scallopWalls) {
    const rawScallopDepth = 0;
    const rawScallopPitch = Math.max(20, Math.min(1000, cfg?.scallopPitch ?? 200));
    const clampedPosAngle = Math.max(15, Math.min(89.5, sidewallAngle));
    const tanPosAngle = Math.tan((clampedPosAngle * Math.PI) / 180);
    const tanReentrantOverhang = isNonBoschReentrant
      ? Math.tan(((Math.min(135, sidewallAngle) - 90) * Math.PI) / 180)
      : 0;

    const hasEtchableInSpan = (
      col: ColumnProfile,
      spanBot: number,
      spanTop: number
    ): boolean => {
      for (const seg of col.segments) {
        if (Math.min(seg.yTop, spanTop) <= Math.max(seg.yBottom, spanBot) + 1) continue;
        if (!isBarrierSegment(seg)) return true;
      }
      return false;
    };

    const isTrenchCol = (c: number) => etchedDelta[c] > 5 && !isMaskShoulderCol(c);

    let idx = 0;
    while (idx < columns.length) {
      if (!isTrenchCol(idx)) {
        idx++;
        continue;
      }
      const runStart = idx;
      while (idx < columns.length && isTrenchCol(idx)) {
        idx++;
      }
      const runEnd = idx - 1;
      const mid = Math.floor((runStart + runEnd) / 2);

      // Left trench wall
      if (runStart > 0 && columns[runStart - 1].segments.length > 0) {
        const colTop = runStart - 1;
        const colTopSurface =
          targetSide === 'front'
            ? getTopY(columns[colTop])
            : getBottomY(columns[colTop]);
        const yTopEntry =
          targetSide === 'front'
            ? Math.min(etchedTopY[runStart], colTopSurface)
            : Math.max(etchedTopY[runStart], colTopSurface);

        // Find the immediate local trench floor where the sidewall finishes descending
        let bestFloor = etchedFloorY[runStart];
        let colBot = runStart;
        let flatCount = 0;
        for (let c = runStart + 1; c <= mid; c++) {
          if (Number.isNaN(etchedFloorY[c])) continue;
          if (
            targetSide === 'front'
              ? etchedFloorY[c] < bestFloor - 1.5
              : etchedFloorY[c] > bestFloor + 1.5
          ) {
            bestFloor = etchedFloorY[c];
            colBot = c;
            flatCount = 0;
          } else if (
            targetSide === 'front'
              ? etchedFloorY[c] > bestFloor + 1.5
              : etchedFloorY[c] < bestFloor - 1.5
          ) {
            break;
          } else {
            flatCount++;
            if (flatCount >= 2) break;
          }
        }
        const yBotFloor = etchedFloorY[colBot];
        const wallHeight =
          targetSide === 'front' ? yTopEntry - yBotFloor : yBotFloor - yTopEntry;
        const shoulderStandsTaller =
          targetSide === 'front'
            ? colTopSurface > yBotFloor + 10
            : colTopSurface < yBotFloor - 10;

        if (
          Number.isFinite(wallHeight) &&
          wallHeight > 15 &&
          shoulderStandsTaller
        ) {
          const spanMin = Math.min(yTopEntry, yBotFloor);
          const spanMax = Math.max(yTopEntry, yBotFloor);
          const colTopEtchable = hasEtchableInSpan(columns[colTop], spanMin, spanMax);

          // Measure solid etchable width to the left to prevent adjacent trench / narrow pillar self-intersection
          let solidLeftCols = 0;
          let k = colTop;
          for (; k >= 0; k--) {
            if (
              etchedDelta[k] > 5 ||
              columns[k].segments.length === 0 ||
              !hasEtchableInSpan(columns[k], spanMin, spanMax)
            ) {
              break;
            }
            solidLeftCols++;
          }
          const oppositeIsTrench =
            k >= 0 && (isTrenchCol(k) || columns[k].segments.length === 0);
          const solidLeftWidth = solidLeftCols * dx;
          const budgetWidth = oppositeIsTrench
            ? solidLeftWidth * 0.48
            : solidLeftWidth * 0.92;
          const safeDepth = 0;

          const baseMaskEdgeX = (colTop + 1) * dx;
          const effectiveIsoDepth = Math.max(
            wallHeight,
            Math.min(baseDepthPerCol[colBot] || refDepthForScale, wallHeight * 2)
          );
          const undercutShift = isReentrant
            ? colTopEtchable
              ? Math.min(
                  budgetWidth * 0.35,
                  effectiveIsoDepth * Math.max(0, isotropy)
                )
              : 0
            : 0;

          let xTop: number;
          let xBot: number;

          if (isReentrant) {
            xTop = baseMaskEdgeX - undercutShift;
            const maxAvailLeft = colTopEtchable
              ? Math.max(0, budgetWidth - undercutShift - safeDepth - dx * 0.1)
              : 0;
            const reentrantRun = Math.min(
              maxAvailLeft,
              wallHeight * tanReentrantOverhang
            );
            xBot = xTop - reentrantRun;
          } else if (sidewallAngle >= 89.5) {
            xTop = baseMaskEdgeX;
            xBot = colBot === runStart ? xTop : colBot * dx;
          } else {
            let maskEdgeCol = runStart;
            for (let c = runStart; c <= runEnd; c++) {
              if (isColumnExposed[c]) {
                maskEdgeCol = c;
                break;
              }
            }
            const rawMaskEdgeX = maskEdgeCol * dx;
            const nominalUndercut =
              (baseDepthPerCol[maskEdgeCol] || wallHeight) * Math.max(0, isotropy);
            const actualUndercut = colTopEtchable
              ? Math.min(nominalUndercut, budgetWidth * 0.85)
              : 0;
            const minXTop = colTop * dx + dx * 0.1;
            xTop = colTopEtchable
              ? Math.min(rawMaskEdgeX, Math.max(minXTop, rawMaskEdgeX - actualUndercut))
              : baseMaskEdgeX;
            xBot = Math.min((colBot + 1) * dx, xTop + wallHeight / tanPosAngle);
          }

          let wallColTop = colTop;
          if (isReentrant && Math.abs(xTop - xBot) > 1) {
            while (wallColTop > 0 && columns[wallColTop].x >= xTop - 1e-6) {
              wallColTop--;
            }
            const minEdge = Math.min(xTop, xBot);
            const spanMinW = Math.min(yTopEntry, yBotFloor);
            const spanMaxW = Math.max(yTopEntry, yBotFloor);
            for (let j = colTop; j >= 0; j--) {
              if (columns[j].x < minEdge - 1e-6) break;
              if (columns[j].segments.length === 0 || etchedDelta[j] > 5) break;
              let cutBot: number;
              let cutTop: number;
              if (columns[j].x >= xTop - 1e-6) {
                cutBot = spanMinW;
                cutTop = spanMaxW;
              } else {
                const frac = (xTop - columns[j].x) / Math.max(1e-6, xTop - xBot);
                const yWallJ = yTopEntry + frac * (yBotFloor - yTopEntry);
                cutBot = targetSide === 'front' ? yBotFloor : yWallJ;
                cutTop = targetSide === 'front' ? yWallJ : yBotFloor;
              }
              if (cutTop - cutBot > 0.5) {
                const nextSegs: MaterialSegment[] = [];
                for (const seg of columns[j].segments) {
                  const isFast =
                    !isBarrierSegment(seg) &&
                    (!activeRecipe ||
                      maxExposedFastRate <= 0 ||
                      getEtchRateNmMin(activeRecipe, seg.materialId) >=
                        0.2 * maxExposedFastRate);
                  if (!isFast || seg.yTop <= cutBot + 0.5 || seg.yBottom >= cutTop - 0.5) {
                    nextSegs.push(seg);
                    continue;
                  }
                  if (seg.yBottom < cutBot - 0.5) {
                    nextSegs.push({ ...seg, yTop: cutBot });
                  }
                  if (seg.yTop > cutTop + 0.5) {
                    nextSegs.push({ ...seg, yBottom: cutTop });
                  }
                }
                columns[j].segments = nextSegs;
              }
            }
          }

          if (
            safeDepth > 1 ||
            (isReentrant && Math.abs(xTop - xBot) > 1) ||
            (isDryPosTaper && Math.abs(xBot - xTop) > 1) ||
            (isDryVertical && colBot === runStart && Math.abs(xTop - xBot) <= 0.5 && etchedDelta[colTop] <= 5)
          ) {
            scallopWalls.push({
              stepId: step.id,
              targetSide,
              wallSide: 'left',
              colTop: wallColTop,
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
        const colTopSurface =
          targetSide === 'front'
            ? getTopY(columns[colTop])
            : getBottomY(columns[colTop]);
        const yTopEntry =
          targetSide === 'front'
            ? Math.min(etchedTopY[runEnd], colTopSurface)
            : Math.max(etchedTopY[runEnd], colTopSurface);

        let bestFloor = etchedFloorY[runEnd];
        let colBot = runEnd;
        let flatCount = 0;
        for (let c = runEnd - 1; c >= mid; c--) {
          if (Number.isNaN(etchedFloorY[c])) continue;
          if (
            targetSide === 'front'
              ? etchedFloorY[c] < bestFloor - 1.5
              : etchedFloorY[c] > bestFloor + 1.5
          ) {
            bestFloor = etchedFloorY[c];
            colBot = c;
            flatCount = 0;
          } else if (
            targetSide === 'front'
              ? etchedFloorY[c] > bestFloor + 1.5
              : etchedFloorY[c] < bestFloor - 1.5
          ) {
            break;
          } else {
            flatCount++;
            if (flatCount >= 2) break;
          }
        }
        const yBotFloor = etchedFloorY[colBot];
        const wallHeight =
          targetSide === 'front' ? yTopEntry - yBotFloor : yBotFloor - yTopEntry;
        const shoulderStandsTaller =
          targetSide === 'front'
            ? colTopSurface > yBotFloor + 10
            : colTopSurface < yBotFloor - 10;

        if (
          Number.isFinite(wallHeight) &&
          wallHeight > 15 &&
          shoulderStandsTaller
        ) {
          const spanMin = Math.min(yTopEntry, yBotFloor);
          const spanMax = Math.max(yTopEntry, yBotFloor);
          const colTopEtchable = hasEtchableInSpan(columns[colTop], spanMin, spanMax);

          let solidRightCols = 0;
          let k = colTop;
          for (; k < columns.length; k++) {
            if (
              etchedDelta[k] > 5 ||
              columns[k].segments.length === 0 ||
              !hasEtchableInSpan(columns[k], spanMin, spanMax)
            ) {
              break;
            }
            solidRightCols++;
          }
          const oppositeIsTrench =
            k < columns.length &&
            (isTrenchCol(k) || columns[k].segments.length === 0);
          const solidRightWidth = solidRightCols * dx;
          const budgetWidth = oppositeIsTrench
            ? solidRightWidth * 0.48
            : solidRightWidth * 0.92;
          const safeDepth = 0;

          const baseMaskEdgeX = colTop * dx;
          const effectiveIsoDepth = Math.max(
            wallHeight,
            Math.min(baseDepthPerCol[colBot] || refDepthForScale, wallHeight * 2)
          );
          const undercutShift = isReentrant
            ? colTopEtchable
              ? Math.min(
                  budgetWidth * 0.35,
                  effectiveIsoDepth * Math.max(0, isotropy)
                )
              : 0
            : 0;

          let xTop: number;
          let xBot: number;

          if (isReentrant) {
            xTop = baseMaskEdgeX + undercutShift;
            const maxAvailRight = colTopEtchable
              ? Math.max(0, budgetWidth - undercutShift - safeDepth - dx * 0.1)
              : 0;
            const reentrantRun = Math.min(
              maxAvailRight,
              wallHeight * tanReentrantOverhang
            );
            xBot = xTop + reentrantRun;
          } else if (sidewallAngle >= 89.5) {
            xTop = baseMaskEdgeX;
            xBot = colBot === runEnd ? xTop : (colBot + 1) * dx;
          } else {
            let maskEdgeCol = runEnd;
            for (let c = runEnd; c >= runStart; c--) {
              if (isColumnExposed[c]) {
                maskEdgeCol = c;
                break;
              }
            }
            const rawMaskEdgeX = (maskEdgeCol + 1) * dx;
            const nominalUndercut =
              (baseDepthPerCol[maskEdgeCol] || wallHeight) * Math.max(0, isotropy);
            const actualUndercut = colTopEtchable
              ? Math.min(nominalUndercut, budgetWidth * 0.85)
              : 0;
            const maxXTop = (colTop + 1) * dx - dx * 0.1;
            xTop = colTopEtchable
              ? Math.max(rawMaskEdgeX, Math.min(maxXTop, rawMaskEdgeX + actualUndercut))
              : baseMaskEdgeX;
            xBot = Math.max(colBot * dx, xTop - wallHeight / tanPosAngle);
          }

          let wallColTop = colTop;
          if (isReentrant && Math.abs(xBot - xTop) > 1) {
            while (
              wallColTop < columns.length - 1 &&
              columns[wallColTop].x <= xTop + 1e-6
            ) {
              wallColTop++;
            }
            const maxEdge = Math.max(xTop, xBot);
            const spanMinW = Math.min(yTopEntry, yBotFloor);
            const spanMaxW = Math.max(yTopEntry, yBotFloor);
            for (let j = colTop; j < columns.length; j++) {
              if (columns[j].x > maxEdge + 1e-6) break;
              if (columns[j].segments.length === 0 || etchedDelta[j] > 5) break;
              let cutBot: number;
              let cutTop: number;
              if (columns[j].x <= xTop + 1e-6) {
                cutBot = spanMinW;
                cutTop = spanMaxW;
              } else {
                const frac = (columns[j].x - xTop) / Math.max(1e-6, xBot - xTop);
                const yWallJ = yTopEntry + frac * (yBotFloor - yTopEntry);
                cutBot = targetSide === 'front' ? yBotFloor : yWallJ;
                cutTop = targetSide === 'front' ? yWallJ : yBotFloor;
              }
              if (cutTop - cutBot > 0.5) {
                const nextSegs: MaterialSegment[] = [];
                for (const seg of columns[j].segments) {
                  const isFast =
                    !isBarrierSegment(seg) &&
                    (!activeRecipe ||
                      maxExposedFastRate <= 0 ||
                      getEtchRateNmMin(activeRecipe, seg.materialId) >=
                        0.2 * maxExposedFastRate);
                  if (!isFast || seg.yTop <= cutBot + 0.5 || seg.yBottom >= cutTop - 0.5) {
                    nextSegs.push(seg);
                    continue;
                  }
                  if (seg.yBottom < cutBot - 0.5) {
                    nextSegs.push({ ...seg, yTop: cutBot });
                  }
                  if (seg.yTop > cutTop + 0.5) {
                    nextSegs.push({ ...seg, yBottom: cutTop });
                  }
                }
                columns[j].segments = nextSegs;
              }
            }
          }

          if (
            safeDepth > 1 ||
            (isReentrant && Math.abs(xBot - xTop) > 1) ||
            (isDryPosTaper && Math.abs(xTop - xBot) > 1) ||
            (isDryVertical && colBot === runEnd && Math.abs(xTop - xBot) <= 0.5 && etchedDelta[colTop] <= 5)
          ) {
            scallopWalls.push({
              stepId: step.id,
              targetSide,
              wallSide: 'right',
              colTop: wallColTop,
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

function applyPhotoresistMaskConsumption(
  columns: ColumnProfile[],
  wasProtectedResistCol: Uint8Array,
  materials: Material[],
  recipe: EtchRecipe,
  maskEtchTimeMin: number,
  targetSide: 'front' | 'back',
  targetMatId: string,
  stopLayerId?: string,
  preMaskSegments?: (MaterialSegment[] | undefined)[]
): Uint8Array {
  const burnedThroughCols = new Uint8Array(columns.length);
  if (maskEtchTimeMin <= 0) return burnedThroughCols;

  for (let j = 0; j < columns.length; j++) {
    if (!wasProtectedResistCol[j]) continue;
    const col = columns[j];
    if (col.segments.length === 0) continue;

    // 1. Compute resist consumption and post-depletion vertical burn-through reach from pre-etch stack
    const refSegs = preMaskSegments?.[j] ?? col.segments;
    const orderedRef =
      targetSide === 'front' ? [...refSegs].reverse() : [...refSegs];
    let remTime = maskEtchTimeMin;
    let maskDepleted = false;
    let burnThroughReachY =
      targetSide === 'front' ? getTopY(col) : getBottomY(col);

    for (const seg of orderedRef) {
      if (remTime <= 0) break;
      const mat = getMaterialById(materials, seg.materialId);
      const isResist = mat.category === 'photoresist';
      if (!maskDepleted && !isResist) {
        remTime = 0;
        break;
      }
      if (maskDepleted) {
        if (stopLayerId && seg.materialId === stopLayerId) {
          remTime = 0;
          break;
        }
        if (targetMatId !== 'all' && seg.materialId !== targetMatId) {
          remTime = 0;
          break;
        }
      }
      const rate = getEtchRateNmMin(recipe, seg.materialId);
      if (rate <= 0) {
        remTime = 0;
        break;
      }
      const segH = seg.yTop - seg.yBottom;
      if (segH <= 0) continue;
      const timeToClear = segH / rate;
      if (remTime >= timeToClear) {
        remTime -= timeToClear;
        if (isResist) maskDepleted = true;
        burnThroughReachY = targetSide === 'front' ? seg.yBottom : seg.yTop;
      } else {
        const loss = remTime * rate;
        remTime = 0;
        burnThroughReachY =
          targetSide === 'front' ? seg.yTop - loss : seg.yBottom + loss;
      }
    }

    // 2. Apply resist thinning & non-double-counted burn-through reach onto actual post-Step-5 column
    const orderedActual =
      targetSide === 'front' ? [...col.segments].reverse() : [...col.segments];
    const remainingSegments: MaterialSegment[] = [];
    let resistRemTime = maskEtchTimeMin;

    for (const seg of orderedActual) {
      const mat = getMaterialById(materials, seg.materialId);
      const isResist = mat.category === 'photoresist';

      if (isResist) {
        if (resistRemTime <= 0) {
          remainingSegments.push(seg);
          continue;
        }
        const rate = getEtchRateNmMin(recipe, seg.materialId);
        if (rate <= 0) {
          resistRemTime = 0;
          remainingSegments.push(seg);
          continue;
        }
        const segH = seg.yTop - seg.yBottom;
        const timeToClear = segH / rate;
        if (resistRemTime >= timeToClear) {
          resistRemTime -= timeToClear;
          // Resist segment completely consumed
        } else {
          const loss = resistRemTime * rate;
          resistRemTime = 0;
          if (targetSide === 'front') {
            if (seg.yTop - loss > seg.yBottom + 0.5) {
              remainingSegments.push({ ...seg, yTop: seg.yTop - loss });
            }
          } else {
            if (seg.yBottom + loss < seg.yTop - 0.5) {
              remainingSegments.push({ ...seg, yBottom: seg.yBottom + loss });
            }
          }
        }
        continue;
      }

      if (!maskDepleted) {
        remainingSegments.push(seg);
        continue;
      }

      burnedThroughCols[j] = 1;
      // Only clamp non-resist segments that still extend past burnThroughReachY (avoid double-counting undercut)
      if (targetSide === 'front') {
        if (seg.yTop <= burnThroughReachY) {
          remainingSegments.push(seg);
        } else if (seg.yBottom < burnThroughReachY - 0.5) {
          remainingSegments.push({ ...seg, yTop: burnThroughReachY });
        }
      } else {
        if (seg.yBottom >= burnThroughReachY) {
          remainingSegments.push(seg);
        } else if (seg.yTop > burnThroughReachY + 0.5) {
          remainingSegments.push({ ...seg, yBottom: burnThroughReachY });
        }
      }
    }

    col.segments =
      targetSide === 'front' ? remainingSegments.reverse() : remainingSegments;
  }

  return burnedThroughCols;
}

/**
 * Handles Resist Strip, Metal Lift-off, and Sacrificial Layer Release
 * respecting front, back, or both sides.
 */
function pruneWallsAfterStrip(
  columns: ColumnProfile[],
  scallopWalls?: ScallopWall[]
): void {
  if (!scallopWalls || scallopWalls.length === 0) return;
  for (let i = scallopWalls.length - 1; i >= 0; i--) {
    const w = scallopWalls[i];
    const col = columns[w.colTop];
    if (!col || col.segments.length === 0) {
      scallopWalls.splice(i, 1);
      continue;
    }
    const surf = w.targetSide === 'front' ? getTopY(col) : getBottomY(col);
    if (w.targetSide === 'front') {
      if (surf <= w.yBot + 10) {
        scallopWalls.splice(i, 1);
      } else if (surf < w.yTop - 0.5) {
        w.xTop = evalWallXAtY(w, surf);
        w.yTop = surf;
      }
    } else {
      if (surf >= w.yBot - 10) {
        scallopWalls.splice(i, 1);
      } else if (surf > w.yTop + 0.5) {
        w.xTop = evalWallXAtY(w, surf);
        w.yTop = surf;
      }
    }
  }
}

export function doesSegmentMatchReleaseSide(
  col: ColumnProfile,
  segIdx: number,
  seg: MaterialSegment,
  targetMat: string,
  side: 'front' | 'back' | 'both'
): boolean {
  if (side === 'both') return true;
  if (seg.side === 'front') return side === 'front';
  if (seg.side === 'back') return side === 'back';

  // Untagged segment (e.g. legacy substrate layer or core): infer side relative to non-target core
  const segs = col.segments;
  let coreIdx = -1;
  let maxOtherSpan = -1;
  for (let i = 0; i < segs.length; i++) {
    if (segs[i].materialId === targetMat) continue;
    const span = segs[i].yTop - segs[i].yBottom;
    if (span > maxOtherSpan) {
      maxOtherSpan = span;
      coreIdx = i;
    }
  }
  if (coreIdx === -1) {
    // Only target material exists in this column (core substrate itself): only remove on 'both'
    return false;
  }
  if (segIdx > coreIdx) return side === 'front';
  if (segIdx < coreIdx) return side === 'back';
  return false;
}

function applyStripOrLiftoff(
  columns: ColumnProfile[],
  step: ProcessStep,
  materials: Material[],
  side: 'front' | 'back' | 'both',
  scallopWalls?: ScallopWall[]
): void {
  const cfg = step.strip;
  const stripType =
    cfg?.stripType ?? (step.type === 'liftoff' ? 'metal-liftoff' : 'resist-strip');

  if (stripType === 'sacrificial-release') {
    const targetMat = cfg?.targetMaterialId ?? 'mat_sio2_thermal';
    const releaseScope = cfg?.releaseScope ?? 'all';
    const regions = cfg?.releaseRegions ?? [];

    for (const col of columns) {
      if (releaseScope === 'regions') {
        // releaseRegions define protected zones that are NOT etched (kept intact)
        const protectedRegions = regions.filter((r) => {
          const xLo = Math.min(r.xStart, r.xEnd);
          const xHi = Math.max(r.xStart, r.xEnd);
          return xHi - xLo > 0.5 && col.x >= xLo - 1e-6 && col.x <= xHi + 1e-6;
        });

        const nextSegs: MaterialSegment[] = [];
        const origSegs = col.segments;
        for (let sIdx = 0; sIdx < origSegs.length; sIdx++) {
          const seg = origSegs[sIdx];
          if (
            seg.materialId !== targetMat ||
            !doesSegmentMatchReleaseSide(col, sIdx, seg, targetMat, side)
          ) {
            nextSegs.push(seg);
            continue;
          }

          if (protectedRegions.length === 0) {
            // Outside all protected regions -> dissolved
            continue;
          }

          const hasFullZProtected = protectedRegions.some(
            (r) => r.yMin === undefined || r.yMax === undefined
          );
          if (hasFullZProtected) {
            nextSegs.push(seg);
            continue;
          }

          // Collect and merge Z-intervals of this segment covered by protected regions
          const rawKept: [number, number][] = [];
          for (const r of protectedRegions) {
            const rLo = Math.min(r.yMin!, r.yMax!) - 1;
            const rHi = Math.max(r.yMin!, r.yMax!) + 1;
            const lo = Math.max(seg.yBottom, rLo);
            const hi = Math.min(seg.yTop, rHi);
            if (hi - lo > 0.5) {
              rawKept.push([lo, hi]);
            }
          }

          if (rawKept.length === 0) continue;

          rawKept.sort((a, b) => a[0] - b[0]);
          const mergedKept: [number, number][] = [rawKept[0]];
          for (let k = 1; k < rawKept.length; k++) {
            const prev = mergedKept[mergedKept.length - 1];
            const cur = rawKept[k];
            if (cur[0] <= prev[1] + 0.5) {
              prev[1] = Math.max(prev[1], cur[1]);
            } else {
              mergedKept.push(cur);
            }
          }

          for (const [a, b] of mergedKept) {
            nextSegs.push({
              ...seg,
              yBottom: a,
              yTop: b,
            });
          }
        }
        col.segments = nextSegs;
      } else {
        col.segments = col.segments.filter((seg, sIdx) => {
          if (seg.materialId !== targetMat) return true;
          return !doesSegmentMatchReleaseSide(col, sIdx, seg, targetMat, side);
        });
      }
    }
    pruneWallsAfterStrip(columns, scallopWalls);
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
    pruneWallsAfterStrip(columns, scallopWalls);
    return;
  }

  // Standard resist strip: remove photoresist layers on selected side(s)
  for (const col of columns) {
    col.segments = col.segments.filter((seg, sIdx) => {
      const mat = getMaterialById(materials, seg.materialId);
      if (mat.category !== 'photoresist') return true;
      return !doesSegmentMatchReleaseSide(col, sIdx, seg, seg.materialId, side);
    });
  }
  pruneWallsAfterStrip(columns, scallopWalls);
}

/**
 * Relative CMP polish softness rank (higher = polishes faster / dishes more easily).
 * Explicit stop-on-layer barriers always rank lowest (hardest stop).
 */
function getCmpSoftnessRank(mat: Material, stopMaterialId?: string): number {
  if (stopMaterialId && mat.id === stopMaterialId) return 0;
  if (mat.category === 'photoresist' || mat.category === 'polymer') return 5.0;
  if (mat.category === 'metal') {
    if (mat.id === 'mat_cu' || mat.id === 'mat_al' || mat.id === 'mat_au') return 4.0;
    return 3.0;
  }
  if (mat.category === 'dielectric') {
    if (mat.id === 'mat_si3n4' || mat.id === 'mat_al2o3' || mat.id === 'mat_hafnium') return 1.0;
    if (mat.id === 'mat_sio2_thermal') return 2.4;
    return 2.6;
  }
  if (mat.id === 'mat_poly_si') return 2.2;
  if (mat.category === 'substrate' || mat.category === 'semiconductor') return 1.5;
  return 2.5;
}

/**
 * Computes per-column CMP recession (erosion + concave feature dishing) at polishPlaneY
 * when multi-material patterns (e.g. Damascene Cu/SiO2 or STI SiO2/Si3N4) are exposed.
 */
function computeCmpDishingAndErosion(
  columns: ColumnProfile[],
  materials: Material[],
  totalWidth: number,
  targetSide: 'front' | 'back',
  polishPlaneY: number,
  dishingPct: number,
  erosionPct: number,
  stopMaterialId?: string
): number[] {
  const n = columns.length;
  const recess = new Array<number>(n).fill(0);
  if (n === 0 || (dishingPct <= 0 && erosionPct <= 0)) return recess;

  const dx = totalWidth / n;
  const exposedMatId: (string | null)[] = new Array(n).fill(null);
  const contiguousThick: number[] = new Array(n).fill(0);
  const matCounts = new Map<string, number>();

  for (let i = 0; i < n; i++) {
    const segs = columns[i].segments;
    if (segs.length === 0) continue;
    if (targetSide === 'front') {
      const topSeg = segs[segs.length - 1];
      if (Math.abs(topSeg.yTop - polishPlaneY) > 0.5) continue;
      exposedMatId[i] = topSeg.materialId;
      matCounts.set(topSeg.materialId, (matCounts.get(topSeg.materialId) || 0) + 1);
      let thick = 0;
      for (let s = segs.length - 1; s >= 0; s--) {
        if (segs[s].materialId === topSeg.materialId) {
          thick += segs[s].yTop - segs[s].yBottom;
        } else {
          break;
        }
      }
      contiguousThick[i] = thick;
    } else {
      const botSeg = segs[0];
      if (Math.abs(botSeg.yBottom - polishPlaneY) > 0.5) continue;
      exposedMatId[i] = botSeg.materialId;
      matCounts.set(botSeg.materialId, (matCounts.get(botSeg.materialId) || 0) + 1);
      let thick = 0;
      for (let s = 0; s < segs.length; s++) {
        if (segs[s].materialId === botSeg.materialId) {
          thick += segs[s].yTop - segs[s].yBottom;
        } else {
          break;
        }
      }
      contiguousThick[i] = thick;
    }
  }

  // Require at least 2 distinct exposed materials for multi-material dishing & erosion
  if (matCounts.size < 2) return recess;

  let minRank = Infinity;
  let maxRank = -Infinity;
  const rankByMat = new Map<string, number>();
  for (const matId of matCounts.keys()) {
    const mat = getMaterialById(materials, matId);
    const rank = getCmpSoftnessRank(mat, stopMaterialId);
    rankByMat.set(matId, rank);
    if (rank < minRank) minRank = rank;
    if (rank > maxRank) maxRank = rank;
  }

  // Tie-breaker if all exposed materials have equal softness rank: minority material dishes
  let majorityMatId: string | null = null;
  if (maxRank <= minRank + 1e-6) {
    let bestCount = -1;
    for (const [mId, cnt] of matCounts.entries()) {
      if (cnt > bestCount) {
        bestCount = cnt;
        majorityMatId = mId;
      }
    }
  }

  const softness = new Array<number>(n).fill(0);
  const featureThicks: number[] = [];
  for (let i = 0; i < n; i++) {
    const mId = exposedMatId[i];
    if (!mId) continue;
    let sVal = 0;
    if (maxRank > minRank + 1e-6) {
      sVal = ((rankByMat.get(mId) ?? minRank) - minRank) / (maxRank - minRank);
    } else {
      sVal = mId === majorityMatId ? 0 : 1;
    }
    softness[i] = sVal;
    if (sVal > 0.2 && contiguousThick[i] > 0) {
      featureThicks.push(contiguousThick[i]);
    }
  }

  if (featureThicks.length === 0) return recess;
  featureThicks.sort((a, b) => a - b);
  const medianFeatureThick = featureThicks[Math.floor(featureThicks.length / 2)];
  const refFeatureThick = Math.max(60, Math.min(2000, medianFeatureThick));

  const maxDishAt100 = Math.min(450, Math.max(90, refFeatureThick * 0.45));
  const maxErosionAt100 = Math.min(260, Math.max(60, refFeatureThick * 0.28));

  // 1. Pattern-density-dependent erosion across pad planarization length L_pad
  if (erosionPct > 0) {
    const halfSpanCols = Math.max(2, Math.round((totalWidth * 0.14) / Math.max(1, dx)));
    const erosionFrac = erosionPct / 100;
    for (let i = 0; i < n; i++) {
      if (!exposedMatId[i]) continue;
      let weightedSoft = 0;
      let weightSum = 0;
      const jMin = Math.max(0, i - halfSpanCols);
      const jMax = Math.min(n - 1, i + halfSpanCols);
      for (let j = jMin; j <= jMax; j++) {
        const w = 0.5 * (1 + Math.cos((Math.PI * Math.abs(j - i)) / (halfSpanCols + 1)));
        weightSum += w;
        if (exposedMatId[j]) {
          weightedSoft += w * softness[j];
        }
      }
      const localDensity = weightSum > 0 ? weightedSoft / weightSum : 0;
      recess[i] += maxErosionAt100 * erosionFrac * Math.pow(localDensity, 0.85);
    }
  }

  // 2. Concave width-dependent dishing inside contiguous soft/inlaid feature runs
  if (dishingPct > 0) {
    const dishFrac = dishingPct / 100;
    const refWidth = Math.max(1000, totalWidth * 0.25);
    let idx = 0;
    while (idx < n) {
      const mId = exposedMatId[idx];
      if (!mId || softness[idx] <= 0.2) {
        idx++;
        continue;
      }
      let endIdx = idx;
      while (
        endIdx + 1 < n &&
        exposedMatId[endIdx + 1] === mId &&
        softness[endIdx + 1] > 0.2
      ) {
        endIdx++;
      }
      const runLen = endIdx - idx + 1;
      const runWidth = runLen * dx;
      const widthFactor = Math.min(1.0, 0.22 + 0.78 * Math.pow(runWidth / refWidth, 0.65));

      for (let k = idx; k <= endIdx; k++) {
        const u = (k - idx + 0.5) / runLen;
        const bowl = Math.sin(Math.PI * u);
        const rawDish = maxDishAt100 * dishFrac * softness[k] * widthFactor * bowl;
        const maxSafeDish = Math.max(0, contiguousThick[k] * 0.85 - recess[k] * 0.25);
        recess[k] += Math.min(rawDish, maxSafeDish);
      }
      idx = endIdx + 1;
    }
  }

  return recess;
}

/**
 * Handles CMP (Chemical Mechanical Polishing / Backside Grinding & Planarization)
 */
function applyCmpSide(
  columns: ColumnProfile[],
  step: ProcessStep,
  materials: Material[],
  totalWidth: number,
  targetSide: 'front' | 'back',
  scallopWalls?: ScallopWall[]
): void {
  const cfg = step.cmp;
  const mode = cfg?.mode ?? 'polish-depth';
  const operation = cfg?.operation ?? 'cmp';
  const dishingPct = operation === 'cmp' ? Math.max(0, Math.min(100, cfg?.dishing ?? 0)) : 0;
  const erosionPct = operation === 'cmp' ? Math.max(0, Math.min(100, cfg?.erosion ?? 0)) : 0;

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

    if (dishingPct > 0 || erosionPct > 0) {
      const recess = computeCmpDishingAndErosion(
        columns,
        materials,
        totalWidth,
        'front',
        polishPlaneY,
        dishingPct,
        erosionPct,
        mode === 'stop-on-layer' ? cfg?.stopMaterialId : undefined
      );
      for (let i = 0; i < columns.length; i++) {
        const r = recess[i];
        if (r <= 0.05) continue;
        const localPlaneY = polishPlaneY - r;
        const newSegs: MaterialSegment[] = [];
        for (const seg of columns[i].segments) {
          if (seg.yBottom >= localPlaneY) continue;
          if (seg.yTop > localPlaneY) {
            newSegs.push({ ...seg, yTop: localPlaneY });
          } else {
            newSegs.push(seg);
          }
        }
        columns[i].segments = newSegs;
      }
    }

    if (scallopWalls && scallopWalls.length > 0) {
      for (let i = scallopWalls.length - 1; i >= 0; i--) {
        const w = scallopWalls[i];
        if (w.targetSide !== 'front') continue;
        if (polishPlaneY < w.yTop - 0.5) {
          if (polishPlaneY <= w.yBot + 10) {
            scallopWalls.splice(i, 1);
          } else {
            w.xTop = evalWallXAtY(w, polishPlaneY);
            w.yTop = polishPlaneY;
          }
        }
      }
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

  if (dishingPct > 0 || erosionPct > 0) {
    const recess = computeCmpDishingAndErosion(
      columns,
      materials,
      totalWidth,
      'back',
      polishPlaneY,
      dishingPct,
      erosionPct,
      mode === 'stop-on-layer' ? cfg?.stopMaterialId : undefined
    );
    for (let i = 0; i < columns.length; i++) {
      const r = recess[i];
      if (r <= 0.05) continue;
      const localPlaneY = polishPlaneY + r;
      const newSegs: MaterialSegment[] = [];
      for (const seg of columns[i].segments) {
        if (seg.yTop <= localPlaneY) continue;
        if (seg.yBottom < localPlaneY) {
          newSegs.push({ ...seg, yBottom: localPlaneY });
        } else {
          newSegs.push(seg);
        }
      }
      columns[i].segments = newSegs;
    }
  }

  if (scallopWalls && scallopWalls.length > 0) {
    for (let i = scallopWalls.length - 1; i >= 0; i--) {
      const w = scallopWalls[i];
      if (w.targetSide !== 'back') continue;
      if (polishPlaneY > w.yTop + 0.5) {
        if (polishPlaneY >= w.yBot - 10) {
          scallopWalls.splice(i, 1);
        } else {
          w.xTop = evalWallXAtY(w, polishPlaneY);
          w.yTop = polishPlaneY;
        }
      }
    }
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

  const iface = cfg?.interfaceLayer;
  const ifaceThick =
    iface?.enabled && (iface.thickness ?? 0) > 0 ? iface.thickness : 0;

  if (cfg?.sourceType === 'imported-flow' && cfg.importedFlow) {
    const resolvedImported = resolveFlowParameters(cfg.importedFlow);
    const meshB = simulateCrossSectionInternal(
      resolvedImported,
      undefined,
      recursionDepth + 1
    );
    const colsB = meshB.columns;
    if (colsB.length === 0) return;

    const totalWidth =
      _totalWidth > 0
        ? _totalWidth
        : columns.length > 0
        ? columns[columns.length - 1].x + columns[0].x
        : 10000;
    const importedWidth = meshB.width || resolvedImported.substrateWidth || totalWidth;
    const widthsMatch = Math.abs(importedWidth - totalWidth) <= 1;
    const useCropPad = !widthsMatch && cfg.widthMismatchMode === 'crop-pad';
    const alignment = cfg.widthAlignment || 'center';
    const paddingMode = cfg.widthPaddingMode || 'empty';
    const mirrorHoriz = Boolean(cfg.mirrorHorizontal);

    const shiftX =
      alignment === 'custom' &&
      typeof cfg.widthOffsetNm === 'number' &&
      Number.isFinite(cfg.widthOffsetNm)
        ? cfg.widthOffsetNm
        : alignment === 'left'
        ? 0
        : alignment === 'right'
        ? totalWidth - importedWidth
        : (totalWidth - importedWidth) / 2;

    // Pre-map each base column to its corresponding imported column segments (or null if padded empty)
    const mappedColsB: (MaterialSegment[] | null)[] = new Array(columns.length);
    for (let i = 0; i < columns.length; i++) {
      if (!useCropPad) {
        const rawIdxB = Math.min(
          colsB.length - 1,
          Math.floor((i / columns.length) * colsB.length)
        );
        const idxB = mirrorHoriz ? colsB.length - 1 - rawIdxB : rawIdxB;
        mappedColsB[i] = colsB[idxB].segments;
      } else {
        const localX = columns[i].x - shiftX;
        if (localX < 0 || localX > importedWidth) {
          if (paddingMode === 'extend-edges') {
            const clampedLocalX = localX < 0 ? 0 : importedWidth;
            const rawIdxB = Math.min(
              colsB.length - 1,
              Math.max(0, Math.floor((clampedLocalX / importedWidth) * colsB.length))
            );
            const idxB = mirrorHoriz ? colsB.length - 1 - rawIdxB : rawIdxB;
            mappedColsB[i] = colsB[idxB].segments;
          } else {
            mappedColsB[i] = null;
          }
        } else {
          const rawIdxB = Math.min(
            colsB.length - 1,
            Math.max(0, Math.floor((localX / importedWidth) * colsB.length))
          );
          const idxB = mirrorHoriz ? colsB.length - 1 - rawIdxB : rawIdxB;
          mappedColsB[i] = colsB[idxB].segments;
        }
      }
    }

    // Determine contact plane on current wafer across overlapping bonded columns (falling back to all columns)
    let bondPlaneY = targetSide === 'front' ? -Infinity : Infinity;
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const segsB = mappedColsB[i];
      if (col.segments.length === 0 || !segsB || segsB.length === 0) continue;
      if (targetSide === 'front') {
        const top = getTopY(col);
        if (top > bondPlaneY) bondPlaneY = top;
      } else {
        const bot = getBottomY(col);
        if (bot < bondPlaneY) bondPlaneY = bot;
      }
    }
    if (bondPlaneY === -Infinity || bondPlaneY === Infinity) {
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
    }
    if (bondPlaneY === -Infinity || bondPlaneY === Infinity) {
      bondPlaneY = 0;
    }

    const incomingContactY =
      targetSide === 'front'
        ? bondPlaneY + ifaceThick
        : bondPlaneY - ifaceThick;

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

    // Determine effective vertical bounds over surviving imported columns (important when cropping overhanging tall structures)
    let minYB = Infinity;
    let maxYB = -Infinity;
    for (let i = 0; i < mappedColsB.length; i++) {
      const segs = mappedColsB[i];
      if (!segs) continue;
      for (const s of segs) {
        if (s.yBottom < minYB) minYB = s.yBottom;
        if (s.yTop > maxYB) maxYB = s.yTop;
      }
    }
    if (minYB === Infinity) minYB = meshB.minY;
    if (maxYB === -Infinity) maxYB = meshB.maxY;

    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const segsB = mappedColsB[i];
      if (!segsB || segsB.length === 0) continue;

      const addedSegs: MaterialSegment[] = [];
      const ifaceSeg = buildInterfaceSeg();

      if (targetSide === 'front') {
        if (ifaceSeg) addedSegs.push(ifaceSeg);
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
        if (ifaceSeg) addedSegs.push(ifaceSeg);
        col.segments = [...addedSegs, ...col.segments];
      }
    }
    return;
  }

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
 * Handles Tape & Frame mounting and UV-release / demounting.
 */
function applyTapeFrame(
  columns: ColumnProfile[],
  step: ProcessStep,
  totalWidth: number,
  activeFrames: { stepId: string; side: 'front' | 'back'; materialId: string }[]
): void {
  const cfg = step.tapeFrame;
  const action = cfg?.action ?? 'mount';
  const rawSide = step.side || 'back';
  const targetSide: 'front' | 'back' = rawSide === 'front' ? 'front' : 'back';
  const matId = cfg?.tapeMaterialId || 'mat_dicing_tape';

  if (action === 'demount') {
    for (const col of columns) {
      col.segments = col.segments.filter((seg) => {
        const isTapeMat = CARRIER_TAPE_IDS.has(seg.materialId) || seg.materialId === matId;
        if (!isTapeMat) return true;
        if (rawSide === 'both') return false;
        if (targetSide === 'front') return seg.side !== 'front';
        return seg.side !== 'back';
      });
    }
    for (let k = activeFrames.length - 1; k >= 0; k--) {
      if (rawSide === 'both' || activeFrames[k].side === targetSide) {
        activeFrames.splice(k, 1);
      }
    }
    return;
  }

  // Mount tape onto substrate (with optional ring frame clamps)
  const thickness = Math.max(10, cfg?.thickness ?? step.thickness ?? 600);
  const conformality = cfg?.conformality ?? 'flat';

  if (conformality === 'conformal') {
    const { yBottom, yTop } = computeDryFilmProfile(
      columns,
      totalWidth,
      targetSide,
      thickness,
      70
    );
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      if (col.segments.length === 0 || yTop[i] <= yBottom[i]) continue;
      const seg: MaterialSegment = {
        yBottom: yBottom[i],
        yTop: yTop[i],
        materialId: matId,
        stepId: step.id,
        side: targetSide,
      };
      if (targetSide === 'front') col.segments.push(seg);
      else col.segments.unshift(seg);
    }
  } else {
    // Flat tensioned dicing frame tape: attaches across full width (bridging kerfs/cavities)
    if (targetSide === 'back') {
      let minBottom = Infinity;
      for (const col of columns) {
        if (col.segments.length === 0) continue;
        const b = getBottomY(col);
        if (b < minBottom) minBottom = b;
      }
      if (minBottom === Infinity) minBottom = 0;
      for (const col of columns) {
        col.segments.unshift({
          yBottom: minBottom - thickness,
          yTop: minBottom,
          materialId: matId,
          stepId: step.id,
          side: 'back',
        });
      }
    } else {
      let maxTop = -Infinity;
      for (const col of columns) {
        if (col.segments.length === 0) continue;
        const t = getTopY(col);
        if (t > maxTop) maxTop = t;
      }
      if (maxTop === -Infinity) maxTop = 0;
      for (const col of columns) {
        col.segments.push({
          yBottom: maxTop,
          yTop: maxTop + thickness,
          materialId: matId,
          stepId: step.id,
          side: 'front',
        });
      }
    }
  }

  if (cfg?.showFrame !== false) {
    // Replace any existing frame reference on the same side
    for (let k = activeFrames.length - 1; k >= 0; k--) {
      if (activeFrames[k].side === targetSide) activeFrames.splice(k, 1);
    }
    activeFrames.push({ stepId: step.id, side: targetSide, materialId: matId });
  }
}

/**
 * Handles Wafer Dicing (Blade Saw, Laser Ablation, Stealth, Plasma):
 * - 'through-wafer': Cuts through all wafer/device/DAF layers, scoring into mounted carrier tape (or full cut if no tape)
 * - 'partial-depth': Precision partial kerf cut / pre-groove (e.g. DBG / low-k laser grooving)
 */
function applyDicingSide(
  columns: ColumnProfile[],
  step: ProcessStep,
  totalWidth: number,
  targetSide: 'front' | 'back'
): void {
  const cfg = step.dicing;
  const kerfWidth = Math.max(10, cfg?.kerfWidth ?? 400);
  const halfKerf = kerfWidth / 2;
  const cutMode = cfg?.cutMode ?? 'through-wafer';
  const cutDepth = Math.max(10, cfg?.cutDepth ?? step.thickness ?? 1500);
  const sidewallAngle = Math.max(55, Math.min(90, cfg?.sidewallAngle ?? 90));
  const tapeOvercut = Math.max(0, cfg?.tapeOvercut ?? 120);
  const streets =
    cfg?.streets && cfg.streets.length > 0
      ? cfg.streets
      : [{ id: 'st_default', xCenter: totalWidth * 0.5 }];

  const tanAngle =
    sidewallAngle < 89.5 ? Math.tan((sidewallAngle * Math.PI) / 180) : Infinity;

  const trimSegmentsFromTop = (col: ColumnProfile, cutPlaneY: number) => {
    const nextSegs: MaterialSegment[] = [];
    for (const seg of col.segments) {
      if (seg.yBottom >= cutPlaneY) continue;
      if (seg.yTop > cutPlaneY) {
        nextSegs.push({ ...seg, yTop: cutPlaneY });
      } else {
        nextSegs.push(seg);
      }
    }
    col.segments = nextSegs;
  };

  const trimSegmentsFromBottom = (col: ColumnProfile, cutPlaneY: number) => {
    const nextSegs: MaterialSegment[] = [];
    for (const seg of col.segments) {
      if (seg.yTop <= cutPlaneY) continue;
      if (seg.yBottom < cutPlaneY) {
        nextSegs.push({ ...seg, yBottom: cutPlaneY });
      } else {
        nextSegs.push(seg);
      }
    }
    col.segments = nextSegs;
  };

  for (const col of columns) {
    if (col.segments.length === 0) continue;

    let minDist = Infinity;
    for (const st of streets) {
      const d = Math.abs(col.x - st.xCenter);
      if (d < minDist) minDist = d;
    }
    if (minDist > halfKerf) continue;

    const lateralInset = Math.max(0, halfKerf - minDist);
    const taperMaxDepth =
      tanAngle < Infinity ? lateralInset * tanAngle : Infinity;

    const surfaceY = targetSide === 'front' ? getTopY(col) : getBottomY(col);

    if (cutMode === 'partial-depth') {
      const effectiveDepth = Math.min(cutDepth, taperMaxDepth);
      if (effectiveDepth <= 0) continue;
      if (targetSide === 'front') {
        trimSegmentsFromTop(col, surfaceY - effectiveDepth);
      } else {
        trimSegmentsFromBottom(col, surfaceY + effectiveDepth);
      }
      continue;
    }

    // Through-wafer cut: check for carrier dicing tape at the opposite side
    if (targetSide === 'front') {
      let tapeCount = 0;
      for (let i = 0; i < col.segments.length; i++) {
        if (CARRIER_TAPE_IDS.has(col.segments[i].materialId)) {
          tapeCount++;
        } else {
          break;
        }
      }

      if (tapeCount > 0) {
        const topTapeSeg = col.segments[tapeCount - 1];
        const tapeHeight = topTapeSeg.yTop - col.segments[0].yBottom;
        const safeOvercut = Math.min(tapeOvercut, tapeHeight * 0.65);
        const targetPlaneY = topTapeSeg.yTop - safeOvercut;
        const finalPlaneY =
          taperMaxDepth < Infinity
            ? Math.max(targetPlaneY, surfaceY - taperMaxDepth)
            : targetPlaneY;
        trimSegmentsFromTop(col, finalPlaneY);
      } else if (taperMaxDepth < Infinity) {
        trimSegmentsFromTop(col, surfaceY - taperMaxDepth);
      } else {
        col.segments = [];
      }
    } else {
      let tapeCount = 0;
      for (let i = col.segments.length - 1; i >= 0; i--) {
        if (CARRIER_TAPE_IDS.has(col.segments[i].materialId)) {
          tapeCount++;
        } else {
          break;
        }
      }

      if (tapeCount > 0) {
        const botTapeSeg = col.segments[col.segments.length - tapeCount];
        const tapeHeight = col.segments[col.segments.length - 1].yTop - botTapeSeg.yBottom;
        const safeOvercut = Math.min(tapeOvercut, tapeHeight * 0.65);
        const targetPlaneY = botTapeSeg.yBottom + safeOvercut;
        const finalPlaneY =
          taperMaxDepth < Infinity
            ? Math.min(targetPlaneY, surfaceY + taperMaxDepth)
            : targetPlaneY;
        trimSegmentsFromBottom(col, finalPlaneY);
      } else if (taperMaxDepth < Infinity) {
        trimSegmentsFromBottom(col, surfaceY + taperMaxDepth);
      } else {
        col.segments = [];
      }
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

  const rawCycles = Math.max(1, Math.round(wallHeight / Math.max(5, wall.scallopPitch)));
  const numCycles = Math.min(80, rawCycles);
  const ptsPerCycle = numCycles > 35 ? 6 : 10;
  const totalSteps = numCycles * ptsPerCycle;
  const dir = wall.wallSide === 'left' ? -1 : 1;
  const dTop = wall.scallopDepth;
  const dBot = wall.scallopBottomDepth ?? wall.scallopDepth;

  const evalPointAtT = (t: number) => {
    const tc = Math.max(0, Math.min(1, t));
    const y = wall.yTop + tc * dyWall;
    const xBase = wall.xTop + tc * (wall.xBot - wall.xTop);
    const cyclePos = tc * numCycles;
    const u = cyclePos - Math.floor(cyclePos);
    const localDepth = dTop + tc * (dBot - dTop);
    const indent = localDepth * 2 * Math.sqrt(Math.max(0, u * (1 - u)));
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
    const matchedSegs = new Set<number>();
    const matchedRegs = new Set<ActiveRegion>();

    const attach = (r: ActiveRegion, sIdx: number) => {
      const seg = col.segments[sIdx];
      r.endCol = c;
      r.topYs.push(seg.yTop);
      r.bottomYs.push(seg.yBottom);
      matchedSegs.add(sIdx);
      matchedRegs.add(r);
    };

    // Pass 1: tight match on both top & bottom edges (<100nm), in activeRegions order
    for (const r of activeRegions) {
      if (r.endCol !== c - 1 || matchedRegs.has(r)) continue;
      const prevTop = r.topYs[r.topYs.length - 1];
      const prevBottom = r.bottomYs[r.bottomYs.length - 1];
      let bestIdx = -1;
      let bestCost = Infinity;
      for (let sIdx = 0; sIdx < col.segments.length; sIdx++) {
        if (matchedSegs.has(sIdx)) continue;
        const seg = col.segments[sIdx];
        if (r.materialId !== seg.materialId) continue;
        const topDiff = Math.abs(prevTop - seg.yTop);
        const botDiff = Math.abs(prevBottom - seg.yBottom);
        if (topDiff < 100 && botDiff < 100 && topDiff + botDiff < bestCost) {
          bestCost = topDiff + botDiff;
          bestIdx = sIdx;
        }
      }
      if (bestIdx !== -1) attach(r, bestIdx);
    }

    // Pass 2: same-step vertical overlap with near-exact top or bottom edge continuity (<5nm)
    // (prevents ceiling/floor regions from jumping onto detached diagonal ribbons)
    for (const r of activeRegions) {
      if (r.endCol !== c - 1 || matchedRegs.has(r) || !r.stepId) continue;
      const prevTop = r.topYs[r.topYs.length - 1];
      const prevBottom = r.bottomYs[r.bottomYs.length - 1];
      let bestIdx = -1;
      let bestEdgeDiff = Infinity;
      for (let sIdx = 0; sIdx < col.segments.length; sIdx++) {
        if (matchedSegs.has(sIdx)) continue;
        const seg = col.segments[sIdx];
        if (r.materialId !== seg.materialId || r.stepId !== seg.stepId) continue;
        const overlaps = Math.max(prevBottom, seg.yBottom) <= Math.min(prevTop, seg.yTop) + 5;
        if (!overlaps) continue;
        const minEdgeDiff = Math.min(Math.abs(prevTop - seg.yTop), Math.abs(prevBottom - seg.yBottom));
        if (minEdgeDiff < 5 && minEdgeDiff < bestEdgeDiff) {
          bestEdgeDiff = minEdgeDiff;
          bestIdx = sIdx;
        }
      }
      if (bestIdx !== -1) attach(r, bestIdx);
    }

    // Pass 3: remaining same-step vertical overlaps (keeps sloped/tapered polygons continuous)
    for (const r of activeRegions) {
      if (r.endCol !== c - 1 || matchedRegs.has(r) || !r.stepId) continue;
      const prevTop = r.topYs[r.topYs.length - 1];
      const prevBottom = r.bottomYs[r.bottomYs.length - 1];
      for (let sIdx = 0; sIdx < col.segments.length; sIdx++) {
        if (matchedSegs.has(sIdx)) continue;
        const seg = col.segments[sIdx];
        if (r.materialId !== seg.materialId || r.stepId !== seg.stepId) continue;
        const overlaps = Math.max(prevBottom, seg.yBottom) <= Math.min(prevTop, seg.yTop) + 5;
        if (overlaps) {
          attach(r, sIdx);
          break;
        }
      }
    }

    // Pass 4: slope-continuity pairing for thin/directional/bottom-up layers on steep slopes
    // where vertical thickness < per-column elevation step so [yBottom, yTop] don't overlap.
    if (c > 0) {
      const prevCol = columns[c - 1];
      for (const r of activeRegions) {
        if (r.endCol !== c - 1 || matchedRegs.has(r) || !r.stepId) continue;
        const prevTop = r.topYs[r.topYs.length - 1];
        const prevBottom = r.bottomYs[r.bottomYs.length - 1];
        const prevThick = prevTop - prevBottom;
        if (prevThick <= 0) continue;

        const prevSegIdx = prevCol.segments.findIndex(
          (ps) =>
            ps.materialId === r.materialId &&
            ps.stepId === r.stepId &&
            Math.abs(ps.yTop - prevTop) < 1e-4 &&
            Math.abs(ps.yBottom - prevBottom) < 1e-4
        );
        if (prevSegIdx === -1) continue;

        let bestIdx = -1;
        let bestDiff = Infinity;
        for (let sIdx = 0; sIdx < col.segments.length; sIdx++) {
          if (matchedSegs.has(sIdx)) continue;
          const seg = col.segments[sIdx];
          if (r.materialId !== seg.materialId || r.stepId !== seg.stepId) continue;
          const currThick = seg.yTop - seg.yBottom;
          if (currThick <= 0) continue;
          if (Math.min(prevThick, currThick) < 0.35 * Math.max(prevThick, currThick)) continue;

          // Require direct solid interface contact (never bridge across floating voids/air gaps)
          const prevBelow = prevSegIdx > 0 ? prevCol.segments[prevSegIdx - 1] : undefined;
          const currBelow = sIdx > 0 ? col.segments[sIdx - 1] : undefined;
          const frontTouch =
            (prevSegIdx === 0 && sIdx === 0) ||
            (prevBelow !== undefined &&
              currBelow !== undefined &&
              Math.abs(prevBottom - prevBelow.yTop) <= 2 &&
              Math.abs(seg.yBottom - currBelow.yTop) <= 2);

          const prevAbove =
            prevSegIdx + 1 < prevCol.segments.length
              ? prevCol.segments[prevSegIdx + 1]
              : undefined;
          const currAbove =
            sIdx + 1 < col.segments.length ? col.segments[sIdx + 1] : undefined;
          const backTouch =
            (prevSegIdx === prevCol.segments.length - 1 && sIdx === col.segments.length - 1) ||
            (prevAbove !== undefined &&
              currAbove !== undefined &&
              Math.abs(prevTop - prevAbove.yBottom) <= 2 &&
              Math.abs(seg.yTop - currAbove.yBottom) <= 2);

          if (!frontTouch && !backTouch) continue;

          // Never bridge across a photoresist lift-off step cliff
          if (frontTouch && prevBelow && currBelow) {
            const prevIsResist =
              getMaterialById(_materials, prevBelow.materialId).category === 'photoresist';
            const currIsResist =
              getMaterialById(_materials, currBelow.materialId).category === 'photoresist';
            if (prevIsResist !== currIsResist) continue;
          }
          if (backTouch && prevAbove && currAbove) {
            const prevIsResist =
              getMaterialById(_materials, prevAbove.materialId).category === 'photoresist';
            const currIsResist =
              getMaterialById(_materials, currAbove.materialId).category === 'photoresist';
            if (prevIsResist !== currIsResist) continue;
          }

          const dyTop = seg.yTop - prevTop;
          const dyBot = seg.yBottom - prevBottom;
          if (dyTop * dyBot <= 0) continue;
          if (Math.abs(dyTop - dyBot) > Math.max(prevThick, currThick) + 5) continue;

          const spanMin = Math.min(prevBottom, seg.yBottom);
          const spanMax = Math.max(prevTop, seg.yTop);

          // Never bridge across a vertical or re-entrant wall cliff
          const blockedByCliffWall = scallopWalls.some((w) => {
            const isVerticalOrReentrant =
              Boolean(w.isReentrant) ||
              (w.scallopDepth <= 0.5 && Math.abs(w.xTop - w.xBot) <= 0.5);
            if (!isVerticalOrReentrant) return false;
            const wMinY = Math.min(w.yTop, w.yBot);
            const wMaxY = Math.max(w.yTop, w.yBot);
            if (wMaxY < spanMin - 5 || wMinY > spanMax + 5) return false;
            const xMin = Math.min(w.xTop, w.xBot);
            const xMax = Math.max(w.xTop, w.xBot);
            return (
              (w.colTop === c - 1 && w.colBot === c) ||
              (w.colTop === c && w.colBot === c - 1) ||
              (xMin <= c * dx + dx * 0.6 && xMax >= c * dx - dx * 0.6)
            );
          });
          if (blockedByCliffWall) continue;

          // Connect only when riding a positive-taper wall or a continuous multi-column slope
          const onPosTaperWall = scallopWalls.some((w) => {
            if (w.isReentrant || Math.abs(w.xTop - w.xBot) <= 0.5) return false;
            const wMinY = Math.min(w.yTop, w.yBot);
            const wMaxY = Math.max(w.yTop, w.yBot);
            if (wMaxY < spanMin - 5 || wMinY > spanMax + 5) return false;
            const xMin = Math.min(w.xTop, w.xBot);
            const xMax = Math.max(w.xTop, w.xBot);
            return c * dx >= xMin - dx && c * dx <= xMax + dx;
          });

          const leftDy =
            r.topYs.length >= 2
              ? r.topYs[r.topYs.length - 1] - r.topYs[r.topYs.length - 2]
              : 0;
          const hasLeftSlope =
            r.topYs.length >= 2 &&
            leftDy * dyTop > 0 &&
            Math.abs(leftDy) > 0.15 * Math.abs(dyTop);

          let hasRightSlope = false;
          if (c + 1 < columns.length) {
            for (const ns of columns[c + 1].segments) {
              if (ns.materialId !== seg.materialId || ns.stepId !== seg.stepId) continue;
              const nextThick = ns.yTop - ns.yBottom;
              if (Math.min(currThick, nextThick) < 0.35 * Math.max(currThick, nextThick)) {
                continue;
              }
              const rightDy = ns.yTop - seg.yTop;
              if (rightDy * dyTop > 0 && Math.abs(rightDy) > 0.15 * Math.abs(dyTop)) {
                hasRightSlope = true;
                break;
              }
            }
          }

          if (!onPosTaperWall && !hasLeftSlope && !hasRightSlope) continue;

          const cost = Math.abs(dyTop) + Math.abs(dyBot);
          if (cost < bestDiff) {
            bestDiff = cost;
            bestIdx = sIdx;
          }
        }
        if (bestIdx !== -1) attach(r, bestIdx);
      }
    }

    for (let sIdx = 0; sIdx < col.segments.length; sIdx++) {
      if (matchedSegs.has(sIdx)) continue;
      const seg = col.segments[sIdx];
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

  // Absorb carved re-entrant overhang child regions back into their monolithic etched substrate base
  // (only for etched re-entrant walls, never for deposited conformal inner overhangs).
  for (let k = activeRegions.length - 1; k >= 0; k--) {
    const regOv = activeRegions[k];
    let mergedIntoBase = false;
    for (const w of scallopWalls) {
      if (!w.isReentrant || w.isDepositionWall || regOv.stepId === w.stepId) continue;
      const wMinX = Math.min(w.xTop, w.xBot);
      const wMaxX = Math.max(w.xTop, w.xBot);
      if (
        regOv.startCol * dx < wMinX - dx - 1 ||
        (regOv.endCol + 1) * dx > wMaxX + dx + 1
      ) {
        continue;
      }
      if (w.wallSide === 'left' && regOv.endCol > w.colTop + 1) continue;
      if (w.wallSide === 'right' && regOv.startCol < w.colTop - 1) continue;

      const anchorCol = w.wallSide === 'left' ? regOv.startCol - 1 : regOv.endCol + 1;
      if (anchorCol < 0 || anchorCol >= columns.length) continue;

      const base = activeRegions.find((r, rIdx) => {
        if (rIdx === k) return false;
        if (r.materialId !== regOv.materialId || r.stepId !== regOv.stepId) return false;
        if (
          r.startCol > Math.min(anchorCol, regOv.startCol) ||
          r.endCol < Math.max(anchorCol, regOv.endCol)
        ) {
          return false;
        }
        const aLocal = anchorCol - r.startCol;
        const ovEdge = w.wallSide === 'left' ? 0 : regOv.topYs.length - 1;
        if (w.targetSide === 'front') {
          if (Math.abs(r.topYs[aLocal] - regOv.topYs[ovEdge]) > 120) return false;
          for (let c = regOv.startCol; c <= regOv.endCol; c++) {
            if (r.topYs[c - r.startCol] >= regOv.bottomYs[c - regOv.startCol] - 1) {
              return false;
            }
          }
          return true;
        } else {
          if (Math.abs(r.bottomYs[aLocal] - regOv.bottomYs[ovEdge]) > 120) return false;
          for (let c = regOv.startCol; c <= regOv.endCol; c++) {
            if (r.bottomYs[c - r.startCol] <= regOv.topYs[c - regOv.startCol] + 1) {
              return false;
            }
          }
          return true;
        }
      });

      if (base) {
        for (let c = regOv.startCol; c <= regOv.endCol; c++) {
          if (w.targetSide === 'front') {
            base.topYs[c - base.startCol] = regOv.topYs[c - regOv.startCol];
          } else {
            base.bottomYs[c - base.startCol] = regOv.bottomYs[c - regOv.startCol];
          }
        }
        activeRegions.splice(k, 1);
        mergedIntoBase = true;
        break;
      }
    }
    if (mergedIntoBase) continue;
  }

  // Reunite monolithic etched substrate halves that split when the overhang came first in column order
  // (e.g. backside re-entrant etch left overhang [0..y] before upper roof [y_trench..H]).
  let reunitedAny = true;
  while (reunitedAny) {
    reunitedAny = false;
    for (let a = 0; a < activeRegions.length && !reunitedAny; a++) {
      const rA = activeRegions[a];
      // Never merge conformal/semi-conformal deposited coatings across their own trench air gaps
      if (scallopWalls.some((wd) => Boolean(wd.isDepositionWall) && wd.stepId === rA.stepId)) {
        continue;
      }
      for (let b = a + 1; b < activeRegions.length && !reunitedAny; b++) {
        const rB = activeRegions[b];
        if (rA.materialId !== rB.materialId || rA.stepId !== rB.stepId) continue;
        const ovStart = Math.max(rA.startCol, rB.startCol);
        const ovEnd = Math.min(rA.endCol, rB.endCol);
        if (ovStart > ovEnd) continue;

        for (const w of scallopWalls) {
          if (!w.isReentrant || w.isDepositionWall || rA.stepId === w.stepId) continue;
          const wMinX = Math.min(w.xTop, w.xBot);
          const wMaxX = Math.max(w.xTop, w.xBot);
          if (ovStart * dx < wMinX - dx - 1 || (ovEnd + 1) * dx > wMaxX + dx + 1) continue;

          const leftReg = rA.startCol <= rB.startCol ? rA : rB;
          const rightReg = leftReg === rA ? rB : rA;
          const rightIdx = rightReg === rA ? a : b;

          if (w.wallSide === 'left' && leftReg.endCol > w.colTop + 1) continue;
          if (w.wallSide === 'right' && rightReg.startCol < w.colTop - 1) continue;

          const extReg = w.wallSide === 'left' ? leftReg : rightReg;
          const baseReg = w.wallSide === 'left' ? rightReg : leftReg;
          const extCol = w.wallSide === 'left' ? ovStart - 1 : ovEnd + 1;
          if (extCol < extReg.startCol || extCol > extReg.endCol) continue;

          const extLocal = extCol - extReg.startCol;
          const ovEdgeCol = w.wallSide === 'left' ? ovStart : ovEnd;
          const ovBaseLocal = ovEdgeCol - baseReg.startCol;
          if (w.targetSide === 'front') {
            if (Math.abs(extReg.bottomYs[extLocal] - baseReg.bottomYs[ovBaseLocal]) > 120) continue;
          } else {
            if (Math.abs(extReg.topYs[extLocal] - baseReg.topYs[ovBaseLocal]) > 120) continue;
          }

          let validGap = true;
          for (let c = ovStart; c <= ovEnd; c++) {
            const extSideTop = extReg.topYs[c - extReg.startCol];
            const extSideBot = extReg.bottomYs[c - extReg.startCol];
            const baseTop = baseReg.topYs[c - baseReg.startCol];
            const baseBot = baseReg.bottomYs[c - baseReg.startCol];
            if (w.targetSide === 'front') {
              if (baseTop >= extSideBot - 1) {
                validGap = false;
                break;
              }
            } else {
              if (extSideTop >= baseBot - 1) {
                validGap = false;
                break;
              }
            }
          }
          if (!validGap) continue;

          const newStart = Math.min(leftReg.startCol, rightReg.startCol);
          const newEnd = Math.max(leftReg.endCol, rightReg.endCol);
          const newTopYs: number[] = [];
          const newBottomYs: number[] = [];
          for (let c = newStart; c <= newEnd; c++) {
            const inL = c >= leftReg.startCol && c <= leftReg.endCol;
            const inR = c >= rightReg.startCol && c <= rightReg.endCol;
            if (inL && inR) {
              const li = c - leftReg.startCol;
              const ri = c - rightReg.startCol;
              newTopYs.push(Math.max(leftReg.topYs[li], rightReg.topYs[ri]));
              newBottomYs.push(Math.min(leftReg.bottomYs[li], rightReg.bottomYs[ri]));
            } else if (inL) {
              const li = c - leftReg.startCol;
              newTopYs.push(leftReg.topYs[li]);
              newBottomYs.push(leftReg.bottomYs[li]);
            } else {
              const ri = c - rightReg.startCol;
              newTopYs.push(rightReg.topYs[ri]);
              newBottomYs.push(rightReg.bottomYs[ri]);
            }
          }
          leftReg.startCol = newStart;
          leftReg.endCol = newEnd;
          leftReg.topYs = newTopYs;
          leftReg.bottomYs = newBottomYs;
          activeRegions.splice(rightIdx, 1);
          reunitedAny = true;
          break;
        }
      }
    }
  }

  // Precompute true branch-seam boundary columns per (materialId, stepId) where another region
  // actually starts or ends, so interior columns of sloped ribbons never get staircase vertices.
  const stepRegionSeamXs = new Map<string, Set<number>>();
  const regsByStep = new Map<string, ActiveRegion[]>();
  for (const r of activeRegions) {
    const key = `${r.materialId}::${r.stepId || ''}`;
    let list = regsByStep.get(key);
    if (!list) {
      list = [];
      regsByStep.set(key, list);
    }
    list.push(r);
  }
  for (const [key, list] of regsByStep.entries()) {
    if (list.length < 2) continue;
    const xs = new Set<number>();
    for (const r of list) {
      if (r.startCol > 0) xs.add(r.startCol);
      if (r.endCol + 1 < columns.length) xs.add(r.endCol + 1);
    }
    stepRegionSeamXs.set(key, xs);
  }

  const hasSeparateWedgeRegion = (w: ScallopWall, reg: ActiveRegion): boolean => {
    const wMinC = Math.max(0, Math.floor((Math.min(w.xTop, w.xBot) + 1e-6) / dx));
    const wMaxC = Math.min(
      columns.length - 1,
      Math.floor((Math.max(w.xTop, w.xBot) - 1e-6) / dx)
    );
    const wMinY = Math.min(w.yTop, w.yBot);
    const wMaxY = Math.max(w.yTop, w.yBot);
    return activeRegions.some((other) => {
      if (
        other === reg ||
        other.materialId !== reg.materialId ||
        other.stepId !== reg.stepId
      ) {
        return false;
      }
      const cA = Math.max(other.startCol, wMinC);
      const cB = Math.min(other.endCol, wMaxC);
      if (cA > cB) return false;
      for (let c = cA; c <= cB; c++) {
        const idx = c - other.startCol;
        if (other.bottomYs[idx] < wMaxY - 5 && other.topYs[idx] > wMinY + 5) {
          return true;
        }
      }
      return false;
    });
  };

  const stepOrder = new Map<string, number>();
  for (const ss of mesh.stepSummaries || []) {
    stepOrder.set(ss.stepId, ss.stepIndex);
  }
  const getStepOrder = (stepId?: string): number => {
    if (!stepId || stepId.startsWith('substrate_')) return -1;
    return stepOrder.get(stepId) ?? Number.MAX_SAFE_INTEGER;
  };

  // Can wall `w` trace an outer/etched face of `reg`?
  // Deposition inner walls belong strictly to their own step; etch walls belong only to steps AFTER `reg` was created.
  const canWallShapeRegion = (w: ScallopWall, reg: ActiveRegion): boolean => {
    if (w.isDepositionWall) {
      return Boolean(reg.stepId && w.stepId === reg.stepId);
    }
    if (!reg.stepId || reg.stepId.startsWith('substrate_')) return true;
    const regOrd = stepOrder.get(reg.stepId);
    const wallOrd = stepOrder.get(w.stepId);
    if (regOrd !== undefined && wallOrd !== undefined) {
      return regOrd < wallOrd;
    }
    return w.stepId !== reg.stepId;
  };

  // Can wall `w` act as an underlying surface beneath `reg`?
  // Only walls created strictly BEFORE `reg` was deposited/created.
  const canWallUnderlieRegion = (w: ScallopWall, reg: ActiveRegion): boolean => {
    if (!reg.stepId || reg.stepId.startsWith('substrate_')) return false;
    if (w.stepId === reg.stepId) return false;
    const regOrd = stepOrder.get(reg.stepId);
    const wallOrd = stepOrder.get(w.stepId);
    if (regOrd !== undefined && wallOrd !== undefined) {
      return wallOrd < regOrd;
    }
    return true;
  };

  const findPreferredWall = (pred: (w: ScallopWall) => boolean, stepId?: string): ScallopWall | undefined => {
    let fallback: ScallopWall | undefined;
    for (const w of scallopWalls) {
      if (!pred(w)) continue;
      if (stepId && w.stepId === stepId) return w;
      if (!fallback) fallback = w;
    }
    return fallback;
  };

  const findLatestUnderlyingWall = (pred: (w: ScallopWall) => boolean): ScallopWall | undefined => {
    let best: ScallopWall | undefined;
    let bestOrd = -Infinity;
    for (const w of scallopWalls) {
      if (!pred(w)) continue;
      const ord = getStepOrder(w.stepId);
      if (ord >= bestOrd) {
        bestOrd = ord;
        best = w;
      }
    }
    return best;
  };

  let idCounter = 0;
  for (const reg of activeRegions) {
    idCounter++;
    const pts: { x: number; y: number }[] = [];
    const lastIdx = reg.bottomYs.length - 1;
    const seamCols = stepRegionSeamXs.get(`${reg.materialId}::${reg.stepId || ''}`);
    const mouthCols = new Set<number>();
    for (const w of scallopWalls) {
      if (!w.isReentrant || w.isDepositionWall || w.stepId === reg.stepId) continue;
      mouthCols.add(w.wallSide === 'left' ? w.colTop + 1 : w.colTop);
    }

    // Standalone inner overhang wings (front/back) and outer re-entrant wedge regions
    const standaloneFrontLeftInner = reg.stepId
      ? scallopWalls.find(
          (w) =>
            w.stepId === reg.stepId &&
            w.targetSide === 'front' &&
            w.wallSide === 'left' &&
            Boolean(w.isReentrant) &&
            w.colBot < w.colTop &&
            reg.endCol === w.colTop &&
            reg.startCol === w.colBot + 1 &&
            reg.bottomYs[0] > w.yBot + 5 &&
            Math.min(reg.topYs[lastIdx], w.yTop) - Math.max(reg.bottomYs[lastIdx], w.yBot) > 5
        )
      : undefined;

    const standaloneFrontRightInner = reg.stepId
      ? scallopWalls.find(
          (w) =>
            w.stepId === reg.stepId &&
            w.targetSide === 'front' &&
            w.wallSide === 'right' &&
            Boolean(w.isReentrant) &&
            w.colBot > w.colTop &&
            reg.startCol === w.colTop &&
            reg.endCol === w.colBot - 1 &&
            reg.bottomYs[lastIdx] > w.yBot + 5 &&
            Math.min(reg.topYs[0], w.yTop) - Math.max(reg.bottomYs[0], w.yBot) > 5
        )
      : undefined;

    const standaloneBackLeftInner = reg.stepId
      ? scallopWalls.find(
          (w) =>
            w.stepId === reg.stepId &&
            w.targetSide === 'back' &&
            w.wallSide === 'left' &&
            Boolean(w.isReentrant) &&
            w.colBot < w.colTop &&
            reg.endCol === w.colTop &&
            reg.startCol === w.colBot + 1 &&
            reg.topYs[0] < w.yBot - 5 &&
            Math.min(reg.topYs[lastIdx], w.yBot) - Math.max(reg.bottomYs[lastIdx], w.yTop) > 5
        )
      : undefined;

    const standaloneBackRightInner = reg.stepId
      ? scallopWalls.find(
          (w) =>
            w.stepId === reg.stepId &&
            w.targetSide === 'back' &&
            w.wallSide === 'right' &&
            Boolean(w.isReentrant) &&
            w.colBot > w.colTop &&
            reg.startCol === w.colTop &&
            reg.endCol === w.colBot - 1 &&
            reg.topYs[lastIdx] < w.yBot - 5 &&
            Math.min(reg.topYs[0], w.yBot) - Math.max(reg.bottomYs[0], w.yTop) > 5
        )
      : undefined;

    // Outer re-entrant wedge regions (tucked under/over an earlier re-entrant wall)
    const wedgeFrontLeft = findPreferredWall(
      (w) =>
        w.targetSide === 'front' &&
        w.wallSide === 'left' &&
        Boolean(w.isReentrant) &&
        w.stepId !== reg.stepId &&
        reg.endCol <= w.colTop + 1 &&
        reg.startCol * dx >= Math.min(w.xTop, w.xBot) - dx - 1 &&
        reg.endCol === Math.floor((w.xTop - 1e-6) / dx) &&
        reg.bottomYs[lastIdx] <= w.yBot + 5 &&
        reg.topYs[lastIdx] < w.yTop - 5 &&
        reg.topYs[0] > w.yBot + 5
    );

    const wedgeBackLeft = findPreferredWall(
      (w) =>
        w.targetSide === 'back' &&
        w.wallSide === 'left' &&
        Boolean(w.isReentrant) &&
        w.stepId !== reg.stepId &&
        reg.endCol <= w.colTop + 1 &&
        reg.startCol * dx >= Math.min(w.xTop, w.xBot) - dx - 1 &&
        reg.endCol === Math.floor((w.xTop - 1e-6) / dx) &&
        reg.topYs[lastIdx] >= w.yBot - 5 &&
        reg.bottomYs[lastIdx] > w.yTop + 5 &&
        reg.bottomYs[0] < w.yBot - 5
    );

    const wedgeBackRight = findPreferredWall(
      (w) =>
        w.targetSide === 'back' &&
        w.wallSide === 'right' &&
        Boolean(w.isReentrant) &&
        w.stepId !== reg.stepId &&
        reg.startCol === Math.floor((w.xTop + 1e-6) / dx) &&
        (reg.endCol + 1) * dx <= Math.max(w.xTop, w.xBot) + dx + 1 &&
        reg.topYs[0] >= w.yBot - 5 &&
        reg.bottomYs[0] > w.yTop + 5 &&
        reg.bottomYs[lastIdx] < w.yBot - 5
    );

    // Helper to look up a same-step neighbor region's top or bottom Y at an adjacent column within [yMin, yMax]
    const findNeighborEdgeY = (
      col: number,
      edge: 'top' | 'bottom',
      yMin: number,
      yMax: number
    ): number | undefined => {
      for (const other of activeRegions) {
        if (other === reg || other.materialId !== reg.materialId || other.stepId !== reg.stepId) {
          continue;
        }
        if (col >= other.startCol && col <= other.endCol) {
          const idx = col - other.startCol;
          const val = edge === 'top' ? other.topYs[idx] : other.bottomYs[idx];
          if (val >= yMin - 5 && val <= yMax + 5) {
            return val;
          }
        }
      }
      return undefined;
    };

    const getWallBotCol = (w: ScallopWall): number =>
      Math.max(
        0,
        Math.min(
          columns.length - 1,
          Math.floor((w.xBot + (w.wallSide === 'left' ? 1e-6 : -1e-6)) / dx)
        )
      );

    // Split outer re-entrant wall matchers for thin conformal coatings (< overhang width)
    // where a single underlying etched re-entrant wall spans across floor + detached diagonal ribbon(s).
    let partialOuterFrontLeft: { wall: ScallopWall; splitCol: number } | undefined;
    for (const w of scallopWalls) {
      const wBotCol = getWallBotCol(w);
      if (
        w.targetSide !== 'front' ||
        w.wallSide !== 'left' ||
        !w.isReentrant ||
        w.stepId === reg.stepId ||
        reg.startCol > w.colTop ||
        reg.startCol < wBotCol - 1 ||
        reg.bottomYs[0] > w.yBot + 5
      ) {
        continue;
      }
      const maxCheck = Math.min(reg.endCol, w.colTop + 1);
      for (let sc = reg.startCol + 1; sc <= maxCheck; sc++) {
        if (!seamCols?.has(sc)) continue;
        const prevY = reg.topYs[sc - 1 - reg.startCol];
        const currY = reg.topYs[sc - reg.startCol];
        if (prevY > w.yBot + 50 && currY < prevY - 50) {
          partialOuterFrontLeft = { wall: w, splitCol: sc };
          break;
        }
      }
      if (partialOuterFrontLeft) break;
    }

    let partialOuterFrontRight: { wall: ScallopWall; splitCol: number } | undefined;
    for (const w of scallopWalls) {
      const wBotCol = getWallBotCol(w);
      if (
        w.targetSide !== 'front' ||
        w.wallSide !== 'right' ||
        !w.isReentrant ||
        w.stepId === reg.stepId ||
        reg.endCol < w.colTop ||
        reg.endCol > wBotCol + 1 ||
        reg.bottomYs[lastIdx] > w.yBot + 5
      ) {
        continue;
      }
      const minCheck = Math.max(reg.startCol + 1, w.colTop);
      for (let sc = reg.endCol; sc >= minCheck; sc--) {
        if (!seamCols?.has(sc)) continue;
        const prevY = reg.topYs[sc - 1 - reg.startCol];
        const currY = reg.topYs[sc - reg.startCol];
        if (currY > w.yBot + 50 && prevY < currY - 50) {
          partialOuterFrontRight = { wall: w, splitCol: sc };
          break;
        }
      }
      if (partialOuterFrontRight) break;
    }

    let partialOuterBackRight: { wall: ScallopWall; splitCol: number } | undefined;
    for (const w of scallopWalls) {
      const wBotCol = getWallBotCol(w);
      if (
        w.targetSide !== 'back' ||
        w.wallSide !== 'right' ||
        !w.isReentrant ||
        w.stepId === reg.stepId ||
        reg.endCol < w.colTop ||
        reg.endCol > wBotCol + 1 ||
        reg.topYs[lastIdx] < w.yBot - 5
      ) {
        continue;
      }
      const minCheck = Math.max(reg.startCol + 1, w.colTop);
      for (let sc = reg.endCol; sc >= minCheck; sc--) {
        if (!seamCols?.has(sc)) continue;
        const prevY = reg.bottomYs[sc - 1 - reg.startCol];
        const currY = reg.bottomYs[sc - reg.startCol];
        if (currY < w.yBot - 50 && prevY > currY + 50) {
          partialOuterBackRight = { wall: w, splitCol: sc };
          break;
        }
      }
      if (partialOuterBackRight) break;
    }

    let partialOuterBackLeft: { wall: ScallopWall; splitCol: number } | undefined;
    for (const w of scallopWalls) {
      const wBotCol = getWallBotCol(w);
      if (
        w.targetSide !== 'back' ||
        w.wallSide !== 'left' ||
        !w.isReentrant ||
        w.stepId === reg.stepId ||
        reg.startCol > w.colTop ||
        reg.startCol < wBotCol - 1 ||
        reg.topYs[0] < w.yBot - 5
      ) {
        continue;
      }
      const maxCheck = Math.min(reg.endCol, w.colTop + 1);
      for (let sc = reg.startCol + 1; sc <= maxCheck; sc++) {
        if (!seamCols?.has(sc)) continue;
        const prevY = reg.bottomYs[sc - 1 - reg.startCol];
        const currY = reg.bottomYs[sc - reg.startCol];
        if (prevY < w.yBot - 50 && currY > prevY + 50) {
          partialOuterBackLeft = { wall: w, splitCol: sc };
          break;
        }
      }
      if (partialOuterBackLeft) break;
    }

    // Detached diagonal ribbon regions resting against upper slice of an underlying re-entrant wall
    const diagOuterFrontLeft = (() => {
      for (const w of scallopWalls) {
        const wBotCol = getWallBotCol(w);
        if (
          w.targetSide !== 'front' ||
          w.wallSide !== 'left' ||
          !w.isReentrant ||
          w.stepId === reg.stepId ||
          reg.endCol !== w.colTop ||
          reg.startCol <= wBotCol ||
          reg.bottomYs[0] <= w.yBot + 5
        ) {
          continue;
        }
        const yJoin = findNeighborEdgeY(reg.startCol - 1, 'top', reg.bottomYs[0], reg.topYs[0]);
        if (yJoin !== undefined && yJoin > w.yBot + 5) {
          return { wall: w, yJoin };
        }
      }
      return undefined;
    })();

    const diagOuterFrontRight = (() => {
      for (const w of scallopWalls) {
        const wBotCol = getWallBotCol(w);
        if (
          w.targetSide !== 'front' ||
          w.wallSide !== 'right' ||
          !w.isReentrant ||
          w.stepId === reg.stepId ||
          reg.startCol > w.colTop ||
          (reg.startCol < w.colTop && seamCols?.has(w.colTop + 1)) ||
          reg.endCol < w.colTop ||
          reg.endCol >= wBotCol ||
          reg.bottomYs[lastIdx] <= w.yBot + 5
        ) {
          continue;
        }
        const yJoin = findNeighborEdgeY(reg.endCol + 1, 'top', reg.bottomYs[lastIdx], reg.topYs[lastIdx]);
        if (yJoin !== undefined && yJoin > w.yBot + 5) {
          return { wall: w, yJoin };
        }
      }
      return undefined;
    })();

    const diagOuterBackLeft = (() => {
      for (const w of scallopWalls) {
        const wBotCol = getWallBotCol(w);
        if (
          w.targetSide !== 'back' ||
          w.wallSide !== 'left' ||
          !w.isReentrant ||
          w.stepId === reg.stepId ||
          reg.endCol !== w.colTop ||
          reg.topYs[lastIdx] >= w.yBot - 5
        ) {
          continue;
        }
        if (reg.startCol <= wBotCol && reg.topYs[0] >= w.yBot - 5 && reg.bottomYs[lastIdx] > w.yTop + 5) {
          return { wall: w, yJoin: w.yBot };
        }
        if (reg.startCol > wBotCol && reg.topYs[0] < w.yBot - 5) {
          const yJoin = findNeighborEdgeY(reg.startCol - 1, 'bottom', reg.bottomYs[0], reg.topYs[0]);
          if (yJoin !== undefined && yJoin < w.yBot - 5) {
            return { wall: w, yJoin };
          }
        }
      }
      return undefined;
    })();

    const diagOuterBackRight = (() => {
      for (const w of scallopWalls) {
        const wBotCol = getWallBotCol(w);
        if (
          w.targetSide !== 'back' ||
          w.wallSide !== 'right' ||
          !w.isReentrant ||
          w.stepId === reg.stepId ||
          reg.startCol !== w.colTop ||
          reg.topYs[0] >= w.yBot - 5
        ) {
          continue;
        }
        if (reg.endCol >= wBotCol && reg.topYs[lastIdx] >= w.yBot - 5 && reg.bottomYs[0] > w.yTop + 5) {
          return { wall: w, yJoin: w.yBot };
        }
        if (reg.endCol < wBotCol && reg.topYs[lastIdx] < w.yBot - 5) {
          const yJoin = findNeighborEdgeY(reg.endCol + 1, 'bottom', reg.bottomYs[lastIdx], reg.topYs[lastIdx]);
          if (yJoin !== undefined && yJoin < w.yBot - 5) {
            return { wall: w, yJoin };
          }
        }
      }
      return undefined;
    })();

    // Connected outer climbing / inner overhang walls
    const reentrantOuterFrontLeft =
      partialOuterFrontLeft || diagOuterFrontLeft
        ? undefined
        : findPreferredWall(
            (w) =>
              w.targetSide === 'front' &&
              w.wallSide === 'left' &&
              Boolean(w.isReentrant) &&
              w.stepId !== reg.stepId &&
              reg.startCol <= w.colTop &&
              reg.endCol > w.colTop &&
              reg.bottomYs[w.colTop - reg.startCol] <= w.yBot + 5 &&
              reg.topYs[w.colTop - reg.startCol] > w.yBot + 5 &&
              reg.topYs[w.colTop + 1 - reg.startCol] < w.yTop - 5 &&
              (w.colTop === reg.startCol ||
                reg.topYs[w.colTop - reg.startCol] - reg.topYs[w.colTop - 1 - reg.startCol] > 50) &&
              reg.startCol * dx <= Math.max(w.xTop, w.xBot) + 1 &&
              reg.startCol * dx >= Math.min(w.xTop, w.xBot) - dx - 1
          );
    const reentrantOuterFrontLeftStartCol = reentrantOuterFrontLeft
      ? Math.max(
          reg.startCol,
          Math.min(
            reentrantOuterFrontLeft.colTop,
            Math.floor((Math.min(reentrantOuterFrontLeft.xTop, reentrantOuterFrontLeft.xBot) + 1e-6) / dx)
          )
        )
      : -1;

    const reentrantInnerFrontRightOverhang =
      !standaloneFrontRightInner && reg.stepId
        ? scallopWalls.find(
            (w) =>
              w.stepId === reg.stepId &&
              w.targetSide === 'front' &&
              w.wallSide === 'right' &&
              Boolean(w.isReentrant) &&
              w.colTop === reg.startCol &&
              w.colBot > w.colTop &&
              reg.endCol > w.colBot &&
              reg.bottomYs[w.colBot + 1 - reg.startCol] >= w.yTop - 5 &&
              (!w.isDepositionWall || reg.bottomYs[w.colBot - reg.startCol] < w.yTop - 5) &&
              Math.min(reg.topYs[0], Math.max(w.yTop, w.yBot)) -
                Math.max(reg.bottomYs[0], Math.min(w.yTop, w.yBot)) >
                5
          )
        : undefined;

    const reentrantInnerBackRightOverhang =
      !standaloneBackRightInner && reg.stepId
        ? scallopWalls.find(
            (w) =>
              w.stepId === reg.stepId &&
              w.targetSide === 'back' &&
              w.wallSide === 'right' &&
              Boolean(w.isReentrant) &&
              w.colTop === reg.startCol &&
              w.colBot > w.colTop &&
              reg.endCol > w.colBot &&
              reg.topYs[w.colBot + 1 - reg.startCol] <= w.yTop + 5 &&
              (!w.isDepositionWall || reg.topYs[w.colBot - reg.startCol] > w.yTop + 5) &&
              Math.min(reg.topYs[0], Math.max(w.yTop, w.yBot)) -
                Math.max(reg.bottomYs[0], Math.min(w.yTop, w.yBot)) >
                5
          )
        : undefined;

    const reentrantOuterBackLeft =
      partialOuterBackLeft || diagOuterBackLeft
        ? undefined
        : findPreferredWall(
            (w) =>
              w.targetSide === 'back' &&
              w.wallSide === 'left' &&
              Boolean(w.isReentrant) &&
              w.stepId !== reg.stepId &&
              reg.startCol <= w.colTop &&
              reg.endCol > w.colTop &&
              reg.topYs[w.colTop - reg.startCol] >= w.yBot - 5 &&
              reg.bottomYs[w.colTop - reg.startCol] < w.yBot - 5 &&
              reg.bottomYs[w.colTop + 1 - reg.startCol] > w.yTop + 5 &&
              (w.colTop === reg.startCol ||
                reg.bottomYs[w.colTop - 1 - reg.startCol] - reg.bottomYs[w.colTop - reg.startCol] > 50) &&
              reg.startCol * dx <= Math.max(w.xTop, w.xBot) + 1 &&
              reg.startCol * dx >= Math.min(w.xTop, w.xBot) - dx - 1
          );
    const reentrantOuterBackLeftEndCol = reentrantOuterBackLeft
      ? Math.max(
          reg.startCol,
          Math.min(
            reentrantOuterBackLeft.colTop,
            Math.floor((Math.min(reentrantOuterBackLeft.xTop, reentrantOuterBackLeft.xBot) + 1e-6) / dx)
          )
        )
      : -1;

    // Left boundary edge (x = reg.startCol * dx): goes bottom -> top
    const xStart = reg.startCol * dx;
    const xEnd = (reg.endCol + 1) * dx;
    const leftEdgeWall =
      standaloneFrontLeftInner ||
      standaloneFrontRightInner ||
      standaloneBackLeftInner ||
      standaloneBackRightInner ||
      wedgeFrontLeft ||
      wedgeBackLeft ||
      wedgeBackRight ||
      partialOuterFrontLeft ||
      partialOuterBackLeft ||
      diagOuterFrontLeft ||
      diagOuterFrontRight ||
      diagOuterBackLeft ||
      diagOuterBackRight
        ? undefined
        : findPreferredWall(
            (w) =>
              w.wallSide === 'right' &&
              canWallShapeRegion(w, reg) &&
              (!w.isReentrant || w.stepId === reg.stepId) &&
              (w.colTop === reg.startCol ||
                (w.targetSide === 'front' &&
                  reg.startCol > w.colBot &&
                  reg.endCol >= w.colTop &&
                  reg.topYs[w.colTop - reg.startCol] > w.yBot + 5 &&
                  reg.bottomYs[0] < w.yTop - 5) ||
                (w.targetSide === 'back' &&
                  reg.startCol > w.colBot &&
                  reg.endCol >= w.colTop &&
                  reg.bottomYs[w.colTop - reg.startCol] < w.yBot - 5 &&
                  reg.topYs[0] > w.yTop + 5)) &&
              Math.min(reg.topYs[0], Math.max(w.yTop, w.yBot)) -
                Math.max(reg.bottomYs[0], Math.min(w.yTop, w.yBot)) >
                5,
            reg.stepId
          );

    let leftTopTrimX = -Infinity;
    let leftBottomTrimX = -Infinity;
    let topStartIdx = 0;
    let stopBotAtCol = 0;
    let skipBottomLoop = false;

    if (standaloneFrontLeftInner) {
      // Seam edge sits cleanly at xStart from w.yBot up to topYs[0]
      pts.push({ x: xStart, y: standaloneFrontLeftInner.yBot });
      pts.push({ x: xStart, y: reg.topYs[0] });
    } else if (standaloneFrontRightInner) {
      const w = standaloneFrontRightInner;
      pts.push({ x: xEnd, y: w.yBot });
      pts.push({ x: w.xBot, y: w.yBot });
      pts.push(...sampleScallopWallPoints(w, w.yBot, w.yTop, true));
      pts.push({ x: xStart, y: reg.topYs[0] });
      skipBottomLoop = true;
    } else if (standaloneBackLeftInner) {
      const w = standaloneBackLeftInner;
      pts.push({ x: xStart, y: reg.bottomYs[0] });
      pts.push({ x: xStart, y: w.yBot });
      pts.push({ x: w.xBot, y: w.yBot });
      pts.push(...sampleScallopWallPoints(w, w.yBot, w.yTop, true));
      pts.push({ x: w.xTop, y: w.yTop });
      topStartIdx = reg.topYs.length;
    } else if (standaloneBackRightInner) {
      const w = standaloneBackRightInner;
      pts.push({ x: xStart, y: reg.bottomYs[0] });
      pts.push({ x: xStart, y: w.yTop });
      pts.push(...sampleScallopWallPoints(w, w.yTop, w.yBot, true));
      pts.push({ x: xEnd, y: w.yBot });
      topStartIdx = reg.topYs.length;
    } else if (wedgeFrontLeft) {
      pts.push({ x: wedgeFrontLeft.xBot, y: reg.bottomYs[0] });
      leftBottomTrimX = wedgeFrontLeft.xBot;
    } else if (wedgeBackLeft) {
      pts.push({ x: wedgeBackLeft.xBot, y: reg.topYs[0] });
    } else if (wedgeBackRight) {
      pts.push({ x: xStart, y: wedgeBackRight.yTop });
      pts.push({ x: xStart, y: reg.topYs[0] });
    } else if (partialOuterFrontLeft) {
      pts.push({ x: partialOuterFrontLeft.wall.xBot, y: reg.bottomYs[0] });
      leftBottomTrimX = partialOuterFrontLeft.wall.xBot;
    } else if (partialOuterBackLeft) {
      pts.push({ x: partialOuterBackLeft.wall.xBot, y: reg.topYs[0] });
    } else if (diagOuterFrontLeft) {
      pts.push({ x: xStart, y: reg.bottomYs[0] });
      pts.push({ x: xStart, y: diagOuterFrontLeft.yJoin });
    } else if (diagOuterFrontRight) {
      const w = diagOuterFrontRight.wall;
      pts.push({ x: xStart, y: reg.bottomYs[0] });
      if (reg.startCol === w.colTop) {
        pts.push({ x: w.xTop, y: w.yTop });
      } else {
        pts.push({ x: xStart, y: reg.topYs[0] });
      }
    } else if (diagOuterBackLeft) {
      const { wall: w, yJoin } = diagOuterBackLeft;
      if (yJoin === w.yBot) {
        pts.push({ x: w.xBot, y: reg.topYs[0] });
      } else {
        pts.push({ x: xStart, y: yJoin });
        pts.push({ x: xStart, y: reg.topYs[0] });
      }
    } else if (diagOuterBackRight) {
      const w = diagOuterBackRight.wall;
      pts.push({ x: w.xTop, y: w.yTop });
      pts.push({ x: xStart, y: reg.topYs[0] });
    } else if (reentrantOuterFrontLeft && reentrantOuterFrontLeftStartCol === reg.startCol) {
      pts.push({ x: reentrantOuterFrontLeft.xBot, y: reg.bottomYs[0] });
      leftBottomTrimX = reentrantOuterFrontLeft.xBot;
    } else if (reentrantOuterBackLeft && reentrantOuterBackLeftEndCol === reg.startCol) {
      pts.push({ x: reentrantOuterBackLeft.xBot, y: reg.topYs[0] });
    } else if (reentrantInnerFrontRightOverhang) {
      const w = reentrantInnerFrontRightOverhang;
      const anchorX = (w.colBot + 1) * dx;
      pts.push({ x: anchorX, y: w.yBot });
      const yB = Math.min(w.yTop, reg.topYs[0]);
      pts.push(...sampleScallopWallPoints(w, w.yBot, yB, true));
      if (yB < reg.topYs[0] - 0.5) {
        pts.push({ x: xStart, y: reg.topYs[0] });
      } else {
        leftTopTrimX = evalWallXAtY(w, reg.topYs[0]);
      }
      stopBotAtCol = w.colBot + 1 - reg.startCol;
    } else if (reentrantInnerBackRightOverhang) {
      const w = reentrantInnerBackRightOverhang;
      const anchorX = (w.colBot + 1) * dx;
      const yStartWall = Math.max(w.yTop, reg.bottomYs[0]);
      if (yStartWall > reg.bottomYs[0] + 0.5) {
        pts.push({ x: xStart, y: reg.bottomYs[0] });
      }
      pts.push(...sampleScallopWallPoints(w, yStartWall, w.yBot, true));
      pts.push({ x: anchorX, y: w.yBot });
      const resumeLocal = w.colBot + 1 - reg.startCol;
      pts.push({ x: anchorX, y: reg.topYs[resumeLocal] });
      topStartIdx = resumeLocal;
      leftTopTrimX = anchorX;
    } else if (leftEdgeWall) {
      const spansPartialRightWall =
        leftEdgeWall.colTop > reg.startCol && leftEdgeWall.colBot < reg.startCol;
      const topLocalIdx = Math.max(0, leftEdgeWall.colTop - reg.startCol);

      if (leftEdgeWall.targetSide === 'front' && spansPartialRightWall) {
        const yA = Math.max(leftEdgeWall.yBot, reg.bottomYs[0]);
        const yB = Math.min(leftEdgeWall.yTop, reg.topYs[topLocalIdx]);
        const xWallBot = evalWallXAtY(leftEdgeWall, yA);
        if (yA > reg.bottomYs[0] + 0.5) {
          pts.push({ x: xWallBot, y: reg.bottomYs[0] });
        }
        pts.push(...sampleScallopWallPoints(leftEdgeWall, yA, yB, true));
        leftBottomTrimX = xWallBot;
        leftTopTrimX = evalWallXAtY(leftEdgeWall, yB);
        topStartIdx = topLocalIdx;
      } else if (
        leftEdgeWall.targetSide === 'back' &&
        (spansPartialRightWall ||
          (reg.startCol === leftEdgeWall.colTop && reg.startCol > leftEdgeWall.colBot))
      ) {
        const yEnd = Math.min(leftEdgeWall.yBot, reg.topYs[0]);
        if (yEnd < reg.topYs[0] - 0.5) {
          pts.push({ x: xStart, y: yEnd });
          pts.push({ x: xStart, y: reg.topYs[0] });
        } else {
          const xEndTop = evalWallXAtY(leftEdgeWall, reg.topYs[0]);
          pts.push({ x: xEndTop, y: reg.topYs[0] });
          leftTopTrimX = xEndTop;
        }
      } else {
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
      }
    } else {
      pts.push({ x: xStart, y: reg.bottomYs[0] });
      pts.push({ x: xStart, y: reg.topYs[0] });
    }

    // Check right boundary edge early
    const rightEdgeWall =
      standaloneFrontLeftInner ||
      standaloneFrontRightInner ||
      standaloneBackLeftInner ||
      standaloneBackRightInner ||
      wedgeFrontLeft ||
      wedgeBackLeft ||
      wedgeBackRight ||
      partialOuterFrontRight ||
      partialOuterBackRight ||
      diagOuterFrontLeft ||
      diagOuterFrontRight ||
      diagOuterBackLeft ||
      diagOuterBackRight
        ? undefined
        : findPreferredWall(
            (w) =>
              w.wallSide === 'left' &&
              canWallShapeRegion(w, reg) &&
              (!w.isReentrant || w.stepId === reg.stepId) &&
              w.colTop === reg.endCol &&
              Math.min(reg.topYs[lastIdx], Math.max(w.yTop, w.yBot)) -
                Math.max(reg.bottomYs[lastIdx], Math.min(w.yTop, w.yBot)) >
                5,
            reg.stepId
          );

    const reentrantOuterFrontRight =
      partialOuterFrontRight || diagOuterFrontRight
        ? undefined
        : findPreferredWall(
            (w) =>
              w.targetSide === 'front' &&
              w.wallSide === 'right' &&
              Boolean(w.isReentrant) &&
              w.stepId !== reg.stepId &&
              reg.startCol < w.colTop &&
              reg.endCol >= w.colTop &&
              reg.bottomYs[w.colTop - reg.startCol] <= w.yBot + 5 &&
              reg.topYs[w.colTop - reg.startCol] > w.yBot + 5 &&
              reg.topYs[w.colTop - 1 - reg.startCol] < w.yTop - 5 &&
              (w.colTop === reg.endCol ||
                reg.topYs[w.colTop - reg.startCol] - reg.topYs[w.colTop + 1 - reg.startCol] > 50) &&
              (reg.endCol + 1) * dx >= Math.min(w.xTop, w.xBot) - 1 &&
              (reg.endCol + 1) * dx <= Math.max(w.xTop, w.xBot) + dx + 1
          );

    const findBackLeftInnerDropCol = (w: ScallopWall): number => {
      for (const dc of [w.colBot, w.colBot + 1]) {
        if (dc <= reg.startCol || dc >= reg.endCol) continue;
        const local = dc - reg.startCol;
        if (reg.topYs[local - 1] <= w.yTop + 5 && reg.topYs[local] >= w.yBot - 5) {
          return dc;
        }
      }
      return -1;
    };

    const reentrantInnerBackLeftOverhang =
      !standaloneBackLeftInner && reg.stepId
        ? scallopWalls.find(
            (w) =>
              w.stepId === reg.stepId &&
              w.targetSide === 'back' &&
              w.wallSide === 'left' &&
              Boolean(w.isReentrant) &&
              w.colTop === reg.endCol &&
              w.colBot < w.colTop &&
              reg.startCol < w.colBot &&
              (!w.isDepositionWall || reg.topYs[w.colBot - reg.startCol] > w.yTop + 5) &&
              findBackLeftInnerDropCol(w) !== -1 &&
              Math.min(reg.topYs[lastIdx], Math.max(w.yTop, w.yBot)) -
                Math.max(reg.bottomYs[lastIdx], Math.min(w.yTop, w.yBot)) >
                5
          )
        : undefined;
    const reentrantInnerBackLeftDropCol = reentrantInnerBackLeftOverhang
      ? findBackLeftInnerDropCol(reentrantInnerBackLeftOverhang)
      : -1;

    // Top surface left to right
    let minTopXAllowed = leftTopTrimX;
    let handledRightEdgeByWall = false;
    let botStartTrimMaxX = Infinity;
    for (let i = topStartIdx; i < reg.topYs.length; i++) {
      const colIdx = reg.startCol + i;

      // Front left outer wedge (standalone reg under re-entrant wall): trace w up-right to (xEnd, w.yTop)
      if (wedgeFrontLeft && i === 0) {
        pts.push(...sampleScallopWallPoints(wedgeFrontLeft, wedgeFrontLeft.yBot, wedgeFrontLeft.yTop, true));
        pts.push({ x: wedgeFrontLeft.xTop, y: reg.bottomYs[lastIdx] });
        handledRightEdgeByWall = true;
        break;
      }

      // Partial outer front-left re-entrant climb (thin film split before reaching w.colTop)
      if (partialOuterFrontLeft && i === 0) {
        const { wall: w, splitCol } = partialOuterFrontLeft;
        const yStart = Math.max(w.yBot, reg.bottomYs[0]);
        const yJoin = Math.min(w.yTop, reg.topYs[splitCol - 1 - reg.startCol]);
        pts.push(...sampleScallopWallPoints(w, yStart, yJoin, true));
        pts.push({ x: splitCol * dx, y: yJoin });
        pts.push({ x: splitCol * dx, y: reg.topYs[splitCol - reg.startCol] });
        minTopXAllowed = -Infinity;
        i = splitCol - reg.startCol - 1;
        continue;
      }

      // Partial outer front-right re-entrant drop (thin film split before reaching w.colBot)
      if (partialOuterFrontRight && colIdx === partialOuterFrontRight.splitCol) {
        const { wall: w, splitCol } = partialOuterFrontRight;
        const yJoin = Math.min(w.yTop, reg.topYs[i]);
        const yEnd = Math.max(w.yBot, reg.bottomYs[lastIdx]);
        pts.push({ x: splitCol * dx, y: reg.topYs[i - 1] });
        pts.push({ x: splitCol * dx, y: yJoin });
        pts.push(...sampleScallopWallPoints(w, yJoin, yEnd, true));
        if (yEnd > reg.bottomYs[lastIdx] + 0.5) {
          pts.push({ x: w.xBot, y: reg.bottomYs[lastIdx] });
        } else {
          botStartTrimMaxX = w.xBot;
        }
        handledRightEdgeByWall = true;
        break;
      }

      // Detached diagonal ribbon against upper front-left re-entrant wall
      if (diagOuterFrontLeft && i === 0) {
        const { wall: w, yJoin } = diagOuterFrontLeft;
        pts.push(...sampleScallopWallPoints(w, yJoin, w.yTop, true));
        pts.push({ x: xEnd, y: reg.bottomYs[lastIdx] });
        handledRightEdgeByWall = true;
        break;
      }

      // Detached diagonal ribbon against upper front-right re-entrant wall
      if (diagOuterFrontRight && colIdx === diagOuterFrontRight.wall.colTop) {
        const { wall: w, yJoin } = diagOuterFrontRight;
        if (reg.startCol < w.colTop) {
          pts.push({ x: w.xTop, y: w.yTop });
        }
        pts.push(...sampleScallopWallPoints(w, w.yTop, yJoin, true));
        pts.push({ x: xEnd, y: yJoin });
        pts.push({ x: xEnd, y: reg.bottomYs[lastIdx] });
        handledRightEdgeByWall = true;
        break;
      }

      // Re-entrant outer climbing front left wall (regB under left overhang)
      if (reentrantOuterFrontLeft && colIdx === reentrantOuterFrontLeftStartCol) {
        const w = reentrantOuterFrontLeft;
        const dropLocal = w.colTop + 1 - reg.startCol;
        if (w.yBot > reg.bottomYs[0] + 0.5 || i > 0) {
          pts.push({ x: w.xBot, y: w.yBot });
        }
        pts.push(...sampleScallopWallPoints(w, w.yBot, w.yTop, true));
        pts.push({ x: (w.colTop + 1) * dx, y: reg.topYs[dropLocal] });
        minTopXAllowed = -Infinity;
        i = dropLocal;
        continue;
      }

      // Descending outer re-entrant right wall on top edge (e.g. film going down-right into right wedge)
      if (
        seamCols?.has(colIdx) &&
        i > topStartIdx &&
        reg.topYs[i] < reg.topYs[i - 1] - 50
      ) {
        const descendOuterRight = findPreferredWall(
          (w) =>
            w.targetSide === 'front' &&
            w.wallSide === 'right' &&
            Boolean(w.isReentrant) &&
            w.stepId !== reg.stepId &&
            Math.floor((w.xTop + 1e-6) / dx) === colIdx &&
            reg.topYs[i - 1] >= w.yTop - 5 &&
            reg.topYs[i] < w.yTop - 5 &&
            reg.bottomYs[lastIdx] <= w.yBot + 5
        );
        if (descendOuterRight) {
          pts.push({ x: descendOuterRight.xTop, y: descendOuterRight.yTop });
          pts.push(
            ...sampleScallopWallPoints(
              descendOuterRight,
              descendOuterRight.yTop,
              descendOuterRight.yBot,
              true
            )
          );
          if (descendOuterRight.yBot > reg.bottomYs[lastIdx] + 0.5) {
            pts.push({ x: descendOuterRight.xBot, y: reg.bottomYs[lastIdx] });
          }
          botStartTrimMaxX = descendOuterRight.xBot;
          handledRightEdgeByWall = true;
          break;
        }
      }

      // Re-entrant outer dropping front right wall (regB under right overhang)
      if (reentrantOuterFrontRight && colIdx === reentrantOuterFrontRight.colTop - 1) {
        const w = reentrantOuterFrontRight;
        pts.push({ x: (colIdx + 1) * dx, y: reg.topYs[i] });
        pts.push(...sampleScallopWallPoints(w, w.yTop, w.yBot, true));
        if (w.yBot > reg.bottomYs[lastIdx] + 0.5) {
          pts.push({ x: xEnd, y: reg.bottomYs[lastIdx] });
        } else {
          botStartTrimMaxX = w.xBot;
        }
        handledRightEdgeByWall = true;
        break;
      }

      // Backside re-entrant inner left overhang exiting right edge (emit vertical branch seam across dropCol)
      if (
        reentrantInnerBackLeftOverhang &&
        colIdx === reentrantInnerBackLeftDropCol - 1
      ) {
        const w = reentrantInnerBackLeftOverhang;
        const dropCol = reentrantInnerBackLeftDropCol;
        const botLocal = dropCol - reg.startCol;
        pts.push({ x: (colIdx + 1) * dx, y: reg.topYs[i] });
        if (reg.topYs[botLocal] > w.yBot + 5) {
          pts.push({ x: dropCol * dx, y: reg.topYs[botLocal] });
          pts.push({ x: (dropCol + 1) * dx, y: reg.topYs[botLocal] });
        }
        pts.push({ x: (dropCol + 1) * dx, y: w.yBot });
        const yB = Math.max(w.yTop, reg.bottomYs[lastIdx]);
        pts.push(...sampleScallopWallPoints(w, w.yBot, yB, true));
        if (yB > reg.bottomYs[lastIdx] + 0.5) {
          pts.push({ x: xEnd, y: reg.bottomYs[lastIdx] });
        } else {
          botStartTrimMaxX = evalWallXAtY(w, reg.bottomYs[lastIdx]);
        }
        handledRightEdgeByWall = true;
        break;
      }

      // Check for frontside left trench wall starting at colTop
      const frontLeftWall = findPreferredWall(
        (w) =>
          w.targetSide === 'front' &&
          w.wallSide === 'left' &&
          canWallShapeRegion(w, reg) &&
          w.colTop === colIdx &&
          (!w.isReentrant || (w.colBot >= w.colTop && (w.stepId === reg.stepId || reg.endCol > w.colBot))) &&
          reg.topYs[i] > w.yBot + 5 &&
          reg.bottomYs[i] < w.yTop - 5,
        reg.stepId
      );
      if (frontLeftWall) {
        const yStart = Math.min(frontLeftWall.yTop, reg.topYs[i]);
        if (reg.endCol >= frontLeftWall.colBot) {
          let botLocalIdx = frontLeftWall.colBot - reg.startCol;
          if (
            !frontLeftWall.isReentrant &&
            botLocalIdx + 1 < reg.topYs.length &&
            reg.topYs[botLocalIdx] > frontLeftWall.yBot + 5 &&
            reg.topYs[botLocalIdx + 1] <= frontLeftWall.yBot + 5
          ) {
            botLocalIdx++;
          }
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
              if (reg.topYs[botLocalIdx] < frontLeftWall.yBot - 1) {
                pts.push({ x: frontLeftWall.xBot, y: reg.topYs[botLocalIdx] });
              }
              minTopXAllowed = wallPts[wallPts.length - 1].x;
              i = Math.max(i, botLocalIdx - 1);
              continue;
            }
          }
        } else {
          const yEnd = Math.max(frontLeftWall.yBot, reg.bottomYs[lastIdx]);
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
              const xWallEnd = evalWallXAtY(frontLeftWall, yEnd);
              if (yEnd > reg.bottomYs[lastIdx] + 0.5) {
                pts.push({ x: xWallEnd, y: reg.bottomYs[lastIdx] });
              }
              botStartTrimMaxX = xWallEnd;
              handledRightEdgeByWall = true;
              break;
            }
          }
        }
      }

      // Check for frontside right trench wall starting at colBot
      const frontRightWall = findPreferredWall(
        (w) =>
          w.targetSide === 'front' &&
          w.wallSide === 'right' &&
          canWallShapeRegion(w, reg) &&
          w.colBot === colIdx &&
          (!w.isReentrant || (w.colBot <= w.colTop && (w.stepId === reg.stepId || reg.startCol < w.colTop))) &&
          reg.endCol >= w.colTop &&
          reg.topYs[w.colTop - reg.startCol] > w.yBot + 5 &&
          reg.bottomYs[w.colTop - reg.startCol] < w.yTop - 5,
        reg.stepId
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

      // Hug underlying backside scalloped / tapered / vertical / re-entrant trench walls on film top edge
      const underlyingBackLeft = findLatestUnderlyingWall(
        (w) =>
          w.targetSide === 'back' &&
          w.wallSide === 'left' &&
          canWallUnderlieRegion(w, reg) &&
          (!w.isReentrant || w.colBot >= w.colTop) &&
          w.colTop === colIdx &&
          reg.endCol >= w.colBot &&
          reg.topYs[i] <= w.yTop + 5 &&
          reg.topYs[w.colBot - reg.startCol] >= w.yBot - 5 &&
          (!w.isReentrant || !hasSeparateWedgeRegion(w, reg))
      );
      if (underlyingBackLeft) {
        const botLocalIdx = underlyingBackLeft.colBot - reg.startCol;
        const yStart = Math.max(underlyingBackLeft.yTop, reg.topYs[i]);
        const yEnd = Math.min(underlyingBackLeft.yBot, reg.topYs[botLocalIdx]);
        if (yEnd - yStart > 5) {
          const xWallStart = evalWallXAtY(underlyingBackLeft, yStart);
          while (
            pts.length > 2 &&
            pts[pts.length - 1].x >= xWallStart - 0.1 &&
            Math.abs(pts[pts.length - 1].y - yStart) < 5
          ) {
            pts.pop();
          }
          const wallPts = sampleScallopWallPoints(underlyingBackLeft, yStart, yEnd, true);
          if (wallPts.length > 0) {
            pts.push(...wallPts);
            minTopXAllowed = wallPts[wallPts.length - 1].x;
            i = Math.max(i, botLocalIdx - 1);
            continue;
          }
        }
      }

      const underlyingBackRight = findLatestUnderlyingWall(
        (w) =>
          w.targetSide === 'back' &&
          w.wallSide === 'right' &&
          canWallUnderlieRegion(w, reg) &&
          (!w.isReentrant || w.colBot <= w.colTop) &&
          w.colBot === colIdx &&
          reg.startCol <= w.colTop &&
          reg.topYs[w.colTop - reg.startCol] <= w.yTop + 5 &&
          reg.topYs[i] >= w.yBot - 5 &&
          (!w.isReentrant || !hasSeparateWedgeRegion(w, reg))
      );
      if (underlyingBackRight) {
        const topLocalIdx = underlyingBackRight.colTop - reg.startCol;
        const yStart = Math.min(underlyingBackRight.yBot, reg.topYs[i]);
        const yEnd = Math.max(underlyingBackRight.yTop, reg.topYs[topLocalIdx]);
        if (yStart - yEnd > 5) {
          const wallPts = sampleScallopWallPoints(underlyingBackRight, yStart, yEnd, true);
          if (wallPts.length > 0) {
            pts.push(...wallPts);
            minTopXAllowed = evalWallXAtY(underlyingBackRight, yEnd);
            i = Math.max(i, topLocalIdx - 1);
            continue;
          }
        }
      }

      const x = (colIdx + 0.5) * dx;
      if (x <= minTopXAllowed + 0.1) continue;
      minTopXAllowed = -Infinity;
      pts.push({ x, y: reg.topYs[i] });
      if (i + 1 < reg.topYs.length) {
        const dyNext = reg.topYs[i + 1] - reg.topYs[i];
        const dyPrev = i > topStartIdx ? reg.topYs[i] - reg.topYs[i - 1] : 0;
        const dyAfter = i + 2 < reg.topYs.length ? reg.topYs[i + 2] - reg.topYs[i + 1] : 0;
        const isSeamStep = seamCols?.has(colIdx + 1) && Math.abs(dyNext) > 15;
        const isMouthCliff =
          mouthCols.has(colIdx + 1) &&
          Math.abs(dyNext) > 250 &&
          ((i > topStartIdx &&
            (Math.sign(dyPrev) !== Math.sign(dyNext) ||
              Math.abs(dyNext) > 2 * Math.abs(dyPrev) + 50)) ||
            (i + 2 < reg.topYs.length &&
              (Math.sign(dyAfter) !== Math.sign(dyNext) ||
                Math.abs(dyNext) > 2 * Math.abs(dyAfter) + 50)));
        const isIsolatedVerticalCliff =
          Math.abs(dyNext) > Math.max(50, 2.5 * dx) &&
          Math.abs(dyPrev) < 0.2 * Math.abs(dyNext) &&
          Math.abs(dyAfter) < 0.1 * Math.abs(dyNext);
        if (isSeamStep || isMouthCliff || isIsolatedVerticalCliff) {
          const xCliff = (colIdx + 1) * dx;
          pts.push({ x: xCliff, y: reg.topYs[i] });
          pts.push({ x: xCliff, y: reg.topYs[i + 1] });
        }
      }
    }

    // Right boundary edge (x = (reg.endCol + 1) * dx): goes top -> bottom
    let rightBottomTrimX = botStartTrimMaxX;
    let botStartIdx = lastIdx;
    if (handledRightEdgeByWall) {
      // Right edge already traced seamlessly via wall exit
    } else if (standaloneFrontLeftInner) {
      const w = standaloneFrontLeftInner;
      pts.push({ x: xEnd, y: w.yTop });
      pts.push(...sampleScallopWallPoints(w, w.yTop, w.yBot, true));
      pts.push({ x: xStart, y: w.yBot });
      skipBottomLoop = true;
    } else if (standaloneFrontRightInner) {
      pts.push({ x: xEnd, y: standaloneFrontRightInner.yBot });
    } else if (standaloneBackLeftInner) {
      pts.push({ x: xEnd, y: reg.bottomYs[lastIdx] });
    } else if (standaloneBackRightInner) {
      pts.push({ x: xEnd, y: reg.bottomYs[lastIdx] });
    } else if (wedgeBackLeft) {
      pts.push({ x: wedgeBackLeft.xTop, y: wedgeBackLeft.yTop });
      pts.push(...sampleScallopWallPoints(wedgeBackLeft, wedgeBackLeft.yTop, wedgeBackLeft.yBot, true));
      skipBottomLoop = true;
    } else if (wedgeBackRight) {
      pts.push({ x: wedgeBackRight.xBot, y: wedgeBackRight.yBot });
      pts.push(...sampleScallopWallPoints(wedgeBackRight, wedgeBackRight.yBot, wedgeBackRight.yTop, true));
      skipBottomLoop = true;
    } else if (partialOuterBackRight) {
      pts.push({ x: partialOuterBackRight.wall.xBot, y: reg.topYs[lastIdx] });
    } else if (diagOuterBackLeft) {
      const { wall: w, yJoin } = diagOuterBackLeft;
      pts.push({ x: w.xTop, y: w.yTop });
      pts.push(...sampleScallopWallPoints(w, w.yTop, yJoin, true));
      if (yJoin !== w.yBot) {
        pts.push({ x: xStart, y: yJoin });
      }
      skipBottomLoop = true;
    } else if (diagOuterBackRight) {
      const { wall: w, yJoin } = diagOuterBackRight;
      if (yJoin !== w.yBot) {
        pts.push({ x: xEnd, y: yJoin });
      } else {
        pts.push({ x: w.xBot, y: reg.topYs[lastIdx] });
      }
      pts.push(...sampleScallopWallPoints(w, yJoin, w.yTop, true));
      skipBottomLoop = true;
    } else if (
      rightEdgeWall &&
      rightEdgeWall.targetSide === 'front' &&
      rightEdgeWall.isReentrant &&
      rightEdgeWall.colBot < rightEdgeWall.colTop &&
      reg.startCol < rightEdgeWall.colBot &&
      reg.bottomYs[rightEdgeWall.colBot - 1 - reg.startCol] >= rightEdgeWall.yTop - 5 &&
      (!rightEdgeWall.isDepositionWall ||
        reg.bottomYs[rightEdgeWall.colBot - reg.startCol] < rightEdgeWall.yTop - 5)
    ) {
      // Frontside re-entrant inner left overhang bottom-right edge (regA)
      const w = rightEdgeWall;
      const yA = Math.min(reg.topYs[lastIdx], w.yTop);
      if (yA < reg.topYs[lastIdx] - 0.5) {
        pts.push({ x: xEnd, y: reg.topYs[lastIdx] });
      }
      pts.push(...sampleScallopWallPoints(w, yA, w.yBot, true));
      pts.push({ x: w.colBot * dx, y: w.yBot });
      const resumeLocal = w.colBot - 1 - reg.startCol;
      pts.push({ x: w.colBot * dx, y: reg.bottomYs[resumeLocal] });
      botStartIdx = resumeLocal;
      rightBottomTrimX = Infinity;
    } else if (rightEdgeWall) {
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
      const partialBackLeftRightEdge = findPreferredWall(
        (w) =>
          w.targetSide === 'back' &&
          w.wallSide === 'left' &&
          (!w.isReentrant || w.stepId === reg.stepId) &&
          reg.endCol < w.colBot &&
          reg.startCol <= w.colTop &&
          reg.bottomYs[w.colTop - reg.startCol] < w.yBot - 5 &&
          reg.topYs[lastIdx] > w.yTop + 5,
        reg.stepId
      );
      if (partialBackLeftRightEdge) {
        const yB = Math.min(partialBackLeftRightEdge.yBot, reg.topYs[lastIdx]);
        const xWallTop = evalWallXAtY(partialBackLeftRightEdge, yB);
        while (
          pts.length > 2 &&
          pts[pts.length - 1].x >= xWallTop - 0.1 &&
          Math.abs(pts[pts.length - 1].y - yB) < 5
        ) {
          pts.pop();
        }
        if (yB < reg.topYs[lastIdx] - 0.5) {
          pts.push({ x: xEnd, y: reg.topYs[lastIdx] });
        }
        const yBotClip = Math.max(
          partialBackLeftRightEdge.yTop,
          reg.bottomYs[partialBackLeftRightEdge.colTop - reg.startCol]
        );
        pts.push(
          ...sampleScallopWallPoints(
            partialBackLeftRightEdge,
            yB,
            yBotClip,
            true
          )
        );
        rightBottomTrimX = evalWallXAtY(partialBackLeftRightEdge, yBotClip);
        botStartIdx = partialBackLeftRightEdge.colTop - reg.startCol;
      } else {
        pts.push({ x: xEnd, y: reg.topYs[lastIdx] });
        pts.push({ x: xEnd, y: reg.bottomYs[lastIdx] });
      }
    }

    const reentrantOuterBackRight =
      partialOuterBackRight || diagOuterBackRight
        ? undefined
        : findPreferredWall(
            (w) =>
              w.targetSide === 'back' &&
              w.wallSide === 'right' &&
              Boolean(w.isReentrant) &&
              w.stepId !== reg.stepId &&
              reg.startCol < w.colTop &&
              reg.endCol >= w.colTop &&
              reg.topYs[w.colTop - reg.startCol] >= w.yBot - 5 &&
              reg.bottomYs[w.colTop - reg.startCol] < w.yBot - 5 &&
              reg.bottomYs[w.colTop - 1 - reg.startCol] > w.yTop + 5 &&
              (w.colTop === reg.endCol ||
                reg.bottomYs[w.colTop + 1 - reg.startCol] - reg.bottomYs[w.colTop - reg.startCol] > 50) &&
              (reg.endCol + 1) * dx >= Math.min(w.xTop, w.xBot) - 1 &&
              (reg.endCol + 1) * dx <= Math.max(w.xTop, w.xBot) + dx + 1
          );
    const reentrantOuterBackRightStartCol = reentrantOuterBackRight
      ? Math.min(
          reg.endCol,
          Math.max(
            reentrantOuterBackRight.colTop,
            Math.floor((Math.max(reentrantOuterBackRight.xTop, reentrantOuterBackRight.xBot) - 1e-6) / dx)
          )
        )
      : -1;

    // Bottom surface right to left
    let maxBotXAllowed = rightBottomTrimX;
    for (let i = skipBottomLoop ? -1 : botStartIdx; i >= stopBotAtCol; i--) {
      const colIdx = reg.startCol + i;

      if (partialOuterBackRight && i === lastIdx) {
        const { wall: w, splitCol } = partialOuterBackRight;
        const yStart = Math.min(w.yBot, reg.topYs[lastIdx]);
        const yJoin = Math.max(w.yTop, reg.bottomYs[splitCol - reg.startCol]);
        pts.push(...sampleScallopWallPoints(w, yStart, yJoin, true));
        pts.push({ x: splitCol * dx, y: yJoin });
        pts.push({ x: splitCol * dx, y: reg.bottomYs[splitCol - 1 - reg.startCol] });
        maxBotXAllowed = Infinity;
        i = splitCol - reg.startCol;
        continue;
      }

      if (partialOuterBackLeft && colIdx === partialOuterBackLeft.splitCol - 1) {
        const { wall: w, splitCol } = partialOuterBackLeft;
        const yJoin = Math.max(w.yTop, reg.bottomYs[i]);
        const yEnd = Math.min(w.yBot, reg.topYs[0]);
        pts.push({ x: splitCol * dx, y: reg.bottomYs[i + 1] });
        pts.push({ x: splitCol * dx, y: yJoin });
        pts.push(...sampleScallopWallPoints(w, yJoin, yEnd, true));
        break;
      }

      if (reentrantOuterBackRight && colIdx === reentrantOuterBackRightStartCol) {
        const w = reentrantOuterBackRight;
        const dropLocal = w.colTop - 1 - reg.startCol;
        if (i === lastIdx) {
          pts.pop();
        }
        pts.push({ x: w.xBot, y: w.yBot });
        pts.push(...sampleScallopWallPoints(w, w.yBot, w.yTop, true));
        pts.push({ x: w.colTop * dx, y: reg.bottomYs[dropLocal] });
        maxBotXAllowed = Infinity;
        i = dropLocal;
        continue;
      }

      if (reentrantOuterBackLeft && colIdx === reentrantOuterBackLeft.colTop + 1) {
        const w = reentrantOuterBackLeft;
        pts.push({ x: colIdx * dx, y: reg.bottomYs[i] });
        pts.push(...sampleScallopWallPoints(w, w.yTop, w.yBot, true));
        break;
      }

      // Backside right trench wall (iterating right-to-left: meets colTop first, goes up to colBot)
      const backRightWall = findPreferredWall(
        (w) =>
          w.targetSide === 'back' &&
          w.wallSide === 'right' &&
          canWallShapeRegion(w, reg) &&
          w.colTop === colIdx &&
          (!w.isReentrant || (w.colBot <= w.colTop && (w.stepId === reg.stepId || reg.startCol < w.colBot))) &&
          reg.topYs[i] > w.yTop + 5 &&
          reg.bottomYs[i] < w.yBot - 5,
        reg.stepId
      );
      if (backRightWall) {
        const yStart = Math.max(backRightWall.yTop, reg.bottomYs[i]);
        if (reg.startCol <= backRightWall.colBot) {
          let botLocalIdx = backRightWall.colBot - reg.startCol;
          if (
            !backRightWall.isReentrant &&
            botLocalIdx - 1 >= 0 &&
            reg.bottomYs[botLocalIdx] < backRightWall.yBot - 5 &&
            reg.bottomYs[botLocalIdx - 1] >= backRightWall.yBot - 5
          ) {
            botLocalIdx--;
          }
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
              if (reg.bottomYs[botLocalIdx] > backRightWall.yBot + 1) {
                pts.push({ x: backRightWall.xBot, y: reg.bottomYs[botLocalIdx] });
              }
              maxBotXAllowed = wallPts[wallPts.length - 1].x;
              i = Math.min(i, botLocalIdx + 1);
              continue;
            }
          }
        } else {
          const yEnd = Math.min(backRightWall.yBot, reg.topYs[0]);
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
              if (yEnd < reg.topYs[0] - 0.5) {
                pts.push({ x: xStart, y: yEnd });
              }
              break;
            }
          }
        }
      }

      // Backside left trench wall (iterating right-to-left: meets colBot first, goes down to colTop)
      const backLeftWall = findPreferredWall(
        (w) =>
          w.targetSide === 'back' &&
          w.wallSide === 'left' &&
          canWallShapeRegion(w, reg) &&
          w.colBot === colIdx &&
          (!w.isReentrant || (w.colBot >= w.colTop && (w.stepId === reg.stepId || reg.endCol > w.colBot))) &&
          reg.startCol <= w.colTop &&
          reg.bottomYs[i] > w.yTop + 5,
        reg.stepId
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

      // Hug underlying frontside scalloped, tapered, vertical, or re-entrant trench walls cleanly
      const underlyingFrontLeft = findLatestUnderlyingWall(
        (w) =>
          w.targetSide === 'front' &&
          w.wallSide === 'left' &&
          canWallUnderlieRegion(w, reg) &&
          (!w.isReentrant || w.colBot >= w.colTop) &&
          w.colBot === colIdx &&
          reg.startCol <= w.colTop &&
          reg.bottomYs[w.colTop - reg.startCol] >= w.yTop - 5 &&
          reg.bottomYs[i] <= w.yBot + 5 &&
          (!w.isReentrant || !hasSeparateWedgeRegion(w, reg))
      );
      if (underlyingFrontLeft) {
        const topLocalIdx = underlyingFrontLeft.colTop - reg.startCol;
        const yStart = Math.max(underlyingFrontLeft.yBot, reg.bottomYs[i]);
        const yEnd = Math.min(underlyingFrontLeft.yTop, reg.bottomYs[topLocalIdx]);
        if (yEnd - yStart > 5) {
          const xWallStart = evalWallXAtY(underlyingFrontLeft, yStart);
          while (
            pts.length > 2 &&
            pts[pts.length - 1].x <= xWallStart + 0.1 &&
            Math.abs(pts[pts.length - 1].y - yStart) < 5
          ) {
            pts.pop();
          }
          const wallPts = sampleScallopWallPoints(underlyingFrontLeft, yStart, yEnd, true);
          if (wallPts.length > 0) {
            pts.push(...wallPts);
            maxBotXAllowed = evalWallXAtY(underlyingFrontLeft, yEnd);
            i = Math.min(i, topLocalIdx + 1);
            continue;
          }
        }
      }

      const underlyingFrontRight = findLatestUnderlyingWall(
        (w) =>
          w.targetSide === 'front' &&
          w.wallSide === 'right' &&
          canWallUnderlieRegion(w, reg) &&
          (!w.isReentrant || w.colBot <= w.colTop) &&
          w.colTop === colIdx &&
          reg.startCol <= w.colBot &&
          reg.bottomYs[i] >= w.yTop - 5 &&
          reg.bottomYs[w.colBot - reg.startCol] <= w.yBot + 5 &&
          (!w.isReentrant || !hasSeparateWedgeRegion(w, reg))
      );
      if (underlyingFrontRight) {
        const botLocalIdx = underlyingFrontRight.colBot - reg.startCol;
        const yStart = Math.min(underlyingFrontRight.yTop, reg.bottomYs[i]);
        const yEnd = Math.max(underlyingFrontRight.yBot, reg.bottomYs[botLocalIdx]);
        if (yStart - yEnd > 5) {
          const xWallStart = evalWallXAtY(underlyingFrontRight, yStart);
          while (
            pts.length > 2 &&
            pts[pts.length - 1].x <= xWallStart + 0.1 &&
            Math.abs(pts[pts.length - 1].y - yStart) < 5
          ) {
            pts.pop();
          }
          const wallPts = sampleScallopWallPoints(underlyingFrontRight, yStart, yEnd, true);
          if (wallPts.length > 0) {
            pts.push(...wallPts);
            maxBotXAllowed = wallPts[wallPts.length - 1].x;
            i = Math.min(i, botLocalIdx + 1);
            continue;
          }
        }
      }

      const x = (colIdx + 0.5) * dx;
      if (x >= maxBotXAllowed - 0.1) continue;
      if (leftBottomTrimX > -Infinity && x <= leftBottomTrimX + 0.1) continue;
      maxBotXAllowed = Infinity;
      pts.push({ x, y: reg.bottomYs[i] });
      if (i > stopBotAtCol) {
        const dyPrev = reg.bottomYs[i - 1] - reg.bottomYs[i];
        const dyRight = i < botStartIdx ? reg.bottomYs[i] - reg.bottomYs[i + 1] : 0;
        const dyLeft = i - 2 >= stopBotAtCol ? reg.bottomYs[i - 2] - reg.bottomYs[i - 1] : 0;
        const isSeamStep = seamCols?.has(colIdx) && Math.abs(dyPrev) > 15;
        const isMouthCliff =
          mouthCols.has(colIdx) &&
          Math.abs(dyPrev) > 250 &&
          ((i < botStartIdx &&
            (Math.sign(dyRight) !== Math.sign(dyPrev) ||
              Math.abs(dyPrev) > 2 * Math.abs(dyRight) + 50)) ||
            (i - 2 >= stopBotAtCol &&
              (Math.sign(dyLeft) !== Math.sign(dyPrev) ||
                Math.abs(dyPrev) > 2 * Math.abs(dyLeft) + 50)));
        const isIsolatedVerticalCliff =
          Math.abs(dyPrev) > Math.max(50, 2.5 * dx) &&
          Math.abs(dyRight) < 0.2 * Math.abs(dyPrev) &&
          Math.abs(dyLeft) < 0.1 * Math.abs(dyPrev);
        if (isSeamStep || isMouthCliff || isIsolatedVerticalCliff) {
          const xCliff = colIdx * dx;
          if (
            xCliff < maxBotXAllowed - 0.1 &&
            (leftBottomTrimX === -Infinity || xCliff > leftBottomTrimX + 0.1)
          ) {
            pts.push({ x: xCliff, y: reg.bottomYs[i] });
            pts.push({ x: xCliff, y: reg.bottomYs[i - 1] });
          }
        }
      }

      if (stopBotAtCol > 0 && i === stopBotAtCol && reentrantInnerFrontRightOverhang) {
        pts.push({ x: (reentrantInnerFrontRightOverhang.colBot + 1) * dx, y: reentrantInnerFrontRightOverhang.yBot });
        break;
      }
    }

    if (pts.length < 3) continue;

    polygons.push(finalizeRenderedPolygon(`poly_${idCounter}`, reg.materialId, reg.stepId, pts));
  }

  return stitchSameStepPolygons(polygons);
}

function finalizeRenderedPolygon(
  id: string,
  materialId: string,
  stepId: string | undefined,
  pts: { x: number; y: number }[]
): RenderedPolygon {
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

  return {
    id,
    materialId,
    stepId,
    points: pts,
    pathData: path,
    yMin,
    yMax,
    xMin,
    xMax,
  };
}

function stitchSameStepPolygons(polygons: RenderedPolygon[]): RenderedPolygon[] {
  const result = [...polygons];

  const cleanLoop = (pts: { x: number; y: number }[]): { x: number; y: number }[] => {
    const deduped: { x: number; y: number }[] = [];
    for (const p of pts) {
      const prev = deduped[deduped.length - 1];
      if (!prev || Math.abs(prev.x - p.x) > 0.05 || Math.abs(prev.y - p.y) > 0.05) {
        deduped.push({ x: p.x, y: p.y });
      }
    }
    while (deduped.length > 2) {
      const first = deduped[0];
      const last = deduped[deduped.length - 1];
      if (Math.abs(first.x - last.x) <= 0.05 && Math.abs(first.y - last.y) <= 0.05) {
        deduped.pop();
      } else {
        break;
      }
    }
    // Remove zero-area 180-degree spike folds
    let trimmed = true;
    while (trimmed && deduped.length >= 4) {
      trimmed = false;
      for (let i = 0; i < deduped.length; i++) {
        const a = deduped[(i - 1 + deduped.length) % deduped.length];
        const b = deduped[i];
        const c = deduped[(i + 1) % deduped.length];
        if (Math.abs(a.x - c.x) <= 0.05 && Math.abs(a.y - c.y) <= 0.05) {
          deduped.splice(i, 1);
          trimmed = true;
          break;
        }
        // Collinear middle point on vertical/horizontal line (both fold-backs and same-direction intermediates)
        if (Math.abs(a.x - b.x) <= 0.05 && Math.abs(b.x - c.x) <= 0.05) {
          deduped.splice(i, 1);
          trimmed = true;
          break;
        }
        if (Math.abs(a.y - b.y) <= 0.05 && Math.abs(b.y - c.y) <= 0.05) {
          deduped.splice(i, 1);
          trimmed = true;
          break;
        }
      }
    }
    return deduped;
  };

  for (let i = 0; i < result.length; i++) {
    const cleaned = cleanLoop(result[i].points);
    if (cleaned.length !== result[i].points.length && cleaned.length >= 3) {
      result[i] = finalizeRenderedPolygon(result[i].id, result[i].materialId, result[i].stepId, cleaned);
    }
  }

  let mergedAny = true;
  while (mergedAny) {
    mergedAny = false;
    for (let i = 0; i < result.length && !mergedAny; i++) {
      const pA = result[i];
      if (!pA.stepId) continue;
      for (let j = i + 1; j < result.length && !mergedAny; j++) {
        const pB = result[j];
        if (pA.materialId !== pB.materialId || pA.stepId !== pB.stepId) continue;
        if (pA.xMax < pB.xMin - 1 || pB.xMax < pA.xMin - 1) continue;
        if (pA.yMax < pB.yMin - 1 || pB.yMax < pA.yMin - 1) continue;

        const ptsA = pA.points;
        const ptsB = pB.points;
        const nA = ptsA.length;
        const nB = ptsB.length;
        const seams: {
          idxA: number;
          idxB: number;
          x: number;
          yLo: number;
          yHi: number;
        }[] = [];

        for (let ia = 0; ia < nA; ia++) {
          const a0 = ptsA[ia];
          const a1 = ptsA[(ia + 1) % nA];
          if (Math.abs(a0.x - a1.x) > 0.35) continue;
          const dyA = a1.y - a0.y;
          if (Math.abs(dyA) <= 2) continue;

          for (let ib = 0; ib < nB; ib++) {
            const b0 = ptsB[ib];
            const b1 = ptsB[(ib + 1) % nB];
            if (Math.abs(b0.x - b1.x) > 0.35) continue;
            if (Math.abs(a0.x - b0.x) > 0.5) continue;
            const dyB = b1.y - b0.y;
            if (Math.abs(dyB) <= 2 || dyA * dyB >= 0) continue;

            const yLo = Math.max(Math.min(a0.y, a1.y), Math.min(b0.y, b1.y));
            const yHi = Math.min(Math.max(a0.y, a1.y), Math.max(b0.y, b1.y));
            if (yHi - yLo > 2) {
              seams.push({ idxA: ia, idxB: ib, x: 0.5 * (a0.x + b0.x), yLo, yHi });
            }
          }
        }

        // Stitch only along a single shared vertical branch edge so closed keyhole rings remain valid
        if (seams.length === 1) {
          const s = seams[0];
          const a0 = ptsA[s.idxA];
          const a1 = ptsA[(s.idxA + 1) % nA];
          const b0 = ptsB[s.idxB];
          const b1 = ptsB[(s.idxB + 1) % nB];
          const aAsc = a1.y > a0.y;
          const yStartA = aAsc ? s.yLo : s.yHi;
          const yEndA = aAsc ? s.yHi : s.yLo;

          const spliced: { x: number; y: number }[] = [];
          for (let k = 0; k <= s.idxA; k++) {
            spliced.push(ptsA[k]);
          }
          if (Math.abs(a0.y - yStartA) > 0.2) {
            spliced.push({ x: s.x, y: yStartA });
          }
          if (Math.abs(b1.y - yStartA) > 0.2) {
            spliced.push({ x: s.x, y: yStartA });
          }
          for (let step = 1; step < nB; step++) {
            spliced.push(ptsB[(s.idxB + step) % nB]);
          }
          spliced.push(b0);
          if (Math.abs(b0.y - yEndA) > 0.2) {
            spliced.push({ x: s.x, y: yEndA });
          }
          if (Math.abs(a1.y - yEndA) > 0.2) {
            spliced.push({ x: s.x, y: yEndA });
          }
          for (let k = s.idxA + 1; k < nA; k++) {
            spliced.push(ptsA[k]);
          }

          const cleaned = cleanLoop(spliced);
          if (cleaned.length >= 3) {
            result[i] = finalizeRenderedPolygon(pA.id, pA.materialId, pA.stepId, cleaned);
            result.splice(j, 1);
            mergedAny = true;
          }
        }
      }
    }
  }

  return result;
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
 * Computes laminated dry-film top/bottom elevation per column:
 * - laminationSag = 0: rigid tenting sheet resting on highest peaks (bridges all cavities flat)
 * - laminationSag > 0: morphological closing + smooth cosine S-curve drape onto wide terraces
 *   and clamped-beam sin² arch bowing across bridged cavities, preserving uniform thickness.
 */
function computeDryFilmProfile(
  columns: ColumnProfile[],
  totalWidth: number,
  targetSide: 'front' | 'back',
  thickness: number,
  laminationSag: number = 0
): { yBottom: Float64Array; yTop: Float64Array } {
  const n = columns.length;
  const yBottom = new Float64Array(n);
  const yTop = new Float64Array(n);
  if (n === 0 || thickness <= 0) return { yBottom, yTop };

  const dx = totalWidth / Math.max(1, n);
  const s = Math.max(0, Math.min(1, laminationSag / 100));

  const heights = new Float64Array(n);
  const hasCol = new Uint8Array(n);
  let maxH = -Infinity;
  for (let i = 0; i < n; i++) {
    if (columns[i].segments.length === 0) continue;
    hasCol[i] = 1;
    const h = targetSide === 'front' ? getTopY(columns[i]) : -getBottomY(columns[i]);
    heights[i] = h;
    if (h > maxH) maxH = h;
  }
  if (maxH === -Infinity) return { yBottom, yTop };

  const env = new Float64Array(n);
  if (s <= 0.005) {
    env.fill(maxH);
  } else {
    // 1. Morphological closing: bridges trenches narrower than 2*bridgeRadius
    const bridgeRadius = Math.max(thickness * 0.6, (1 - s) * totalWidth * 0.42);
    const bridgeCols = Math.max(1, Math.round(bridgeRadius / dx));

    const dilated = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let localMax = -Infinity;
      const start = Math.max(0, i - bridgeCols);
      const end = Math.min(n - 1, i + bridgeCols);
      for (let j = start; j <= end; j++) {
        if (hasCol[j] && heights[j] > localMax) localMax = heights[j];
      }
      dilated[i] = localMax > -Infinity ? localMax : maxH;
    }

    const closed = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let localMin = Infinity;
      const start = Math.max(0, i - bridgeCols);
      const end = Math.min(n - 1, i + bridgeCols);
      for (let j = start; j <= end; j++) {
        if (dilated[j] < localMin) localMin = dilated[j];
      }
      closed[i] = Math.max(heights[i], localMin < Infinity ? localMin : maxH);
    }

    // 2. Smooth cosine S-curve drape across step-downs onto wider lower terraces
    const drapeLength = Math.max(thickness * 1.5, (0.38 - 0.22 * s) * totalWidth);
    const drapeCols = Math.max(2, Math.round(drapeLength / dx));

    for (let i = 0; i < n; i++) {
      const baseH = closed[i];
      let best = baseH;
      const start = Math.max(0, i - drapeCols);
      const end = Math.min(n - 1, i + drapeCols);
      for (let j = start; j <= end; j++) {
        const diff = closed[j] - baseH;
        if (diff <= 0) continue;
        const dist = Math.abs(i - j) * dx;
        if (dist >= drapeLength) continue;
        const w = 0.5 * (1 + Math.cos((Math.PI * dist) / drapeLength));
        const candidate = baseH + diff * w;
        if (candidate > best) best = candidate;
      }
      env[i] = Math.max(heights[i], best);
    }

    // 3. Curved clamped-beam arch sag (sin²(πu)) across bridged cavities bounded on both sides
    const envBeforeSag = new Float64Array(env);
    let idx = 0;
    while (idx < n) {
      if (!hasCol[idx] || envBeforeSag[idx] <= heights[idx] + 1) {
        idx++;
        continue;
      }
      const spanStart = idx;
      while (idx < n && hasCol[idx] && envBeforeSag[idx] > heights[idx] + 1) {
        idx++;
      }
      const spanEnd = idx - 1;
      const boundedLeft = spanStart > 0 && hasCol[spanStart - 1];
      const boundedRight = spanEnd < n - 1 && hasCol[spanEnd + 1];
      if (!boundedLeft || !boundedRight) continue;

      const spanCount = spanEnd - spanStart + 1;
      if (spanCount < 3) continue;

      const leftAnchorY = envBeforeSag[spanStart - 1];
      const rightAnchorY = envBeforeSag[spanEnd + 1];
      let minFloorInSpan = Infinity;
      for (let k = spanStart; k <= spanEnd; k++) {
        if (heights[k] < minFloorInSpan) minFloorInSpan = heights[k];
      }
      // Only bow spans suspended between two raised shoulders (not one-sided step-down ramps)
      if (leftAnchorY <= minFloorInSpan + 5 || rightAnchorY <= minFloorInSpan + 5) {
        continue;
      }

      const spanWidth = spanCount * dx;
      let maxClearance = 0;
      for (let k = spanStart; k <= spanEnd; k++) {
        const t = (k - spanStart + 0.5) / spanCount;
        const lineY = leftAnchorY + (rightAnchorY - leftAnchorY) * t;
        const clear = Math.max(0, Math.min(envBeforeSag[k], lineY) - heights[k]);
        if (clear > maxClearance) maxClearance = clear;
      }
      if (maxClearance <= 1) continue;

      const sagScaleRef = Math.max(thickness * 1.5, totalWidth * 0.25);
      const spanRatio = Math.min(1.4, spanWidth / sagScaleRef);
      const sagFraction = Math.min(1, s * (0.45 + 0.75 * Math.pow(spanRatio, 1.15)));
      const sagDepth = maxClearance * sagFraction;

      for (let k = spanStart; k <= spanEnd; k++) {
        const u = (k - spanStart + 0.5) / spanCount;
        const arch = Math.pow(Math.sin(Math.PI * u), 2);
        const sagged = envBeforeSag[k] - sagDepth * arch;
        env[k] = Math.max(heights[k], sagged);
      }
    }

    // 4. Light C² flexural smoothing on suspended/curved sections while preserving surface contact
    const smoothPasses = Math.max(2, Math.round(4 * s + 2));
    const tmp = new Float64Array(n);
    for (let pass = 0; pass < smoothPasses; pass++) {
      tmp.set(env);
      for (let i = 1; i < n - 1; i++) {
        if (!hasCol[i] || env[i] <= heights[i] + 0.5) continue;
        const blended = 0.25 * env[i - 1] + 0.5 * env[i] + 0.25 * env[i + 1];
        tmp[i] = Math.max(heights[i], blended);
      }
      env.set(tmp);
    }
  }

  for (let i = 0; i < n; i++) {
    if (!hasCol[i]) continue;
    if (targetSide === 'front') {
      yBottom[i] = env[i];
      yTop[i] = env[i] + thickness;
    } else {
      yTop[i] = -env[i];
      yBottom[i] = -env[i] - thickness;
    }
  }

  return { yBottom, yTop };
}

/**
 * 1D Gaussian smooth with symmetric boundary reflection for liquid meniscus leveling.
 */
function gaussianReflectSmooth(
  values: Float64Array,
  hasCol: Uint8Array,
  dx: number,
  sigma: number
): Float64Array {
  const n = values.length;
  const out = new Float64Array(n);
  if (n === 0) return out;

  const radiusCols = Math.max(1, Math.min(n - 1, Math.ceil((2.5 * sigma) / Math.max(1e-5, dx))));
  const invTwoSigmaSq = 1 / Math.max(1e-5, 2 * sigma * sigma);
  const kernel = new Float64Array(radiusCols + 1);
  for (let d = 0; d <= radiusCols; d++) {
    const dist = d * dx;
    kernel[d] = Math.exp(-(dist * dist) * invTwoSigmaSq);
  }

  for (let i = 0; i < n; i++) {
    if (!hasCol[i]) continue;
    let sumW = 0;
    let sumV = 0;
    for (let offset = -radiusCols; offset <= radiusCols; offset++) {
      let j = i + offset;
      if (j < 0) j = -j;
      else if (j >= n) j = 2 * n - 2 - j;
      j = Math.max(0, Math.min(n - 1, j));
      if (!hasCol[j]) continue;
      const w = kernel[Math.abs(offset)];
      sumW += w;
      sumV += w * values[j];
    }
    out[i] = sumW > 0 ? sumV / sumW : values[i];
  }
  return out;
}

/**
 * Computes spin-coated surface elevation per column modeling viscosity vs topography:
 * - planarization = 100%: ideal flat leveling at peak + thickness
 * - planarization < 100%: capillary leveling length shrinks with higher viscosity,
 *   filling narrow trenches flat while following wider valleys with rounded menisci.
 */
function computeSpinCoatSurface(
  columns: ColumnProfile[],
  totalWidth: number,
  targetSide: 'front' | 'back',
  thickness: number,
  planarizationPct: number = 100
): Float64Array {
  const n = columns.length;
  const result = new Float64Array(n);
  if (n === 0 || thickness <= 0) return result;

  const p = Math.max(0, Math.min(1, planarizationPct / 100));
  const dx = totalWidth / Math.max(1, n);

  const heights = new Float64Array(n);
  const hasCol = new Uint8Array(n);
  let maxH = -Infinity;
  for (let i = 0; i < n; i++) {
    if (columns[i].segments.length === 0) continue;
    hasCol[i] = 1;
    const h = targetSide === 'front' ? getTopY(columns[i]) : -getBottomY(columns[i]);
    heights[i] = h;
    if (h > maxH) maxH = h;
  }
  if (maxH === -Infinity) return result;

  if (p >= 0.995) {
    for (let i = 0; i < n; i++) {
      if (!hasCol[i]) continue;
      result[i] = targetSide === 'front' ? maxH + thickness : -(maxH + thickness);
    }
    return result;
  }

  // Capillary leveling length grows as viscosity decreases (higher planarization p)
  const sigma = Math.max(dx * 1.2, thickness * 0.3) + Math.pow(p, 1.35) * totalWidth * 0.22;
  const smoothedH = gaussianReflectSmooth(heights, hasCol, dx, sigma);

  // Narrow trenches fill via meniscus leveling while wide steps follow topography
  const globalBlend = Math.pow(p, 1.65);
  const rawTop = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (!hasCol[i]) continue;
    const meniscusBase = Math.max(heights[i], smoothedH[i]);
    const leveledBase = meniscusBase + (maxH - meniscusBase) * globalBlend;
    rawTop[i] = leveledBase + thickness;
  }

  // Surface-tension rounding of the liquid upper air interface
  const topSigma = Math.max(dx * 1.4, thickness * 0.35 + p * totalWidth * 0.04);
  const smoothTop = gaussianReflectSmooth(rawTop, hasCol, dx, topSigma);

  // Keep raised peaks wetted while permitting slight ridge thinning at moderate/high leveling
  const minPeakThick = thickness * (1 - 0.35 * p);
  for (let i = 0; i < n; i++) {
    if (!hasCol[i]) continue;
    const finalH = Math.max(heights[i] + minPeakThick, smoothTop[i]);
    result[i] = targetSide === 'front' ? finalH : -finalH;
  }

  return result;
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
