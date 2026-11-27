/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  ProcessFlow,
  ProcessStep,
  Material,
  EtchRecipe,
  VariableUnit,
  SacrificialReleaseRegion,
  CleanroomTool,
  GlobalAlignmentMark,
} from './types/microfab';
import { PRESET_PROCESS_FLOWS } from './lib/presets';
import {
  simulateCrossSection,
  buildRenderPolygons,
  computeFlowSharedYBounds,
} from './lib/simulationEngine';
import { Header } from './components/Header';
import { ProcessFlowSidebar } from './components/ProcessFlowSidebar';
import { CrossSectionCanvas } from './components/CrossSectionCanvas';
import { MaskEditor } from './components/MaskEditor';
import { StepEditor } from './components/StepEditor';
import { MultiStepFlowView } from './components/MultiStepFlowView';
import { MaterialsModal } from './components/MaterialsModal';
import { EtchRateLibraryModal } from './components/EtchRateLibraryModal';
import { ToolLibraryModal } from './components/ToolLibraryModal';
import { RunSheetModal } from './components/RunSheetModal';
import { PresetPickerModal } from './components/PresetPickerModal';
import { MaskLevelsModal } from './components/MaskLevelsModal';
import { VariablesModal } from './components/VariablesModal';
import { VariantManagerModal } from './components/VariantManagerModal';
import { AboutModal } from './components/AboutModal';
import { BatchExportModal } from './components/BatchExportModal';
import { ImportFromFlowModal } from './components/ImportFromFlowModal';
import { HelpModal, HelpTopicId } from './components/HelpModal';
import { FlowImportMode } from './lib/flowImportUtils';
import { SubstrateEditor } from './components/SubstrateEditor';
import { resolveFlowParameters } from './lib/variableUtils';
import { syncActiveVariantSnapshot } from './lib/variantUtils';
import { PiecewiseZMode, CustomZZonesConfig } from './lib/piecewiseZScale';
import {
  ensureFlowMasks,
  syncStepWindowsToMask,
  attachNewMaskToLithoStep,
} from './lib/maskUtils';
import { ensureFlowBlocks, createBlock, assignStepToBlock } from './lib/blockUtils';
import { DEFAULT_MATERIALS } from './lib/materials';
import {
  getEtchRecipes,
  getEtchRateNmMin,
  formatEtchRate,
  formatDurationCompact,
} from './lib/etchRates';
import { getCleanroomTools, buildToolRecipeFromTool } from './lib/toolLibrary';
import { downloadProcessFlowCsv } from './lib/csvExportUtils';
import { ThicknessUnit } from './lib/units';
import { ListOrdered, Layers as LayersIcon, Sliders as SlidersIcon, X, Minimize, Scan } from 'lucide-react';

export default function App() {
  // Load initial process from localStorage if present, or fallback to CMOS preset
  const [flow, setFlow] = useState<ProcessFlow>(() => {
    try {
      const saved = localStorage.getItem('microflow_current_flow') || localStorage.getItem('etchflow_current_flow');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && Array.isArray(parsed.steps)) {
          // ensure substrateLayers exists
          if (!parsed.substrateLayers || parsed.substrateLayers.length === 0) {
            parsed.substrateLayers = [
              {
                id: 'sub_default',
                name: 'Silicon <100> Substrate',
                materialId: parsed.substrateMaterialId || 'mat_si_sub',
                thickness: parsed.substrateThickness || 3000,
              },
            ];
          }
          const existingMatIds = new Set((parsed.materials || []).map((m: Material) => m.id));
          const missingDefaults = DEFAULT_MATERIALS.filter((d) => !existingMatIds.has(d.id));
          if (missingDefaults.length > 0) {
            parsed.materials = [...(parsed.materials || []), ...missingDefaults];
          }
          if (!parsed.etchLibrary) {
            try {
              const savedCustomEtch = localStorage.getItem('microflow_custom_etch_recipes');
              if (savedCustomEtch) {
                parsed.etchLibrary = JSON.parse(savedCustomEtch);
              }
            } catch {
              // ignore
            }
          }
          if (!parsed.toolLibrary) {
            try {
              const savedCustomTools = localStorage.getItem('microflow_custom_tools');
              if (savedCustomTools) {
                parsed.toolLibrary = JSON.parse(savedCustomTools);
              }
            } catch {
              // ignore
            }
          }
          return resolveFlowParameters(ensureFlowBlocks(ensureFlowMasks(parsed)));
        }
      }
    } catch (e) {
      // ignore
    }
    const basePreset = { ...PRESET_PROCESS_FLOWS[0] };
    try {
      const savedCustomEtch = localStorage.getItem('microflow_custom_etch_recipes');
      if (savedCustomEtch) {
        basePreset.etchLibrary = JSON.parse(savedCustomEtch);
      }
      const savedCustomTools = localStorage.getItem('microflow_custom_tools');
      if (savedCustomTools) {
        basePreset.toolLibrary = JSON.parse(savedCustomTools);
      }
    } catch {
      // ignore
    }
    return resolveFlowParameters(ensureFlowBlocks(ensureFlowMasks(basePreset)));
  });

  const [activeStepIndex, setActiveStepIndex] = useState<number>(() =>
    flow.steps.length > 0 ? 0 : -1
  );
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playSpeed, setPlaySpeed] = useState<number>(1);
  const [thicknessUnit, setThicknessUnit] = useState<ThicknessUnit>(() => {
    try {
      const saved = localStorage.getItem('microflow_thickness_unit');
      if (saved === 'um' || saved === 'nm') return saved;
    } catch {
      // ignore
    }
    return 'nm';
  });
  const [lockSharedYScale, setLockSharedYScale] = useState<boolean>(() => {
    try {
      return localStorage.getItem('microflow_lock_shared_y_scale') === 'true';
    } catch {
      return false;
    }
  });
  const [zScale, setZScale] = useState<number>(2.0);
  const [zAspect1to1, setZAspect1to1] = useState<boolean>(false);
  const [piecewiseZMode, setPiecewiseZMode] = useState<PiecewiseZMode>('linear');
  const [piecewiseAutoCompression, setPiecewiseAutoCompression] = useState<number>(0.75);
  const [piecewiseCustomConfig, setPiecewiseCustomConfig] = useState<CustomZZonesConfig>({
    breakpointsNm: [],
    zoneGains: [1],
  });

  // Modals state
  const [showPresets, setShowPresets] = useState<boolean>(false);
  const [importFlowModal, setImportFlowModal] = useState<{
    open: boolean;
    initialMode: FlowImportMode;
  }>({ open: false, initialMode: 'steps-and-masks' });
  const [showMaterials, setShowMaterials] = useState<boolean>(false);
  const [showEtchLibrary, setShowEtchLibrary] = useState<boolean>(false);
  const [showToolLibrary, setShowToolLibrary] = useState<boolean>(false);
  const [showMaskLevels, setShowMaskLevels] = useState<boolean>(false);
  const [focusMaskId, setFocusMaskId] = useState<string | undefined>(undefined);
  const [showVariables, setShowVariables] = useState<boolean>(false);
  const [showVariantManager, setShowVariantManager] = useState<boolean>(false);
  const [showRunSheet, setShowRunSheet] = useState<boolean>(false);
  const [showMultiStep, setShowMultiStep] = useState<boolean>(false);
  const [showBatchExport, setShowBatchExport] = useState<boolean>(false);
  const [showAbout, setShowAbout] = useState<boolean>(false);
  const [helpModal, setHelpModal] = useState<{
    open: boolean;
    topic: HelpTopicId;
  }>({ open: false, topic: 'overview' });
  const openHelp = (topic: HelpTopicId = 'overview') =>
    setHelpModal({ open: true, topic });

  // Panel visibility state: docked open on desktop (>=1024px), drawer-closed on mobile/tablet
  const [leftSidebarOpen, setLeftSidebarOpen] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
  );
  const [rightSidebarOpen, setRightSidebarOpen] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
  );
  const [isMaskTrackOpen, setIsMaskTrackOpen] = useState<boolean>(false);
  const [isMaskTrackPinned, setIsMaskTrackPinned] = useState<boolean>(false);

  useEffect(() => {
    if (!isMaskTrackPinned) {
      setIsMaskTrackOpen(false);
    }
  }, [activeStepIndex, isMaskTrackPinned]);
  const [showFinalInset, setShowFinalInset] = useState<boolean>(() => {
    try {
      return localStorage.getItem('microflow_show_final_inset') === 'true';
    } catch {
      return false;
    }
  });
  const [selectedInsetStepIndex, setSelectedInsetStepIndex] = useState<number | null>(null);
  const [isBrowserFullscreen, setIsBrowserFullscreen] = useState<boolean>(false);
  const [isFocusFullscreen, setIsFocusFullscreen] = useState<boolean>(false);
  const isFullScreenDisplay = isBrowserFullscreen || isFocusFullscreen;

  useEffect(() => {
    const handleFsChange = () => {
      const isAppFs = document.fullscreenElement === document.documentElement;
      setIsBrowserFullscreen(isAppFs);
      if (isAppFs) {
        setIsFocusFullscreen(false);
      }
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  useEffect(() => {
    if (!isFocusFullscreen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsFocusFullscreen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFocusFullscreen]);

  const handleToggleFullScreenDisplay = () => {
    if (isFocusFullscreen) {
      setIsFocusFullscreen(false);
      return;
    }
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {
        setIsBrowserFullscreen(false);
      });
      return;
    }
    const rootEl = document.documentElement;
    if (rootEl && typeof rootEl.requestFullscreen === 'function' && document.fullscreenEnabled !== false) {
      rootEl.requestFullscreen().catch(() => {
        setIsFocusFullscreen(true);
      });
    } else {
      setIsFocusFullscreen(true);
    }
  };

  const latestFlowRef = useRef(flow);
  latestFlowRef.current = flow;

  // Debounced autosave to localStorage so high-frequency edits/drags stay fluid
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem('microflow_current_flow', JSON.stringify(flow));
      } catch (e) {
        // ignore
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [flow]);

  useEffect(() => {
    const flushFlow = () => {
      try {
        localStorage.setItem('microflow_current_flow', JSON.stringify(latestFlowRef.current));
      } catch {
        // ignore
      }
    };
    window.addEventListener('pagehide', flushFlow);
    window.addEventListener('beforeunload', flushFlow);
    return () => {
      window.removeEventListener('pagehide', flushFlow);
      window.removeEventListener('beforeunload', flushFlow);
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('microflow_lock_shared_y_scale', String(lockSharedYScale));
    } catch {
      // ignore
    }
  }, [lockSharedYScale]);

  const prevFlowIdRef = useRef<string>(flow.id);
  useEffect(() => {
    if (prevFlowIdRef.current !== flow.id) {
      prevFlowIdRef.current = flow.id;
      setPiecewiseCustomConfig({ breakpointsNm: [], zoneGains: [1] });
      setPiecewiseZMode((prev) => (prev === 'custom' ? 'auto' : prev));
    }
  }, [flow.id]);

  useEffect(() => {
    try {
      localStorage.setItem('microflow_thickness_unit', thicknessUnit);
    } catch {
      // ignore
    }
  }, [thicknessUnit]);

  useEffect(() => {
    try {
      localStorage.setItem('microflow_show_final_inset', String(showFinalInset));
    } catch {
      // ignore
    }
  }, [showFinalInset]);

  // Handle Playback animation with adjustable speed
  useEffect(() => {
    if (!isPlaying) return;
    const intervalMs = Math.max(150, Math.round(1800 / playSpeed));
    const interval = setInterval(() => {
      setActiveStepIndex((prev) => {
        if (prev >= flow.steps.length - 1) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, intervalMs);
    return () => clearInterval(interval);
  }, [isPlaying, flow.steps.length, playSpeed]);

  const handleTogglePlay = () => {
    if (!isPlaying) {
      setIsMaskTrackOpen(false);
      if (typeof window !== 'undefined' && window.innerWidth < 1024) {
        setLeftSidebarOpen(false);
      }
    }
    if (!isPlaying && flow.steps.length > 0 && activeStepIndex >= flow.steps.length - 1) {
      setActiveStepIndex(0);
      setIsPlaying(true);
    } else {
      setIsPlaying((prev) => !prev);
    }
  };

  // Clamp activeStepIndex if steps count changes
  useEffect(() => {
    if (activeStepIndex >= flow.steps.length) {
      setActiveStepIndex(Math.max(-1, flow.steps.length - 1));
    }
  }, [flow.steps.length, activeStepIndex]);

  // Compute simulation mesh and polygons for the active step
  const activeMesh = useMemo(() => {
    return simulateCrossSection(flow, activeStepIndex);
  }, [flow, activeStepIndex]);

  const activePolygons = useMemo(() => {
    return buildRenderPolygons(activeMesh, flow.materials);
  }, [activeMesh, flow.materials]);

  // Global vertical bounds shared across starting substrate and all enabled steps (lazy when Lock Y is active)
  const sharedYBounds = useMemo(() => {
    if (!lockSharedYScale) return undefined;
    return computeFlowSharedYBounds(flow);
  }, [flow, lockSharedYScale]);

  // Identify the last enabled process step and all enabled steps after the currently selected step
  const finalEnabledStepIndex = useMemo(() => {
    for (let i = flow.steps.length - 1; i >= 0; i--) {
      if (flow.steps[i].enabled !== false) return i;
    }
    return -1;
  }, [flow.steps]);

  const laterInsetSteps = useMemo(() => {
    const list: { stepIndex: number; stepNumber: number; title: string }[] = [];
    for (let i = Math.max(0, activeStepIndex + 1); i < flow.steps.length; i++) {
      const step = flow.steps[i];
      if (step.enabled !== false) {
        list.push({
          stepIndex: i,
          stepNumber: i + 1,
          title: step.title,
        });
      }
    }
    return list;
  }, [flow.steps, activeStepIndex]);

  const nearbyLithoContext = useMemo(() => {
    for (let i = Math.min(activeStepIndex - 1, flow.steps.length - 1); i >= 0; i--) {
      const s = flow.steps[i];
      if (s.enabled !== false && s.type === 'lithography') {
        return {
          relation: 'last' as const,
          stepIndex: i,
          stepNumber: i + 1,
          title: s.title,
          maskId: s.lithography?.maskId,
          maskName: s.lithography?.maskName || 'Photomask Layer',
        };
      }
    }
    for (let i = Math.max(0, activeStepIndex + 1); i < flow.steps.length; i++) {
      const s = flow.steps[i];
      if (s.enabled !== false && s.type === 'lithography') {
        return {
          relation: 'next' as const,
          stepIndex: i,
          stepNumber: i + 1,
          title: s.title,
          maskId: s.lithography?.maskId,
          maskName: s.lithography?.maskName || 'Photomask Layer',
        };
      }
    }
    return null;
  }, [flow.steps, activeStepIndex]);

  useEffect(() => {
    if (
      selectedInsetStepIndex !== null &&
      !laterInsetSteps.some((s) => s.stepIndex === selectedInsetStepIndex)
    ) {
      setSelectedInsetStepIndex(null);
    }
  }, [selectedInsetStepIndex, laterInsetSteps]);

  const resolvedInsetStepIndex = useMemo(() => {
    if (laterInsetSteps.length === 0) return -1;
    if (
      selectedInsetStepIndex !== null &&
      laterInsetSteps.some((s) => s.stepIndex === selectedInsetStepIndex)
    ) {
      return selectedInsetStepIndex;
    }
    return laterInsetSteps[laterInsetSteps.length - 1].stepIndex;
  }, [laterInsetSteps, selectedInsetStepIndex]);

  const insetEnabledSimIndex = useMemo(() => {
    if (resolvedInsetStepIndex < 0) return -1;
    let enabledCount = 0;
    for (let i = 0; i <= resolvedInsetStepIndex && i < flow.steps.length; i++) {
      if (flow.steps[i].enabled !== false) enabledCount++;
    }
    return enabledCount - 1;
  }, [flow.steps, resolvedInsetStepIndex]);

  const isIntermediateStep =
    resolvedInsetStepIndex >= 0 && activeStepIndex < resolvedInsetStepIndex;

  const finalMesh = useMemo(() => {
    if (!showFinalInset || !isIntermediateStep || insetEnabledSimIndex < 0) return null;
    return simulateCrossSection(flow, insetEnabledSimIndex);
  }, [showFinalInset, isIntermediateStep, flow, insetEnabledSimIndex]);

  const finalPolygons = useMemo(() => {
    if (!finalMesh) return [];
    return buildRenderPolygons(finalMesh, flow.materials);
  }, [finalMesh, flow.materials]);

  const isSubstrateActive = activeStepIndex === -1;
  const activeStep = !isSubstrateActive ? flow.steps[activeStepIndex] : undefined;

  const isSacrificialReleaseStep =
    !isSubstrateActive &&
    activeStep?.type === 'strip' &&
    activeStep.strip?.stripType === 'sacrificial-release';

  const [pickReleaseMode, setPickReleaseMode] = useState<boolean>(false);

  useEffect(() => {
    setPickReleaseMode(false);
  }, [activeStepIndex, isSacrificialReleaseStep]);

  const activeReleaseConfig = useMemo(() => {
    if (!isSacrificialReleaseStep || !activeStep?.strip) return null;
    return {
      targetMaterialId: activeStep.strip.targetMaterialId || 'mat_sio2_thermal',
      side: activeStep.side || ('front' as const),
      releaseScope: activeStep.strip.releaseScope ?? ('all' as const),
      regions: activeStep.strip.releaseRegions ?? [],
    };
  }, [isSacrificialReleaseStep, activeStep]);

  // Pre-release geometry (state just before the sacrificial release step executes)
  // so dissolved pockets remain clickable/visible while picking regions to keep intact.
  const preReleaseMesh = useMemo(() => {
    if (!pickReleaseMode || !isSacrificialReleaseStep || activeStepIndex < 0) return null;
    let enabledBefore = 0;
    for (let i = 0; i < activeStepIndex && i < flow.steps.length; i++) {
      if (flow.steps[i].enabled) enabledBefore++;
    }
    return simulateCrossSection(flow, enabledBefore - 1);
  }, [pickReleaseMode, isSacrificialReleaseStep, activeStepIndex, flow]);

  const preReleasePolygons = useMemo(() => {
    if (!preReleaseMesh) return undefined;
    return buildRenderPolygons(preReleaseMesh, flow.materials);
  }, [preReleaseMesh, flow.materials]);

  // Handlers
  const handleUpdateFlow = (updatedFlow: ProcessFlow) => {
    setFlow(resolveFlowParameters(updatedFlow));
  };

  const handleCreateVariable = (
    name: string,
    value: number,
    unit: VariableUnit,
    description?: string
  ) => {
    setFlow((prev) =>
      resolveFlowParameters({
        ...prev,
        variables: [
          ...(prev.variables || []),
          {
            id: `var_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            name,
            value,
            unit,
            description,
          },
        ],
      })
    );
  };

  const applyStepUpdateToFlow = (
    baseFlow: ProcessFlow,
    stepIdx: number,
    updatedStep: ProcessStep,
    preserveOldBlockIdForReassign: boolean
  ): ProcessFlow => {
    const prevStep = baseFlow.steps[stepIdx];
    const blockChanged = prevStep && updatedStep.blockId !== prevStep.blockId;
    const syncedPatchedStep = syncActiveVariantSnapshot(
      preserveOldBlockIdForReassign && blockChanged
        ? { ...updatedStep, blockId: prevStep.blockId }
        : updatedStep
    );
    const updatedSteps = baseFlow.steps.map((s, idx) =>
      idx === stepIdx ? syncedPatchedStep : s
    );
    let updatedFlow: ProcessFlow = { ...baseFlow, steps: updatedSteps };
    if (updatedStep.type === 'lithography') {
      if (prevStep && prevStep.type !== 'lithography') {
        const validUnclaimedMask = updatedStep.lithography?.maskId
          ? (updatedFlow.masks || []).find(
              (m) =>
                m.id === updatedStep.lithography?.maskId &&
                (!m.assignedStepId || m.assignedStepId === updatedStep.id)
            )
          : undefined;
        updatedFlow = validUnclaimedMask
          ? syncStepWindowsToMask(updatedFlow, syncedPatchedStep)
          : attachNewMaskToLithoStep(updatedFlow, syncedPatchedStep.id);
      } else {
        updatedFlow = syncStepWindowsToMask(updatedFlow, syncedPatchedStep);
      }
    } else if (prevStep && prevStep.type === 'lithography' && updatedFlow.masks) {
      updatedFlow = {
        ...updatedFlow,
        masks: updatedFlow.masks.map((m) =>
          m.assignedStepId === updatedStep.id
            ? { ...m, assignedStepId: undefined, assignedVariantId: undefined }
            : m
        ),
      };
    }

    if (preserveOldBlockIdForReassign && blockChanged) {
      updatedFlow = assignStepToBlock(updatedFlow, updatedStep.id, updatedStep.blockId || null);
    }

    return resolveFlowParameters(updatedFlow);
  };

  const handleUpdateStep = (updatedStep: ProcessStep) => {
    if (activeStepIndex < 0) return;
    const prevStep = flow.steps[activeStepIndex];
    const blockChanged = prevStep && updatedStep.blockId !== prevStep.blockId;

    if (blockChanged) {
      const updatedFlow = applyStepUpdateToFlow(flow, activeStepIndex, updatedStep, true);
      const newIdx = updatedFlow.steps.findIndex((s) => s.id === updatedStep.id);
      setFlow(updatedFlow);
      if (newIdx >= 0 && newIdx !== activeStepIndex) {
        setActiveStepIndex(newIdx);
      }
      return;
    }

    setFlow((prev) => {
      const idx = prev.steps.findIndex((s) => s.id === updatedStep.id);
      const targetIdx = idx >= 0 ? idx : activeStepIndex;
      if (targetIdx < 0 || targetIdx >= prev.steps.length) return prev;
      return applyStepUpdateToFlow(prev, targetIdx, updatedStep, false);
    });
  };

  const handleUpdateTitle = (title: string) => {
    setFlow((prev) => ({ ...prev, title }));
  };

  const handleUpdateDescription = (description: string) => {
    setFlow((prev) => ({ ...prev, description }));
  };

  const handleTogglePickReleaseMode = () => {
    if (!isSacrificialReleaseStep || !activeStep) {
      setPickReleaseMode(false);
      return;
    }
    if (!pickReleaseMode) {
      if (activeStep.strip?.releaseScope !== 'regions') {
        handleUpdateStep({
          ...activeStep,
          strip: {
            ...(activeStep.strip || {
              stripType: 'sacrificial-release',
              solvent: 'HF Vapor / BOE',
              targetMaterialId: 'mat_sio2_thermal',
            }),
            stripType: 'sacrificial-release',
            releaseScope: 'regions',
            releaseRegions: activeStep.strip?.releaseRegions ?? [],
          },
        });
      }
      if (isCompactViewport()) {
        setRightSidebarOpen(false);
        setLeftSidebarOpen(false);
      }
      setPickReleaseMode(true);
    } else {
      setPickReleaseMode(false);
    }
  };

  const handleAddReleaseRegion = (region: {
    xStart: number;
    xEnd: number;
    yMin?: number;
    yMax?: number;
  }) => {
    if (!activeStep || activeStep.type !== 'strip') return;
    const prevStrip = activeStep.strip || {
      stripType: 'sacrificial-release' as const,
      solvent: 'HF Vapor / BOE',
      targetMaterialId: 'mat_sio2_thermal',
    };
    const xLo = Math.max(0, Math.min(flow.substrateWidth, Math.round(Math.min(region.xStart, region.xEnd))));
    const xHi = Math.max(0, Math.min(flow.substrateWidth, Math.round(Math.max(region.xStart, region.xEnd))));
    if (xHi - xLo < 5) return;
    const nextRegion: SacrificialReleaseRegion = {
      id: `rel_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      xStart: xLo,
      xEnd: xHi,
      ...(region.yMin !== undefined && region.yMax !== undefined
        ? {
            yMin: Math.round(Math.min(region.yMin, region.yMax)),
            yMax: Math.round(Math.max(region.yMin, region.yMax)),
          }
        : {}),
    };
    handleUpdateStep({
      ...activeStep,
      strip: {
        ...prevStrip,
        stripType: 'sacrificial-release',
        releaseScope: 'regions',
        releaseRegions: [...(prevStrip.releaseRegions || []), nextRegion],
      },
    });
  };

  const handleRemoveReleaseRegion = (regionId: string) => {
    if (!activeStep || activeStep.type !== 'strip' || !activeStep.strip) return;
    handleUpdateStep({
      ...activeStep,
      strip: {
        ...activeStep.strip,
        releaseRegions: (activeStep.strip.releaseRegions || []).filter((r) => r.id !== regionId),
      },
    });
  };

  const handleClearReleaseRegions = () => {
    if (!activeStep || activeStep.type !== 'strip' || !activeStep.strip) return;
    handleUpdateStep({
      ...activeStep,
      strip: {
        ...activeStep.strip,
        releaseRegions: [],
      },
    });
  };

  const allEtchRecipes = useMemo(
    () => getEtchRecipes(flow.etchLibrary),
    [flow.etchLibrary]
  );

  const allTools = useMemo(
    () => getCleanroomTools(flow.toolLibrary),
    [flow.toolLibrary]
  );

  const handleSelectPreset = (preset: ProcessFlow) => {
    const withLibraries: ProcessFlow = {
      ...preset,
      ...(flow.etchLibrary?.length ? { etchLibrary: flow.etchLibrary } : {}),
      ...(flow.toolLibrary?.length ? { toolLibrary: flow.toolLibrary } : {}),
    };
    setFlow(resolveFlowParameters(ensureFlowBlocks(ensureFlowMasks(withLibraries))));
    setActiveStepIndex(preset.steps.length > 0 ? 0 : -1);
    setSelectedInsetStepIndex(null);
    setIsPlaying(false);
    setShowPresets(false);
  };

  const handleUpdateMaterials = (updatedMats: Material[]) => {
    setFlow({ ...flow, materials: updatedMats });
  };

  const handleUpdateEtchRecipes = (updatedCustom: EtchRecipe[]) => {
    try {
      localStorage.setItem('microflow_custom_etch_recipes', JSON.stringify(updatedCustom));
    } catch {
      // ignore
    }
    setFlow({ ...flow, etchLibrary: updatedCustom });
  };

  const handleUpdateTools = (updatedCustom: CleanroomTool[]) => {
    try {
      localStorage.setItem('microflow_custom_tools', JSON.stringify(updatedCustom));
    } catch {
      // ignore
    }
    setFlow({ ...flow, toolLibrary: updatedCustom });
  };

  const handleApplyToolToStep = (tool: CleanroomTool, syncSubMechanism?: boolean) => {
    if (!activeStep) return;
    const nextToolRecipe = buildToolRecipeFromTool(tool, activeStep.toolRecipe);
    const patch: Partial<ProcessStep> = {
      toolRecipe: nextToolRecipe,
    };

    if (syncSubMechanism) {
      const cap = tool.capabilities.find((c) => c.mechanism === activeStep.type);
      const firstSub = cap?.subMechanisms?.[0];
      if (firstSub) {
        if (activeStep.type === 'deposition' && activeStep.deposition) {
          patch.deposition = {
            ...activeStep.deposition,
            method: firstSub as NonNullable<ProcessStep['deposition']>['method'],
          };
        } else if (activeStep.type === 'etch' && activeStep.etch) {
          patch.etch = {
            ...activeStep.etch,
            etchType: firstSub as NonNullable<ProcessStep['etch']>['etchType'],
          };
        } else if (activeStep.type === 'lithography' && activeStep.lithography) {
          if (['spin-coat', 'lor-bilayer', 'dry-film'].includes(firstSub)) {
            patch.lithography = {
              ...activeStep.lithography,
              coatMethod: firstSub as NonNullable<ProcessStep['lithography']>['coatMethod'],
            };
          } else {
            patch.lithography = {
              ...activeStep.lithography,
              exposureMethod: firstSub as NonNullable<ProcessStep['lithography']>['exposureMethod'],
            };
          }
        } else if (activeStep.type === 'strip' && activeStep.strip) {
          patch.strip = {
            ...activeStep.strip,
            stripType: firstSub as NonNullable<ProcessStep['strip']>['stripType'],
          };
        } else if (activeStep.type === 'cmp' && activeStep.cmp) {
          patch.cmp = {
            ...activeStep.cmp,
            operation: firstSub as NonNullable<ProcessStep['cmp']>['operation'],
          };
        } else if (activeStep.type === 'bonding' && activeStep.bonding) {
          patch.bonding = {
            ...activeStep.bonding,
            bondingMethod: firstSub as NonNullable<ProcessStep['bonding']>['bondingMethod'],
          };
        } else if (activeStep.type === 'dicing' && activeStep.dicing) {
          patch.dicing = {
            ...activeStep.dicing,
            method: firstSub as NonNullable<ProcessStep['dicing']>['method'],
          };
        } else if (activeStep.type === 'tape-frame' && activeStep.tapeFrame) {
          patch.tapeFrame = {
            ...activeStep.tapeFrame,
            action: firstSub as NonNullable<ProcessStep['tapeFrame']>['action'],
          };
        }
      }
    }

    handleUpdateStep({
      ...activeStep,
      ...patch,
    });
  };

  const handleApplyEtchRecipeToStep = (
    recipe: EtchRecipe,
    rateMode: 'manual' | 'time-rate',
    etchTimeSec: number
  ) => {
    if (!activeStep || activeStep.type !== 'etch') return;
    const targetMatId = activeStep.etch?.targetMaterialId || 'all';
    const isSameRecipe = activeStep.etch?.etchRecipeId === recipe.id;
    const nextRefMatId =
      isSameRecipe ? activeStep.etch?.referenceMaterialId : undefined;
    const refMatId =
      nextRefMatId || (targetMatId !== 'all' ? targetMatId : recipe.primaryMaterialId);
    const refRate = getEtchRateNmMin(recipe, refMatId);
    const derivedDepth =
      rateMode === 'time-rate' && refRate > 0
        ? Math.max(5, Math.round((refRate * etchTimeSec) / 60))
        : activeStep.etch?.depth ?? activeStep.thickness ?? 300;

    const nextToolName = recipe.toolName || activeStep.toolRecipe?.toolName || '';
    const matchedTool = recipe.toolName
      ? allTools.find(
          (t) =>
            (t.name.toLowerCase() === recipe.toolName!.toLowerCase() ||
              t.defaultRecipe?.toolName?.toLowerCase() === recipe.toolName!.toLowerCase()) &&
            t.capabilities.some((c) => c.mechanism === 'etch')
        )
      : undefined;
    const nextToolId = matchedTool
      ? matchedTool.id
      : recipe.toolName
      ? undefined
      : activeStep.toolRecipe?.toolId;

    handleUpdateStep({
      ...activeStep,
      thickness: derivedDepth,
      etch: {
        ...(activeStep.etch || {
          etchType: recipe.etchType,
          depth: derivedDepth,
          targetMaterialId: 'all',
          isotropy: recipe.isotropy,
          sidewallAngle: recipe.sidewallAngle,
        }),
        etchRecipeId: recipe.id,
        referenceMaterialId: nextRefMatId,
        etchType: recipe.etchType,
        isotropy: recipe.isotropy,
        sidewallAngle: recipe.sidewallAngle,
        scallopEffect: recipe.scallopEffect ?? (recipe.etchType === 'drie-bosch'),
        scallopDepth: recipe.scallopDepth ?? activeStep.etch?.scallopDepth,
        scallopPitch: recipe.scallopPitch ?? activeStep.etch?.scallopPitch,
        ardeEnabled: recipe.ardeEnabled ?? activeStep.etch?.ardeEnabled,
        ardeStrength: recipe.ardeStrength ?? activeStep.etch?.ardeStrength,
        rateMode,
        etchTimeSec,
        depth: derivedDepth,
      },
      toolRecipe: {
        ...(activeStep.toolRecipe || {
          toolName: '',
          gases: '',
          power: '',
          pressure: '',
          temperature: '',
          duration: '',
        }),
        toolId: nextToolId,
        toolName: nextToolName,
        gases: recipe.gases || recipe.chemistry,
        power: recipe.power || '',
        pressure: recipe.pressure || '',
        temperature: recipe.temperature || '',
        duration: formatDurationCompact(etchTimeSec),
        targetRate: refRate > 0 ? formatEtchRate(refRate, thicknessUnit) : '',
      },
    });
  };

  const handleExportJson = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(flow, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute(
      'download',
      `${flow.title.toLowerCase().replace(/\s+/g, '_')}_recipe.json`
    );
    downloadAnchor.click();
  };

  const handleExportCsv = () => {
    downloadProcessFlowCsv(flow);
  };

  const handleImportJson = (newFlow: ProcessFlow) => {
    // ensure substrateLayers exists
    if (!newFlow.substrateLayers || newFlow.substrateLayers.length === 0) {
      newFlow.substrateLayers = [
        {
          id: 'sub_default',
          name: 'Silicon <100> Substrate',
          materialId: newFlow.substrateMaterialId || 'mat_si_sub',
          thickness: newFlow.substrateThickness || 3000,
        },
      ];
    }
    setFlow(resolveFlowParameters(ensureFlowBlocks(ensureFlowMasks(newFlow))));
    setActiveStepIndex(newFlow.steps.length > 0 ? 0 : -1);
    setSelectedInsetStepIndex(null);
  };

  const isCompactViewport = () =>
    typeof window !== 'undefined' && window.innerWidth < 1024;

  const handleToggleLeftSidebar = () => {
    setLeftSidebarOpen((prev) => {
      const next = !prev;
      if (next && isCompactViewport()) setRightSidebarOpen(false);
      return next;
    });
  };

  const handleToggleRightSidebar = () => {
    setRightSidebarOpen((prev) => {
      const next = !prev;
      if (next && isCompactViewport()) setLeftSidebarOpen(false);
      return next;
    });
  };

  return (
    <div className="flex flex-col h-dvh w-screen overflow-hidden bg-slate-950 text-slate-100 font-sans">
      {/* Top Application Header (hidden in Focus Full Screen fallback mode) */}
      {!isFocusFullscreen && (
        <Header
          flow={flow}
          thicknessUnit={thicknessUnit}
          onChangeThicknessUnit={setThicknessUnit}
          onUpdateTitle={handleUpdateTitle}
          onUpdateDescription={handleUpdateDescription}
          onOpenPresets={() => setShowPresets(true)}
          onOpenMaterials={() => setShowMaterials(true)}
          onOpenEtchLibrary={() => setShowEtchLibrary(true)}
          onOpenToolLibrary={() => setShowToolLibrary(true)}
          onOpenMaskLevels={() => {
            setFocusMaskId(undefined);
            setShowMaskLevels(true);
          }}
          onOpenVariables={() => setShowVariables(true)}
          variableCount={flow.variables?.length || 0}
          onOpenVariantManager={() => setShowVariantManager(true)}
          variantStepCount={flow.steps.filter((s) => s.variants && s.variants.length > 1).length}
          onOpenRunSheet={() => setShowRunSheet(true)}
          onOpenMultiStepView={() => setShowMultiStep(true)}
          onOpenBatchExport={() => setShowBatchExport(true)}
          onOpenAbout={() => setShowAbout(true)}
          onExportJson={handleExportJson}
          onExportCsv={handleExportCsv}
          onImportJson={handleImportJson}
          leftSidebarOpen={leftSidebarOpen}
          onToggleLeftSidebar={handleToggleLeftSidebar}
          rightSidebarOpen={rightSidebarOpen}
          onToggleRightSidebar={handleToggleRightSidebar}
          isFullScreen={isFullScreenDisplay}
          onToggleFullScreen={handleToggleFullScreenDisplay}
          onOpenImportFlow={(mode) =>
            setImportFlowModal({
              open: true,
              initialMode: mode || 'steps-and-masks',
            })
          }
          onOpenHelp={() => openHelp('overview')}
        />
      )}

      {/* Main 3-Column CAD Workspace (Drawers on <1024px mobile/tablet, Docked Columns on lg+) */}
      <div className="flex-1 flex overflow-hidden relative min-h-0">
        {isFocusFullscreen && (
          <button
            type="button"
            onClick={() => setIsFocusFullscreen(false)}
            className="fixed bottom-4 left-4 z-50 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900/95 hover:bg-slate-800 border border-sky-500/50 text-sky-200 text-xs font-semibold shadow-2xl backdrop-blur-md transition-colors"
            title="Exit Full Screen Display Mode (Esc)"
          >
            <Minimize className="w-3.5 h-3.5 text-sky-400" />
            <span>Exit Full Screen</span>
          </button>
        )}

        {/* Compact-viewport Backdrop for active drawer */}
        {!isFocusFullscreen && (leftSidebarOpen || rightSidebarOpen) && (
          <div
            onClick={() => {
              setLeftSidebarOpen(false);
              setRightSidebarOpen(false);
            }}
            className="lg:hidden fixed inset-0 z-30 bg-slate-950/65 backdrop-blur-[1px]"
          />
        )}

        {/* Left: Process Flow Timeline */}
        {!isFocusFullscreen && leftSidebarOpen && (
          <aside className="fixed inset-y-0 left-0 z-40 w-[86vw] max-w-[330px] h-full border-r border-slate-800 bg-slate-900 shadow-2xl flex flex-col lg:static lg:z-auto lg:w-72 xl:w-80 lg:shadow-none flex-shrink-0">
            <div className="lg:hidden flex items-center justify-between px-3 py-2 bg-slate-950 border-b border-slate-800 shrink-0">
              <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <ListOrdered className="w-3.5 h-3.5 text-sky-400" />
                <span>Process Flow Timeline</span>
              </span>
              <button
                type="button"
                onClick={() => setLeftSidebarOpen(false)}
                className="flex items-center gap-1 px-2 py-1 rounded-md bg-slate-800 text-slate-300 hover:text-white text-[11px]"
              >
                <X className="w-3.5 h-3.5" />
                <span>Close</span>
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <ProcessFlowSidebar
                flow={flow}
                activeStepIndex={activeStepIndex}
                thicknessUnit={thicknessUnit}
                isPlaying={isPlaying}
                playSpeed={playSpeed}
                onChangePlaySpeed={setPlaySpeed}
                onTogglePlay={handleTogglePlay}
                onSelectStepIndex={(idx) => {
                  setActiveStepIndex(idx);
                  setIsPlaying(false);
                }}
                onUpdateFlow={handleUpdateFlow}
                onOpenPresets={() => setShowPresets(true)}
                onOpenImportFlow={() =>
                  setImportFlowModal({
                    open: true,
                    initialMode: 'steps-and-masks',
                  })
                }
                onOpenParameters={() => {
                  setRightSidebarOpen(true);
                  if (isCompactViewport()) {
                    setLeftSidebarOpen(false);
                  }
                }}
                onOpenHelp={() => openHelp('timeline')}
              />
            </div>
          </aside>
        )}

        {/* Adjacent: Substrate Layer Editor OR Step Deep Parameters Editor (Docked next to Process Timeline) */}
        {!isFocusFullscreen && rightSidebarOpen && (
          <aside className="fixed inset-y-0 left-0 z-40 w-[86vw] max-w-[340px] h-full border-r border-slate-800 bg-slate-900 shadow-2xl flex flex-col lg:static lg:z-auto lg:w-[300px] xl:w-[316px] lg:shadow-none flex-shrink-0">
            <div className="lg:hidden flex items-center justify-between px-3 py-2 bg-slate-950 border-b border-slate-800 shrink-0">
              <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <SlidersIcon className="w-3.5 h-3.5 text-sky-400" />
                <span>{isSubstrateActive ? 'Substrate Stack' : 'Step Parameters'}</span>
              </span>
              <button
                type="button"
                onClick={() => setRightSidebarOpen(false)}
                className="flex items-center gap-1 px-2 py-1 rounded-md bg-slate-800 text-slate-300 hover:text-white text-[11px]"
              >
                <X className="w-3.5 h-3.5" />
                <span>Done</span>
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              {isSubstrateActive ? (
                <SubstrateEditor
                  flow={flow}
                  thicknessUnit={thicknessUnit}
                  onUpdateFlow={handleUpdateFlow}
                  onOpenMaterialsModal={() => setShowMaterials(true)}
                  onCreateVariable={handleCreateVariable}
                  onOpenVariablesModal={() => setShowVariables(true)}
                />
              ) : activeStep ? (
                <StepEditor
                  flow={flow}
                  step={activeStep}
                  waferWidth={flow.substrateWidth}
                  materials={flow.materials}
                  etchRecipes={allEtchRecipes}
                  tools={allTools}
                  thicknessUnit={thicknessUnit}
                  onUpdateStep={handleUpdateStep}
                  onOpenMaterialsModal={() => setShowMaterials(true)}
                  onOpenEtchLibrary={() => setShowEtchLibrary(true)}
                  onOpenToolLibrary={() => setShowToolLibrary(true)}
                  onMergeMaterials={(incomingMats) => {
                    const existingIds = new Set(flow.materials.map((m) => m.id));
                    const missing = incomingMats.filter((m) => !existingIds.has(m.id));
                    if (missing.length > 0) {
                      setFlow((prev) => {
                        const prevIds = new Set(prev.materials.map((m) => m.id));
                        const toAdd = incomingMats.filter((m) => !prevIds.has(m.id));
                        if (toAdd.length === 0) return prev;
                        return { ...prev, materials: [...prev.materials, ...toAdd] };
                      });
                    }
                  }}
                  blocks={flow.blocks}
                  masks={flow.masks}
                  variables={flow.variables || []}
                  onCreateVariable={handleCreateVariable}
                  onOpenVariablesModal={() => setShowVariables(true)}
                  onOpenVariantManager={() => setShowVariantManager(true)}
                  pickReleaseMode={pickReleaseMode}
                  onTogglePickReleaseMode={handleTogglePickReleaseMode}
                  isMaskTrackOpen={isMaskTrackOpen}
                  onToggleMaskTrack={() => setIsMaskTrackOpen((prev) => !prev)}
                  onOpenMaskLevelsModal={(maskId) => {
                    setFocusMaskId(maskId);
                    setShowMaskLevels(true);
                  }}
                  onCreateBlock={(name) => {
                    const { flow: updated, block: newBlock } = createBlock(flow, name);
                    const currentStep = updated.steps[activeStepIndex];
                    if (currentStep) {
                      const assignedFlow = assignStepToBlock(updated, currentStep.id, newBlock.id);
                      const newIdx = assignedFlow.steps.findIndex((s) => s.id === currentStep.id);
                      setFlow(assignedFlow);
                      if (newIdx >= 0 && newIdx !== activeStepIndex) {
                        setActiveStepIndex(newIdx);
                      }
                    } else {
                      setFlow(updated);
                    }
                  }}
                  onOpenHelp={() => openHelp('steps')}
                />
              ) : null}
            </div>
          </aside>
        )}

        {/* Main Viewport: Persistent Fixed-Height Photomask Slot + Interactive Cross-Section Canvas */}
        <main className="flex-1 flex flex-col h-full bg-[#030712] p-1.5 sm:p-3 overflow-hidden gap-2 min-w-0">
          {/* Permanent Fixed-Height (36px) Track Slot — zero height change across all step types */}
          {!isFocusFullscreen && (
            <div className="h-9 shrink-0 relative z-[35]">
              {activeStep && activeStep.type === 'lithography' ? (
                <MaskEditor
                  step={activeStep}
                  waferWidth={flow.substrateWidth}
                  onUpdateStep={handleUpdateStep}
                  onOpenMaskLevels={() => {
                    setFocusMaskId(activeStep.lithography?.maskId);
                    setShowMaskLevels(true);
                  }}
                  alignmentMarks={flow.alignmentMarks || []}
                  onUpdateAlignmentMarks={(marks: GlobalAlignmentMark[]) =>
                    setFlow((prev) =>
                      resolveFlowParameters({
                        ...prev,
                        alignmentMarks: marks,
                      })
                    )
                  }
                  isMinimized={!isMaskTrackOpen}
                  onToggleMinimize={() => setIsMaskTrackOpen((prev) => !prev)}
                  isPinned={isMaskTrackPinned}
                  onTogglePin={() => setIsMaskTrackPinned((prev) => !prev)}
                  dockPosition="top"
                  overlayExpand={true}
                  variables={flow.variables || []}
                  onCreateVariable={handleCreateVariable}
                  onOpenVariablesModal={() => setShowVariables(true)}
                />
              ) : (
                <div className="h-9 bg-slate-900/80 border border-slate-800 rounded-xl px-3 flex items-center justify-between gap-2 text-slate-400">
                  <div className="flex items-center gap-2 min-w-0 text-[11px]">
                    <span className="font-semibold tracking-wider uppercase text-slate-500 whitespace-nowrap shrink-0">
                      Photomask Track
                    </span>
                    <span className="text-slate-700 shrink-0">·</span>
                    {nearbyLithoContext ? (
                      <div className="flex items-center gap-1.5 min-w-0 truncate">
                        <span className="text-slate-500 shrink-0">
                          {nearbyLithoContext.relation === 'last' ? 'Last reticle:' : 'Next reticle:'}
                        </span>
                        <span className="font-mono text-slate-300 truncate">
                          {nearbyLithoContext.maskName}
                        </span>
                        <span className="text-slate-600 shrink-0 hidden sm:inline">·</span>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveStepIndex(nearbyLithoContext.stepIndex);
                            setIsPlaying(false);
                          }}
                          className="text-sky-400 hover:text-sky-300 hover:underline font-mono text-[10.5px] whitespace-nowrap shrink-0 hidden sm:inline"
                          title={`Jump to Step ${nearbyLithoContext.stepNumber}: ${nearbyLithoContext.title}`}
                        >
                          Step {nearbyLithoContext.stepNumber} →
                        </button>
                      </div>
                    ) : (
                      <span className="text-slate-500 truncate">
                        No active reticle on this step
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setFocusMaskId(nearbyLithoContext?.maskId);
                      setShowMaskLevels(true);
                    }}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] font-medium text-sky-400 hover:text-sky-300 transition-colors whitespace-nowrap shrink-0"
                    title="Open Photolithography Mask Levels Panel"
                  >
                    <Scan className="w-3 h-3" />
                    <span className="hidden sm:inline">
                      Masks{flow.masks?.length ? ` (${flow.masks.length})` : ''}
                    </span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Interactive Cross-Section Canvas */}
          <div className="flex-1 min-h-0">
            <CrossSectionCanvas
              mesh={activeMesh}
              polygons={activePolygons}
              sharedYBounds={sharedYBounds}
              lockSharedYScale={lockSharedYScale}
              onToggleLockSharedYScale={() => setLockSharedYScale((prev) => !prev)}
              zScale={zScale}
              onChangeZScale={setZScale}
              zAspect1to1={zAspect1to1}
              onChangeZAspect1to1={setZAspect1to1}
              piecewiseMode={piecewiseZMode}
              onChangePiecewiseMode={setPiecewiseZMode}
              autoCompression={piecewiseAutoCompression}
              onChangeAutoCompression={setPiecewiseAutoCompression}
              customZConfig={piecewiseCustomConfig}
              onChangeCustomZConfig={setPiecewiseCustomConfig}
              materials={flow.materials}
              waferWidth={flow.substrateWidth}
              flowId={flow.id}
              thicknessUnit={thicknessUnit}
              title={flow.title}
              stepNumber={isSubstrateActive ? 0 : activeStepIndex + 1}
              totalSteps={flow.steps.length}
              activeStepTitle={
                isSubstrateActive
                  ? 'Multi-Layer Starting Substrate Stack'
                  : activeStep?.title
              }
              activeStepSide={isSubstrateActive ? undefined : activeStep?.side}
              activeStepType={isSubstrateActive ? 'substrate' : activeStep?.type}
              activeStepNotes={isSubstrateActive ? undefined : activeStep?.notes}
              activeLithography={
                !isSubstrateActive && activeStep?.type === 'lithography'
                  ? activeStep.lithography
                  : undefined
              }
              alignmentMarks={flow.alignmentMarks || []}
              substrateTopY={
                flow.substrateLayers && flow.substrateLayers.length > 0
                  ? flow.substrateLayers.reduce((acc, l) => acc + Math.max(1, l.thickness), 0)
                  : flow.substrateThickness || 3000
              }
              steps={flow.steps}
              finalMesh={finalMesh}
              finalPolygons={finalPolygons}
              finalStepNumber={
                resolvedInsetStepIndex >= 0 ? resolvedInsetStepIndex + 1 : undefined
              }
              finalStepTitle={
                resolvedInsetStepIndex >= 0
                  ? flow.steps[resolvedInsetStepIndex]?.title
                  : undefined
              }
              canShowInsetButton={finalEnabledStepIndex >= 0}
              insetStepOptions={laterInsetSteps}
              selectedInsetStepIndex={
                resolvedInsetStepIndex >= 0 ? resolvedInsetStepIndex : undefined
              }
              isInsetFinalStep={
                resolvedInsetStepIndex >= 0 && resolvedInsetStepIndex === finalEnabledStepIndex
              }
              onChangeInsetStep={(stepIndex) => {
                if (stepIndex === finalEnabledStepIndex) {
                  setSelectedInsetStepIndex(null);
                } else {
                  setSelectedInsetStepIndex(stepIndex);
                }
              }}
              showFinalInset={showFinalInset}
              onToggleFinalInset={() => setShowFinalInset((prev) => !prev)}
              onSelectFinalStep={() => {
                if (resolvedInsetStepIndex >= 0) {
                  setActiveStepIndex(resolvedInsetStepIndex);
                  setIsPlaying(false);
                }
              }}
              canPrevStep={activeStepIndex > -1}
              canNextStep={activeStepIndex < flow.steps.length - 1}
              onPrevStep={() => {
                setActiveStepIndex((i) => Math.max(-1, i - 1));
                setIsPlaying(false);
              }}
              onNextStep={() => {
                setActiveStepIndex((i) => Math.min(flow.steps.length - 1, i + 1));
                setIsPlaying(false);
              }}
              activeReleaseConfig={activeReleaseConfig}
              preReleaseMesh={preReleaseMesh}
              preReleasePolygons={preReleasePolygons}
              pickReleaseMode={pickReleaseMode}
              onTogglePickReleaseMode={handleTogglePickReleaseMode}
              onAddReleaseRegion={handleAddReleaseRegion}
              onRemoveReleaseRegion={handleRemoveReleaseRegion}
              onClearReleaseRegions={handleClearReleaseRegions}
              onOpenBatchExport={() => setShowBatchExport(true)}
              onOpenHelp={() => openHelp('viewport')}
            />
          </div>
        </main>
      </div>

      {/* Mobile & Tablet Bottom Panel Switcher (< lg) */}
      {!isFocusFullscreen && (
        <nav className="lg:hidden shrink-0 grid grid-cols-3 bg-slate-900 border-t border-slate-800 text-[11px] font-medium select-none z-20">
        <button
          type="button"
          onClick={handleToggleLeftSidebar}
          className={`flex items-center justify-center gap-1.5 py-2.5 border-r border-slate-800/80 transition-colors ${
            leftSidebarOpen
              ? 'bg-sky-950/50 text-sky-300 font-semibold'
              : 'text-slate-300 active:bg-slate-800'
          }`}
        >
          <ListOrdered className="w-3.5 h-3.5" />
          <span>Flow ({flow.steps.length})</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setLeftSidebarOpen(false);
            setRightSidebarOpen(false);
          }}
          className={`flex items-center justify-center gap-1.5 py-2.5 border-r border-slate-800/80 transition-colors ${
            !leftSidebarOpen && !rightSidebarOpen
              ? 'bg-sky-950/50 text-sky-300 font-semibold'
              : 'text-slate-300 active:bg-slate-800'
          }`}
        >
          <LayersIcon className="w-3.5 h-3.5" />
          <span>Wafer View</span>
        </button>
        <button
          type="button"
          onClick={handleToggleRightSidebar}
          className={`flex items-center justify-center gap-1.5 py-2.5 transition-colors ${
            rightSidebarOpen
              ? 'bg-sky-950/50 text-sky-300 font-semibold'
              : 'text-slate-300 active:bg-slate-800'
          }`}
        >
          <SlidersIcon className="w-3.5 h-3.5" />
          <span>{isSubstrateActive ? 'Substrate' : 'Params'}</span>
        </button>
      </nav>
      )}

      {/* Modals */}
      {showPresets && (
        <PresetPickerModal
          onSelectPreset={handleSelectPreset}
          onImportFlow={(imported) => {
            handleImportJson(imported);
            setIsPlaying(false);
            setShowPresets(false);
          }}
          onClose={() => setShowPresets(false)}
        />
      )}

      {showMaterials && (
        <MaterialsModal
          materials={flow.materials}
          onUpdateMaterials={handleUpdateMaterials}
          onClose={() => setShowMaterials(false)}
        />
      )}

      {showEtchLibrary && (
        <EtchRateLibraryModal
          recipes={allEtchRecipes}
          materials={flow.materials}
          thicknessUnit={thicknessUnit}
          activeStep={activeStep}
          onUpdateRecipes={handleUpdateEtchRecipes}
          onApplyRecipeToStep={handleApplyEtchRecipeToStep}
          onClose={() => setShowEtchLibrary(false)}
        />
      )}

      {showToolLibrary && (
        <ToolLibraryModal
          tools={allTools}
          activeStep={isSubstrateActive ? undefined : activeStep}
          onUpdateTools={handleUpdateTools}
          onApplyToolToStep={handleApplyToolToStep}
          onClose={() => setShowToolLibrary(false)}
        />
      )}

      {showMaskLevels && (
        <MaskLevelsModal
          flow={flow}
          isOpen={showMaskLevels}
          onClose={() => setShowMaskLevels(false)}
          onUpdateFlow={handleUpdateFlow}
          onSelectStepIndex={(idx) => {
            setActiveStepIndex(idx);
            setIsPlaying(false);
          }}
          initialMaskId={focusMaskId}
          onOpenVariablesModal={() => setShowVariables(true)}
          activeStepIndex={activeStepIndex}
          thicknessUnit={thicknessUnit}
          onOpenImportMasks={() =>
            setImportFlowModal({
              open: true,
              initialMode: 'masks-only',
            })
          }
          onOpenHelp={() => openHelp('masks')}
        />
      )}

      {showVariables && (
        <VariablesModal
          flow={flow}
          isOpen={showVariables}
          onClose={() => setShowVariables(false)}
          onUpdateFlow={handleUpdateFlow}
        />
      )}

      {showVariantManager && (
        <VariantManagerModal
          flow={flow}
          isOpen={showVariantManager}
          thicknessUnit={thicknessUnit}
          onClose={() => setShowVariantManager(false)}
          onUpdateFlow={handleUpdateFlow}
          onSelectStepIndex={(idx) => {
            setActiveStepIndex(idx);
            setIsPlaying(false);
          }}
        />
      )}

      {showRunSheet && (
        <RunSheetModal
          flow={flow}
          thicknessUnit={thicknessUnit}
          onExportCsv={handleExportCsv}
          onClose={() => setShowRunSheet(false)}
        />
      )}

      {showMultiStep && (
        <MultiStepFlowView
          flow={flow}
          thicknessUnit={thicknessUnit}
          zScale={zScale}
          onChangeZScale={setZScale}
          zAspect1to1={zAspect1to1}
          onChangeZAspect1to1={setZAspect1to1}
          lockSharedYScale={lockSharedYScale}
          onToggleLockSharedYScale={() => setLockSharedYScale((prev) => !prev)}
          piecewiseMode={piecewiseZMode}
          onChangePiecewiseMode={setPiecewiseZMode}
          autoCompression={piecewiseAutoCompression}
          onChangeAutoCompression={setPiecewiseAutoCompression}
          customZConfig={piecewiseCustomConfig}
          onChangeCustomZConfig={setPiecewiseCustomConfig}
          onSelectStepIndex={(idx) => setActiveStepIndex(idx)}
          onUpdateFlow={handleUpdateFlow}
          onOpenBatchExport={() => setShowBatchExport(true)}
          onClose={() => setShowMultiStep(false)}
        />
      )}

      {showBatchExport && (
        <BatchExportModal
          flow={flow}
          thicknessUnit={thicknessUnit}
          onClose={() => setShowBatchExport(false)}
        />
      )}

      {showAbout && (
        <AboutModal
          onClose={() => setShowAbout(false)}
          onOpenHelp={() => openHelp('overview')}
        />
      )}

      {importFlowModal.open && (
        <ImportFromFlowModal
          currentFlow={flow}
          activeStepIndex={activeStepIndex}
          thicknessUnit={thicknessUnit}
          initialMode={importFlowModal.initialMode}
          onApplyImport={(nextFlow, nextActiveStepIndex) => {
            setFlow(nextFlow);
            setIsPlaying(false);
            if (
              typeof nextActiveStepIndex === 'number' &&
              nextActiveStepIndex >= 0
            ) {
              setActiveStepIndex(nextActiveStepIndex);
            }
          }}
          onClose={() =>
            setImportFlowModal((prev) => ({ ...prev, open: false }))
          }
          onOpenHelp={() => openHelp('import')}
        />
      )}

      {helpModal.open && (
        <HelpModal
          initialTopic={helpModal.topic}
          onClose={() => setHelpModal((prev) => ({ ...prev, open: false }))}
          onOpenAbout={() => setShowAbout(true)}
        />
      )}
    </div>
  );
}
