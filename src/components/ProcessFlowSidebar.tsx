/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
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
  reorderStepInTimeline,
  StepDropTarget,
  insertStepIntoTimeline,
  insertStepAfterIndex,
  deleteStepFromTimeline,
  normalizeFlowBlocksOrder,
  BLOCK_PALETTE,
} from '../lib/blockUtils';
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
  ChevronDown,
  Sliders,
  FolderPlus,
  Edit2,
  Check,
  Link2,
  GripVertical,
} from 'lucide-react';

interface ProcessFlowSidebarProps {
  flow: ProcessFlow;
  activeStepIndex: number;
  thicknessUnit?: ThicknessUnit;
  onSelectStepIndex: (index: number) => void;
  onUpdateFlow: (updated: ProcessFlow) => void;
  onOpenPresets: () => void;
}

export const ProcessFlowSidebar: React.FC<ProcessFlowSidebarProps> = ({
  flow,
  activeStepIndex,
  thicknessUnit = 'nm',
  onSelectStepIndex,
  onUpdateFlow,
  onOpenPresets,
}) => {
  type AddStepPlacement =
    | { mode: 'end' }
    | { mode: 'after-selected' }
    | { mode: 'into-block'; blockId: string };

  const [showAddMenu, setShowAddMenu] = useState<boolean>(false);
  const [addPlacement, setAddPlacement] = useState<AddStepPlacement>({ mode: 'end' });
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [editingBlockName, setEditingBlockName] = useState<string>('');

  // Interactive block creation state (replaces window.prompt)
  const [isCreatingBlock, setIsCreatingBlock] = useState<boolean>(false);
  const [newBlockName, setNewBlockName] = useState<string>('');
  const [newBlockColor, setNewBlockColor] = useState<string>(BLOCK_PALETTE[0]);
  const [groupUngroupedOnCreate, setGroupUngroupedOnCreate] = useState<boolean>(false);
  const [deleteConfirmBlockId, setDeleteConfirmBlockId] = useState<string | null>(null);

  // Drag-and-drop reordering state for steps and fabrication blocks
  type DragSource =
    | { kind: 'step'; stepId: string; blockId?: string }
    | { kind: 'block'; blockId: string };

  type DropIndicator =
    | { kind: 'timeline-item'; timelineIndex: number; position: 'before' | 'after' }
    | { kind: 'block-step'; blockId: string; stepId: string; position: 'before' | 'after' }
    | { kind: 'into-block'; blockId: string };

  const [dragSource, setDragSource] = useState<DragSource | null>(null);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null);

  const blocks = flow.blocks || [];

  const getStepIcon = (type: ProcessStepType) => {
    switch (type) {
      case 'deposition':
        return <Layers className="w-4 h-4 text-sky-400" />;
      case 'lithography':
        return <Scissors className="w-4 h-4 text-rose-400" />;
      case 'etch':
        return <Flame className="w-4 h-4 text-amber-400" />;
      case 'strip':
      case 'liftoff':
        return <Sparkles className="w-4 h-4 text-emerald-400" />;
      case 'cmp':
        return <Disc className="w-4 h-4 text-cyan-400" />;
      case 'bonding':
        return <Link2 className="w-4 h-4 text-indigo-400" />;
      case 'anneal':
        return <Sliders className="w-4 h-4 text-purple-400" />;
      default:
        return <Layers className="w-4 h-4 text-slate-400" />;
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
          title: 'Thin Film Deposition',
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
          title: 'Photolithography Patterning',
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
          title: 'Plasma RIE Etch',
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
          title: 'Photoresist Strip',
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
          title: 'Metal Lift-off',
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
          title: 'Grind / Polish / Planarize',
          type: 'cmp',
          enabled: true,
          blockId: blockId || undefined,
          cmp: {
            operation: 'cmp',
            mode: 'polish-depth',
            depth: 250,
          },
        };
        break;
      case 'bonding':
        newStep = {
          id,
          title: 'Wafer Bonding',
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
      case 'anneal':
        newStep = {
          id,
          title: 'Thermal Dopant Drive-in / Anneal',
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
    onUpdateFlow(newFlow);
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
    const cloned: ProcessStep = {
      ...JSON.parse(JSON.stringify(original)),
      id: `step_${Date.now()}`,
      title: `${original.title} (Copy)`,
    };
    const updated = [...flow.steps];
    updated.splice(idx + 1, 0, cloned);
    onUpdateFlow(normalizeFlowBlocksOrder({ ...flow, steps: updated }));
    onSelectStepIndex(idx + 1);
  };

  const handleDeleteStep = (idx: number) => {
    if (flow.steps.length <= 1) return;
    const newFlow = deleteStepFromTimeline(flow, idx);
    onUpdateFlow(newFlow);
    onSelectStepIndex(Math.max(0, idx - 1));
  };

  const handleToggleStep = (idx: number) => {
    const updated = flow.steps.map((s, i) =>
      i === idx ? { ...s, enabled: !s.enabled } : s
    );
    onUpdateFlow({ ...flow, steps: updated });
  };

  // Block management handlers
  const handleOpenCreateBlock = (forUngrouped: boolean = false) => {
    const blockNum = blocks.length + 1;
    setNewBlockName(`Module ${blockNum}: `);
    setNewBlockColor(BLOCK_PALETTE[(blockNum - 1) % BLOCK_PALETTE.length]);
    setGroupUngroupedOnCreate(forUngrouped);
    setIsCreatingBlock(true);
  };

  const handleConfirmCreateBlock = () => {
    const trimmed = newBlockName.trim() || `Module ${blocks.length + 1}: Block`;
    let { flow: newFlow, block: newBlock } = createBlock(flow, trimmed, newBlockColor);

    if (groupUngroupedOnCreate) {
      const updatedSteps = newFlow.steps.map((step) =>
        !step.blockId ? { ...step, blockId: newBlock.id } : step
      );
      newFlow = normalizeFlowBlocksOrder({ ...newFlow, steps: updatedSteps });
    }

    onUpdateFlow(newFlow);
    setIsCreatingBlock(false);
    setNewBlockName('');
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
  };

  const handleSaveBlockName = (blockId: string) => {
    if (!editingBlockName.trim()) {
      setEditingBlockId(null);
      return;
    }
    const block = blocks.find((b) => b.id === blockId);
    if (block) {
      const newFlow = updateBlock(flow, { ...block, name: editingBlockName.trim() });
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

    // dragSource.kind === 'step'
    const target: StepDropTarget = indicator;
    const nextFlow = reorderStepInTimeline(flow, dragSource.stepId, target);
    applyFlowWithActivePreserved(nextFlow);
    clearDragState();
  };

  const DropLine = () => (
    <div className="relative h-0.5 my-0.5 bg-sky-400 rounded-full shadow-[0_0_8px_rgba(56,189,248,0.85)] pointer-events-none">
      <span className="absolute -left-0.5 -top-[3px] w-2 h-2 rounded-full bg-sky-400" />
    </div>
  );

  // Render a step item card
  const renderStepItem = (
    step: ProcessStep,
    globalIdx: number,
    context:
      | { scope: 'timeline'; timelineIndex: number }
      | { scope: 'block'; blockId: string }
  ) => {
    const isSelected = activeStepIndex === globalIdx;
    const isBeingDragged =
      dragSource?.kind === 'step' && dragSource.stepId === step.id;

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

      // Dragging a step
      if (dragSource.stepId === step.id) {
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
      } else if (dragSource.kind === 'step' && dragSource.stepId !== step.id) {
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
          draggable
          onDragStart={handleStepDragStart}
          onDragOver={handleStepDragOver}
          onDrop={handleStepDrop}
          onDragEnd={clearDragState}
          onClick={() => onSelectStepIndex(globalIdx)}
          className={`group relative flex items-center justify-between p-2 rounded-xl text-xs transition-all cursor-pointer border ${
            isBeingDragged ? 'opacity-40 scale-[0.98]' : ''
          } ${
            isSelected
              ? 'bg-sky-950/60 border-sky-500 text-white shadow-md'
              : step.enabled
              ? 'bg-slate-950/40 border-slate-800/80 hover:bg-slate-800/50 text-slate-300'
              : 'bg-slate-950/20 border-slate-800/40 opacity-50 text-slate-500'
          }`}
        >
          <div className="flex items-center gap-1.5 min-w-0 pr-1 flex-1">
            {/* Drag handle */}
            <GripVertical
              className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-400 cursor-grab active:cursor-grabbing flex-shrink-0 -ml-0.5"
              aria-label="Drag to reorder step"
            />

            {/* Step global index badge */}
            <span
              className={`w-5 h-5 rounded-md flex items-center justify-center font-mono text-[10px] font-semibold flex-shrink-0 ${
                isSelected
                  ? 'bg-sky-500 text-white'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              {globalIdx + 1}
            </span>

          {/* Step icon */}
          <div className="flex-shrink-0">{getStepIcon(step.type)}</div>

          {/* Step info */}
          <div className="min-w-0 flex-1 truncate">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-medium truncate">{step.title}</span>
              {step.side === 'back' && (
                <span className="px-1 py-0.2 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 font-mono text-[9px] font-bold shrink-0">
                  BACK
                </span>
              )}
              {step.side === 'both' && (
                <span className="px-1 py-0.2 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-mono text-[9px] font-bold shrink-0">
                  BOTH
                </span>
              )}
            </div>
            <div className="text-[10px] text-slate-400 truncate font-mono">
              {step.type === 'deposition' &&
                `${step.deposition?.method || 'CVD'} · ${formatThickness(
                  step.deposition?.thickness || step.thickness || 200,
                  thicknessUnit
                )}`}
              {step.type === 'lithography' &&
                `${step.lithography?.polarity || 'pos'} · ${
                  step.lithography?.maskName || `${step.lithography?.windows.length || 0} slits`
                }`}
              {step.type === 'etch' &&
                `${step.etch?.etchType?.toUpperCase() || 'RIE'} · ${formatThickness(
                  step.etch?.depth || step.thickness || 200,
                  thicknessUnit
                )}${
                  step.etch?.ardeEnabled &&
                  ['rie', 'drie-bosch', 'ion-beam', 'ashing'].includes(step.etch?.etchType || 'rie')
                    ? ' · ARDE'
                    : ''
                }`}
              {step.type === 'strip' && `${step.strip?.stripType || 'Resist Strip'}`}
              {step.type === 'liftoff' && 'Metal Lift-off'}
              {step.type === 'cmp' && 'Grind/Polish/Planarize'}
              {step.type === 'bonding' &&
                `Bond (${step.bonding?.bondingMethod || 'fusion'}) · ${
                  step.bonding?.sourceType === 'imported-flow'
                    ? step.bonding?.importedFlowTitle || 'Imported Flow'
                    : `${step.bonding?.customLayers?.length || 1}L Custom`
                }`}
              {step.type === 'anneal' && 'Thermal Anneal'}
            </div>
          </div>
        </div>

        {/* Step Quick Actions */}
        <div
          className={`flex items-center gap-0.5 flex-shrink-0 ${
            isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          } transition-opacity`}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => handleToggleStep(globalIdx)}
            className="p-1 rounded hover:bg-slate-700/80 text-slate-400 hover:text-slate-200 transition-colors"
            title={step.enabled ? 'Mute Step' : 'Enable Step'}
          >
            {step.enabled ? (
              <Eye className="w-3.5 h-3.5" />
            ) : (
              <EyeOff className="w-3.5 h-3.5 text-rose-400" />
            )}
          </button>
          <button
            disabled={globalIdx === 0 && !step.blockId}
            onClick={() => handleMoveStep(globalIdx, 'up')}
            className="p-1 rounded hover:bg-slate-700/80 text-slate-400 hover:text-slate-200 disabled:opacity-20 transition-colors"
            title={
              step.blockId && (globalIdx === 0 || flow.steps[globalIdx - 1]?.blockId !== step.blockId)
                ? 'Move Up (Remove from block & place before block)'
                : 'Move Step Up'
            }
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
          <button
            disabled={globalIdx === flow.steps.length - 1 && !step.blockId}
            onClick={() => handleMoveStep(globalIdx, 'down')}
            className="p-1 rounded hover:bg-slate-700/80 text-slate-400 hover:text-slate-200 disabled:opacity-20 transition-colors"
            title={
              step.blockId && (globalIdx === flow.steps.length - 1 || flow.steps[globalIdx + 1]?.blockId !== step.blockId)
                ? 'Move Down (Remove from block & place after block)'
                : 'Move Step Down'
            }
          >
            <ArrowDown className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => handleDuplicateStep(globalIdx)}
            className="p-1 rounded hover:bg-slate-700/80 text-slate-400 hover:text-slate-200 transition-colors"
            title="Duplicate Step"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
          <button
            disabled={flow.steps.length <= 1}
            onClick={() => handleDeleteStep(globalIdx)}
            className="p-1 rounded hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 disabled:opacity-20 transition-colors"
            title="Delete Step"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
        </div>
        {showAfterLine && <DropLine />}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 border-r border-slate-800 text-slate-200 select-none">
      {/* Sidebar Top Header */}
      <div className="p-3 border-b border-slate-800 flex items-center justify-between">
        <div>
          <span className="text-xs font-bold text-slate-200 tracking-wider uppercase">
            Process Traveller
          </span>
          <span className="text-xs text-slate-500 block font-mono">
            {blocks.length > 0 ? `${blocks.length} Modules · ` : ''}{flow.steps.length} Steps
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => handleOpenCreateBlock(false)}
            className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-400 border border-slate-700 transition-colors"
            title="Create New Fabrication Block / Module"
          >
            <FolderPlus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">+ Block</span>
          </button>

          <button
            onClick={onOpenPresets}
            className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
          >
            <span>Presets</span>
          </button>
        </div>
      </div>

      {/* Starting Substrate (Step 0) Item */}
      <div className="p-2 border-b border-slate-800 bg-slate-950/40">
        <div
          onClick={() => onSelectStepIndex(-1)}
          className={`group p-2.5 rounded-xl cursor-pointer transition-all border ${
            isSubstrateSelected
              ? 'bg-emerald-950/50 border-emerald-500 text-white shadow-md'
              : 'bg-slate-900/80 border-slate-800 hover:border-emerald-500/50 hover:bg-slate-850 text-slate-300'
          }`}
        >
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-2">
              <span
                className={`w-5 h-5 rounded-md flex items-center justify-center font-mono text-[10px] font-bold ${
                  isSubstrateSelected
                    ? 'bg-emerald-500 text-slate-950'
                    : 'bg-slate-800 text-emerald-400'
                }`}
              >
                0
              </span>
              <span className="font-semibold text-xs text-white">
                Starting Substrate Stack
              </span>
            </div>

            <span className="text-[10px] font-mono text-emerald-400 font-semibold">
              {formatThickness(totalSubThickness, thicknessUnit)}
            </span>
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-400 mb-2">
            <span>
              {subLayers.length} {subLayers.length === 1 ? 'Layer' : 'Layers'} Stack
            </span>
            <span className="font-mono text-slate-400">
              Width: {(flow.substrateWidth / 1000).toFixed(0)} µm
            </span>
          </div>

          {/* Mini Multi-Layer Color Preview Strip */}
          <div className="flex rounded-md overflow-hidden h-2.5 w-full border border-slate-700/80 bg-slate-950">
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

          <div className="mt-2 flex items-center justify-between text-[10px] text-emerald-400/90 font-medium group-hover:text-emerald-300">
            <span>Configure starting layers</span>
            <span>Configure →</span>
          </div>
        </div>
      </div>

      {/* FABRICATION STEPS LIST - GROUPED BY BLOCK HIERARCHY */}
      <div
        className="flex-1 overflow-y-auto p-2 space-y-3"
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
            return null;
          }

          return timelineItems.map((item, timelineIdx) => {
            if (item.kind === 'step') {
              return renderStepItem(item.step, item.idx, {
                scope: 'timeline',
                timelineIndex: timelineIdx,
              });
            }

            const { block, steps: blockStepsWithIndex } = item;
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

              // dragSource.kind === 'step'
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
                if (dragSource.blockId !== block.id) {
                  return { kind: 'into-block', blockId: block.id };
                }
                return null;
              }

              if (zone === 'body') {
                if (dragSource.blockId !== block.id) {
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
                  className={`rounded-xl border bg-slate-950/50 overflow-hidden shadow-sm transition-all ${
                    isBlockBeingDragged ? 'opacity-40 scale-[0.99]' : ''
                  } ${
                    isDropIntoBlock
                      ? 'border-sky-400 ring-2 ring-sky-500/60 bg-sky-950/25'
                      : 'border-slate-800'
                  }`}
                >
                  {/* Block Header */}
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
                    className="flex items-center justify-between px-2.5 py-2 bg-slate-900/90 hover:bg-slate-850 cursor-pointer border-b border-slate-800/80 transition-colors group"
                  >
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      {!isEditing && (
                        <GripVertical
                          className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-300 cursor-grab active:cursor-grabbing shrink-0 -ml-0.5"
                          aria-label="Drag to reorder block"
                        />
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleBlock(block.id);
                        }}
                        className="p-0.5 text-slate-400 hover:text-white"
                      >
                        {block.collapsed ? (
                          <ChevronRight className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" />
                        )}
                      </button>

                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: block.color || '#0ea5e9' }}
                      />

                      {isEditing ? (
                        <div
                          className="flex items-center gap-1 flex-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="text"
                            value={editingBlockName}
                            onChange={(e) => setEditingBlockName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSaveBlockName(block.id)}
                            autoFocus
                            className="bg-slate-950 border border-sky-500 rounded px-1.5 py-0.5 text-xs text-white flex-1"
                          />
                          <button
                            onClick={() => handleSaveBlockName(block.id)}
                            className="p-1 text-emerald-400 hover:text-emerald-300"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <span className="font-semibold text-xs text-slate-200 truncate">
                          {block.name}
                        </span>
                      )}
                    </div>

                    <div
                      className="flex items-center gap-0.5 shrink-0 ml-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="text-[10px] font-mono text-slate-500 mr-1">
                        {blockStepsWithIndex.length} {blockStepsWithIndex.length === 1 ? 'step' : 'steps'}
                      </span>

                      <div className="flex items-center opacity-70 group-hover:opacity-100 transition-opacity">
                        <button
                          disabled={timelineIdx === 0}
                          onClick={(e) => handleMoveBlock(block.id, 'up', e)}
                          className="p-1 rounded hover:bg-slate-700/80 text-slate-400 hover:text-white disabled:opacity-20 transition-colors"
                          title="Move Block Up"
                        >
                          <ArrowUp className="w-3 h-3" />
                        </button>
                        <button
                          disabled={timelineIdx === timelineItems.length - 1}
                          onClick={(e) => handleMoveBlock(block.id, 'down', e)}
                          className="p-1 rounded hover:bg-slate-700/80 text-slate-400 hover:text-white disabled:opacity-20 transition-colors"
                          title="Move Block Down"
                        >
                          <ArrowDown className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => {
                            setEditingBlockId(block.id);
                            setEditingBlockName(block.name);
                          }}
                          className="p-1 rounded hover:bg-slate-700/80 text-slate-400 hover:text-white transition-colors"
                          title="Rename Block"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => {
                            setAddPlacement({ mode: 'into-block', blockId: block.id });
                            setShowAddMenu(true);
                          }}
                          className="p-1 rounded hover:bg-slate-700/80 text-sky-400 hover:text-sky-300 transition-colors"
                          title="Add Step inside this Block"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => handleDeleteBlock(block.id, e)}
                          className="p-1 rounded hover:bg-rose-500/20 text-slate-500 hover:text-rose-400 transition-colors"
                          title="Delete / Ungroup Block"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Block Steps */}
                  {!block.collapsed && (
                    <div
                      className="p-1.5 space-y-1 bg-slate-950/20"
                      onDragOver={(e) => {
                        if (!dragSource || dragSource.kind !== 'step') return;
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
                        if (!dragSource || dragSource.kind !== 'step') return;
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
      <div className="relative p-3 border-t border-slate-800 bg-slate-900">
        <div className="grid grid-cols-2 gap-2">
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
            className={`flex items-center justify-center gap-1 py-2 px-2 rounded-xl text-[11px] font-medium transition-colors border active:scale-95 ${
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
            className={`flex items-center justify-center gap-1 py-2 px-2 rounded-xl text-[11px] font-medium transition-colors shadow-lg shadow-sky-950/50 active:scale-95 ${
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
          <div className="absolute bottom-16 left-3 right-3 p-2 bg-slate-950 border border-slate-700 rounded-2xl shadow-2xl z-30 space-y-1 animate-in fade-in zoom-in-95 duration-100">
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
                <div className="text-[10px] text-slate-500">CVD, ALD, Sputter, Evaporation</div>
              </div>
            </button>
            <button
              onClick={() => handleAddStep('lithography')}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-left hover:bg-slate-800 text-slate-200"
            >
              <Scissors className="w-4 h-4 text-rose-400" />
              <div>
                <div className="font-medium">Photolithography</div>
                <div className="text-[10px] text-slate-500">Photoresist coat & reticle mask exposure</div>
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
