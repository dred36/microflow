/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { ProcessFlow, ProcessStep, PhotomaskLevel, MaskWindow, VariableUnit } from '../types/microfab';
import {
  calculateMaskMetrics,
  updateMaskAndSyncSteps,
  assignMaskToStep,
  swapMaskAssignments,
  createNewMaskInFlow,
  deleteMaskFromFlow,
  duplicateMaskWindow,
  createMaskWindowArray,
  getMaskVariantLinks,
  isMaskAssignedInFlow,
  forkMaskForStepVariant,
  getMaskArrowStepSizes,
  deriveGlobalAlignmentMarkFromSelection,
  MaskWindowArrayOptions,
  RETICLE_PALETTE,
} from '../lib/maskUtils';
import {
  getActiveStepVariant,
  switchStepVariant,
  createStepVariant,
} from '../lib/variantUtils';
import { resolveFlowParameters } from '../lib/variableUtils';
import { ParamBindingBadge, ParamBindingPanel } from './ParamBindingControl';
import { MaskWindowArrayPanel } from './MaskWindowArrayPanel';
import {
  X,
  Plus,
  Trash2,
  Copy,
  ExternalLink,
  MoveHorizontal,
  ArrowLeftRight,
  Layers,
  Sparkles,
  Check,
  Search,
  Scan,
  Maximize2,
  Minimize2,
  Sliders,
  Split,
  FlipHorizontal,
  Eye,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  LayoutGrid,
  ChevronDown,
  PanelLeft,
  PanelRight,
  Eraser,
  Variable as VariableIcon,
  Undo2,
  Redo2,
  GitBranch,
  FileInput,
  HelpCircle,
  Crosshair,
} from 'lucide-react';
import { GdsLayoutEditor } from './GdsLayoutEditor';
import { MaskStackView } from './MaskStackView';
import { simulateCrossSection, buildRenderPolygons } from '../lib/simulationEngine';
import { getMaterialById } from '../lib/materials';
import { SvgPatterns } from './SvgPatterns';
import { ThicknessUnit } from '../lib/units';

interface MaskLevelsModalProps {
  flow: ProcessFlow;
  isOpen: boolean;
  onClose: () => void;
  onUpdateFlow: (updatedFlow: ProcessFlow) => void;
  onSelectStepIndex?: (index: number) => void;
  initialMaskId?: string;
  onOpenVariablesModal?: () => void;
  activeStepIndex?: number;
  thicknessUnit?: ThicknessUnit;
  onOpenImportMasks?: () => void;
  onOpenHelp?: () => void;
}

type MaskCoordUnit = 'um' | 'nm';

const formatCoordInputVal = (nm: number, unit: MaskCoordUnit): string => {
  if (unit === 'nm') {
    return String(Math.round(nm));
  }
  return String(Math.round((nm / 1000) * 1000) / 1000);
};

const formatCoordDisplay = (nm: number, unit: MaskCoordUnit, umDecimals = 2): string => {
  if (unit === 'nm') {
    return `${Math.round(nm)} nm`;
  }
  return `${Number((nm / 1000).toFixed(umDecimals))} µm`;
};

interface CoordNumberInputProps {
  valueNm: number;
  unit: MaskCoordUnit;
  minNm?: number;
  maxNm: number;
  liveMinNm?: number;
  liveMaxNm?: number;
  disabled?: boolean;
  onCommitNm: (valNm: number) => void;
  title?: string;
  className?: string;
}

const CoordNumberInput: React.FC<CoordNumberInputProps> = ({
  valueNm,
  unit,
  minNm = 0,
  maxNm,
  liveMinNm,
  liveMaxNm,
  disabled = false,
  onCommitNm,
  title,
  className,
}) => {
  const formatted = formatCoordInputVal(valueNm, unit);
  const [isFocused, setIsFocused] = useState(false);
  const [draft, setDraft] = useState(formatted);

  useEffect(() => {
    if (!isFocused) {
      setDraft(formatted);
    }
  }, [formatted, isFocused]);

  const factor = unit === 'um' ? 1000 : 1;
  const minDisplay = formatCoordInputVal(minNm, unit);
  const maxDisplay = formatCoordInputVal(maxNm, unit);
  const effLiveMin = liveMinNm ?? minNm;
  const effLiveMax = liveMaxNm ?? maxNm;

  return (
    <input
      type="number"
      step={unit === 'um' ? '0.05' : '50'}
      min={minDisplay}
      max={maxDisplay}
      disabled={disabled}
      value={isFocused ? draft : formatted}
      title={title}
      onClick={(e) => e.stopPropagation()}
      onFocus={(e) => {
        if (disabled) return;
        setIsFocused(true);
        setDraft(formatted);
        e.target.select();
      }}
      onChange={(e) => {
        if (disabled) return;
        const raw = e.target.value;
        setDraft(raw);
        const parsed = parseFloat(raw);
        if (Number.isFinite(parsed)) {
          const valNm = Math.round(parsed * factor);
          if (valNm >= effLiveMin && valNm <= effLiveMax) {
            onCommitNm(valNm);
          }
        }
      }}
      onBlur={() => {
        const parsed = parseFloat(draft);
        if (Number.isFinite(parsed)) {
          const valNm = Math.round(parsed * factor);
          onCommitNm(Math.max(minNm, Math.min(maxNm, valNm)));
        }
        setIsFocused(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          (e.target as HTMLInputElement).blur();
        } else if (e.key === 'Escape') {
          setDraft(formatted);
          setIsFocused(false);
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={className}
    />
  );
};

interface DragState {
  winId: string;
  type: 'resize-start' | 'resize-end' | 'move';
  startClientX: number;
  initialXStart: number;
  initialXEnd: number;
  initialWindows?: Array<{ id: string; xStart: number; xEnd: number }>;
}

interface TrackMarquee {
  startClientX: number;
  startNm: number;
  currentNm: number;
  additive: boolean;
}

export const MaskLevelsModal: React.FC<MaskLevelsModalProps> = ({
  flow,
  isOpen,
  onClose,
  onUpdateFlow,
  onSelectStepIndex,
  initialMaskId,
  onOpenVariablesModal,
  activeStepIndex: _activeStepIndex,
  thicknessUnit = 'nm',
  onOpenImportMasks,
  onOpenHelp,
}) => {
  const [apertureUnit, setApertureUnit] = useState<MaskCoordUnit>(() => {
    try {
      const saved = localStorage.getItem('microflow_mask_manager_unit');
      return saved === 'nm' ? 'nm' : 'um';
    } catch {
      return 'um';
    }
  });
  const handleChangeApertureUnit = (next: MaskCoordUnit) => {
    setApertureUnit(next);
    try {
      localStorage.setItem('microflow_mask_manager_unit', next);
    } catch {
      // ignore storage errors
    }
  };
  const masks = useMemo(() => flow.masks || [], [flow.masks]);
  const variables = useMemo(() => flow.variables || [], [flow.variables]);
  const waferWidth = flow.substrateWidth || 10000;

  // Selected mask in the panel
  const [selectedMaskId, setSelectedMaskId] = useState<string>(() => {
    if (initialMaskId && masks.some((m) => m.id === initialMaskId)) {
      return initialMaskId;
    }
    return masks[0]?.id || '';
  });

  // Track if selectedMaskId is still valid when masks change
  useEffect(() => {
    if (masks.length > 0 && (!selectedMaskId || !masks.some((m) => m.id === selectedMaskId))) {
      setSelectedMaskId(masks[0].id);
    }
  }, [masks, selectedMaskId]);

  const selectedMask = useMemo(() => {
    return masks.find((m) => m.id === selectedMaskId) || masks[0] || null;
  }, [masks, selectedMaskId]);

  // Search filter
  const [searchQuery, setSearchQuery] = useState('');

  // Reassignment conflict prompt modal state
  interface ConflictPromptData {
    targetStepId: string;
    targetVariantId?: string;
    targetVariantName?: string;
    targetStepTitle: string;
    targetStepIndex: number;
    conflictingMask: PhotomaskLevel;
    currentMask: PhotomaskLevel;
    currentMaskPriorStep?: {
      id: string;
      title: string;
      index: number;
      variantName?: string;
    };
  }
  const [conflictPrompt, setConflictPrompt] = useState<ConflictPromptData | null>(null);
  const [feedbackNotice, setFeedbackNotice] = useState<{ message: string; type: 'success' | 'warn' } | null>(null);
  const [editorTab, setEditorTab] = useState<'apertures' | 'stack' | 'gds'>('apertures');
  const [mobileReticleDrawerOpen, setMobileReticleDrawerOpen] = useState<boolean>(false);
  const [desktopMasksSidebarOpen, setDesktopMasksSidebarOpen] = useState<boolean>(true);
  const [showSelectedMaskInset, setShowSelectedMaskInset] = useState<boolean>(true);
  const [showFinalStepInset, setShowFinalStepInset] = useState<boolean>(true);
  const [insetExpanded, setInsetExpanded] = useState<boolean>(false);
  const notifyTimerRef = useRef<number | null>(null);

  const getEnabledSimIndexForRawStep = useCallback(
    (rawStepIdx: number): number => {
      if (rawStepIdx < 0) return -1;
      let enabledCount = 0;
      for (let i = 0; i <= rawStepIdx && i < flow.steps.length; i++) {
        if (flow.steps[i].enabled !== false) enabledCount++;
      }
      return enabledCount - 1;
    },
    [flow.steps]
  );

  const finalEnabledStepIndex = useMemo(() => {
    for (let i = flow.steps.length - 1; i >= 0; i--) {
      if (flow.steps[i].enabled !== false) return i;
    }
    return -1;
  }, [flow.steps]);

  const handleEditorNotify = (message: string, type: 'success' | 'warn') => {
    setFeedbackNotice({ message, type });
    if (notifyTimerRef.current) {
      window.clearTimeout(notifyTimerRef.current);
    }
    notifyTimerRef.current = window.setTimeout(() => {
      setFeedbackNotice(null);
    }, 4000);
  };

  // Drag state for interactive aperture track
  const trackRef = useRef<HTMLDivElement>(null);
  const [selectedWindowIds, setSelectedWindowIds] = useState<string[]>([]);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dragPreviewWindows, setDragPreviewWindows] = useState<MaskWindow[] | null>(null);
  const [trackMarquee, setTrackMarquee] = useState<TrackMarquee | null>(null);
  const [openWinBind, setOpenWinBind] = useState<{
    winId: string;
    field: 'xStart' | 'xEnd' | 'width';
  } | null>(null);
  const [arraySourceWinId, setArraySourceWinId] = useState<string | null>(null);

  interface TrackHistorySnapshot {
    masks: ProcessFlow['masks'];
    steps: ProcessFlow['steps'];
    variables: ProcessFlow['variables'];
    alignmentMarks?: ProcessFlow['alignmentMarks'];
    selectedMaskId: string;
  }

  const MAX_HISTORY = 60;
  const undoStackRef = useRef<TrackHistorySnapshot[]>([]);
  const redoStackRef = useRef<TrackHistorySnapshot[]>([]);
  const dragStartSnapRef = useRef<TrackHistorySnapshot | null>(null);
  const keyNudgeStartSnapRef = useRef<TrackHistorySnapshot | null>(null);
  const keyNudgeIdleTimerRef = useRef<number | null>(null);
  const liveWindowsRef = useRef<MaskWindow[] | null>(null);
  const pendingDragWindowsRef = useRef<MaskWindow[] | null>(null);
  const lastDragSigRef = useRef<string>('');
  const lastSimSyncTsRef = useRef<number>(0);
  const dragSyncRafRef = useRef<number | null>(null);
  const dragSyncTimeoutRef = useRef<number | null>(null);
  const latestFlowRef = useRef(flow);
  latestFlowRef.current = flow;
  const latestSelectedMaskIdRef = useRef(selectedMaskId);
  latestSelectedMaskIdRef.current = selectedMaskId;
  const selectedWindowIdsRef = useRef(selectedWindowIds);
  selectedWindowIdsRef.current = selectedWindowIds;
  const waferWidthRef = useRef(waferWidth);
  waferWidthRef.current = waferWidth;
  const dragStateRef = useRef(dragState);
  dragStateRef.current = dragState;
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });

  const cancelPendingDragSync = useCallback(() => {
    if (dragSyncRafRef.current !== null) {
      window.cancelAnimationFrame(dragSyncRafRef.current);
      dragSyncRafRef.current = null;
    }
    if (dragSyncTimeoutRef.current !== null) {
      window.clearTimeout(dragSyncTimeoutRef.current);
      dragSyncTimeoutRef.current = null;
    }
  }, []);

  const clearKeyNudgeTimer = useCallback(() => {
    if (keyNudgeIdleTimerRef.current !== null) {
      window.clearTimeout(keyNudgeIdleTimerRef.current);
      keyNudgeIdleTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      cancelPendingDragSync();
      clearKeyNudgeTimer();
    };
  }, [cancelPendingDragSync, clearKeyNudgeTimer]);

  const syncHistoryState = useCallback(() => {
    setHistoryState({
      canUndo: undoStackRef.current.length > 0,
      canRedo: redoStackRef.current.length > 0,
    });
  }, []);

  const makeTrackSnapshot = useCallback(
    (targetFlow: ProcessFlow, selId: string): TrackHistorySnapshot => ({
      masks: targetFlow.masks,
      steps: targetFlow.steps,
      variables: targetFlow.variables,
      alignmentMarks: targetFlow.alignmentMarks,
      selectedMaskId: selId,
    }),
    []
  );

  const trackSnapshotsEqual = (a: TrackHistorySnapshot, b: TrackHistorySnapshot): boolean =>
    JSON.stringify({ m: a.masks, s: a.steps, v: a.variables, a: a.alignmentMarks }) ===
    JSON.stringify({ m: b.masks, s: b.steps, v: b.variables, a: b.alignmentMarks });

  const commitTrackFlow = useCallback(
    (nextFlow: ProcessFlow, options?: { skipHistory?: boolean; nextSelectedMaskId?: string }) => {
      if (!options?.skipHistory) {
        const prevSnap = makeTrackSnapshot(latestFlowRef.current, latestSelectedMaskIdRef.current);
        const nextSnap = makeTrackSnapshot(
          nextFlow,
          options?.nextSelectedMaskId ?? latestSelectedMaskIdRef.current
        );
        if (!trackSnapshotsEqual(prevSnap, nextSnap)) {
          undoStackRef.current = [
            ...undoStackRef.current.slice(-(MAX_HISTORY - 1)),
            prevSnap,
          ];
          redoStackRef.current = [];
          syncHistoryState();
        }
      }
      onUpdateFlow(nextFlow);
    },
    [makeTrackSnapshot, onUpdateFlow, syncHistoryState]
  );

  const scheduleWindowsSync = useCallback(() => {
    if (dragSyncRafRef.current !== null || dragSyncTimeoutRef.current !== null) {
      return;
    }
    const flushSync = () => {
      dragSyncRafRef.current = null;
      dragSyncTimeoutRef.current = null;
      const nextWins = pendingDragWindowsRef.current;
      const activeMask = (latestFlowRef.current.masks || []).find(
        (m) => m.id === latestSelectedMaskIdRef.current
      );
      if (!nextWins || !activeMask) return;
      pendingDragWindowsRef.current = null;
      lastSimSyncTsRef.current = performance.now();
      const newFlow = updateMaskAndSyncSteps(latestFlowRef.current, {
        ...activeMask,
        windows: nextWins,
      });
      commitTrackFlow(newFlow, { skipHistory: true });
    };
    const DRAG_SIM_INTERVAL_MS = 45;
    const elapsed = performance.now() - lastSimSyncTsRef.current;
    if (elapsed >= DRAG_SIM_INTERVAL_MS) {
      dragSyncRafRef.current = window.requestAnimationFrame(flushSync);
    } else {
      dragSyncTimeoutRef.current = window.setTimeout(() => {
        dragSyncTimeoutRef.current = null;
        dragSyncRafRef.current = window.requestAnimationFrame(flushSync);
      }, Math.max(8, DRAG_SIM_INTERVAL_MS - elapsed));
    }
  }, [commitTrackFlow]);

  const flushKeyboardNudge = useCallback(() => {
    clearKeyNudgeTimer();
    if (dragStateRef.current) return;
    const startSnap = keyNudgeStartSnapRef.current;
    const pendingWins = pendingDragWindowsRef.current;
    const liveWins = liveWindowsRef.current;
    if (!startSnap && !pendingWins && !liveWins) return;

    cancelPendingDragSync();
    keyNudgeStartSnapRef.current = null;
    pendingDragWindowsRef.current = null;
    liveWindowsRef.current = null;

    const activeMask = (latestFlowRef.current.masks || []).find(
      (m) => m.id === latestSelectedMaskIdRef.current
    );
    const finalWins = pendingWins ?? liveWins;
    let finalFlow = latestFlowRef.current;

    if (finalWins && activeMask) {
      finalFlow = updateMaskAndSyncSteps(latestFlowRef.current, {
        ...activeMask,
        windows: finalWins,
      });
      if (pendingWins) {
        commitTrackFlow(finalFlow, { skipHistory: true });
      }
    }

    if (startSnap) {
      const currSnap = makeTrackSnapshot(finalFlow, latestSelectedMaskIdRef.current);
      if (!trackSnapshotsEqual(startSnap, currSnap)) {
        undoStackRef.current = [
          ...undoStackRef.current.slice(-(MAX_HISTORY - 1)),
          startSnap,
        ];
        redoStackRef.current = [];
        syncHistoryState();
      }
    }

    setDragPreviewWindows(null);
  }, [cancelPendingDragSync, clearKeyNudgeTimer, commitTrackFlow, makeTrackSnapshot, syncHistoryState]);

  const handleUndoTrack = useCallback(() => {
    flushKeyboardNudge();
    if (undoStackRef.current.length === 0) return;
    const prevSnap = undoStackRef.current[undoStackRef.current.length - 1];
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    redoStackRef.current = [
      ...redoStackRef.current.slice(-(MAX_HISTORY - 1)),
      makeTrackSnapshot(latestFlowRef.current, latestSelectedMaskIdRef.current),
    ];
    cancelPendingDragSync();
    clearKeyNudgeTimer();
    pendingDragWindowsRef.current = null;
    liveWindowsRef.current = null;
    dragStartSnapRef.current = null;
    keyNudgeStartSnapRef.current = null;
    setDragPreviewWindows(null);
    setDragState(null);
    setTrackMarquee(null);
    syncHistoryState();
    onUpdateFlow({
      ...latestFlowRef.current,
      masks: prevSnap.masks,
      steps: prevSnap.steps,
      variables: prevSnap.variables,
      alignmentMarks: prevSnap.alignmentMarks,
    });
    if (
      prevSnap.selectedMaskId &&
      (prevSnap.masks || []).some((m) => m.id === prevSnap.selectedMaskId)
    ) {
      setSelectedMaskId(prevSnap.selectedMaskId);
    }
  }, [cancelPendingDragSync, clearKeyNudgeTimer, flushKeyboardNudge, makeTrackSnapshot, onUpdateFlow, syncHistoryState]);

  const handleRedoTrack = useCallback(() => {
    flushKeyboardNudge();
    if (redoStackRef.current.length === 0) return;
    const nextSnap = redoStackRef.current[redoStackRef.current.length - 1];
    redoStackRef.current = redoStackRef.current.slice(0, -1);
    undoStackRef.current = [
      ...undoStackRef.current.slice(-(MAX_HISTORY - 1)),
      makeTrackSnapshot(latestFlowRef.current, latestSelectedMaskIdRef.current),
    ];
    cancelPendingDragSync();
    clearKeyNudgeTimer();
    pendingDragWindowsRef.current = null;
    liveWindowsRef.current = null;
    dragStartSnapRef.current = null;
    keyNudgeStartSnapRef.current = null;
    setDragPreviewWindows(null);
    setDragState(null);
    setTrackMarquee(null);
    syncHistoryState();
    onUpdateFlow({
      ...latestFlowRef.current,
      masks: nextSnap.masks,
      steps: nextSnap.steps,
      variables: nextSnap.variables,
      alignmentMarks: nextSnap.alignmentMarks,
    });
    if (
      nextSnap.selectedMaskId &&
      (nextSnap.masks || []).some((m) => m.id === nextSnap.selectedMaskId)
    ) {
      setSelectedMaskId(nextSnap.selectedMaskId);
    }
  }, [cancelPendingDragSync, clearKeyNudgeTimer, flushKeyboardNudge, makeTrackSnapshot, onUpdateFlow, syncHistoryState]);

  useEffect(() => {
    if (!isOpen) {
      cancelPendingDragSync();
      clearKeyNudgeTimer();
      pendingDragWindowsRef.current = null;
      liveWindowsRef.current = null;
      undoStackRef.current = [];
      redoStackRef.current = [];
      dragStartSnapRef.current = null;
      keyNudgeStartSnapRef.current = null;
      setDragPreviewWindows(null);
      setDragState(null);
      setHistoryState({ canUndo: false, canRedo: false });
    }
  }, [isOpen, cancelPendingDragSync, clearKeyNudgeTimer]);

  useEffect(() => {
    cancelPendingDragSync();
    clearKeyNudgeTimer();
    pendingDragWindowsRef.current = null;
    liveWindowsRef.current = null;
    dragStartSnapRef.current = null;
    keyNudgeStartSnapRef.current = null;
    setDragPreviewWindows(null);
    setDragState(null);
    setSelectedWindowIds([]);
    setArraySourceWinId(null);
    setOpenWinBind(null);
  }, [selectedMaskId, cancelPendingDragSync, clearKeyNudgeTimer]);

  useEffect(() => {
    const wins = selectedMask?.windows || [];
    const validIds = new Set(wins.map((w) => w.id));
    setSelectedWindowIds((prev) => {
      const next = prev.filter((id) => validIds.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [selectedMask?.windows]);

  // Keyboard shortcuts: Undo/Redo (Ctrl+Z / Ctrl+Y / Cmd+Shift+Z), Escape, Left/Right arrow nudging
  useEffect(() => {
    if (!isOpen || editorTab === 'gds' || conflictPrompt) {
      flushKeyboardNudge();
      return;
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;

      const isUndoRedo =
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        (e.key.toLowerCase() === 'z' || (e.key.toLowerCase() === 'y' && !e.shiftKey));
      const isEscape = e.key === 'Escape';
      const isArrow = e.key === 'ArrowLeft' || e.key === 'ArrowRight';
      if (!isUndoRedo && !isEscape && !isArrow) return;

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        target?.isContentEditable
      ) {
        return;
      }

      if (isUndoRedo) {
        const keyLower = e.key.toLowerCase();
        if (keyLower === 'z') {
          e.preventDefault();
          if (e.shiftKey) {
            handleRedoTrack();
          } else {
            handleUndoTrack();
          }
          return;
        }
        if (keyLower === 'y' && !e.shiftKey) {
          e.preventDefault();
          handleRedoTrack();
          return;
        }
      }

      const currentFlow = latestFlowRef.current;
      const currentMask = (currentFlow.masks || []).find(
        (m) => m.id === latestSelectedMaskIdRef.current
      );
      if (!currentMask) return;

      if (isEscape) {
        if (selectedWindowIdsRef.current.length > 0) {
          setSelectedWindowIds([]);
        }
        return;
      }

      if (dragStateRef.current) return;

      const wins = liveWindowsRef.current ?? currentMask.windows ?? [];
      const curSelectedIds = selectedWindowIdsRef.current;
      const targetIds =
        curSelectedIds.length > 0
          ? curSelectedIds
          : wins.length === 1
          ? [wins[0].id]
          : [];
      if (targetIds.length === 0) return;

      const selectedTargets = wins.filter((w) => targetIds.includes(w.id));
      if (selectedTargets.length === 0) return;

      e.preventDefault();
      const curWaferWidth = waferWidthRef.current;
      const { fineNm, coarseNm } = getMaskArrowStepSizes(curWaferWidth);
      const nudge = e.shiftKey ? coarseNm : fineNm;
      const deltaNm = e.key === 'ArrowLeft' ? -nudge : nudge;
      const minDelta = -Math.min(...selectedTargets.map((w) => w.xStart));
      const maxDelta = Math.min(...selectedTargets.map((w) => curWaferWidth - w.xEnd));
      const clampedDelta = Math.round(Math.max(minDelta, Math.min(maxDelta, deltaNm)));
      if (clampedDelta === 0) return;

      if (keyNudgeStartSnapRef.current === null) {
        keyNudgeStartSnapRef.current = makeTrackSnapshot(
          currentFlow,
          latestSelectedMaskIdRef.current
        );
      }

      const selSet = new Set(selectedTargets.map((w) => w.id));
      const nextWins = wins.map((w) =>
        selSet.has(w.id)
          ? { ...w, xStart: w.xStart + clampedDelta, xEnd: w.xEnd + clampedDelta }
          : w
      );

      liveWindowsRef.current = nextWins;
      pendingDragWindowsRef.current = nextWins;
      setDragPreviewWindows(nextWins);
      scheduleWindowsSync();

      clearKeyNudgeTimer();
      keyNudgeIdleTimerRef.current = window.setTimeout(() => {
        keyNudgeIdleTimerRef.current = null;
        flushKeyboardNudge();
      }, 180);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        flushKeyboardNudge();
      }
    };

    const onBlur = () => {
      flushKeyboardNudge();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [
    isOpen,
    editorTab,
    conflictPrompt,
    handleUndoTrack,
    handleRedoTrack,
    makeTrackSnapshot,
    scheduleWindowsSync,
    clearKeyNudgeTimer,
    flushKeyboardNudge,
  ]);

  // List of all lithography steps in the process flow
  const lithoSteps = useMemo(() => {
    return flow.steps
      .map((step, idx) => ({ step, index: idx }))
      .filter(({ step }) => step.type === 'lithography');
  }, [flow.steps]);

  // Filtered masks
  const filteredMasks = useMemo(() => {
    if (!searchQuery.trim()) return masks;
    const q = searchQuery.toLowerCase();
    return masks.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        (m.layerCode && m.layerCode.toLowerCase().includes(q)) ||
        (m.description && m.description.toLowerCase().includes(q))
    );
  }, [masks, searchQuery]);

  const selectedMaskLinks = useMemo(
    () => (selectedMask ? getMaskVariantLinks(flow, selectedMask) : []),
    [flow, selectedMask]
  );

  // Assigned step for current mask (supports active and inactive step variants)
  const assignedStepInfo = useMemo(() => {
    if (!selectedMask) return null;
    if (selectedMaskLinks.length > 0) {
      const activeOrFirst =
        selectedMaskLinks.find((l) => l.isActiveVariant) || selectedMaskLinks[0];
      return { step: activeOrFirst.step, index: activeOrFirst.stepIndex };
    }
    return selectedMask.assignedStepId
      ? lithoSteps.find(({ step }) => step.id === selectedMask.assignedStepId) || null
      : null;
  }, [selectedMask, selectedMaskLinks, lithoSteps]);

  const selectedMaskInsetData = useMemo(() => {
    if (!showSelectedMaskInset) return null;
    if (!selectedMask) {
      return {
        isUnassigned: true as const,
        mesh: null,
        polygons: [],
        rawStepIndex: -1,
        stepNumber: 0,
        title: 'No Reticle Selected',
        isSubstrate: false,
        isDisabled: false,
        variantName: undefined as string | undefined,
        isInactiveVariant: false,
        maskName: 'No reticle selected',
        maskCode: '',
        maskColor: '#38bdf8',
      };
    }

    const activeOrFirstLink =
      selectedMaskLinks.find((l) => l.isActiveVariant) || selectedMaskLinks[0] || null;
    const rawStepIndex = activeOrFirstLink
      ? activeOrFirstLink.stepIndex
      : assignedStepInfo
        ? assignedStepInfo.index
        : -1;
    const targetStep = rawStepIndex >= 0 ? flow.steps[rawStepIndex] : null;

    if (!targetStep) {
      return {
        isUnassigned: true as const,
        mesh: null,
        polygons: [],
        rawStepIndex: -1,
        stepNumber: 0,
        title: 'Unassigned Reticle',
        isSubstrate: false,
        isDisabled: false,
        variantName: undefined as string | undefined,
        isInactiveVariant: false,
        maskName: selectedMask.name,
        maskCode: selectedMask.layerCode || '',
        maskColor: selectedMask.color || '#38bdf8',
      };
    }

    const needsVariantSwitch = Boolean(
      activeOrFirstLink &&
        !activeOrFirstLink.isActiveVariant &&
        activeOrFirstLink.variant
    );
    const simFlow =
      needsVariantSwitch && activeOrFirstLink?.variant
        ? {
            ...flow,
            steps: flow.steps.map((s) =>
              s.id === targetStep.id
                ? switchStepVariant(s, activeOrFirstLink.variant!.id)
                : s
            ),
          }
        : flow;

    const simIdx = getEnabledSimIndexForRawStep(rawStepIndex);
    const mesh = simulateCrossSection(simFlow, simIdx);
    const polygons = buildRenderPolygons(mesh, simFlow.materials);

    return {
      isUnassigned: false as const,
      mesh,
      polygons,
      rawStepIndex,
      stepNumber: rawStepIndex + 1,
      title: targetStep.title,
      isSubstrate: false,
      isDisabled: targetStep.enabled === false,
      variantName: activeOrFirstLink?.variant?.name,
      isInactiveVariant: needsVariantSwitch,
      maskName: selectedMask.name,
      maskCode: selectedMask.layerCode || '',
      maskColor: selectedMask.color || '#38bdf8',
    };
  }, [
    showSelectedMaskInset,
    selectedMask,
    selectedMaskLinks,
    assignedStepInfo,
    flow,
    getEnabledSimIndexForRawStep,
  ]);

  const finalInsetData = useMemo(() => {
    if (!showFinalStepInset) return null;
    const simIdx = getEnabledSimIndexForRawStep(finalEnabledStepIndex);
    const mesh = simulateCrossSection(flow, simIdx);
    const polygons = buildRenderPolygons(mesh, flow.materials);
    const step = finalEnabledStepIndex >= 0 ? flow.steps[finalEnabledStepIndex] : null;
    return {
      isUnassigned: false as const,
      mesh,
      polygons,
      rawStepIndex: finalEnabledStepIndex,
      stepNumber: finalEnabledStepIndex >= 0 ? finalEnabledStepIndex + 1 : 0,
      title: step ? step.title : 'Starting Substrate',
      isSubstrate: finalEnabledStepIndex < 0,
      isDisabled: false,
      variantName: undefined as string | undefined,
      isInactiveVariant: false,
      maskName: '',
      maskCode: '',
      maskColor: '#10b981',
    };
  }, [showFinalStepInset, getEnabledSimIndexForRawStep, finalEnabledStepIndex, flow]);

  if (!isOpen) return null;

  // Active mask metrics
  const metrics = selectedMask ? calculateMaskMetrics(selectedMask, waferWidth) : null;

  // Handler: Update current mask
  const handleUpdateMask = (updated: PhotomaskLevel, skipHistory?: boolean) => {
    const newFlow = updateMaskAndSyncSteps(latestFlowRef.current, updated);
    commitTrackFlow(newFlow, { skipHistory });
  };

  // Handler: Add new mask level beforehand
  const handleCreateNewMask = () => {
    const { flow: newFlow, newMask } = createNewMaskInFlow(latestFlowRef.current);
    commitTrackFlow(newFlow, { nextSelectedMaskId: newMask.id });
    setSelectedMaskId(newMask.id);
  };

  // Handler: Duplicate mask level
  const handleDuplicateMask = (maskToDup: PhotomaskLevel, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const newMask: PhotomaskLevel = {
      ...maskToDup,
      id: `mask_${Date.now()}`,
      name: `${maskToDup.name} (Copy)`,
      layerCode: `${maskToDup.layerCode || 'LVL'}-CPY`,
      maskField: maskToDup.maskField || 'dark-field',
      assignedStepId: undefined, // Fresh copy is unassigned
      assignedVariantId: undefined,
      windows: maskToDup.windows.map((w) => ({ ...w, id: `w_${Date.now()}_${Math.random().toString(36).substring(2, 6)}` })),
    };
    const { flow: newFlow } = createNewMaskInFlow(latestFlowRef.current, newMask);
    commitTrackFlow(newFlow, { nextSelectedMaskId: newMask.id });
    setSelectedMaskId(newMask.id);
  };

  const isMaskAssigned = (mask: PhotomaskLevel): boolean =>
    isMaskAssignedInFlow(flow, mask);

  // Handler: Delete unassigned mask level
  const handleDeleteMask = (maskId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const targetMask = masks.find((m) => m.id === maskId);
    if (!targetMask) return;

    if (isMaskAssignedInFlow(latestFlowRef.current, targetMask)) {
      handleEditorNotify(
        'Assigned mask levels cannot be deleted. Clear its aperture track or unassign it from the step/variant first.',
        'warn'
      );
      return;
    }

    const newFlow = deleteMaskFromFlow(latestFlowRef.current, maskId);
    const remaining = newFlow.masks || [];
    const nextSelId = selectedMaskId === maskId ? (remaining[0]?.id || '') : selectedMaskId;
    commitTrackFlow(newFlow, { nextSelectedMaskId: nextSelId });
    if (selectedMaskId === maskId) {
      setSelectedMaskId(nextSelId);
    }
    handleEditorNotify(`Deleted unassigned mask "${targetMask.name}".`, 'success');
  };

  // Handler: Clear all apertures on a mask level track
  const handleClearApertureTrack = (targetMask: PhotomaskLevel | null = selectedMask, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!targetMask) return;
    handleUpdateMask({
      ...targetMask,
      windows: [],
    });
    if (targetMask.id === selectedMask?.id) {
      setSelectedWindowIds([]);
    }
    handleEditorNotify(`Cleared aperture track on "${targetMask.name}".`, 'success');
  };

  // Handler: Assign to Step (or specific Step Variant encoded as "stepId::variantId")
  const handleAssignStep = (rawTargetValue: string) => {
    if (!selectedMask) return;
    if (rawTargetValue === 'none') {
      const newFlow = assignMaskToStep(latestFlowRef.current, selectedMask.id, null);
      commitTrackFlow(newFlow);
      setFeedbackNotice({
        message: `Unassigned ${selectedMask.name} from process steps.`,
        type: 'success',
      });
      setTimeout(() => setFeedbackNotice(null), 3000);
      return;
    }

    const [targetStepId, rawVariantId] = rawTargetValue.split('::');
    const targetVariantId = rawVariantId || undefined;
    const stepItem = lithoSteps.find(({ step }) => step.id === targetStepId);
    const targetVariant = targetVariantId
      ? stepItem?.step.variants?.find((v) => v.id === targetVariantId)
      : undefined;

    if (
      selectedMask.assignedStepId === targetStepId &&
      (!targetVariantId || selectedMask.assignedVariantId === targetVariantId)
    ) {
      return;
    }

    // Check if another reticle in the library is already assigned to this exact (step, variant) slot
    const conflictingMask = masks.find((m) => {
      if (m.id === selectedMask.id) return false;
      if (targetVariantId && stepItem?.step.variants && stepItem.step.variants.length > 1) {
        const variantUsesOther = targetVariant?.lithography?.maskId === m.id;
        const explicitSlotMatch =
          m.assignedStepId === targetStepId &&
          (!m.assignedVariantId || m.assignedVariantId === targetVariantId);
        return variantUsesOther || explicitSlotMatch;
      }
      return m.assignedStepId === targetStepId;
    });

    if (conflictingMask) {
      const priorLinks = getMaskVariantLinks(latestFlowRef.current, selectedMask);
      const priorLink = priorLinks[0];
      const priorStepItem = priorLink
        ? { step: priorLink.step, index: priorLink.stepIndex, variantName: priorLink.variant?.name }
        : selectedMask.assignedStepId
        ? (() => {
            const found = lithoSteps.find(({ step }) => step.id === selectedMask.assignedStepId);
            return found ? { ...found, variantName: undefined } : undefined;
          })()
        : undefined;

      setConflictPrompt({
        targetStepId,
        targetVariantId,
        targetVariantName: targetVariant?.name,
        targetStepTitle: stepItem?.step.title || 'Photolithography Step',
        targetStepIndex: stepItem ? stepItem.index + 1 : 1,
        conflictingMask,
        currentMask: selectedMask,
        currentMaskPriorStep: priorStepItem
          ? {
              id: priorStepItem.step.id,
              title: priorStepItem.step.title,
              index: priorStepItem.index + 1,
              variantName: priorStepItem.variantName,
            }
          : undefined,
      });
      return;
    }

    // No conflict: perform direct assignment
    const newFlow = assignMaskToStep(
      latestFlowRef.current,
      selectedMask.id,
      targetStepId,
      targetVariantId
    );
    commitTrackFlow(newFlow);
    setFeedbackNotice({
      message: `Assigned ${selectedMask.name} to Step ${stepItem ? stepItem.index + 1 : ''}: ${
        stepItem?.step.title || ''
      }${targetVariant ? ` (${targetVariant.name})` : ''}.`,
      type: 'success',
    });
    setTimeout(() => setFeedbackNotice(null), 3000);
  };

  const handleConfirmConflictSwap = () => {
    if (!conflictPrompt || !selectedMask) return;
    const {
      targetStepId,
      targetVariantId,
      targetVariantName,
      targetStepTitle,
      targetStepIndex,
      conflictingMask,
      currentMaskPriorStep,
    } = conflictPrompt;

    // Execute photomask swap
    const newFlow = swapMaskAssignments(
      latestFlowRef.current,
      selectedMask.id,
      targetStepId,
      targetVariantId
    );
    commitTrackFlow(newFlow);

    const targetLabel = `Step ${targetStepIndex}${
      targetVariantName ? ` · ${targetVariantName}` : ''
    } ("${targetStepTitle}")`;

    if (currentMaskPriorStep) {
      const priorLabel = `Step ${currentMaskPriorStep.index}${
        currentMaskPriorStep.variantName ? ` · ${currentMaskPriorStep.variantName}` : ''
      } ("${currentMaskPriorStep.title}")`;
      setFeedbackNotice({
        message: `Swapped masks: ${targetLabel} now uses "${selectedMask.name}", and ${priorLabel} now uses "${conflictingMask.name}".`,
        type: 'success',
      });
    } else {
      setFeedbackNotice({
        message: `Swapped mask on ${targetLabel}: now configured with "${selectedMask.name}". "${conflictingMask.name}" is now unassigned.`,
        type: 'success',
      });
    }
    setTimeout(() => setFeedbackNotice(null), 4500);
    setConflictPrompt(null);
  };

  const handleCancelConflictSwap = () => {
    setConflictPrompt(null);
  };

  const handleSwitchStepVariantInManager = (
    stepId: string,
    variantId: string,
    followMask: boolean = true
  ) => {
    const baseFlow = latestFlowRef.current;
    const targetStep = baseFlow.steps.find((s) => s.id === stepId);
    if (!targetStep) return;
    const switched = switchStepVariant(targetStep, variantId);
    let nextFlow: ProcessFlow = {
      ...baseFlow,
      steps: baseFlow.steps.map((s) => (s.id === stepId ? switched : s)),
    };
    if (switched.type === 'lithography') {
      nextFlow = {
        ...nextFlow,
        masks: (nextFlow.masks || []).map((m) => ({ ...m })),
      };
      // Sync only when active variant switched so its mask stays linked
      const activeMaskId = switched.lithography?.maskId;
      if (activeMaskId) {
        const existingMask = nextFlow.masks?.find((m) => m.id === activeMaskId);
        if (existingMask) {
          nextFlow = updateMaskAndSyncSteps(nextFlow, existingMask);
        }
      }
    }
    nextFlow = resolveFlowParameters(nextFlow);
    const targetMaskId = followMask ? switched.lithography?.maskId : undefined;
    commitTrackFlow(nextFlow, {
      nextSelectedMaskId: targetMaskId || selectedMaskId,
    });
    if (targetMaskId && (nextFlow.masks || []).some((m) => m.id === targetMaskId)) {
      setSelectedMaskId(targetMaskId);
    }
    const vName = switched.variants?.find((v) => v.id === variantId)?.name;
    if (vName) {
      handleEditorNotify(`Activated "${vName}" on ${targetStep.title}.`, 'success');
    }
  };

  const handleForkMaskForVariant = (stepId: string, variantId: string) => {
    if (!selectedMask) return;
    const { flow: forkedFlow, newMask } = forkMaskForStepVariant(
      latestFlowRef.current,
      selectedMask.id,
      stepId,
      variantId
    );
    if (!newMask) return;
    const resolved = resolveFlowParameters(forkedFlow);
    commitTrackFlow(resolved, { nextSelectedMaskId: newMask.id });
    setSelectedMaskId(newMask.id);
    handleEditorNotify(`Created dedicated reticle "${newMask.name}".`, 'success');
  };

  const handleBranchLithoStepInManager = (stepId: string) => {
    const baseFlow = latestFlowRef.current;
    const targetStep = baseFlow.steps.find((s) => s.id === stepId && s.type === 'lithography');
    if (!targetStep) return;
    const branched = createStepVariant(targetStep);
    const newActiveVar = getActiveStepVariant(branched);
    let nextFlow: ProcessFlow = {
      ...baseFlow,
      steps: baseFlow.steps.map((s) => (s.id === stepId ? branched : s)),
    };
    const sourceMaskId = branched.lithography?.maskId || selectedMask?.id;
    if (sourceMaskId && newActiveVar) {
      const { flow: forkedFlow, newMask } = forkMaskForStepVariant(
        nextFlow,
        sourceMaskId,
        stepId,
        newActiveVar.id
      );
      if (newMask) {
        const resolved = resolveFlowParameters(forkedFlow);
        commitTrackFlow(resolved, { nextSelectedMaskId: newMask.id });
        setSelectedMaskId(newMask.id);
        handleEditorNotify(
          `Branched "${newActiveVar.name}" with dedicated reticle "${newMask.name}".`,
          'success'
        );
        return;
      }
    }
    nextFlow = resolveFlowParameters(nextFlow);
    commitTrackFlow(nextFlow);
    if (newActiveVar) {
      handleEditorNotify(`Created variant "${newActiveVar.name}" on ${targetStep.title}.`, 'success');
    }
  };

  // Handler: Jump to assigned step
  const handleJumpToStep = () => {
    if (assignedStepInfo && onSelectStepIndex) {
      onSelectStepIndex(assignedStepInfo.index);
      onClose();
    }
  };

  const toggleWindowSelection = (winId: string, additive: boolean) => {
    if (additive) {
      setSelectedWindowIds((prev) =>
        prev.includes(winId) ? prev.filter((id) => id !== winId) : [...prev, winId]
      );
    } else {
      setSelectedWindowIds([winId]);
    }
  };

  // Aperture CRUD on selected mask
  const handleAddWindow = () => {
    if (!selectedMask) return;
    const windows = selectedMask.windows || [];
    // Default 1500 nm window in center or next available space
    const center = Math.round(waferWidth * 0.5);
    const newWin: MaskWindow = {
      id: `w_${Date.now()}`,
      xStart: Math.max(0, center - 750),
      xEnd: Math.min(waferWidth, center + 750),
    };
    const updated: PhotomaskLevel = {
      ...selectedMask,
      windows: [...windows, newWin],
    };
    handleUpdateMask(updated);
    setSelectedWindowIds([newWin.id]);
  };

  const handleRemoveWindow = (winId: string) => {
    if (!selectedMask) return;
    const updated: PhotomaskLevel = {
      ...selectedMask,
      windows: selectedMask.windows.filter((w) => w.id !== winId),
    };
    handleUpdateMask(updated);
    setSelectedWindowIds((prev) => prev.filter((id) => id !== winId));
    if (arraySourceWinId === winId) setArraySourceWinId(null);
  };

  const handleRemoveSelectedWindows = (ids: string[]) => {
    if (!selectedMask || ids.length === 0) return;
    const delSet = new Set(ids);
    handleUpdateMask({
      ...selectedMask,
      windows: selectedMask.windows.filter((w) => !delSet.has(w.id)),
    });
    setSelectedWindowIds([]);
    if (arraySourceWinId && delSet.has(arraySourceWinId)) {
      setArraySourceWinId(null);
    }
  };

  const handleToggleMaskAlignKey = () => {
    if (!selectedMask) return;
    const nextVal = !selectedMask.definesAlignmentMarks;
    handleUpdateMask({
      ...selectedMask,
      definesAlignmentMarks: nextVal ? true : undefined,
    });
  };

  const handleToggleWindowAlignKey = (winId: string) => {
    if (!selectedMask) return;
    handleUpdateMask({
      ...selectedMask,
      windows: selectedMask.windows.map((w) =>
        w.id === winId ? { ...w, isAlignKey: w.isAlignKey ? undefined : true } : w
      ),
    });
  };

  const handleToggleSelectedAlignKeys = (ids: string[]) => {
    if (!selectedMask || ids.length === 0) return;
    const idSet = new Set(ids);
    const allMarked = selectedMask.windows
      .filter((w) => idSet.has(w.id))
      .every((w) => Boolean(w.isAlignKey));
    const nextVal = allMarked ? undefined : true;
    handleUpdateMask({
      ...selectedMask,
      windows: selectedMask.windows.map((w) =>
        idSet.has(w.id) ? { ...w, isAlignKey: nextVal } : w
      ),
    });
  };

  const handleDeriveAlignMarks = (overrideSelectedIds?: string[]) => {
    if (!selectedMask || selectedMask.windows.length === 0) return;
    const activeIds = overrideSelectedIds ?? selectedWindowIds;
    const selectedWins =
      activeIds.length > 0
        ? selectedMask.windows.filter((w) => activeIds.includes(w.id))
        : [];
    const primaryLink =
      selectedMaskLinks.find((l) => l.isActiveVariant) || selectedMaskLinks[0];
    const targetStep = primaryLink?.step || assignedStepInfo?.step;
    const { marks, addedCount, derivedCenterXNm } =
      deriveGlobalAlignmentMarkFromSelection({
        existingMarks: latestFlowRef.current.alignmentMarks || [],
        selectedWindows: selectedWins,
        allWindows: selectedMask.windows,
        waferWidth,
        side: targetStep?.side || 'front',
        definedByStepId: targetStep?.id,
      });

    const updatedMask: PhotomaskLevel = selectedMask.definesAlignmentMarks
      ? selectedMask
      : { ...selectedMask, definesAlignmentMarks: true };
    const syncedFlow = updateMaskAndSyncSteps(latestFlowRef.current, updatedMask);
    const nextFlow: ProcessFlow = resolveFlowParameters({
      ...syncedFlow,
      alignmentMarks: marks,
    });
    commitTrackFlow(nextFlow);

    if (selectedWins.length > 0 && derivedCenterXNm !== undefined) {
      const coordTxt = formatCoordDisplay(derivedCenterXNm, apertureUnit, 2);
      if (addedCount > 0) {
        handleEditorNotify(
          selectedWins.length > 1
            ? `Placed 1 alignment mark centered at ${coordTxt} across ${selectedWins.length} selected shapes.`
            : `Placed alignment mark centered at ${coordTxt}.`,
          'success'
        );
      } else {
        handleEditorNotify(
          `Alignment mark already exists at ${coordTxt}.`,
          'warn'
        );
      }
    } else if (addedCount > 0) {
      handleEditorNotify(
        `Derived ${addedCount} substrate alignment ${addedCount === 1 ? 'mark' : 'marks'} from "${selectedMask.name}".`,
        'success'
      );
    } else {
      handleEditorNotify('No new alignment marks derived.', 'warn');
    }
  };

  const handleDuplicateWindow = (winId: string) => {
    if (!selectedMask) return;
    const idx = selectedMask.windows.findIndex((w) => w.id === winId);
    if (idx < 0) return;
    const dup = duplicateMaskWindow(selectedMask.windows[idx], waferWidth);
    const updatedWins = [
      ...selectedMask.windows.slice(0, idx + 1),
      dup,
      ...selectedMask.windows.slice(idx + 1),
    ];
    handleUpdateMask({
      ...selectedMask,
      windows: updatedWins,
    });
    setSelectedWindowIds([dup.id]);
    setArraySourceWinId(null);
  };

  const handleDuplicateSelectedWindows = (ids: string[]) => {
    if (!selectedMask || ids.length === 0) return;
    if (ids.length === 1) {
      handleDuplicateWindow(ids[0]);
      return;
    }
    const selSet = new Set(ids);
    const newIds: string[] = [];
    const clones: MaskWindow[] = [];
    const baseTs = Date.now();
    selectedMask.windows.forEach((w, idx) => {
      if (!selSet.has(w.id)) return;
      const dup = {
        ...duplicateMaskWindow(w, waferWidth),
        id: `w_dup_${baseTs}_${idx}`,
      };
      clones.push(dup);
      newIds.push(dup.id);
    });
    handleUpdateMask({
      ...selectedMask,
      windows: [...selectedMask.windows, ...clones],
    });
    setSelectedWindowIds(newIds);
    setArraySourceWinId(null);
  };

  const handleShiftWindows = (ids: string[], deltaNm: number) => {
    if (!selectedMask || ids.length === 0 || deltaNm === 0) return;
    const targets = selectedMask.windows.filter((w) => ids.includes(w.id));
    if (targets.length === 0) return;
    const minDelta = -Math.min(...targets.map((w) => w.xStart));
    const maxDelta = Math.min(...targets.map((w) => waferWidth - w.xEnd));
    const clampedDelta = Math.round(Math.max(minDelta, Math.min(maxDelta, deltaNm)));
    if (clampedDelta === 0) return;
    const selSet = new Set(targets.map((w) => w.id));
    handleUpdateMask({
      ...selectedMask,
      windows: selectedMask.windows.map((w) =>
        selSet.has(w.id)
          ? { ...w, xStart: w.xStart + clampedDelta, xEnd: w.xEnd + clampedDelta }
          : w
      ),
    });
  };

  const handleCreateWindowArray = (sourceId: string, options: MaskWindowArrayOptions) => {
    if (!selectedMask) return;
    const res = createMaskWindowArray(selectedMask.windows, sourceId, options, waferWidth);
    handleUpdateMask({
      ...selectedMask,
      windows: res.windows,
    });
    setSelectedWindowIds(
      res.addedIds.length > 0 ? [res.addedIds[res.addedIds.length - 1]] : [sourceId]
    );
    setArraySourceWinId(null);
  };

  const handleUpdateWindowCoord = (winId: string, field: 'xStart' | 'xEnd', val: number) => {
    if (!selectedMask || !Number.isFinite(val)) return;
    const clamped = Math.max(0, Math.min(waferWidth, Math.round(val)));
    const updatedWins = selectedMask.windows.map((w) => {
      if (w.id === winId) {
        if (w.paramBindings?.[field]) return w;
        const u = { ...w, [field]: clamped };
        if (u.xStart > u.xEnd) {
          if (field === 'xStart') u.xEnd = u.xStart;
          else u.xStart = u.xEnd;
        }
        return u;
      }
      return w;
    });
    handleUpdateMask({
      ...selectedMask,
      windows: updatedWins,
    });
  };

  const handleUpdateWindowWidth = (winId: string, targetWidthNm: number) => {
    if (!selectedMask || !Number.isFinite(targetWidthNm)) return;
    const clampedWidth = Math.max(10, Math.min(waferWidth, Math.round(targetWidthNm)));
    const updatedWins = selectedMask.windows.map((w) => {
      if (w.id !== winId || w.paramBindings?.width) return w;
      const center = (w.xStart + w.xEnd) / 2;
      let nextStart = center - clampedWidth / 2;
      let nextEnd = center + clampedWidth / 2;
      if (nextStart < 0) {
        nextStart = 0;
        nextEnd = Math.min(waferWidth, clampedWidth);
      } else if (nextEnd > waferWidth) {
        nextEnd = waferWidth;
        nextStart = Math.max(0, waferWidth - clampedWidth);
      }
      return {
        ...w,
        xStart: Math.round(nextStart),
        xEnd: Math.round(nextEnd),
      };
    });
    handleUpdateMask({
      ...selectedMask,
      windows: updatedWins,
    });
  };

  const handleUpdateWindowBinding = (
    winId: string,
    field: 'width' | 'xStart' | 'xEnd',
    expr: string | undefined
  ) => {
    if (!selectedMask) return;
    const updatedWins = selectedMask.windows.map((w) => {
      if (w.id !== winId) return w;
      const nextB = { ...(w.paramBindings || {}) };
      if (expr && expr.trim()) {
        nextB[field] = expr.trim();
      } else {
        delete nextB[field];
      }
      return {
        ...w,
        paramBindings: Object.keys(nextB).length > 0 ? nextB : undefined,
      };
    });
    handleUpdateMask({
      ...selectedMask,
      windows: updatedWins,
    });
  };

  const handleCreateAndBindWindowVar = (
    winId: string,
    field: 'width' | 'xStart' | 'xEnd',
    name: string,
    value: number,
    unit: VariableUnit,
    description?: string
  ) => {
    if (!selectedMask) return;
    const newVar = {
      id: `var_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name,
      value,
      unit,
      description,
    };
    const updatedWins = selectedMask.windows.map((w) => {
      if (w.id !== winId) return w;
      return {
        ...w,
        paramBindings: { ...(w.paramBindings || {}), [field]: name },
      };
    });
    const updatedMask: PhotomaskLevel = {
      ...selectedMask,
      windows: updatedWins,
    };
    const flowWithVar: ProcessFlow = {
      ...latestFlowRef.current,
      variables: [...(latestFlowRef.current.variables || []), newVar],
    };
    commitTrackFlow(resolveFlowParameters(updateMaskAndSyncSteps(flowWithVar, updatedMask)));
  };

  // Preset aperture patterns
  const handleApplyPreset = (type: 'center-slit' | 'dual-pad' | 'grating' | 'invert') => {
    if (!selectedMask) return;
    let newWindows: MaskWindow[] = [];

    if (type === 'center-slit') {
      const w = Math.round(waferWidth * 0.2);
      newWindows = [
        {
          id: `w_cs_${Date.now()}`,
          xStart: Math.round(waferWidth * 0.4),
          xEnd: Math.round(waferWidth * 0.4) + w,
        },
      ];
    } else if (type === 'dual-pad') {
      const w = Math.round(waferWidth * 0.18);
      newWindows = [
        { id: `w_dp1_${Date.now()}`, xStart: Math.round(waferWidth * 0.15), xEnd: Math.round(waferWidth * 0.15) + w },
        { id: `w_dp2_${Date.now()}`, xStart: Math.round(waferWidth * 0.67), xEnd: Math.round(waferWidth * 0.67) + w },
      ];
    } else if (type === 'grating') {
      // 3 periodic slits
      const slitW = Math.round(waferWidth * 0.1);
      const pitch = Math.round(waferWidth * 0.2);
      const startBase = Math.round(waferWidth * 0.25);
      newWindows = [
        { id: `w_g1_${Date.now()}`, xStart: startBase, xEnd: startBase + slitW },
        { id: `w_g2_${Date.now()}`, xStart: startBase + pitch, xEnd: startBase + pitch + slitW },
        { id: `w_g3_${Date.now()}`, xStart: startBase + pitch * 2, xEnd: startBase + pitch * 2 + slitW },
      ];
    } else if (type === 'invert') {
      // Invert current windows (clear becomes chrome, chrome becomes clear)
      const sorted = [...selectedMask.windows].sort((a, b) => a.xStart - b.xStart);
      let currX = 0;
      let counter = 0;
      for (const w of sorted) {
        if (w.xStart > currX) {
          newWindows.push({ id: `w_inv_${Date.now()}_${counter++}`, xStart: currX, xEnd: w.xStart });
        }
        currX = Math.max(currX, w.xEnd);
      }
      if (currX < waferWidth) {
        newWindows.push({ id: `w_inv_${Date.now()}_${counter++}`, xStart: currX, xEnd: waferWidth });
      }
    }

    handleUpdateMask({
      ...selectedMask,
      windows: newWindows,
    });
  };

  // Track background marquee drag start
  const handleTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !trackRef.current) return;
    trackRef.current.focus({ preventScroll: true });
    const rect = trackRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const nm = Math.max(
      0,
      Math.min(waferWidth, ((e.clientX - rect.left) / rect.width) * waferWidth)
    );
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    setTrackMarquee({
      startClientX: e.clientX,
      startNm: nm,
      currentNm: nm,
      additive: e.shiftKey || e.ctrlKey || e.metaKey,
    });
  };

  // Pointer drag logic for interactive aperture track
  const handlePointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    win: MaskWindow,
    type: 'resize-start' | 'resize-end' | 'move'
  ) => {
    e.preventDefault();
    e.stopPropagation();
    flushKeyboardNudge();
    trackRef.current?.focus({ preventScroll: true });

    const isAdditive = e.shiftKey || e.ctrlKey || e.metaKey;
    const wins = selectedMask?.windows || [];
    if (type === 'move' && isAdditive) {
      if (selectedWindowIds.includes(win.id)) {
        setSelectedWindowIds((prev) => prev.filter((id) => id !== win.id));
        return;
      }
      const nextIds = [...selectedWindowIds, win.id];
      setSelectedWindowIds(nextIds);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      const nextSet = new Set(nextIds);
      const targets = wins
        .filter((w) => nextSet.has(w.id))
        .map((w) => ({ id: w.id, xStart: w.xStart, xEnd: w.xEnd }));
      dragStartSnapRef.current = makeTrackSnapshot(latestFlowRef.current, latestSelectedMaskIdRef.current);
      lastDragSigRef.current = wins.map((w) => `${w.xStart}:${w.xEnd}`).join('|');
      pendingDragWindowsRef.current = null;
      liveWindowsRef.current = null;
      lastSimSyncTsRef.current = 0;
      setDragState({
        winId: win.id,
        type,
        startClientX: e.clientX,
        initialXStart: win.xStart,
        initialXEnd: win.xEnd,
        initialWindows: targets,
      });
      return;
    }

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    let moveTargets: Array<{ id: string; xStart: number; xEnd: number }>;
    if (type === 'move' && selectedWindowIds.includes(win.id)) {
      const selSet = new Set(selectedWindowIds);
      moveTargets = wins
        .filter((w) => selSet.has(w.id))
        .map((w) => ({ id: w.id, xStart: w.xStart, xEnd: w.xEnd }));
    } else {
      setSelectedWindowIds([win.id]);
      moveTargets = [{ id: win.id, xStart: win.xStart, xEnd: win.xEnd }];
    }

    dragStartSnapRef.current = makeTrackSnapshot(latestFlowRef.current, latestSelectedMaskIdRef.current);
    lastDragSigRef.current = wins.map((w) => `${w.xStart}:${w.xEnd}`).join('|');
    pendingDragWindowsRef.current = null;
    liveWindowsRef.current = null;
    lastSimSyncTsRef.current = 0;
    setDragState({
      winId: win.id,
      type,
      startClientX: e.clientX,
      initialXStart: win.xStart,
      initialXEnd: win.xEnd,
      initialWindows: moveTargets,
    });
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (trackMarquee && trackRef.current) {
      const rect = trackRef.current.getBoundingClientRect();
      if (rect.width > 0) {
        const nm = Math.max(
          0,
          Math.min(waferWidth, ((e.clientX - rect.left) / rect.width) * waferWidth)
        );
        if (Math.round(nm) !== Math.round(trackMarquee.currentNm)) {
          setTrackMarquee((prev) => (prev ? { ...prev, currentNm: nm } : null));
        }
      }
      return;
    }

    if (!dragState || !trackRef.current || !selectedMask) return;

    const rect = trackRef.current.getBoundingClientRect();
    const trackWidthPx = rect.width;
    if (trackWidthPx <= 0) return;

    const deltaPx = e.clientX - dragState.startClientX;
    const nmPerPixel = waferWidth / trackWidthPx;
    const deltaNm = deltaPx * nmPerPixel;

    // Snap to 50 nm increments
    const snapTo = (val: number) => Math.round(val / 50) * 50;
    const currentSelMask =
      (latestFlowRef.current.masks || []).find((m) => m.id === selectedMask.id) || selectedMask;
    const baseWins = currentSelMask.windows;

    let updatedWins = baseWins;
    if (dragState.type === 'move') {
      const targets =
        dragState.initialWindows && dragState.initialWindows.length > 0
          ? dragState.initialWindows
          : [{ id: dragState.winId, xStart: dragState.initialXStart, xEnd: dragState.initialXEnd }];
      const snappedDelta = snapTo(deltaNm);
      const minDelta = -Math.min(...targets.map((t) => t.xStart));
      const maxDelta = Math.min(...targets.map((t) => waferWidth - t.xEnd));
      const clampedDelta = Math.max(minDelta, Math.min(maxDelta, snappedDelta));
      const byId = new Map(
        targets.map((t) => [t.id, { xStart: t.xStart + clampedDelta, xEnd: t.xEnd + clampedDelta }])
      );
      updatedWins = baseWins.map((w) => {
        const next = byId.get(w.id);
        return next ? { ...w, xStart: next.xStart, xEnd: next.xEnd } : w;
      });
    } else {
      updatedWins = baseWins.map((w) => {
        if (w.id !== dragState.winId) return w;

        if (dragState.type === 'resize-start') {
          let newStart = snapTo(dragState.initialXStart + deltaNm);
          newStart = Math.max(0, Math.min(dragState.initialXEnd - 50, newStart));
          return { ...w, xStart: newStart };
        }

        if (dragState.type === 'resize-end') {
          let newEnd = snapTo(dragState.initialXEnd + deltaNm);
          newEnd = Math.min(waferWidth, Math.max(dragState.initialXStart + 50, newEnd));
          return { ...w, xEnd: newEnd };
        }

        return w;
      });
    }

    const sig = updatedWins.map((w) => `${w.xStart}:${w.xEnd}`).join('|');
    if (sig === lastDragSigRef.current) return;
    lastDragSigRef.current = sig;

    liveWindowsRef.current = updatedWins;
    pendingDragWindowsRef.current = updatedWins;
    setDragPreviewWindows(updatedWins);

    scheduleWindowsSync();
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (trackMarquee && selectedMask) {
      const distPx = Math.abs(e.clientX - trackMarquee.startClientX);
      if (distPx >= 4) {
        const minNm = Math.min(trackMarquee.startNm, trackMarquee.currentNm);
        const maxNm = Math.max(trackMarquee.startNm, trackMarquee.currentNm);
        const hitIds = selectedMask.windows
          .filter((w) => w.xEnd >= minNm && w.xStart <= maxNm)
          .map((w) => w.id);
        if (trackMarquee.additive) {
          setSelectedWindowIds((prev) => Array.from(new Set([...prev, ...hitIds])));
        } else {
          setSelectedWindowIds(hitIds);
        }
      } else if (!trackMarquee.additive) {
        setSelectedWindowIds([]);
      }
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      setTrackMarquee(null);
      return;
    }

    if (dragState) {
      cancelPendingDragSync();
      const pendingWins = pendingDragWindowsRef.current;
      const liveWins = liveWindowsRef.current;
      pendingDragWindowsRef.current = null;
      liveWindowsRef.current = null;
      const finalWins = pendingWins ?? liveWins;
      const activeMask =
        (latestFlowRef.current.masks || []).find((m) => m.id === latestSelectedMaskIdRef.current) ||
        selectedMask;
      let finalFlow = latestFlowRef.current;
      if (finalWins && activeMask) {
        finalFlow = updateMaskAndSyncSteps(latestFlowRef.current, {
          ...activeMask,
          windows: finalWins,
        });
        if (pendingWins) {
          commitTrackFlow(finalFlow, { skipHistory: true });
        }
      }
      if (dragStartSnapRef.current) {
        const startSnap = dragStartSnapRef.current;
        dragStartSnapRef.current = null;
        const currSnap = makeTrackSnapshot(finalFlow, latestSelectedMaskIdRef.current);
        if (!trackSnapshotsEqual(startSnap, currSnap)) {
          undoStackRef.current = [
            ...undoStackRef.current.slice(-(MAX_HISTORY - 1)),
            startSnap,
          ];
          redoStackRef.current = [];
          syncHistoryState();
        }
      }
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      setDragPreviewWindows(null);
      setDragState(null);
    }
  };

  const renderReticleSidebarContent = () => {
    const getMaskAssignedStep = (mask: PhotomaskLevel) => {
      const links = getMaskVariantLinks(flow, mask);
      if (links.length > 0) {
        const primary = links.find((l) => l.isActiveVariant) || links[0];
        return {
          step: primary.step,
          index: primary.stepIndex,
          links,
        };
      }
      const fallback = mask.assignedStepId
        ? lithoSteps.find(({ step }) => step.id === mask.assignedStepId) || null
        : lithoSteps.find(({ step }) => step.lithography?.maskId === mask.id) || null;
      return fallback ? { ...fallback, links: [] } : null;
    };

    const assignedFilteredMasks = filteredMasks
      .filter((mask) => isMaskAssigned(mask))
      .sort((a, b) => {
        const sa = getMaskAssignedStep(a)?.index ?? Number.MAX_SAFE_INTEGER;
        const sb = getMaskAssignedStep(b)?.index ?? Number.MAX_SAFE_INTEGER;
        return sa - sb;
      });
    const unassignedFilteredMasks = filteredMasks.filter((mask) => !isMaskAssigned(mask));

    const renderMaskCard = (mask: PhotomaskLevel, idx: number) => {
      const isSelected = selectedMask?.id === mask.id;
      const assigned = getMaskAssignedStep(mask);
      const mMetrics = calculateMaskMetrics(mask, waferWidth);
      const isAssigned = isMaskAssigned(mask);
      const links = assigned?.links || [];
      const hasAnyActiveLink = links.some((l) => l.isActiveVariant);
      const isSharedAcrossVariants = links.length > 1;
      const singleVariantLink = links.length === 1 ? links[0].variant : null;

      return (
        <div
          key={mask.id}
          onClick={() => {
            setSelectedMaskId(mask.id);
            setMobileReticleDrawerOpen(false);
          }}
          className={`group relative px-2 py-1.5 rounded-lg border transition-colors cursor-pointer ${
            isSelected
              ? 'bg-sky-950/35 border-sky-500/80'
              : 'bg-slate-950/70 border-slate-800 hover:border-slate-700 hover:bg-slate-950'
          }`}
        >
          {/* Header: Level Tag & Name */}
          <div className="flex items-center justify-between gap-1 mb-1">
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: mask.color || RETICLE_PALETTE[idx % RETICLE_PALETTE.length] }}
              />
              <span className="font-mono text-[10.5px] font-semibold text-slate-400 shrink-0">
                {mask.layerCode || `L${idx + 1}`}
              </span>
              <span className="text-[11.5px] font-semibold text-slate-200 truncate group-hover:text-sky-300 transition-colors">
                {mask.name}
              </span>
              {(mask.definesAlignmentMarks || mask.windows.some((w) => w.isAlignKey)) && (
                <span
                  className="inline-flex items-center gap-0.5 px-1 py-0 rounded-xs bg-cyan-500/15 border border-cyan-500/40 text-[9px] font-mono font-semibold text-cyan-300 shrink-0"
                  title="Defines alignment key marks"
                >
                  <Crosshair className="w-2.5 h-2.5" />
                </span>
              )}
            </div>

            {/* Duplicate & Clear Track (Assigned) / Delete (Unassigned) actions */}
            <div className="flex items-center gap-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity shrink-0">
              <button
                onClick={(e) => handleDuplicateMask(mask, e)}
                className="p-0.5 rounded text-slate-400 hover:text-white hover:bg-slate-800"
                title="Duplicate Mask Level"
              >
                <Copy className="w-3 h-3" />
              </button>
              {isAssigned ? (
                <button
                  onClick={(e) => handleClearApertureTrack(mask, e)}
                  disabled={mask.windows.length === 0}
                  className="p-0.5 rounded text-amber-400 hover:text-amber-300 hover:bg-amber-950/30 disabled:opacity-30 disabled:pointer-events-none"
                  title={
                    mask.windows.length === 0
                      ? 'Aperture track is already clear (assigned masks cannot be deleted)'
                      : 'Clear aperture track (assigned mask levels cannot be deleted)'
                  }
                >
                  <Eraser className="w-3 h-3" />
                </button>
              ) : (
                <button
                  onClick={(e) => handleDeleteMask(mask.id, e)}
                  className="p-0.5 rounded text-rose-400 hover:text-rose-300 hover:bg-rose-950/30"
                  title="Delete Unassigned Mask Level"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Miniature Reticle Track Strip */}
          {(() => {
            const isLF = mask.maskField === 'light-field';
            return (
              <div
                className={`h-1.5 w-full rounded overflow-hidden border relative mb-1 ${
                  isLF
                    ? 'bg-sky-200/35 border-sky-400/40'
                    : 'bg-slate-900 border-slate-800'
                }`}
              >
                {mask.windows.map((w, wIdx) => {
                  const leftPct = (w.xStart / waferWidth) * 100;
                  const widthPct = ((w.xEnd - w.xStart) / waferWidth) * 100;
                  return (
                    <div
                      key={w.id || `mini_${wIdx}`}
                      className={`absolute top-0 bottom-0 ${
                        isLF ? 'border-x border-slate-300/80' : ''
                      }`}
                      style={{
                        left: `${leftPct}%`,
                        width: `${Math.max(1, widthPct)}%`,
                        backgroundColor: isLF ? '#0f172a' : mask.color || '#38bdf8',
                      }}
                    />
                  );
                })}
              </div>
            );
          })()}

          {/* Compact Metadata & Assigned Step */}
          <div className="flex items-center justify-between gap-1.5 text-[10px] font-mono tabular-nums text-slate-400">
            <div className="flex items-center gap-1 min-w-0 truncate">
              <span className={mMetrics.isLightField ? 'text-sky-300 font-semibold' : 'text-slate-300 font-semibold'}>
                {mMetrics.isLightField ? 'LF' : 'DF'}
              </span>
              <span>·</span>
              <span>{mask.polarity === 'negative' ? 'Neg' : 'Pos'}</span>
              <span>·</span>
              <span>{mMetrics.apertureCount}f</span>
              <span>·</span>
              <span className="text-amber-400/90">{mMetrics.clearPercentage}%</span>
            </div>

            <div className="flex items-center gap-1 min-w-0 shrink">
              {assigned ? (
                <>
                  <span
                    className={`truncate font-sans ${
                      hasAnyActiveLink ? 'text-sky-400' : 'text-slate-400'
                    }`}
                    title={`Step ${assigned.index + 1}: ${assigned.step.title}`}
                  >
                    S{assigned.index + 1}: {assigned.step.title}
                  </span>
                  {isSharedAcrossVariants ? (
                    <span className="inline-flex items-center gap-0.5 text-[9.5px] font-mono text-violet-300 shrink-0">
                      <GitBranch className="w-2.5 h-2.5" />
                      <span>{links.length}v</span>
                    </span>
                  ) : singleVariantLink ? (
                    <span
                      className={`inline-flex items-center gap-0.5 text-[9.5px] font-mono shrink-0 max-w-[68px] truncate ${
                        hasAnyActiveLink ? 'text-violet-300' : 'text-slate-500'
                      }`}
                      title={
                        hasAnyActiveLink
                          ? `Active variant: ${singleVariantLink.name}`
                          : `Inactive variant: ${singleVariantLink.name}`
                      }
                    >
                      <GitBranch className="w-2.5 h-2.5 shrink-0" />
                      <span className="truncate">{singleVariantLink.name}</span>
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="text-amber-400/75 font-sans italic text-[10px]">
                  Unassigned
                </span>
              )}
            </div>
          </div>
        </div>
      );
    };

    return (
      <>
        {/* Search Bar */}
        <div className="p-2 border-b border-slate-800">
          <div className="relative">
            <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-slate-500" />
            <input
              type="text"
              placeholder="Search mask levels..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500"
            />
          </div>
        </div>

        {/* Mask Level Cards List: Assigned (Top) & Unassigned (Bottom) */}
        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {filteredMasks.length > 0 ? (
            <>
              <div className="space-y-1">
                <div className="flex items-center justify-between px-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-sky-400 flex items-center gap-1">
                    <Check className="w-3 h-3" />
                    <span>Assigned ({assignedFilteredMasks.length})</span>
                  </span>
                </div>
                {assignedFilteredMasks.length > 0 ? (
                  <div className="space-y-1.5">
                    {assignedFilteredMasks.map((mask, i) => renderMaskCard(mask, i))}
                  </div>
                ) : (
                  <div className="px-2.5 py-1.5 rounded-lg border border-dashed border-slate-800 text-[11px] text-slate-500 italic">
                    No assigned masks{searchQuery.trim() ? ' match your search' : ''}.
                  </div>
                )}
              </div>

              <div className="pt-2 border-t border-slate-800/80 space-y-1">
                <div className="flex items-center justify-between px-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">
                    Unassigned ({unassignedFilteredMasks.length})
                  </span>
                </div>
                {unassignedFilteredMasks.length > 0 ? (
                  <div className="space-y-1.5">
                    {unassignedFilteredMasks.map((mask, i) =>
                      renderMaskCard(mask, assignedFilteredMasks.length + i)
                    )}
                  </div>
                ) : (
                  <div className="px-2.5 py-1.5 rounded-lg border border-dashed border-slate-800 text-[11px] text-slate-500 italic">
                    No unassigned masks{searchQuery.trim() ? ' match your search' : ''}.
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="p-4 text-center text-slate-500 text-xs">
              {masks.length === 0
                ? 'No mask levels defined yet. Click "+ Add Mask" below.'
                : 'No mask levels match your search.'}
            </div>
          )}
        </div>

        {/* Sidebar Bottom summary */}
        <div className="px-2.5 py-2 border-t border-slate-800 bg-slate-950/80 text-[11px] text-slate-400 flex items-center justify-between gap-2">
          <span className="font-mono tabular-nums">{masks.length} Reticles</span>
          <div className="flex items-center gap-2.5">
            {onOpenImportMasks && (
              <button
                type="button"
                onClick={onOpenImportMasks}
                className="inline-flex items-center gap-1 text-emerald-400 hover:text-emerald-300 font-medium hover:underline text-[11px]"
                title="Import masks from another process flow as unassigned reticles"
              >
                <FileInput className="w-3 h-3" />
                <span>Import</span>
              </button>
            )}
            <button
              onClick={handleCreateNewMask}
              className="text-sky-400 hover:text-sky-300 font-medium hover:underline text-[11px]"
            >
              + Add Mask
            </button>
          </div>
        </div>
      </>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4 bg-slate-950/80 backdrop-blur-md">
      <div
        className={`relative flex flex-col w-full bg-slate-950 border-0 sm:border sm:border-slate-800 rounded-none sm:rounded-2xl shadow-2xl overflow-hidden text-slate-100 animate-in fade-in zoom-in-95 duration-150 ${
          showSelectedMaskInset || showFinalStepInset
            ? 'max-w-[92rem] h-[100dvh] sm:h-[94vh] sm:max-h-[900px]'
            : editorTab === 'gds'
              ? 'max-w-7xl h-[100dvh] sm:h-[94vh] sm:max-h-[900px]'
              : 'max-w-6xl h-[100dvh] sm:h-[92vh] sm:max-h-[850px]'
        }`}
      >
        {/* Top Header */}
        <div className="px-2.5 py-1.5 sm:px-4 sm:py-2 bg-slate-900 border-b border-slate-800 shrink-0 space-y-1.5 lg:space-y-0 lg:flex lg:items-center lg:justify-between lg:gap-3">
          {/* Row 1: Title + New + Close */}
          <div className="flex items-center justify-between gap-2 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg bg-gradient-to-tr from-sky-600 to-indigo-600 flex items-center justify-center text-white shadow-sm shrink-0">
                <Scan className="w-3.5 h-3.5" />
              </span>
              <div className="flex items-center gap-2 min-w-0">
                <h2 className="text-xs sm:text-sm font-bold text-white tracking-tight truncate">
                  Photolithography Mask Levels
                </h2>
                <span className="text-[11px] font-mono tabular-nums text-slate-400 shrink-0">
                  · {masks.length}
                  <span className="hidden sm:inline"> {masks.length === 1 ? 'Reticle' : 'Reticles'}</span>
                </span>
              </div>
            </div>

            {/* Mobile/Tablet Quick Close & New Mask Row 1 */}
            <div className="flex lg:hidden items-center gap-1.5 shrink-0">
              <button
                onClick={handleCreateNewMask}
                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-semibold shadow-sm active:scale-95"
              >
                <Plus className="w-3 h-3" />
                <span className="hidden sm:inline">New Mask</span>
                <span className="sm:hidden">New</span>
              </button>
              {onOpenHelp && (
                <button
                  type="button"
                  onClick={onOpenHelp}
                  className="p-1 rounded-lg text-slate-400 hover:text-sky-300 hover:bg-slate-800 transition-colors"
                  title="Help: Mask Levels, Aligned Stack & 2D GDS"
                  aria-label="Help for Mask Levels"
                >
                  <HelpCircle className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={onClose}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                title="Close Mask Levels Panel"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>
          </div>

          {/* Row 2 on <lg (compact reticle dropdown trigger + segmented switcher), Inline on lg+ */}
          <div className="flex items-center justify-between lg:justify-end gap-1.5 sm:gap-2 shrink-0 flex-wrap">
            {/* Mobile / Tablet Active Reticle Selector Trigger */}
            <button
              type="button"
              onClick={() => setMobileReticleDrawerOpen(true)}
              className="lg:hidden flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-700 text-xs font-medium text-slate-200 transition-colors min-w-0 flex-1 max-w-[55%]"
              title="Switch Reticle Level"
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: selectedMask?.color || '#38bdf8' }}
              />
              <span className="truncate font-mono text-[11px]">
                {selectedMask ? `${selectedMask.layerCode ? selectedMask.layerCode + ' · ' : ''}${selectedMask.name}` : 'Select Reticle'}
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0 ml-auto" />
            </button>

            {/* Workspace Mode Switcher */}
            <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-0.5 text-[11px] shrink-0">
              <button
                type="button"
                onClick={() => setEditorTab('apertures')}
                className={`flex items-center gap-1 px-2 py-1 rounded-md font-medium transition-colors ${
                  editorTab === 'apertures'
                    ? 'bg-sky-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Sliders className="w-3 h-3" />
                <span>1D Track</span>
              </button>
              <button
                type="button"
                onClick={() => setEditorTab('stack')}
                className={`flex items-center gap-1 px-2 py-1 rounded-md font-medium transition-colors ${
                  editorTab === 'stack'
                    ? 'bg-sky-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="View and align all photomask levels stacked vertically over one shared X axis"
              >
                <Layers className="w-3 h-3" />
                <span>Aligned Stack</span>
              </button>
              <button
                type="button"
                onClick={() => setEditorTab('gds')}
                className={`flex items-center gap-1 px-2 py-1 rounded-md font-medium transition-colors ${
                  editorTab === 'gds'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <LayoutGrid className="w-3 h-3" />
                <span>2D GDS</span>
              </button>
            </div>

            {/* Right-Side Cross-Section Panel Toggles (Selected Mask & Final) */}
            <div
              className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-0.5 text-[11px] shrink-0"
              title="Toggle right-side cross-section previews for Selected Mask and Final wafer"
            >
              <span className="hidden xl:inline-flex items-center gap-1 pl-1.5 pr-1 text-[10px] font-medium text-slate-400">
                <PanelRight className="w-3 h-3 text-slate-400" />
                <span>X-Sec:</span>
              </span>
              <button
                type="button"
                onClick={() => setShowSelectedMaskInset((v) => !v)}
                className={`flex items-center gap-1 px-2 py-1 rounded-md font-medium transition-colors ${
                  showSelectedMaskInset
                    ? 'bg-sky-600/90 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/70'
                }`}
                title={
                  assignedStepInfo
                    ? `Toggle Selected Mask Cross-Section (Step ${assignedStepInfo.index + 1}/${flow.steps.length} — ${selectedMask?.name || 'Reticle'})`
                    : 'Toggle Selected Mask Cross-Section'
                }
              >
                <PanelRight className="w-3 h-3 xl:hidden" />
                <span>Selected</span>
              </button>
              <button
                type="button"
                onClick={() => setShowFinalStepInset((v) => !v)}
                className={`flex items-center gap-1 px-2 py-1 rounded-md font-medium transition-colors ${
                  showFinalStepInset
                    ? 'bg-emerald-600/90 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/70'
                }`}
                title={
                  finalEnabledStepIndex >= 0
                    ? `Toggle Final Step Cross-Section (Step ${finalEnabledStepIndex + 1}/${flow.steps.length})`
                    : 'Toggle Final Step Cross-Section (Substrate)'
                }
              >
                <span>Final</span>
              </button>
            </div>

            {/* Desktop Masks List Toggle + Variables + New + Close */}
            <div className="hidden lg:flex items-center gap-1.5 shrink-0">
              {onOpenVariablesModal && (
                <button
                  type="button"
                  onClick={onOpenVariablesModal}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-700 bg-slate-950 hover:bg-slate-800 hover:border-violet-500/40 text-[11px] font-medium text-violet-300 transition-colors"
                  title="Define & edit parametric design variables"
                >
                  <VariableIcon className="w-3 h-3" />
                  <span>Vars</span>
                  {variables.length > 0 && (
                    <span className="font-mono text-[10px] text-violet-200 tabular-nums">
                      ({variables.length})
                    </span>
                  )}
                </button>
              )}

              <button
                type="button"
                onClick={() => setDesktopMasksSidebarOpen((v) => !v)}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-medium transition-colors ${
                  desktopMasksSidebarOpen
                    ? 'bg-slate-800 border-slate-700 text-sky-300 hover:bg-slate-700'
                    : 'bg-slate-950 border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800'
                }`}
                title={desktopMasksSidebarOpen ? 'Hide Masks List' : 'Show Masks List'}
              >
                <PanelLeft className="w-3 h-3" />
                <span>{desktopMasksSidebarOpen ? 'Hide' : 'Masks'}</span>
              </button>

              <button
                onClick={handleCreateNewMask}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-semibold shadow-sm transition-all active:scale-95"
              >
                <Plus className="w-3 h-3" />
                <span>New Mask</span>
              </button>

              {onOpenHelp && (
                <button
                  type="button"
                  onClick={onOpenHelp}
                  className="p-1 rounded-lg text-slate-400 hover:text-sky-300 hover:bg-slate-800 transition-colors"
                  title="Help: Mask Levels, Aligned Stack & 2D GDS"
                  aria-label="Help for Mask Levels"
                >
                  <HelpCircle className="w-4 h-4" />
                </button>
              )}

              <button
                onClick={onClose}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                title="Close Mask Levels Panel"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Master-Detail Workspace */}
        <div className="relative flex-1 flex overflow-hidden min-h-0">
          {/* LEFT SIDEBAR: Desktop Docked Mask Set Hierarchy List */}
          {desktopMasksSidebarOpen && (
            <div
              className={`hidden lg:flex flex-col border-r border-slate-800 bg-slate-900/60 shrink-0 ${
                showSelectedMaskInset || showFinalStepInset ? 'w-60 xl:w-64' : 'w-64 xl:w-72'
              }`}
            >
              {renderReticleSidebarContent()}
            </div>
          )}

          {/* Mobile / Tablet Slide-Over Reticles Drawer */}
          {mobileReticleDrawerOpen && (
            <div className="lg:hidden absolute inset-0 z-30 flex">
              <div
                className="absolute inset-0 bg-slate-950/75 backdrop-blur-xs"
                onClick={() => setMobileReticleDrawerOpen(false)}
              />
              <div className="relative w-72 max-w-[85vw] h-full flex flex-col border-r border-slate-800 bg-slate-900 shadow-2xl">
                <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800 bg-slate-900">
                  <span className="text-xs font-bold uppercase tracking-wider text-sky-400">
                    Reticle Library ({masks.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => setMobileReticleDrawerOpen(false)}
                    className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                {renderReticleSidebarContent()}
              </div>
            </div>
          )}

          {/* CENTER WORKSPACE + RIGHT CROSS-SECTION STACK */}
          <div className="flex-1 flex flex-col md:flex-row min-w-0 min-h-0 overflow-hidden">
            {/* CENTER MAIN PANEL: Active Mask CAD Inspector, Aligned Stack, or 2D GDS Layout Editor */}
            <div className="relative flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden bg-slate-950">
            {editorTab === 'gds' ? (
              <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-slate-950 overflow-hidden">
                <GdsLayoutEditor
                  flow={flow}
                  selectedMask={selectedMask}
                  onUpdateFlow={onUpdateFlow}
                  onNotify={handleEditorNotify}
                  onOpenVariablesModal={onOpenVariablesModal}
                />
              </div>
            ) : editorTab === 'stack' ? (
              <MaskStackView
                flow={flow}
                masks={masks}
                selectedMaskId={selectedMask?.id || ''}
                onSelectMask={(id) => setSelectedMaskId(id)}
                waferWidth={waferWidth}
                apertureUnit={apertureUnit}
                onChangeApertureUnit={handleChangeApertureUnit}
                dragPreviewWindows={dragPreviewWindows}
                dragState={dragState}
                trackMarquee={trackMarquee}
                selectedWindowIds={selectedWindowIds}
                activeTrackRef={trackRef}
                onTrackPointerDown={handleTrackPointerDown}
                onWindowPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onOpenSingleTrack={() => setEditorTab('apertures')}
                onAddWindow={selectedMask ? handleAddWindow : undefined}
                onUndo={handleUndoTrack}
                onRedo={handleRedoTrack}
                canUndo={historyState.canUndo}
                canRedo={historyState.canRedo}
              />
            ) : selectedMask ? (
              <div className="flex-1 flex flex-col min-w-0 overflow-y-auto bg-slate-950 p-2 sm:p-3 space-y-2">
              {/* Mask General Configuration Card */}
              <div className="p-2.5 sm:p-3 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
                <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-2 pb-2 border-b border-slate-800/80">
                  <div className="flex items-center gap-2 min-w-0 w-full sm:w-auto sm:flex-1">
                    <span
                      className="w-3 h-3 rounded-full border border-white/20 shrink-0"
                      style={{ backgroundColor: selectedMask.color || '#38bdf8' }}
                    />
                    <input
                      type="text"
                      value={selectedMask.name}
                      onChange={(e) =>
                        handleUpdateMask({
                          ...selectedMask,
                          name: e.target.value,
                        })
                      }
                      className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 font-bold text-xs sm:text-sm text-white focus:outline-none focus:border-sky-500 min-w-0 flex-1 max-w-md"
                      placeholder="Mask Level Name"
                    />
                    <input
                      type="text"
                      value={selectedMask.layerCode || ''}
                      onChange={(e) =>
                        handleUpdateMask({
                          ...selectedMask,
                          layerCode: e.target.value.toUpperCase(),
                        })
                      }
                      className="bg-slate-950 border border-slate-700 rounded-lg px-1.5 py-1 font-mono text-xs text-sky-400 focus:outline-none focus:border-sky-500 w-16 sm:w-20 text-center uppercase shrink-0"
                      placeholder="CODE"
                      title="Mask Layer Code (e.g. GATE-01)"
                    />
                  </div>

                  {/* Mask Field Polarity & Resist Tone + Duplicate/Delete */}
                  <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto">
                    <div
                      className="grid grid-cols-2 flex-1 sm:flex items-center bg-slate-950 border border-slate-700 rounded-lg p-0.5 text-[11px]"
                      title="Mask Field Polarity: Dark-Field (opaque chrome bg, movable blocks = clear apertures) vs Light-Field (clear quartz bg, movable blocks = opaque chrome blockers)"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          handleUpdateMask({
                            ...selectedMask,
                            maskField: 'dark-field',
                          })
                        }
                        className={`px-2 py-0.5 rounded font-medium whitespace-nowrap transition-colors ${
                          (selectedMask.maskField || 'dark-field') === 'dark-field'
                            ? 'bg-slate-700 text-white'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                        title="Dark-Field Mask: Opaque chrome background; movable blocks are clear UV apertures"
                      >
                        Dark-Field
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleUpdateMask({
                            ...selectedMask,
                            maskField: 'light-field',
                          })
                        }
                        className={`px-2 py-0.5 rounded font-medium whitespace-nowrap transition-colors ${
                          selectedMask.maskField === 'light-field'
                            ? 'bg-cyan-600 text-white'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                        title="Light-Field Mask: Clear quartz background; movable blocks are opaque chrome blockers"
                      >
                        Light-Field
                      </button>
                    </div>

                    <div
                      className="grid grid-cols-2 flex-1 sm:flex items-center bg-slate-950 border border-slate-700 rounded-lg p-0.5 text-[11px]"
                      title="Target Photoresist Tone: Positive (UV-exposed resist dissolves) vs Negative (UV-exposed resist crosslinks and stays)"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          handleUpdateMask({
                            ...selectedMask,
                            polarity: 'positive',
                          })
                        }
                        className={`px-2 py-0.5 rounded font-medium whitespace-nowrap transition-colors ${
                          selectedMask.polarity === 'positive'
                            ? 'bg-sky-600 text-white'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                        title="Positive Resist: UV-exposed resist dissolves in developer"
                      >
                        Pos Resist
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleUpdateMask({
                            ...selectedMask,
                            polarity: 'negative',
                          })
                        }
                        className={`px-2 py-0.5 rounded font-medium whitespace-nowrap transition-colors ${
                          selectedMask.polarity === 'negative'
                            ? 'bg-amber-600 text-white'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                        title="Negative Resist: UV-exposed resist crosslinks and remains; unexposed dissolves"
                      >
                        Neg Resist
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={handleToggleMaskAlignKey}
                      aria-pressed={Boolean(selectedMask.definesAlignmentMarks)}
                      className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                        selectedMask.definesAlignmentMarks
                          ? 'bg-cyan-500/20 border-cyan-500/60 text-cyan-200'
                          : 'bg-slate-950 hover:bg-slate-800 border-slate-700 text-slate-300 hover:text-cyan-300'
                      }`}
                      title="Define this mask level as an alignment key mask"
                    >
                      <Crosshair className="w-3 h-3 text-cyan-400 shrink-0" />
                      <span>Align Key</span>
                    </button>

                    <button
                      onClick={() => handleDuplicateMask(selectedMask)}
                      className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs transition-colors shrink-0"
                      title="Duplicate this Mask Level (creates an unassigned copy)"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>

                    {!isMaskAssigned(selectedMask) && (
                      <button
                        onClick={() => handleDeleteMask(selectedMask.id)}
                        className="p-1 rounded-lg bg-rose-950/50 hover:bg-rose-900/60 text-rose-300 border border-rose-500/30 text-xs transition-colors shrink-0"
                        title="Delete this unassigned Mask Level"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Step Assignment, Notes & Color Swatches Row */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-end">
                  <div className="md:col-span-5 min-w-0">
                    <label className="block text-[10px] text-slate-400 mb-0.5 font-medium">
                      Assigned Step / Variant
                    </label>
                    <div className="flex items-center gap-1.5 min-w-0">
                      {(() => {
                        const primaryLink =
                          selectedMaskLinks.find((l) => l.isActiveVariant) ||
                          selectedMaskLinks[0];
                        const selectVal = primaryLink
                          ? primaryLink.variant
                            ? `${primaryLink.step.id}::${primaryLink.variant.id}`
                            : primaryLink.step.id
                          : selectedMask.assignedStepId
                          ? selectedMask.assignedVariantId
                            ? `${selectedMask.assignedStepId}::${selectedMask.assignedVariantId}`
                            : selectedMask.assignedStepId
                          : 'none';

                        return (
                          <select
                            value={selectVal}
                            onChange={(e) => handleAssignStep(e.target.value)}
                            className="min-w-0 flex-1 w-full px-2 py-1 rounded-lg bg-slate-950 border border-slate-700 text-[11px] text-slate-200 focus:outline-none focus:border-sky-500 font-mono truncate"
                          >
                            <option value="none">-- Unassigned (Stand-alone Reticle) --</option>
                            {lithoSteps.map(({ step, index }) => {
                              const sideTag =
                                step.side === 'back'
                                  ? ' (Backside)'
                                  : step.side === 'both'
                                  ? ' (Both Sides)'
                                  : '';

                              if (step.variants && step.variants.length > 1) {
                                const activeVar = getActiveStepVariant(step);
                                return (
                                  <optgroup
                                    key={step.id}
                                    label={`Step ${index + 1}: ${step.title}${sideTag} (${step.variants.length} variants)`}
                                  >
                                    {step.variants.map((v) => {
                                      if (v.type !== 'lithography') return null;
                                      const optVal = `${step.id}::${v.id}`;
                                      const isActiveV = activeVar?.id === v.id;
                                      const isCurrentSlot = selectedMaskLinks.some(
                                        (l) => l.step.id === step.id && l.variant?.id === v.id
                                      );
                                      const conflicting = masks.find(
                                        (m) =>
                                          m.id !== selectedMask.id &&
                                          (v.lithography?.maskId === m.id ||
                                            (m.assignedStepId === step.id &&
                                              m.assignedVariantId === v.id))
                                      );
                                      return (
                                        <option key={optVal} value={optVal}>
                                          Step {index + 1} · {v.name}
                                          {isActiveV ? ' (Active)' : ''}
                                          {isCurrentSlot
                                            ? '  [Current Reticle]'
                                            : conflicting
                                            ? `  [Assigned to: ${conflicting.layerCode || 'Reticle'} ${conflicting.name}]`
                                            : '  (Available)'}
                                        </option>
                                      );
                                    })}
                                  </optgroup>
                                );
                              }

                              const isCurrent = selectedMask.assignedStepId === step.id;
                              const conflicting = masks.find(
                                (m) => m.id !== selectedMask.id && m.assignedStepId === step.id
                              );
                              return (
                                <option key={step.id} value={step.id}>
                                  Step {index + 1}: {step.title}
                                  {sideTag}
                                  {isCurrent
                                    ? '  [Current Assigned Step]'
                                    : conflicting
                                    ? `  [Assigned to: ${conflicting.layerCode || 'Reticle'} ${conflicting.name}]`
                                    : '  (Available)'}
                                </option>
                              );
                            })}
                          </select>
                        );
                      })()}

                      {assignedStepInfo && (
                        <button
                          onClick={handleJumpToStep}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-sky-600/20 text-sky-300 hover:bg-sky-600/30 border border-sky-500/40 text-[11px] font-semibold shrink-0 transition-colors"
                          title="Jump directly to this step in the Cross-Section CAD"
                        >
                          <Eye className="w-3 h-3" />
                          <span>Step</span>
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="md:col-span-4 min-w-0">
                    <label className="block text-[10px] text-slate-400 mb-0.5 font-medium">
                      Layer Notes
                    </label>
                    <input
                      type="text"
                      value={selectedMask.description || ''}
                      onChange={(e) =>
                        handleUpdateMask({
                          ...selectedMask,
                          description: e.target.value,
                        })
                      }
                      className="w-full px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-700 text-[11px] text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500"
                      placeholder="e.g. Gate definition for CMOS"
                    />
                  </div>

                  <div className="md:col-span-3 min-w-0">
                    <label className="block text-[10px] text-slate-400 mb-0.5 font-medium">
                      Reticle Color
                    </label>
                    <div className="flex items-center gap-1 h-[26px]">
                      {RETICLE_PALETTE.map((color) => (
                        <button
                          key={color}
                          onClick={() => handleUpdateMask({ ...selectedMask, color })}
                          className={`w-4 h-4 rounded-full border transition-transform ${
                            selectedMask.color === color ? 'scale-125 border-white shadow-sm' : 'border-transparent opacity-70 hover:opacity-100'
                          }`}
                          style={{ backgroundColor: color }}
                          title={color}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                {/* Photolithography Step Variants Integration Strip */}
                {assignedStepInfo && (() => {
                  const step = assignedStepInfo.step;
                  const stepNum = assignedStepInfo.index + 1;
                  const variants = step.variants && step.variants.length > 1 ? step.variants : null;

                  if (!variants) {
                    return (
                      <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-slate-950/70 border border-slate-800/90 text-[11px]">
                        <div className="flex items-center gap-1.5 text-slate-400 min-w-0">
                          <GitBranch className="w-3 h-3 text-violet-400 shrink-0" />
                          <span className="truncate">
                            Step {stepNum} single reticle recipe · branch a variant to test alternate layouts
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleBranchLithoStepInManager(step.id)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-violet-600/25 hover:bg-violet-600/40 border border-violet-500/40 text-violet-200 font-semibold transition-colors shrink-0"
                          title={`Create a new variant of Step ${stepNum} with its own dedicated reticle`}
                        >
                          <Plus className="w-3 h-3" />
                          <span>Branch Variant</span>
                        </button>
                      </div>
                    );
                  }

                  const activeVar = getActiveStepVariant(step);
                  const isSharedMask = selectedMaskLinks.length > 1;
                  const hasActiveMaskLink = selectedMaskLinks.some((l) => l.isActiveVariant);
                  const inactiveOwnerLink = !hasActiveMaskLink ? selectedMaskLinks[0] : null;

                  return (
                    <div className="p-2 rounded-lg bg-slate-950/85 border border-violet-500/35 space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-1.5">
                        <div className="flex items-center gap-1.5 text-[11px]">
                          <GitBranch className="w-3 h-3 text-violet-400 shrink-0" />
                          <span className="font-semibold text-violet-200">
                            Step {stepNum} Variants
                          </span>
                          <span className="font-mono text-[10px] text-violet-300 tabular-nums">
                            · {variants.length}
                          </span>
                          {isSharedMask && (
                            <span className="text-[10px] font-medium text-amber-300">
                              · Shared ({selectedMaskLinks.length} variants)
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 flex-wrap">
                          {isSharedMask && activeVar && activeVar.type === 'lithography' && (
                            <button
                              type="button"
                              onClick={() => handleForkMaskForVariant(step.id, activeVar.id)}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-sky-600/25 hover:bg-sky-600/40 border border-sky-500/45 text-[10.5px] font-semibold text-sky-200 transition-colors"
                              title={`Create a separate dedicated reticle copy for "${activeVar.name}" so edits won't affect other variants`}
                            >
                              <Split className="w-3 h-3" />
                              <span>Fork for {activeVar.name}</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleBranchLithoStepInManager(step.id)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-violet-600/80 hover:bg-violet-500 text-white text-[10.5px] font-semibold transition-colors"
                            title={`Create a new variant on Step ${stepNum} with a dedicated forked reticle`}
                          >
                            <Plus className="w-3 h-3" />
                            <span>New Variant</span>
                          </button>
                        </div>
                      </div>

                      {inactiveOwnerLink?.variant && (
                        <div className="flex flex-wrap items-center justify-between gap-2 px-2 py-1 rounded bg-amber-500/10 border border-amber-500/30 text-[10.5px] text-amber-200">
                          <span>
                            Editing inactive variant{' '}
                            <strong className="text-white">{inactiveOwnerLink.variant.name}</strong>{' '}
                            (active: <strong className="text-violet-200">{activeVar?.name}</strong>)
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              handleSwitchStepVariantInManager(
                                step.id,
                                inactiveOwnerLink.variant!.id,
                                false
                              )
                            }
                            className="px-2 py-0.5 rounded bg-violet-600 hover:bg-violet-500 text-white text-[10px] font-semibold transition-colors"
                          >
                            Activate
                          </button>
                        </div>
                      )}

                      <div className="flex flex-wrap gap-1">
                        {variants.map((v) => {
                          const isActive = activeVar?.id === v.id;
                          const vMaskId =
                            v.type === 'lithography' ? v.lithography?.maskId : undefined;
                          const vMask = vMaskId ? masks.find((m) => m.id === vMaskId) : null;
                          const usesThisMask = vMaskId === selectedMask.id;

                          return (
                            <div
                              key={v.id}
                              className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px] transition-colors ${
                                isActive
                                  ? 'bg-violet-600/20 border-violet-400/75 text-white'
                                  : usesThisMask
                                  ? 'bg-sky-500/10 border-sky-500/45 text-slate-200'
                                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-600 hover:text-slate-200'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  handleSwitchStepVariantInManager(step.id, v.id, true)
                                }
                                className="flex items-center gap-1 font-semibold text-left"
                                title={
                                  isActive
                                    ? `Active variant: ${v.name}`
                                    : `Activate "${v.name}" on Step ${stepNum}${
                                        vMask && vMask.id !== selectedMask.id
                                          ? ` and switch to ${vMask.name}`
                                          : ''
                                      }`
                                }
                              >
                                {isActive && (
                                  <Check className="w-2.5 h-2.5 text-violet-300 shrink-0" />
                                )}
                                <span>{v.name}</span>
                              </button>

                              {v.type === 'lithography' ? (
                                vMask ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (vMask.id !== selectedMask.id) {
                                        setSelectedMaskId(vMask.id);
                                      }
                                    }}
                                    className={`font-mono text-[9.5px] transition-colors ${
                                      usesThisMask
                                        ? 'text-sky-300'
                                        : 'text-slate-400 hover:text-sky-200'
                                    }`}
                                    title={
                                      usesThisMask
                                        ? `Uses currently selected reticle (${vMask.name})`
                                        : `Inspect reticle "${vMask.name}" used by ${v.name}`
                                    }
                                  >
                                    · {usesThisMask
                                      ? isSharedMask
                                        ? 'Shared'
                                        : 'Active'
                                      : vMask.layerCode || vMask.name}
                                  </button>
                                ) : (
                                  <span className="font-mono text-[9.5px] text-slate-500">
                                    · Unlinked
                                  </span>
                                )
                              ) : (
                                <span className="font-mono text-[9.5px] text-slate-500 uppercase">
                                  · {v.type}
                                </span>
                              )}

                              {isSharedMask && v.type === 'lithography' && !isActive && (
                                <button
                                  type="button"
                                  onClick={() => handleForkMaskForVariant(step.id, v.id)}
                                  className="p-0.5 rounded text-slate-400 hover:text-sky-300 hover:bg-slate-800 transition-colors"
                                  title={`Fork dedicated reticle for "${v.name}"`}
                                >
                                  <Split className="w-2.5 h-2.5" />
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Cleanroom DRC Metric Strip */}
              {metrics && (
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
                  <div className="px-2 py-1.5 rounded-lg bg-slate-900/60 border border-slate-800 text-center">
                    <span className="block text-[9.5px] text-slate-400 uppercase tracking-wider truncate">
                      {metrics.isLightField ? 'Blockers' : 'Apertures'}
                    </span>
                    <span className="text-xs sm:text-sm font-bold font-mono tabular-nums text-white">{metrics.apertureCount}</span>
                  </div>
                  <div className="px-2 py-1.5 rounded-lg bg-slate-900/60 border border-slate-800 text-center">
                    <span className="block text-[9.5px] text-slate-400 uppercase tracking-wider truncate">Clear Area</span>
                    <span className="text-xs sm:text-sm font-bold font-mono tabular-nums text-amber-400">{metrics.clearPercentage}%</span>
                  </div>
                  <div className="px-2 py-1.5 rounded-lg bg-slate-900/60 border border-slate-800 text-center">
                    <span className="block text-[9.5px] text-slate-400 uppercase tracking-wider truncate">Transmitted</span>
                    <span className="text-xs sm:text-sm font-bold font-mono tabular-nums text-sky-400">
                      {apertureUnit === 'um'
                        ? `${metrics.totalClearWidthUm} µm`
                        : `${Math.round(metrics.totalClearWidthNm).toLocaleString()} nm`}
                    </span>
                  </div>
                  <div className="px-2 py-1.5 rounded-lg bg-slate-900/60 border border-slate-800 text-center">
                    <span className="block text-[9.5px] text-slate-400 uppercase tracking-wider truncate">Min CD</span>
                    <span className="text-xs sm:text-sm font-bold font-mono tabular-nums text-emerald-400">
                      {apertureUnit === 'um'
                        ? `${Number((metrics.minFeatureSizeNm / 1000).toFixed(3))} µm`
                        : `${metrics.minFeatureSizeNm} nm`}
                    </span>
                  </div>
                  <div className="px-2 py-1.5 rounded-lg bg-slate-900/60 border border-slate-800 text-center col-span-2 sm:col-span-1">
                    <span className="block text-[9.5px] text-slate-400 uppercase tracking-wider truncate">Field Span</span>
                    <span className="text-xs sm:text-sm font-bold font-mono tabular-nums text-slate-200">
                      {apertureUnit === 'um'
                        ? `${(waferWidth / 1000).toFixed(1)} µm`
                        : `${Math.round(waferWidth).toLocaleString()} nm`}
                    </span>
                  </div>
                </div>
              )}

              {/* INTERACTIVE MASK TRACK SECTION */}
              {(() => {
                const isLF = selectedMask.maskField === 'light-field';
                const featNoun = isLF ? 'Blocker' : 'Aperture';
                return (
                  <div className="p-2.5 sm:p-3 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-semibold text-xs text-slate-200">
                          {isLF ? 'Light-Field Blocker Track' : 'Dark-Field Aperture Track'}
                        </span>
                        <span className="hidden sm:inline text-[10.5px] text-slate-400 font-mono tabular-nums">
                          {dragState?.type === 'move' && (dragState.initialWindows?.length || 1) > 1 ? (
                            <span className="text-amber-300 font-semibold font-sans">
                              · Sliding {dragState.initialWindows?.length} {featNoun}s
                            </span>
                          ) : (() => {
                            const { fineNm, coarseNm } = getMaskArrowStepSizes(waferWidth);
                            const fmt = (nm: number) => formatCoordDisplay(nm, apertureUnit, 3);
                            return (
                              <>
                                · ←/→ {fmt(fineNm)} (Shift {fmt(coarseNm)})
                              </>
                            );
                          })()}
                        </span>
                      </div>

                      {/* Undo / Redo + Preset Pattern Buttons */}
                      <div className="flex flex-wrap items-center gap-1 text-xs">
                        <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-0.5 mr-0.5">
                          <button
                            type="button"
                            onClick={handleUndoTrack}
                            disabled={!historyState.canUndo}
                            className="p-1 rounded text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-35 disabled:pointer-events-none transition-colors"
                            title="Undo track edit (Ctrl+Z)"
                          >
                            <Undo2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={handleRedoTrack}
                            disabled={!historyState.canRedo}
                            className="p-1 rounded text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-35 disabled:pointer-events-none transition-colors"
                            title="Redo track edit (Ctrl+Y)"
                          >
                            <Redo2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <span className="text-[10px] text-slate-400 mr-0.5">Presets:</span>
                        <button
                          onClick={() => handleApplyPreset('center-slit')}
                          className="px-2 py-1 sm:py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] border border-slate-700 transition-colors"
                          title={isLF ? 'Single Center Blocker' : 'Single Center Slit'}
                        >
                          {isLF ? 'Center Block' : 'Center Slit'}
                        </button>
                        <button
                          onClick={() => handleApplyPreset('dual-pad')}
                          className="px-2 py-1 sm:py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] border border-slate-700 transition-colors"
                          title="Dual Symmetric Features"
                        >
                          Dual Pads
                        </button>
                        <button
                          onClick={() => handleApplyPreset('grating')}
                          className="px-2 py-1 sm:py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] border border-slate-700 transition-colors"
                          title="Periodic Grating Lines"
                        >
                          Grating
                        </button>
                        <button
                          onClick={() => handleApplyPreset('invert')}
                          className="flex items-center gap-1 px-2 py-1 sm:py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] border border-slate-700 transition-colors"
                          title="Invert Windows Across Wafer Span"
                        >
                          <FlipHorizontal className="w-3 h-3" />
                          <span>Invert</span>
                        </button>
                        <button
                          onClick={() => handleClearApertureTrack(selectedMask)}
                          disabled={selectedMask.windows.length === 0}
                          className="flex items-center gap-1 px-2 py-1 sm:py-0.5 rounded bg-slate-800 hover:bg-amber-950/50 text-amber-300 hover:text-amber-200 text-[11px] border border-slate-700 hover:border-amber-500/40 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                          title={
                            isLF
                              ? 'Clear all chrome blockers (100% clear quartz field)'
                              : 'Clear all apertures from this mask track (100% opaque dark field)'
                          }
                        >
                          <Eraser className="w-3 h-3" />
                          <span>Clear Track</span>
                        </button>
                        <button
                          onClick={handleAddWindow}
                          className="flex items-center gap-1 px-2 py-0.5 rounded bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-semibold transition-colors"
                        >
                          <Plus className="w-3 h-3" />
                          <span>Add {featNoun}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditorTab('stack')}
                          className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-sky-300 text-[11px] border border-slate-700 transition-colors"
                          title="Compare all mask tracks stacked vertically on a shared X axis"
                        >
                          <Layers className="w-3 h-3" />
                          <span>Stack</span>
                        </button>
                      </div>
                    </div>

                    {/* Visual Draggable Mask Track */}
                    <div
                      ref={trackRef}
                      tabIndex={0}
                      onPointerDown={handleTrackPointerDown}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                      onPointerCancel={handlePointerUp}
                      className={`relative h-10 rounded-lg overflow-hidden cursor-default select-none shadow-inner touch-none border focus:outline-none focus-visible:ring-1 focus-visible:ring-sky-500/60 ${
                        isLF
                          ? 'bg-gradient-to-b from-sky-200/35 via-cyan-100/25 to-amber-100/30 border-sky-400/50'
                          : 'bg-slate-950 border-slate-800'
                      }`}
                    >
                      {/* Background Field: Chrome (Dark-Field) OR Clear Quartz (Light-Field) */}
                      {isLF ? (
                        <div
                          className="absolute inset-0 pointer-events-none flex items-center justify-center"
                          style={{
                            backgroundImage:
                              'linear-gradient(90deg, rgba(125,211,252,0.14) 1px, transparent 1px)',
                            backgroundSize: '24px 100%',
                          }}
                        >
                          {selectedMask.windows.length === 0 && (
                            <span className="text-[10px] font-mono font-semibold uppercase tracking-widest text-sky-100/80">
                              Clear Quartz Field (100% UV Transmitting)
                            </span>
                          )}
                        </div>
                      ) : (
                        <div
                          className="absolute inset-0 opacity-40 flex items-center justify-center"
                          style={{
                            backgroundImage:
                              'repeating-linear-gradient(45deg, #1e293b 0, #1e293b 8px, #0f172a 8px, #0f172a 16px)',
                          }}
                        />
                      )}

                      {/* Track Marquee Selection Box */}
                      {trackMarquee && (() => {
                        const minPct = (Math.min(trackMarquee.startNm, trackMarquee.currentNm) / waferWidth) * 100;
                        const maxPct = (Math.max(trackMarquee.startNm, trackMarquee.currentNm) / waferWidth) * 100;
                        return (
                          <div
                            className="absolute top-0 bottom-0 bg-sky-400/20 border-x-2 border-sky-400 pointer-events-none z-30"
                            style={{ left: `${minPct}%`, width: `${Math.max(0.5, maxPct - minPct)}%` }}
                          />
                        );
                      })()}

                      {/* Movable Blocks: Chrome Blockers (Light-Field) OR Clear Apertures (Dark-Field) */}
                      {(dragPreviewWindows ?? selectedMask.windows).map((win, idx) => {
                        const leftPct = (win.xStart / waferWidth) * 100;
                        const widthPct = ((win.xEnd - win.xStart) / waferWidth) * 100;
                        const isActive =
                          selectedWindowIds.includes(win.id) ||
                          Boolean(dragState?.initialWindows?.some((t) => t.id === win.id));
                        const widthNm = Math.round(win.xEnd - win.xStart);
                        const accentColor = selectedMask.color || '#38bdf8';

                        return (
                          <div
                            key={win.id || `win_${idx}`}
                            className={`absolute top-1 bottom-1 rounded-lg flex items-center justify-center ${dragState ? '' : 'transition-shadow'} ${
                              isActive
                                ? 'ring-2 ring-white shadow-xl z-20 brightness-110'
                                : win.isAlignKey
                                ? 'ring-1 ring-cyan-300 shadow-md z-15'
                                : 'hover:brightness-110 shadow-md z-10'
                            } ${isLF ? 'border-2' : ''}`}
                            style={{
                              left: `${leftPct}%`,
                              width: `${Math.max(1, widthPct)}%`,
                              backgroundColor: isLF
                                ? '#0f172a'
                                : win.isAlignKey
                                ? '#06b6d4'
                                : accentColor,
                              borderColor: isLF
                                ? win.isAlignKey
                                  ? '#22d3ee'
                                  : accentColor
                                : undefined,
                              ...(isLF
                                ? {
                                    backgroundImage:
                                      'repeating-linear-gradient(135deg, rgba(148,163,184,0.16) 0, rgba(148,163,184,0.16) 5px, transparent 5px, transparent 10px)',
                                  }
                                : {}),
                              boxShadow: isActive
                                ? `0 0 0 2px #ffffff, 0 8px 18px -2px ${accentColor}90`
                                : win.isAlignKey
                                ? '0 0 0 1px #22d3ee, 0 3px 10px -2px rgba(34,211,238,0.55)'
                                : `0 3px 10px -2px ${accentColor}60`,
                              cursor: 'grab',
                            }}
                            onClick={(e) => e.stopPropagation()}
                            onPointerDown={(e) => handlePointerDown(e, win, 'move')}
                          >
                            {/* Left edge resize handle */}
                            <div
                              className={`absolute left-0 top-0 bottom-0 w-4 sm:w-3 cursor-ew-resize flex items-center justify-center group ${
                                isLF ? 'hover:bg-white/25' : 'hover:bg-white/40'
                              }`}
                              onPointerDown={(e) => handlePointerDown(e, win, 'resize-start')}
                              title="Drag to resize left edge"
                            >
                              <div
                                className={`w-1 h-4 rounded-full ${
                                  isLF
                                    ? 'bg-slate-300/70 group-hover:bg-white'
                                    : 'bg-slate-900/50 group-hover:bg-slate-950'
                                }`}
                              />
                            </div>

                            {/* Feature label (width) */}
                            <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-black/50 text-white backdrop-blur-xs select-none pointer-events-none truncate shadow-sm flex items-center gap-1">
                              {win.isAlignKey && (
                                <Crosshair className="w-2.5 h-2.5 text-cyan-300 shrink-0" />
                              )}
                              {(win.paramBindings?.width || win.paramBindings?.xStart || win.paramBindings?.xEnd) && (
                                <span className="italic text-violet-300 font-bold">fx</span>
                              )}
                              <span>
                                {formatCoordDisplay(widthNm, apertureUnit, 3)}
                              </span>
                            </span>

                            {/* Right edge resize handle */}
                            <div
                              className={`absolute right-0 top-0 bottom-0 w-4 sm:w-3 cursor-ew-resize flex items-center justify-center group ${
                                isLF ? 'hover:bg-white/25' : 'hover:bg-white/40'
                              }`}
                              onPointerDown={(e) => handlePointerDown(e, win, 'resize-end')}
                              title="Drag to resize right edge"
                            >
                              <div
                                className={`w-1 h-4 rounded-full ${
                                  isLF
                                    ? 'bg-slate-300/70 group-hover:bg-white'
                                    : 'bg-slate-900/50 group-hover:bg-slate-950'
                                }`}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Coordinate Scale Bar beneath track */}
                    <div className="flex justify-between items-center text-[9.5px] font-mono tabular-nums text-slate-400 px-1">
                      {apertureUnit === 'um' ? (
                        <>
                          <span>0.0 µm</span>
                          <span>{(waferWidth / 4000).toFixed(1)} µm</span>
                          <span>{(waferWidth / 2000).toFixed(1)} µm</span>
                          <span>{((waferWidth * 3) / 4000).toFixed(1)} µm</span>
                          <span>{(waferWidth / 1000).toFixed(1)} µm</span>
                        </>
                      ) : (
                        <>
                          <span>0 nm</span>
                          <span>{Math.round(waferWidth / 4).toLocaleString()} nm</span>
                          <span>{Math.round(waferWidth / 2).toLocaleString()} nm</span>
                          <span>{Math.round((waferWidth * 3) / 4).toLocaleString()} nm</span>
                          <span>{Math.round(waferWidth).toLocaleString()} nm</span>
                        </>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* PRECISION NUMERIC FEATURE TABLE / MOBILE CARDS */}
              <div className="p-2.5 sm:p-3 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
                {(() => {
                  const effectiveSelectedIds =
                    selectedWindowIds.length > 0
                      ? selectedWindowIds
                      : selectedMask.windows.length === 1
                      ? [selectedMask.windows[0].id]
                      : [];
                  const singleSelWin =
                    effectiveSelectedIds.length === 1
                      ? selectedMask.windows.find((w) => w.id === effectiveSelectedIds[0]) || null
                      : null;
                  const singleSelIdx = singleSelWin
                    ? selectedMask.windows.findIndex((w) => w.id === singleSelWin.id)
                    : -1;
                  const featWord = selectedMask.maskField === 'light-field' ? 'Blocker' : 'Window';
                  const allSelected =
                    selectedMask.windows.length > 0 &&
                    selectedWindowIds.length === selectedMask.windows.length;

                  return (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-xs text-slate-200">
                          {selectedMask.maskField === 'light-field'
                            ? `Chrome Blockers (${selectedMask.windows.length})`
                            : `Aperture Windows (${selectedMask.windows.length})`}
                        </span>
                        {/* Base Unit Toggle (µm default / nm) */}
                        <div
                          className="inline-flex items-center bg-slate-950 border border-slate-700/80 rounded-lg p-0.5 text-[10.5px] font-mono"
                          title="Base unit for aperture positions, widths, ruler, move steps, and array pitch"
                        >
                          <span className="text-[10px] text-slate-400 px-1.5 font-sans">Unit:</span>
                          <button
                            type="button"
                            onClick={() => handleChangeApertureUnit('um')}
                            className={`px-2 py-0.5 rounded-md font-semibold transition-colors ${
                              apertureUnit === 'um'
                                ? 'bg-sky-600 text-white shadow-sm'
                                : 'text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            µm
                          </button>
                          <button
                            type="button"
                            onClick={() => handleChangeApertureUnit('nm')}
                            className={`px-2 py-0.5 rounded-md font-semibold transition-colors ${
                              apertureUnit === 'nm'
                                ? 'bg-sky-600 text-white shadow-sm'
                                : 'text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            nm
                          </button>
                        </div>
                        {effectiveSelectedIds.length === 1 && singleSelIdx >= 0 && (
                          <span className="text-[11px] font-mono text-sky-300">
                            · Selected: W-{singleSelIdx + 1}
                          </span>
                        )}
                        {effectiveSelectedIds.length > 1 && (
                          <span className="text-[11px] font-mono font-semibold text-amber-300">
                            · {effectiveSelectedIds.length} selected
                          </span>
                        )}
                        {selectedMask.windows.length > 1 && (
                          <button
                            type="button"
                            onClick={() =>
                              setSelectedWindowIds(
                                allSelected ? [] : selectedMask.windows.map((w) => w.id)
                              )
                            }
                            className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-[10px]"
                          >
                            {allSelected ? 'Clear' : 'All'}
                          </button>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        {selectedMask.windows.length > 0 && (
                          <>
                            {effectiveSelectedIds.length > 0 && (() => {
                              const { fineNm, coarseNm } = getMaskArrowStepSizes(waferWidth);
                              const fineTxt = formatCoordDisplay(fineNm, apertureUnit, 3).replace(' ', '');
                              const coarseTxt = formatCoordDisplay(coarseNm, apertureUnit, 3).replace(' ', '');
                              return (
                                <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded-lg px-1.5 py-0.5">
                                  <span className="text-[10px] text-slate-400">Move:</span>
                                  <button
                                    type="button"
                                    onClick={() => handleShiftWindows(effectiveSelectedIds, -coarseNm)}
                                    className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-sky-300 font-mono text-[10.5px]"
                                    title={`Coarse shift left -${formatCoordDisplay(coarseNm, apertureUnit, 3)} (Shift+←)`}
                                  >
                                    -{coarseTxt}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleShiftWindows(effectiveSelectedIds, -fineNm)}
                                    className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-[10.5px]"
                                    title={`Fine shift left -${formatCoordDisplay(fineNm, apertureUnit, 3)} (←)`}
                                  >
                                    -{fineTxt}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleShiftWindows(effectiveSelectedIds, fineNm)}
                                    className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-[10.5px]"
                                    title={`Fine shift right +${formatCoordDisplay(fineNm, apertureUnit, 3)} (→)`}
                                  >
                                    +{fineTxt}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleShiftWindows(effectiveSelectedIds, coarseNm)}
                                    className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-sky-300 font-mono text-[10.5px]"
                                    title={`Coarse shift right +${formatCoordDisplay(coarseNm, apertureUnit, 3)} (Shift+→)`}
                                  >
                                    +{coarseTxt}
                                  </button>
                                </div>
                              );
                            })()}
                            <button
                              type="button"
                              disabled={effectiveSelectedIds.length === 0}
                              onClick={() => handleDuplicateSelectedWindows(effectiveSelectedIds)}
                              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:pointer-events-none text-slate-200 border border-slate-700 text-xs font-medium transition-colors"
                              title={
                                effectiveSelectedIds.length > 1
                                  ? `Duplicate ${effectiveSelectedIds.length} selected ${featWord.toLowerCase()}s`
                                  : singleSelWin
                                  ? `Duplicate selected ${featWord} W-${singleSelIdx + 1}`
                                  : `Select a ${featWord.toLowerCase()} row or track block first`
                              }
                            >
                              <Copy className="w-3.5 h-3.5 text-sky-400" />
                              <span>
                                {effectiveSelectedIds.length > 1
                                  ? `Duplicate (${effectiveSelectedIds.length})`
                                  : 'Duplicate'}
                              </span>
                            </button>
                            <button
                              type="button"
                              disabled={effectiveSelectedIds.length === 0}
                              onClick={() => handleToggleSelectedAlignKeys(effectiveSelectedIds)}
                              className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-xs font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap shrink-0 ${
                                effectiveSelectedIds.length > 0 &&
                                selectedMask.windows
                                  .filter((w) => effectiveSelectedIds.includes(w.id))
                                  .every((w) => Boolean(w.isAlignKey))
                                  ? 'bg-cyan-500/20 border-cyan-500/60 text-cyan-200'
                                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700 hover:text-cyan-300'
                              }`}
                              title={
                                effectiveSelectedIds.length > 1
                                  ? `Toggle Align Key on ${effectiveSelectedIds.length} selected ${featWord.toLowerCase()}s`
                                  : `Toggle Align Key on selected ${featWord.toLowerCase()}`
                              }
                            >
                              <Crosshair className="w-3.5 h-3.5 text-cyan-400" />
                              <span>Align Key</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeriveAlignMarks(effectiveSelectedIds)}
                              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-cyan-950/60 hover:bg-cyan-900/60 text-cyan-200 border border-cyan-500/40 text-xs font-medium transition-colors whitespace-nowrap shrink-0"
                              title={
                                effectiveSelectedIds.length > 1
                                  ? `Place 1 global alignment mark centered within the ${effectiveSelectedIds.length} selected ${featWord.toLowerCase()}s`
                                  : effectiveSelectedIds.length === 1
                                  ? `Place 1 global alignment mark centered on selected ${featWord} W-${singleSelIdx + 1}`
                                  : selectedMask.windows.some((w) => w.isAlignKey)
                                  ? 'Derive substrate alignment marks from shapes flagged as Align Keys'
                                  : 'Derive substrate alignment marks from window centers'
                              }
                            >
                              <Crosshair className="w-3.5 h-3.5 text-cyan-400" />
                              <span>
                                {effectiveSelectedIds.length > 1
                                  ? `Derive Center Mark (${effectiveSelectedIds.length})`
                                  : effectiveSelectedIds.length === 1
                                  ? 'Derive Mark'
                                  : 'Derive Marks'}
                              </span>
                            </button>
                            <button
                              type="button"
                              disabled={!singleSelWin}
                              onClick={() => {
                                if (!singleSelWin) return;
                                setSelectedWindowIds([singleSelWin.id]);
                                setOpenWinBind(null);
                                setArraySourceWinId((prev) =>
                                  prev === singleSelWin.id ? null : singleSelWin.id
                                );
                              }}
                              className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-xs font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none ${
                                singleSelWin && arraySourceWinId === singleSelWin.id
                                  ? 'bg-sky-600/25 border-sky-500/60 text-sky-200'
                                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                              }`}
                              title={
                                singleSelWin
                                  ? `Make 1D array from selected ${featWord} W-${singleSelIdx + 1}`
                                  : `Select a single ${featWord.toLowerCase()} to make an array`
                              }
                            >
                              <LayoutGrid className="w-3.5 h-3.5 text-sky-400" />
                              <span>Make Array</span>
                            </button>
                            {selectedWindowIds.length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleRemoveSelectedWindows(selectedWindowIds)}
                                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-950/60 hover:bg-rose-900/70 text-rose-300 border border-rose-500/30 text-xs font-medium transition-colors"
                                title={`Delete ${selectedWindowIds.length} selected ${featWord.toLowerCase()}s`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>Delete ({selectedWindowIds.length})</span>
                              </button>
                            )}
                          </>
                        )}

                        <button
                          onClick={handleAddWindow}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-400 hover:text-sky-300 border border-slate-700 text-xs font-semibold transition-colors"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>
                            {selectedMask.maskField === 'light-field' ? 'Add Blocker' : 'Add Window'}
                          </span>
                        </button>
                      </div>
                    </div>
                  );
                })()}

                {/* Mobile Stacked Aperture Cards (< sm) */}
                <div className="sm:hidden space-y-1.5">
                  {selectedMask.windows.map((win, idx) => {
                    const widthNm = Math.round(win.xEnd - win.xStart);
                    const widthUm = (widthNm / 1000).toFixed(2);
                    const wExpr = win.paramBindings?.width;
                    const xStartExpr = win.paramBindings?.xStart;
                    const xEndExpr = win.paramBindings?.xEnd;
                    const activeBindField =
                      openWinBind?.winId === win.id ? openWinBind.field : null;
                    const isArrayOpen = arraySourceWinId === win.id;
                    const isSelected = selectedWindowIds.includes(win.id);
                    const featLabel = selectedMask.maskField === 'light-field' ? 'Blocker' : 'Window';

                    return (
                      <div
                        key={`m_${win.id || idx}`}
                        onClick={(e) =>
                          toggleWindowSelection(win.id, e.shiftKey || e.ctrlKey || e.metaKey)
                        }
                        className={`p-2 rounded-lg border space-y-1.5 cursor-pointer ${
                          isSelected
                            ? 'bg-sky-950/25 border-sky-500/50'
                            : 'bg-slate-950/60 border-slate-800'
                        }`}
                      >
                        <div className="flex items-center justify-between text-xs gap-2">
                          <div className="flex items-center gap-1.5 font-mono text-slate-200 font-semibold min-w-0">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleWindowSelection(win.id, true);
                              }}
                              className={`w-4 h-4 rounded border flex items-center justify-center transition-colors shrink-0 ${
                                isSelected
                                  ? 'bg-sky-600 border-sky-400 text-white'
                                  : 'bg-slate-900 border-slate-600'
                              }`}
                            >
                              {isSelected && <Check className="w-2.5 h-2.5" />}
                            </button>
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: selectedMask.color || '#38bdf8' }}
                            />
                            <span>W-{idx + 1}</span>
                            <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20 text-[10px]">
                              {formatCoordDisplay(widthNm, apertureUnit, 3)}
                            </span>
                            <ParamBindingBadge
                              expression={wExpr}
                              isOpen={activeBindField === 'width'}
                              onToggle={() => {
                                setArraySourceWinId(null);
                                setOpenWinBind(
                                  activeBindField === 'width'
                                    ? null
                                    : { winId: win.id, field: 'width' }
                                );
                              }}
                              compact
                            />
                          </div>
                          <div className="flex items-center gap-0.5 shrink-0">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleWindowAlignKey(win.id);
                              }}
                              className={`p-1.5 rounded-lg transition-colors ${
                                win.isAlignKey
                                  ? 'text-cyan-300 bg-cyan-500/20'
                                  : 'text-slate-400 hover:text-cyan-300 hover:bg-cyan-500/10'
                              }`}
                              title={
                                win.isAlignKey
                                  ? `Unmark ${featLabel} as Align Key`
                                  : `Define ${featLabel} as Align Key`
                              }
                            >
                              <Crosshair className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDuplicateWindow(win.id);
                              }}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-sky-300 hover:bg-sky-500/10 transition-colors"
                              title={`Duplicate ${featLabel}`}
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedWindowIds([win.id]);
                                setOpenWinBind(null);
                                setArraySourceWinId((prev) =>
                                  prev === win.id ? null : win.id
                                );
                              }}
                              className={`p-1.5 rounded-lg transition-colors ${
                                isArrayOpen
                                  ? 'text-sky-300 bg-sky-500/20'
                                  : 'text-slate-400 hover:text-sky-300 hover:bg-sky-500/10'
                              }`}
                              title={`Make 1D array from ${featLabel}`}
                            >
                              <LayoutGrid className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRemoveWindow(win.id);
                              }}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-950/30 transition-colors"
                              title="Delete this aperture"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-[10px] font-mono text-slate-400">
                                Start X₁ ({apertureUnit === 'um' ? `${Math.round(win.xStart)} nm` : `${(win.xStart / 1000).toFixed(2)} µm`})
                              </span>
                              <ParamBindingBadge
                                expression={xStartExpr}
                                isOpen={activeBindField === 'xStart'}
                                onToggle={() =>
                                  setOpenWinBind(
                                    activeBindField === 'xStart'
                                      ? null
                                      : { winId: win.id, field: 'xStart' }
                                  )
                                }
                                compact
                              />
                            </div>
                            <CoordNumberInput
                              valueNm={win.xStart}
                              unit={apertureUnit}
                              minNm={0}
                              maxNm={waferWidth}
                              liveMaxNm={win.xEnd}
                              disabled={Boolean(xStartExpr)}
                              title={
                                xStartExpr
                                  ? `Bound to: ${xStartExpr}`
                                  : `Start X₁ (${apertureUnit === 'um' ? 'µm' : 'nm'})`
                              }
                              onCommitNm={(valNm) => handleUpdateWindowCoord(win.id, 'xStart', valNm)}
                              className={`w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border font-mono text-xs focus:outline-none ${
                                xStartExpr
                                  ? 'border-violet-500/50 text-violet-300 opacity-75 cursor-not-allowed'
                                  : 'border-slate-700 text-slate-100 focus:border-sky-500'
                              }`}
                            />
                          </div>
                          <div className="space-y-1">
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-[10px] font-mono text-slate-400">
                                End X₂ ({apertureUnit === 'um' ? `${Math.round(win.xEnd)} nm` : `${(win.xEnd / 1000).toFixed(2)} µm`})
                              </span>
                              <ParamBindingBadge
                                expression={xEndExpr}
                                isOpen={activeBindField === 'xEnd'}
                                onToggle={() =>
                                  setOpenWinBind(
                                    activeBindField === 'xEnd'
                                      ? null
                                      : { winId: win.id, field: 'xEnd' }
                                  )
                                }
                                compact
                              />
                            </div>
                            <CoordNumberInput
                              valueNm={win.xEnd}
                              unit={apertureUnit}
                              minNm={0}
                              maxNm={waferWidth}
                              liveMinNm={win.xStart}
                              disabled={Boolean(xEndExpr)}
                              title={
                                xEndExpr
                                  ? `Bound to: ${xEndExpr}`
                                  : `End X₂ (${apertureUnit === 'um' ? 'µm' : 'nm'})`
                              }
                              onCommitNm={(valNm) => handleUpdateWindowCoord(win.id, 'xEnd', valNm)}
                              className={`w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border font-mono text-xs focus:outline-none ${
                                xEndExpr
                                  ? 'border-violet-500/50 text-violet-300 opacity-75 cursor-not-allowed'
                                  : 'border-slate-700 text-slate-100 focus:border-sky-500'
                              }`}
                            />
                          </div>
                        </div>

                        {isArrayOpen && (
                          <MaskWindowArrayPanel
                            sourceWindow={win}
                            sourceIndex={idx}
                            waferWidth={waferWidth}
                            featureNounCap={featLabel}
                            unit={apertureUnit}
                            onApply={(opts) => handleCreateWindowArray(win.id, opts)}
                            onClose={() => setArraySourceWinId(null)}
                          />
                        )}

                        {activeBindField && (
                          <ParamBindingPanel
                            expression={win.paramBindings?.[activeBindField]}
                            variables={variables}
                            waferWidth={waferWidth}
                            currentValue={
                              activeBindField === 'width'
                                ? Math.max(10, widthNm)
                                : activeBindField === 'xStart'
                                ? win.xStart
                                : win.xEnd
                            }
                            unit={apertureUnit}
                            suggestedVarName={
                              activeBindField === 'width'
                                ? `win_${idx + 1}_w`
                                : activeBindField === 'xStart'
                                ? `win_${idx + 1}_x1`
                                : `win_${idx + 1}_x2`
                            }
                            targetLabel={`${selectedMask.layerCode || selectedMask.name} · ${featLabel} #${idx + 1} · ${
                              activeBindField === 'width'
                                ? 'Width ΔX'
                                : activeBindField === 'xStart'
                                ? 'Start X₁'
                                : 'End X₂'
                            }`}
                            onChangeExpression={(expr) =>
                              handleUpdateWindowBinding(win.id, activeBindField, expr)
                            }
                            onCreateAndBind={(name, val, unit, desc) =>
                              handleCreateAndBindWindowVar(win.id, activeBindField, name, val, unit, desc)
                            }
                            onOpenVariablesModal={onOpenVariablesModal}
                            onClose={() => setOpenWinBind(null)}
                          />
                        )}
                      </div>
                    );
                  })}

                  {selectedMask.windows.length === 0 && (
                    <div className="p-4 text-center text-xs text-slate-500 italic border border-slate-800 rounded-xl bg-slate-950/40">
                      {selectedMask.maskField === 'light-field'
                        ? 'No chrome blockers defined (100% clear quartz light field). Tap "Add Blocker" or pick a preset above.'
                        : 'No apertures defined (0% clear dark field). Tap "Add Window" or pick a preset above.'}
                    </div>
                  )}
                </div>

                {/* Desktop & Tablet Precision Numeric Table (>= sm) */}
                <div className="hidden sm:block border border-slate-800 rounded-lg overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-900/90 text-[10px] text-slate-400 font-mono uppercase tracking-wider border-b border-slate-800">
                      <tr>
                        <th className="pl-2.5 pr-1 py-1.5 w-6">
                          <button
                            type="button"
                            onClick={() => {
                              const allSel =
                                selectedMask.windows.length > 0 &&
                                selectedWindowIds.length === selectedMask.windows.length;
                              setSelectedWindowIds(
                                allSel ? [] : selectedMask.windows.map((w) => w.id)
                              );
                            }}
                            className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${
                              selectedMask.windows.length > 0 &&
                              selectedWindowIds.length === selectedMask.windows.length
                                ? 'bg-sky-600 border-sky-400 text-white'
                                : 'bg-slate-950 border-slate-600 hover:border-slate-400'
                            }`}
                            title="Select / deselect all rows"
                          >
                            {selectedMask.windows.length > 0 &&
                              selectedWindowIds.length === selectedMask.windows.length && (
                                <Check className="w-2.5 h-2.5" />
                              )}
                          </button>
                        </th>
                        <th className="px-2 py-1.5">
                          {selectedMask.maskField === 'light-field' ? 'Blocker' : 'Window'}
                        </th>
                        <th className="px-2 py-1.5">Start X₁ ({apertureUnit === 'um' ? 'µm' : 'nm'})</th>
                        <th className="px-2 py-1.5">End X₂ ({apertureUnit === 'um' ? 'µm' : 'nm'})</th>
                        <th className="px-2 py-1.5">Width ΔX ({apertureUnit === 'um' ? 'µm' : 'nm'})</th>
                        <th className="px-2 py-1.5 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/80 bg-slate-950/40">
                      {selectedMask.windows.map((win, idx) => {
                        const widthNm = Math.round(win.xEnd - win.xStart);
                        const widthUm = (widthNm / 1000).toFixed(2);
                        const wExpr = win.paramBindings?.width;
                        const xStartExpr = win.paramBindings?.xStart;
                        const xEndExpr = win.paramBindings?.xEnd;
                        const activeBindField =
                          openWinBind?.winId === win.id ? openWinBind.field : null;
                        const isArrayOpen = arraySourceWinId === win.id;
                        const isRowSelected = selectedWindowIds.includes(win.id);
                        const featLabel = selectedMask.maskField === 'light-field' ? 'Blocker' : 'Window';

                        return (
                          <React.Fragment key={win.id || `row_${idx}`}>
                            <tr
                              onClick={(e) =>
                                toggleWindowSelection(win.id, e.shiftKey || e.ctrlKey || e.metaKey)
                              }
                              className={`hover:bg-slate-900/40 transition-colors cursor-pointer ${
                                isRowSelected ? 'bg-sky-950/20' : ''
                              }`}
                            >
                              <td className="pl-2.5 pr-1 py-1">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleWindowSelection(win.id, true);
                                  }}
                                  className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${
                                    isRowSelected
                                      ? 'bg-sky-600 border-sky-400 text-white'
                                      : 'bg-slate-900 border-slate-600 hover:border-slate-400'
                                  }`}
                                  title={isRowSelected ? 'Deselect' : 'Add to selection'}
                                >
                                  {isRowSelected && <Check className="w-2.5 h-2.5" />}
                                </button>
                              </td>
                              <td className="px-2 py-1 font-mono text-[11px] text-slate-300 whitespace-nowrap">
                                <span
                                  className="inline-block w-2 h-2 rounded-full mr-1.5"
                                  style={{
                                    backgroundColor: win.isAlignKey
                                      ? '#22d3ee'
                                      : selectedMask.color || '#38bdf8',
                                  }}
                                />
                                <span>W-{idx + 1}</span>
                                {win.isAlignKey && (
                                  <span
                                    className="ml-1.5 inline-flex items-center gap-0.5 px-1 py-0 rounded-xs bg-cyan-500/15 border border-cyan-500/40 text-[9px] font-semibold text-cyan-300"
                                    title="Defined as Alignment Key shape"
                                  >
                                    KEY
                                  </span>
                                )}
                              </td>

                              <td className="px-2 py-1">
                                <div className="flex items-center gap-1">
                                  <CoordNumberInput
                                    valueNm={win.xStart}
                                    unit={apertureUnit}
                                    minNm={0}
                                    maxNm={waferWidth}
                                    liveMaxNm={win.xEnd}
                                    disabled={Boolean(xStartExpr)}
                                    title={
                                      xStartExpr
                                        ? `Bound to: ${xStartExpr}`
                                        : `Start X₁ (${apertureUnit === 'um' ? 'µm' : 'nm'})`
                                    }
                                    onCommitNm={(valNm) => handleUpdateWindowCoord(win.id, 'xStart', valNm)}
                                    className={`w-20 px-1.5 py-0.5 rounded bg-slate-900 border font-mono text-[11px] tabular-nums focus:outline-none ${
                                      xStartExpr
                                        ? 'border-violet-500/50 text-violet-300 opacity-75 cursor-not-allowed'
                                        : 'border-slate-700 text-slate-100 focus:border-sky-500'
                                    }`}
                                  />
                                  <ParamBindingBadge
                                    expression={xStartExpr}
                                    isOpen={activeBindField === 'xStart'}
                                    onToggle={() =>
                                      setOpenWinBind(
                                        activeBindField === 'xStart'
                                          ? null
                                          : { winId: win.id, field: 'xStart' }
                                      )
                                    }
                                    compact
                                  />
                                  <span className="text-[10px] text-slate-500 font-mono tabular-nums">
                                    {apertureUnit === 'um' ? `${Math.round(win.xStart)}nm` : `${(win.xStart / 1000).toFixed(2)}µm`}
                                  </span>
                                </div>
                              </td>

                              <td className="px-2 py-1">
                                <div className="flex items-center gap-1">
                                  <CoordNumberInput
                                    valueNm={win.xEnd}
                                    unit={apertureUnit}
                                    minNm={0}
                                    maxNm={waferWidth}
                                    liveMinNm={win.xStart}
                                    disabled={Boolean(xEndExpr)}
                                    title={
                                      xEndExpr
                                        ? `Bound to: ${xEndExpr}`
                                        : `End X₂ (${apertureUnit === 'um' ? 'µm' : 'nm'})`
                                    }
                                    onCommitNm={(valNm) => handleUpdateWindowCoord(win.id, 'xEnd', valNm)}
                                    className={`w-20 px-1.5 py-0.5 rounded bg-slate-900 border font-mono text-[11px] tabular-nums focus:outline-none ${
                                      xEndExpr
                                        ? 'border-violet-500/50 text-violet-300 opacity-75 cursor-not-allowed'
                                        : 'border-slate-700 text-slate-100 focus:border-sky-500'
                                    }`}
                                  />
                                  <ParamBindingBadge
                                    expression={xEndExpr}
                                    isOpen={activeBindField === 'xEnd'}
                                    onToggle={() =>
                                      setOpenWinBind(
                                        activeBindField === 'xEnd'
                                          ? null
                                          : { winId: win.id, field: 'xEnd' }
                                      )
                                    }
                                    compact
                                  />
                                  <span className="text-[10px] text-slate-500 font-mono tabular-nums">
                                    {apertureUnit === 'um' ? `${Math.round(win.xEnd)}nm` : `${(win.xEnd / 1000).toFixed(2)}µm`}
                                  </span>
                                </div>
                              </td>

                              <td className="px-2 py-1">
                                <div className="flex items-center gap-1">
                                  <CoordNumberInput
                                    valueNm={widthNm}
                                    unit={apertureUnit}
                                    minNm={10}
                                    maxNm={waferWidth}
                                    disabled={Boolean(wExpr)}
                                    title={
                                      wExpr
                                        ? `Bound to: ${wExpr}`
                                        : `Edit width ΔX in ${apertureUnit === 'um' ? 'µm' : 'nm'} (keeps feature centered)`
                                    }
                                    onCommitNm={(valNm) => handleUpdateWindowWidth(win.id, valNm)}
                                    className={`w-20 px-1.5 py-0.5 rounded bg-slate-900 border font-mono text-[11px] tabular-nums font-semibold focus:outline-none ${
                                      wExpr
                                        ? 'border-violet-500/50 text-violet-300 opacity-75 cursor-not-allowed'
                                        : 'border-slate-700 text-amber-300 focus:border-sky-500'
                                    }`}
                                  />
                                  <ParamBindingBadge
                                    expression={wExpr}
                                    isOpen={activeBindField === 'width'}
                                    onToggle={() =>
                                      setOpenWinBind(
                                        activeBindField === 'width'
                                          ? null
                                          : { winId: win.id, field: 'width' }
                                      )
                                    }
                                    compact
                                  />
                                  <span className="text-[10px] text-slate-500 font-mono tabular-nums">
                                    {apertureUnit === 'um' ? `${widthNm}nm` : `${widthUm}µm`}
                                  </span>
                                </div>
                              </td>

                              <td className="px-2 py-1 text-right">
                                <div className="inline-flex items-center justify-end gap-0.5">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleToggleWindowAlignKey(win.id);
                                    }}
                                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium transition-colors ${
                                      win.isAlignKey
                                        ? 'bg-cyan-500/20 border-cyan-500/60 text-cyan-200'
                                        : 'bg-slate-900 hover:bg-slate-800 border-slate-700/80 text-slate-400 hover:text-cyan-300'
                                    }`}
                                    title={
                                      win.isAlignKey
                                        ? `Unmark ${featLabel} W-${idx + 1} as Align Key`
                                        : `Define ${featLabel} W-${idx + 1} as Align Key`
                                    }
                                  >
                                    <Crosshair className="w-3 h-3" />
                                    <span>Key</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDuplicateWindow(win.id);
                                    }}
                                    className="p-1 rounded text-slate-400 hover:text-sky-300 hover:bg-sky-500/10 transition-colors"
                                    title={`Duplicate ${featLabel}`}
                                  >
                                    <Copy className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedWindowIds([win.id]);
                                      setOpenWinBind(null);
                                      setArraySourceWinId((prev) =>
                                        prev === win.id ? null : win.id
                                      );
                                    }}
                                    className={`p-1 rounded transition-colors ${
                                      isArrayOpen
                                        ? 'text-sky-300 bg-sky-500/20'
                                        : 'text-slate-400 hover:text-sky-300 hover:bg-sky-500/10'
                                    }`}
                                    title={`Make 1D array from ${featLabel}`}
                                  >
                                    <LayoutGrid className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleRemoveWindow(win.id);
                                    }}
                                    className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-950/30 transition-colors"
                                    title="Delete this aperture"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                            {isArrayOpen && (
                              <tr>
                                <td colSpan={6} className="px-3.5 pb-3 pt-0.5 bg-slate-950/75">
                                  <MaskWindowArrayPanel
                                    sourceWindow={win}
                                    sourceIndex={idx}
                                    waferWidth={waferWidth}
                                    featureNounCap={featLabel}
                                    unit={apertureUnit}
                                    onApply={(opts) => handleCreateWindowArray(win.id, opts)}
                                    onClose={() => setArraySourceWinId(null)}
                                  />
                                </td>
                              </tr>
                            )}
                            {activeBindField && (
                              <tr>
                                <td colSpan={6} className="px-3.5 pb-3 pt-0.5 bg-slate-950/75">
                                  <ParamBindingPanel
                                    expression={win.paramBindings?.[activeBindField]}
                                    variables={variables}
                                    waferWidth={waferWidth}
                                    currentValue={
                                      activeBindField === 'width'
                                        ? Math.max(10, widthNm)
                                        : activeBindField === 'xStart'
                                        ? win.xStart
                                        : win.xEnd
                                    }
                                    unit={apertureUnit}
                                    suggestedVarName={
                                      activeBindField === 'width'
                                        ? `win_${idx + 1}_w`
                                        : activeBindField === 'xStart'
                                        ? `win_${idx + 1}_x1`
                                        : `win_${idx + 1}_x2`
                                    }
                                    targetLabel={`${selectedMask.layerCode || selectedMask.name} · ${featLabel} #${idx + 1} · ${
                                      activeBindField === 'width'
                                        ? 'Width ΔX'
                                        : activeBindField === 'xStart'
                                        ? 'Start X₁'
                                        : 'End X₂'
                                    }`}
                                    onChangeExpression={(expr) =>
                                      handleUpdateWindowBinding(win.id, activeBindField, expr)
                                    }
                                    onCreateAndBind={(name, val, unit, desc) =>
                                      handleCreateAndBindWindowVar(win.id, activeBindField, name, val, unit, desc)
                                    }
                                    onOpenVariablesModal={onOpenVariablesModal}
                                    onClose={() => setOpenWinBind(null)}
                                  />
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}

                      {selectedMask.windows.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-4 py-6 text-center text-slate-500 italic">
                            {selectedMask.maskField === 'light-field'
                              ? 'No chrome blockers defined. This reticle is completely clear quartz (100% light field). Click "Add Blocker" or choose a preset above.'
                              : 'No apertures defined. This reticle is completely opaque chrome (0% clear dark field). Click "Add Window" or choose a preset above.'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center p-8 text-center text-slate-500">
              Select or create a photomask level on the left to configure apertures.
            </div>
          )}
            </div>

            {/* RIGHT SIDE PANEL: Stacked Cross-Section Previews (Selected Mask over Final) */}
            {(showSelectedMaskInset || showFinalStepInset) && (
              <aside
                className={`flex flex-col border-t md:border-t-0 md:border-l border-slate-800 bg-slate-900/75 shrink-0 min-h-0 max-h-[42vh] md:max-h-none transition-all ${
                  insetExpanded
                    ? 'w-full md:w-80 lg:w-[22rem] xl:w-[26rem]'
                    : 'w-full md:w-64 lg:w-72 xl:w-80'
                }`}
              >
                {/* Right Panel Header */}
                <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-slate-800 bg-slate-950/70 shrink-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <PanelRight className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    <span className="text-[10.5px] font-bold uppercase tracking-wider text-slate-200 truncate">
                      Cross-Sections
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => setInsetExpanded((v) => !v)}
                      className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                      title={insetExpanded ? 'Narrow cross-section panel' : 'Widen cross-section panel'}
                    >
                      {insetExpanded ? (
                        <Minimize2 className="w-3.5 h-3.5" />
                      ) : (
                        <Maximize2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowSelectedMaskInset(false);
                        setShowFinalStepInset(false);
                      }}
                      className="p-1 rounded text-slate-400 hover:text-rose-300 hover:bg-slate-800 transition-colors"
                      title="Hide cross-section panel"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Stacked Cross-Section Cards (Selection on top, Final below) */}
                <div className="flex-1 flex flex-col gap-2 p-2 overflow-y-auto min-h-0">
                  {[
                    selectedMaskInsetData
                      ? {
                          key: 'selected-mask' as const,
                          label: 'SELECTED MASK',
                          accentBorder: 'border-sky-500/40',
                          dotClass: 'bg-sky-400',
                          badgeClass: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
                          patternPrefix: 'reticle-sel-inset-',
                          data: selectedMaskInsetData,
                          onCloseInset: () => setShowSelectedMaskInset(false),
                        }
                      : null,
                    finalInsetData
                      ? {
                          key: 'final' as const,
                          label: 'FINAL',
                          accentBorder: 'border-emerald-500/40',
                          dotClass: 'bg-emerald-400',
                          badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
                          patternPrefix: 'reticle-fin-inset-',
                          data: finalInsetData,
                          onCloseInset: () => setShowFinalStepInset(false),
                        }
                      : null,
                  ]
                    .filter((item): item is NonNullable<typeof item> => item !== null)
                    .map((item) => {
                      const {
                        isUnassigned,
                        mesh,
                        polygons,
                        rawStepIndex,
                        stepNumber,
                        title,
                        isSubstrate,
                        isDisabled,
                        variantName,
                        isInactiveVariant,
                        maskName,
                        maskCode,
                        maskColor,
                      } = item.data;

                      if (isUnassigned || !mesh) {
                        return (
                          <div
                            key={item.key}
                            className={`flex-1 min-h-[168px] flex flex-col bg-slate-950/90 border ${item.accentBorder} rounded-xl shadow-lg overflow-hidden`}
                          >
                            <div className="flex items-center justify-between gap-1.5 px-2.5 py-1.5 bg-slate-950 border-b border-slate-800 text-[11px] shrink-0">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className={`w-1.5 h-1.5 rounded-full ${item.dotClass} shrink-0`} />
                                <span
                                  className={`px-1 py-0.5 rounded font-mono text-[9px] font-semibold shrink-0 border ${item.badgeClass}`}
                                >
                                  {item.label}
                                </span>
                                <span className="text-slate-400 font-mono text-[10px] truncate">
                                  Unassigned
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={item.onCloseInset}
                                className="p-1 rounded text-slate-400 hover:text-rose-300 hover:bg-slate-800 transition-colors shrink-0"
                                title="Hide selected mask cross-section"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                            <div className="flex-1 flex flex-col items-center justify-center p-4 text-center bg-[#060a12] gap-2">
                              <div className="flex items-center gap-1.5 text-[11px] text-slate-300 font-medium max-w-full">
                                <span
                                  className="w-2 h-2 rounded-full shrink-0"
                                  style={{ backgroundColor: maskColor }}
                                />
                                <span className="truncate">
                                  {maskCode ? `${maskCode} · ` : ''}
                                  {maskName}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-500 leading-relaxed max-w-[220px]">
                                Reticle not assigned to a lithography step. Assign it to a step to preview its cross-section.
                              </p>
                            </div>
                          </div>
                        );
                      }

                      const insetVbW = 320;
                      const insetVbH = 186;
                      const padX = 14;
                      const padY = 14;
                      const availW = insetVbW - padX * 2;
                      const availH = insetVbH - padY * 2;

                      let fMinX = 0;
                      let fMaxX = waferWidth;
                      let fMinY = mesh.minY ?? 0;
                      let fMaxY = Math.max(mesh.maxY ?? 3000, 2500);
                      for (const poly of polygons) {
                        if (poly.xMin < fMinX) fMinX = poly.xMin;
                        if (poly.xMax > fMaxX) fMaxX = poly.xMax;
                        if (poly.yMin < fMinY) fMinY = poly.yMin;
                        if (poly.yMax > fMaxY) fMaxY = poly.yMax;
                        for (const p of poly.points) {
                          if (p.x < fMinX) fMinX = p.x;
                          if (p.x > fMaxX) fMaxX = p.x;
                          if (p.y < fMinY) fMinY = p.y;
                          if (p.y > fMaxY) fMaxY = p.y;
                        }
                      }

                      const fSpanX = Math.max(100, fMaxX - fMinX);
                      const fSpanY = Math.max(300, fMaxY - fMinY);
                      const rawSx = availW / fSpanX;
                      const rawSy = (availH * 0.65) / fSpanY;
                      const rawWaferH = fSpanY * rawSy;
                      const fitFactor = rawWaferH > availH ? availH / rawWaferH : 1;
                      const insetSx = rawSx * fitFactor;
                      const insetSy = rawSy * fitFactor;
                      const insetOffsetX = (insetVbW - fSpanX * insetSx) / 2 - fMinX * insetSx;
                      const insetCenterY = insetVbH / 2 + (fSpanY * insetSy) / 2;

                      const toInset = (x: number, y: number) => ({
                        x: insetOffsetX + x * insetSx,
                        y: insetCenterY - (y - fMinY) * insetSy,
                      });

                      const buildInsetPath = (pts: { x: number; y: number }[]) => {
                        if (pts.length < 3) return '';
                        const first = toInset(pts[0].x, pts[0].y);
                        let d = `M ${first.x.toFixed(1)} ${first.y.toFixed(1)}`;
                        for (let i = 1; i < pts.length; i++) {
                          const pt = toInset(pts[i].x, pts[i].y);
                          d += ` L ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
                        }
                        return d + ' Z';
                      };

                      const datumLeft = toInset(fMinX, fMinY);
                      const datumRight = toInset(fMaxX, fMinY);

                      return (
                        <div
                          key={item.key}
                          className={`flex-1 min-h-[168px] flex flex-col bg-slate-950/90 border ${item.accentBorder} rounded-xl shadow-lg overflow-hidden`}
                        >
                          <div className="flex items-center justify-between gap-1.5 px-2.5 py-1.5 bg-slate-950 border-b border-slate-800 text-[11px] shrink-0">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className={`w-1.5 h-1.5 rounded-full ${item.dotClass} shrink-0`} />
                              <span
                                className={`px-1 py-0.5 rounded font-mono text-[9px] font-semibold shrink-0 border ${item.badgeClass}`}
                              >
                                {item.label}
                              </span>
                              <span className="text-slate-300 font-mono text-[10px] shrink-0">
                                {isSubstrate ? 'Sub' : `${stepNumber}/${flow.steps.length}`}
                              </span>
                              <span
                                className="text-slate-400 truncate text-[10px]"
                                title={isDisabled ? `${title} (Skipped)` : title}
                              >
                                {title}
                              </span>
                            </div>
                            <div className="flex items-center gap-0.5 shrink-0">
                              {onSelectStepIndex && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    onSelectStepIndex(rawStepIndex);
                                    onClose();
                                  }}
                                  className="p-1 rounded text-slate-400 hover:text-sky-300 hover:bg-slate-800 transition-colors"
                                  title={
                                    isSubstrate
                                      ? 'Jump to Substrate in main viewer'
                                      : `Jump to Step ${stepNumber}/${flow.steps.length}`
                                  }
                                >
                                  <ArrowUpRight className="w-3 h-3" />
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={item.onCloseInset}
                                className="p-1 rounded text-slate-400 hover:text-rose-300 hover:bg-slate-800 transition-colors"
                                title={`Hide ${item.label.toLowerCase()} cross-section`}
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          </div>

                          {item.key === 'selected-mask' && (
                            <div className="flex items-center justify-between gap-1.5 px-2.5 py-1 bg-slate-900/90 border-b border-slate-800/80 text-[10px] shrink-0">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span
                                  className="w-2 h-2 rounded-full shrink-0"
                                  style={{ backgroundColor: maskColor }}
                                />
                                <span className="text-slate-200 font-medium truncate">
                                  {maskCode ? `${maskCode} · ` : ''}
                                  {maskName}
                                </span>
                              </div>
                              {variantName && (
                                <span
                                  className={`px-1.5 py-0.5 rounded font-mono text-[9px] shrink-0 border ${
                                    isInactiveVariant
                                      ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                                      : 'bg-sky-500/10 text-sky-300 border-sky-500/25'
                                  }`}
                                  title={
                                    isInactiveVariant
                                      ? 'Previewing cross-section with this inactive variant active'
                                      : 'Active step variant'
                                  }
                                >
                                  {variantName}
                                  {isInactiveVariant ? ' (preview)' : ''}
                                </span>
                              )}
                            </div>
                          )}

                          <div className="relative flex-1 min-h-[120px] w-full bg-[#060a12]">
                            <svg
                              viewBox={`0 0 ${insetVbW} ${insetVbH}`}
                              className="w-full h-full block pointer-events-none"
                              preserveAspectRatio="xMidYMid meet"
                            >
                              <SvgPatterns materials={flow.materials} idPrefix={item.patternPrefix} />

                              <g>
                                {polygons.map((poly) => {
                                  const mat = getMaterialById(flow.materials, poly.materialId);
                                  const d = buildInsetPath(poly.points);
                                  if (!d) return null;
                                  return (
                                    <path
                                      key={poly.id}
                                      d={d}
                                      fill={`url(#${item.patternPrefix}mat-fill-${mat.id})`}
                                      stroke={mat.strokeColor || '#1e293b'}
                                      strokeWidth="0.9"
                                    />
                                  );
                                })}
                              </g>

                              {mesh.mountedFrames &&
                                mesh.mountedFrames.map((frame, fIdx) => {
                                  const leftX = toInset(0, 0).x;
                                  const rightX = toInset(waferWidth, 0).x;
                                  const yTopPx = toInset(0, frame.yTop).y;
                                  const yBotPx = toInset(0, frame.yBottom).y;
                                  const yMinPx = Math.min(yTopPx, yBotPx);
                                  const clampH = Math.max(3, Math.abs(yBotPx - yTopPx));
                                  return (
                                    <g key={`reticle_inset_frame_${fIdx}_${frame.side}`}>
                                      <rect
                                        x={leftX - 8}
                                        y={yMinPx}
                                        width={8}
                                        height={clampH}
                                        fill="#0284c7"
                                        stroke="#38bdf8"
                                        strokeWidth="0.7"
                                      />
                                      <rect
                                        x={rightX}
                                        y={yMinPx}
                                        width={8}
                                        height={clampH}
                                        fill="#0284c7"
                                        stroke="#38bdf8"
                                        strokeWidth="0.7"
                                      />
                                    </g>
                                  );
                                })}

                              <line
                                x1={datumLeft.x}
                                y1={datumLeft.y}
                                x2={datumRight.x}
                                y2={datumRight.y}
                                stroke="#334155"
                                strokeWidth="0.7"
                                strokeDasharray="3 2"
                              />
                            </svg>

                            <div className="pointer-events-none absolute bottom-1 right-1.5 text-[9px] font-mono text-slate-500">
                              {isDisabled
                                ? 'Step skipped'
                                : `${((fMaxX - fMinX) / 1000).toFixed(1)} µm × ${
                                    thicknessUnit === 'um'
                                      ? `${((fMaxY - fMinY) / 1000).toFixed(2)} µm`
                                      : `${Math.round(fMaxY - fMinY)} nm`
                                  }`}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </aside>
            )}
          </div>
        </div>

        {/* Bottom Modal Footer (hidden on phones in 2D GDS tab to maximize canvas area) */}
        <div
          className={`${
            editorTab === 'gds' ? 'hidden sm:flex' : 'flex'
          } items-center justify-between gap-2 px-3 sm:px-4 py-1.5 sm:py-2 bg-slate-900 border-t border-slate-800 text-[11px] shrink-0`}
        >
          <span className="text-slate-400 truncate">
            Edits synchronize automatically with assigned lithography steps.
          </span>

          <button
            onClick={onClose}
            className="px-3.5 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold transition-colors shadow-sm active:scale-95 shrink-0"
          >
            Done
          </button>
        </div>

        {/* Transient Feedback Notice Banner */}
        {feedbackNotice && (
          <div
            className={`absolute top-16 left-1/2 -translate-x-1/2 z-40 px-4 py-2 rounded-xl shadow-xl border text-xs font-medium flex items-center gap-2 transition-all ${
              feedbackNotice.type === 'warn'
                ? 'bg-amber-950/90 text-amber-200 border-amber-500/50'
                : 'bg-slate-900/90 text-emerald-300 border-emerald-500/50'
            }`}
          >
            {feedbackNotice.type === 'warn' ? (
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            ) : (
              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
            )}
            <span>{feedbackNotice.message}</span>
          </div>
        )}
      </div>

      {/* Reassignment / Swap Conflict Confirmation Modal */}
      {conflictPrompt && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-amber-500/50 shadow-2xl p-6 space-y-5 text-slate-100">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center shrink-0">
                <ArrowLeftRight className="w-5 h-5 text-amber-400" />
              </div>
              <div className="space-y-1 flex-1">
                <h3 className="text-base font-bold text-white tracking-wide">
                  Swap Photomask Assignment?
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  <span className="font-semibold text-white">
                    Step {conflictPrompt.targetStepIndex}
                    {conflictPrompt.targetVariantName ? ` · ${conflictPrompt.targetVariantName}` : ''}:{' '}
                    {conflictPrompt.targetStepTitle}
                  </span>{' '}
                  already has mask{' '}
                  <span className="font-semibold text-amber-300">
                    {conflictPrompt.conflictingMask.layerCode ? `${conflictPrompt.conflictingMask.layerCode} ` : ''}
                    {conflictPrompt.conflictingMask.name}
                  </span>{' '}
                  assigned.
                </p>
                <p className="text-xs text-slate-400">
                  Do you want to assign <span className="font-medium text-sky-300">{conflictPrompt.currentMask.name}</span> to this{' '}
                  {conflictPrompt.targetVariantName ? 'variant' : 'step'}? If you accept, the mask will be swapped.
                </p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 text-xs text-slate-300 space-y-3">
              <div className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">
                Photomask Swap Summary
              </div>

              {conflictPrompt.currentMaskPriorStep ? (
                /* Two-way step swap */
                <div className="space-y-2.5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <div className="p-2.5 rounded-lg bg-sky-950/30 border border-sky-500/40">
                      <div className="text-[10px] text-sky-400 font-mono font-medium">
                        Step {conflictPrompt.targetStepIndex}
                        {conflictPrompt.targetVariantName ? ` · ${conflictPrompt.targetVariantName}` : ''}:{' '}
                        {conflictPrompt.targetStepTitle}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-1.5">
                        <span className="line-through text-slate-500 truncate">{conflictPrompt.conflictingMask.name}</span>
                        <span>→</span>
                        <span className="text-sky-300 font-semibold truncate">{conflictPrompt.currentMask.name}</span>
                      </div>
                    </div>

                    <div className="p-2.5 rounded-lg bg-amber-950/30 border border-amber-500/40">
                      <div className="text-[10px] text-amber-400 font-mono font-medium">
                        Step {conflictPrompt.currentMaskPriorStep.index}
                        {conflictPrompt.currentMaskPriorStep.variantName
                          ? ` · ${conflictPrompt.currentMaskPriorStep.variantName}`
                          : ''}
                        : {conflictPrompt.currentMaskPriorStep.title}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-1.5">
                        <span className="line-through text-slate-500 truncate">{conflictPrompt.currentMask.name}</span>
                        <span>→</span>
                        <span className="text-amber-300 font-semibold truncate">{conflictPrompt.conflictingMask.name}</span>
                      </div>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-normal">
                    Both process step slots will exchange their photomasks and update their aperture layouts and resist polarities automatically.
                  </p>
                </div>
              ) : (
                /* One-way step swap with unassigned reticle */
                <div className="space-y-2.5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <div className="p-2.5 rounded-lg bg-sky-950/30 border border-sky-500/40">
                      <div className="text-[10px] text-sky-400 font-mono font-medium">
                        Step {conflictPrompt.targetStepIndex}
                        {conflictPrompt.targetVariantName ? ` · ${conflictPrompt.targetVariantName}` : ''}:{' '}
                        {conflictPrompt.targetStepTitle}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-1.5">
                        <span className="line-through text-slate-500 truncate">{conflictPrompt.conflictingMask.name}</span>
                        <span>→</span>
                        <span className="text-sky-300 font-semibold truncate">{conflictPrompt.currentMask.name}</span>
                      </div>
                    </div>

                    <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-700">
                      <div className="text-[10px] text-slate-400 font-mono font-medium">
                        Previous Reticle Status
                      </div>
                      <div className="text-[11px] text-amber-300 font-semibold mt-1 truncate">
                        {conflictPrompt.conflictingMask.name}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        Swapped out to Unassigned in library
                      </div>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-normal">
                    <span className="text-sky-300 font-medium">{conflictPrompt.currentMask.name}</span> will take over Step {conflictPrompt.targetStepIndex}
                    {conflictPrompt.targetVariantName ? ` (${conflictPrompt.targetVariantName})` : ''}, while{' '}
                    <span className="text-amber-200 font-medium">{conflictPrompt.conflictingMask.name}</span> will be swapped out to unassigned.
                  </p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={handleCancelConflictSwap}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors"
              >
                Cancel (Keep Current Mask)
              </button>
              <button
                type="button"
                onClick={handleConfirmConflictSwap}
                className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold shadow-lg shadow-amber-900/40 transition-colors flex items-center gap-1.5"
              >
                <ArrowLeftRight className="w-3.5 h-3.5" />
                <span>Confirm & Swap Mask</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
