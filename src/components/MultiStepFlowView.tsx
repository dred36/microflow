/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState, useMemo, useEffect, useCallback } from 'react';
import {
  ProcessFlow,
  ProcessStep,
  CrossSectionMesh,
  RenderedPolygon,
} from '../types/microfab';
import { simulateCrossSection, buildRenderPolygons } from '../lib/simulationEngine';
import { switchStepVariant, getActiveStepVariant } from '../lib/variantUtils';
import { syncStepWindowsToMask } from '../lib/maskUtils';
import {
  PiecewiseZMode,
  CustomZZonesConfig,
  computePiecewiseZTransform,
  subdividePolygonAtBreakpoints,
} from '../lib/piecewiseZScale';
import { PiecewiseZPopover } from './PiecewiseZPopover';
import { SvgPatterns } from './SvgPatterns';
import { getMaterialById } from '../lib/materials';
import { ThicknessUnit, formatThickness } from '../lib/units';
import {
  Download,
  FileDown,
  Bookmark,
  Square,
  Boxes,
  GitBranch,
  ArrowDown,
  ArrowRight,
  Workflow,
  FileText,
  Files,
  Lock,
  Unlock,
  ChevronDown,
} from 'lucide-react';

interface MultiStepFlowViewProps {
  flow: ProcessFlow;
  thicknessUnit?: ThicknessUnit;
  zScale?: number;
  onChangeZScale?: (next: number) => void;
  zAspect1to1?: boolean;
  onChangeZAspect1to1?: (next: boolean) => void;
  lockSharedYScale?: boolean;
  onToggleLockSharedYScale?: () => void;
  piecewiseMode?: PiecewiseZMode;
  onChangePiecewiseMode?: (next: PiecewiseZMode) => void;
  autoCompression?: number;
  onChangeAutoCompression?: (next: number) => void;
  customZConfig?: CustomZZonesConfig;
  onChangeCustomZConfig?: (next: CustomZZonesConfig) => void;
  onSelectStepIndex: (idx: number) => void;
  onUpdateFlow?: (updatedFlow: ProcessFlow) => void;
  onOpenBatchExport?: () => void;
  onClose: () => void;
}

type FlowchartMode = 'vertical' | 'horizontal' | 'snake-2' | 'snake-3';

interface FlowchartVariantNode {
  variantId: string;
  variantName: string;
  step: ProcessStep;
  mesh: CrossSectionMesh;
  polygons: RenderedPolygon[];
  reticleName?: string;
}

interface FlowchartStage {
  key: string;
  kind: 'substrate' | 'step';
  letter: string;
  flowStepIndex: number; // -1 for substrate, 0..N-1 for flow.steps index
  step: ProcessStep;
  mesh: CrossSectionMesh;
  polygons: RenderedPolygon[];
  customSubtitle?: string;
  blockId?: string;
  blockName?: string;
  blockColor?: string;
  reticleName?: string;
  activeVariantId?: string;
  activeVariantName?: string;
  totalVariantCount: number;
  altVariants: FlowchartVariantNode[];
}

interface PlacedNode {
  x: number;
  y: number;
  stageIdx: number;
  variantIdx: number; // -1 for main trunk, 0..k for altVariants
}

interface FlowConnector {
  id: string;
  d: string;
  kind: 'trunk' | 'branch' | 'rejoin';
}

interface FlowDiamond {
  id: string;
  cx: number;
  cy: number;
  count: number;
}

interface BlockGroupBox {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const CARD_W = 420;
const BASE_CARD_H = 190;
const CARD_HEADER_H = 56;
const PAD_X = 22;
const PAD_Y = 20;
const BASE_AVAIL_POLY_H = BASE_CARD_H - PAD_Y - CARD_HEADER_H; // 114

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

export const MultiStepFlowView: React.FC<MultiStepFlowViewProps> = ({
  flow,
  thicknessUnit = 'nm',
  zScale: zScaleProp,
  onChangeZScale,
  zAspect1to1: zAspect1to1Prop,
  onChangeZAspect1to1,
  lockSharedYScale: lockSharedYScaleProp,
  onToggleLockSharedYScale,
  piecewiseMode: piecewiseModeProp,
  onChangePiecewiseMode,
  autoCompression: autoCompressionProp,
  onChangeAutoCompression,
  customZConfig: customZConfigProp,
  onChangeCustomZConfig,
  onSelectStepIndex,
  onUpdateFlow,
  onOpenBatchExport,
  onClose,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [flowMode, setFlowMode] = useState<FlowchartMode>('vertical');
  const [theme, setTheme] = useState<'dark' | 'paper'>('paper');
  const [showVariants, setShowVariants] = useState<boolean>(true);
  const [showToolInfo, setShowToolInfo] = useState<boolean>(true);
  const [showLegend] = useState<boolean>(true);
  const [includeSubstrateFrame, setIncludeSubstrateFrame] = useState<boolean>(true);
  const [milestonesOnly, setMilestonesOnly] = useState<boolean>(false);
  const [blockLastStepOnly, setBlockLastStepOnly] = useState<boolean>(false);
  const [renderMode, setRenderMode] = useState<'hatch' | 'solid'>('hatch');
  const [showOutlines, setShowOutlines] = useState<boolean>(true);

  const [internalZScale, setInternalZScale] = useState<number>(2.0);
  const zScale = zScaleProp ?? internalZScale;
  const setZScale = onChangeZScale ?? setInternalZScale;

  const [internalZAspect1to1, setInternalZAspect1to1] = useState<boolean>(false);
  const zAspect1to1 = zAspect1to1Prop ?? internalZAspect1to1;
  const setZAspect1to1 = onChangeZAspect1to1 ?? setInternalZAspect1to1;

  const [internalSharedYScale, setInternalSharedYScale] = useState<boolean>(true);
  const sharedYScale = lockSharedYScaleProp ?? internalSharedYScale;
  const toggleSharedYScale =
    onToggleLockSharedYScale ?? (() => setInternalSharedYScale((prev) => !prev));

  const [internalPiecewiseMode, setInternalPiecewiseMode] = useState<PiecewiseZMode>('linear');
  const piecewiseMode = piecewiseModeProp ?? internalPiecewiseMode;
  const setPiecewiseMode = onChangePiecewiseMode ?? setInternalPiecewiseMode;

  const [internalAutoCompression, setInternalAutoCompression] = useState<number>(0.75);
  const autoCompression = autoCompressionProp ?? internalAutoCompression;
  const setAutoCompression = onChangeAutoCompression ?? setInternalAutoCompression;

  const [internalCustomZConfig, setInternalCustomZConfig] = useState<CustomZZonesConfig>({
    breakpointsNm: [],
    zoneGains: [1],
  });
  const customZConfig = customZConfigProp ?? internalCustomZConfig;
  const setCustomZConfig = onChangeCustomZConfig ?? setInternalCustomZConfig;

  const [showPiecewisePopover, setShowPiecewisePopover] = useState<boolean>(false);
  const piecewiseMenuRef = useRef<HTMLDivElement>(null);
  const [isExporting, setIsExporting] = useState<boolean>(false);

  const hasBookmarkedSteps = useMemo(
    () => flow.steps.some((s) => Boolean(s.bookmarked)),
    [flow.steps]
  );

  // Enabled steps paired with both their raw flow.steps index and enabled-only simulation index
  const enabledStepsWithIndices = useMemo(() => {
    const out: { step: ProcessStep; stepIndex: number; enabledSimIndex: number }[] = [];
    let enabledCounter = 0;
    flow.steps.forEach((step, stepIndex) => {
      if (step.enabled) {
        out.push({ step, stepIndex, enabledSimIndex: enabledCounter });
        enabledCounter += 1;
      }
    });
    return out;
  }, [flow.steps]);

  const variantStepCount = useMemo(
    () =>
      enabledStepsWithIndices.filter(
        ({ step }) => step.variants && step.variants.length > 1
      ).length,
    [enabledStepsWithIndices]
  );

  const hasBlocks = useMemo(
    () => enabledStepsWithIndices.some(({ step }) => Boolean(step.blockId)),
    [enabledStepsWithIndices]
  );

  const lastStepIndexByBlockId = useMemo(() => {
    const map = new Map<string, number>();
    for (const { step, stepIndex } of enabledStepsWithIndices) {
      if (step.blockId) {
        map.set(step.blockId, stepIndex);
      }
    }
    return map;
  }, [enabledStepsWithIndices]);

  const getStepLetter = (idx: number) => {
    if (idx < 0) return '(0)';
    if (idx < 26) return `(${String.fromCharCode(97 + idx)})`;
    return `(${idx + 1})`;
  };

  // Build ordered flowchart stages along with any alternative variant branch simulations
  const stages: FlowchartStage[] = useMemo(() => {
    const list: FlowchartStage[] = [];

    const subLayers = flow.substrateLayers || [
      {
        id: 'sub_default',
        name: 'Bulk Silicon <100>',
        materialId: flow.substrateMaterialId || 'mat_si_sub',
        thickness: flow.substrateThickness || 3000,
      },
    ];

    if (includeSubstrateFrame && !(milestonesOnly && hasBookmarkedSteps)) {
      const subMesh = simulateCrossSection(flow, -1);
      const subPolys = buildRenderPolygons(subMesh, flow.materials);
      const subDesc = subLayers
        .map((l) => `${l.name || l.materialId} (${formatThickness(l.thickness, thicknessUnit)})`)
        .join(' · ');

      list.push({
        key: 'stage_substrate',
        kind: 'substrate',
        letter: '(a)',
        flowStepIndex: -1,
        step: {
          id: 'step_init_sub',
          title: 'Starting Substrate Stack',
          type: 'deposition',
          enabled: true,
        },
        mesh: subMesh,
        polygons: subPolys,
        customSubtitle: `Pre-fab Stack: ${subDesc}`,
        totalVariantCount: 0,
        altVariants: [],
      });
    }

    let filtered = enabledStepsWithIndices;
    if (blockLastStepOnly && hasBlocks) {
      filtered = filtered.filter(
        ({ step, stepIndex }) =>
          !step.blockId || lastStepIndexByBlockId.get(step.blockId) === stepIndex
      );
    }
    if (milestonesOnly && hasBookmarkedSteps) {
      filtered = filtered.filter(({ step }) => Boolean(step.bookmarked));
    }

    const letterOffset = list.length;

    filtered.forEach(({ step, stepIndex, enabledSimIndex }, renderIdx) => {
      const mesh = simulateCrossSection(flow, enabledSimIndex);
      const polygons = buildRenderPolygons(mesh, flow.materials);
      const block = flow.blocks?.find((b) => b.id === step.blockId);
      const maskId = step.lithography?.maskId;
      const mask = maskId ? flow.masks?.find((m) => m.id === maskId) : undefined;

      const activeVar =
        step.variants && step.variants.length > 1 ? getActiveStepVariant(step) : null;

      const altVariants: FlowchartVariantNode[] = [];
      if (showVariants && step.variants && step.variants.length > 1) {
        step.variants.forEach((variant) => {
          if (activeVar && variant.id === activeVar.id) return;
          const variantStep: ProcessStep = {
            ...switchStepVariant(step, variant.id),
            enabled: true,
          };
          const variantFlow: ProcessFlow = {
            ...flow,
            steps: flow.steps.map((s, idx) => (idx === stepIndex ? variantStep : s)),
          };
          const vMesh = simulateCrossSection(variantFlow, enabledSimIndex);
          const vPolys = buildRenderPolygons(vMesh, flow.materials);
          const vMaskId = variantStep.lithography?.maskId;
          const vMask = vMaskId ? flow.masks?.find((m) => m.id === vMaskId) : undefined;
          altVariants.push({
            variantId: variant.id,
            variantName: variant.name,
            step: variantStep,
            mesh: vMesh,
            polygons: vPolys,
            reticleName: vMask ? `${vMask.layerCode} ${vMask.name}` : undefined,
          });
        });
      }

      list.push({
        key: step.id,
        kind: 'step',
        letter: getStepLetter(renderIdx + letterOffset),
        flowStepIndex: stepIndex,
        step,
        mesh,
        polygons,
        blockId: block?.id,
        blockName: block?.name,
        blockColor: block?.color,
        reticleName: mask ? `${mask.layerCode} ${mask.name}` : undefined,
        activeVariantId: activeVar?.id,
        activeVariantName: activeVar?.name,
        totalVariantCount: step.variants?.length || 0,
        altVariants,
      });
    });

    return list;
  }, [
    flow,
    enabledStepsWithIndices,
    includeSubstrateFrame,
    milestonesOnly,
    hasBookmarkedSteps,
    blockLastStepOnly,
    hasBlocks,
    lastStepIndexByBlockId,
    thicknessUnit,
    showVariants,
  ]);

  // Global vertical mesh/polygon bounds across all trunk & variant cross-sections
  const globalBounds = useMemo(() => {
    let minY = Infinity;
    let maxY = -Infinity;
    const inspect = (mesh: CrossSectionMesh, polygons: RenderedPolygon[]) => {
      if (Number.isFinite(mesh.minY) && mesh.minY < minY) minY = mesh.minY;
      if (Number.isFinite(mesh.maxY) && mesh.maxY > maxY) maxY = mesh.maxY;
      for (const poly of polygons) {
        if (Number.isFinite(poly.yMin) && poly.yMin < minY) minY = poly.yMin;
        if (Number.isFinite(poly.yMax) && poly.yMax > maxY) maxY = poly.yMax;
      }
    };
    stages.forEach((st) => {
      inspect(st.mesh, st.polygons);
      st.altVariants.forEach((av) => inspect(av.mesh, av.polygons));
    });
    if (!Number.isFinite(minY)) minY = 0;
    if (!Number.isFinite(maxY)) maxY = 3500;
    if (maxY - minY < 1000) maxY = minY + 1000;
    return {
      minY,
      maxY,
      span: Math.max(1000, maxY - minY),
    };
  }, [stages]);

  const allStagePolygons = useMemo(() => {
    const list: RenderedPolygon[] = [];
    stages.forEach((st) => {
      for (const p of st.polygons) list.push(p);
      st.altVariants.forEach((av) => {
        for (const p of av.polygons) list.push(p);
      });
    });
    return list;
  }, [stages]);

  const waferWidth = flow.substrateWidth || 10000;
  const cardScaleX = (CARD_W - PAD_X * 2) / waferWidth;
  const trueAspectPolyH = globalBounds.span * cardScaleX;
  const isTrueAspectClamped = trueAspectPolyH < 48 || trueAspectPolyH > 460;

  const availPolyH = useMemo(() => {
    if (zAspect1to1) {
      return Math.round(Math.max(48, Math.min(460, trueAspectPolyH)));
    }
    const factor = Math.max(0.35, zScale / 2.0);
    return Math.round(BASE_AVAIL_POLY_H * factor);
  }, [zAspect1to1, zScale, trueAspectPolyH]);

  const cardH = CARD_HEADER_H + availPolyH + PAD_Y;

  const sharedZTransform = useMemo(
    () =>
      computePiecewiseZTransform({
        mode: piecewiseMode,
        polygons: allStagePolygons,
        rawMinY: globalBounds.minY,
        rawMaxY: globalBounds.maxY,
        waferWidth,
        autoCompression,
        customConfig: customZConfig,
      }),
    [
      piecewiseMode,
      allStagePolygons,
      globalBounds.minY,
      globalBounds.maxY,
      waferWidth,
      autoCompression,
      customZConfig,
    ]
  );

  const autoPreviewTransform = useMemo(
    () =>
      piecewiseMode === 'auto'
        ? sharedZTransform
        : computePiecewiseZTransform({
            mode: 'auto',
            polygons: allStagePolygons,
            rawMinY: globalBounds.minY,
            rawMaxY: globalBounds.maxY,
            waferWidth,
            autoCompression,
          }),
    [
      piecewiseMode,
      sharedZTransform,
      allStagePolygons,
      globalBounds.minY,
      globalBounds.maxY,
      waferWidth,
      autoCompression,
    ]
  );

  const handleSeedCustomFromAuto = useCallback(() => {
    const bps = [...autoPreviewTransform.breakpoints];
    const gains = autoPreviewTransform.bands.map((b) =>
      Math.max(0.01, Math.round(b.localGain * 100) / 100)
    );
    setCustomZConfig({
      breakpointsNm: bps,
      zoneGains: gains.length === bps.length + 1 ? gains : [1],
    });
    setPiecewiseMode('custom');
  }, [autoPreviewTransform, setCustomZConfig, setPiecewiseMode]);

  const handleChangePiecewiseMode = useCallback(
    (next: PiecewiseZMode) => {
      if (
        next === 'custom' &&
        customZConfig.breakpointsNm.length === 0 &&
        autoPreviewTransform.isActive
      ) {
        handleSeedCustomFromAuto();
        return;
      }
      setPiecewiseMode(next);
    },
    [
      customZConfig.breakpointsNm.length,
      autoPreviewTransform.isActive,
      handleSeedCustomFromAuto,
      setPiecewiseMode,
    ]
  );

  useEffect(() => {
    if (!showPiecewisePopover) return;
    const handleOutside = (e: PointerEvent) => {
      if (
        piecewiseMenuRef.current &&
        !piecewiseMenuRef.current.contains(e.target as Node)
      ) {
        setShowPiecewisePopover(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setShowPiecewisePopover(false);
      }
    };
    window.addEventListener('pointerdown', handleOutside);
    window.addEventListener('keydown', handleKey, true);
    return () => {
      window.removeEventListener('pointerdown', handleOutside);
      window.removeEventListener('keydown', handleKey, true);
    };
  }, [showPiecewisePopover]);

  // Overall materials used across trunk & rendered variant nodes
  const allUsedMaterials = useMemo(() => {
    const ids = new Set<string>();
    stages.forEach((st) => {
      st.polygons.forEach((p) => ids.add(p.materialId));
      st.altVariants.forEach((av) => {
        av.polygons.forEach((p) => ids.add(p.materialId));
      });
    });
    return Array.from(ids).map((id) => getMaterialById(flow.materials, id));
  }, [stages, flow.materials]);

  // Compute deterministic Flowchart geometry (nodes, connectors, branch diamonds, module swimlanes, terminal node)
  const layoutGeometry = useMemo(() => {
    const nodes: PlacedNode[] = [];
    const connectors: FlowConnector[] = [];
    const diamonds: FlowDiamond[] = [];
    const blockBoxes: BlockGroupBox[] = [];

    const MARGIN_X = 36;
    const MARGIN_Y = 32;

    let endBadge: { x: number; y: number; width: number; height: number } | null = null;
    let contentWidth = 760;
    let contentHeight = 320;

    if (stages.length === 0) {
      return {
        nodes,
        connectors,
        diamonds,
        blockBoxes,
        endBadge,
        contentWidth,
        contentHeight,
      };
    }

    if (flowMode === 'vertical') {
      const COL_GAP = 42;
      const NORMAL_ROW_GAP = 46;
      const BRANCH_HEADER_GAP = 64;
      const REJOIN_FOOTER_GAP = 26;

      const stageYs: number[] = [];
      let curY = MARGIN_Y;

      for (let i = 0; i < stages.length; i++) {
        const st = stages[i];
        const hasVars = st.altVariants.length > 0;
        if (i > 0) {
          const prevHadVars = stages[i - 1].altVariants.length > 0;
          curY += prevHadVars ? REJOIN_FOOTER_GAP : 0;
          curY += hasVars ? BRANCH_HEADER_GAP : NORMAL_ROW_GAP;
        } else if (hasVars) {
          curY += 42; // extra top clearance if step 0 has a branch diamond above it
        }
        stageYs.push(curY);
        curY += cardH;
      }

      const lastHasVars = stages[stages.length - 1].altVariants.length > 0;
      const afterLastY = curY + (lastHasVars ? REJOIN_FOOTER_GAP : 0) + 34;

      const maxCols = Math.max(1, ...stages.map((s) => 1 + s.altVariants.length));
      contentWidth = Math.max(720, MARGIN_X * 2 + maxCols * CARD_W + (maxCols - 1) * COL_GAP);

      const trunkX = MARGIN_X;
      const trunkCenterX = trunkX + CARD_W / 2;

      stages.forEach((st, i) => {
        const y = stageYs[i];
        nodes.push({ x: trunkX, y, stageIdx: i, variantIdx: -1 });

        st.altVariants.forEach((_, vIdx) => {
          const vx = trunkX + (vIdx + 1) * (CARD_W + COL_GAP);
          nodes.push({ x: vx, y, stageIdx: i, variantIdx: vIdx });
        });

        // Incoming connector + optional branch diamond
        const prevBottomY = i > 0 ? stageYs[i - 1] + cardH : y - 34;
        const prevRejoinY = i > 0 && stages[i - 1].altVariants.length > 0 ? stageYs[i - 1] + cardH + 18 : prevBottomY;

        if (st.altVariants.length > 0) {
          const diamondCy = y - 32;
          const diamondTop = diamondCy - 13;
          const diamondBot = diamondCy + 13;
          const diamondRight = trunkCenterX + 15;

          diamonds.push({
            id: `dm_${st.key}`,
            cx: trunkCenterX,
            cy: diamondCy,
            count: st.altVariants.length + 1,
          });

          if (i > 0) {
            connectors.push({
              id: `conn_in_${i}`,
              d: `M ${trunkCenterX} ${prevBottomY} L ${trunkCenterX} ${diamondTop - 3}`,
              kind: 'trunk',
            });
          }

          connectors.push({
            id: `conn_act_${i}`,
            d: `M ${trunkCenterX} ${diamondBot} L ${trunkCenterX} ${y - 4}`,
            kind: 'trunk',
          });

          st.altVariants.forEach((_, vIdx) => {
            const altCenterX = trunkX + (vIdx + 1) * (CARD_W + COL_GAP) + CARD_W / 2;
            connectors.push({
              id: `conn_br_${i}_${vIdx}`,
              d: `M ${diamondRight} ${diamondCy} L ${altCenterX} ${diamondCy} L ${altCenterX} ${y - 4}`,
              kind: 'branch',
            });

            const rejoinY = y + cardH + 18;
            connectors.push({
              id: `conn_rj_${i}_${vIdx}`,
              d: `M ${altCenterX} ${y + cardH} L ${altCenterX} ${rejoinY} L ${trunkCenterX + 6} ${rejoinY}`,
              kind: 'rejoin',
            });
          });
        } else if (i > 0) {
          connectors.push({
            id: `conn_seq_${i}`,
            d: `M ${trunkCenterX} ${prevBottomY} L ${trunkCenterX} ${y - 4}`,
            kind: 'trunk',
          });
          void prevRejoinY;
        }
      });

      // Terminal pill at bottom
      const END_W = 240;
      const END_H = 30;
      endBadge = {
        x: trunkCenterX - END_W / 2,
        y: afterLastY,
        width: END_W,
        height: END_H,
      };
      const lastBottomY = stageYs[stages.length - 1] + cardH;
      connectors.push({
        id: 'conn_end',
        d: `M ${trunkCenterX} ${lastBottomY} L ${trunkCenterX} ${afterLastY - 4}`,
        kind: 'trunk',
      });
      contentHeight = afterLastY + END_H + 24;

      // Group consecutive steps sharing blockId
      let runStart = -1;
      for (let i = 0; i <= stages.length; i++) {
        const curBlockId = i < stages.length ? stages[i].blockId : undefined;
        const prevBlockId = runStart >= 0 ? stages[runStart].blockId : undefined;
        if (curBlockId && curBlockId === prevBlockId) {
          continue;
        }
        if (runStart >= 0 && prevBlockId) {
          const runEnd = i - 1;
          const bStage = stages[runStart];
          const maxSpanCols = Math.max(
            1,
            ...stages.slice(runStart, runEnd + 1).map((s) => 1 + s.altVariants.length)
          );
          const topPad = stages[runStart].altVariants.length > 0 ? 52 : 24;
          const boxY = stageYs[runStart] - topPad;
          const boxBot =
            stageYs[runEnd] + cardH + (stages[runEnd].altVariants.length > 0 ? 24 : 12);
          blockBoxes.push({
            id: `blk_${prevBlockId}_${runStart}`,
            name: bStage.blockName || 'Process Module',
            color: bStage.blockColor || '#6366f1',
            x: MARGIN_X - 16,
            y: boxY,
            width: maxSpanCols * CARD_W + (maxSpanCols - 1) * COL_GAP + 32,
            height: boxBot - boxY,
          });
        }
        runStart = curBlockId ? i : -1;
      }
    } else if (flowMode === 'horizontal') {
      const ROW_GAP = 32;
      const NORMAL_COL_GAP = 54;
      const BRANCH_COL_GAP = 76;
      const REJOIN_COL_GAP = 24;

      const stageXs: number[] = [];
      let curX = MARGIN_X;

      for (let i = 0; i < stages.length; i++) {
        const hasVars = stages[i].altVariants.length > 0;
        if (i > 0) {
          const prevHadVars = stages[i - 1].altVariants.length > 0;
          curX += prevHadVars ? REJOIN_COL_GAP : 0;
          curX += hasVars ? BRANCH_COL_GAP : NORMAL_COL_GAP;
        } else if (hasVars) {
          curX += 46;
        }
        stageXs.push(curX);
        curX += CARD_W;
      }

      const lastHasVars = stages[stages.length - 1].altVariants.length > 0;
      const endX = curX + (lastHasVars ? REJOIN_COL_GAP : 0) + 42;
      const END_W = 190;
      const END_H = 38;

      const maxRows = Math.max(1, ...stages.map((s) => 1 + s.altVariants.length));
      const trunkY = MARGIN_Y + 12;
      const trunkCenterY = trunkY + cardH / 2;

      contentWidth = endX + END_W + MARGIN_X;
      contentHeight = Math.max(
        300,
        trunkY + maxRows * cardH + (maxRows - 1) * ROW_GAP + 32
      );

      stages.forEach((st, i) => {
        const x = stageXs[i];
        nodes.push({ x, y: trunkY, stageIdx: i, variantIdx: -1 });

        st.altVariants.forEach((_, vIdx) => {
          const vy = trunkY + (vIdx + 1) * (cardH + ROW_GAP);
          nodes.push({ x, y: vy, stageIdx: i, variantIdx: vIdx });
        });

        const prevRightX = i > 0 ? stageXs[i - 1] + CARD_W : x - 40;

        if (st.altVariants.length > 0) {
          const diamondCx = x - 34;
          const diamondLeft = diamondCx - 15;
          const diamondRight = diamondCx + 15;
          const diamondBot = trunkCenterY + 13;

          diamonds.push({
            id: `dm_h_${st.key}`,
            cx: diamondCx,
            cy: trunkCenterY,
            count: st.altVariants.length + 1,
          });

          if (i > 0) {
            connectors.push({
              id: `conn_h_in_${i}`,
              d: `M ${prevRightX} ${trunkCenterY} L ${diamondLeft - 3} ${trunkCenterY}`,
              kind: 'trunk',
            });
          }

          connectors.push({
            id: `conn_h_act_${i}`,
            d: `M ${diamondRight} ${trunkCenterY} L ${x - 4} ${trunkCenterY}`,
            kind: 'trunk',
          });

          st.altVariants.forEach((_, vIdx) => {
            const altCenterY = trunkY + (vIdx + 1) * (cardH + ROW_GAP) + cardH / 2;
            connectors.push({
              id: `conn_h_br_${i}_${vIdx}`,
              d: `M ${diamondCx} ${diamondBot} L ${diamondCx} ${altCenterY} L ${x - 4} ${altCenterY}`,
              kind: 'branch',
            });

            const rejoinX = x + CARD_W + 18;
            connectors.push({
              id: `conn_h_rj_${i}_${vIdx}`,
              d: `M ${x + CARD_W} ${altCenterY} L ${rejoinX} ${altCenterY} L ${rejoinX} ${trunkCenterY + 6}`,
              kind: 'rejoin',
            });
          });
        } else if (i > 0) {
          connectors.push({
            id: `conn_h_seq_${i}`,
            d: `M ${prevRightX} ${trunkCenterY} L ${x - 4} ${trunkCenterY}`,
            kind: 'trunk',
          });
        }
      });

      endBadge = {
        x: endX,
        y: trunkCenterY - END_H / 2,
        width: END_W,
        height: END_H,
      };
      const lastRightX = stageXs[stages.length - 1] + CARD_W;
      connectors.push({
        id: 'conn_h_end',
        d: `M ${lastRightX} ${trunkCenterY} L ${endX - 4} ${trunkCenterY}`,
        kind: 'trunk',
      });

      // Group consecutive horizontal columns sharing blockId
      let runStart = -1;
      for (let i = 0; i <= stages.length; i++) {
        const curBlockId = i < stages.length ? stages[i].blockId : undefined;
        const prevBlockId = runStart >= 0 ? stages[runStart].blockId : undefined;
        if (curBlockId && curBlockId === prevBlockId) {
          continue;
        }
        if (runStart >= 0 && prevBlockId) {
          const runEnd = i - 1;
          const bStage = stages[runStart];
          const maxSpanRows = Math.max(
            1,
            ...stages.slice(runStart, runEnd + 1).map((s) => 1 + s.altVariants.length)
          );
          const leftPad = stages[runStart].altVariants.length > 0 ? 54 : 18;
          const boxX = stageXs[runStart] - leftPad;
          const boxRight =
            stageXs[runEnd] + CARD_W + (stages[runEnd].altVariants.length > 0 ? 24 : 14);
          blockBoxes.push({
            id: `blk_h_${prevBlockId}_${runStart}`,
            name: bStage.blockName || 'Process Module',
            color: bStage.blockColor || '#6366f1',
            x: boxX,
            y: trunkY - 26,
            width: boxRight - boxX,
            height: maxSpanRows * cardH + (maxSpanRows - 1) * ROW_GAP + 42,
          });
        }
        runStart = curBlockId ? i : -1;
      }
    } else {
      // Serpentine Flowchart (2-Col or 3-Col Snake)
      const cols = flowMode === 'snake-2' ? 2 : 3;
      const COL_GAP = 54;
      const ROW_GAP = 46;
      const VAR_STACK_GAP = 24;

      const totalRows = Math.ceil(stages.length / cols);
      const rowYs: number[] = [];
      let curY = MARGIN_Y;

      for (let r = 0; r < totalRows; r++) {
        rowYs.push(curY);
        const startIdx = r * cols;
        const endIdx = Math.min(stages.length, startIdx + cols);
        let maxStackInRow = 1;
        for (let idx = startIdx; idx < endIdx; idx++) {
          const stackCount = 1 + stages[idx].altVariants.length;
          if (stackCount > maxStackInRow) maxStackInRow = stackCount;
        }
        const rowH = maxStackInRow * cardH + (maxStackInRow - 1) * VAR_STACK_GAP;
        curY += rowH + ROW_GAP;
      }

      contentWidth = Math.max(760, MARGIN_X * 2 + cols * CARD_W + (cols - 1) * COL_GAP);

      const stageCoords: { x: number; y: number; row: number; col: number }[] = [];

      stages.forEach((st, idx) => {
        const row = Math.floor(idx / cols);
        const posInRow = idx % cols;
        const col = row % 2 === 0 ? posInRow : cols - 1 - posInRow;
        const x = MARGIN_X + col * (CARD_W + COL_GAP);
        const y = rowYs[row];
        stageCoords.push({ x, y, row, col });

        nodes.push({ x, y, stageIdx: idx, variantIdx: -1 });

        if (st.altVariants.length > 0) {
          const railX = x - 14;
          const branchAnchorY = y + cardH / 2;
          st.altVariants.forEach((_, vIdx) => {
            const vy = y + (vIdx + 1) * (cardH + VAR_STACK_GAP);
            nodes.push({ x, y: vy, stageIdx: idx, variantIdx: vIdx });
            connectors.push({
              id: `conn_snk_br_${idx}_${vIdx}`,
              d: `M ${x} ${branchAnchorY} L ${railX} ${branchAnchorY} L ${railX} ${vy + cardH / 2} L ${x - 4} ${vy + cardH / 2}`,
              kind: 'branch',
            });
          });
        }

        if (idx > 0) {
          const prev = stageCoords[idx - 1];
          const prevMidY = prev.y + cardH / 2;
          const curMidY = y + cardH / 2;
          if (prev.row === row) {
            if (col > prev.col) {
              // Left to Right
              connectors.push({
                id: `conn_snk_${idx}`,
                d: `M ${prev.x + CARD_W} ${prevMidY} L ${x - 4} ${curMidY}`,
                kind: 'trunk',
              });
            } else {
              // Right to Left
              connectors.push({
                id: `conn_snk_${idx}`,
                d: `M ${prev.x} ${prevMidY} L ${x + CARD_W + 4} ${curMidY}`,
                kind: 'trunk',
              });
            }
          } else {
            // Row turn: route down along the outer gutter of the turning column so we never cross stacked variants
            const turnRightSide = prev.col === cols - 1;
            const prevAltCount = stages[idx - 1].altVariants.length;
            if (prevAltCount === 0) {
              const px = prev.x + CARD_W / 2;
              const py = prev.y + cardH;
              connectors.push({
                id: `conn_snk_${idx}`,
                d: `M ${px} ${py} L ${x + CARD_W / 2} ${y - 4}`,
                kind: 'trunk',
              });
            } else {
              const gutterX = turnRightSide ? prev.x + CARD_W + 22 : prev.x - 22;
              const startX = turnRightSide ? prev.x + CARD_W : prev.x;
              const endX = turnRightSide ? x + CARD_W + 4 : x - 4;
              connectors.push({
                id: `conn_snk_${idx}`,
                d: `M ${startX} ${prevMidY} L ${gutterX} ${prevMidY} L ${gutterX} ${curMidY} L ${endX} ${curMidY}`,
                kind: 'trunk',
              });
            }
          }
        }
      });

      const END_W = 240;
      const END_H = 30;
      const lastCoord = stageCoords[stageCoords.length - 1];
      const lastBottom = curY - ROW_GAP + 24;
      endBadge = {
        x: lastCoord.x + CARD_W / 2 - END_W / 2,
        y: lastBottom,
        width: END_W,
        height: END_H,
      };
      const lastStackBottom =
        lastCoord.y +
        (1 + stages[stages.length - 1].altVariants.length) * cardH +
        stages[stages.length - 1].altVariants.length * VAR_STACK_GAP;
      connectors.push({
        id: 'conn_snk_end',
        d: `M ${lastCoord.x + CARD_W / 2} ${lastStackBottom} L ${lastCoord.x + CARD_W / 2} ${lastBottom - 4}`,
        kind: 'trunk',
      });
      contentHeight = lastBottom + END_H + 24;
    }

    return {
      nodes,
      connectors,
      diamonds,
      blockBoxes,
      endBadge,
      contentWidth,
      contentHeight,
    };
  }, [stages, flowMode, cardH]);

  // Wrapped Materials Legend computation
  const legendLayout = useMemo(() => {
    if (!showLegend || allUsedMaterials.length === 0) {
      return { rows: [], height: 0 };
    }
    const itemW = 165;
    const usableW = Math.max(320, layoutGeometry.contentWidth - 150);
    const itemsPerRow = Math.max(1, Math.floor(usableW / itemW));
    const rows: typeof allUsedMaterials[] = [];
    for (let i = 0; i < allUsedMaterials.length; i += itemsPerRow) {
      rows.push(allUsedMaterials.slice(i, i + itemsPerRow));
    }
    return {
      rows,
      height: rows.length * 22 + 34,
    };
  }, [showLegend, allUsedMaterials, layoutGeometry.contentWidth]);

  const masterSvgWidth = layoutGeometry.contentWidth;
  const masterSvgHeight = layoutGeometry.contentHeight + legendLayout.height;

  const formatStepSubtitle = (
    step: ProcessStep,
    customSubtitle?: string,
    reticleName?: string
  ): string => {
    if (customSubtitle) return customSubtitle;
    const sidePrefix =
      step.side === 'back' ? '[Backside] ' : step.side === 'both' ? '[Both Sides] ' : '';

    if (step.type === 'deposition') {
      return `${sidePrefix}${step.deposition?.method || 'CVD'} · ${formatThickness(
        step.deposition?.thickness || step.thickness || 200,
        thicknessUnit
      )}`;
    }
    if (step.type === 'lithography') {
      const coatLabel =
        step.lithography?.coatMethod === 'dry-film'
          ? 'Dry Film Litho'
          : step.lithography?.coatMethod === 'lor-bilayer'
          ? `LOR Bilayer (${formatThickness(step.lithography?.lorUndercut ?? 350, thicknessUnit)} UC)`
          : 'Photolithography';
      return `${sidePrefix}${coatLabel} · ${step.lithography?.polarity} resist · ${
        step.lithography?.maskField === 'light-field' ? 'light-field' : 'dark-field'
      }${reticleName ? ` · ${reticleName}` : ''}`;
    }
    if (step.type === 'etch') {
      return `${sidePrefix}Etch: ${step.etch?.etchType?.toUpperCase()} · depth ${formatThickness(
        step.etch?.depth || step.thickness || 200,
        thicknessUnit
      )}${
        step.etch?.ardeEnabled &&
        ['rie', 'drie-bosch', 'ion-beam', 'ashing'].includes(step.etch?.etchType || 'rie')
          ? ' · ARDE'
          : ''
      }`;
    }
    if (step.type === 'strip') {
      return `${sidePrefix}${step.strip?.stripType} · ${step.strip?.solvent || 'solvent'}`;
    }
    if (step.type === 'liftoff') return `${sidePrefix}Metal Lift-off`;
    if (step.type === 'cmp') return `${sidePrefix}Grind / Polish / Planarize`;
    if (step.type === 'bonding') {
      return `${sidePrefix}Wafer Bonding (${step.bonding?.bondingMethod || 'fusion'}) · ${
        step.bonding?.sourceType === 'imported-flow'
          ? step.bonding?.importedFlowTitle || 'Imported Wafer'
          : 'Custom Substrate'
      }`;
    }
    if (step.type === 'dicing') {
      return `${sidePrefix}Dicing (${step.dicing?.method || 'blade'}) · ${
        step.dicing?.streets?.length || 1
      } cut${(step.dicing?.streets?.length || 1) === 1 ? '' : 's'} · kerf ${formatThickness(
        step.dicing?.kerfWidth || 400,
        thicknessUnit
      )}`;
    }
    if (step.type === 'tape-frame') {
      return `${sidePrefix}Tape & Frame (${
        step.tapeFrame?.action === 'demount' ? 'UV Demount' : 'Mount'
      })`;
    }
    if (step.type === 'anneal') return `${sidePrefix}Thermal Anneal`;
    return `${sidePrefix}${step.type}`;
  };

  const handleActivateVariantFromChart = (stage: FlowchartStage, variantId: string) => {
    if (!onUpdateFlow || stage.flowStepIndex < 0) {
      onSelectStepIndex(stage.flowStepIndex);
      onClose();
      return;
    }
    const targetStep = flow.steps[stage.flowStepIndex];
    if (!targetStep) return;
    const switched = switchStepVariant(targetStep, variantId);
    let nextFlow: ProcessFlow = {
      ...flow,
      steps: flow.steps.map((s, idx) => (idx === stage.flowStepIndex ? switched : s)),
    };
    if (switched.type === 'lithography') {
      nextFlow = syncStepWindowsToMask(nextFlow, switched);
    }
    onUpdateFlow(nextFlow);
  };

  // Export full flowchart diagram to SVG
  const handleExportSvg = () => {
    const svgEl = containerRef.current?.querySelector('#multi-step-master-svg');
    if (!svgEl) return;
    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(svgEl);
    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${flow.title.toLowerCase().replace(/\s+/g, '-')}-process-flowchart.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Export full flowchart diagram to PNG
  const handleExportPng = () => {
    const svgEl = containerRef.current?.querySelector(
      '#multi-step-master-svg'
    ) as SVGSVGElement | null;
    if (!svgEl) return;
    setIsExporting(true);

    try {
      const serializer = new XMLSerializer();
      const svgStr = serializer.serializeToString(svgEl);
      const img = new Image();
      const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);

      img.onload = () => {
        const canvas = document.createElement('canvas');
        const scaleFactor = 2;
        canvas.width = masterSvgWidth * scaleFactor;
        canvas.height = masterSvgHeight * scaleFactor;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          setIsExporting(false);
          return;
        }

        ctx.scale(scaleFactor, scaleFactor);
        ctx.fillStyle = theme === 'paper' ? '#ffffff' : '#060a12';
        ctx.fillRect(0, 0, masterSvgWidth, masterSvgHeight);
        ctx.drawImage(img, 0, 0, masterSvgWidth, masterSvgHeight);

        const pngUrl = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = pngUrl;
        a.download = `${flow.title.toLowerCase().replace(/\s+/g, '-')}-process-flowchart.png`;
        a.click();
        URL.revokeObjectURL(url);
        setIsExporting(false);
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        setIsExporting(false);
      };

      img.src = url;
    } catch (err) {
      console.error('PNG export failed', err);
      setIsExporting(false);
    }
  };

  const trunkStrokeColor = theme === 'paper' ? '#0284c7' : '#38bdf8';
  const branchStrokeColor = theme === 'paper' ? '#7c3aed' : '#a78bfa';
  const rejoinStrokeColor = theme === 'paper' ? '#64748b' : '#94a3b8';

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950/95 backdrop-blur-md text-slate-100">
      {/* Top Header Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 sm:px-6 py-2.5 sm:py-3.5 bg-slate-900 border-b border-slate-800 shadow-md shrink-0">
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
          <Workflow className="w-5 h-5 text-sky-400 shrink-0" />
          <div className="min-w-0">
            <h2 className="text-xs sm:text-sm font-bold text-white tracking-wide truncate">
              Process Flowchart Figure
            </h2>
            <span className="hidden sm:block text-xs text-slate-400 font-mono">
              Sequential Fabrication Flowchart with Cross-Sections &amp; Variant Branches
            </span>
          </div>
        </div>

        {/* Flowchart Customization Controls */}
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          {/* Flowchart Orientation / Mode */}
          <div className="flex items-center gap-0.5 bg-slate-800 p-0.5 rounded-lg border border-slate-700 text-[11px]">
            <button
              type="button"
              onClick={() => setFlowMode('vertical')}
              className={`flex items-center gap-1 px-2 py-1 rounded font-medium transition-colors ${
                flowMode === 'vertical'
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Top-to-bottom flowchart with side variant branches"
            >
              <ArrowDown className="w-3 h-3" />
              <span>Vertical</span>
            </button>
            <button
              type="button"
              onClick={() => setFlowMode('horizontal')}
              className={`flex items-center gap-1 px-2 py-1 rounded font-medium transition-colors ${
                flowMode === 'horizontal'
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Left-to-right pipeline flowchart with downward variant branches"
            >
              <ArrowRight className="w-3 h-3" />
              <span>Horizontal</span>
            </button>
            <button
              type="button"
              onClick={() => setFlowMode('snake-2')}
              className={`px-2 py-1 rounded font-mono transition-colors ${
                flowMode === 'snake-2'
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Compact 2-column serpentine flowchart"
            >
              2-Col Flow
            </button>
            <button
              type="button"
              onClick={() => setFlowMode('snake-3')}
              className={`px-2 py-1 rounded font-mono transition-colors ${
                flowMode === 'snake-3'
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Compact 3-column serpentine flowchart"
            >
              3-Col Flow
            </button>
          </div>

          {/* Variants Toggle */}
          <button
            type="button"
            onClick={() => setShowVariants((v) => !v)}
            aria-pressed={showVariants}
            className={`flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-colors ${
              showVariants
                ? 'bg-violet-500/20 border-violet-500/55 text-violet-200'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-violet-200'
            }`}
            title={
              variantStepCount > 0
                ? `${showVariants ? 'Showing' : 'Hiding'} process step variant branches (${variantStepCount} step${variantStepCount > 1 ? 's' : ''} with variants)`
                : 'Include process variant branches when steps define variants'
            }
          >
            <GitBranch className="w-3.5 h-3.5" />
            <span>Variants{variantStepCount > 0 ? ` (${variantStepCount})` : ''}</span>
          </button>

          {/* Substrate Start Frame Toggle */}
          <button
            type="button"
            onClick={() => setIncludeSubstrateFrame(!includeSubstrateFrame)}
            className={`px-2 sm:px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-colors ${
              includeSubstrateFrame
                ? 'bg-emerald-600/20 border-emerald-500/50 text-emerald-300'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
            title="Toggle starting substrate node"
          >
            Start (a): {includeSubstrateFrame ? 'ON' : 'OFF'}
          </button>

          {/* Process Block Last Step Only Filter */}
          <button
            type="button"
            disabled={!hasBlocks}
            onClick={() => setBlockLastStepOnly((prev) => !prev)}
            aria-pressed={blockLastStepOnly && hasBlocks}
            className={`flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-colors ${
              !hasBlocks
                ? 'bg-slate-800/60 border-slate-700/60 text-slate-500 cursor-not-allowed'
                : blockLastStepOnly
                ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-indigo-300'
            }`}
            title={
              !hasBlocks
                ? 'No process blocks in this flow — group steps into blocks to streamline by block'
                : blockLastStepOnly
                ? 'Showing only the last step of each process block'
                : 'Show only the last step of each process block'
            }
          >
            <Boxes className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Block End Only</span>
          </button>

          {/* Bookmarked Milestones Filter */}
          {hasBookmarkedSteps && (
            <button
              type="button"
              onClick={() => setMilestonesOnly((prev) => !prev)}
              className={`flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-colors ${
                milestonesOnly
                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                  : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-amber-300'
              }`}
              title="Show only bookmarked milestone steps"
            >
              <Bookmark className={`w-3 h-3 ${milestonesOnly ? 'fill-amber-400' : ''}`} />
              <span className="hidden md:inline">Milestones</span>
            </button>
          )}

          {/* Recipe Subtitle Toggle */}
          <button
            type="button"
            onClick={() => setShowToolInfo((v) => !v)}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-medium transition-colors ${
              showToolInfo
                ? 'bg-sky-600/20 border-sky-500/50 text-sky-300'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
            title="Show or hide recipe parameter subtitles inside flowchart nodes"
          >
            <FileText className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">Specs</span>
          </button>

          {/* Theme Selector */}
          <div className="flex items-center gap-0.5 bg-slate-800 p-0.5 rounded-lg border border-slate-700 text-[11px]">
            <button
              type="button"
              onClick={() => setTheme('paper')}
              className={`px-2 py-1 rounded font-medium transition-colors ${
                theme === 'paper'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Paper
            </button>
            <button
              type="button"
              onClick={() => setTheme('dark')}
              className={`px-2 py-1 rounded font-medium transition-colors ${
                theme === 'dark'
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Dark
            </button>
          </div>

          {/* Hatch vs Solid toggle */}
          <button
            type="button"
            onClick={() => setRenderMode((prev) => (prev === 'hatch' ? 'solid' : 'hatch'))}
            aria-pressed={renderMode === 'hatch'}
            className={`px-2 py-1 rounded-lg border text-[11px] font-medium transition-colors ${
              renderMode === 'hatch'
                ? 'bg-sky-600/20 border-sky-500/50 text-sky-300'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
            title="Toggle Cleanroom Hatching Patterns"
          >
            Hatch
          </button>

          {/* Z Scaling Controls: Vertical Exaggeration Factor, Shared Y Lock, & Piecewise Z-Map */}
          <div
            className="flex items-center gap-1 px-1.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-300"
            title="Vertical Exaggeration Factor (synced with Cross-Section Canvas)"
          >
            <span className="text-[10px] text-slate-400 font-mono">Z:</span>
            <select
              value={zAspect1to1 ? 'aspect-1to1' : zScale.toFixed(1)}
              onChange={(e) => {
                const rawVal = e.target.value;
                if (rawVal === 'aspect-1to1') {
                  setZAspect1to1(true);
                  return;
                }
                setZAspect1to1(false);
                setZScale(parseFloat(rawVal));
              }}
              aria-label="Process figure Z scale factor"
              className="bg-transparent text-white font-mono text-[11px] focus:outline-none cursor-pointer"
            >
              <option value="1.0" className="bg-slate-900">1.0×</option>
              <option value="1.5" className="bg-slate-900">1.5×</option>
              <option value="2.0" className="bg-slate-900">2.0× (Fit)</option>
              <option value="3.5" className="bg-slate-900">3.5×</option>
              <option value="5.0" className="bg-slate-900">5.0×</option>
              <option value="aspect-1to1" className="bg-slate-900">
                {isTrueAspectClamped ? '1:1 (Capped)' : '1:1 (X=Y)'}
              </option>
            </select>
          </div>

          <button
            type="button"
            onClick={toggleSharedYScale}
            aria-pressed={sharedYScale}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-medium transition-colors ${
              sharedYScale
                ? 'bg-amber-500/20 border-amber-400/60 text-amber-200'
                : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white hover:bg-slate-700'
            }`}
            title={
              sharedYScale
                ? 'Shared Y-Axis Scale Across All Steps (click to fit each step individually)'
                : 'Fit Each Step Independently (click to lock shared Y-axis scale across all steps)'
            }
          >
            {sharedYScale ? (
              <Lock className="w-3.5 h-3.5 text-amber-300" />
            ) : (
              <Unlock className="w-3.5 h-3.5 text-slate-400" />
            )}
            <span className="hidden xl:inline">{sharedYScale ? 'Shared Y' : 'Fit Step'}</span>
          </button>

          <div ref={piecewiseMenuRef} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setShowPiecewisePopover((v) => !v)}
              aria-expanded={showPiecewisePopover}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-medium transition-colors ${
                piecewiseMode !== 'linear'
                  ? sharedZTransform.isActive || !sharedYScale
                    ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-200'
                    : 'bg-sky-600/20 border-sky-500/40 text-sky-300'
                  : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
              }`}
              title="Piecewise Z-Axis Scaling for multi-order-of-magnitude layers"
            >
              <span className="font-mono text-[10px] text-slate-400">Z-Map:</span>
              <span className="font-mono text-[10px]">
                {piecewiseMode === 'linear'
                  ? 'Linear'
                  : piecewiseMode === 'auto'
                  ? sharedZTransform.isActive
                    ? `Auto (${sharedZTransform.bands.length})`
                    : 'Auto (1)'
                  : `Custom (${sharedZTransform.bands.length})`}
              </span>
              {piecewiseMode === 'linear' && autoPreviewTransform.isActive && (
                <span
                  className="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0"
                  title={`${autoPreviewTransform.bands.length} Z-scale regimes detected`}
                />
              )}
              <ChevronDown className="w-3 h-3 opacity-70" />
            </button>

            {showPiecewisePopover && (
              <PiecewiseZPopover
                mode={piecewiseMode}
                onChangeMode={handleChangePiecewiseMode}
                autoCompression={autoCompression}
                onChangeAutoCompression={setAutoCompression}
                customConfig={customZConfig}
                onChangeCustomConfig={setCustomZConfig}
                zTransform={sharedZTransform}
                autoPreviewTransform={autoPreviewTransform}
                thicknessUnit={thicknessUnit}
                onSeedCustomFromAuto={handleSeedCustomFromAuto}
                onClose={() => setShowPiecewisePopover(false)}
              />
            )}
          </div>

          {/* Shape Outline toggle */}
          <button
            type="button"
            onClick={() => setShowOutlines((prev) => !prev)}
            aria-pressed={showOutlines}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-medium transition-colors ${
              showOutlines
                ? 'bg-sky-600/20 border-sky-500/50 text-sky-300'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
            title={showOutlines ? 'Hide Shape Outlines' : 'Show Shape Outlines'}
          >
            <Square className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">Outline</span>
          </button>

          {/* Export Buttons */}
          <button
            type="button"
            onClick={handleExportSvg}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-[11px] font-medium transition-colors"
          >
            <FileDown className="w-3.5 h-3.5 text-sky-400" />
            <span>SVG</span>
          </button>

          <button
            type="button"
            onClick={handleExportPng}
            disabled={isExporting}
            className="flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-semibold shadow-md transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{isExporting ? 'Exporting...' : 'PNG'}</span>
          </button>

          {onOpenBatchExport && (
            <button
              type="button"
              onClick={onOpenBatchExport}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sky-300 hover:text-sky-200 text-[11px] font-medium transition-colors"
              title="Batch export all cross-section steps as individual SVG or PNG files"
            >
              <Files className="w-3.5 h-3.5 text-sky-400" />
              <span className="hidden sm:inline">Batch Steps</span>
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            className="px-2.5 sm:px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>

      {/* Main Flowchart Canvas Viewport */}
      <div
        ref={containerRef}
        className={`flex-1 overflow-auto p-3 sm:p-8 ${
          theme === 'paper' ? 'bg-slate-200' : 'bg-slate-950'
        }`}
      >
        <div
          className={`mx-auto p-4 sm:p-8 rounded-xl shadow-2xl transition-all shrink-0 ${
            theme === 'paper'
              ? 'bg-white text-slate-900 border border-slate-300'
              : 'bg-[#060a12] text-slate-100 border border-slate-800'
          }`}
          style={{ width: `${masterSvgWidth + 64}px` }}
        >
          {/* Flow Title Header on Figure */}
          <div
            className={`mb-4 pb-3 border-b flex flex-wrap items-end justify-between gap-3 ${
              theme === 'paper' ? 'border-slate-200' : 'border-slate-800'
            }`}
          >
            <div>
              <h1 className="text-xl font-bold tracking-tight">{flow.title}</h1>
              <p className="text-xs text-slate-500 mt-1 max-w-3xl">{flow.description}</p>
            </div>

            {/* Interactive Legend Hint */}
            <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono">
              <span
                className={`px-1.5 py-0.5 rounded border text-[10px] ${
                  theme === 'paper'
                    ? 'bg-slate-100 border-slate-300 text-slate-700'
                    : 'bg-slate-900 border-slate-700 text-slate-300'
                }`}
              >
                Z:{' '}
                {zAspect1to1
                  ? isTrueAspectClamped
                    ? '1:1 (Capped)'
                    : '1:1 (X=Y)'
                  : `${zScale.toFixed(1).replace(/\.0$/, '')}×`}{' '}
                · {sharedYScale ? 'Shared Y' : 'Per-Step Fit'}
                {piecewiseMode !== 'linear' &&
                  (sharedZTransform.isActive || !sharedYScale) &&
                  ` · Piecewise ${piecewiseMode === 'auto' ? 'Auto' : 'Custom'}`}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="w-3 h-0.5 inline-block"
                  style={{ backgroundColor: trunkStrokeColor }}
                />
                <span className={theme === 'paper' ? 'text-slate-600' : 'text-slate-400'}>
                  Primary Flow
                </span>
              </span>
              {showVariants && variantStepCount > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="w-3 h-0.5 inline-block"
                    style={{ backgroundColor: branchStrokeColor }}
                  />
                  <span className={theme === 'paper' ? 'text-violet-700' : 'text-violet-300'}>
                    Variant Branch (click to switch)
                  </span>
                </span>
              )}
            </div>
          </div>

          {/* Master Flowchart SVG */}
          <svg
            id="multi-step-master-svg"
            viewBox={`0 0 ${masterSvgWidth} ${masterSvgHeight}`}
            width={masterSvgWidth}
            height={masterSvgHeight}
            className="overflow-visible select-none"
          >
            <SvgPatterns materials={flow.materials} />

            {/* Flowchart Arrow Markers & Node Clip Path */}
            <defs>
              <marker
                id="fc-arrow-trunk"
                markerWidth="8"
                markerHeight="8"
                refX="6"
                refY="4"
                orient="auto"
              >
                <path d="M 0 1 L 7 4 L 0 7 Z" fill={trunkStrokeColor} />
              </marker>
              <marker
                id="fc-arrow-branch"
                markerWidth="8"
                markerHeight="8"
                refX="6"
                refY="4"
                orient="auto"
              >
                <path d="M 0 1 L 7 4 L 0 7 Z" fill={branchStrokeColor} />
              </marker>
              <marker
                id="fc-arrow-rejoin"
                markerWidth="7"
                markerHeight="7"
                refX="5"
                refY="3.5"
                orient="auto"
              >
                <path d="M 0 1 L 6 3.5 L 0 6 Z" fill={rejoinStrokeColor} />
              </marker>
              <clipPath id="fc-card-clip">
                <rect x="0" y="0" width={CARD_W} height={cardH} rx="10" />
              </clipPath>
            </defs>

            {/* Layer 1: Process Module / Block Swimlane Containers */}
            {layoutGeometry.blockBoxes.map((box) => (
              <g key={box.id}>
                <rect
                  x={box.x}
                  y={box.y}
                  width={box.width}
                  height={box.height}
                  rx="14"
                  fill={box.color}
                  fillOpacity={theme === 'paper' ? '0.04' : '0.06'}
                  stroke={box.color}
                  strokeOpacity={theme === 'paper' ? '0.45' : '0.5'}
                  strokeWidth="1.2"
                  strokeDasharray="6 4"
                />
                <rect
                  x={box.x + 12}
                  y={box.y - 9}
                  width={Math.min(box.width - 24, Math.max(120, box.name.length * 6.5 + 24))}
                  height="18"
                  rx="5"
                  fill={theme === 'paper' ? '#ffffff' : '#0f172a'}
                  stroke={box.color}
                  strokeWidth="1"
                />
                <text
                  x={box.x + 20}
                  y={box.y + 3}
                  fill={theme === 'paper' ? '#1e293b' : '#e2e8f0'}
                  fontSize="9.5"
                  fontWeight="700"
                  fontFamily="Plus Jakarta Sans, sans-serif"
                >
                  {box.name.length > 42 ? `${box.name.slice(0, 40)}…` : box.name}
                </text>
              </g>
            ))}

            {/* Layer 2: Flowchart Connector Paths & Arrows */}
            {layoutGeometry.connectors.map((conn) => {
              if (conn.kind === 'trunk') {
                return (
                  <path
                    key={conn.id}
                    d={conn.d}
                    fill="none"
                    stroke={trunkStrokeColor}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    markerEnd="url(#fc-arrow-trunk)"
                  />
                );
              }
              if (conn.kind === 'branch') {
                return (
                  <path
                    key={conn.id}
                    d={conn.d}
                    fill="none"
                    stroke={branchStrokeColor}
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    markerEnd="url(#fc-arrow-branch)"
                  />
                );
              }
              return (
                <path
                  key={conn.id}
                  d={conn.d}
                  fill="none"
                  stroke={rejoinStrokeColor}
                  strokeWidth="1.3"
                  strokeDasharray="4 3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  markerEnd="url(#fc-arrow-rejoin)"
                />
              );
            })}

            {/* Layer 3: Variant Branch Decision Diamonds */}
            {layoutGeometry.diamonds.map((dm) => (
              <g key={dm.id} transform={`translate(${dm.cx}, ${dm.cy})`}>
                <path
                  d="M 0 -13 L 15 0 L 0 13 L -15 0 Z"
                  fill={theme === 'paper' ? '#f5f3ff' : '#1e1b4b'}
                  stroke={branchStrokeColor}
                  strokeWidth="1.6"
                />
                <text
                  x="0"
                  y="3.5"
                  textAnchor="middle"
                  fill={theme === 'paper' ? '#5b21b6' : '#ddd6fe'}
                  fontSize="8.5"
                  fontWeight="700"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {dm.count}×
                </text>
                <text
                  x="-21"
                  y="3.5"
                  textAnchor="end"
                  fill={theme === 'paper' ? '#6d28d9' : '#c4b5fd'}
                  fontSize="8.5"
                  fontWeight="600"
                  fontFamily="JetBrains Mono, monospace"
                >
                  BRANCH
                </text>
              </g>
            ))}

            {/* Layer 4: Flowchart Step & Variant Cards */}
            {layoutGeometry.nodes.map((node) => {
              const stage = stages[node.stageIdx];
              const isAltVariant = node.variantIdx >= 0;
              const altVar = isAltVariant ? stage.altVariants[node.variantIdx] : null;

              const renderStep = altVar ? altVar.step : stage.step;
              const renderMesh = altVar ? altVar.mesh : stage.mesh;
              const renderPolygons = altVar ? altVar.polygons : stage.polygons;
              const renderReticle = altVar ? altVar.reticleName : stage.reticleName;
              const variantLabel = altVar ? altVar.variantName : stage.activeVariantName;
              const hasStepVariants = stage.totalVariantCount > 1;

              const accentColor =
                stage.kind === 'substrate'
                  ? STEP_ACCENT_COLORS.substrate
                  : isAltVariant
                  ? branchStrokeColor
                  : STEP_ACCENT_COLORS[renderStep.type] || '#0284c7';

              const cardBg = isAltVariant
                ? theme === 'paper'
                  ? '#faf5ff'
                  : '#141028'
                : theme === 'paper'
                ? '#fafafa'
                : '#0f172a';

              const cardBorder = isAltVariant
                ? branchStrokeColor
                : renderStep.bookmarked
                ? '#f59e0b'
                : stage.kind === 'substrate'
                ? '#10b981'
                : theme === 'paper'
                ? '#cbd5e1'
                : '#1e293b';

              const scaleX = (CARD_W - PAD_X * 2) / waferWidth;
              let cardMinY = globalBounds.minY;
              let cardMaxY = globalBounds.maxY;
              if (!sharedYScale) {
                let sMinY = Number.isFinite(renderMesh.minY) ? renderMesh.minY : Infinity;
                let sMaxY = Number.isFinite(renderMesh.maxY) ? renderMesh.maxY : -Infinity;
                for (const poly of renderPolygons) {
                  if (Number.isFinite(poly.yMin) && poly.yMin < sMinY) sMinY = poly.yMin;
                  if (Number.isFinite(poly.yMax) && poly.yMax > sMaxY) sMaxY = poly.yMax;
                }
                if (!Number.isFinite(sMinY)) sMinY = 0;
                if (!Number.isFinite(sMaxY)) sMaxY = 3000;
                if (sMaxY - sMinY < 300) sMaxY = sMinY + 300;
                cardMinY = sMinY;
                cardMaxY = sMaxY;
              }
              const cardSpanY = Math.max(100, cardMaxY - cardMinY);
              const scaleY = availPolyH / cardSpanY;

              const cardZTransform = sharedYScale
                ? sharedZTransform
                : piecewiseMode === 'linear'
                ? null
                : computePiecewiseZTransform({
                    mode: piecewiseMode,
                    polygons: renderPolygons,
                    rawMinY: cardMinY,
                    rawMaxY: cardMaxY,
                    waferWidth,
                    autoCompression,
                    customConfig: customZConfig,
                  });

              const polysToRender =
                cardZTransform &&
                cardZTransform.isActive &&
                cardZTransform.breakpoints.length > 0
                  ? renderPolygons.map((poly) => ({
                      ...poly,
                      points: subdividePolygonAtBreakpoints(
                        poly.points,
                        cardZTransform.breakpoints
                      ),
                    }))
                  : renderPolygons;

              const toScreenLocal = (x: number, y: number) => {
                const visY =
                  cardZTransform && cardZTransform.isActive
                    ? cardZTransform.mapY(y)
                    : y;
                const sx = PAD_X + x * scaleX;
                const sy = cardH - PAD_Y - (visY - cardMinY) * scaleY;
                return { x: sx, y: sy };
              };

              const badgeText = isAltVariant
                ? `ALT · ${variantLabel}`
                : stage.kind === 'substrate'
                ? 'START'
                : hasStepVariants && variantLabel
                ? `ACTIVE · ${variantLabel}`
                : renderStep.type.toUpperCase();

              const badgeFill = isAltVariant
                ? theme === 'paper'
                  ? '#ede9fe'
                  : '#2e1065'
                : stage.kind === 'substrate'
                ? theme === 'paper'
                  ? '#d1fae5'
                  : '#064e3b'
                : hasStepVariants
                ? theme === 'paper'
                  ? '#e0f2fe'
                  : '#0c4a6e'
                : theme === 'paper'
                ? '#f1f5f9'
                : '#1e293b';

              const badgeTextFill = isAltVariant
                ? theme === 'paper'
                  ? '#6d28d9'
                  : '#ddd6fe'
                : stage.kind === 'substrate'
                ? theme === 'paper'
                  ? '#047857'
                  : '#6ee7b7'
                : hasStepVariants
                ? theme === 'paper'
                  ? '#0369a1'
                  : '#7dd3fc'
                : theme === 'paper'
                ? '#475569'
                : '#94a3b8';

              const badgeWidth = Math.min(136, Math.max(52, badgeText.length * 5.8 + 14));
              const maxTitleChars = Math.max(20, Math.floor((CARD_W - badgeWidth - PAD_X - 18) / 6.4));
              const rawTitleText = `${stage.letter} ${renderStep.title}${
                renderStep.bookmarked
                  ? ` ★ ${renderStep.bookmarkLabel || 'Milestone'}`
                  : ''
              }`;
              const displayTitleText =
                rawTitleText.length > maxTitleChars
                  ? `${rawTitleText.slice(0, maxTitleChars - 1)}…`
                  : rawTitleText;
              const subtitleText = formatStepSubtitle(
                renderStep,
                isAltVariant ? undefined : stage.customSubtitle,
                renderReticle
              );

              return (
                <g
                  key={
                    altVar
                      ? `${stage.key}_var_${altVar.variantId}`
                      : `${stage.key}_trunk`
                  }
                  transform={`translate(${node.x}, ${node.y})`}
                  className="cursor-pointer"
                  onClick={() => {
                    if (altVar && onUpdateFlow) {
                      handleActivateVariantFromChart(stage, altVar.variantId);
                    } else {
                      onSelectStepIndex(stage.flowStepIndex);
                      onClose();
                    }
                  }}
                >
                  {/* Card Outer Shell */}
                  <rect
                    width={CARD_W}
                    height={cardH}
                    rx="10"
                    fill={cardBg}
                    stroke={cardBorder}
                    strokeWidth={isAltVariant || renderStep.bookmarked ? '1.6' : '1.2'}
                    strokeDasharray={isAltVariant ? '5 3' : undefined}
                  />

                  {/* Left Accent Strip */}
                  <g clipPath="url(#fc-card-clip)">
                    <rect x="0" y="0" width="5" height={cardH} fill={accentColor} />

                    {/* Top-Right Status / Variant Pill */}
                    <rect
                      x={CARD_W - badgeWidth - 10}
                      y="9"
                      width={badgeWidth}
                      height="16"
                      rx="4"
                      fill={badgeFill}
                      stroke={isAltVariant ? branchStrokeColor : 'none'}
                      strokeWidth="0.6"
                    />
                    <text
                      x={CARD_W - 10 - badgeWidth / 2}
                      y="20"
                      textAnchor="middle"
                      fill={badgeTextFill}
                      fontSize="8.5"
                      fontWeight="700"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {badgeText.length > 20 ? `${badgeText.slice(0, 18)}…` : badgeText}
                    </text>

                    {/* Node Title */}
                    <text
                      x={PAD_X - 4}
                      y="21"
                      fill={theme === 'paper' ? '#0f172a' : '#f8fafc'}
                      fontSize="11"
                      fontWeight="700"
                      fontFamily="Plus Jakarta Sans, sans-serif"
                    >
                      {displayTitleText}
                    </text>

                    {/* Subtitle / Process Specs */}
                    {showToolInfo && (
                      <text
                        x={PAD_X - 4}
                        y="35"
                        fill={theme === 'paper' ? '#64748b' : '#94a3b8'}
                        fontSize="8.8"
                        fontFamily="JetBrains Mono, monospace"
                      >
                        {subtitleText.length > 58
                          ? `${subtitleText.slice(0, 56)}…`
                          : subtitleText}
                      </text>
                    )}

                    {/* Cross-Section Polygons */}
                    <g>
                      {polysToRender.map((poly) => {
                        const mat = getMaterialById(flow.materials, poly.materialId);
                        const pts = poly.points;
                        if (pts.length < 3) return null;

                        const first = toScreenLocal(pts[0].x, pts[0].y);
                        let pathD = `M ${first.x.toFixed(1)} ${first.y.toFixed(1)}`;
                        for (let pIdx = 1; pIdx < pts.length; pIdx++) {
                          const pt = toScreenLocal(pts[pIdx].x, pts[pIdx].y);
                          pathD += ` L ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
                        }
                        pathD += ' Z';

                        return (
                          <path
                            key={poly.id}
                            d={pathD}
                            fill={
                              renderMode === 'hatch'
                                ? `url(#mat-fill-${mat.id})`
                                : mat.color
                            }
                            stroke={
                              showOutlines
                                ? theme === 'paper'
                                  ? '#0f172a'
                                  : mat.strokeColor || '#1e293b'
                                : 'none'
                            }
                            strokeWidth={showOutlines ? '1.1' : '0'}
                          />
                        );
                      })}
                    </g>

                    {/* Piecewise Z Breakpoint Guides */}
                    {cardZTransform &&
                      cardZTransform.isActive &&
                      cardZTransform.breakpoints.map((bp, bpIdx) => {
                        const bpY = toScreenLocal(0, bp).y;
                        return (
                          <line
                            key={`fc_bp_${bpIdx}`}
                            x1={PAD_X}
                            y1={bpY}
                            x2={CARD_W - PAD_X}
                            y2={bpY}
                            stroke={theme === 'paper' ? '#0284c7' : '#38bdf8'}
                            strokeOpacity="0.32"
                            strokeWidth="0.9"
                            strokeDasharray="4 3"
                          />
                        );
                      })}

                    {/* Datum Line */}
                    <line
                      x1={PAD_X}
                      y1={cardH - PAD_Y}
                      x2={CARD_W - PAD_X}
                      y2={cardH - PAD_Y}
                      stroke={theme === 'paper' ? '#94a3b8' : '#475569'}
                      strokeWidth="1"
                    />
                  </g>
                </g>
              );
            })}

            {/* Layer 5: Terminal Flowchart Pill */}
            {layoutGeometry.endBadge && (
              <g
                transform={`translate(${layoutGeometry.endBadge.x}, ${layoutGeometry.endBadge.y})`}
              >
                <rect
                  width={layoutGeometry.endBadge.width}
                  height={layoutGeometry.endBadge.height}
                  rx={layoutGeometry.endBadge.height / 2}
                  fill={theme === 'paper' ? '#ecfdf5' : '#064e3b'}
                  stroke="#10b981"
                  strokeWidth="1.4"
                />
                <text
                  x={layoutGeometry.endBadge.width / 2}
                  y={layoutGeometry.endBadge.height / 2 + 3.5}
                  textAnchor="middle"
                  fill={theme === 'paper' ? '#047857' : '#a7f3d0'}
                  fontSize="10"
                  fontWeight="700"
                  fontFamily="JetBrains Mono, monospace"
                >
                  END · FINAL DEVICE STACK
                </text>
              </g>
            )}

            {/* Layer 6: Wrapped Materials Legend */}
            {showLegend && legendLayout.rows.length > 0 && (
              <g transform={`translate(24, ${layoutGeometry.contentHeight + 12})`}>
                <text
                  x="0"
                  y="12"
                  fill={theme === 'paper' ? '#334155' : '#94a3b8'}
                  fontSize="11"
                  fontWeight="700"
                  fontFamily="Plus Jakarta Sans, sans-serif"
                >
                  Materials Legend:
                </text>
                {legendLayout.rows.map((rowMats, rowIdx) =>
                  rowMats.map((mat, colIdx) => (
                    <g
                      key={mat.id}
                      transform={`translate(${124 + colIdx * 165}, ${rowIdx * 22})`}
                    >
                      <rect
                        width="14"
                        height="14"
                        rx="2"
                        fill={
                          renderMode === 'hatch' ? `url(#mat-fill-${mat.id})` : mat.color
                        }
                        stroke={theme === 'paper' ? '#334155' : '#64748b'}
                        strokeWidth="1"
                      />
                      <text
                        x="20"
                        y="11"
                        fill={theme === 'paper' ? '#0f172a' : '#e2e8f0'}
                        fontSize="10"
                        fontFamily="Plus Jakarta Sans, sans-serif"
                      >
                        {mat.name.length > 21 ? `${mat.name.slice(0, 19)}…` : mat.name}
                      </text>
                    </g>
                  ))
                )}
              </g>
            )}
          </svg>
        </div>
      </div>
    </div>
  );
};
