/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useMemo, useEffect } from 'react';
import { ProcessFlow, ProcessStep, PhotomaskLevel, MaskWindow } from '../types/microfab';
import {
  calculateMaskMetrics,
  updateMaskAndSyncSteps,
  assignMaskToStep,
  swapMaskAssignments,
  createNewMaskInFlow,
  deleteMaskFromFlow,
  RETICLE_PALETTE,
} from '../lib/maskUtils';
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
  Sliders,
  Split,
  FlipHorizontal,
  Eye,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react';

interface MaskLevelsModalProps {
  flow: ProcessFlow;
  isOpen: boolean;
  onClose: () => void;
  onUpdateFlow: (updatedFlow: ProcessFlow) => void;
  onSelectStepIndex?: (index: number) => void;
  initialMaskId?: string;
}

interface DragState {
  winId: string;
  type: 'resize-start' | 'resize-end' | 'move';
  startClientX: number;
  initialXStart: number;
  initialXEnd: number;
}

export const MaskLevelsModal: React.FC<MaskLevelsModalProps> = ({
  flow,
  isOpen,
  onClose,
  onUpdateFlow,
  onSelectStepIndex,
  initialMaskId,
}) => {
  const masks = useMemo(() => flow.masks || [], [flow.masks]);
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
    targetStepTitle: string;
    targetStepIndex: number;
    conflictingMask: PhotomaskLevel;
    currentMask: PhotomaskLevel;
    currentMaskPriorStep?: {
      id: string;
      title: string;
      index: number;
    };
  }
  const [conflictPrompt, setConflictPrompt] = useState<ConflictPromptData | null>(null);
  const [feedbackNotice, setFeedbackNotice] = useState<{ message: string; type: 'success' | 'warn' } | null>(null);

  // Drag state for interactive aperture track
  const trackRef = useRef<HTMLDivElement>(null);
  const [activeWindowId, setActiveWindowId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);

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

  if (!isOpen) return null;

  // Active mask metrics
  const metrics = selectedMask ? calculateMaskMetrics(selectedMask, waferWidth) : null;

  // Assigned step for current mask
  const assignedStepInfo = selectedMask?.assignedStepId
    ? lithoSteps.find(({ step }) => step.id === selectedMask.assignedStepId)
    : null;

  // Handler: Update current mask
  const handleUpdateMask = (updated: PhotomaskLevel) => {
    const newFlow = updateMaskAndSyncSteps(flow, updated);
    onUpdateFlow(newFlow);
  };

  // Handler: Add new mask level beforehand
  const handleCreateNewMask = () => {
    const { flow: newFlow, newMask } = createNewMaskInFlow(flow);
    onUpdateFlow(newFlow);
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
      assignedStepId: undefined, // Fresh copy is unassigned
      windows: maskToDup.windows.map((w) => ({ ...w, id: `w_${Date.now()}_${Math.random().toString(36).substring(2, 6)}` })),
    };
    const { flow: newFlow } = createNewMaskInFlow(flow, newMask);
    onUpdateFlow(newFlow);
    setSelectedMaskId(newMask.id);
  };

  // Handler: Delete mask level
  const handleDeleteMask = (maskId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (masks.length <= 1) {
      setFeedbackNotice({
        message: 'The process flow requires at least one photomask level.',
        type: 'warn',
      });
      setTimeout(() => setFeedbackNotice(null), 3500);
      return;
    }
    const newFlow = deleteMaskFromFlow(flow, maskId);
    onUpdateFlow(newFlow);
    const remaining = (newFlow.masks || []);
    if (remaining.length > 0) {
      setSelectedMaskId(remaining[0].id);
    }
  };

  // Handler: Assign to Step with Conflict Detection & Confirmation
  const handleAssignStep = (targetStepId: string) => {
    if (!selectedMask) return;
    if (targetStepId === 'none') {
      const newFlow = assignMaskToStep(flow, selectedMask.id, null);
      onUpdateFlow(newFlow);
      setFeedbackNotice({
        message: `Unassigned ${selectedMask.name} from process steps.`,
        type: 'success',
      });
      setTimeout(() => setFeedbackNotice(null), 3000);
      return;
    }

    if (selectedMask.assignedStepId === targetStepId) {
      return;
    }

    // Check if another reticle in the library is already assigned to this step
    const conflictingMask = masks.find(
      (m) => m.id !== selectedMask.id && m.assignedStepId === targetStepId
    );

    if (conflictingMask) {
      const stepItem = lithoSteps.find(({ step }) => step.id === targetStepId);
      const priorStepItem = selectedMask.assignedStepId
        ? lithoSteps.find(({ step }) => step.id === selectedMask.assignedStepId)
        : undefined;

      setConflictPrompt({
        targetStepId,
        targetStepTitle: stepItem?.step.title || 'Photolithography Step',
        targetStepIndex: stepItem ? stepItem.index + 1 : 1,
        conflictingMask,
        currentMask: selectedMask,
        currentMaskPriorStep: priorStepItem
          ? {
              id: priorStepItem.step.id,
              title: priorStepItem.step.title,
              index: priorStepItem.index + 1,
            }
          : undefined,
      });
      return;
    }

    // No conflict: perform direct assignment
    const newFlow = assignMaskToStep(flow, selectedMask.id, targetStepId);
    onUpdateFlow(newFlow);
    const stepItem = lithoSteps.find(({ step }) => step.id === targetStepId);
    setFeedbackNotice({
      message: `Assigned ${selectedMask.name} to Step ${stepItem ? stepItem.index + 1 : ''}: ${stepItem?.step.title || ''}.`,
      type: 'success',
    });
    setTimeout(() => setFeedbackNotice(null), 3000);
  };

  const handleConfirmConflictSwap = () => {
    if (!conflictPrompt || !selectedMask) return;
    const { targetStepId, targetStepTitle, targetStepIndex, conflictingMask, currentMaskPriorStep } = conflictPrompt;
    
    // Execute photomask swap
    const newFlow = swapMaskAssignments(flow, selectedMask.id, targetStepId);
    onUpdateFlow(newFlow);

    if (currentMaskPriorStep) {
      setFeedbackNotice({
        message: `Swapped masks: Step ${targetStepIndex} ("${targetStepTitle}") now uses "${selectedMask.name}", and Step ${currentMaskPriorStep.index} ("${currentMaskPriorStep.title}") now uses "${conflictingMask.name}".`,
        type: 'success',
      });
    } else {
      setFeedbackNotice({
        message: `Swapped mask on Step ${targetStepIndex} ("${targetStepTitle}"): now configured with "${selectedMask.name}". "${conflictingMask.name}" is now unassigned.`,
        type: 'success',
      });
    }
    setTimeout(() => setFeedbackNotice(null), 4500);
    setConflictPrompt(null);
  };

  const handleCancelConflictSwap = () => {
    setConflictPrompt(null);
  };

  // Handler: Jump to assigned step
  const handleJumpToStep = () => {
    if (assignedStepInfo && onSelectStepIndex) {
      onSelectStepIndex(assignedStepInfo.index);
      onClose();
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
    setActiveWindowId(newWin.id);
  };

  const handleRemoveWindow = (winId: string) => {
    if (!selectedMask) return;
    const updated: PhotomaskLevel = {
      ...selectedMask,
      windows: selectedMask.windows.filter((w) => w.id !== winId),
    };
    handleUpdateMask(updated);
    if (activeWindowId === winId) setActiveWindowId(null);
  };

  const handleUpdateWindowCoord = (winId: string, field: 'xStart' | 'xEnd', val: number) => {
    if (!selectedMask) return;
    const clamped = Math.max(0, Math.min(waferWidth, val));
    const updatedWins = selectedMask.windows.map((w) => {
      if (w.id === winId) {
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

  // Pointer drag logic for interactive aperture track
  const handlePointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    win: MaskWindow,
    type: 'resize-start' | 'resize-end' | 'move'
  ) => {
    e.preventDefault();
    e.stopPropagation();

    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setActiveWindowId(win.id);
    setDragState({
      winId: win.id,
      type,
      startClientX: e.clientX,
      initialXStart: win.xStart,
      initialXEnd: win.xEnd,
    });
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState || !trackRef.current || !selectedMask) return;

    const rect = trackRef.current.getBoundingClientRect();
    const trackWidthPx = rect.width;
    if (trackWidthPx <= 0) return;

    const deltaPx = e.clientX - dragState.startClientX;
    const nmPerPixel = waferWidth / trackWidthPx;
    const deltaNm = deltaPx * nmPerPixel;

    // Snap to 50 nm increments
    const snapTo = (val: number) => Math.round(val / 50) * 50;

    const updatedWins = selectedMask.windows.map((w) => {
      if (w.id !== dragState.winId) return w;

      if (dragState.type === 'move') {
        const width = dragState.initialXEnd - dragState.initialXStart;
        let newStart = snapTo(dragState.initialXStart + deltaNm);
        let newEnd = newStart + width;

        if (newStart < 0) {
          newStart = 0;
          newEnd = width;
        }
        if (newEnd > waferWidth) {
          newEnd = waferWidth;
          newStart = waferWidth - width;
        }

        return { ...w, xStart: newStart, xEnd: newEnd };
      }

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

    handleUpdateMask({
      ...selectedMask,
      windows: updatedWins,
    });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragState) {
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch (err) {
        // ignore
      }
      setDragState(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/80 backdrop-blur-md">
      <div className="relative flex flex-col w-full max-w-6xl h-[92vh] max-h-[850px] bg-slate-950 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden text-slate-100 animate-in fade-in zoom-in-95 duration-150">
        {/* Top Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-slate-900 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <span className="w-8 h-8 rounded-xl bg-gradient-to-tr from-sky-600 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-sky-950/50">
              <Scan className="w-4 h-4" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-tight">
                  Photolithography Mask Levels
                </h2>
                <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20">
                  {masks.length} {masks.length === 1 ? 'Reticle' : 'Reticles'}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Manage reticle set hierarchy, configure aperture geometries, and assign masks to photolithography steps.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCreateNewMask}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold shadow-md shadow-sky-900/30 transition-all active:scale-95"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Mask Level</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              title="Close Mask Levels Panel"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Master-Detail Workspace */}
        <div className="flex-1 flex overflow-hidden min-h-0">
          {/* LEFT SIDEBAR: Mask Set Hierarchy List */}
          <div className="w-80 md:w-96 flex flex-col border-r border-slate-800 bg-slate-900/60 shrink-0">
            {/* Search Bar */}
            <div className="p-3 border-b border-slate-800">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search mask levels..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500"
                />
              </div>
            </div>

            {/* Mask Level Cards List */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {filteredMasks.map((mask, idx) => {
                const isSelected = selectedMask?.id === mask.id;
                const assigned = mask.assignedStepId
                  ? lithoSteps.find(({ step }) => step.id === mask.assignedStepId)
                  : null;
                const mMetrics = calculateMaskMetrics(mask, waferWidth);

                return (
                  <div
                    key={mask.id}
                    onClick={() => setSelectedMaskId(mask.id)}
                    className={`group relative p-3 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-sky-950/30 border-sky-500/80 shadow-md shadow-sky-950/40'
                        : 'bg-slate-950/70 border-slate-800 hover:border-slate-700 hover:bg-slate-950'
                    }`}
                  >
                    {/* Header: Level Tag & Name */}
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2 min-w-0 flex-1 truncate">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: mask.color || RETICLE_PALETTE[idx % RETICLE_PALETTE.length] }}
                        />
                        <span className="font-mono text-[11px] font-semibold text-slate-400 shrink-0">
                          {mask.layerCode || `L${idx + 1}`}
                        </span>
                        <span className="text-xs font-semibold text-slate-200 truncate group-hover:text-sky-300 transition-colors">
                          {mask.name}
                        </span>
                      </div>

                      {/* Duplicate & Delete actions */}
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => handleDuplicateMask(mask, e)}
                          className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800"
                          title="Duplicate Mask Level"
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => handleDeleteMask(mask.id, e)}
                          className="p-1 rounded text-rose-400 hover:text-rose-300 hover:bg-rose-950/30"
                          title="Delete Mask Level"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    {/* Miniature Reticle Aperture Preview Strip */}
                    <div className="h-2 w-full bg-slate-900 rounded overflow-hidden border border-slate-800 relative mb-2">
                      {mask.windows.map((w, wIdx) => {
                        const leftPct = (w.xStart / waferWidth) * 100;
                        const widthPct = ((w.xEnd - w.xStart) / waferWidth) * 100;
                        return (
                          <div
                            key={w.id || `mini_${wIdx}`}
                            className="absolute top-0 bottom-0 bg-amber-400"
                            style={{
                              left: `${leftPct}%`,
                              width: `${Math.max(1, widthPct)}%`,
                            }}
                          />
                        );
                      })}
                    </div>

                    {/* Metadata strip */}
                    <div className="flex items-center justify-between text-[10px] text-slate-400">
                      <div className="flex items-center gap-1.5">
                        <span className="capitalize text-slate-300 font-medium">
                          {mask.polarity} Resist
                        </span>
                        <span>·</span>
                        <span>{mMetrics.apertureCount} {mMetrics.apertureCount === 1 ? 'Aperture' : 'Apertures'}</span>
                        <span>·</span>
                        <span className="font-mono text-amber-400/90">{mMetrics.clearPercentage}% Clear</span>
                      </div>
                    </div>

                    {/* Assigned Step Status */}
                    <div className="mt-2 pt-1.5 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
                      {assigned ? (
                        <div className="flex items-center gap-1 text-sky-400 truncate">
                          <Check className="w-3 h-3 shrink-0" />
                          <span className="truncate">
                            Step {assigned.index + 1}: {assigned.step.title}
                          </span>
                        </div>
                      ) : (
                        <span className="text-amber-400/80 italic text-[10px]">
                          Unassigned (Ready for assignment)
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}

              {filteredMasks.length === 0 && (
                <div className="p-6 text-center text-slate-500 text-xs">
                  No mask levels match your search.
                </div>
              )}
            </div>

            {/* Sidebar Bottom summary */}
            <div className="p-3 border-t border-slate-800 bg-slate-950/80 text-[11px] text-slate-400 flex items-center justify-between">
              <span>Total Reticles: {masks.length}</span>
              <button
                onClick={handleCreateNewMask}
                className="text-sky-400 hover:text-sky-300 font-medium hover:underline text-[11px]"
              >
                + Add Another Mask
              </button>
            </div>
          </div>

          {/* RIGHT MAIN PANEL: Active Mask CAD Inspector */}
          {selectedMask ? (
            <div className="flex-1 flex flex-col overflow-y-auto bg-slate-950 p-4 sm:p-6 space-y-5">
              {/* Mask General Configuration Card */}
              <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span
                      className="w-4 h-4 rounded-full border border-white/20 shrink-0"
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
                      className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1 font-bold text-sm text-white focus:outline-none focus:border-sky-500 flex-1 max-w-md"
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
                      className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 font-mono text-xs text-sky-400 focus:outline-none focus:border-sky-500 w-24 text-center uppercase"
                      placeholder="CODE"
                      title="Mask Layer Code (e.g. GATE-01)"
                    />
                  </div>

                  {/* Polarity & Duplicate/Delete */}
                  <div className="flex items-center gap-2">
                    <div className="flex items-center bg-slate-950 border border-slate-700 rounded-lg p-0.5 text-xs">
                      <button
                        onClick={() =>
                          handleUpdateMask({
                            ...selectedMask,
                            polarity: 'positive',
                          })
                        }
                        className={`px-2.5 py-1 rounded font-medium transition-colors ${
                          selectedMask.polarity === 'positive'
                            ? 'bg-sky-600 text-white'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                        title="Positive Resist: Apertures expose resist, exposed areas dissolve"
                      >
                        Positive Resist
                      </button>
                      <button
                        onClick={() =>
                          handleUpdateMask({
                            ...selectedMask,
                            polarity: 'negative',
                          })
                        }
                        className={`px-2.5 py-1 rounded font-medium transition-colors ${
                          selectedMask.polarity === 'negative'
                            ? 'bg-amber-600 text-white'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                        title="Negative Resist: Unexposed areas dissolve, exposed areas crosslink and stay"
                      >
                        Negative Resist
                      </button>
                    </div>

                    <button
                      onClick={() => handleDuplicateMask(selectedMask)}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs transition-colors"
                      title="Duplicate this Mask Level"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Step Assignment Row */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1 font-medium">
                      Assigned Photolithography Step in Process Flow
                    </label>
                    <div className="flex items-center gap-2">
                      <select
                        value={selectedMask.assignedStepId || 'none'}
                        onChange={(e) => handleAssignStep(e.target.value)}
                        className="flex-1 px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-slate-200 focus:outline-none focus:border-sky-500 font-mono"
                      >
                        <option value="none">-- Unassigned (Stand-alone Reticle) --</option>
                        {lithoSteps.map(({ step, index }) => {
                          const isCurrent = selectedMask.assignedStepId === step.id;
                          const conflicting = masks.find(
                            (m) => m.id !== selectedMask.id && m.assignedStepId === step.id
                          );
                          return (
                            <option key={step.id} value={step.id}>
                              Step {index + 1}: {step.title}
                              {isCurrent
                                ? '  [Current Assigned Step]'
                                : conflicting
                                ? `  [Assigned to: ${conflicting.layerCode || 'Reticle'} ${conflicting.name}]`
                                : '  (Available)'}
                            </option>
                          );
                        })}
                      </select>

                      {assignedStepInfo && (
                        <button
                          onClick={handleJumpToStep}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-sky-600/20 text-sky-300 hover:bg-sky-600/30 border border-sky-500/40 text-xs font-semibold shrink-0 transition-colors"
                          title="Jump directly to this step in the Cross-Section CAD"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>View Step</span>
                        </button>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1 font-medium">
                      Description / Layer Function Notes
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
                      className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500"
                      placeholder="e.g. Critical gate length definition for self-aligned CMOS"
                    />
                  </div>
                </div>

                {/* Reticle Color Swatches */}
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-[11px] text-slate-400">Reticle Accent Color:</span>
                  <div className="flex items-center gap-1.5">
                    {RETICLE_PALETTE.map((color) => (
                      <button
                        key={color}
                        onClick={() => handleUpdateMask({ ...selectedMask, color })}
                        className={`w-5 h-5 rounded-full border transition-transform ${
                          selectedMask.color === color ? 'scale-125 border-white shadow-sm' : 'border-transparent opacity-70 hover:opacity-100'
                        }`}
                        style={{ backgroundColor: color }}
                        title={color}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Cleanroom DRC Metric Strip */}
              {metrics && (
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                  <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800 text-center">
                    <span className="block text-[10px] text-slate-400 uppercase tracking-wider">Apertures</span>
                    <span className="text-base font-bold font-mono text-white">{metrics.apertureCount}</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800 text-center">
                    <span className="block text-[10px] text-slate-400 uppercase tracking-wider">Clear Field Area</span>
                    <span className="text-base font-bold font-mono text-amber-400">{metrics.clearPercentage}%</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800 text-center">
                    <span className="block text-[10px] text-slate-400 uppercase tracking-wider">Total Transmitted</span>
                    <span className="text-base font-bold font-mono text-sky-400">{metrics.totalClearWidthUm} µm</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800 text-center">
                    <span className="block text-[10px] text-slate-400 uppercase tracking-wider">Min Critical Feature</span>
                    <span className="text-base font-bold font-mono text-emerald-400">
                      {metrics.minFeatureSizeNm >= 1000 ? `${metrics.minFeatureSizeUm} µm` : `${metrics.minFeatureSizeNm} nm`}
                    </span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800 text-center col-span-2 sm:col-span-1">
                    <span className="block text-[10px] text-slate-400 uppercase tracking-wider">Wafer Field Span</span>
                    <span className="text-base font-bold font-mono text-slate-200">{(waferWidth / 1000).toFixed(1)} µm</span>
                  </div>
                </div>
              )}

              {/* INTERACTIVE APERTURE TRACK SECTION */}
              <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-xs text-slate-200">
                      Aperture Track (Slit Positions & Dimensions)
                    </span>
                    <span className="text-[11px] text-slate-400">
                      · Drag to slide · Drag borders to resize · 50nm snapping
                    </span>
                  </div>

                  {/* Preset Pattern Buttons */}
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-[10px] text-slate-400 mr-1">Presets:</span>
                    <button
                      onClick={() => handleApplyPreset('center-slit')}
                      className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] border border-slate-700 transition-colors"
                      title="Single Center Slit"
                    >
                      Center Slit
                    </button>
                    <button
                      onClick={() => handleApplyPreset('dual-pad')}
                      className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] border border-slate-700 transition-colors"
                      title="Dual Contact Openings"
                    >
                      Dual Pads
                    </button>
                    <button
                      onClick={() => handleApplyPreset('grating')}
                      className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] border border-slate-700 transition-colors"
                      title="Periodic Grating Slits"
                    >
                      Grating
                    </button>
                    <button
                      onClick={() => handleApplyPreset('invert')}
                      className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] border border-slate-700 transition-colors"
                      title="Invert Chrome / Clear"
                    >
                      <FlipHorizontal className="w-3 h-3" />
                      <span>Invert</span>
                    </button>
                    <button
                      onClick={handleAddWindow}
                      className="flex items-center gap-1 px-2.5 py-0.5 rounded bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-semibold transition-colors"
                    >
                      <Plus className="w-3 h-3" />
                      <span>Add Slit</span>
                    </button>
                  </div>
                </div>

                {/* Visual Draggable Mask Track */}
                <div
                  ref={trackRef}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  className="relative h-14 bg-slate-950 border border-slate-800 rounded-xl overflow-hidden cursor-default select-none shadow-inner"
                >
                  {/* Chrome Opaque Background */}
                  <div
                    className="absolute inset-0 opacity-40"
                    style={{
                      backgroundImage:
                        'repeating-linear-gradient(45deg, #1e293b 0, #1e293b 8px, #0f172a 8px, #0f172a 16px)',
                    }}
                  />

                  {/* Clear Glass Aperture Boxes */}
                  {selectedMask.windows.map((win, idx) => {
                    const leftPct = (win.xStart / waferWidth) * 100;
                    const widthPct = ((win.xEnd - win.xStart) / waferWidth) * 100;
                    const isActive = activeWindowId === win.id;
                    const widthNm = Math.round(win.xEnd - win.xStart);

                    return (
                      <div
                        key={win.id || `win_${idx}`}
                        className={`absolute top-1 bottom-1 rounded-lg flex items-center justify-center transition-shadow ${
                          isActive
                            ? 'bg-amber-400/95 text-slate-950 shadow-lg shadow-amber-500/30 ring-2 ring-white z-20'
                            : 'bg-amber-500/85 hover:bg-amber-400 text-slate-950 shadow-md z-10'
                        }`}
                        style={{
                          left: `${leftPct}%`,
                          width: `${Math.max(1, widthPct)}%`,
                          cursor: 'grab',
                        }}
                        onPointerDown={(e) => handlePointerDown(e, win, 'move')}
                      >
                        {/* Left edge resize handle */}
                        <div
                          className="absolute left-0 top-0 bottom-0 w-3 cursor-ew-resize hover:bg-white/40 flex items-center justify-center group"
                          onPointerDown={(e) => handlePointerDown(e, win, 'resize-start')}
                          title="Drag to resize left edge"
                        >
                          <div className="w-1 h-4 bg-slate-900/40 rounded-full group-hover:bg-slate-950" />
                        </div>

                        {/* Aperture label (width) */}
                        <span className="font-mono text-[10px] font-bold px-1 select-none pointer-events-none truncate">
                          {widthNm >= 1000 ? `${(widthNm / 1000).toFixed(2)} µm` : `${widthNm} nm`}
                        </span>

                        {/* Right edge resize handle */}
                        <div
                          className="absolute right-0 top-0 bottom-0 w-3 cursor-ew-resize hover:bg-white/40 flex items-center justify-center group"
                          onPointerDown={(e) => handlePointerDown(e, win, 'resize-end')}
                          title="Drag to resize right edge"
                        >
                          <div className="w-1 h-4 bg-slate-900/40 rounded-full group-hover:bg-slate-950" />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Coordinate Scale Bar beneath track */}
                <div className="flex justify-between items-center text-[10px] font-mono text-slate-400 px-1 pt-1">
                  <span>0.0 µm</span>
                  <span>{(waferWidth / 4000).toFixed(1)} µm</span>
                  <span>{(waferWidth / 2000).toFixed(1)} µm</span>
                  <span>{((waferWidth * 3) / 4000).toFixed(1)} µm</span>
                  <span>{(waferWidth / 1000).toFixed(1)} µm</span>
                </div>
              </div>

              {/* PRECISION NUMERIC APERTURE TABLE */}
              <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-xs text-slate-200">
                    Aperture Windows Coordinates ({selectedMask.windows.length})
                  </span>

                  <button
                    onClick={handleAddWindow}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-400 hover:text-sky-300 border border-slate-700 text-xs font-semibold transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Aperture Window</span>
                  </button>
                </div>

                <div className="border border-slate-800 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-900/90 text-[11px] text-slate-400 font-mono uppercase tracking-wider border-b border-slate-800">
                      <tr>
                        <th className="px-3.5 py-2">Window #</th>
                        <th className="px-3.5 py-2">Start $X_1$ (nm)</th>
                        <th className="px-3.5 py-2">End $X_2$ (nm)</th>
                        <th className="px-3.5 py-2">Width $\Delta X$</th>
                        <th className="px-3.5 py-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/80 bg-slate-950/40">
                      {selectedMask.windows.map((win, idx) => {
                        const widthNm = Math.round(win.xEnd - win.xStart);
                        const widthUm = (widthNm / 1000).toFixed(2);

                        return (
                          <tr
                            key={win.id || `row_${idx}`}
                            className={`hover:bg-slate-900/40 transition-colors ${
                              activeWindowId === win.id ? 'bg-sky-950/20' : ''
                            }`}
                          >
                            <td className="px-3.5 py-2 font-mono text-slate-300">
                              <span className="inline-block w-2 h-2 rounded-full bg-amber-400 mr-2" />
                              W-{idx + 1}
                            </td>

                            <td className="px-3.5 py-2">
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="number"
                                  min="0"
                                  max={waferWidth}
                                  step="50"
                                  value={win.xStart}
                                  onChange={(e) =>
                                    handleUpdateWindowCoord(win.id, 'xStart', parseFloat(e.target.value || '0'))
                                  }
                                  className="w-24 px-2 py-1 rounded bg-slate-900 border border-slate-700 text-slate-100 font-mono text-xs focus:outline-none focus:border-sky-500"
                                />
                                <span className="text-[10px] text-slate-500 font-mono">
                                  ({(win.xStart / 1000).toFixed(2)} µm)
                                </span>
                              </div>
                            </td>

                            <td className="px-3.5 py-2">
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="number"
                                  min="0"
                                  max={waferWidth}
                                  step="50"
                                  value={win.xEnd}
                                  onChange={(e) =>
                                    handleUpdateWindowCoord(win.id, 'xEnd', parseFloat(e.target.value || '0'))
                                  }
                                  className="w-24 px-2 py-1 rounded bg-slate-900 border border-slate-700 text-slate-100 font-mono text-xs focus:outline-none focus:border-sky-500"
                                />
                                <span className="text-[10px] text-slate-500 font-mono">
                                  ({(win.xEnd / 1000).toFixed(2)} µm)
                                </span>
                              </div>
                            </td>

                            <td className="px-3.5 py-2 font-mono text-amber-300 font-semibold">
                              {widthNm >= 1000 ? `${widthUm} µm` : `${widthNm} nm`}
                            </td>

                            <td className="px-3.5 py-2 text-right">
                              <button
                                onClick={() => handleRemoveWindow(win.id)}
                                className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-950/30 transition-colors"
                                title="Delete this aperture"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}

                      {selectedMask.windows.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-4 py-6 text-center text-slate-500 italic">
                            No apertures defined. This reticle is completely opaque (dark field).
                            Click "Add Aperture Window" or choose a preset above.
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

        {/* Bottom Modal Footer */}
        <div className="flex items-center justify-between px-5 py-3 bg-slate-900 border-t border-slate-800 text-xs shrink-0">
          <div className="flex items-center gap-2 text-slate-400">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Changes made to mask levels automatically synchronize with assigned lithography steps in real time.</span>
          </div>

          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold transition-all shadow-md active:scale-95"
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
                  <span className="font-semibold text-white">Step {conflictPrompt.targetStepIndex}: {conflictPrompt.targetStepTitle}</span>{' '}
                  already has mask{' '}
                  <span className="font-semibold text-amber-300">
                    {conflictPrompt.conflictingMask.layerCode ? `${conflictPrompt.conflictingMask.layerCode} ` : ''}
                    {conflictPrompt.conflictingMask.name}
                  </span>{' '}
                  assigned.
                </p>
                <p className="text-xs text-slate-400">
                  Do you want to assign <span className="font-medium text-sky-300">{conflictPrompt.currentMask.name}</span> to this step? If you accept, the mask will be swapped.
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
                        Step {conflictPrompt.targetStepIndex}: {conflictPrompt.targetStepTitle}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-1.5">
                        <span className="line-through text-slate-500 truncate">{conflictPrompt.conflictingMask.name}</span>
                        <span>→</span>
                        <span className="text-sky-300 font-semibold truncate">{conflictPrompt.currentMask.name}</span>
                      </div>
                    </div>

                    <div className="p-2.5 rounded-lg bg-amber-950/30 border border-amber-500/40">
                      <div className="text-[10px] text-amber-400 font-mono font-medium">
                        Step {conflictPrompt.currentMaskPriorStep.index}: {conflictPrompt.currentMaskPriorStep.title}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-1.5">
                        <span className="line-through text-slate-500 truncate">{conflictPrompt.currentMask.name}</span>
                        <span>→</span>
                        <span className="text-amber-300 font-semibold truncate">{conflictPrompt.conflictingMask.name}</span>
                      </div>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-normal">
                    Both process steps will exchange their photomasks and update their aperture layouts and resist polarities automatically.
                  </p>
                </div>
              ) : (
                /* One-way step swap with unassigned reticle */
                <div className="space-y-2.5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <div className="p-2.5 rounded-lg bg-sky-950/30 border border-sky-500/40">
                      <div className="text-[10px] text-sky-400 font-mono font-medium">
                        Step {conflictPrompt.targetStepIndex}: {conflictPrompt.targetStepTitle}
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
                    <span className="text-sky-300 font-medium">{conflictPrompt.currentMask.name}</span> will take over Step {conflictPrompt.targetStepIndex}, while <span className="text-amber-200 font-medium">{conflictPrompt.conflictingMask.name}</span> will be swapped out to unassigned.
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
