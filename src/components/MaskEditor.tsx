/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  DesignVariable,
  GlobalAlignmentMark,
  LithographyConfig,
  MaskWindow,
  ProcessSide,
  ProcessStep,
  VariableUnit,
} from '../types/microfab';
import { resolveResistMaterialId } from '../lib/materials';
import {
  MaskWindowArrayOptions,
  createMaskWindowArray,
  deriveGlobalAlignmentMarkFromSelection,
  duplicateMaskWindow,
  getMaskArrowStepSizes,
} from '../lib/maskUtils';
import { getActiveStepVariant } from '../lib/variantUtils';
import { ParamBindingBadge, ParamBindingPanel } from './ParamBindingControl';
import { MaskWindowArrayPanel } from './MaskWindowArrayPanel';
import {
  Plus,
  Trash2,
  ArrowLeftRight,
  MoveHorizontal,
  GripVertical,
  Scan,
  Edit2,
  Check,
  Lock,
  Unlock,
  ChevronUp,
  ChevronDown,
  Copy,
  LayoutGrid,
  Undo2,
  Redo2,
  GitBranch,
  Eraser,
  Pin,
  X,
  Crosshair,
} from 'lucide-react';

const ALIGN_MARK_COLORS = ['#22d3ee', '#34d399', '#f472b6', '#a78bfa', '#fbbf24'];

interface MaskEditorProps {
  step: ProcessStep;
  waferWidth: number; // in nm
  onUpdateStep: (updated: ProcessStep) => void;
  onOpenMaskLevels?: () => void;
  alignmentMarks?: GlobalAlignmentMark[];
  onUpdateAlignmentMarks?: (marks: GlobalAlignmentMark[]) => void;
  isMinimized?: boolean;
  onToggleMinimize?: () => void;
  isPinned?: boolean;
  onTogglePin?: () => void;
  dockPosition?: 'top' | 'bottom';
  overlayExpand?: boolean;
  variables?: DesignVariable[];
  onCreateVariable?: (name: string, value: number, unit: VariableUnit, description?: string) => void;
  onOpenVariablesModal?: () => void;
}

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

interface UmInputProps {
  valueNm: number;
  minNm?: number;
  maxNm: number;
  stepUm?: string;
  disabled?: boolean;
  onCommitNm: (valNm: number) => void;
  title?: string;
  className?: string;
}

const UmNumberInput: React.FC<UmInputProps> = ({
  valueNm,
  minNm = 0,
  maxNm,
  stepUm = '0.05',
  disabled = false,
  onCommitNm,
  title,
  className,
}) => {
  const formatted = (valueNm / 1000).toFixed(2);
  const [isFocused, setIsFocused] = useState(false);
  const [draft, setDraft] = useState(formatted);

  useEffect(() => {
    if (!isFocused) {
      setDraft(formatted);
    }
  }, [formatted, isFocused]);

  return (
    <input
      type="number"
      step={stepUm}
      min={(minNm / 1000).toFixed(2)}
      max={(maxNm / 1000).toFixed(2)}
      disabled={disabled}
      value={isFocused ? draft : formatted}
      title={title}
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
        if (Number.isFinite(parsed) && parsed >= minNm / 1000) {
          onCommitNm(parsed * 1000);
        }
      }}
      onBlur={() => {
        const parsed = parseFloat(draft);
        if (Number.isFinite(parsed)) {
          onCommitNm(Math.max(minNm, Math.min(maxNm, parsed * 1000)));
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
      className={
        className ||
        `w-16 px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-100 text-right focus:outline-none focus:border-sky-500 ${
          disabled ? 'opacity-50 cursor-not-allowed text-slate-400' : ''
        }`
      }
    />
  );
};

export const MaskEditor: React.FC<MaskEditorProps> = ({
  step,
  waferWidth,
  onUpdateStep,
  onOpenMaskLevels,
  alignmentMarks = [],
  onUpdateAlignmentMarks,
  isMinimized: isMinimizedProp,
  onToggleMinimize,
  isPinned = false,
  onTogglePin,
  dockPosition = 'bottom',
  overlayExpand = false,
  variables = [],
  onCreateVariable,
  onOpenVariablesModal,
}) => {
  const litho = step.lithography;
  if (!litho) return null;

  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedWindowIds, setSelectedWindowIds] = useState<string[]>([]);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dragPreviewWindows, setDragPreviewWindows] = useState<MaskWindow[] | null>(null);
  const [trackMarquee, setTrackMarquee] = useState<TrackMarquee | null>(null);
  const [isEditingMaskName, setIsEditingMaskName] = useState<boolean>(false);
  const [editingMaskName, setEditingMaskName] = useState<string>(litho.maskName || '');
  const [internalMinimized, setInternalMinimized] = useState<boolean>(false);
  const [showCoordRows, setShowCoordRows] = useState<boolean>(true);
  const [showAlignPanel, setShowAlignPanel] = useState<boolean>(false);
  const [draggingMark, setDraggingMark] = useState<{
    id: string;
    startClientX: number;
    initialXNm: number;
  } | null>(null);
  const [markDragPreview, setMarkDragPreview] = useState<{ id: string; xNm: number } | null>(null);
  const [openWinBind, setOpenWinBind] = useState<{
    winId: string;
    field: 'width' | 'xStart' | 'xEnd';
  } | null>(null);
  const [arraySourceWinId, setArraySourceWinId] = useState<string | null>(null);
  const [branchNotice, setBranchNotice] = useState<string | null>(null);

  const activeVariant =
    step.variants && step.variants.length > 1 ? getActiveStepVariant(step) : null;
  const siblingVariantsSharingMask =
    activeVariant && litho.maskId && step.variants
      ? step.variants.filter(
          (v) =>
            v.id !== activeVariant.id &&
            v.type === 'lithography' &&
            v.lithography?.maskId === litho.maskId
        )
      : [];
  const isMaskSharedWithOtherVariant = siblingVariantsSharingMask.length > 0;
  const variantMaskEditMode: 'branch' | 'shared' = step.variantMaskEditMode || 'branch';
  const prevTrackMaskRef = useRef<{
    stepId: string;
    variantId?: string;
    maskId?: string;
    wasShared: boolean;
  }>({
    stepId: step.id,
    variantId: activeVariant?.id,
    maskId: litho.maskId,
    wasShared: isMaskSharedWithOtherVariant,
  });

  const isMinimized = isMinimizedProp ?? internalMinimized;
  const handleToggleMinimize =
    onToggleMinimize ?? (() => setInternalMinimized((prev) => !prev));

  const MAX_HISTORY = 60;
  const undoStackRef = useRef<LithographyConfig[]>([]);
  const redoStackRef = useRef<LithographyConfig[]>([]);
  const dragStartLithoRef = useRef<LithographyConfig | null>(null);
  const keyNudgeStartLithoRef = useRef<LithographyConfig | null>(null);
  const keyNudgeIdleTimerRef = useRef<number | null>(null);
  const liveWindowsRef = useRef<MaskWindow[] | null>(null);
  const pendingDragWindowsRef = useRef<MaskWindow[] | null>(null);
  const lastDragSigRef = useRef<string>('');
  const lastSimSyncTsRef = useRef<number>(0);
  const dragSyncRafRef = useRef<number | null>(null);
  const dragSyncTimeoutRef = useRef<number | null>(null);
  const latestStepRef = useRef(step);
  latestStepRef.current = step;
  const latestLithoRef = useRef(litho);
  latestLithoRef.current = litho;
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

  const commitLitho = useCallback(
    (nextLitho: LithographyConfig, options?: { skipHistory?: boolean }) => {
      if (!options?.skipHistory) {
        const prevLitho = latestLithoRef.current;
        if (JSON.stringify(prevLitho) !== JSON.stringify(nextLitho)) {
          undoStackRef.current = [
            ...undoStackRef.current.slice(-(MAX_HISTORY - 1)),
            prevLitho,
          ];
          redoStackRef.current = [];
          syncHistoryState();
        }
      }
      onUpdateStep({
        ...latestStepRef.current,
        lithography: nextLitho,
      });
    },
    [onUpdateStep, syncHistoryState]
  );

  const scheduleWindowsSync = useCallback(() => {
    if (dragSyncRafRef.current !== null || dragSyncTimeoutRef.current !== null) {
      return;
    }
    const flushSync = () => {
      dragSyncRafRef.current = null;
      dragSyncTimeoutRef.current = null;
      const nextWins = pendingDragWindowsRef.current;
      if (!nextWins) return;
      pendingDragWindowsRef.current = null;
      lastSimSyncTsRef.current = performance.now();
      commitLitho(
        {
          ...latestLithoRef.current,
          windows: nextWins,
        },
        { skipHistory: true }
      );
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
  }, [commitLitho]);

  const flushKeyboardNudge = useCallback(() => {
    clearKeyNudgeTimer();
    if (dragStateRef.current) return;
    const startSnap = keyNudgeStartLithoRef.current;
    const pendingWins = pendingDragWindowsRef.current;
    const liveWins = liveWindowsRef.current;
    if (!startSnap && !pendingWins && !liveWins) return;

    cancelPendingDragSync();
    keyNudgeStartLithoRef.current = null;
    pendingDragWindowsRef.current = null;
    liveWindowsRef.current = null;

    const finalWins = pendingWins ?? liveWins;
    const finalLitho = finalWins
      ? { ...latestLithoRef.current, windows: finalWins }
      : latestLithoRef.current;

    if (pendingWins) {
      commitLitho(finalLitho, { skipHistory: true });
    }

    if (startSnap && JSON.stringify(startSnap) !== JSON.stringify(finalLitho)) {
      undoStackRef.current = [
        ...undoStackRef.current.slice(-(MAX_HISTORY - 1)),
        startSnap,
      ];
      redoStackRef.current = [];
      syncHistoryState();
    }

    setDragPreviewWindows(null);
  }, [cancelPendingDragSync, clearKeyNudgeTimer, commitLitho, syncHistoryState]);

  const handleUndo = useCallback(() => {
    flushKeyboardNudge();
    if (undoStackRef.current.length === 0) return;
    const prevLitho = undoStackRef.current[undoStackRef.current.length - 1];
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    redoStackRef.current = [
      ...redoStackRef.current.slice(-(MAX_HISTORY - 1)),
      latestLithoRef.current,
    ];
    cancelPendingDragSync();
    clearKeyNudgeTimer();
    pendingDragWindowsRef.current = null;
    liveWindowsRef.current = null;
    dragStartLithoRef.current = null;
    keyNudgeStartLithoRef.current = null;
    setDragPreviewWindows(null);
    setDragState(null);
    setTrackMarquee(null);
    syncHistoryState();
    onUpdateStep({
      ...latestStepRef.current,
      lithography: prevLitho,
    });
  }, [cancelPendingDragSync, clearKeyNudgeTimer, flushKeyboardNudge, onUpdateStep, syncHistoryState]);

  const handleRedo = useCallback(() => {
    flushKeyboardNudge();
    if (redoStackRef.current.length === 0) return;
    const nextLitho = redoStackRef.current[redoStackRef.current.length - 1];
    redoStackRef.current = redoStackRef.current.slice(0, -1);
    undoStackRef.current = [
      ...undoStackRef.current.slice(-(MAX_HISTORY - 1)),
      latestLithoRef.current,
    ];
    cancelPendingDragSync();
    clearKeyNudgeTimer();
    pendingDragWindowsRef.current = null;
    liveWindowsRef.current = null;
    dragStartLithoRef.current = null;
    keyNudgeStartLithoRef.current = null;
    setDragPreviewWindows(null);
    setDragState(null);
    setTrackMarquee(null);
    syncHistoryState();
    onUpdateStep({
      ...latestStepRef.current,
      lithography: nextLitho,
    });
  }, [cancelPendingDragSync, clearKeyNudgeTimer, flushKeyboardNudge, onUpdateStep, syncHistoryState]);

  useEffect(() => {
    setIsEditingMaskName(false);
    setEditingMaskName(step.lithography?.maskName || '');
  }, [step.id, step.lithography?.maskName]);

  useEffect(() => {
    cancelPendingDragSync();
    clearKeyNudgeTimer();
    pendingDragWindowsRef.current = null;
    liveWindowsRef.current = null;
    dragStartLithoRef.current = null;
    keyNudgeStartLithoRef.current = null;
    setDragPreviewWindows(null);
    setDragState(null);
    setSelectedWindowIds([]);
    setArraySourceWinId(null);
    setOpenWinBind(null);
    setBranchNotice(null);
    undoStackRef.current = [];
    redoStackRef.current = [];
    setHistoryState({ canUndo: false, canRedo: false });
  }, [step.id, step.activeVariantId, cancelPendingDragSync, clearKeyNudgeTimer]);

  useEffect(() => {
    const prev = prevTrackMaskRef.current;
    const sameVariant =
      prev.stepId === step.id && prev.variantId === activeVariant?.id;
    let timer: number | undefined;

    if (
      sameVariant &&
      prev.wasShared &&
      !isMaskSharedWithOtherVariant &&
      litho.maskId &&
      litho.maskId !== prev.maskId &&
      activeVariant
    ) {
      setBranchNotice(
        `New mask branch detected for "${activeVariant.name}": created "${litho.maskName || 'Dedicated Reticle'}" in Mask Manager.`
      );
      timer = window.setTimeout(() => setBranchNotice(null), 4500);
    }

    prevTrackMaskRef.current = {
      stepId: step.id,
      variantId: activeVariant?.id,
      maskId: litho.maskId,
      wasShared: isMaskSharedWithOtherVariant,
    };

    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [
    step.id,
    activeVariant?.id,
    activeVariant?.name,
    litho.maskId,
    litho.maskName,
    isMaskSharedWithOtherVariant,
  ]);

  const handleSaveMaskName = () => {
    const trimmed = editingMaskName.trim();
    if (trimmed && trimmed !== litho.maskName) {
      commitLitho({
        ...litho,
        maskName: trimmed,
      });
    } else {
      setEditingMaskName(litho.maskName || '');
    }
    setIsEditingMaskName(false);
  };

  const windows = litho.windows || [];
  const displayWindows = dragPreviewWindows ?? windows;

  useEffect(() => {
    const validIds = new Set(windows.map((w) => w.id));
    setSelectedWindowIds((prev) => {
      const next = prev.filter((id) => validIds.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [windows]);

  // Keyboard shortcuts: Undo/Redo (Ctrl+Z / Ctrl+Y / Cmd+Shift+Z), Escape, Left/Right arrow nudging
  useEffect(() => {
    if (isMinimized) {
      flushKeyboardNudge();
      return;
    }

    const hasVisibleOverlay = () => {
      const overlays = document.querySelectorAll('.fixed.inset-0');
      for (let i = 0; i < overlays.length; i++) {
        const el = overlays[i];
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) return true;
      }
      return false;
    };

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
      if (hasVisibleOverlay()) return;

      if (isUndoRedo) {
        const keyLower = e.key.toLowerCase();
        if (keyLower === 'z') {
          e.preventDefault();
          if (e.shiftKey) {
            handleRedo();
          } else {
            handleUndo();
          }
          return;
        }
        if (keyLower === 'y' && !e.shiftKey) {
          e.preventDefault();
          handleRedo();
          return;
        }
      }

      if (isEscape) {
        if (selectedWindowIdsRef.current.length > 0) {
          setSelectedWindowIds([]);
        }
        return;
      }

      if (dragStateRef.current) return;

      const currentLitho = latestLithoRef.current;
      const currentWindows = liveWindowsRef.current ?? currentLitho.windows ?? [];
      const curSelectedIds = selectedWindowIdsRef.current;
      const targetIds =
        curSelectedIds.length > 0
          ? curSelectedIds
          : currentWindows.length === 1
          ? [currentWindows[0].id]
          : [];
      if (targetIds.length === 0) return;

      const selectedTargets = currentWindows.filter((w) => targetIds.includes(w.id));
      if (selectedTargets.length === 0) return;

      e.preventDefault();
      const curWaferWidth = waferWidthRef.current;
      const { fineNm, coarseNm } = getMaskArrowStepSizes(curWaferWidth);
      const nudgeNm = e.shiftKey ? coarseNm : fineNm;
      const deltaNm = e.key === 'ArrowLeft' ? -nudgeNm : nudgeNm;
      const minDelta = -Math.min(...selectedTargets.map((w) => w.xStart));
      const maxDelta = Math.min(...selectedTargets.map((w) => curWaferWidth - w.xEnd));
      const clampedDelta = Math.round(Math.max(minDelta, Math.min(maxDelta, deltaNm)));
      if (clampedDelta === 0) return;

      if (keyNudgeStartLithoRef.current === null) {
        keyNudgeStartLithoRef.current = currentLitho;
      }

      const selSet = new Set(selectedTargets.map((w) => w.id));
      const nextWindows = currentWindows.map((w) =>
        selSet.has(w.id)
          ? { ...w, xStart: w.xStart + clampedDelta, xEnd: w.xEnd + clampedDelta }
          : w
      );

      liveWindowsRef.current = nextWindows;
      pendingDragWindowsRef.current = nextWindows;
      setDragPreviewWindows(nextWindows);
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
  }, [isMinimized, handleUndo, handleRedo, scheduleWindowsSync, clearKeyNudgeTimer, flushKeyboardNudge]);

  const toggleWindowSelection = (id: string, additive: boolean) => {
    if (additive) {
      setSelectedWindowIds((prev) =>
        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      );
    } else {
      setSelectedWindowIds([id]);
    }
  };

  const handleAddWindow = () => {
    // Add default window in the center 1/3 of the wafer
    const start = Math.round(waferWidth * 0.35);
    const end = Math.round(waferWidth * 0.65);
    const newWin: MaskWindow = {
      id: `w_${Date.now()}`,
      xStart: start,
      xEnd: end,
    };
    commitLitho({
      ...litho,
      windows: [...windows, newWin],
    });
    setSelectedWindowIds([newWin.id]);
  };

  const handleRemoveWindow = (id: string) => {
    commitLitho({
      ...litho,
      windows: windows.filter((w) => w.id !== id),
    });
    setSelectedWindowIds((prev) => prev.filter((x) => x !== id));
    if (arraySourceWinId === id) setArraySourceWinId(null);
  };

  const handleRemoveSelectedWindows = (ids: string[]) => {
    if (ids.length === 0) return;
    const delSet = new Set(ids);
    commitLitho({
      ...litho,
      windows: windows.filter((w) => !delSet.has(w.id)),
    });
    setSelectedWindowIds([]);
    if (arraySourceWinId && delSet.has(arraySourceWinId)) {
      setArraySourceWinId(null);
    }
  };

  const handleClearTrack = () => {
    if (windows.length === 0) return;
    commitLitho({
      ...litho,
      windows: [],
    });
    setSelectedWindowIds([]);
    setArraySourceWinId(null);
    setOpenWinBind(null);
  };

  const handleDuplicateWindow = (id: string) => {
    const idx = windows.findIndex((w) => w.id === id);
    if (idx < 0) return;
    const dup = duplicateMaskWindow(windows[idx], waferWidth);
    const nextWindows = [
      ...windows.slice(0, idx + 1),
      dup,
      ...windows.slice(idx + 1),
    ];
    commitLitho({
      ...litho,
      windows: nextWindows,
    });
    setSelectedWindowIds([dup.id]);
    setArraySourceWinId(null);
  };

  const handleDuplicateSelectedWindows = (ids: string[]) => {
    if (ids.length === 0) return;
    if (ids.length === 1) {
      handleDuplicateWindow(ids[0]);
      return;
    }
    const selSet = new Set(ids);
    const newIds: string[] = [];
    const clones: MaskWindow[] = [];
    const baseTs = Date.now();
    windows.forEach((w, idx) => {
      if (!selSet.has(w.id)) return;
      const dup = {
        ...duplicateMaskWindow(w, waferWidth),
        id: `w_dup_${baseTs}_${idx}`,
      };
      clones.push(dup);
      newIds.push(dup.id);
    });
    commitLitho({
      ...litho,
      windows: [...windows, ...clones],
    });
    setSelectedWindowIds(newIds);
    setArraySourceWinId(null);
  };

  const handleShiftWindows = (ids: string[], deltaNm: number) => {
    if (ids.length === 0 || deltaNm === 0) return;
    const targets = windows.filter((w) => ids.includes(w.id));
    if (targets.length === 0) return;
    const minDelta = -Math.min(...targets.map((w) => w.xStart));
    const maxDelta = Math.min(...targets.map((w) => waferWidth - w.xEnd));
    const clampedDelta = Math.round(Math.max(minDelta, Math.min(maxDelta, deltaNm)));
    if (clampedDelta === 0) return;
    const selSet = new Set(targets.map((w) => w.id));
    commitLitho({
      ...litho,
      windows: windows.map((w) =>
        selSet.has(w.id)
          ? { ...w, xStart: w.xStart + clampedDelta, xEnd: w.xEnd + clampedDelta }
          : w
      ),
    });
  };

  const handleCreateWindowArray = (sourceId: string, options: MaskWindowArrayOptions) => {
    const res = createMaskWindowArray(windows, sourceId, options, waferWidth);
    commitLitho({
      ...litho,
      windows: res.windows,
    });
    setSelectedWindowIds(
      res.addedIds.length > 0 ? [res.addedIds[res.addedIds.length - 1]] : [sourceId]
    );
    setArraySourceWinId(null);
  };

  const handleUpdateWindowCoord = (
    id: string,
    field: 'xStart' | 'xEnd',
    val: number
  ) => {
    const roundedVal = Math.round(val);
    commitLitho({
      ...litho,
      windows: windows.map((w) => {
        if (w.id !== id) return w;

        if (w.fixedWidth) {
          const width = Math.max(10, w.xEnd - w.xStart);
          if (field === 'xStart') {
            const nextStart = Math.max(0, Math.min(waferWidth - width, roundedVal));
            return {
              ...w,
              xStart: nextStart,
              xEnd: nextStart + width,
            };
          } else {
            const nextEnd = Math.max(width, Math.min(waferWidth, roundedVal));
            return {
              ...w,
              xStart: nextEnd - width,
              xEnd: nextEnd,
            };
          }
        }

        const clamped = Math.max(0, Math.min(waferWidth, roundedVal));
        const updated = { ...w, [field]: clamped };
        // Ensure start <= end when unlocked
        if (updated.xStart > updated.xEnd) {
          if (field === 'xStart') updated.xEnd = updated.xStart;
          else updated.xStart = updated.xEnd;
        }
        return updated;
      }),
    });
  };

  const handleToggleFixedWidth = (id: string) => {
    commitLitho({
      ...litho,
      windows: windows.map((w) =>
        w.id === id ? { ...w, fixedWidth: !w.fixedWidth } : w
      ),
    });
  };

  const handleUpdateWindowWidth = (id: string, targetWidthNm: number) => {
    const clampedWidth = Math.max(10, Math.min(waferWidth, Math.round(targetWidthNm)));
    commitLitho({
      ...litho,
      windows: windows.map((w) => {
        if (w.id !== id || w.fixedWidth) return w;
        const center = (w.xStart + w.xEnd) / 2;
        const half = clampedWidth / 2;
        let nextStart = center - half;
        let nextEnd = center + half;

        // Keep requested width within wafer bounds if expanding past edge
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
      }),
    });
  };

  const handleUpdateWindowBinding = (
    id: string,
    field: 'width' | 'xStart' | 'xEnd',
    expr: string | undefined
  ) => {
    commitLitho({
      ...litho,
      windows: windows.map((w) => {
        if (w.id !== id) return w;
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
      }),
    });
  };

  const maskField = litho.maskField ?? 'dark-field';
  const isLightField = maskField === 'light-field';
  const featureNoun = isLightField ? 'blocker' : 'aperture';
  const featureNounCap = isLightField ? 'Blocker' : 'Aperture';
  const { fineNm: arrowFineNm, coarseNm: arrowCoarseNm } = getMaskArrowStepSizes(waferWidth);
  const formatNudgeLabel = (nm: number) =>
    nm >= 1000
      ? `${(nm / 1000).toFixed(2).replace(/\.?0+$/, '')} µm`
      : `${Math.round(nm)} nm`;

  const togglePolarity = () => {
    const newPol = litho.polarity === 'positive' ? 'negative' : 'positive';
    commitLitho({
      ...litho,
      polarity: newPol,
      resistMaterialId: resolveResistMaterialId(newPol, litho.resistMaterialId),
    });
  };

  const toggleMaskField = () => {
    const nextField = isLightField ? 'dark-field' : 'light-field';
    commitLitho({
      ...litho,
      maskField: nextField,
    });
  };

  const toggleDefinesAlignmentMarks = () => {
    commitLitho({
      ...litho,
      definesAlignmentMarks: !litho.definesAlignmentMarks,
    });
  };

  const handleToggleWindowAlignKey = (id: string) => {
    commitLitho({
      ...litho,
      windows: windows.map((w) =>
        w.id === id ? { ...w, isAlignKey: w.isAlignKey ? undefined : true } : w
      ),
    });
  };

  const handleToggleSelectedAlignKeys = (ids: string[]) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const allMarked = windows
      .filter((w) => idSet.has(w.id))
      .every((w) => Boolean(w.isAlignKey));
    const nextVal = allMarked ? undefined : true;
    commitLitho({
      ...litho,
      windows: windows.map((w) => (idSet.has(w.id) ? { ...w, isAlignKey: nextVal } : w)),
    });
  };

  const handleSyncMarksFromWindows = (overrideSelectedIds?: string[]) => {
    if (!onUpdateAlignmentMarks || windows.length === 0) return;
    const activeIds = overrideSelectedIds ?? selectedWindowIds;
    const selectedWins =
      activeIds.length > 0 ? windows.filter((w) => activeIds.includes(w.id)) : [];
    const { marks } = deriveGlobalAlignmentMarkFromSelection({
      existingMarks: alignmentMarks,
      selectedWindows: selectedWins,
      allWindows: windows,
      waferWidth,
      side: step.side,
      definedByStepId: step.id,
      palette: ALIGN_MARK_COLORS,
    });
    onUpdateAlignmentMarks(marks);
    if (!litho.definesAlignmentMarks) {
      commitLitho({ ...litho, definesAlignmentMarks: true });
    }
  };

  const handleAddAlignmentMark = () => {
    if (!onUpdateAlignmentMarks) return;
    const candidates = [0.1, 0.9, 0.5, 0.25, 0.75, 0.15, 0.85, 0.35, 0.65];
    let chosenX = Math.round((waferWidth * 0.1) / 50) * 50;
    for (const frac of candidates) {
      const candidate = Math.round((waferWidth * frac) / 50) * 50;
      if (!alignmentMarks.some((m) => Math.abs(m.xNm - candidate) < waferWidth * 0.04)) {
        chosenX = candidate;
        break;
      }
    }
    let idx = alignmentMarks.length + 1;
    let label = `AM-${idx}`;
    while (alignmentMarks.some((m) => m.label.toLowerCase() === label.toLowerCase())) {
      idx += 1;
      label = `AM-${idx}`;
    }
    const newMark: GlobalAlignmentMark = {
      id: `am_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      label,
      xNm: Math.max(0, Math.min(waferWidth, chosenX)),
      side: step.side === 'back' ? 'back' : step.side === 'both' ? 'both' : 'front',
      color: ALIGN_MARK_COLORS[alignmentMarks.length % ALIGN_MARK_COLORS.length],
      ...(litho.definesAlignmentMarks ? { definedByStepId: step.id } : {}),
    };
    onUpdateAlignmentMarks([...alignmentMarks, newMark]);
  };

  const handleUpdateAlignmentMark = (id: string, patch: Partial<GlobalAlignmentMark>) => {
    if (!onUpdateAlignmentMarks) return;
    onUpdateAlignmentMarks(
      alignmentMarks.map((m) =>
        m.id === id
          ? {
              ...m,
              ...patch,
              ...(patch.xNm !== undefined
                ? { xNm: Math.max(0, Math.min(waferWidth, Math.round(patch.xNm))) }
                : {}),
            }
          : m
      )
    );
  };

  const handleDeleteAlignmentMark = (id: string) => {
    if (!onUpdateAlignmentMarks) return;
    onUpdateAlignmentMarks(alignmentMarks.filter((m) => m.id !== id));
  };

  const handleMarkPointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    mark: GlobalAlignmentMark
  ) => {
    if (!onUpdateAlignmentMarks) return;
    e.preventDefault();
    e.stopPropagation();
    containerRef.current?.focus({ preventScroll: true });
    try {
      containerRef.current?.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    setDraggingMark({
      id: mark.id,
      startClientX: e.clientX,
      initialXNm: mark.xNm,
    });
    setMarkDragPreview({ id: mark.id, xNm: mark.xNm });
  };

  // Track background marquee drag start
  const handleTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !containerRef.current) return;
    containerRef.current.focus({ preventScroll: true });
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const nm = Math.max(0, Math.min(waferWidth, ((e.clientX - rect.left) / rect.width) * waferWidth));
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

  // Pointer drag start handler
  const handlePointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    win: MaskWindow,
    type: 'resize-start' | 'resize-end' | 'move'
  ) => {
    e.preventDefault();
    e.stopPropagation();
    flushKeyboardNudge();
    containerRef.current?.focus({ preventScroll: true });

    const isAdditive = e.shiftKey || e.ctrlKey || e.metaKey;
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
      const targets = windows
        .filter((w) => nextSet.has(w.id))
        .map((w) => ({ id: w.id, xStart: w.xStart, xEnd: w.xEnd }));
      dragStartLithoRef.current = latestLithoRef.current;
      lastDragSigRef.current = windows.map((w) => `${w.xStart}:${w.xEnd}`).join('|');
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
      moveTargets = windows
        .filter((w) => selSet.has(w.id))
        .map((w) => ({ id: w.id, xStart: w.xStart, xEnd: w.xEnd }));
    } else {
      setSelectedWindowIds([win.id]);
      moveTargets = [{ id: win.id, xStart: win.xStart, xEnd: win.xEnd }];
    }

    dragStartLithoRef.current = latestLithoRef.current;
    lastDragSigRef.current = windows.map((w) => `${w.xStart}:${w.xEnd}`).join('|');
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

  // Pointer move handler
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (draggingMark && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      if (rect.width > 0) {
        const pxToNm = waferWidth / rect.width;
        const deltaNm = (e.clientX - draggingMark.startClientX) * pxToNm;
        const snap = 50;
        const nextX = Math.max(
          0,
          Math.min(waferWidth, Math.round((draggingMark.initialXNm + deltaNm) / snap) * snap)
        );
        setMarkDragPreview({ id: draggingMark.id, xNm: nextX });
      }
      return;
    }

    if (trackMarquee && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
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

    if (!dragState || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;

    const pxToNm = waferWidth / rect.width;
    const deltaNm = (e.clientX - dragState.startClientX) * pxToNm;
    // Snap to 50 nm precision
    const snap = 50;
    const baseWindows = latestLithoRef.current.windows || [];

    let updatedWindows = baseWindows;

    if (dragState.type === 'resize-start') {
      const rawStart = dragState.initialXStart + deltaNm;
      const snappedStart = Math.round(rawStart / snap) * snap;
      // Minimum aperture width 100 nm
      const clampedStart = Math.max(0, Math.min(dragState.initialXEnd - 100, snappedStart));

      updatedWindows = baseWindows.map((w) =>
        w.id === dragState.winId ? { ...w, xStart: clampedStart } : w
      );
    } else if (dragState.type === 'resize-end') {
      const rawEnd = dragState.initialXEnd + deltaNm;
      const snappedEnd = Math.round(rawEnd / snap) * snap;
      const clampedEnd = Math.max(dragState.initialXStart + 100, Math.min(waferWidth, snappedEnd));

      updatedWindows = baseWindows.map((w) =>
        w.id === dragState.winId ? { ...w, xEnd: clampedEnd } : w
      );
    } else if (dragState.type === 'move') {
      const targets =
        dragState.initialWindows && dragState.initialWindows.length > 0
          ? dragState.initialWindows
          : [{ id: dragState.winId, xStart: dragState.initialXStart, xEnd: dragState.initialXEnd }];
      const snappedDelta = Math.round(deltaNm / snap) * snap;
      const minDelta = -Math.min(...targets.map((t) => t.xStart));
      const maxDelta = Math.min(...targets.map((t) => waferWidth - t.xEnd));
      const clampedDelta = Math.max(minDelta, Math.min(maxDelta, snappedDelta));
      const byId = new Map(
        targets.map((t) => [t.id, { xStart: t.xStart + clampedDelta, xEnd: t.xEnd + clampedDelta }])
      );

      updatedWindows = baseWindows.map((w) => {
        const next = byId.get(w.id);
        return next ? { ...w, xStart: next.xStart, xEnd: next.xEnd } : w;
      });
    }

    const sig = updatedWindows.map((w) => `${w.xStart}:${w.xEnd}`).join('|');
    if (sig === lastDragSigRef.current) return;
    lastDragSigRef.current = sig;

    // Instant local visual update on the track
    liveWindowsRef.current = updatedWindows;
    pendingDragWindowsRef.current = updatedWindows;
    setDragPreviewWindows(updatedWindows);

    // Throttle cross-section re-simulation to ~22fps max aligned with requestAnimationFrame
    scheduleWindowsSync();
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (draggingMark) {
      if (markDragPreview && markDragPreview.id === draggingMark.id) {
        handleUpdateAlignmentMark(draggingMark.id, { xNm: markDragPreview.xNm });
      }
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      setDraggingMark(null);
      setMarkDragPreview(null);
      return;
    }

    if (trackMarquee) {
      const distPx = Math.abs(e.clientX - trackMarquee.startClientX);
      if (distPx >= 4) {
        const minNm = Math.min(trackMarquee.startNm, trackMarquee.currentNm);
        const maxNm = Math.max(trackMarquee.startNm, trackMarquee.currentNm);
        const hitIds = windows
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
      const finalLitho = finalWins
        ? { ...latestLithoRef.current, windows: finalWins }
        : latestLithoRef.current;

      if (pendingWins) {
        commitLitho(finalLitho, { skipHistory: true });
      }

      if (dragStartLithoRef.current) {
        const startSnap = dragStartLithoRef.current;
        dragStartLithoRef.current = null;
        if (JSON.stringify(startSnap) !== JSON.stringify(finalLitho)) {
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

  if (isMinimized) {
    return (
      <div
        className={
          overlayExpand
            ? 'h-9 bg-slate-900 border border-slate-800 rounded-xl px-2.5 sm:px-3 text-slate-200 flex items-center justify-between gap-2'
            : 'bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5 text-slate-200 flex items-center justify-between gap-2'
        }
      >
        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
          <span className="text-[11px] font-semibold tracking-wider uppercase text-sky-400 shrink-0 hidden md:inline">
            Photomask Track
          </span>
          <span className="text-[11px] font-semibold tracking-wider uppercase text-sky-400 shrink-0 md:hidden">
            Mask
          </span>
          {step.side === 'back' && (
            <span className="text-[10px] font-mono font-semibold text-amber-300 shrink-0">
              · Backside
            </span>
          )}
          {step.side === 'both' && (
            <span className="text-[10px] font-mono font-semibold text-emerald-300 shrink-0">
              · Both Sides
            </span>
          )}
          <span className="text-xs text-slate-600 shrink-0">·</span>
          <span className="text-xs text-slate-200 font-mono truncate">
            {litho.maskName || 'Photomask Layer'}
          </span>
          {activeVariant && !isMaskSharedWithOtherVariant && (
            <span
              className="inline-flex items-center gap-1 text-[10px] font-medium shrink-0 text-violet-300"
              title="Dedicated mask branch assigned to this variant in Mask Manager."
            >
              <GitBranch className="w-2.5 h-2.5" />
              <span>{activeVariant.name}</span>
            </span>
          )}
          {activeVariant && isMaskSharedWithOtherVariant && (
            <div
              className="inline-flex items-center bg-slate-950 border border-slate-700/80 rounded-md p-0.5 text-[10px] shrink-0"
              title={`Reticle shared with ${siblingVariantsSharingMask.map((v) => v.name).join(', ')}`}
            >
              <button
                type="button"
                onClick={() =>
                  onUpdateStep({ ...latestStepRef.current, variantMaskEditMode: 'shared' })
                }
                className={`px-1.5 py-0.5 rounded font-medium transition-colors whitespace-nowrap shrink-0 ${
                  variantMaskEditMode === 'shared'
                    ? 'bg-sky-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title={`Carry edits to all variants sharing this reticle (${[activeVariant.name, ...siblingVariantsSharingMask.map((v) => v.name)].join(', ')})`}
              >
                Shared ({siblingVariantsSharingMask.length + 1})
              </button>
              <button
                type="button"
                onClick={() =>
                  onUpdateStep({ ...latestStepRef.current, variantMaskEditMode: 'branch' })
                }
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-medium transition-colors whitespace-nowrap shrink-0 ${
                  variantMaskEditMode === 'branch'
                    ? 'bg-violet-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Generate a new mask branch in Mask Manager when apertures are modified"
              >
                <GitBranch className="w-2.5 h-2.5" />
                <span>Branch</span>
              </button>
            </div>
          )}
          <span className="text-[11px] font-mono text-slate-500 shrink-0 hidden lg:inline tabular-nums">
            · {windows.length} {windows.length === 1 ? featureNoun : `${featureNoun}s`}
          </span>
        </div>

        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          {litho.definesAlignmentMarks && (
            <button
              type="button"
              onClick={() => {
                setShowAlignPanel(true);
                handleToggleMinimize();
              }}
              className="flex items-center gap-1 px-1.5 py-0.5 text-[10.5px] font-medium rounded-md bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/40 whitespace-nowrap shrink-0 transition-colors"
              title="This lithography step defines substrate alignment marks — click to configure"
            >
              <Crosshair className="w-3 h-3 shrink-0" />
              <span className="hidden sm:inline">Align Marks</span>
            </button>
          )}

          <button
            type="button"
            onClick={toggleMaskField}
            className={`flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
              isLightField
                ? 'bg-sky-950/60 hover:bg-sky-900/60 text-sky-200 border-sky-500/50'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
            }`}
            title={
              isLightField
                ? 'Light-Field Mask: clear quartz background; movable blocks are opaque chrome blockers. Click to switch to Dark-Field.'
                : 'Dark-Field Mask: opaque chrome background; movable blocks are clear UV apertures. Click to switch to Light-Field.'
            }
          >
            <span
              className={`w-2.5 h-2.5 rounded-xs border shrink-0 flex items-center justify-center ${
                isLightField
                  ? 'bg-sky-200/85 border-sky-300'
                  : 'bg-slate-950 border-slate-500'
              }`}
            >
              <span
                className={`w-1 h-1 rounded-[1px] ${
                  isLightField ? 'bg-slate-900' : 'bg-amber-300'
                }`}
              />
            </span>
            <span>{isLightField ? 'Light-Field' : 'Dark-Field'}</span>
          </button>

          <button
            type="button"
            onClick={togglePolarity}
            className="flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-medium rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors whitespace-nowrap shrink-0"
            title="Switch Photoresist Tone: Positive (UV-exposed dissolves) vs Negative (UV-exposed crosslinks & stays)"
          >
            <ArrowLeftRight className="w-3 h-3 text-amber-400 shrink-0" />
            <span className="capitalize">{litho.polarity}</span>
            <span className="hidden md:inline text-slate-400">resist</span>
          </button>

          {onOpenMaskLevels && (
            <button
              type="button"
              onClick={onOpenMaskLevels}
              className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-md bg-slate-800 hover:bg-slate-700 text-sky-400 hover:text-sky-300 border border-slate-700 transition-colors whitespace-nowrap shrink-0"
              title="Open Photolithography Mask Levels Panel"
            >
              <Scan className="w-3 h-3" />
              <span className="hidden sm:inline">Masks</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleToggleMinimize}
            className="flex items-center justify-center p-1 rounded-md bg-sky-600 hover:bg-sky-500 text-white transition-colors shrink-0 shadow-sm"
            title="Expand Photomask Track"
            aria-label="Expand Photomask Track"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }

  const outcomeSummary = isLightField
    ? litho.polarity === 'positive'
      ? 'Quartz bg passes UV (dissolves resist) · Chrome blocks protect resist underneath'
      : 'Quartz bg passes UV (crosslinks resist) · Chrome blocks dissolve resist underneath'
    : litho.polarity === 'positive'
    ? 'Chrome bg blocks UV · Clear apertures expose & dissolve resist'
    : 'Chrome bg blocks UV · Clear apertures expose & crosslink resist';

  return (
    <div
      className={
        overlayExpand
          ? 'absolute top-0 inset-x-0 z-40 bg-slate-900/95 backdrop-blur-md border border-slate-700 rounded-xl p-2 text-slate-200 shadow-2xl max-h-[58vh] overflow-y-auto'
          : dockPosition === 'bottom'
          ? 'bg-slate-900 border border-slate-800 rounded-xl p-2 text-slate-200 max-h-[42vh] overflow-y-auto'
          : 'bg-slate-900 border border-slate-800 rounded-xl p-2 text-slate-200'
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-1.5 pb-1.5 mb-1.5 border-b border-slate-800">
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          <span className="text-[11px] font-semibold tracking-wider uppercase text-sky-400 shrink-0">
            Mask Track
          </span>
          {step.side === 'back' && (
            <span className="text-[10px] font-mono font-semibold text-amber-300">
              · Backside
            </span>
          )}
          {step.side === 'both' && (
            <span className="text-[10px] font-mono font-semibold text-emerald-300">
              · Both Sides
            </span>
          )}
          <span className="text-xs text-slate-600">·</span>
          {isEditingMaskName ? (
            <div className="flex items-center gap-1">
              <input
                type="text"
                autoFocus
                value={editingMaskName}
                onChange={(e) => setEditingMaskName(e.target.value)}
                onBlur={handleSaveMaskName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveMaskName();
                  if (e.key === 'Escape') {
                    setEditingMaskName(litho.maskName || '');
                    setIsEditingMaskName(false);
                  }
                }}
                placeholder="Mask name..."
                className="px-1.5 py-0.5 rounded bg-slate-950 border border-sky-500 text-[11px] text-white font-mono focus:outline-none w-32 sm:w-40"
              />
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleSaveMaskName();
                }}
                className="p-0.5 text-emerald-400 hover:text-emerald-300"
                title="Save Mask Name"
              >
                <Check className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setEditingMaskName(litho.maskName || 'Photomask Layer');
                setIsEditingMaskName(true);
              }}
              className="group/maskname flex items-center gap-1 text-[11px] text-slate-200 hover:text-white font-mono px-1 py-0.5 rounded hover:bg-slate-800/80 border border-transparent hover:border-slate-700 transition-colors"
              title="Click to rename assigned mask"
            >
              <span className="truncate max-w-[130px] sm:max-w-[200px]">{litho.maskName || 'Photomask Layer'}</span>
              <Edit2 className="w-2.5 h-2.5 text-slate-500 group-hover/maskname:text-sky-400 transition-colors shrink-0" />
            </button>
          )}
          {activeVariant && !isMaskSharedWithOtherVariant && (
            <span
              className="inline-flex items-center gap-1 text-[10px] font-medium shrink-0 text-violet-300"
              title="Dedicated mask branch assigned to this variant in Mask Manager."
            >
              <GitBranch className="w-2.5 h-2.5" />
              <span>{activeVariant.name}</span>
            </span>
          )}
          {activeVariant && isMaskSharedWithOtherVariant && (
            <div
              className="inline-flex items-center gap-0.5 bg-slate-950 border border-slate-700/80 rounded-md p-0.5 text-[10px] shrink-0"
              title={`Currently sharing reticle across ${[activeVariant.name, ...siblingVariantsSharingMask.map((v) => v.name)].join(', ')}`}
            >
              <button
                type="button"
                onClick={() =>
                  onUpdateStep({ ...latestStepRef.current, variantMaskEditMode: 'shared' })
                }
                className={`px-1.5 py-0.5 rounded font-medium transition-colors ${
                  variantMaskEditMode === 'shared'
                    ? 'bg-sky-600 text-white'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/70'
                }`}
                title={`Share reticle across variants (${[activeVariant.name, ...siblingVariantsSharingMask.map((v) => v.name)].join(', ')})`}
              >
                Shared ({siblingVariantsSharingMask.length + 1})
              </button>
              <button
                type="button"
                onClick={() =>
                  onUpdateStep({ ...latestStepRef.current, variantMaskEditMode: 'branch' })
                }
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-medium transition-colors ${
                  variantMaskEditMode === 'branch'
                    ? 'bg-violet-600 text-white'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/70'
                }`}
                title="Generate a new mask branch in Mask Manager when this variant's aperture track is modified"
              >
                <GitBranch className="w-2.5 h-2.5" />
                <span>Branch</span>
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <div className="flex items-center bg-slate-950 border border-slate-800 rounded-md p-0.5">
            <button
              type="button"
              onClick={handleUndo}
              disabled={!historyState.canUndo}
              className="p-0.5 rounded text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-35 disabled:pointer-events-none transition-colors"
              title="Undo aperture track edit (Ctrl+Z)"
            >
              <Undo2 className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={handleRedo}
              disabled={!historyState.canRedo}
              className="p-0.5 rounded text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-35 disabled:pointer-events-none transition-colors"
              title="Redo aperture track edit (Ctrl+Y)"
            >
              <Redo2 className="w-3 h-3" />
            </button>
          </div>
          <button
            type="button"
            onClick={toggleMaskField}
            className={`flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-md border transition-colors ${
              isLightField
                ? 'bg-sky-950/60 hover:bg-sky-900/60 text-sky-200 border-sky-500/50'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
            }`}
            title={
              isLightField
                ? 'Light-Field Mask: clear quartz background; movable blocks are opaque chrome blockers. Click to switch to Dark-Field.'
                : 'Dark-Field Mask: opaque chrome background; movable blocks are clear UV apertures. Click to switch to Light-Field.'
            }
          >
            <span
              className={`w-2.5 h-2.5 rounded-xs border shrink-0 flex items-center justify-center ${
                isLightField
                  ? 'bg-sky-200/85 border-sky-300'
                  : 'bg-slate-950 border-slate-500'
              }`}
            >
              <span
                className={`w-1 h-1 rounded-[1px] ${
                  isLightField ? 'bg-slate-900' : 'bg-amber-300'
                }`}
              />
            </span>
            <span>{isLightField ? 'Light-Field' : 'Dark-Field'}</span>
          </button>

          <button
            type="button"
            onClick={togglePolarity}
            className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
            title="Switch Photoresist Tone: Positive (UV-exposed dissolves) vs Negative (UV-exposed crosslinks & stays)"
          >
            <ArrowLeftRight className="w-3 h-3 text-amber-400" />
            <span className="capitalize">{litho.polarity}</span>
          </button>

          <button
            type="button"
            onClick={handleClearTrack}
            disabled={windows.length === 0}
            className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-md bg-slate-800 hover:bg-amber-950/50 text-amber-300 hover:text-amber-200 border border-slate-700 hover:border-amber-500/40 disabled:opacity-40 disabled:pointer-events-none transition-colors"
            title={
              isLightField
                ? 'Clear all chrome blockers (100% clear quartz field)'
                : 'Clear all apertures from this mask track (100% opaque dark field)'
            }
          >
            <Eraser className="w-3 h-3" />
            <span>Clear</span>
          </button>

          <button
            type="button"
            onClick={handleAddWindow}
            className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-md bg-sky-600 hover:bg-sky-500 text-white transition-colors shadow-sm"
            title={
              isLightField
                ? 'Add an opaque chrome blocker island on the clear quartz mask'
                : 'Add a clear quartz aperture window in the opaque chrome mask'
            }
          >
            <Plus className="w-3 h-3" />
            <span>{featureNounCap}</span>
          </button>

          {onUpdateAlignmentMarks && (
            <button
              type="button"
              onClick={() => setShowAlignPanel((prev) => !prev)}
              aria-pressed={showAlignPanel}
              className={`flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                showAlignPanel || litho.definesAlignmentMarks
                  ? 'bg-cyan-500/20 border-cyan-500/60 text-cyan-200'
                  : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300 hover:text-cyan-300'
              }`}
              title="Configure Alignment Mark Layer Option & Global Substrate Fiducials"
            >
              <Crosshair className="w-3 h-3 text-cyan-400 shrink-0" />
              <span>Align</span>
              {alignmentMarks.length > 0 && (
                <span className="text-[10px] font-mono text-cyan-300">
                  ({alignmentMarks.length})
                </span>
              )}
            </button>
          )}

          {onOpenMaskLevels && (
            <button
              type="button"
              onClick={onOpenMaskLevels}
              className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-md bg-slate-800 hover:bg-slate-700 text-sky-400 hover:text-sky-300 border border-slate-700 transition-colors"
              title="Open Photolithography Mask Levels Panel"
            >
              <Scan className="w-3 h-3" />
              <span className="hidden sm:inline">Masks</span>
            </button>
          )}

          {onTogglePin && (
            <button
              type="button"
              onClick={onTogglePin}
              aria-pressed={isPinned}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10.5px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                isPinned
                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-200'
                  : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
              title={
                isPinned
                  ? 'Pinned open across steps (click to auto-hide when leaving step)'
                  : 'Pin open so Mask Track stays visible when switching steps'
              }
            >
              <Pin className="w-3 h-3" />
              <span className="hidden md:inline">{isPinned ? 'Pinned' : 'Pin'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleToggleMinimize}
            className="p-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors"
            title="Collapse Photomask Track"
            aria-label="Collapse Photomask Track"
          >
            {overlayExpand || dockPosition === 'top' ? (
              <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
            ) : (
              <X className="w-3.5 h-3.5 text-slate-400" />
            )}
          </button>
        </div>
      </div>

      {branchNotice && (
        <div className="mb-1.5 px-2 py-1 rounded-md bg-violet-950/50 border border-violet-500/40 text-violet-200 text-[10.5px] flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <GitBranch className="w-3 h-3 text-violet-400 shrink-0" />
            <span className="truncate">{branchNotice}</span>
          </div>
          {onOpenMaskLevels && (
            <button
              type="button"
              onClick={() => {
                setBranchNotice(null);
                onOpenMaskLevels();
              }}
              className="text-[10.5px] font-semibold text-sky-300 hover:text-sky-200 hover:underline shrink-0"
            >
              View in Mask Manager →
            </button>
          )}
        </div>
      )}

      {/* Visual Photomask Bar */}
      <div className="relative my-1 select-none">
        <div className="text-[10px] text-slate-400 flex items-center justify-between gap-2 font-mono mb-0.5 leading-tight">
          <span>0 µm</span>
          <span
            className="text-slate-400 truncate max-w-[75%]"
            title={`Drag or ←/→ (${formatNudgeLabel(arrowFineNm)}, Shift ${formatNudgeLabel(arrowCoarseNm)}) to move · Shift/Ctrl+Click or drag track for multi · Borders resize`}
          >
            {draggingMark && markDragPreview ? (
              <span className="text-cyan-300 font-semibold">
                Moving {alignmentMarks.find((m) => m.id === draggingMark.id)?.label || 'Mark'}: {(markDragPreview.xNm / 1000).toFixed(2)} µm
              </span>
            ) : dragState ? (
              <span className="text-amber-300 font-semibold animate-pulse">
                {dragState.type === 'move'
                  ? (dragState.initialWindows?.length || 1) > 1
                    ? `Sliding ${dragState.initialWindows?.length} ${featureNounCap}s...`
                    : `Sliding ${featureNounCap}...`
                  : `Resizing ${featureNounCap}...`}
              </span>
            ) : trackMarquee ? (
              <span className="text-sky-300 font-semibold">
                Selecting {featureNoun}s...
              </span>
            ) : (
              <span className={isLightField ? 'text-sky-300/90' : 'text-slate-400'}>
                {outcomeSummary}
              </span>
            )}
          </span>
          <span>{(waferWidth / 1000).toFixed(1)} µm</span>
        </div>

        {/* Chrome base (Dark-Field) OR Clear Quartz Glass (Light-Field) */}
        <div
          ref={containerRef}
          tabIndex={0}
          title={`Drag or ←/→ (${formatNudgeLabel(arrowFineNm)}, Shift ${formatNudgeLabel(arrowCoarseNm)}) to move · Shift/Ctrl+Click or drag track for multi · Borders resize`}
          onPointerDown={handleTrackPointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className={`relative h-8 w-full rounded-lg overflow-hidden shadow-inner select-none touch-none border focus:outline-none focus-visible:ring-1 focus-visible:ring-sky-500/60 ${
            isLightField
              ? 'bg-gradient-to-b from-sky-200/35 via-cyan-100/25 to-amber-100/30 border-sky-400/50'
              : 'bg-slate-950 border-slate-700'
          }`}
        >
          {/* Mask Background Texture */}
          {isLightField ? (
            <div
              className="absolute inset-0 pointer-events-none flex items-center justify-center"
              style={{
                backgroundImage:
                  'linear-gradient(90deg, rgba(125,211,252,0.12) 1px, transparent 1px)',
                backgroundSize: '24px 100%',
              }}
            >
              {windows.length === 0 && (
                <span className="text-[10px] font-mono font-semibold uppercase tracking-widest text-sky-100/80">
                  Clear Quartz Field (100% UV Transmitting)
                </span>
              )}
            </div>
          ) : (
            <div className="absolute inset-0 bg-slate-800/80 opacity-40 pattern-crosshatch flex items-center justify-center">
              {windows.length === 0 && (
                <span className="text-[10px] font-mono font-semibold uppercase tracking-widest text-slate-400">
                  Opaque Chrome Field (0% UV Transmitting)
                </span>
              )}
            </div>
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

          {/* Movable Mask Blocks: Chrome Blockers (Light-Field) OR Clear Apertures (Dark-Field) */}
          {displayWindows.map((win) => {
            const leftPct = (win.xStart / waferWidth) * 100;
            const widthPct = Math.max(1.5, ((win.xEnd - win.xStart) / waferWidth) * 100);
            const isActive = selectedWindowIds.includes(win.id);
            const isDraggingThis =
              dragState?.winId === win.id ||
              Boolean(dragState?.initialWindows?.some((t) => t.id === win.id));

            const blockClasses = isLightField
              ? isActive || isDraggingThis
                ? 'bg-slate-900 border-y-2 border-amber-400 shadow-xl'
                : win.isAlignKey
                ? 'bg-slate-900/95 border-y-2 border-cyan-400 hover:bg-slate-800 shadow-md'
                : 'bg-slate-900/95 border-y border-slate-300/80 hover:bg-slate-800 shadow-md'
              : isActive || isDraggingThis
              ? 'bg-amber-400/40 border-y border-amber-400 shadow-xl'
              : win.isAlignKey
              ? 'bg-cyan-500/30 border-y border-cyan-400 hover:bg-cyan-500/40'
              : 'bg-emerald-400/25 border-y border-emerald-400/80 hover:bg-emerald-400/35';

            const handleClasses = isLightField
              ? isActive || isDraggingThis
                ? 'bg-amber-400 hover:bg-amber-300 text-slate-950'
                : 'bg-slate-300/90 hover:bg-white text-slate-950'
              : 'bg-amber-500/80 hover:bg-amber-400 text-slate-950';

            return (
              <div
                key={win.id}
                onClick={(e) => {
                  e.stopPropagation();
                }}
                className={`absolute top-0 bottom-0 select-none group/box ${dragState ? '' : 'transition-shadow'} ${blockClasses}`}
                style={{
                  left: `${leftPct}%`,
                  width: `${widthPct}%`,
                  ...(isLightField
                    ? {
                        backgroundImage:
                          'repeating-linear-gradient(135deg, rgba(148,163,184,0.16) 0, rgba(148,163,184,0.16) 5px, transparent 5px, transparent 10px)',
                      }
                    : {}),
                }}
              >
                {/* Left Resize Handle (disabled when width is fixed) */}
                {!win.fixedWidth && (
                  <div
                    onPointerDown={(e) => handlePointerDown(e, win, 'resize-start')}
                    className={`absolute left-0 top-0 bottom-0 w-2.5 cursor-ew-resize flex items-center justify-center z-20 transition-colors select-none group/left ${handleClasses}`}
                    title={`Drag to resize ${featureNoun} left boundary`}
                  >
                    <div className="w-0.5 h-3.5 rounded-full bg-slate-950/70" />
                  </div>
                )}

                {/* Central Drag & Slide Area */}
                <div
                  onPointerDown={(e) => handlePointerDown(e, win, 'move')}
                  className="w-full h-full flex items-center justify-center cursor-grab active:cursor-grabbing px-2.5 overflow-hidden select-none"
                  title={
                    win.fixedWidth
                      ? `Width locked — drag to slide ${featureNoun}`
                      : `Click and drag to slide ${featureNoun}`
                  }
                >
                  <div className="flex items-center gap-1 text-[10.5px] font-mono font-bold text-white drop-shadow truncate select-none pointer-events-none">
                    {win.isAlignKey && (
                      <Crosshair className="w-2.5 h-2.5 text-cyan-300 flex-shrink-0" />
                    )}
                    {win.fixedWidth ? (
                      <Lock className="w-2.5 h-2.5 text-amber-300 flex-shrink-0" />
                    ) : !win.isAlignKey ? (
                      <MoveHorizontal
                        className={`w-2.5 h-2.5 flex-shrink-0 ${
                          isLightField ? 'text-slate-300' : 'text-amber-300'
                        }`}
                      />
                    ) : null}
                    <span>{((win.xEnd - win.xStart) / 1000).toFixed(2)} µm</span>
                  </div>
                </div>

                {/* Right Resize Handle (disabled when width is fixed) */}
                {!win.fixedWidth && (
                  <div
                    onPointerDown={(e) => handlePointerDown(e, win, 'resize-end')}
                    className={`absolute right-0 top-0 bottom-0 w-2.5 cursor-ew-resize flex items-center justify-center z-20 transition-colors select-none group/right ${handleClasses}`}
                    title={`Drag to resize ${featureNoun} right boundary`}
                  >
                    <div className="w-0.5 h-3.5 rounded-full bg-slate-950/70" />
                  </div>
                )}
              </div>
            );
          })}

          {/* Global Substrate Alignment Mark Fiducials on Track */}
          {alignmentMarks.map((mark) => {
            const xNm =
              markDragPreview && markDragPreview.id === mark.id
                ? markDragPreview.xNm
                : mark.xNm;
            const leftPct = Math.max(0, Math.min(100, (xNm / waferWidth) * 100));
            const color = mark.color || '#22d3ee';
            const isFromThisStep = mark.definedByStepId === step.id;

            return (
              <div
                key={mark.id}
                onPointerDown={(e) => handleMarkPointerDown(e, mark)}
                onClick={(e) => e.stopPropagation()}
                className="absolute top-0 bottom-0 -translate-x-1/2 w-3 cursor-ew-resize z-30 flex flex-col items-center justify-between group/am"
                style={{ left: `${leftPct}%` }}
                title={`${mark.label} (${(xNm / 1000).toFixed(2)} µm · ${
                  mark.side === 'back' ? 'Backside' : mark.side === 'both' ? 'Both sides' : 'Frontside'
                })${isFromThisStep ? ' · Defined by this step' : ''} — drag to move`}
              >
                <div
                  className="w-2 h-1.5 rotate-45 -mt-0.5 border"
                  style={{ backgroundColor: color, borderColor: '#020617' }}
                />
                <div
                  className="flex-1 w-0 border-l border-dashed"
                  style={{ borderColor: color, opacity: isFromThisStep ? 0.9 : 0.65 }}
                />
                <span
                  className="px-1 py-0 text-[8.5px] font-mono font-bold rounded-xs leading-tight border bg-slate-950/95 pointer-events-none whitespace-nowrap"
                  style={{ color, borderColor: color }}
                >
                  {mark.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Alignment Marks Drawer */}
      {showAlignPanel && onUpdateAlignmentMarks && (
        <div className="mt-1.5 mb-1 rounded-lg bg-slate-950/85 border border-cyan-500/30 p-2 space-y-2 text-[11px]">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-1.5 border-b border-slate-800/80">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={toggleDefinesAlignmentMarks}
                aria-pressed={Boolean(litho.definesAlignmentMarks)}
                className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                  litho.definesAlignmentMarks
                    ? 'bg-cyan-500/20 border-cyan-500/60 text-cyan-200'
                    : 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-300'
                }`}
                title="Mark this photolithography step as patterning substrate alignment marks"
              >
                <Crosshair className="w-3 h-3 text-cyan-400 shrink-0" />
                <span>Defines Alignment Marks</span>
                <span
                  className={`px-1 py-0 rounded-xs text-[9.5px] font-mono ${
                    litho.definesAlignmentMarks
                      ? 'bg-cyan-500/30 text-cyan-100'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {litho.definesAlignmentMarks ? 'ON' : 'OFF'}
                </span>
              </button>
              <span className="text-[10px] text-slate-400">
                Flags this step as patterning alignment fiducials on the wafer.
              </span>
            </div>

            {windows.length > 0 && (() => {
              const selCount = selectedWindowIds.length;
              const alignKeyCount = windows.filter((w) => w.isAlignKey).length;
              const deriveLabel =
                selCount > 1
                  ? `Derive Center Mark (${selCount} sel)`
                  : selCount === 1
                  ? 'Derive Mark (1 sel)'
                  : alignKeyCount > 0
                  ? `Derive from Align Keys (${alignKeyCount})`
                  : 'Derive Marks from Windows';
              const deriveTitle =
                selCount > 1
                  ? `Place a single global alignment mark centered within the ${selCount} selected shapes`
                  : selCount === 1
                  ? 'Place a global alignment mark centered on the selected shape'
                  : alignKeyCount > 0
                  ? `Place global substrate marks at the center of the ${alignKeyCount} align key shape(s)`
                  : `Place global substrate marks at the center of this mask's ${windows.length} ${featureNoun}${windows.length === 1 ? '' : 's'}`;

              return (
                <button
                  type="button"
                  onClick={() => handleSyncMarksFromWindows()}
                  className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-900 hover:bg-cyan-950/60 border border-slate-700 hover:border-cyan-500/50 text-cyan-300 text-[10.5px] font-medium transition-colors whitespace-nowrap shrink-0"
                  title={deriveTitle}
                >
                  <Crosshair className="w-3 h-3 shrink-0" />
                  <span>{deriveLabel}</span>
                </button>
              );
            })()}
          </div>

          {/* Global Substrate Marks List */}
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">
                Global Substrate Alignment Marks ({alignmentMarks.length})
              </span>
              <button
                type="button"
                onClick={handleAddAlignmentMark}
                className="flex items-center gap-1 px-2 py-0.5 rounded bg-cyan-600/20 hover:bg-cyan-600/35 border border-cyan-500/50 text-cyan-200 text-[10.5px] font-medium transition-colors whitespace-nowrap shrink-0"
              >
                <Plus className="w-3 h-3" />
                <span>Add Substrate Mark</span>
              </button>
            </div>

            {alignmentMarks.length === 0 ? (
              <div className="px-2 py-1.5 rounded bg-slate-900/60 border border-slate-800/80 text-[10.5px] text-slate-400">
                No global alignment marks defined on the substrate yet. Add a mark or derive them from this mask&apos;s windows to anchor fiducials across all process steps.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 max-h-28 overflow-y-auto pr-0.5">
                {alignmentMarks.map((mark) => {
                  const isFromThisStep = mark.definedByStepId === step.id;
                  const sideLabel =
                    mark.side === 'back' ? 'Back' : mark.side === 'both' ? 'Both' : 'Front';
                  const nextSide: ProcessSide =
                    mark.side === 'front' || !mark.side
                      ? 'back'
                      : mark.side === 'back'
                      ? 'both'
                      : 'front';

                  return (
                    <div
                      key={mark.id}
                      className={`flex items-center justify-between gap-1.5 px-2 py-1 rounded border text-[10.5px] ${
                        isFromThisStep
                          ? 'bg-cyan-950/35 border-cyan-500/50'
                          : 'bg-slate-900/70 border-slate-800'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          className="w-2 h-2 rounded-xs shrink-0"
                          style={{ backgroundColor: mark.color || '#22d3ee' }}
                        />
                        <input
                          type="text"
                          value={mark.label}
                          onChange={(e) =>
                            handleUpdateAlignmentMark(mark.id, { label: e.target.value })
                          }
                          className="w-16 px-1 py-0.5 rounded bg-slate-950 border border-slate-700/80 text-slate-100 font-mono text-[10.5px] focus:outline-none focus:border-cyan-500"
                          title="Alignment mark label"
                        />
                        <UmNumberInput
                          valueNm={mark.xNm}
                          minNm={0}
                          maxNm={waferWidth}
                          stepUm="0.05"
                          onCommitNm={(valNm) =>
                            handleUpdateAlignmentMark(mark.id, { xNm: valNm })
                          }
                          title="Global X coordinate on substrate (µm)"
                          className="w-14 px-1 py-0.5 rounded bg-slate-950 border border-slate-700/80 text-slate-100 font-mono text-[10.5px] text-right focus:outline-none focus:border-cyan-500"
                        />
                        <span className="text-slate-500 font-mono text-[10px]">µm</span>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            handleUpdateAlignmentMark(mark.id, { side: nextSide })
                          }
                          className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[9.5px] font-mono text-slate-300"
                          title="Cycle substrate face for this alignment mark (Front / Back / Both)"
                        >
                          {sideLabel}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteAlignmentMark(mark.id)}
                          className="p-0.5 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                          title="Delete global alignment mark"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Numerical Apertures List & Controls */}
      {windows.length > 0 && (() => {
        const effectiveSelectedIds =
          selectedWindowIds.length > 0
            ? selectedWindowIds
            : windows.length === 1
            ? [windows[0].id]
            : [];
        const singleSelectedWin =
          effectiveSelectedIds.length === 1
            ? windows.find((w) => w.id === effectiveSelectedIds[0]) || null
            : null;
        const singleSelectedIdx = singleSelectedWin
          ? windows.findIndex((w) => w.id === singleSelectedWin.id)
          : -1;
        const allSelected = windows.length > 0 && selectedWindowIds.length === windows.length;
        const hasExpandedInlinePanel = Boolean(arraySourceWinId || openWinBind);

        return (
          <div className="mt-1.5 space-y-1">
            {/* Selected Aperture List Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-1.5 px-0.5 text-[10.5px]">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setShowCoordRows((prev) => !prev)}
                  className="inline-flex items-center gap-1 text-slate-300 hover:text-white font-medium transition-colors"
                  title={showCoordRows ? 'Collapse aperture coordinates list' : 'Expand aperture coordinates list'}
                >
                  {showCoordRows ? (
                    <ChevronUp className="w-3 h-3 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-3 h-3 text-sky-400" />
                  )}
                  <span>
                    {featureNounCap}s ({windows.length})
                  </span>
                </button>
                {effectiveSelectedIds.length === 1 && singleSelectedIdx >= 0 && (
                  <span className="text-sky-300 font-mono">
                    · #{singleSelectedIdx + 1}
                  </span>
                )}
                {effectiveSelectedIds.length > 1 && (
                  <span className="text-amber-300 font-mono font-semibold">
                    · {effectiveSelectedIds.length} sel
                  </span>
                )}
                {windows.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedWindowIds(allSelected ? [] : windows.map((w) => w.id))
                    }
                    className="px-1.5 py-0.2 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-[10px]"
                  >
                    {allSelected ? 'Clear' : 'All'}
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1">
                {effectiveSelectedIds.length > 0 && (
                  <div className="flex items-center gap-0.5 bg-slate-950 border border-slate-800 rounded px-1 py-0.5">
                    <span className="text-[10px] text-slate-400 pr-0.5">Move:</span>
                    <button
                      type="button"
                      onClick={() => handleShiftWindows(effectiveSelectedIds, -arrowCoarseNm)}
                      className="px-1 py-0.2 rounded bg-slate-800 hover:bg-slate-700 text-sky-300 font-mono text-[10px]"
                      title={`Coarse shift left -${formatNudgeLabel(arrowCoarseNm)} (Shift+←)`}
                    >
                      -{formatNudgeLabel(arrowCoarseNm).replace(' ', '')}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleShiftWindows(effectiveSelectedIds, -arrowFineNm)}
                      className="px-1 py-0.2 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-[10px]"
                      title={`Fine shift left -${formatNudgeLabel(arrowFineNm)} (←)`}
                    >
                      -{formatNudgeLabel(arrowFineNm).replace(' ', '')}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleShiftWindows(effectiveSelectedIds, arrowFineNm)}
                      className="px-1 py-0.2 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-[10px]"
                      title={`Fine shift right +${formatNudgeLabel(arrowFineNm)} (→)`}
                    >
                      +{formatNudgeLabel(arrowFineNm).replace(' ', '')}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleShiftWindows(effectiveSelectedIds, arrowCoarseNm)}
                      className="px-1 py-0.2 rounded bg-slate-800 hover:bg-slate-700 text-sky-300 font-mono text-[10px]"
                      title={`Coarse shift right +${formatNudgeLabel(arrowCoarseNm)} (Shift+→)`}
                    >
                      +{formatNudgeLabel(arrowCoarseNm).replace(' ', '')}
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  disabled={effectiveSelectedIds.length === 0}
                  onClick={() => handleDuplicateSelectedWindows(effectiveSelectedIds)}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:pointer-events-none text-slate-200 border border-slate-700 text-[10px] font-medium transition-colors"
                  title={
                    effectiveSelectedIds.length > 1
                      ? `Duplicate ${effectiveSelectedIds.length} selected ${featureNoun}s`
                      : singleSelectedWin
                      ? `Duplicate selected ${featureNoun} #${singleSelectedIdx + 1}`
                      : `Select a ${featureNoun} first to duplicate`
                  }
                >
                  <Copy className="w-2.5 h-2.5 text-sky-400" />
                  <span>
                    {effectiveSelectedIds.length > 1
                      ? `Dup (${effectiveSelectedIds.length})`
                      : 'Dup'}
                  </span>
                </button>
                {onUpdateAlignmentMarks && effectiveSelectedIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => handleSyncMarksFromWindows(effectiveSelectedIds)}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-cyan-950/60 hover:bg-cyan-900/60 text-cyan-200 border border-cyan-500/40 text-[10px] font-medium transition-colors whitespace-nowrap shrink-0"
                    title={
                      effectiveSelectedIds.length > 1
                        ? `Place 1 alignment mark centered across the ${effectiveSelectedIds.length} selected shapes`
                        : 'Place 1 alignment mark centered on the selected shape'
                    }
                  >
                    <Crosshair className="w-2.5 h-2.5 text-cyan-400" />
                    <span>
                      {effectiveSelectedIds.length > 1 ? 'Center Mark' : 'Mark'}
                    </span>
                  </button>
                )}
                {effectiveSelectedIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => handleToggleSelectedAlignKeys(effectiveSelectedIds)}
                    className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                      windows
                        .filter((w) => effectiveSelectedIds.includes(w.id))
                        .every((w) => Boolean(w.isAlignKey))
                        ? 'bg-cyan-500/20 border-cyan-500/60 text-cyan-200'
                        : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300 hover:text-cyan-300'
                    }`}
                    title="Toggle Align Key flag on selected shapes"
                  >
                    <Crosshair className="w-2.5 h-2.5 text-cyan-400" />
                    <span>Key</span>
                  </button>
                )}
                <button
                  type="button"
                  disabled={!singleSelectedWin}
                  onClick={() => {
                    if (!singleSelectedWin) return;
                    setShowCoordRows(true);
                    setSelectedWindowIds([singleSelectedWin.id]);
                    setOpenWinBind(null);
                    setArraySourceWinId((prev) =>
                      prev === singleSelectedWin.id ? null : singleSelectedWin.id
                    );
                  }}
                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none ${
                    singleSelectedWin && arraySourceWinId === singleSelectedWin.id
                      ? 'bg-sky-600/25 border-sky-500/60 text-sky-200'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                  }`}
                  title={
                    singleSelectedWin
                      ? `Make 1D array from selected ${featureNoun} #${singleSelectedIdx + 1}`
                      : `Select a single ${featureNoun} to make an array`
                  }
                >
                  <LayoutGrid className="w-2.5 h-2.5 text-sky-400" />
                  <span>Array</span>
                </button>
                {selectedWindowIds.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleRemoveSelectedWindows(selectedWindowIds)}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-950/60 hover:bg-rose-900/70 text-rose-300 border border-rose-500/30 text-[10px] font-medium transition-colors"
                    title={`Delete ${selectedWindowIds.length} selected ${featureNoun}s`}
                  >
                    <Trash2 className="w-2.5 h-2.5" />
                    <span>Del ({selectedWindowIds.length})</span>
                  </button>
                )}
              </div>
            </div>

            {showCoordRows && (
            <div className={`space-y-1 overflow-y-auto pr-0.5 ${hasExpandedInlinePanel ? 'max-h-56' : 'max-h-28'}`}>
              {windows.map((win, idx) => {
                const isSelected = selectedWindowIds.includes(win.id);
                const winWidth = Math.max(10, win.xEnd - win.xStart);
                const isFixed = Boolean(win.fixedWidth);
                const wExpr = win.paramBindings?.width;
                const xStartExpr = win.paramBindings?.xStart;
                const xEndExpr = win.paramBindings?.xEnd;
                const activeBindField =
                  openWinBind?.winId === win.id ? openWinBind.field : null;
                const isArrayOpen = arraySourceWinId === win.id;

                return (
                  <div
                    key={win.id}
                    onClick={(e) =>
                      toggleWindowSelection(win.id, e.shiftKey || e.ctrlKey || e.metaKey)
                    }
                    className={`px-2 py-1 rounded-md text-[11px] transition-colors space-y-1 cursor-pointer ${
                      isSelected
                        ? 'bg-slate-800/90 border border-sky-500/50'
                        : 'bg-slate-950/60 border border-slate-800/80 hover:bg-slate-800/40'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleWindowSelection(win.id, true);
                          }}
                          className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors shrink-0 ${
                            isSelected
                              ? 'bg-sky-600 border-sky-400 text-white'
                              : 'bg-slate-900 border-slate-600 hover:border-slate-400'
                          }`}
                          title={isSelected ? 'Deselect' : 'Add to selection'}
                        >
                          {isSelected && <Check className="w-2 h-2" />}
                        </button>
                        <span className="font-mono text-[11px] font-semibold text-slate-300">
                          #{idx + 1}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                        <div
                          className="flex items-center gap-1 font-mono text-[11px]"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span className="text-sky-400">W</span>
                          <UmNumberInput
                            valueNm={winWidth}
                            minNm={10}
                            maxNm={waferWidth}
                            disabled={isFixed || Boolean(wExpr)}
                            onCommitNm={(valNm) => handleUpdateWindowWidth(win.id, valNm)}
                            className={`w-14 px-1 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-100 text-right focus:outline-none focus:border-sky-500 ${
                              isFixed || Boolean(wExpr) ? 'opacity-50 cursor-not-allowed text-slate-400' : ''
                            }`}
                            title={
                              wExpr
                                ? `Bound to: ${wExpr}`
                                : isFixed
                                ? 'Width is fixed (click Lock toggle to unlock)'
                                : `Edit ${featureNoun} width (keeps block centered)`
                            }
                          />
                          <span className="text-slate-500 text-[10px]">µm</span>
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
                          <button
                            type="button"
                            onClick={() => handleToggleFixedWidth(win.id)}
                            className={`p-0.5 rounded border transition-colors ${
                              isFixed
                                ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 hover:bg-amber-500/30'
                                : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-slate-200 hover:border-slate-600'
                            }`}
                            title={
                              isFixed
                                ? `Width Fixed: editing X start or X end slides the ${featureNoun} without changing width`
                                : `Fix Width: lock width so editing X start or X end moves the ${featureNoun} cleanly`
                            }
                          >
                            {isFixed ? (
                              <Lock className="w-3 h-3" />
                            ) : (
                              <Unlock className="w-3 h-3" />
                            )}
                          </button>
                        </div>

                        <div
                          className="flex items-center gap-1 font-mono text-[11px]"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span className="text-slate-400">X</span>
                          <UmNumberInput
                            valueNm={win.xStart}
                            minNm={0}
                            maxNm={isFixed ? Math.max(0, waferWidth - winWidth) : waferWidth}
                            disabled={Boolean(xStartExpr)}
                            onCommitNm={(valNm) => handleUpdateWindowCoord(win.id, 'xStart', valNm)}
                            title={
                              xStartExpr
                                ? `Bound to: ${xStartExpr}`
                                : isFixed
                                ? `Edit start X (slides ${featureNoun} with fixed width)`
                                : `Edit ${featureNoun} start X`
                            }
                            className={`w-14 px-1 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-100 text-right focus:outline-none focus:border-sky-500 ${
                              xStartExpr ? 'opacity-65 cursor-not-allowed text-violet-300 border-violet-500/50' : ''
                            }`}
                          />
                          <ParamBindingBadge
                            expression={xStartExpr}
                            isOpen={activeBindField === 'xStart'}
                            onToggle={() => {
                              setArraySourceWinId(null);
                              setOpenWinBind(
                                activeBindField === 'xStart'
                                  ? null
                                  : { winId: win.id, field: 'xStart' }
                              );
                            }}
                            compact
                          />
                          <span className="text-slate-500">–</span>
                          <UmNumberInput
                            valueNm={win.xEnd}
                            minNm={isFixed ? winWidth : 0}
                            maxNm={waferWidth}
                            disabled={Boolean(xEndExpr)}
                            onCommitNm={(valNm) => handleUpdateWindowCoord(win.id, 'xEnd', valNm)}
                            title={
                              xEndExpr
                                ? `Bound to: ${xEndExpr}`
                                : isFixed
                                ? `Edit end X (slides ${featureNoun} with fixed width)`
                                : `Edit ${featureNoun} end X`
                            }
                            className={`w-14 px-1 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-100 text-right focus:outline-none focus:border-sky-500 ${
                              xEndExpr ? 'opacity-65 cursor-not-allowed text-violet-300 border-violet-500/50' : ''
                            }`}
                          />
                          <ParamBindingBadge
                            expression={xEndExpr}
                            isOpen={activeBindField === 'xEnd'}
                            onToggle={() => {
                              setArraySourceWinId(null);
                              setOpenWinBind(
                                activeBindField === 'xEnd'
                                  ? null
                                  : { winId: win.id, field: 'xEnd' }
                              );
                            }}
                            compact
                          />
                          <span className="text-slate-500 text-[10px]">µm</span>
                        </div>

                        <div className="flex items-center gap-0.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleWindowAlignKey(win.id);
                            }}
                            className={`p-0.5 rounded transition-colors ${
                              win.isAlignKey
                                ? 'text-cyan-300 bg-cyan-500/20'
                                : 'text-slate-500 hover:text-cyan-300 hover:bg-cyan-500/10'
                            }`}
                            title={
                              win.isAlignKey
                                ? `Unmark ${featureNoun} #${idx + 1} as an Align Key shape`
                                : `Mark ${featureNoun} #${idx + 1} as an Align Key shape`
                            }
                          >
                            <Crosshair className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDuplicateWindow(win.id);
                            }}
                            className="p-0.5 rounded text-slate-400 hover:text-sky-300 hover:bg-sky-500/10 transition-colors"
                            title={`Duplicate ${featureNoun}`}
                          >
                            <Copy className="w-3 h-3" />
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
                            className={`p-0.5 rounded transition-colors ${
                              isArrayOpen
                                ? 'text-sky-300 bg-sky-500/20'
                                : 'text-slate-400 hover:text-sky-300 hover:bg-sky-500/10'
                            }`}
                            title={`Make 1D array from ${featureNoun}`}
                          >
                            <LayoutGrid className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveWindow(win.id);
                            }}
                            className="p-0.5 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                            title={`Delete ${featureNoun}`}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </div>

                    {isArrayOpen && (
                      <MaskWindowArrayPanel
                        sourceWindow={win}
                        sourceIndex={idx}
                        waferWidth={waferWidth}
                        featureNounCap={featureNounCap}
                        unit="um"
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
                            ? winWidth
                            : activeBindField === 'xStart'
                            ? win.xStart
                            : win.xEnd
                        }
                        unit="um"
                        suggestedVarName={
                          activeBindField === 'width'
                            ? `win_${idx + 1}_w`
                            : activeBindField === 'xStart'
                            ? `win_${idx + 1}_x1`
                            : `win_${idx + 1}_x2`
                        }
                        targetLabel={`${featureNounCap} #${idx + 1} · ${
                          activeBindField === 'width'
                            ? 'Width'
                            : activeBindField === 'xStart'
                            ? 'Start X₁'
                            : 'End X₂'
                        }`}
                        onChangeExpression={(expr) =>
                          handleUpdateWindowBinding(win.id, activeBindField, expr)
                        }
                        onCreateVariable={onCreateVariable}
                        onOpenVariablesModal={onOpenVariablesModal}
                        onClose={() => setOpenWinBind(null)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
            )}
          </div>
        );
      })()}
    </div>
  );
};
