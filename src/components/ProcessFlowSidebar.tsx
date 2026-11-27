/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  ProcessFlow,
  ProcessStep,
  ProcessStepType,
  ProcessBlock,
} from '../types/microfab';
import {
  createBlock,
  updateBlock,
  deleteBlock,
  toggleBlockCollapsed,
  buildTimelineItems,
  moveBlockInTimeline,
  moveStepInTimeline,
  reorderBlockInTimeline,
  StepDropTarget,
  reorderStepInTimeline,
  reorderStepsInTimeline,
  assignStepsToBlock,
  deleteStepsFromTimeline,
  insertStepIntoTimeline,
  insertStepAfterIndex,
  deleteStepFromTimeline,
  normalizeFlowBlocksOrder,
  BLOCK_PALETTE,
} from '../lib/blockUtils';
import {
  attachNewMaskToLithoStep,
  formatMaskLevelTag,
  getNextMaskLevelNumber,
  syncStepWindowsToMask,
} from '../lib/maskUtils';
import {
  createStepVariant,
  switchStepVariant,
  getActiveStepVariant,
  detachVariantsForDuplicatedStep,
} from '../lib/variantUtils';
import { getEtchRecipeById, formatDurationCompact } from '../lib/etchRates';
import { getDefaultStepTitle } from '../lib/stepDefaults';
import { ThicknessUnit, formatThickness } from '../lib/units';
import {
  Plus,
  Layers,
  Scissors,
  Flame,
  Eraser,
  Sparkles,
  Disc,
  ArrowUp,
  ArrowDown,
  Copy,
  Trash2,
  Eye,
  EyeOff,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Sliders,
  FolderPlus,
  Folder,
  FolderOpen,
  Edit2,
  Check,
  Link2,
  GripVertical,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Search,
  X,
  Frame,
  Slice,
  Bookmark,
  CheckSquare,
  Square,
  Minus,
  GitBranch,
  FileInput,
  HelpCircle,
} from 'lucide-react';

interface ProcessFlowSidebarProps {
  flow: ProcessFlow;
  activeStepIndex: number;
  thicknessUnit?: ThicknessUnit;
  isPlaying: boolean;
  playSpeed: number;
  onChangePlaySpeed: (speed: number) => void;
  onTogglePlay: () => void;
  onSelectStepIndex: (index: number) => void;
  onUpdateFlow: (updated: ProcessFlow) => void;
  onOpenPresets: () => void;
  onOpenImportFlow?: () => void;
  onOpenParameters?: () => void;
  onOpenHelp?: () => void;
}

function getContrastTextColor(hex: string): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return '#020617';
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const toLin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const lum = 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
  return lum > 0.34 ? '#020617' : '#f8fafc';
}

export const ProcessFlowSidebar: React.FC<ProcessFlowSidebarProps> = ({
  flow,
  activeStepIndex,
  thicknessUnit = 'nm',
  isPlaying,
  playSpeed,
  onChangePlaySpeed,
  onTogglePlay,
  onSelectStepIndex,
  onUpdateFlow,
  onOpenPresets,
  onOpenImportFlow,
  onOpenParameters,
  onOpenHelp,
}) => {
  type AddStepPlacement =
    | { mode: 'end' }
    | { mode: 'after-selected' }
    | { mode: 'into-block'; blockId: string };

  const [showAddMenu, setShowAddMenu] = useState<boolean>(false);
  const [addPlacement, setAddPlacement] = useState<AddStepPlacement>({ mode: 'end' });
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [editingBlockName, setEditingBlockName] = useState<string>('');
  const [editingBlockDescription, setEditingBlockDescription] = useState<string>('');
  const [editingBlockFocus, setEditingBlockFocus] = useState<'name' | 'description'>('name');

  // Interactive block creation state (replaces window.prompt)
  const [isCreatingBlock, setIsCreatingBlock] = useState<boolean>(false);
  const [newBlockName, setNewBlockName] = useState<string>('');
  const [newBlockDescription, setNewBlockDescription] = useState<string>('');
  const [newBlockColor, setNewBlockColor] = useState<string>(BLOCK_PALETTE[0]);
  const [groupUngroupedOnCreate, setGroupUngroupedOnCreate] = useState<boolean>(false);
  const [deleteConfirmBlockId, setDeleteConfirmBlockId] = useState<string | null>(null);

  // Drag-and-drop reordering state for steps and fabrication blocks
  type DragSource =
    | { kind: 'step'; stepId: string; blockId?: string }
    | { kind: 'steps'; stepIds: string[] }
    | { kind: 'block'; blockId: string };

  type DropIndicator =
    | { kind: 'timeline-item'; timelineIndex: number; position: 'before' | 'after' }
    | { kind: 'block-step'; blockId: string; stepId: string; position: 'before' | 'after' }
    | { kind: 'into-block'; blockId: string };

  const [dragSource, setDragSource] = useState<DragSource | null>(null);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null);
  const [stepSearchQuery, setStepSearchQuery] = useState<string>('');
  const [showBookmarksOnly, setShowBookmarksOnly] = useState<boolean>(false);
  const [isMilestonesExpanded, setIsMilestonesExpanded] = useState<boolean>(true);
  const [editingBookmarkStepId, setEditingBookmarkStepId] = useState<string | null>(null);
  const [editingBookmarkLabel, setEditingBookmarkLabel] = useState<string>('');

  // Bulk Edit mode state
  const [bulkEditMode, setBulkEditMode] = useState<boolean>(false);
  const [selectedStepIds, setSelectedStepIds] = useState<Set<string>>(() => new Set());
  const [lastBulkClickedStepId, setLastBulkClickedStepId] = useState<string | null>(null);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState<boolean>(false);
  const bulkDragPreviewRef = useRef<HTMLDivElement | null>(null);

  const stepCardRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const pendingScrollStepIdRef = useRef<string | null>(null);

  const validSelectedIdsOrdered = useMemo(
    () =>
      flow.steps
        .filter((s) => selectedStepIds.has(s.id))
        .map((s) => s.id),
    [flow.steps, selectedStepIds]
  );
  const validSelectedSet = useMemo(
    () => new Set(validSelectedIdsOrdered),
    [validSelectedIdsOrdered]
  );

  useEffect(() => {
    if (flow.steps.length === 0 && bulkEditMode) {
      setBulkEditMode(false);
      setSelectedStepIds(new Set());
      setLastBulkClickedStepId(null);
      setBulkDeleteConfirm(false);
    }
  }, [flow.steps.length, bulkEditMode]);

  const blocks = flow.blocks || [];
  const subLayers = flow.substrateLayers || [
    {
      id: 'sub_default',
      name: 'Bulk Silicon <100>',
      materialId: flow.substrateMaterialId || 'mat_si_sub',
      thickness: flow.substrateThickness || 3000,
    },
  ];
  const totalSubThickness = subLayers.reduce((acc, l) => acc + (l.thickness || 0), 0);
  const isSubstrateSelected = activeStepIndex === -1;

  const bookmarkedSteps = useMemo(
    () =>
      flow.steps
        .map((step, idx) => ({ step, idx }))
        .filter(({ step }) => Boolean(step.bookmarked)),
    [flow.steps]
  );

  useEffect(() => {
    const targetStepId = pendingScrollStepIdRef.current;
    if (!targetStepId) return;
    const rafId = requestAnimationFrame(() => {
      const el = stepCardRefs.current.get(targetStepId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        pendingScrollStepIdRef.current = null;
      }
    });
    return () => cancelAnimationFrame(rafId);
  }, [activeStepIndex, flow.blocks, showBookmarksOnly, stepSearchQuery]);

  const normalizedSearch = stepSearchQuery.trim().toLowerCase();
  const isSearchActive = normalizedSearch.length > 0;
  const isFilterActive = isSearchActive || showBookmarksOnly;

  const blockMatchesQuery = (block: ProcessBlock): boolean => {
    if (!normalizedSearch) return true;
    return `${block.name} ${block.description || ''}`.toLowerCase().includes(normalizedSearch);
  };

  const stepMatchesQuery = (step: ProcessStep, globalIdx: number, block?: ProcessBlock): boolean => {
    if (!normalizedSearch) return true;
    const mat = step.materialId
      ? flow.materials.find((m) => m.id === step.materialId)
      : undefined;
    const targetEtchMat =
      step.etch?.targetMaterialId && step.etch.targetMaterialId !== 'all'
        ? flow.materials.find((m) => m.id === step.etch?.targetMaterialId)
        : undefined;
    const searchable = [
      String(globalIdx + 1),
      `step ${globalIdx + 1}`,
      step.title,
      step.type,
      step.side || 'front',
      step.notes || '',
      step.bookmarkLabel || '',
      step.bookmarked ? 'bookmark milestone' : '',
      mat?.name || '',
      mat?.formula || '',
      targetEtchMat?.name || '',
      step.deposition?.method || '',
      step.lithography?.maskName || '',
      step.lithography?.polarity || '',
      step.lithography?.coatMethod === 'dry-film'
        ? 'dry film lamination'
        : step.lithography?.coatMethod === 'lor-bilayer'
        ? 'lor bilayer double coat undercut lift-off'
        : '',
      step.etch?.etchType || '',
      step.etch?.etchRecipeId
        ? (() => {
            const rec = getEtchRecipeById(flow.etchLibrary, step.etch.etchRecipeId);
            return rec ? `${rec.name} ${rec.chemistry}` : '';
          })()
        : '',
      step.strip?.stripType || '',
      step.strip?.solvent || '',
      step.bonding?.bondingMethod || '',
      step.bonding?.importedFlowTitle || '',
      step.dicing?.method || '',
      step.dicing ? `dicing kerf ${step.dicing.cutMode}` : '',
      step.tapeFrame ? `tape frame ${step.tapeFrame.action}` : '',
      step.variants && step.variants.length > 1
        ? `variant ${step.variants.map((v) => `${v.name} ${v.title}`).join(' ')}`
        : '',
      block?.name || '',
      block?.description || '',
    ]
      .join(' ')
      .toLowerCase();
    return searchable.includes(normalizedSearch);
  };

  const stepMatchesFilters = (step: ProcessStep, globalIdx: number, block?: ProcessBlock): boolean => {
    if (showBookmarksOnly && !step.bookmarked) return false;
    return stepMatchesQuery(step, globalIdx, block);
  };

  const matchedStepCount = isFilterActive
    ? flow.steps.filter((step, idx) => {
        const blk = step.blockId ? blocks.find((b) => b.id === step.blockId) : undefined;
        return stepMatchesFilters(step, idx, blk);
      }).length
    : flow.steps.length;

  const substrateMatchesSearch =
    !showBookmarksOnly &&
    (!isSearchActive ||
      `0 starting substrate stack ${subLayers.map((l) => l.name || l.materialId).join(' ')}`
        .toLowerCase()
        .includes(normalizedSearch));

  const jumpToStep = (idx: number) => {
    const targetStep = flow.steps[idx];
    if (!targetStep) return;

    if (targetStep.blockId) {
      const parentBlock = blocks.find((b) => b.id === targetStep.blockId);
      if (parentBlock?.collapsed) {
        onUpdateFlow(updateBlock(flow, { ...parentBlock, collapsed: false }));
      }
    }

    if (showBookmarksOnly && !targetStep.bookmarked) {
      setShowBookmarksOnly(false);
    }

    if (isSearchActive) {
      const blk = targetStep.blockId ? blocks.find((b) => b.id === targetStep.blockId) : undefined;
      if (!stepMatchesQuery(targetStep, idx, blk)) {
        setStepSearchQuery('');
      }
    }

    pendingScrollStepIdRef.current = targetStep.id;
    onSelectStepIndex(idx);

    requestAnimationFrame(() => {
      const el = stepCardRefs.current.get(targetStep.id);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        pendingScrollStepIdRef.current = null;
      }
    });
  };

  const handleToggleBookmark = (idx: number) => {
    const target = flow.steps[idx];
    if (!target) return;
    const nextBookmarked = !target.bookmarked;
    const updatedSteps = flow.steps.map((s, i) =>
      i === idx
        ? {
            ...s,
            bookmarked: nextBookmarked,
            bookmarkLabel: nextBookmarked ? s.bookmarkLabel : undefined,
          }
        : s
    );
    onUpdateFlow({ ...flow, steps: updatedSteps });
    if (nextBookmarked) {
      setIsMilestonesExpanded(true);
    } else {
      if (editingBookmarkStepId === target.id) {
        setEditingBookmarkStepId(null);
        setEditingBookmarkLabel('');
      }
      if (!updatedSteps.some((s) => s.bookmarked)) {
        setShowBookmarksOnly(false);
      }
    }
  };

  const handleSaveBookmarkLabel = (stepId: string) => {
    const trimmed = editingBookmarkLabel.trim();
    const updatedSteps = flow.steps.map((s) =>
      s.id === stepId ? { ...s, bookmarkLabel: trimmed || undefined } : s
    );
    onUpdateFlow({ ...flow, steps: updatedSteps });
    setEditingBookmarkStepId(null);
    setEditingBookmarkLabel('');
  };

  const handleJumpAdjacentBookmark = (direction: 'prev' | 'next') => {
    if (bookmarkedSteps.length === 0) return;
    if (direction === 'next') {
      const nextMatch = bookmarkedSteps.find(({ idx }) => idx > activeStepIndex);
      jumpToStep((nextMatch || bookmarkedSteps[0]).idx);
    } else {
      const prevMatches = bookmarkedSteps.filter(({ idx }) => idx < activeStepIndex);
      const prevMatch =
        prevMatches.length > 0
          ? prevMatches[prevMatches.length - 1]
          : bookmarkedSteps[bookmarkedSteps.length - 1];
      jumpToStep(prevMatch.idx);
    }
  };

  const getStepIcon = (type: ProcessStepType) => {
    switch (type) {
      case 'deposition':
        return <Layers className="w-3.5 h-3.5 text-sky-400" />;
      case 'lithography':
        return <Scissors className="w-3.5 h-3.5 text-rose-400" />;
      case 'etch':
        return <Flame className="w-3.5 h-3.5 text-amber-400" />;
      case 'strip':
      case 'liftoff':
        return <Sparkles className="w-3.5 h-3.5 text-emerald-400" />;
      case 'cmp':
        return <Disc className="w-3.5 h-3.5 text-cyan-400" />;
      case 'bonding':
        return <Link2 className="w-3.5 h-3.5 text-indigo-400" />;
      case 'dicing':
        return <Slice className="w-3.5 h-3.5 text-orange-400" />;
      case 'tape-frame':
        return <Frame className="w-3.5 h-3.5 text-sky-300" />;
      case 'anneal':
        return <Sliders className="w-3.5 h-3.5 text-purple-400" />;
      default:
        return <Layers className="w-3.5 h-3.5 text-slate-400" />;
    }
  };

  const handleAddStep = (type: ProcessStepType) => {
    const id = `step_${Date.now()}`;
    const blockId = addPlacement.mode === 'into-block' ? addPlacement.blockId : undefined;
    let newStep: ProcessStep;

    switch (type) {
      case 'deposition':
        newStep = {
          id,
          title: getDefaultStepTitle('deposition'),
          type: 'deposition',
          enabled: true,
          materialId: 'mat_sio2_thermal',
          thickness: 200,
          blockId: blockId || undefined,
          deposition: {
            method: 'PECVD',
            depositionType: 'conformal',
            thickness: 200,
          },
        };
        break;
      case 'lithography':
        newStep = {
          id,
          title: getDefaultStepTitle('lithography'),
          type: 'lithography',
          enabled: true,
          blockId: blockId || undefined,
          lithography: {
            resistMaterialId: 'mat_pr_pos',
            resistThickness: 1000,
            polarity: 'positive',
            windows: [
              {
                id: `w_${Date.now()}`,
                xStart: Math.round(flow.substrateWidth * 0.35),
                xEnd: Math.round(flow.substrateWidth * 0.65),
              },
            ],
            sidewallAngle: 90,
            exposureMethod: 'UV Contact (365nm)',
          },
        };
        break;
      case 'etch':
        newStep = {
          id,
          title: getDefaultStepTitle('etch'),
          type: 'etch',
          enabled: true,
          thickness: 200,
          blockId: blockId || undefined,
          etch: {
            etchType: 'rie',
            depth: 200,
            targetMaterialId: 'all',
            isotropy: 0.05,
            sidewallAngle: 90,
          },
        };
        break;
      case 'strip':
        newStep = {
          id,
          title: getDefaultStepTitle('strip'),
          type: 'strip',
          enabled: true,
          blockId: blockId || undefined,
          strip: {
            stripType: 'resist-strip',
            solvent: 'O₂ Plasma Ashing',
          },
        };
        break;
      case 'liftoff':
        newStep = {
          id,
          title: getDefaultStepTitle('liftoff'),
          type: 'liftoff',
          enabled: true,
          blockId: blockId || undefined,
          strip: {
            stripType: 'metal-liftoff',
            solvent: 'Acetone / NMP Ultrasonic',
          },
        };
        break;
      case 'cmp':
        newStep = {
          id,
          title: getDefaultStepTitle('cmp'),
          type: 'cmp',
          enabled: true,
          blockId: blockId || undefined,
          cmp: {
            operation: 'cmp',
            mode: 'polish-depth',
            depth: 250,
            dishing: 0,
            erosion: 0,
          },
        };
        break;
      case 'bonding':
        newStep = {
          id,
          title: getDefaultStepTitle('bonding'),
          type: 'bonding',
          side: 'front',
          enabled: true,
          blockId: blockId || undefined,
          bonding: {
            sourceType: 'custom-substrate',
            bondingMethod: 'fusion',
            incomingFace: 'front',
            customLayers: [
              {
                id: `bond_layer_${Date.now()}`,
                name: 'Cap Wafer (Silicon <100>)',
                materialId: 'mat_si_sub',
                thickness: 2500,
              },
            ],
          },
        };
        break;
      case 'dicing':
        newStep = {
          id,
          title: getDefaultStepTitle('dicing'),
          type: 'dicing',
          side: 'front',
          enabled: true,
          blockId: blockId || undefined,
          dicing: {
            method: 'blade',
            cutMode: 'through-wafer',
            kerfWidth: 400,
            cutDepth: 1500,
            sidewallAngle: 90,
            tapeOvercut: 120,
            streets: [
              {
                id: `street_${Date.now()}`,
                xCenter: Math.round(flow.substrateWidth * 0.5),
              },
            ],
          },
        };
        break;
      case 'tape-frame':
        newStep = {
          id,
          title: getDefaultStepTitle('tape-frame'),
          type: 'tape-frame',
          side: 'back',
          enabled: true,
          blockId: blockId || undefined,
          tapeFrame: {
            action: 'mount',
            tapeMaterialId: 'mat_dicing_tape',
            thickness: 600,
            conformality: 'flat',
            showFrame: true,
          },
        };
        break;
      case 'anneal':
        newStep = {
          id,
          title: getDefaultStepTitle('anneal'),
          type: 'anneal',
          enabled: true,
          blockId: blockId || undefined,
        };
        break;
      default:
        newStep = {
          id,
          title: 'Generic Process Step',
          type: 'deposition',
          enabled: true,
          blockId: blockId || undefined,
        };
    }

    const { flow: newFlow, insertedIndex } =
      addPlacement.mode === 'after-selected'
        ? insertStepAfterIndex(flow, newStep, activeStepIndex)
        : insertStepIntoTimeline(
            flow,
            newStep,
            addPlacement.mode === 'into-block' ? addPlacement.blockId : null
          );
    const finalFlow =
      type === 'lithography'
        ? attachNewMaskToLithoStep(newFlow, newStep.id)
        : newFlow;
    onUpdateFlow(finalFlow);
    onSelectStepIndex(insertedIndex);
    setShowAddMenu(false);
    setAddPlacement({ mode: 'end' });
  };

  const handleMoveStep = (idx: number, direction: 'up' | 'down') => {
    const { flow: newFlow, newActiveIndex } = moveStepInTimeline(flow, idx, direction);
    onUpdateFlow(newFlow);
    if (newActiveIndex >= 0) {
      onSelectStepIndex(newActiveIndex);
    }
  };

  const handleDuplicateStep = (idx: number) => {
    const original = flow.steps[idx];
    const now = Date.now();
    const clonedBase: ProcessStep = {
      ...JSON.parse(JSON.stringify(original)),
      id: `step_${now}`,
      title: `${original.title} (Copy)`,
      bookmarked: undefined,
      bookmarkLabel: undefined,
    };
    const cloned = detachVariantsForDuplicatedStep(clonedBase, now);

    let dupMaskNameOverride: string | undefined;
    if (cloned.type === 'lithography' && cloned.lithography) {
      const nextLvl = getNextMaskLevelNumber(flow.masks || []);
      const tag = formatMaskLevelTag(nextLvl);
      const rawMaskLabel = (cloned.lithography.maskName || '')
        .replace(/^MASK\s+\d+:\s*/i, '')
        .trim();
      if (rawMaskLabel) {
        const copyLabel = /\(copy\)$/i.test(rawMaskLabel)
          ? rawMaskLabel
          : `${rawMaskLabel} (COPY)`;
        dupMaskNameOverride = `MASK ${tag}: ${copyLabel.toUpperCase()}`;
      }
      cloned.lithography = {
        ...cloned.lithography,
        maskId: undefined,
        maskName: undefined,
        windows: (cloned.lithography.windows || []).map((w, wIdx) => ({
          ...w,
          id: `w_${now}_${wIdx}`,
        })),
      };
    }

    const updated = [...flow.steps];
    updated.splice(idx + 1, 0, cloned);
    let nextFlow = normalizeFlowBlocksOrder({ ...flow, steps: updated });
    if (cloned.type === 'lithography') {
      nextFlow = attachNewMaskToLithoStep(
        nextFlow,
        cloned.id,
        dupMaskNameOverride ? { name: dupMaskNameOverride } : undefined
      );
    }
    onUpdateFlow(nextFlow);
    onSelectStepIndex(idx + 1);
  };

  const handleDeleteStep = (idx: number) => {
    const newFlow = deleteStepFromTimeline(flow, idx);
    onUpdateFlow(newFlow);
    if (newFlow.steps.length === 0) {
      onSelectStepIndex(-1);
    } else if (activeStepIndex === idx) {
      onSelectStepIndex(idx > 0 ? idx - 1 : 0);
    } else if (activeStepIndex > idx) {
      onSelectStepIndex(activeStepIndex - 1);
    }
  };

  const handleToggleStep = (idx: number) => {
    const updated = flow.steps.map((s, i) =>
      i === idx ? { ...s, enabled: !s.enabled } : s
    );
    onUpdateFlow({ ...flow, steps: updated });
  };

  const handleSwitchStepVariant = (stepId: string, targetVariantId: string) => {
    const targetStep = flow.steps.find((s) => s.id === stepId);
    if (!targetStep) return;
    const switched = switchStepVariant(targetStep, targetVariantId);
    let nextFlow: ProcessFlow = {
      ...flow,
      steps: flow.steps.map((s) => (s.id === stepId ? switched : s)),
    };
    if (switched.type === 'lithography') {
      nextFlow = syncStepWindowsToMask(nextFlow, switched);
    }
    onUpdateFlow(nextFlow);
  };

  const handleBranchStepVariant = (idx: number) => {
    const targetStep = flow.steps[idx];
    if (!targetStep) return;
    const branched = createStepVariant(targetStep);
    onUpdateFlow({
      ...flow,
      steps: flow.steps.map((s, i) => (i === idx ? branched : s)),
    });
    onSelectStepIndex(idx);
  };

  // Block management handlers
  const handleOpenCreateBlock = (forUngrouped: boolean = false) => {
    const blockNum = blocks.length + 1;
    setNewBlockName(`Module ${blockNum}: `);
    setNewBlockDescription('');
    setNewBlockColor(BLOCK_PALETTE[(blockNum - 1) % BLOCK_PALETTE.length]);
    setGroupUngroupedOnCreate(forUngrouped);
    setIsCreatingBlock(true);
  };

  const handleConfirmCreateBlock = () => {
    const trimmed = newBlockName.trim() || `Module ${blocks.length + 1}: Block`;
    let { flow: newFlow, block: newBlock } = createBlock(
      flow,
      trimmed,
      newBlockColor,
      newBlockDescription
    );

    if (groupUngroupedOnCreate) {
      const updatedSteps = newFlow.steps.map((step) =>
        !step.blockId ? { ...step, blockId: newBlock.id } : step
      );
      newFlow = normalizeFlowBlocksOrder({ ...newFlow, steps: updatedSteps });
    }

    onUpdateFlow(newFlow);
    setIsCreatingBlock(false);
    setNewBlockName('');
    setNewBlockDescription('');
  };

  const handleMoveBlock = (blockId: string, direction: 'up' | 'down', e: React.MouseEvent) => {
    e.stopPropagation();
    const activeStepId = activeStepIndex >= 0 ? flow.steps[activeStepIndex]?.id : null;
    const newFlow = moveBlockInTimeline(flow, blockId, direction);
    onUpdateFlow(newFlow);
    if (activeStepId) {
      const nextActiveIdx = newFlow.steps.findIndex((s) => s.id === activeStepId);
      if (nextActiveIdx >= 0 && nextActiveIdx !== activeStepIndex) {
        onSelectStepIndex(nextActiveIdx);
      }
    }
  };

  const handleCancelCreateBlock = () => {
    setIsCreatingBlock(false);
    setNewBlockName('');
    setNewBlockDescription('');
  };

  const handleStartEditBlock = (
    block: ProcessBlock,
    focusField: 'name' | 'description' = 'name'
  ) => {
    setEditingBlockId(block.id);
    setEditingBlockName(block.name);
    setEditingBlockDescription(block.description || '');
    setEditingBlockFocus(focusField);
  };

  const handleSaveBlockEdit = (blockId: string) => {
    const block = blocks.find((b) => b.id === blockId);
    if (block) {
      const nextName = editingBlockName.trim() || block.name;
      const nextDescription = editingBlockDescription.trim() || undefined;
      const newFlow = updateBlock(flow, {
        ...block,
        name: nextName,
        description: nextDescription,
      });
      onUpdateFlow(newFlow);
    }
    setEditingBlockId(null);
  };

  const handleDeleteBlock = (blockId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteConfirmBlockId(blockId);
  };

  const handleConfirmDeleteBlock = (blockId: string) => {
    const newFlow = deleteBlock(flow, blockId);
    onUpdateFlow(newFlow);
    setDeleteConfirmBlockId(null);
  };

  const handleToggleBlock = (blockId: string) => {
    const newFlow = toggleBlockCollapsed(flow, blockId);
    onUpdateFlow(newFlow);
  };

  const applyFlowWithActivePreserved = (nextFlow: ProcessFlow) => {
    if (nextFlow === flow) return;
    const activeStepId = activeStepIndex >= 0 ? flow.steps[activeStepIndex]?.id : null;
    onUpdateFlow(nextFlow);
    if (activeStepId) {
      const nextActiveIdx = nextFlow.steps.findIndex((s) => s.id === activeStepId);
      if (nextActiveIdx >= 0 && nextActiveIdx !== activeStepIndex) {
        onSelectStepIndex(nextActiveIdx);
      }
    }
  };

  const clearDragState = () => {
    setDragSource(null);
    setDropIndicator(null);
  };

  const toggleBulkEditMode = () => {
    setBulkEditMode((prev) => {
      if (prev) {
        setSelectedStepIds(new Set());
        setLastBulkClickedStepId(null);
        setBulkDeleteConfirm(false);
        clearDragState();
      } else {
        setBulkDeleteConfirm(false);
      }
      return !prev;
    });
  };

  const toggleBulkStepSelection = (stepId: string, shiftKey: boolean) => {
    setBulkDeleteConfirm(false);
    if (shiftKey && lastBulkClickedStepId) {
      const anchorIdx = flow.steps.findIndex((s) => s.id === lastBulkClickedStepId);
      const targetIdx = flow.steps.findIndex((s) => s.id === stepId);
      if (anchorIdx >= 0 && targetIdx >= 0) {
        const start = Math.min(anchorIdx, targetIdx);
        const end = Math.max(anchorIdx, targetIdx);
        setSelectedStepIds((prev) => {
          const next = new Set(prev);
          for (let i = start; i <= end; i++) {
            next.add(flow.steps[i].id);
          }
          return next;
        });
        setLastBulkClickedStepId(stepId);
        return;
      }
    }

    setSelectedStepIds((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) {
        next.delete(stepId);
      } else {
        next.add(stepId);
      }
      return next;
    });
    setLastBulkClickedStepId(stepId);
  };

  const toggleBulkBlockSelection = (blockSteps: { step: ProcessStep; idx: number }[]) => {
    setBulkDeleteConfirm(false);
    if (blockSteps.length === 0) return;
    const allSelected = blockSteps.every(({ step }) => validSelectedSet.has(step.id));
    setSelectedStepIds((prev) => {
      const next = new Set(prev);
      for (const { step } of blockSteps) {
        if (allSelected) {
          next.delete(step.id);
        } else {
          next.add(step.id);
        }
      }
      return next;
    });
  };

  const handleBulkSetEnabled = (enabled: boolean) => {
    if (validSelectedIdsOrdered.length === 0) return;
    const updatedSteps = flow.steps.map((s) =>
      validSelectedSet.has(s.id) ? { ...s, enabled } : s
    );
    onUpdateFlow({ ...flow, steps: updatedSteps });
  };

  const handleBulkAssignBlock = (targetBlockId: string | null) => {
    if (validSelectedIdsOrdered.length === 0) return;
    const nextFlow = assignStepsToBlock(flow, validSelectedIdsOrdered, targetBlockId);
    applyFlowWithActivePreserved(nextFlow);
  };

  const handleBulkDeleteSteps = () => {
    if (validSelectedIdsOrdered.length === 0) return;
    const activeId = activeStepIndex >= 0 ? flow.steps[activeStepIndex]?.id : null;
    const nextFlow = deleteStepsFromTimeline(flow, validSelectedIdsOrdered);
    onUpdateFlow(nextFlow);
    if (nextFlow.steps.length === 0) {
      onSelectStepIndex(-1);
    } else if (activeId) {
      const nextActiveIdx = nextFlow.steps.findIndex((s) => s.id === activeId);
      if (nextActiveIdx >= 0) {
        onSelectStepIndex(nextActiveIdx);
      } else {
        onSelectStepIndex(Math.min(Math.max(0, activeStepIndex), nextFlow.steps.length - 1));
      }
    }
    setSelectedStepIds(new Set());
    setLastBulkClickedStepId(null);
    setBulkDeleteConfirm(false);
  };

  const commitDrop = (indicator: DropIndicator | null) => {
    if (!dragSource || !indicator) {
      clearDragState();
      return;
    }

    if (dragSource.kind === 'block') {
      if (indicator.kind === 'timeline-item') {
        const nextFlow = reorderBlockInTimeline(
          flow,
          dragSource.blockId,
          indicator.timelineIndex,
          indicator.position
        );
        applyFlowWithActivePreserved(nextFlow);
      }
      clearDragState();
      return;
    }

    if (dragSource.kind === 'steps') {
      const nextFlow = reorderStepsInTimeline(flow, dragSource.stepIds, indicator);
      applyFlowWithActivePreserved(nextFlow);
      clearDragState();
      return;
    }

    // dragSource.kind === 'step'
    const target: StepDropTarget = indicator;
    const nextFlow = reorderStepInTimeline(flow, dragSource.stepId, target);
    applyFlowWithActivePreserved(nextFlow);
    clearDragState();
  };

  const DropLine = () => {
    const bulkDragCount = dragSource?.kind === 'steps' ? dragSource.stepIds.length : 0;
    return (
      <div className="relative h-0.5 my-0.5 bg-sky-400 rounded-full shadow-[0_0_8px_rgba(56,189,248,0.85)] pointer-events-none">
        <span className="absolute -left-0.5 -top-[3px] w-2 h-2 rounded-full bg-sky-400" />
        {bulkDragCount > 1 && (
          <span className="absolute right-1 -top-2.5 px-1.5 py-0.2 rounded bg-sky-500 text-slate-950 font-mono text-[9px] font-bold shadow">
            Move {bulkDragCount} steps
          </span>
        )}
      </div>
    );
  };

  // Render a step item card
  const renderStepItem = (
    step: ProcessStep,
    globalIdx: number,
    context:
      | { scope: 'timeline'; timelineIndex: number }
      | { scope: 'block'; blockId: string }
  ) => {
    const isSelected = activeStepIndex === globalIdx;
    const isBulkSelected = bulkEditMode && validSelectedSet.has(step.id);
    const isBeingDragged =
      (dragSource?.kind === 'step' && dragSource.stepId === step.id) ||
      (dragSource?.kind === 'steps' && dragSource.stepIds.includes(step.id));

    const showBeforeLine =
      (context.scope === 'timeline' &&
        dropIndicator?.kind === 'timeline-item' &&
        dropIndicator.timelineIndex === context.timelineIndex &&
        dropIndicator.position === 'before') ||
      (context.scope === 'block' &&
        dropIndicator?.kind === 'block-step' &&
        dropIndicator.blockId === context.blockId &&
        dropIndicator.stepId === step.id &&
        dropIndicator.position === 'before');

    const showAfterLine =
      (context.scope === 'timeline' &&
        dropIndicator?.kind === 'timeline-item' &&
        dropIndicator.timelineIndex === context.timelineIndex &&
        dropIndicator.position === 'after') ||
      (context.scope === 'block' &&
        dropIndicator?.kind === 'block-step' &&
        dropIndicator.blockId === context.blockId &&
        dropIndicator.stepId === step.id &&
        dropIndicator.position === 'after');

    const handleStepDragStart = (e: React.DragEvent<HTMLDivElement>) => {
      e.stopPropagation();
      e.dataTransfer.effectAllowed = 'move';
      if (bulkEditMode && validSelectedSet.has(step.id) && validSelectedIdsOrdered.length > 1) {
        e.dataTransfer.setData('text/plain', `steps:${validSelectedIdsOrdered.join(',')}`);
        if (bulkDragPreviewRef.current) {
          bulkDragPreviewRef.current.textContent = `Moving ${validSelectedIdsOrdered.length} steps`;
          try {
            e.dataTransfer.setDragImage(bulkDragPreviewRef.current, 18, 16);
          } catch {
            // ignore if unsupported
          }
        }
        setDragSource({ kind: 'steps', stepIds: validSelectedIdsOrdered });
        return;
      }
      e.dataTransfer.setData('text/plain', `step:${step.id}`);
      setDragSource({ kind: 'step', stepId: step.id, blockId: step.blockId });
    };

    const handleStepDragOver = (e: React.DragEvent<HTMLDivElement>) => {
      if (!dragSource) return;

      // If dragging a whole block over a step inside another block, let parent block handle it
      if (dragSource.kind === 'block' && context.scope === 'block') {
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';

      const rect = e.currentTarget.getBoundingClientRect();
      const position: 'before' | 'after' =
        e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';

      if (dragSource.kind === 'block') {
        if (context.scope === 'timeline') {
          setDropIndicator({
            kind: 'timeline-item',
            timelineIndex: context.timelineIndex,
            position,
          });
        }
        return;
      }

      // Dragging one or more steps
      if (
        (dragSource.kind === 'step' && dragSource.stepId === step.id) ||
        (dragSource.kind === 'steps' && dragSource.stepIds.includes(step.id))
      ) {
        setDropIndicator(null);
        return;
      }

      if (context.scope === 'block') {
        setDropIndicator({
          kind: 'block-step',
          blockId: context.blockId,
          stepId: step.id,
          position,
        });
      } else {
        setDropIndicator({
          kind: 'timeline-item',
          timelineIndex: context.timelineIndex,
          position,
        });
      }
    };

    const handleStepDrop = (e: React.DragEvent<HTMLDivElement>) => {
      if (!dragSource) return;
      if (dragSource.kind === 'block' && context.scope === 'block') {
        return;
      }
      e.preventDefault();
      e.stopPropagation();

      const rect = e.currentTarget.getBoundingClientRect();
      const position: 'before' | 'after' =
        e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';

      let target: DropIndicator | null = null;
      if (dragSource.kind === 'block' && context.scope === 'timeline') {
        target = {
          kind: 'timeline-item',
          timelineIndex: context.timelineIndex,
          position,
        };
      } else if (
        (dragSource.kind === 'step' && dragSource.stepId !== step.id) ||
        (dragSource.kind === 'steps' && !dragSource.stepIds.includes(step.id))
      ) {
        target =
          context.scope === 'block'
            ? {
                kind: 'block-step',
                blockId: context.blockId,
                stepId: step.id,
                position,
              }
            : {
                kind: 'timeline-item',
                timelineIndex: context.timelineIndex,
                position,
              };
      }
      commitDrop(target);
    };

    return (
      <div key={step.id} className="space-y-0.5">
        {showBeforeLine && <DropLine />}
        <div
          ref={(el) => {
            if (el) {
              stepCardRefs.current.set(step.id, el);
            } else {
              stepCardRefs.current.delete(step.id);
            }
          }}
          draggable={!isFilterActive}
          onDragStart={handleStepDragStart}
          onDragOver={handleStepDragOver}
          onDrop={handleStepDrop}
          onDragEnd={clearDragState}
          onClick={(e) => {
            if (bulkEditMode) {
              toggleBulkStepSelection(step.id, e.shiftKey);
              return;
            }
            onSelectStepIndex(globalIdx);
          }}
          onDoubleClick={() => {
            if (bulkEditMode) {
              onSelectStepIndex(globalIdx);
              return;
            }
            onSelectStepIndex(globalIdx);
            onOpenParameters?.();
          }}
          className={`group relative rounded-lg px-1.5 py-1 text-xs transition-all cursor-pointer border ${
            isBeingDragged ? 'opacity-40 scale-[0.98]' : ''
          } ${
            isBulkSelected
              ? 'bg-indigo-950/60 border-indigo-400/80 ring-1 ring-indigo-400/50 text-white shadow-md'
              : isSelected
              ? 'bg-sky-950/70 border-sky-500 text-white shadow-md'
              : step.bookmarked
              ? step.enabled
                ? 'bg-amber-950/20 border-amber-500/45 hover:bg-amber-950/35 hover:border-amber-400/70 text-slate-100'
                : 'bg-slate-950/30 border-amber-500/30 opacity-65 text-slate-400'
              : step.enabled
              ? 'bg-slate-900/75 border-slate-800/90 hover:bg-slate-800/70 hover:border-slate-700 text-slate-100'
              : 'bg-slate-950/30 border-slate-800/50 opacity-60 text-slate-400'
          }`}
        >
          <div className="flex items-start gap-1 min-w-0">
            {/* Bulk Edit Checkbox */}
            {bulkEditMode && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleBulkStepSelection(step.id, e.shiftKey);
                }}
                aria-label={isBulkSelected ? `Deselect step ${globalIdx + 1}` : `Select step ${globalIdx + 1}`}
                className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors ${
                  isBulkSelected
                    ? 'bg-indigo-500 border-indigo-400 text-white shadow-sm'
                    : 'bg-slate-900 border-slate-600 text-transparent hover:border-indigo-400'
                }`}
              >
                <Check className="w-2.5 h-2.5 stroke-[3]" />
              </button>
            )}

            {/* Drag handle */}
            {!isFilterActive && (
              <GripVertical
                className={`w-3 h-3 cursor-grab active:cursor-grabbing flex-shrink-0 -ml-0.5 mt-0.5 ${
                  isBulkSelected
                    ? 'text-indigo-300'
                    : 'text-slate-600 group-hover:text-slate-400'
                }`}
                aria-label={
                  isBulkSelected && validSelectedIdsOrdered.length > 1
                    ? `Drag to move ${validSelectedIdsOrdered.length} selected steps`
                    : 'Drag to reorder step'
                }
              />
            )}

            {/* Step global index badge */}
            <span
              className={`w-4 h-4 rounded flex items-center justify-center font-mono text-[9.5px] font-bold flex-shrink-0 mt-0.5 tabular-nums ${
                isBulkSelected
                  ? 'bg-indigo-500 text-white'
                  : isSelected
                  ? 'bg-sky-500 text-white'
                  : step.bookmarked
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'bg-slate-800 text-slate-300'
              }`}
            >
              {globalIdx + 1}
            </span>

            {/* Step icon */}
            <div className="flex-shrink-0 mt-0.5">{getStepIcon(step.type)}</div>

            {/* Step info (compact single-line title + metadata) */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-1 min-w-0">
                <span
                  className={`text-[11.5px] font-semibold leading-tight truncate ${
                    isSelected
                      ? 'text-white'
                      : step.enabled
                      ? 'text-slate-100'
                      : 'text-slate-400'
                  }`}
                  title={step.title}
                >
                  {step.title}
                </span>
                <div className="flex items-center gap-0.5 shrink-0">
                  {step.bookmarked && (
                    <span
                      className="inline-flex items-center gap-0.5 px-1 py-0 rounded bg-amber-500/15 text-amber-300 border border-amber-500/35 font-mono text-[8.5px] font-semibold max-w-[75px]"
                      title={
                        step.bookmarkLabel
                          ? `Milestone: ${step.bookmarkLabel}`
                          : 'Bookmarked milestone'
                      }
                    >
                      <Bookmark className="w-2 h-2 fill-amber-400 text-amber-400 shrink-0" />
                      {step.bookmarkLabel && (
                        <span className="truncate">{step.bookmarkLabel}</span>
                      )}
                    </span>
                  )}
                  {!step.enabled && (
                    <span className="px-1 py-0 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30 font-mono text-[8.5px] font-bold">
                      OFF
                    </span>
                  )}
                  {step.side === 'back' && (
                    <span className="px-1 py-0 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 font-mono text-[8.5px] font-bold">
                      BACK
                    </span>
                  )}
                  {step.side === 'both' && (
                    <span className="px-1 py-0 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-mono text-[8.5px] font-bold">
                      BOTH
                    </span>
                  )}
                </div>
              </div>
              <div className="text-[10px] text-slate-400 truncate font-mono leading-tight mt-0.5">
                {step.type === 'deposition' &&
                  `${step.deposition?.method || 'CVD'} · ${formatThickness(
                    step.deposition?.thickness || step.thickness || 200,
                    thicknessUnit
                  )}`}
                {step.type === 'lithography' &&
                  `${
                    step.lithography?.coatMethod === 'dry-film'
                      ? 'dry film · '
                      : step.lithography?.coatMethod === 'lor-bilayer'
                      ? `LOR (${formatThickness(step.lithography?.lorUndercut ?? 350, thicknessUnit)} UC) · `
                      : ''
                  }${step.lithography?.polarity || 'pos'} · ${
                    step.lithography?.maskField === 'light-field' ? 'LF' : 'DF'
                  } · ${
                    step.lithography?.maskName ||
                    `${step.lithography?.windows.length || 0} ${
                      step.lithography?.maskField === 'light-field' ? 'blockers' : 'slits'
                    }`
                  }${step.lithography?.definesAlignmentMarks ? ' · Align Marks' : ''}`}
                {step.type === 'etch' && (() => {
                  const rec = step.etch?.etchRecipeId
                    ? getEtchRecipeById(flow.etchLibrary, step.etch.etchRecipeId)
                    : undefined;
                  const ardeTag =
                    step.etch?.ardeEnabled &&
                    ['rie', 'drie-bosch', 'ion-beam', 'ashing'].includes(step.etch?.etchType || 'rie')
                      ? ' · ARDE'
                      : '';
                  if (rec && step.etch?.rateMode === 'time-rate') {
                    return `${step.etch?.etchType?.toUpperCase() || 'RIE'} · ${formatDurationCompact(
                      step.etch?.etchTimeSec ?? 60
                    )} · ${rec.chemistry}${ardeTag}`;
                  }
                  return `${step.etch?.etchType?.toUpperCase() || 'RIE'} · ${formatThickness(
                    step.etch?.depth || step.thickness || 200,
                    thicknessUnit
                  )}${rec ? ` · ${rec.chemistry}` : ''}${ardeTag}`;
                })()}
                {step.type === 'strip' && `${step.strip?.stripType || 'Resist Strip'}`}
                {step.type === 'liftoff' && 'Metal Lift-off'}
                {step.type === 'cmp' && 'Grind/Polish/Planarize'}
                {step.type === 'bonding' &&
                  `Bond (${step.bonding?.bondingMethod || 'fusion'}) · ${
                    step.bonding?.sourceType === 'imported-flow'
                      ? step.bonding?.importedFlowTitle || 'Imported Flow'
                      : `${step.bonding?.customLayers?.length || 1}L Custom`
                  }`}
                {step.type === 'dicing' &&
                  `Dice (${step.dicing?.method || 'blade'}) · ${
                    step.dicing?.streets?.length || 1
                  } cut${(step.dicing?.streets?.length || 1) === 1 ? '' : 's'} · ${formatThickness(
                    step.dicing?.kerfWidth || 400,
                    thicknessUnit
                  )}`}
                {step.type === 'tape-frame' &&
                  (step.tapeFrame?.action === 'demount'
                    ? 'UV Release / Demount Tape'
                    : `Mount · ${formatThickness(
                        step.tapeFrame?.thickness || 600,
                        thicknessUnit
                      )}`)}
                {step.type === 'anneal' && 'Thermal Anneal'}
              </div>

              {/* Inline Step Variant Switcher */}
              {step.variants && step.variants.length > 1 && (() => {
                const activeVar = getActiveStepVariant(step);
                return (
                  <div
                    className="mt-1 flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                  >
                    <span className="inline-flex items-center gap-0.5 px-1 py-0 rounded bg-violet-500/15 border border-violet-500/35 text-[9px] font-mono text-violet-300 shrink-0">
                      <GitBranch className="w-2.5 h-2.5 text-violet-400" />
                      <span>{step.variants.length}</span>
                    </span>
                    <select
                      value={activeVar?.id || step.variants[0].id}
                      onChange={(e) => handleSwitchStepVariant(step.id, e.target.value)}
                      aria-label={`Select variant for ${step.title}`}
                      className="min-w-0 flex-1 bg-slate-950/85 hover:bg-slate-800/90 border border-violet-500/35 focus:border-violet-400 rounded px-1 py-0 text-[10px] font-medium text-violet-200 truncate focus:outline-none cursor-pointer"
                    >
                      {step.variants.map((v) => (
                        <option key={v.id} value={v.id} className="bg-slate-900 text-slate-100">
                          {v.name}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Step Quick Actions: hidden in Bulk Edit mode so selection/drag stays clean */}
          {!bulkEditMode && (
            <div
              className={
                isSelected
                  ? 'flex items-center justify-end gap-0.5 mt-1 pt-0.5 border-t border-sky-500/25'
                  : 'hidden group-hover:flex items-center gap-0.5 absolute right-1 top-1 z-10 rounded-md bg-slate-900/95 border border-slate-700/90 px-0.5 py-0.5 shadow-lg'
              }
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
            >
            <button
              onClick={() => handleToggleBookmark(globalIdx)}
              className={`p-0.5 rounded hover:bg-slate-700/80 transition-colors ${
                step.bookmarked
                  ? 'text-amber-400 hover:text-amber-300'
                  : 'text-slate-400 hover:text-amber-300'
              }`}
              title={step.bookmarked ? 'Remove Milestone Bookmark' : 'Bookmark Step as Milestone'}
            >
              <Bookmark className={`w-3 h-3 ${step.bookmarked ? 'fill-amber-400' : ''}`} />
            </button>
            <button
              onClick={() => handleToggleStep(globalIdx)}
              className="p-0.5 rounded hover:bg-slate-700/80 text-slate-400 hover:text-slate-100 transition-colors"
              title={step.enabled ? 'Mute Step' : 'Enable Step'}
            >
              {step.enabled ? (
                <Eye className="w-3 h-3" />
              ) : (
                <EyeOff className="w-3 h-3 text-rose-400" />
              )}
            </button>
            <button
              disabled={globalIdx === 0 && !step.blockId}
              onClick={() => handleMoveStep(globalIdx, 'up')}
              className="p-0.5 rounded hover:bg-slate-700/80 text-slate-400 hover:text-slate-100 disabled:opacity-20 transition-colors"
              title={
                step.blockId && (globalIdx === 0 || flow.steps[globalIdx - 1]?.blockId !== step.blockId)
                  ? 'Move Up (Remove from block & place before block)'
                  : 'Move Step Up'
              }
            >
              <ArrowUp className="w-3 h-3" />
            </button>
            <button
              disabled={globalIdx === flow.steps.length - 1 && !step.blockId}
              onClick={() => handleMoveStep(globalIdx, 'down')}
              className="p-0.5 rounded hover:bg-slate-700/80 text-slate-400 hover:text-slate-100 disabled:opacity-20 transition-colors"
              title={
                step.blockId && (globalIdx === flow.steps.length - 1 || flow.steps[globalIdx + 1]?.blockId !== step.blockId)
                  ? 'Move Down (Remove from block & place after block)'
                  : 'Move Step Down'
              }
            >
              <ArrowDown className="w-3 h-3" />
            </button>
            <button
              onClick={() => handleBranchStepVariant(globalIdx)}
              className={`p-0.5 rounded hover:bg-slate-700/80 transition-colors ${
                step.variants && step.variants.length > 1
                  ? 'text-violet-400 hover:text-violet-300'
                  : 'text-slate-400 hover:text-violet-300'
              }`}
              title="Add Parameter Variant"
            >
              <GitBranch className="w-3 h-3" />
            </button>
            <button
              onClick={() => handleDuplicateStep(globalIdx)}
              className="p-0.5 rounded hover:bg-slate-700/80 text-slate-400 hover:text-slate-100 transition-colors"
              title="Duplicate Step"
            >
              <Copy className="w-3 h-3" />
            </button>
            <button
              onClick={() => handleDeleteStep(globalIdx)}
              className="p-0.5 rounded hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition-colors"
              title="Delete Step"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
          )}
        </div>
        {showAfterLine && <DropLine />}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 border-r border-slate-800 text-slate-200 select-none">
      {/* Offscreen Multi-Step Drag Ghost Badge */}
      <div
        ref={bulkDragPreviewRef}
        className="fixed -top-96 -left-96 pointer-events-none px-2.5 py-1.5 rounded-lg bg-indigo-600 border border-indigo-300 text-white text-xs font-semibold shadow-xl"
      >
        Moving steps
      </div>

      {/* Sidebar Top Header */}
      <div className="px-2 py-1 border-b border-slate-800 flex flex-wrap items-center justify-between gap-1 shrink-0">
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className="text-[10.5px] font-bold text-slate-200 tracking-wider uppercase leading-tight truncate">
            Process Traveller
          </span>
          <span className="text-[9.5px] text-slate-500 font-mono leading-tight shrink-0 tabular-nums">
            {blocks.length > 0 ? `${blocks.length}M·` : ''}{flow.steps.length}S
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            disabled={flow.steps.length === 0}
            onClick={toggleBulkEditMode}
            aria-pressed={bulkEditMode}
            className={`flex items-center gap-1 px-1.5 py-0.5 text-[10.5px] font-medium rounded border transition-colors disabled:opacity-40 disabled:pointer-events-none ${
              bulkEditMode
                ? 'bg-indigo-600 border-indigo-400 text-white shadow-sm'
                : 'bg-slate-800 hover:bg-slate-700 text-indigo-300 border-slate-700'
            }`}
            title="Toggle Bulk Edit Mode to select and drag-reorder multiple steps simultaneously"
          >
            <CheckSquare className="w-3 h-3" />
            <span>{bulkEditMode ? 'Done' : 'Bulk'}</span>
          </button>

          <button
            onClick={() => handleOpenCreateBlock(false)}
            className="flex items-center gap-1 px-1.5 py-0.5 text-[10.5px] font-medium rounded bg-slate-800 hover:bg-slate-700 text-sky-400 border border-slate-700 transition-colors"
            title="Create New Fabrication Block / Module"
          >
            <FolderPlus className="w-3 h-3" />
            <span className="hidden sm:inline">+Mod</span>
          </button>

          <button
            onClick={onOpenPresets}
            className="flex items-center gap-1 px-1.5 py-0.5 text-[10.5px] font-medium rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
          >
            <span>Presets</span>
          </button>

          {onOpenImportFlow && (
            <button
              type="button"
              onClick={onOpenImportFlow}
              className="flex items-center gap-1 px-1.5 py-0.5 text-[10.5px] font-medium rounded bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 transition-colors"
              title="Preview & import selected steps or masks from another process flow"
            >
              <FileInput className="w-3 h-3" />
              <span>Import</span>
            </button>
          )}

          {onOpenHelp && (
            <button
              type="button"
              onClick={onOpenHelp}
              className="p-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-sky-300 border border-slate-700 transition-colors"
              title="Help: Timeline, Process Blocks & Variants"
              aria-label="Help for Process Traveller"
            >
              <HelpCircle className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Play Flow Transport & Playback Options (Compact Single Row) */}
      <div className="px-2 py-1 border-b border-slate-800 bg-slate-950/70 flex items-center justify-between gap-1 shrink-0">
        <div className="flex items-center gap-1 min-w-0 flex-1">
          <button
            type="button"
            disabled={flow.steps.length === 0 || activeStepIndex === 0}
            onClick={() => onSelectStepIndex(flow.steps.length > 0 ? 0 : -1)}
            className="p-1 rounded-md bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none transition-colors shrink-0"
            title="First Process Step (Step 1)"
          >
            <SkipBack className="w-3 h-3" />
          </button>

          <button
            type="button"
            disabled={activeStepIndex <= -1}
            onClick={() => onSelectStepIndex(activeStepIndex - 1)}
            className="p-1 rounded-md bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none transition-colors shrink-0"
            title="Previous Step"
          >
            <ChevronLeft className="w-3 h-3" />
          </button>

          <button
            type="button"
            disabled={flow.steps.length === 0}
            onClick={onTogglePlay}
            className={`flex-1 min-w-0 flex items-center justify-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold transition-colors disabled:opacity-35 disabled:pointer-events-none ${
              isPlaying
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                : 'bg-sky-600 hover:bg-sky-500 text-white shadow-sm'
            }`}
            title={
              flow.steps.length === 0
                ? 'Add at least one process step to play'
                : isPlaying
                ? 'Pause Playback'
                : 'Play Process Sequence'
            }
          >
            {isPlaying ? (
              <>
                <Pause className="w-3 h-3 fill-current shrink-0" />
                <span className="truncate">Pause</span>
              </>
            ) : (
              <>
                <Play className="w-3 h-3 fill-current shrink-0" />
                <span className="truncate">Play</span>
              </>
            )}
          </button>

          <button
            type="button"
            disabled={activeStepIndex >= flow.steps.length - 1}
            onClick={() => onSelectStepIndex(activeStepIndex + 1)}
            className="p-1 rounded-md bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none transition-colors shrink-0"
            title="Next Step"
          >
            <ChevronRight className="w-3 h-3" />
          </button>

          <button
            type="button"
            disabled={flow.steps.length === 0 || activeStepIndex >= flow.steps.length - 1}
            onClick={() => onSelectStepIndex(flow.steps.length - 1)}
            className="p-1 rounded-md bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none transition-colors shrink-0"
            title={`Last Process Step (Step ${flow.steps.length})`}
          >
            <SkipForward className="w-3 h-3" />
          </button>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <span
            className="text-[10px] font-mono text-slate-400 tabular-nums px-1"
            title={
              activeStepIndex === -1
                ? `Substrate (0/${flow.steps.length})`
                : `Step ${activeStepIndex + 1} / ${flow.steps.length}`
            }
          >
            {activeStepIndex === -1 ? 0 : activeStepIndex + 1}/{flow.steps.length}
          </span>

          <div
            className="flex items-center px-1.5 py-0.5 rounded-md bg-slate-900 border border-slate-800 text-slate-300"
            title="Playback Speed"
          >
            <select
              value={playSpeed}
              onChange={(e) => onChangePlaySpeed(parseFloat(e.target.value))}
              aria-label="Playback Speed"
              className="bg-transparent text-sky-400 font-mono font-semibold text-[10px] focus:outline-none cursor-pointer"
            >
              <option value="0.5" className="bg-slate-900 text-slate-200">0.5×</option>
              <option value="1" className="bg-slate-900 text-slate-200">1×</option>
              <option value="1.5" className="bg-slate-900 text-slate-200">1.5×</option>
              <option value="2" className="bg-slate-900 text-slate-200">2×</option>
              <option value="3" className="bg-slate-900 text-slate-200">3×</option>
              <option value="5" className="bg-slate-900 text-slate-200">5×</option>
            </select>
          </div>
        </div>
      </div>

      {/* Step Search Filter */}
      <div className="px-2 py-1 border-b border-slate-800 bg-slate-950/50 shrink-0">
        <div className="relative flex items-center">
          <Search className="w-3 h-3 text-slate-500 absolute left-2 pointer-events-none" />
          <input
            type="text"
            value={stepSearchQuery}
            onChange={(e) => setStepSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && stepSearchQuery) {
                setStepSearchQuery('');
              }
            }}
            placeholder="Search steps, modules, milestones..."
            aria-label="Search process steps, modules, or milestones"
            className="w-full pl-6 pr-12 py-0.5 rounded bg-slate-900 border border-slate-800 text-[10.5px] text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500 transition-colors"
          />
          {isSearchActive && (
            <div className="absolute right-1 flex items-center gap-1">
              <span className="text-[10px] font-mono text-sky-400 bg-sky-500/10 px-1 py-0.5 rounded">
                {matchedStepCount}/{flow.steps.length}
              </span>
              <button
                type="button"
                onClick={() => setStepSearchQuery('')}
                className="p-0.5 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                title="Clear search"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Milestone Bookmarks Quick-Jump Bar */}
      <div className="border-b border-slate-800 bg-slate-950/65 shrink-0">
        <div className="px-2 py-0.5 flex items-center justify-between gap-1">
          <button
            type="button"
            onClick={() => setIsMilestonesExpanded((prev) => !prev)}
            className="flex items-center gap-1.5 min-w-0 text-[10.5px] font-semibold text-slate-300 hover:text-amber-300 transition-colors"
            title={
              bookmarkedSteps.length > 0
                ? 'Toggle milestone quick-jump list'
                : 'Bookmark steps to create quick-jump milestones'
            }
          >
            {bookmarkedSteps.length > 0 &&
              (isMilestonesExpanded ? (
                <ChevronDown className="w-3 h-3 text-slate-500 shrink-0" />
              ) : (
                <ChevronRight className="w-3 h-3 text-slate-500 shrink-0" />
              ))}
            <Bookmark
              className={`w-3 h-3 shrink-0 ${
                bookmarkedSteps.length > 0
                  ? 'text-amber-400 fill-amber-400'
                  : 'text-slate-500'
              }`}
            />
            <span className="truncate">Milestones</span>
            <span
              className={`px-1 py-0.2 rounded font-mono text-[9.5px] ${
                bookmarkedSteps.length > 0
                  ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                  : 'bg-slate-800 text-slate-500'
              }`}
            >
              {bookmarkedSteps.length}
            </span>
          </button>

          <div className="flex items-center gap-1 shrink-0">
            {activeStepIndex >= 0 && flow.steps[activeStepIndex] && (
              <button
                type="button"
                onClick={() => handleToggleBookmark(activeStepIndex)}
                className={`px-1.5 py-0.5 rounded text-[10px] font-medium border transition-colors flex items-center gap-1 ${
                  flow.steps[activeStepIndex].bookmarked
                    ? 'bg-amber-500/15 border-amber-500/40 text-amber-300 hover:bg-amber-500/25'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-amber-300 hover:border-slate-700'
                }`}
                title={
                  flow.steps[activeStepIndex].bookmarked
                    ? `Remove bookmark on Step ${activeStepIndex + 1}`
                    : `Bookmark Step ${activeStepIndex + 1}`
                }
              >
                <Bookmark
                  className={`w-2.5 h-2.5 ${
                    flow.steps[activeStepIndex].bookmarked ? 'fill-amber-400' : ''
                  }`}
                />
                <span className="hidden sm:inline">
                  {flow.steps[activeStepIndex].bookmarked ? 'Marked' : `Mark #${activeStepIndex + 1}`}
                </span>
              </button>
            )}

            {bookmarkedSteps.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setShowBookmarksOnly((prev) => !prev)}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium border transition-colors ${
                    showBookmarksOnly
                      ? 'bg-amber-500/20 border-amber-400/60 text-amber-200'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                  }`}
                  title={
                    showBookmarksOnly
                      ? 'Show all steps in timeline'
                      : 'Filter timeline to bookmarked milestones only'
                  }
                >
                  Only
                </button>
                <button
                  type="button"
                  onClick={() => handleJumpAdjacentBookmark('prev')}
                  className="p-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400 hover:text-amber-300 hover:border-slate-700 transition-colors"
                  title="Jump to Previous Bookmarked Milestone"
                >
                  <ChevronLeft className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => handleJumpAdjacentBookmark('next')}
                  className="p-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400 hover:text-amber-300 hover:border-slate-700 transition-colors"
                  title="Jump to Next Bookmarked Milestone"
                >
                  <ChevronRight className="w-3 h-3" />
                </button>
              </>
            )}
          </div>
        </div>

        {isMilestonesExpanded && bookmarkedSteps.length > 0 && (
          <div className="max-h-24 overflow-y-auto px-2 pb-1 space-y-0.5">
            {bookmarkedSteps.map(({ step, idx }) => {
              const isCurrent = idx === activeStepIndex;
              const isEditingLabel = editingBookmarkStepId === step.id;
              return (
                <div
                  key={step.id}
                  onClick={() => {
                    if (!isEditingLabel) jumpToStep(idx);
                  }}
                  className={`group/bm flex items-center justify-between gap-1 px-1.5 py-0.5 rounded border text-[10.5px] cursor-pointer transition-colors ${
                    isCurrent
                      ? 'bg-amber-500/15 border-amber-500/50 text-amber-100'
                      : 'bg-slate-900/75 border-slate-800/80 hover:border-amber-500/40 hover:bg-slate-800/80 text-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <span
                      className={`px-1 py-0 rounded font-mono text-[9px] font-bold shrink-0 ${
                        isCurrent
                          ? 'bg-amber-400 text-slate-950'
                          : 'bg-slate-800 text-amber-300'
                      }`}
                    >
                      #{idx + 1}
                    </span>
                    {isEditingLabel ? (
                      <div
                        className="flex items-center gap-1 flex-1 min-w-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="text"
                          autoFocus
                          value={editingBookmarkLabel}
                          onChange={(e) => setEditingBookmarkLabel(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveBookmarkLabel(step.id);
                            if (e.key === 'Escape') {
                              setEditingBookmarkStepId(null);
                              setEditingBookmarkLabel('');
                            }
                          }}
                          placeholder={step.title}
                          className="w-full min-w-0 px-1.5 py-0.5 rounded bg-slate-950 border border-amber-500/60 text-[10.5px] text-white focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => handleSaveBookmarkLabel(step.id)}
                          className="p-0.5 text-emerald-400 hover:text-emerald-300 shrink-0"
                          title="Save milestone label"
                        >
                          <Check className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium leading-tight">
                          {step.bookmarkLabel || step.title}
                        </div>
                        {step.bookmarkLabel && (
                          <div className="truncate text-[9px] text-slate-500 leading-tight">
                            {step.title}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {!isEditingLabel && (
                    <div
                      className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover/bm:opacity-100 transition-opacity"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setEditingBookmarkStepId(step.id);
                          setEditingBookmarkLabel(step.bookmarkLabel || '');
                        }}
                        className="p-0.5 rounded text-slate-400 hover:text-amber-300 hover:bg-slate-700/70"
                        title="Rename milestone label"
                      >
                        <Edit2 className="w-2.5 h-2.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleBookmark(idx)}
                        className="p-0.5 rounded text-slate-400 hover:text-rose-400 hover:bg-slate-700/70"
                        title="Remove bookmark"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Starting Substrate (Step 0) Item */}
      {substrateMatchesSearch && (
        <div className="px-2 py-1 border-b border-slate-800 bg-slate-950/40 shrink-0">
          <div
            onClick={() => onSelectStepIndex(-1)}
            onDoubleClick={() => {
              onSelectStepIndex(-1);
              onOpenParameters?.();
            }}
            className={`group px-2 py-1 rounded-lg cursor-pointer transition-all border ${
              isSubstrateSelected
                ? 'bg-emerald-950/50 border-emerald-500 text-white shadow-sm'
                : 'bg-slate-900/80 border-slate-800 hover:border-emerald-500/50 hover:bg-slate-850 text-slate-300'
            }`}
            title="Configure starting substrate layers"
          >
            <div className="flex items-center justify-between gap-1.5 mb-0.5">
              <div className="flex items-center gap-1.5 min-w-0">
                <span
                  className={`w-4 h-4 rounded flex items-center justify-center font-mono text-[9.5px] font-bold shrink-0 ${
                    isSubstrateSelected
                      ? 'bg-emerald-500 text-slate-950'
                      : 'bg-slate-800 text-emerald-400'
                  }`}
                >
                  0
                </span>
                <span className="font-semibold text-[11px] text-white truncate">
                  Substrate Stack
                </span>
              </div>

              <div className="flex items-center gap-1.5 shrink-0 text-[10px] font-mono">
                <span className="text-slate-400">
                  {subLayers.length}L · {(flow.substrateWidth / 1000).toFixed(0)}µm
                </span>
                <span className="text-emerald-400 font-semibold">
                  {formatThickness(totalSubThickness, thicknessUnit)}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex-1 flex rounded overflow-hidden h-1 border border-slate-700/80 bg-slate-950">
                {subLayers.map((l) => {
                  const mat = flow.materials.find((m) => m.id === l.materialId);
                  const widthPct = Math.max(8, (l.thickness / totalSubThickness) * 100);
                  return (
                    <div
                      key={l.id}
                      style={{
                        backgroundColor: mat?.color || '#64748b',
                        width: `${widthPct}%`,
                      }}
                      className="h-full border-r border-black/30 last:border-r-0"
                      title={`${l.name || mat?.name || 'Layer'}: ${formatThickness(l.thickness, thicknessUnit)}`}
                    />
                  );
                })}
              </div>
              <span className="text-[9.5px] text-emerald-400/90 font-medium shrink-0 group-hover:text-emerald-300">
                Edit →
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Edit Toolbar */}
      {bulkEditMode && (
        <div className="px-2.5 py-2 border-b border-indigo-500/40 bg-indigo-950/35 shrink-0 space-y-1.5">
          <div className="flex items-center justify-between gap-1.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <CheckSquare className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
              <span className="text-[11px] font-semibold text-indigo-200 truncate">
                {validSelectedIdsOrdered.length > 0
                  ? `${validSelectedIdsOrdered.length} selected`
                  : 'Bulk Edit'}
              </span>
            </div>
            <div className="flex items-center gap-1 shrink-0 text-[10px]">
              <button
                type="button"
                onClick={() => {
                  setBulkDeleteConfirm(false);
                  setSelectedStepIds(new Set(flow.steps.map((s) => s.id)));
                }}
                className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-medium transition-colors"
              >
                All
              </button>
              <button
                type="button"
                disabled={validSelectedIdsOrdered.length === 0}
                onClick={() => {
                  setBulkDeleteConfirm(false);
                  setSelectedStepIds(new Set());
                  setLastBulkClickedStepId(null);
                }}
                className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 disabled:opacity-35 font-medium transition-colors"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={toggleBulkEditMode}
                className="px-1.5 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-semibold transition-colors"
              >
                Done
              </button>
            </div>
          </div>

          {validSelectedIdsOrdered.length > 0 ? (
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  onClick={() => handleBulkSetEnabled(true)}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] text-emerald-300 font-medium transition-colors"
                  title="Enable selected steps"
                >
                  <Eye className="w-3 h-3" />
                  <span>Enable</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleBulkSetEnabled(false)}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] text-amber-300 font-medium transition-colors"
                  title="Mute selected steps"
                >
                  <EyeOff className="w-3 h-3" />
                  <span>Mute</span>
                </button>

                {blocks.length > 0 && (
                  <select
                    value=""
                    onChange={(e) => {
                      const val = e.target.value;
                      if (!val) return;
                      handleBulkAssignBlock(val === '__ungroup__' ? null : val);
                    }}
                    aria-label="Move selected steps to block"
                    className="flex-1 min-w-[95px] px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-[10px] text-slate-200 focus:outline-none focus:border-indigo-400 cursor-pointer"
                  >
                    <option value="" disabled>
                      Move to block...
                    </option>
                    {blocks.map((b) => (
                      <option key={b.id} value={b.id} className="bg-slate-900">
                        {b.name}
                      </option>
                    ))}
                    <option value="__ungroup__" className="bg-slate-900">
                      Ungroup from block
                    </option>
                  </select>
                )}

                {bulkDeleteConfirm ? (
                  <div className="flex items-center gap-1 ml-auto">
                    <button
                      type="button"
                      onClick={handleBulkDeleteSteps}
                      className="px-1.5 py-0.5 rounded bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-semibold"
                    >
                      Delete ({validSelectedIdsOrdered.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setBulkDeleteConfirm(false)}
                      className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px]"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setBulkDeleteConfirm(true)}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-800 hover:bg-rose-500/20 border border-slate-700 hover:border-rose-500/40 text-[10px] text-rose-300 font-medium ml-auto transition-colors"
                    title="Delete selected steps"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Delete</span>
                  </button>
                )}
              </div>

              <div className="text-[10px] text-indigo-300/90 leading-tight">
                {isFilterActive
                  ? 'Clear search/milestone filter to drag-reorder selected steps.'
                  : 'Drag any selected step to move all selected steps together.'}
              </div>
            </div>
          ) : (
            <div className="text-[10px] text-slate-400 leading-tight">
              Click or Shift+click steps to select multiple steps, then drag to reposition together.
            </div>
          )}
        </div>
      )}

      {/* FABRICATION STEPS LIST - GROUPED BY BLOCK HIERARCHY */}
      <div
        className="flex-1 overflow-y-auto p-1.5 space-y-1.5"
        onDragOver={(e) => {
          if (!dragSource) return;
          const items = buildTimelineItems(flow);
          if (items.length === 0) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setDropIndicator({
            kind: 'timeline-item',
            timelineIndex: items.length - 1,
            position: 'after',
          });
        }}
        onDrop={(e) => {
          if (!dragSource) return;
          const items = buildTimelineItems(flow);
          if (items.length === 0) return;
          e.preventDefault();
          commitDrop({
            kind: 'timeline-item',
            timelineIndex: items.length - 1,
            position: 'after',
          });
        }}
      >
        {/* In-app New Fabrication Block Form */}
        {isCreatingBlock && (
          <div className="p-3 rounded-xl bg-slate-950 border border-sky-500/70 shadow-2xl space-y-2.5 animate-in fade-in zoom-in-95 duration-100 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-bold text-sky-400 flex items-center gap-1.5 text-xs">
                <FolderPlus className="w-3.5 h-3.5" />
                New Fabrication Block / Module
              </span>
              <button
                type="button"
                onClick={handleCancelCreateBlock}
                className="text-slate-500 hover:text-slate-200 text-xs p-1"
              >
                ✕
              </button>
            </div>

            <div>
              <label className="block text-[10px] text-slate-400 mb-1 font-medium">
                Block Title / Name
              </label>
              <input
                type="text"
                autoFocus
                value={newBlockName}
                onChange={(e) => setNewBlockName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleConfirmCreateBlock();
                  if (e.key === 'Escape') handleCancelCreateBlock();
                }}
                placeholder="e.g. Module 3: Interconnect Metallization"
                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white font-medium text-xs focus:outline-none focus:border-sky-500"
              />
            </div>

            <div>
              <label className="block text-[10px] text-slate-400 mb-1 font-medium">
                Module Description (Optional)
              </label>
              <input
                type="text"
                value={newBlockDescription}
                onChange={(e) => setNewBlockDescription(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleConfirmCreateBlock();
                  if (e.key === 'Escape') handleCancelCreateBlock();
                }}
                placeholder="e.g. Gate oxide growth and poly-Si deposition"
                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 text-xs focus:outline-none focus:border-sky-500"
              />
            </div>

            <div>
              <label className="block text-[10px] text-slate-400 mb-1 font-medium">
                Module Accent Color
              </label>
              <div className="flex items-center gap-1.5">
                {BLOCK_PALETTE.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setNewBlockColor(c)}
                    className={`w-4 h-4 rounded-full border transition-all ${
                      newBlockColor === c ? 'scale-125 border-white ring-2 ring-sky-500/50' : 'border-transparent opacity-70 hover:opacity-100'
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>

            {groupUngroupedOnCreate && (
              <div className="text-[10px] text-amber-300 flex items-center gap-1 bg-amber-950/30 p-1.5 rounded-md border border-amber-500/30">
                <Check className="w-3 h-3 shrink-0" />
                <span>All currently ungrouped operations will be assigned to this module.</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={handleCancelCreateBlock}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmCreateBlock}
                className="px-3 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold text-[11px] shadow-sm flex items-center gap-1"
              >
                <Plus className="w-3 h-3" />
                Create Block
              </button>
            </div>
          </div>
        )}

        {(() => {
          const timelineItems = buildTimelineItems(flow);
          if (timelineItems.length === 0) {
            return (
              <div className="p-4 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-xl bg-slate-950/30 space-y-1">
                <div className="font-medium text-slate-400">No process steps yet</div>
                <div className="text-[11px] text-slate-500">
                  Configure the starting substrate above or add a fabrication step below.
                </div>
              </div>
            );
          }

          const visibleTimelineItems = isFilterActive
            ? timelineItems
                .map((item, timelineIdx) => {
                  if (item.kind === 'step') {
                    return stepMatchesFilters(item.step, item.idx)
                      ? { item, timelineIdx, visibleSteps: null }
                      : null;
                  }
                  if (!showBookmarksOnly && isSearchActive && blockMatchesQuery(item.block)) {
                    return { item, timelineIdx, visibleSteps: item.steps };
                  }
                  const matchingSteps = item.steps.filter(({ step, idx }) =>
                    stepMatchesFilters(step, idx, item.block)
                  );
                  if (matchingSteps.length === 0) return null;
                  return { item, timelineIdx, visibleSteps: matchingSteps };
                })
                .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
            : timelineItems.map((item, timelineIdx) => ({
                item,
                timelineIdx,
                visibleSteps: item.kind === 'block' ? item.steps : null,
              }));

          if (isFilterActive && visibleTimelineItems.length === 0 && !substrateMatchesSearch) {
            return (
              <div className="p-4 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-xl bg-slate-950/30 space-y-2">
                <div className="font-medium text-slate-300">
                  {showBookmarksOnly && !isSearchActive
                    ? 'No bookmarked milestone steps yet'
                    : isSearchActive
                    ? <>No matching steps for &ldquo;{stepSearchQuery.trim()}&rdquo;</>
                    : 'No matching steps'}
                </div>
                <div className="flex items-center justify-center gap-2">
                  {isSearchActive && (
                    <button
                      type="button"
                      onClick={() => setStepSearchQuery('')}
                      className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-400 text-[11px] font-medium transition-colors"
                    >
                      Clear Search
                    </button>
                  )}
                  {showBookmarksOnly && (
                    <button
                      type="button"
                      onClick={() => setShowBookmarksOnly(false)}
                      className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 text-[11px] font-medium transition-colors"
                    >
                      Show All Steps
                    </button>
                  )}
                </div>
              </div>
            );
          }

          const blockSequenceById = new Map<string, number>();
          let blockSeqCounter = 0;
          for (const tItem of timelineItems) {
            if (tItem.kind === 'block') {
              blockSeqCounter += 1;
              blockSequenceById.set(tItem.block.id, blockSeqCounter);
            }
          }

          return visibleTimelineItems.map(({ item, timelineIdx, visibleSteps }) => {
            if (item.kind === 'step') {
              return renderStepItem(item.step, item.idx, {
                scope: 'timeline',
                timelineIndex: timelineIdx,
              });
            }

            const { block } = item;
            const blockStepsWithIndex = visibleSteps || item.steps;
            const allBlockSteps = item.steps;
            const blockColor = block.color || '#0ea5e9';
            const modNum = blockSequenceById.get(block.id) || 1;
            const hasActiveStep = allBlockSteps.some(({ idx }) => idx === activeStepIndex);
            const isExpanded = !block.collapsed || isFilterActive;
            const stepRangeText =
              allBlockSteps.length === 0
                ? 'Empty'
                : allBlockSteps.length === 1
                ? `Step ${allBlockSteps[0].idx + 1} · 1 op`
                : `Steps ${allBlockSteps[0].idx + 1}–${
                    allBlockSteps[allBlockSteps.length - 1].idx + 1
                  } · ${allBlockSteps.length} ops`;
            const isEditing = editingBlockId === block.id;
            const isBlockBeingDragged =
              dragSource?.kind === 'block' && dragSource.blockId === block.id;
            const isDropIntoBlock =
              dropIndicator?.kind === 'into-block' &&
              dropIndicator.blockId === block.id;
            const showBlockBefore =
              dropIndicator?.kind === 'timeline-item' &&
              dropIndicator.timelineIndex === timelineIdx &&
              dropIndicator.position === 'before';
            const showBlockAfter =
              dropIndicator?.kind === 'timeline-item' &&
              dropIndicator.timelineIndex === timelineIdx &&
              dropIndicator.position === 'after';

            const computeBlockDropTarget = (
              e: React.DragEvent<HTMLDivElement>,
              zone: 'container' | 'header' | 'body'
            ): DropIndicator | null => {
              if (!dragSource) return null;

              if (dragSource.kind === 'block') {
                if (dragSource.blockId === block.id) return null;
                const rect = e.currentTarget.getBoundingClientRect();
                const position: 'before' | 'after' =
                  e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
                return {
                  kind: 'timeline-item',
                  timelineIndex: timelineIdx,
                  position,
                };
              }

              // dragSource.kind === 'step' | 'steps'
              const draggedAllInThisBlock =
                dragSource.kind === 'step'
                  ? dragSource.blockId === block.id
                  : dragSource.stepIds.every(
                      (id) => flow.steps.find((s) => s.id === id)?.blockId === block.id
                    );

              if (zone === 'header') {
                const rect = e.currentTarget.getBoundingClientRect();
                const relY = e.clientY - rect.top;
                if (relY < rect.height * 0.28) {
                  return {
                    kind: 'timeline-item',
                    timelineIndex: timelineIdx,
                    position: 'before',
                  };
                }
                if (block.collapsed && relY > rect.height * 0.78) {
                  return {
                    kind: 'timeline-item',
                    timelineIndex: timelineIdx,
                    position: 'after',
                  };
                }
                if (!draggedAllInThisBlock) {
                  return { kind: 'into-block', blockId: block.id };
                }
                return null;
              }

              if (zone === 'body') {
                if (!draggedAllInThisBlock) {
                  return { kind: 'into-block', blockId: block.id };
                }
                return null;
              }

              // Container bottom edge below steps -> drop ungrouped after block
              const rect = e.currentTarget.getBoundingClientRect();
              if (rect.bottom - e.clientY <= 12) {
                return {
                  kind: 'timeline-item',
                  timelineIndex: timelineIdx,
                  position: 'after',
                };
              }
              return null;
            };

            return (
              <div
                key={block.id}
                className="space-y-1"
                onDragOver={(e) => {
                  if (!dragSource) return;
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = 'move';
                  const target = computeBlockDropTarget(e, 'container');
                  if (target) {
                    setDropIndicator(target);
                  } else if (dragSource.kind === 'block' && dragSource.blockId === block.id) {
                    setDropIndicator(null);
                  }
                }}
                onDrop={(e) => {
                  if (!dragSource) return;
                  e.preventDefault();
                  e.stopPropagation();
                  const target = computeBlockDropTarget(e, 'container');
                  if (target) {
                    commitDrop(target);
                  } else {
                    clearDragState();
                  }
                }}
              >
                {showBlockBefore && <DropLine />}
                <div
                  className={`rounded-lg border overflow-hidden transition-all ${
                    isBlockBeingDragged ? 'opacity-40 scale-[0.99]' : ''
                  } ${
                    isDropIntoBlock
                      ? 'border-sky-400 ring-2 ring-sky-500/60 bg-sky-950/25'
                      : hasActiveStep
                      ? 'border-slate-600/90 bg-slate-950/85 shadow-md'
                      : 'border-slate-800 bg-slate-950/75 shadow-sm'
                  }`}
                >
                  {/* Top Color Cap identifying Module Section */}
                  <div
                    className="h-[2px] w-full"
                    style={{ backgroundColor: blockColor }}
                  />

                  {/* Module Header Band */}
                  <div
                    draggable={!isEditing}
                    onDragStart={(e) => {
                      if (isEditing) return;
                      e.stopPropagation();
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', `block:${block.id}`);
                      setDragSource({ kind: 'block', blockId: block.id });
                    }}
                    onDragEnd={clearDragState}
                    onDragOver={(e) => {
                      if (!dragSource) return;
                      if (dragSource.kind === 'block') return; // handled by block wrapper
                      const target = computeBlockDropTarget(e, 'header');
                      e.preventDefault();
                      e.stopPropagation();
                      e.dataTransfer.dropEffect = 'move';
                      setDropIndicator(target);
                    }}
                    onDrop={(e) => {
                      if (!dragSource) return;
                      if (dragSource.kind === 'block') return;
                      const target = computeBlockDropTarget(e, 'header');
                      e.preventDefault();
                      e.stopPropagation();
                      commitDrop(target);
                    }}
                    onClick={() => handleToggleBlock(block.id)}
                    style={{
                      background: `linear-gradient(115deg, ${blockColor}29 0%, rgba(30, 41, 59, 0.92) 55%, rgba(15, 23, 42, 0.96) 100%)`,
                    }}
                    className={`px-2 py-1.5 cursor-pointer transition-colors group hover:brightness-110 ${
                      isExpanded ? 'border-b border-slate-700/75' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <div className="flex items-center gap-1 min-w-0 flex-1">
                        {bulkEditMode && blockStepsWithIndex.length > 0 && (() => {
                          const selectedCountInBlock = blockStepsWithIndex.filter(({ step }) =>
                            validSelectedSet.has(step.id)
                          ).length;
                          const allInBlockSelected =
                            selectedCountInBlock === blockStepsWithIndex.length;
                          const someInBlockSelected =
                            selectedCountInBlock > 0 && !allInBlockSelected;
                          return (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleBulkBlockSelection(blockStepsWithIndex);
                              }}
                              title={
                                allInBlockSelected
                                  ? 'Deselect all steps in this module'
                                  : 'Select all steps in this module'
                              }
                              className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition-colors ${
                                allInBlockSelected || someInBlockSelected
                                  ? 'bg-indigo-500 border-indigo-400 text-white'
                                  : 'bg-slate-900 border-slate-600 text-transparent hover:border-indigo-400'
                              }`}
                            >
                              {allInBlockSelected ? (
                                <Check className="w-2.5 h-2.5 stroke-[3]" />
                              ) : someInBlockSelected ? (
                                <Minus className="w-2.5 h-2.5 stroke-[3]" />
                              ) : (
                                <Square className="w-2.5 h-2.5" />
                              )}
                            </button>
                          );
                        })()}
                        {!isEditing && (
                          <GripVertical
                            className="w-3 h-3 text-slate-500 group-hover:text-slate-200 cursor-grab active:cursor-grabbing shrink-0 -ml-0.5"
                            aria-label="Drag to reorder module"
                          />
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleBlock(block.id);
                          }}
                          className="p-0.5 text-slate-300 hover:text-white shrink-0"
                          aria-label={isExpanded ? 'Collapse module' : 'Expand module'}
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5" />
                          )}
                        </button>

                        <span
                          className="inline-flex items-center gap-1 px-1 py-0.5 rounded font-mono text-[9.5px] font-bold tracking-tight tabular-nums shrink-0 shadow-sm"
                          style={{
                            backgroundColor: blockColor,
                            color: getContrastTextColor(blockColor),
                          }}
                        >
                          {isExpanded ? (
                            <FolderOpen className="w-2.5 h-2.5 shrink-0" />
                          ) : (
                            <Folder className="w-2.5 h-2.5 shrink-0" />
                          )}
                          <span>M{modNum}</span>
                        </span>

                        {isEditing ? (
                          <div
                            className="flex items-center gap-1 flex-1 min-w-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="text"
                              value={editingBlockName}
                              onChange={(e) => setEditingBlockName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveBlockEdit(block.id);
                                if (e.key === 'Escape') setEditingBlockId(null);
                              }}
                              autoFocus={editingBlockFocus === 'name'}
                              placeholder="Module name..."
                              aria-label="Module name"
                              className="bg-slate-950 border border-sky-500 rounded px-1.5 py-0.5 text-[11.5px] font-semibold text-white flex-1 min-w-0 focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => handleSaveBlockEdit(block.id)}
                              className="p-0.5 text-emerald-400 hover:text-emerald-300 shrink-0"
                              title="Save module changes"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingBlockId(null)}
                              className="p-0.5 text-slate-400 hover:text-slate-200 shrink-0"
                              title="Cancel editing"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <span
                            className="font-bold text-[12px] text-white tracking-tight leading-tight truncate"
                            title={block.name}
                          >
                            {block.name}
                          </span>
                        )}
                      </div>

                      {!isEditing && (
                        <div className="flex items-center gap-1 shrink-0">
                          {bulkEditMode && (() => {
                            const selInBlock = blockStepsWithIndex.filter(({ step }) =>
                              validSelectedSet.has(step.id)
                            ).length;
                            if (selInBlock === 0) return null;
                            return (
                              <span className="text-[9.5px] font-mono tabular-nums text-indigo-200 bg-indigo-500/30 border border-indigo-400/50 px-1 py-0.5 rounded shrink-0">
                                {selInBlock} sel
                              </span>
                            );
                          })()}
                          <span
                            className="text-[10px] font-mono tabular-nums font-semibold text-slate-200 bg-slate-950/75 border border-slate-700/80 px-1.5 py-0.5 rounded shrink-0 whitespace-nowrap"
                            title={stepRangeText}
                          >
                            {isFilterActive && blockStepsWithIndex.length !== allBlockSteps.length
                              ? `${blockStepsWithIndex.length}/${allBlockSteps.length}`
                              : `${allBlockSteps.length}`}{' '}
                            {allBlockSteps.length === 1 ? 'step' : 'steps'}
                          </span>
                        </div>
                      )}
                    </div>

                    {isEditing ? (
                      <div
                        className="mt-1 pl-5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="text"
                          value={editingBlockDescription}
                          onChange={(e) => setEditingBlockDescription(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveBlockEdit(block.id);
                            if (e.key === 'Escape') setEditingBlockId(null);
                          }}
                          autoFocus={editingBlockFocus === 'description'}
                          placeholder="Add module description (optional)..."
                          aria-label="Module description"
                          className="w-full bg-slate-950 border border-slate-700 focus:border-sky-500 rounded px-1.5 py-0.5 text-[11px] text-slate-200 placeholder-slate-500 focus:outline-none"
                        />
                      </div>
                    ) : (
                      <div
                        className="mt-0.5 pl-5 flex items-center justify-between gap-1.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div
                          className="flex items-center gap-1 min-w-0 text-[10.5px] text-slate-300/80"
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            handleStartEditBlock(block, 'description');
                          }}
                          title={
                            block.description
                              ? `${block.description} (double-click to edit)`
                              : 'Double-click to add description'
                          }
                        >
                          {hasActiveStep && (
                            <span className="text-sky-300 font-semibold shrink-0">
                              Active ·
                            </span>
                          )}
                          <span className="truncate hover:text-white transition-colors">
                            {block.description ||
                              (allBlockSteps.length === 0
                                ? 'Empty module'
                                : allBlockSteps.length === 1
                                ? `Step ${allBlockSteps[0].idx + 1}`
                                : `Steps ${allBlockSteps[0].idx + 1}–${
                                    allBlockSteps[allBlockSteps.length - 1].idx + 1
                                  }`)}
                          </span>
                        </div>

                        <div className="flex items-center gap-0.5 shrink-0 opacity-70 group-hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            disabled={timelineIdx === 0}
                            onClick={(e) => handleMoveBlock(block.id, 'up', e)}
                            className="p-0.5 rounded hover:bg-slate-700/80 text-slate-400 hover:text-white disabled:opacity-20 transition-colors"
                            title="Move Module Up"
                          >
                            <ArrowUp className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            disabled={timelineIdx === timelineItems.length - 1}
                            onClick={(e) => handleMoveBlock(block.id, 'down', e)}
                            className="p-0.5 rounded hover:bg-slate-700/80 text-slate-400 hover:text-white disabled:opacity-20 transition-colors"
                            title="Move Module Down"
                          >
                            <ArrowDown className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleStartEditBlock(block, 'name')}
                            className="p-0.5 rounded hover:bg-slate-700/80 text-slate-400 hover:text-white transition-colors"
                            title="Edit Module Name & Description"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setAddPlacement({ mode: 'into-block', blockId: block.id });
                              setShowAddMenu(true);
                            }}
                            className="p-0.5 rounded hover:bg-slate-700/80 text-sky-400 hover:text-sky-300 transition-colors"
                            title="Add Step inside this Module"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => handleDeleteBlock(block.id, e)}
                            className="p-0.5 rounded hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition-colors"
                            title="Delete / Ungroup Module"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Nested Module Steps */}
                  {isExpanded && (
                    <div
                      className="px-1.5 py-1 space-y-1 bg-slate-950/85"
                      onDragOver={(e) => {
                        if (!dragSource || dragSource.kind === 'block') return;
                        if (blockStepsWithIndex.length === 0) {
                          const target = computeBlockDropTarget(e, 'body');
                          if (!target) return;
                          e.preventDefault();
                          e.stopPropagation();
                          e.dataTransfer.dropEffect = 'move';
                          setDropIndicator(target);
                        }
                      }}
                      onDrop={(e) => {
                        if (!dragSource || dragSource.kind === 'block') return;
                        if (blockStepsWithIndex.length === 0) {
                          const target = computeBlockDropTarget(e, 'body');
                          if (!target) return;
                          e.preventDefault();
                          e.stopPropagation();
                          commitDrop(target);
                        }
                      }}
                    >
                      {blockStepsWithIndex.map(({ step, idx }) =>
                        renderStepItem(step, idx, { scope: 'block', blockId: block.id })
                      )}

                      {blockStepsWithIndex.length === 0 && (
                        <div className="p-3 text-center text-slate-500 text-[11px] italic">
                          {isDropIntoBlock ? (
                            <span className="text-sky-300 font-medium not-italic">
                              Drop step here to add to module
                            </span>
                          ) : (
                            <>
                              No operations in this block yet.{' '}
                              <button
                                onClick={() => {
                                  setAddPlacement({ mode: 'into-block', blockId: block.id });
                                  setShowAddMenu(true);
                                }}
                                className="text-sky-400 hover:underline"
                              >
                                + Add Step
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {showBlockAfter && <DropLine />}
              </div>
            );
          });
        })()}
      </div>

      {/* Add Step Action Buttons & Popover */}
      <div className="relative px-2 py-1.5 border-t border-slate-800 bg-slate-900">
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => {
              if (showAddMenu && addPlacement.mode === 'after-selected') {
                setShowAddMenu(false);
              } else {
                setAddPlacement({ mode: 'after-selected' });
                setShowAddMenu(true);
              }
            }}
            title={
              activeStepIndex >= 0
                ? `Insert a new fabrication step immediately after Step ${activeStepIndex + 1}`
                : 'Insert a new fabrication step at the start of the flow (after Starting Substrate)'
            }
            className={`flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg text-[11px] font-medium transition-colors border active:scale-95 ${
              showAddMenu && addPlacement.mode === 'after-selected'
                ? 'bg-slate-800 border-sky-400 text-sky-300 ring-2 ring-sky-500/40'
                : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
            }`}
          >
            <Plus className="w-3.5 h-3.5 shrink-0 text-sky-400" />
            <span className="truncate">
              {activeStepIndex >= 0 ? `After Step ${activeStepIndex + 1}` : 'After Substrate'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (showAddMenu && addPlacement.mode === 'end') {
                setShowAddMenu(false);
              } else {
                setAddPlacement({ mode: 'end' });
                setShowAddMenu(true);
              }
            }}
            title="Append a new fabrication step at the end of the process flow"
            className={`flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg text-[11px] font-medium transition-colors shadow-lg shadow-sky-950/50 active:scale-95 ${
              showAddMenu && addPlacement.mode === 'end'
                ? 'bg-sky-500 text-white ring-2 ring-sky-300/60'
                : 'bg-sky-600 hover:bg-sky-500 text-white'
            }`}
          >
            <Plus className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Add at End</span>
          </button>
        </div>

        {showAddMenu && (
          <div className="absolute bottom-12 left-2 right-2 max-h-[65vh] overflow-y-auto p-2 bg-slate-950 border border-slate-700 rounded-2xl shadow-2xl z-30 space-y-1 animate-in fade-in zoom-in-95 duration-100">
            <div className="flex items-center justify-between px-2 py-1">
              <span className="text-[10px] uppercase font-bold text-slate-400">
                {addPlacement.mode === 'after-selected'
                  ? activeStepIndex >= 0
                    ? `Insert After Step ${activeStepIndex + 1}`
                    : 'Insert At Start (After Substrate)'
                  : addPlacement.mode === 'into-block'
                  ? `Add to ${
                      blocks.find((b) => b.id === addPlacement.blockId)?.name || 'Block'
                    }`
                  : 'Add Step at End of Flow'}
              </span>
              <button
                onClick={() => setShowAddMenu(false)}
                className="text-slate-500 hover:text-white text-xs"
              >
                ✕
              </button>
            </div>

            <button
              onClick={() => handleAddStep('deposition')}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-left hover:bg-slate-800 text-slate-200"
            >
              <Layers className="w-4 h-4 text-sky-400" />
              <div>
                <div className="font-medium">Thin Film Deposition</div>
                <div className="text-[10px] text-slate-500">CVD, ALD, Sputter, Plating, Dry Film</div>
              </div>
            </button>
            <button
              onClick={() => handleAddStep('lithography')}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-left hover:bg-slate-800 text-slate-200"
            >
              <Scissors className="w-4 h-4 text-rose-400" />
              <div>
                <div className="font-medium">Photolithography</div>
                <div className="text-[10px] text-slate-500">Spin / dry film resist & reticle exposure</div>
              </div>
            </button>
            <button
              onClick={() => handleAddStep('etch')}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-left hover:bg-slate-800 text-slate-200"
            >
              <Flame className="w-4 h-4 text-amber-400" />
              <div>
                <div className="font-medium">Etch (Plasma RIE / Wet / Bosch)</div>
                <div className="text-[10px] text-slate-500">Selective isotropic / anisotropic etch</div>
              </div>
            </button>
            <button
              onClick={() => handleAddStep('liftoff')}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-left hover:bg-slate-800 text-slate-200"
            >
              <Sparkles className="w-4 h-4 text-emerald-400" />
              <div>
                <div className="font-medium">Metal Lift-off</div>
                <div className="text-[10px] text-slate-500">Solvent resist strip with unanchored lift</div>
              </div>
            </button>
            <button
              onClick={() => handleAddStep('strip')}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-left hover:bg-slate-800 text-slate-200"
            >
              <Eraser className="w-4 h-4 text-teal-400" />
              <div>
                <div className="font-medium">Resist Strip / Sacrificial Release</div>
                <div className="text-[10px] text-slate-500">O2 plasma ashing or vapor HF release</div>
              </div>
            </button>
            <button
              onClick={() => handleAddStep('cmp')}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-left hover:bg-slate-800 text-slate-200"
            >
              <Disc className="w-4 h-4 text-cyan-400" />
              <div>
                <div className="font-medium">Grind/Polish/Planarize</div>
                <div className="text-[10px] text-slate-500">Wafer grinding, polishing &amp; CMP planarization</div>
              </div>
            </button>
            <button
              onClick={() => handleAddStep('bonding')}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-left hover:bg-slate-800 text-slate-200"
            >
              <Link2 className="w-4 h-4 text-indigo-400" />
              <div>
                <div className="font-medium">Wafer Bonding</div>
                <div className="text-[10px] text-slate-500">Bond custom substrate or imported pre-processed wafer</div>
              </div>
            </button>
            <button
              onClick={() => handleAddStep('tape-frame')}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-left hover:bg-slate-800 text-slate-200"
            >
              <Frame className="w-4 h-4 text-sky-300" />
              <div>
                <div className="font-medium">Tape &amp; Frame</div>
                <div className="text-[10px] text-slate-500">Mount on dicing/BG tape &amp; ring frame, or UV demount</div>
              </div>
            </button>
            <button
              onClick={() => handleAddStep('dicing')}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-left hover:bg-slate-800 text-slate-200"
            >
              <Slice className="w-4 h-4 text-orange-400" />
              <div>
                <div className="font-medium">Wafer Dicing</div>
                <div className="text-[10px] text-slate-500">Blade saw, laser grooving, stealth or plasma singulation</div>
              </div>
            </button>
          </div>
        )}
      </div>

      {/* In-app Block Deletion Confirmation Modal */}
      {deleteConfirmBlockId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-100">
          <div className="w-full max-w-sm rounded-xl bg-slate-900 border border-slate-700 p-5 space-y-4 text-xs text-slate-200 shadow-2xl">
            <div className="flex items-center gap-2 text-rose-400 font-bold text-sm">
              <Trash2 className="w-4 h-4 shrink-0" />
              <span>Delete Fabrication Module?</span>
            </div>
            <p className="text-slate-400 text-xs leading-relaxed">
              This will remove the module group container. All fabrication steps within this module will remain completely intact as ungrouped operations.
            </p>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setDeleteConfirmBlockId(null)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleConfirmDeleteBlock(deleteConfirmBlockId)}
                className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold shadow-md"
              >
                Delete Module
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
