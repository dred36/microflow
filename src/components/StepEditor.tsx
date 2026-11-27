/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  ProcessStep,
  ProcessFlow,
  SubstrateLayer,
  Material,
  ProcessStepType,
  ProcessSide,
  ToolRecipe,
  MaskWindow,
  ProcessBlock,
  PhotomaskLevel,
  BondingConfig,
  DicingConfig,
  TapeFrameConfig,
  EtchRecipe,
  DesignVariable,
  VariableUnit,
  SacrificialReleaseRegion,
  CleanroomTool,
} from '../types/microfab';
import { ThicknessUnit, getUnitLabel, formatThickness } from '../lib/units';
import { resolveResistMaterialId, isCrystallineKohMaterial, getMaterialById } from '../lib/materials';
import {
  getEtchRecipes,
  getEtchRateNmMin,
  computeSelectivityRatio,
  formatEtchRate,
  formatDurationCompact,
} from '../lib/etchRates';
import {
  getCleanroomTools,
  getCleanroomToolById,
  getStepMechanismContext,
  getToolMatchLevel,
  getToolsForStep,
  buildToolRecipeFromTool,
  getMechanismLabel,
} from '../lib/toolLibrary';
import { getDefaultStepTitle } from '../lib/stepDefaults';
import {
  createStepVariant,
  duplicateStepVariant,
  switchStepVariant,
  renameStepVariant,
  deleteStepVariant,
  getActiveStepVariant,
} from '../lib/variantUtils';
import { resolveFlowParameters } from '../lib/variableUtils';
import { simulateCrossSection, buildRenderPolygons } from '../lib/simulationEngine';
import { ThicknessInput } from './ThicknessInput';
import {
  ParametricThicknessInput,
  ParamBindingBadge,
  ParamBindingPanel,
} from './ParamBindingControl';
import {
  BondingAlignmentControl,
  resolveEffectiveShiftX,
} from './BondingAlignmentControl';
import { SvgPatterns } from './SvgPatterns';
import {
  Layers,
  Sliders,
  Wrench,
  Flame,
  Scissors,
  Eraser,
  Sparkles,
  Disc,
  Clock,
  Gauge,
  Thermometer,
  Zap,
  Wind,
  Plus,
  Trash2,
  Scan,
  Edit2,
  Check,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Link2,
  Upload,
  FileCheck,
  FlipHorizontal2,
  Frame,
  Slice,
  FlaskConical,
  Bookmark,
  GitBranch,
  Copy,
  Crosshair,
  AlertTriangle,
  Maximize2,
  X,
  HelpCircle,
  FileText,
} from 'lucide-react';

interface StepEditorProps {
  flow?: ProcessFlow;
  step: ProcessStep;
  waferWidth: number;
  materials: Material[];
  etchRecipes?: EtchRecipe[];
  tools?: CleanroomTool[];
  thicknessUnit?: ThicknessUnit;
  onUpdateStep: (updated: ProcessStep) => void;
  onOpenMaterialsModal: () => void;
  onOpenEtchLibrary?: () => void;
  onOpenToolLibrary?: () => void;
  onMergeMaterials?: (materials: Material[]) => void;
  blocks?: ProcessBlock[];
  masks?: PhotomaskLevel[];
  onOpenMaskLevelsModal?: (maskId?: string) => void;
  onCreateBlock?: (name?: string) => void;
  variables?: DesignVariable[];
  onCreateVariable?: (name: string, value: number, unit: VariableUnit, description?: string) => void;
  onOpenVariablesModal?: () => void;
  onOpenVariantManager?: () => void;
  pickReleaseMode?: boolean;
  onTogglePickReleaseMode?: () => void;
  isMaskTrackOpen?: boolean;
  onToggleMaskTrack?: () => void;
  onOpenHelp?: () => void;
}

interface RegionUmInputProps {
  valueNm: number;
  minNm?: number;
  maxNm: number;
  onCommitNm: (valNm: number) => void;
  ariaLabel?: string;
}

const RegionUmInput: React.FC<RegionUmInputProps> = ({
  valueNm,
  minNm = 0,
  maxNm,
  onCommitNm,
  ariaLabel,
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
      step="any"
      min={(minNm / 1000).toFixed(3)}
      max={(maxNm / 1000).toFixed(3)}
      aria-label={ariaLabel}
      value={isFocused ? draft : formatted}
      onFocus={(e) => {
        setIsFocused(true);
        setDraft(formatted);
        e.target.select();
      }}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        const parsed = parseFloat(raw);
        if (Number.isFinite(parsed)) {
          const clamped = Math.max(minNm, Math.min(maxNm, Math.round(parsed * 1000)));
          onCommitNm(clamped);
        }
      }}
      onBlur={() => {
        const parsed = parseFloat(draft);
        if (Number.isFinite(parsed)) {
          onCommitNm(Math.max(minNm, Math.min(maxNm, Math.round(parsed * 1000))));
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
      className="w-full px-2 py-1 rounded bg-slate-900 border border-slate-700 text-slate-100 font-mono text-[11px] focus:outline-none focus:border-emerald-500"
    />
  );
};

export const StepEditor: React.FC<StepEditorProps> = ({
  flow,
  step,
  waferWidth,
  materials,
  etchRecipes,
  tools: toolsProp,
  thicknessUnit = 'nm',
  onUpdateStep,
  onOpenMaterialsModal,
  onOpenEtchLibrary,
  onOpenToolLibrary,
  onMergeMaterials,
  blocks,
  masks,
  onOpenMaskLevelsModal,
  onCreateBlock,
  variables = [],
  onCreateVariable,
  onOpenVariablesModal,
  onOpenVariantManager,
  pickReleaseMode = false,
  onTogglePickReleaseMode,
  isMaskTrackOpen = false,
  onToggleMaskTrack,
  onOpenHelp,
}) => {
  const [activeTab, setActiveTab] = useState<'process' | 'equipment' | 'notes'>('process');
  const [isAddingBlockInline, setIsAddingBlockInline] = useState<boolean>(false);
  const [inlineBlockName, setInlineBlockName] = useState<string>('');
  const [isEditingMaskName, setIsEditingMaskName] = useState<boolean>(false);
  const [editingMaskName, setEditingMaskName] = useState<string>('');
  const [bondingImportError, setBondingImportError] = useState<string | null>(null);
  const [pendingBondImport, setPendingBondImport] = useState<{
    flow: ProcessFlow;
    title: string;
    importedWidth: number;
    mode: 'rescale' | 'crop-pad';
    alignment: 'left' | 'center' | 'right' | 'custom';
    offsetNm?: number;
    paddingMode: 'empty' | 'extend-edges';
  } | null>(null);
  const [openStreetBindId, setOpenStreetBindId] = useState<string | null>(null);
  const [editingVariantId, setEditingVariantId] = useState<string | null>(null);
  const [editingVariantName, setEditingVariantName] = useState<string>('');

  useEffect(() => {
    setIsEditingMaskName(false);
    setEditingMaskName(step.lithography?.maskName || '');
    setBondingImportError(null);
    setPendingBondImport(null);
    setEditingVariantId(null);
    setEditingVariantName('');
  }, [step.id, step.lithography?.maskName]);

  useEffect(() => {
    if (!pendingBondImport) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPendingBondImport(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pendingBondImport]);

  const bondingResultPreview = useMemo(() => {
    if (!pendingBondImport) return null;

    const existingMatIds = new Set(materials.map((m) => m.id));
    const incomingMats = (pendingBondImport.flow.materials || []).filter(
      (m) => !existingMatIds.has(m.id)
    );
    const mergedMaterials = [...materials, ...incomingMats];

    const previewBondConfig: BondingConfig = {
      ...(step.bonding || {
        sourceType: 'imported-flow',
        bondingMethod: 'fusion',
        incomingFace: 'front',
      }),
      sourceType: 'imported-flow',
      importedFlow: pendingBondImport.flow,
      importedFlowTitle: pendingBondImport.title,
      widthMismatchMode: pendingBondImport.mode,
      widthAlignment: pendingBondImport.alignment,
      widthOffsetNm: pendingBondImport.offsetNm,
      widthPaddingMode: pendingBondImport.paddingMode,
    };

    const previewStep: ProcessStep = {
      ...step,
      enabled: true,
      bonding: previewBondConfig,
    };

    const baseFlow: ProcessFlow = flow
      ? {
          ...flow,
          materials: mergedMaterials,
        }
      : {
          id: 'bond_preview_fallback',
          title: 'Bond Preview',
          description: '',
          substrateWidth: waferWidth,
          substrateThickness: 3000,
          substrateMaterialId: 'mat_si_sub',
          substrateLayers: [
            {
              id: 'sub_preview_default',
              name: 'Bulk Silicon <100>',
              materialId: 'mat_si_sub',
              thickness: 3000,
            },
          ],
          materials: mergedMaterials,
          steps: [previewStep],
        };

    const idxInFlow = baseFlow.steps.findIndex((s) => s.id === step.id);
    const slicedSteps =
      idxInFlow >= 0
        ? baseFlow.steps.slice(0, idxInFlow + 1).map((s, i) => (i === idxInFlow ? previewStep : s))
        : [...baseFlow.steps, previewStep];

    const previewFlow = resolveFlowParameters({
      ...baseFlow,
      steps: slicedSteps,
    });

    const enabledStepIdx = previewFlow.steps.filter((s) => s.enabled).length - 1;
    const mesh = simulateCrossSection(
      previewFlow,
      enabledStepIdx >= 0 ? enabledStepIdx : undefined
    );
    const polygons = buildRenderPolygons(mesh, mergedMaterials);

    let minX = 0;
    let maxX = waferWidth;
    let minY = mesh.minY ?? 0;
    let maxY = Math.max(mesh.maxY ?? 3000, 1000);
    for (const poly of polygons) {
      if (poly.xMin < minX) minX = poly.xMin;
      if (poly.xMax > maxX) maxX = poly.xMax;
      if (poly.yMin < minY) minY = poly.yMin;
      if (poly.yMax > maxY) maxY = poly.yMax;
    }

    return {
      mesh,
      polygons,
      materials: mergedMaterials,
      bounds: { minX, maxX, minY, maxY },
      incomingFace: previewBondConfig.incomingFace || 'front',
      targetSide: step.side === 'back' ? 'back' : 'front',
      mirrorHorizontal: Boolean(previewBondConfig.mirrorHorizontal),
    };
  }, [pendingBondImport, flow, step, waferWidth, materials]);

  const handleUpdate = (patch: Partial<ProcessStep>) => {
    onUpdateStep({ ...step, ...patch });
  };

  const commitImportedFlow = (
    importedFlow: ProcessFlow,
    title: string,
    mode: 'rescale' | 'crop-pad',
    alignment: 'left' | 'center' | 'right' | 'custom',
    offsetNm?: number,
    paddingMode: 'empty' | 'extend-edges' = 'empty'
  ) => {
    if (importedFlow.materials && importedFlow.materials.length > 0 && onMergeMaterials) {
      onMergeMaterials(importedFlow.materials);
    }
    const baseBondCfg: BondingConfig = step.bonding || {
      sourceType: 'imported-flow',
      bondingMethod: 'fusion',
      incomingFace: 'front',
    };
    handleUpdate({
      bonding: {
        ...baseBondCfg,
        sourceType: 'imported-flow',
        importedFlow,
        importedFlowTitle: title,
        widthMismatchMode: mode,
        widthAlignment: alignment,
        widthOffsetNm: offsetNm,
        widthPaddingMode: paddingMode,
      },
    });
  };

  const setStepParamBinding = (key: string, expr: string | undefined) => {
    const next = { ...(step.paramBindings || {}) };
    if (expr && expr.trim()) {
      next[key] = expr.trim();
    } else {
      delete next[key];
    }
    handleUpdate({
      paramBindings: Object.keys(next).length > 0 ? next : undefined,
    });
  };

  const allTools = useMemo(() => getCleanroomTools(toolsProp), [toolsProp]);
  const stepMechContext = useMemo(() => getStepMechanismContext(step), [step]);
  const groupedStepTools = useMemo(
    () => getToolsForStep(allTools, step),
    [allTools, step]
  );
  const linkedLibraryTool = useMemo(
    () => getCleanroomToolById(allTools, step.toolRecipe?.toolId),
    [allTools, step.toolRecipe?.toolId]
  );
  const linkedToolMatchLevel = useMemo(
    () =>
      linkedLibraryTool
        ? getToolMatchLevel(
            linkedLibraryTool,
            stepMechContext.mechanism,
            stepMechContext.subMechanisms
          )
        : null,
    [linkedLibraryTool, stepMechContext]
  );

  const handleSelectLibraryTool = (nextToolId: string) => {
    if (!nextToolId) {
      if (step.toolRecipe) {
        const { toolId: _removed, ...rest } = step.toolRecipe;
        handleUpdate({ toolRecipe: rest });
      }
      return;
    }
    const found = allTools.find((t) => t.id === nextToolId);
    if (!found) return;
    handleUpdate({
      toolRecipe: buildToolRecipeFromTool(found, step.toolRecipe),
    });
  };

  const handleUpdateRecipe = (field: keyof ToolRecipe, val: string) => {
    const current = step.toolRecipe || {
      toolName: '',
      gases: '',
      power: '',
      pressure: '',
      temperature: '',
      duration: '',
      targetRate: '',
      inspectionNotes: '',
    };
    handleUpdate({
      toolRecipe: {
        ...current,
        [field]: val,
      },
    });
  };

  return (
    <div className="flex flex-col h-full min-w-0 bg-slate-900 text-slate-200">
      {/* Editor Header */}
      <div className="px-2.5 py-2 border-b border-slate-800 shrink-0">
        <div className="flex items-center justify-between gap-1.5 mb-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[9.5px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/30 shrink-0">
              {step.type}
            </span>
            <span className="text-[10.5px] text-slate-400 font-mono truncate">Config</span>
            {onOpenHelp && (
              <button
                type="button"
                onClick={onOpenHelp}
                className="p-0.5 rounded text-slate-400 hover:text-sky-300 hover:bg-slate-800 transition-colors shrink-0"
                title="Help: Process Step Models & Parameters"
                aria-label="Help for Step Parameters"
              >
                <HelpCircle className="w-3 h-3" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() =>
                handleUpdate({
                  bookmarked: !step.bookmarked,
                  bookmarkLabel: !step.bookmarked ? step.bookmarkLabel : undefined,
                })
              }
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-medium border transition-colors ${
                step.bookmarked
                  ? 'bg-amber-500/15 border-amber-500/45 text-amber-300 hover:bg-amber-500/25'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-amber-300 hover:border-slate-700'
              }`}
              title={
                step.bookmarked
                  ? 'Remove milestone bookmark from this step'
                  : 'Bookmark this step as a process milestone'
              }
            >
              <Bookmark
                className={`w-2.5 h-2.5 ${step.bookmarked ? 'fill-amber-400 text-amber-400' : ''}`}
              />
              <span>{step.bookmarked ? 'Bookmarked' : 'Bookmark'}</span>
            </button>

            <label className="flex items-center gap-1 text-[11px] text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={step.enabled}
                onChange={(e) => handleUpdate({ enabled: e.target.checked })}
                className="rounded bg-slate-800 border-slate-700 text-sky-500 focus:ring-0"
              />
              <span>Enabled</span>
            </label>
          </div>
        </div>

        {/* Step Title Input */}
        <input
          type="text"
          value={step.title}
          onChange={(e) => handleUpdate({ title: e.target.value })}
          placeholder="Step title..."
          className="w-full px-2 py-1 rounded-md bg-slate-950 border border-slate-700 text-white font-semibold text-xs focus:outline-none focus:border-sky-500 transition-colors"
        />

        {/* Milestone Bookmark Label (when bookmarked) */}
        {step.bookmarked && (
          <div className="mt-1.5 flex items-center gap-1.5">
            <span className="text-[10.5px] text-amber-300 shrink-0 font-medium flex items-center gap-1">
              <Bookmark className="w-2.5 h-2.5 fill-amber-400 text-amber-400" />
              Milestone:
            </span>
            <input
              type="text"
              value={step.bookmarkLabel || ''}
              onChange={(e) =>
                handleUpdate({ bookmarkLabel: e.target.value || undefined })
              }
              placeholder="Optional milestone tag (e.g. Gate Stack)..."
              className="min-w-0 flex-1 px-2 py-0.5 rounded bg-slate-950 border border-amber-500/40 text-[11px] text-amber-100 placeholder-slate-500 focus:outline-none focus:border-amber-400"
            />
          </div>
        )}

        {/* Fabrication Block / Module Assignment */}
        <div className="mt-1.5 flex items-center gap-1.5 min-w-0">
          <span className="text-[10.5px] text-slate-400 shrink-0 font-medium">Module:</span>
          <select
            value={step.blockId || 'none'}
            onChange={(e) =>
              handleUpdate({ blockId: e.target.value === 'none' ? undefined : e.target.value })
            }
            className="min-w-0 flex-1 w-full px-2 py-0.5 rounded bg-slate-950 border border-slate-700 text-[11px] text-slate-200 focus:outline-none focus:border-sky-500 font-mono truncate"
          >
            <option value="none">-- Ungrouped Operation --</option>
            {blocks?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          {onCreateBlock && (
            <button
              type="button"
              onClick={() => {
                setInlineBlockName(`Module ${(blocks?.length || 0) + 1}: `);
                setIsAddingBlockInline(!isAddingBlockInline);
              }}
              className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-sky-400 border border-slate-700 text-xs transition-colors shrink-0"
              title="Create new fabrication block / module"
            >
              <Plus className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Inline Module Creation Row */}
        {isAddingBlockInline && (
          <div className="flex items-center gap-1 mt-1.5 p-1 rounded-md bg-slate-950 border border-sky-500/60 animate-in fade-in zoom-in-95 duration-100">
            <input
              type="text"
              autoFocus
              value={inlineBlockName}
              onChange={(e) => setInlineBlockName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && inlineBlockName.trim() && onCreateBlock) {
                  onCreateBlock(inlineBlockName.trim());
                  setIsAddingBlockInline(false);
                  setInlineBlockName('');
                }
                if (e.key === 'Escape') {
                  setIsAddingBlockInline(false);
                  setInlineBlockName('');
                }
              }}
              placeholder="e.g. Module 3: Interconnect"
              className="flex-1 px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-[11px] text-white focus:outline-none focus:border-sky-500 font-medium"
            />
            <button
              type="button"
              onClick={() => {
                if (inlineBlockName.trim() && onCreateBlock) {
                  onCreateBlock(inlineBlockName.trim());
                  setIsAddingBlockInline(false);
                  setInlineBlockName('');
                }
              }}
              className="px-2 py-0.5 rounded bg-sky-600 hover:bg-sky-500 text-white text-[10.5px] font-semibold transition-colors"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => {
                setIsAddingBlockInline(false);
                setInlineBlockName('');
              }}
              className="p-0.5 rounded text-slate-400 hover:text-white text-xs"
            >
              ✕
            </button>
          </div>
        )}

        {/* Process Step Variants Section */}
        {(() => {
          const variants = step.variants;
          const activeVariant = getActiveStepVariant(step);
          if (!variants || variants.length <= 1) {
            return (
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <span className="text-[10.5px] text-slate-400 font-medium flex items-center gap-1">
                  <GitBranch className="w-3 h-3 text-violet-400 shrink-0" />
                  <span>Variants:</span>
                  <span className="text-slate-500 font-normal">Single recipe</span>
                </span>
                <button
                  type="button"
                  onClick={() => onUpdateStep(createStepVariant(step))}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-violet-500/15 hover:bg-violet-500/25 border border-violet-500/35 text-[10.5px] font-medium text-violet-300 transition-colors"
                  title="Branch this step with an alternative parameter variant (e.g. Baseline vs Variant B)"
                >
                  <Plus className="w-2.5 h-2.5" />
                  <span>Add Variant</span>
                </button>
              </div>
            );
          }

          return (
            <div className="mt-1.5 p-1.5 rounded-lg bg-slate-950/90 border border-violet-500/35 space-y-1.5">
              <div className="flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1 text-[10.5px] font-semibold text-violet-300">
                  <GitBranch className="w-3 h-3 text-violet-400 shrink-0" />
                  <span>Variants</span>
                  <span className="px-1 py-0.2 rounded bg-violet-500/20 border border-violet-500/30 font-mono text-[9.5px] text-violet-200 tabular-nums">
                    {variants.length}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {onOpenVariantManager && (
                    <button
                      type="button"
                      onClick={onOpenVariantManager}
                      className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[9.5px] text-violet-300 transition-colors"
                      title="Open centralized Variant Manager for all steps"
                    >
                      Manage
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onUpdateStep(duplicateStepVariant(step))}
                    className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[9.5px] text-slate-300 transition-colors"
                    title="Duplicate active variant"
                  >
                    <Copy className="w-2.5 h-2.5" />
                    <span>Clone</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdateStep(createStepVariant(step))}
                    className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-violet-600/80 hover:bg-violet-500 text-[9.5px] font-semibold text-white transition-colors"
                    title="Create a new parameter variant"
                  >
                    <Plus className="w-2.5 h-2.5" />
                    <span>New</span>
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-1">
                {variants.map((variant) => {
                  const isActive = activeVariant?.id === variant.id;
                  const isEditingThis = editingVariantId === variant.id;

                  if (isEditingThis) {
                    return (
                      <div
                        key={variant.id}
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-900 border border-violet-400"
                      >
                        <input
                          type="text"
                          autoFocus
                          value={editingVariantName}
                          onChange={(e) => setEditingVariantName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              if (editingVariantName.trim()) {
                                onUpdateStep(renameStepVariant(step, variant.id, editingVariantName));
                              }
                              setEditingVariantId(null);
                            } else if (e.key === 'Escape') {
                              setEditingVariantId(null);
                            }
                          }}
                          onBlur={() => {
                            if (editingVariantName.trim()) {
                              onUpdateStep(renameStepVariant(step, variant.id, editingVariantName));
                            }
                            setEditingVariantId(null);
                          }}
                          className="w-24 bg-transparent text-[10.5px] font-medium text-white focus:outline-none"
                        />
                        <button
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            if (editingVariantName.trim()) {
                              onUpdateStep(renameStepVariant(step, variant.id, editingVariantName));
                            }
                            setEditingVariantId(null);
                          }}
                          className="text-emerald-400 hover:text-emerald-300"
                          title="Save variant name"
                        >
                          <Check className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={variant.id}
                      className={`group inline-flex items-center gap-0.5 rounded border text-[10.5px] transition-all ${
                        isActive
                          ? 'bg-violet-600/25 border-violet-400/80 text-white shadow-sm'
                          : 'bg-slate-900/90 border-slate-700/80 text-slate-300 hover:border-slate-500 hover:text-white'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          if (!isActive) {
                            onUpdateStep(switchStepVariant(step, variant.id));
                          }
                        }}
                        onDoubleClick={() => {
                          setEditingVariantId(variant.id);
                          setEditingVariantName(variant.name);
                        }}
                        className="px-1.5 py-0.5 font-medium truncate max-w-[120px] text-left"
                        title={`${variant.name} (${variant.type})${isActive ? ' — Active (double-click to rename)' : ' — Click to activate'}`}
                      >
                        {variant.name}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingVariantId(variant.id);
                          setEditingVariantName(variant.name);
                        }}
                        className={`p-0.5 rounded transition-colors ${
                          isActive
                            ? 'text-violet-300 hover:text-white'
                            : 'text-slate-500 opacity-0 group-hover:opacity-100 hover:text-slate-200'
                        }`}
                        title="Rename variant"
                      >
                        <Edit2 className="w-2.5 h-2.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onUpdateStep(deleteStepVariant(step, variant.id))}
                        className={`pr-1 py-0.5 rounded transition-colors ${
                          isActive
                            ? 'text-violet-300/80 hover:text-rose-300'
                            : 'text-slate-500 opacity-0 group-hover:opacity-100 hover:text-rose-400'
                        }`}
                        title={
                          variants.length === 2
                            ? `Delete "${variant.name}" (returns to single recipe)`
                            : `Delete "${variant.name}"`
                        }
                      >
                        <Trash2 className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Navigation Tabs */}
        <div className="flex items-center gap-0.5 mt-2 p-0.5 rounded-md bg-slate-950 border border-slate-800 text-[11px]">
          <button
            type="button"
            onClick={() => setActiveTab('process')}
            className={`flex-1 py-0.5 px-1.5 rounded font-medium whitespace-nowrap transition-colors ${
              activeTab === 'process'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Process
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('equipment')}
            className={`flex-1 py-0.5 px-1.5 rounded font-medium whitespace-nowrap transition-colors ${
              activeTab === 'equipment'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Tool SOP
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('notes')}
            className={`flex-1 py-0.5 px-1.5 rounded font-medium whitespace-nowrap transition-colors flex items-center justify-center gap-1 ${
              activeTab === 'notes'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>Notes</span>
            {Boolean(step.notes?.trim()) && (
              <span
                className={`w-1.5 h-1.5 rounded-xs shrink-0 ${
                  activeTab === 'notes' ? 'bg-white' : 'bg-cyan-400'
                }`}
                title="This step has documentation notes"
              />
            )}
          </button>
        </div>
      </div>

      {/* Tab Contents */}
      <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden p-2.5 space-y-2.5">
        {activeTab === 'process' && (
          <>
            {/* Step Type Selector */}
            <div>
              <label className="block text-[10.5px] font-medium text-slate-400 mb-0.5">
                Process Mechanism
              </label>
              <select
                value={step.type}
                onChange={(e) => {
                  const newType = e.target.value as ProcessStepType;
                  if (newType === step.type) return;
                  const patch: Partial<ProcessStep> = {
                    type: newType,
                    title: getDefaultStepTitle(newType),
                    thickness: step.thickness || 200,
                  };
                  if (newType === 'deposition') {
                    if (!step.materialId) {
                      patch.materialId = 'mat_sio2_thermal';
                    }
                    if (!step.deposition) {
                      patch.deposition = {
                        method: 'PECVD',
                        depositionType: 'conformal',
                        thickness: step.thickness || 200,
                      };
                    }
                  }
                  if (newType === 'lithography' && !step.lithography) {
                    patch.lithography = {
                      resistMaterialId: 'mat_pr_pos',
                      resistThickness: 1000,
                      polarity: 'positive',
                      windows: [
                        {
                          id: `w_${Date.now()}`,
                          xStart: Math.round(waferWidth * 0.35),
                          xEnd: Math.round(waferWidth * 0.65),
                        },
                      ],
                      sidewallAngle: 90,
                      exposureMethod: 'UV Contact (365nm)',
                    };
                  }
                  if (newType === 'etch' && !step.etch) {
                    patch.etch = {
                      etchType: 'rie',
                      depth: step.thickness || 200,
                      targetMaterialId: 'all',
                      isotropy: 0.05,
                      sidewallAngle: 90,
                    };
                  }
                  if (newType === 'strip') {
                    patch.strip = {
                      solvent: step.strip?.solvent || 'O₂ Plasma Ashing',
                      ...step.strip,
                      stripType:
                        step.strip?.stripType === 'sacrificial-release'
                          ? 'sacrificial-release'
                          : 'resist-strip',
                    };
                  }
                  if (newType === 'liftoff') {
                    patch.strip = {
                      solvent: step.strip?.solvent || 'Acetone / NMP Ultrasonic',
                      ...step.strip,
                      stripType: 'metal-liftoff',
                    };
                  }
                  if (newType === 'cmp' && !step.cmp) {
                    patch.cmp = {
                      operation: 'cmp',
                      mode: 'polish-depth',
                      depth: 300,
                      dishing: 0,
                      erosion: 0,
                    };
                  }
                  if (newType === 'bonding') {
                    if (step.side === 'both') {
                      patch.side = 'front';
                    }
                    if (!step.bonding) {
                      patch.bonding = {
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
                      };
                    }
                  }
                  if (newType === 'dicing' && !step.dicing) {
                    patch.dicing = {
                      method: 'blade',
                      cutMode: 'through-wafer',
                      kerfWidth: 400,
                      cutDepth: 1500,
                      sidewallAngle: 90,
                      tapeOvercut: 120,
                      streets: [
                        {
                          id: `street_${Date.now()}`,
                          xCenter: Math.round(waferWidth * 0.5),
                        },
                      ],
                    };
                  }
                  if (newType === 'tape-frame') {
                    if (!step.side || step.side === 'both') {
                      patch.side = 'back';
                    }
                    if (!step.tapeFrame) {
                      patch.tapeFrame = {
                        action: 'mount',
                        tapeMaterialId: 'mat_dicing_tape',
                        thickness: 600,
                        conformality: 'flat',
                        showFrame: true,
                      };
                    }
                  }
                  handleUpdate(patch);
                }}
                className="w-full px-2 py-1 rounded-md bg-slate-950 border border-slate-700 text-slate-200 text-[11px] font-medium focus:outline-none focus:border-sky-500"
              >
                <option value="deposition">Deposition / Thin Film Growth</option>
                <option value="lithography">Photolithography &amp; Patterning</option>
                <option value="etch">Etching (Dry RIE / Wet / Bosch DRIE)</option>
                <option value="strip">Strip / Sacrificial Release</option>
                <option value="liftoff">Metal Lift-off</option>
                <option value="cmp">Grind/Polish/Planarize (Grinding &amp; CMP)</option>
                <option value="bonding">Wafer Bonding (Substrate / Pre-Processed Flow)</option>
                <option value="tape-frame">Tape &amp; Frame (Mount / UV Demount)</option>
                <option value="dicing">Wafer Dicing (Blade / Laser / Plasma)</option>
                <option value="anneal">Thermal Anneal / Drive-In</option>
                <option value="substrate">Substrate Initialization</option>
              </select>
            </div>

            {/* Linked Cleanroom Tool (filtered by Process Mechanism & Sub-Mechanism) */}
            <div className="p-2 rounded-lg bg-slate-950/70 border border-slate-800 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-1 text-[10.5px] font-medium text-slate-300 min-w-0">
                  <Wrench className="w-3 h-3 text-sky-400 shrink-0" />
                  <span className="shrink-0">Cleanroom Tool</span>
                  <span className="text-[9.5px] font-mono text-slate-500 truncate">
                    ({getMechanismLabel(stepMechContext.mechanism, true)}
                    {stepMechContext.primarySubLabel ? ` · ${stepMechContext.primarySubLabel}` : ''})
                  </span>
                </label>
                {onOpenToolLibrary && (
                  <button
                    type="button"
                    onClick={onOpenToolLibrary}
                    className="text-[10.5px] text-sky-400 hover:underline shrink-0"
                  >
                    Library
                  </button>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                <select
                  value={step.toolRecipe?.toolId || ''}
                  onChange={(e) => handleSelectLibraryTool(e.target.value)}
                  aria-label="Select linked cleanroom tool"
                  className="flex-1 min-w-0 px-2 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-200 text-[11px] focus:outline-none focus:border-sky-500"
                >
                  <option value="">-- Custom / Unlinked Tool --</option>
                  {groupedStepTools.exactMatches.length > 0 && (
                    <optgroup
                      label={`Matched (${
                        stepMechContext.primarySubLabel ||
                        getMechanismLabel(stepMechContext.mechanism, true)
                      })`}
                    >
                      {groupedStepTools.exactMatches.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                          {t.bayLocation ? ` · ${t.bayLocation}` : ''}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {groupedStepTools.mechanismMatches.length > 0 && (
                    <optgroup
                      label={`Other ${getMechanismLabel(stepMechContext.mechanism, true)} Tools`}
                    >
                      {groupedStepTools.mechanismMatches.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {groupedStepTools.otherTools.length > 0 && (
                    <optgroup label="All Other Cleanroom Tools">
                      {groupedStepTools.otherTools.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>

              {linkedLibraryTool && linkedToolMatchLevel === null && (
                <div className="flex items-center justify-between gap-2 pt-1 text-[10.5px] text-amber-300">
                  <span className="truncate">
                    Linked tool isn&apos;t tagged for{' '}
                    {stepMechContext.primarySubLabel ||
                      getMechanismLabel(stepMechContext.mechanism, true)}
                    .
                  </span>
                  {groupedStepTools.exactMatches[0] && (
                    <button
                      type="button"
                      onClick={() => handleSelectLibraryTool(groupedStepTools.exactMatches[0].id)}
                      className="px-1.5 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 font-medium shrink-0"
                    >
                      Use {groupedStepTools.exactMatches[0].name.split(' ')[0]}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Wafer Processing Side Selector (Front / Back / Both) */}
            {step.type !== 'substrate' && step.type !== 'anneal' && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10.5px] font-medium text-slate-400">
                    {step.type === 'bonding'
                      ? 'Bond Target Side'
                      : step.type === 'tape-frame'
                      ? 'Tape Lamination Side'
                      : 'Substrate Side'}
                  </label>
                  <span className="text-[9.5px] font-mono text-slate-500">
                    {(step.side || 'front') === 'front'
                      ? 'Top (+Z)'
                      : step.side === 'back'
                      ? 'Back (-Z)'
                      : 'Double (±Z)'}
                  </span>
                </div>
                <div
                  className={`grid ${
                    step.type === 'bonding' || step.type === 'tape-frame'
                      ? 'grid-cols-2'
                      : 'grid-cols-3'
                  } gap-0.5 p-0.5 rounded-md bg-slate-950 border border-slate-800 text-[11px]`}
                >
                  {(
                    [
                      { id: 'front' as ProcessSide, label: 'Front', icon: ArrowUp, activeClass: 'bg-sky-600 text-white shadow-sm' },
                      { id: 'back' as ProcessSide, label: 'Back', icon: ArrowDown, activeClass: 'bg-amber-600 text-white shadow-sm' },
                      ...(step.type === 'bonding' || step.type === 'tape-frame'
                        ? []
                        : [{ id: 'both' as ProcessSide, label: 'Both Sides', icon: ArrowUpDown, activeClass: 'bg-emerald-600 text-white shadow-sm' }]),
                    ]
                  ).map((opt) => {
                    const currentSide: ProcessSide =
                      (step.type === 'bonding' || step.type === 'tape-frame') &&
                      step.side === 'both'
                        ? step.type === 'tape-frame'
                          ? 'back'
                          : 'front'
                        : step.side || (step.type === 'tape-frame' ? 'back' : 'front');
                    const isActive = currentSide === opt.id;
                    const Icon = opt.icon;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => handleUpdate({ side: opt.id })}
                        className={`flex items-center justify-center gap-1 py-1 px-1.5 rounded font-medium transition-all ${
                          isActive
                            ? opt.activeClass
                            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                        }`}
                      >
                        <Icon className="w-3 h-3 shrink-0" />
                        <span>{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Customization for DEPOSITION */}
            {step.type === 'deposition' && (
              <div className="space-y-2 bg-slate-950/70 p-2.5 rounded-lg border border-slate-800">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-semibold text-sky-400">
                    Deposition Material
                  </label>
                  <button
                    onClick={onOpenMaterialsModal}
                    className="text-[10.5px] text-sky-400 hover:underline"
                  >
                    + Materials
                  </button>
                </div>

                <select
                  value={step.materialId || 'mat_sio2_thermal'}
                  onChange={(e) => handleUpdate({ materialId: e.target.value })}
                  className="w-full px-2 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-200 text-[11px] focus:outline-none focus:border-sky-500"
                >
                  {materials.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.formula})
                    </option>
                  ))}
                </select>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10.5px] text-slate-400 mb-0.5">
                      Film Thickness ({getUnitLabel(thicknessUnit)})
                    </label>
                    <ParametricThicknessInput
                      valueNm={step.deposition?.thickness ?? step.thickness ?? 200}
                      onChangeNm={(val) => {
                        handleUpdate({
                          thickness: val,
                          deposition: {
                            ...(step.deposition || {
                              method: 'PECVD',
                              depositionType: 'conformal',
                              thickness: val,
                            }),
                            thickness: val,
                          },
                        });
                      }}
                      unit={thicknessUnit}
                      minNm={5}
                      stepNm={10}
                      className="w-full px-2 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-100 font-mono text-[11px] tabular-nums focus:outline-none focus:border-sky-500"
                      expression={step.paramBindings?.['deposition.thickness']}
                      variables={variables}
                      waferWidth={waferWidth}
                      suggestedVarName="dep_thick"
                      targetLabel={`${step.title} · Film Thickness`}
                      onChangeExpression={(expr) => setStepParamBinding('deposition.thickness', expr)}
                      onCreateVariable={onCreateVariable}
                      onOpenVariablesModal={onOpenVariablesModal}
                    />
                  </div>

                  <div>
                    <label className="block text-[10.5px] text-slate-400 mb-0.5">
                      Deposition Method
                    </label>
                    <select
                      value={step.deposition?.method || 'PECVD'}
                      onChange={(e) => {
                        const nextMethod = e.target.value as NonNullable<ProcessStep['deposition']>['method'];
                        const prevDep = step.deposition || {
                          depositionType: 'conformal' as const,
                          thickness: step.thickness || 200,
                          method: 'PECVD' as const,
                        };
                        const wasPlating =
                          prevDep.method === 'Electroplating' ||
                          prevDep.method === 'Electroless Plating';
                        const isNextPlating =
                          nextMethod === 'Electroplating' ||
                          nextMethod === 'Electroless Plating';
                        const wasDryFilm = prevDep.method === 'Dry Film Lamination';
                        const isNextDryFilm = nextMethod === 'Dry Film Lamination';
                        const wasSpinCoat = prevDep.method === 'Spin Coat';
                        const isNextSpinCoat = nextMethod === 'Spin Coat';

                        handleUpdate({
                          deposition: {
                            ...prevDep,
                            method: nextMethod,
                            ...(isNextPlating && !wasPlating
                              ? {
                                  depositionType:
                                    nextMethod === 'Electroplating'
                                      ? 'bottom-up'
                                      : 'conformal',
                                  platingSelective: prevDep.platingSelective ?? true,
                                  platingSeedScope: prevDep.platingSeedScope ?? 'conductive',
                                }
                              : isNextDryFilm && !wasDryFilm
                              ? {
                                  depositionType: 'dry-film' as const,
                                  laminationSag: prevDep.laminationSag ?? 0,
                                }
                              : isNextSpinCoat && !wasSpinCoat
                              ? {
                                  depositionType: 'spin-coat' as const,
                                  planarization: prevDep.planarization ?? 100,
                                }
                              : !isNextDryFilm &&
                                (prevDep.depositionType === 'dry-film' ||
                                  (wasSpinCoat && prevDep.depositionType === 'spin-coat'))
                              ? {
                                  depositionType:
                                    nextMethod === 'E-Beam Evaporation'
                                      ? 'directional'
                                      : 'conformal',
                                }
                              : {}),
                          },
                        });
                      }}
                      className="w-full px-1.5 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-200 text-[11px] focus:outline-none focus:border-sky-500"
                    >
                      <option value="PECVD">PECVD</option>
                      <option value="LPCVD">LPCVD</option>
                      <option value="ALD">ALD (Atomic Layer)</option>
                      <option value="Sputter">Sputtering (PVD)</option>
                      <option value="E-Beam Evaporation">E-Beam Evap</option>
                      <option value="Electroplating">Electroplating (ECD)</option>
                      <option value="Electroless Plating">Electroless Plating</option>
                      <option value="Thermal Oxidation">Thermal Oxide</option>
                      <option value="Spin Coat">Spin Coat</option>
                      <option value="Dry Film Lamination">Dry Film Lamination</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[10.5px] text-slate-400 mb-0.5">
                    Conformity & Topography Coverage
                  </label>
                  <select
                    value={step.deposition?.depositionType || 'conformal'}
                    onChange={(e) =>
                      handleUpdate({
                        deposition: {
                          ...(step.deposition || {
                            method: 'PECVD',
                            thickness: step.thickness || 200,
                            depositionType: 'conformal',
                          }),
                          depositionType: e.target.value as any,
                        },
                      })
                    }
                    className="w-full px-2 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-200 text-[11px] focus:outline-none focus:border-sky-500"
                  >
                    <option value="conformal">Conformal (Uniform sidewalls & top)</option>
                    <option value="directional">Directional (Line-of-sight, E-Beam)</option>
                    <option value="semi-conformal">Semi-Conformal (Custom sidewall coverage)</option>
                    <option value="spin-coat">Planarizing Spin-Coat / Superfill (Fills valleys flat)</option>
                    <option value="dry-film">Dry Film Lamination / Tenting (Bridges cavities flat)</option>
                    <option value="bottom-up">Bottom-Up / Through-Mask Plating (Vertical growth)</option>
                  </select>
                </div>

                {step.deposition?.depositionType === 'spin-coat' && (
                  <div className="pt-2 border-t border-slate-800 space-y-1.5">
                    <div className="flex items-center justify-between text-[10.5px]">
                      <span className="text-slate-300 font-medium">
                        Planarization (Viscosity)
                      </span>
                      <span className="font-mono text-sky-400 tabular-nums">
                        {step.deposition?.planarization ?? 100}%{' '}
                        {(step.deposition?.planarization ?? 100) >= 95
                          ? '(Ideal Flat)'
                          : (step.deposition?.planarization ?? 100) >= 65
                          ? '(Low Visc.)'
                          : (step.deposition?.planarization ?? 100) >= 35
                          ? '(Moderate)'
                          : '(High Visc.)'}
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={step.deposition?.planarization ?? 100}
                      onChange={(e) =>
                        handleUpdate({
                          deposition: {
                            ...(step.deposition || {
                              method: 'Spin Coat',
                              depositionType: 'spin-coat',
                              thickness: step.thickness || 200,
                            }),
                            planarization: parseInt(e.target.value, 10),
                          },
                        })
                      }
                      className="w-full accent-sky-500"
                    />
                    <div className="flex items-center justify-between gap-1">
                      {[
                        { val: 25, label: '25% High Visc.' },
                        { val: 65, label: '65% Standard' },
                        { val: 100, label: '100% Ideal' },
                      ].map((preset) => {
                        const active = (step.deposition?.planarization ?? 100) === preset.val;
                        return (
                          <button
                            key={preset.val}
                            type="button"
                            onClick={() =>
                              handleUpdate({
                                deposition: {
                                  ...(step.deposition || {
                                    method: 'Spin Coat',
                                    depositionType: 'spin-coat',
                                    thickness: step.thickness || 200,
                                  }),
                                  planarization: preset.val,
                                },
                              })
                            }
                            className={`flex-1 py-0.5 rounded text-[9.5px] font-mono border transition-colors ${
                              active
                                ? 'bg-sky-500/20 border-sky-500/60 text-sky-300'
                                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                            }`}
                          >
                            {preset.label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[9.5px] text-slate-400 leading-tight">
                      {(step.deposition?.planarization ?? 100) >= 95
                        ? 'Ideal planarization: levels completely flat across all steps and valleys.'
                        : 'Models non-ideal viscous spin-coating: capillary forces fill narrow trenches faster while wider topography steps sag and dish.'}
                    </p>
                  </div>
                )}

                {(step.deposition?.method === 'Dry Film Lamination' ||
                  step.deposition?.depositionType === 'dry-film') && (
                  <div className="pt-2 border-t border-slate-800 space-y-1.5">
                    <div className="flex items-center justify-between text-[10.5px]">
                      <span className="text-slate-300 font-medium">
                        Vacuum / Roll Conformality (Sag)
                      </span>
                      <span className="font-mono text-sky-400 tabular-nums">
                        {step.deposition?.laminationSag ?? 0}%{' '}
                        {(step.deposition?.laminationSag ?? 0) === 0
                          ? '(Rigid Tent)'
                          : (step.deposition?.laminationSag ?? 0) <= 45
                          ? '(Warm Roll)'
                          : '(Vacuum Drape)'}
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={step.deposition?.laminationSag ?? 0}
                      onChange={(e) =>
                        handleUpdate({
                          deposition: {
                            ...(step.deposition || {
                              method: 'Dry Film Lamination',
                              depositionType: 'dry-film',
                              thickness: step.thickness || 200,
                            }),
                            laminationSag: parseInt(e.target.value, 10),
                          },
                        })
                      }
                      className="w-full accent-sky-500"
                    />
                    <div className="flex items-center justify-between gap-1">
                      {[
                        { val: 0, label: '0% Rigid Tent' },
                        { val: 35, label: '35% Warm Roll' },
                        { val: 75, label: '75% Vacuum' },
                      ].map((preset) => {
                        const active = (step.deposition?.laminationSag ?? 0) === preset.val;
                        return (
                          <button
                            key={preset.val}
                            type="button"
                            onClick={() =>
                              handleUpdate({
                                deposition: {
                                  ...(step.deposition || {
                                    method: 'Dry Film Lamination',
                                    depositionType: 'dry-film',
                                    thickness: step.thickness || 200,
                                  }),
                                  laminationSag: preset.val,
                                },
                              })
                            }
                            className={`flex-1 py-0.5 rounded text-[9.5px] font-mono border transition-colors ${
                              active
                                ? 'bg-sky-500/20 border-sky-500/60 text-sky-300'
                                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                            }`}
                          >
                            {preset.label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[9.5px] text-slate-400 leading-tight">
                      {(step.deposition?.laminationSag ?? 0) === 0
                        ? 'Laminates as a flat rigid sheet over peaks, tenting across channels & cavities to form sealed voids.'
                        : 'Bridges narrow trenches while smoothly draping onto wider open terraces under roller/vacuum pressure.'}
                    </p>

                    {(() => {
                      const activeMat = materials.find(
                        (m) => m.id === (step.materialId || 'mat_sio2_thermal')
                      );
                      const filmCandidates = materials.filter(
                        (m) => m.category === 'polymer' || m.category === 'photoresist'
                      );
                      if (
                        activeMat &&
                        (activeMat.category === 'polymer' || activeMat.category === 'photoresist')
                      ) {
                        return null;
                      }
                      if (filmCandidates.length === 0) return null;
                      return (
                        <div className="p-1.5 rounded-md bg-sky-950/30 border border-sky-500/30 space-y-1">
                          <div className="text-[9.5px] text-sky-300 leading-tight">
                            Selected material ({activeMat?.name || 'dielectric'}) is inorganic. Quick-select dry film:
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {filmCandidates.slice(0, 4).map((m) => (
                              <button
                                key={m.id}
                                type="button"
                                onClick={() => handleUpdate({ materialId: m.id })}
                                className="px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[9.5px] text-slate-200 font-mono"
                              >
                                {m.name}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {(step.deposition?.method === 'Electroplating' ||
                  step.deposition?.method === 'Electroless Plating') && (
                  <div className="pt-2 border-t border-slate-800 space-y-1.5">
                    <label className="flex items-start gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(step.deposition?.platingSelective)}
                        onChange={(e) =>
                          handleUpdate({
                            deposition: {
                              ...step.deposition!,
                              platingSelective: e.target.checked,
                              platingSeedScope:
                                step.deposition?.platingSeedScope ?? 'conductive',
                            },
                          })
                        }
                        className="mt-0.5 rounded bg-slate-800 border-slate-700 text-sky-500 focus:ring-0"
                      />
                      <div>
                        <span className="text-[10.5px] font-medium text-slate-200 block leading-tight">
                          Selective Seed-Surface Plating
                        </span>
                        <span className="text-[9.5px] text-slate-400 leading-tight block">
                          Plates only onto exposed seed/conductive regions; skips photoresist &amp; dielectrics.
                        </span>
                      </div>
                    </label>

                    {step.deposition?.platingSelective && (
                      <div className="space-y-1">
                        <span className="text-[9.5px] text-slate-400 block font-medium">
                          Active Plating Seed Surfaces
                        </span>
                        <div className="grid grid-cols-2 gap-1 bg-slate-900 p-0.5 rounded-md border border-slate-800 text-[10px]">
                          <button
                            type="button"
                            onClick={() =>
                              handleUpdate({
                                deposition: {
                                  ...step.deposition!,
                                  platingSeedScope: 'conductive',
                                },
                              })
                            }
                            className={`py-0.5 px-1.5 rounded font-medium transition-colors ${
                              (step.deposition?.platingSeedScope ?? 'conductive') ===
                              'conductive'
                                ? 'bg-sky-600 text-white'
                                : 'text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            Metals &amp; Si
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              handleUpdate({
                                deposition: {
                                  ...step.deposition!,
                                  platingSeedScope: 'metal-only',
                                },
                              })
                            }
                            className={`py-0.5 px-1.5 rounded font-medium transition-colors ${
                              step.deposition?.platingSeedScope === 'metal-only'
                                ? 'bg-sky-600 text-white'
                                : 'text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            Metals Only
                          </button>
                        </div>
                      </div>
                    )}

                    {(() => {
                      const activeMat = materials.find(
                        (m) => m.id === (step.materialId || 'mat_sio2_thermal')
                      );
                      const metalCandidates = materials
                        .filter((m) => m.category === 'metal')
                        .slice(0, 4);
                      if (activeMat?.category === 'metal' || metalCandidates.length === 0) {
                        return null;
                      }
                      return (
                        <div className="p-1.5 rounded-md bg-amber-950/30 border border-amber-500/30 space-y-1">
                          <div className="text-[9.5px] text-amber-300 leading-tight">
                            Selected material ({activeMat?.name || 'oxide'}) is non-metallic. Quick-select metal:
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {metalCandidates.map((m) => (
                              <button
                                key={m.id}
                                type="button"
                                onClick={() => handleUpdate({ materialId: m.id })}
                                className="px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[9.5px] text-slate-200 font-mono"
                              >
                                {m.formula}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {step.deposition?.depositionType === 'directional' && (
                  <div className="pt-2 border-t border-slate-800 space-y-1.5">
                    <div className="flex items-center justify-between text-[10.5px]">
                      <span className="text-slate-300 font-medium">
                        Substrate Tilt Angle
                      </span>
                      <div className="flex items-center gap-1.5">
                        {(step.deposition?.tiltAngle ?? 0) !== 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              handleUpdate({
                                deposition: {
                                  ...step.deposition!,
                                  tiltAngle: 0,
                                },
                              })
                            }
                            className="text-[9.5px] text-slate-400 hover:text-sky-400 underline"
                          >
                            Reset 0°
                          </button>
                        )}
                        <span className="font-mono text-sky-400 tabular-nums">
                          {(step.deposition?.tiltAngle ?? 0) > 0
                            ? `+${step.deposition?.tiltAngle}°`
                            : `${step.deposition?.tiltAngle ?? 0}°`}
                        </span>
                      </div>
                    </div>
                    <input
                      type="range"
                      min="-75"
                      max="75"
                      step="1"
                      value={step.deposition?.tiltAngle ?? 0}
                      onChange={(e) =>
                        handleUpdate({
                          deposition: {
                            ...step.deposition!,
                            tiltAngle: parseInt(e.target.value, 10),
                          },
                        })
                      }
                      className="w-full accent-sky-500"
                    />
                    <div className="flex items-center justify-between gap-1">
                      {[-45, -30, 0, 30, 45].map((presetDeg) => {
                        const active = (step.deposition?.tiltAngle ?? 0) === presetDeg;
                        return (
                          <button
                            key={presetDeg}
                            type="button"
                            onClick={() =>
                              handleUpdate({
                                deposition: {
                                  ...step.deposition!,
                                  tiltAngle: presetDeg,
                                },
                              })
                            }
                            className={`flex-1 py-0.5 rounded text-[9.5px] font-mono border transition-colors ${
                              active
                                ? 'bg-sky-500/20 border-sky-500/60 text-sky-300'
                                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                            }`}
                          >
                            {presetDeg > 0 ? `+${presetDeg}°` : `${presetDeg}°`}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[9.5px] text-slate-400 leading-tight">
                      {(step.deposition?.tiltAngle ?? 0) === 0
                        ? 'Normal incidence (vertical flux only, no sidewall coating).'
                        : (step.deposition?.tiltAngle ?? 0) > 0
                        ? 'Flux arrives from upper-right (+X): coats right-facing walls and casts shadows left.'
                        : 'Flux arrives from upper-left (-X): coats left-facing walls and casts shadows right.'}
                    </p>
                  </div>
                )}

                {step.deposition?.depositionType === 'semi-conformal' && (
                  <div>
                    <div className="flex justify-between text-[10.5px] text-slate-400 mb-0.5">
                      <span>Sidewall Step Coverage</span>
                      <span className="font-mono text-sky-400 tabular-nums">
                        {step.deposition?.stepCoverage ?? 60}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="10"
                      max="100"
                      value={step.deposition?.stepCoverage ?? 60}
                      onChange={(e) =>
                        handleUpdate({
                          deposition: {
                            ...step.deposition!,
                            stepCoverage: parseInt(e.target.value),
                          },
                        })
                      }
                      className="w-full accent-sky-500"
                    />
                  </div>
                )}

                {((step.deposition?.depositionType || 'conformal') === 'conformal' ||
                  step.deposition?.depositionType === 'semi-conformal') && (
                  <div className="pt-2 border-t border-slate-800 space-y-1.5">
                    <label className="flex items-start gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(step.deposition?.convexCornerEffect)}
                        onChange={(e) =>
                          handleUpdate({
                            deposition: {
                              ...(step.deposition || {
                                depositionType: 'conformal',
                                method: 'PECVD',
                                thickness: step.thickness || 200,
                              }),
                              convexCornerEffect: e.target.checked,
                              convexCornerStrength:
                                step.deposition?.convexCornerStrength ?? 0.6,
                            },
                          })
                        }
                        className="mt-0.5 rounded bg-slate-800 border-slate-700 text-sky-500 focus:ring-0"
                      />
                      <div>
                        <span className="text-[10.5px] font-medium text-slate-200 block leading-tight">
                          Faster Deposition at Convex Corners
                        </span>
                        <span className="text-[9.5px] text-slate-400 leading-tight block">
                          Outer step corners receive wider precursor flux and build thicker film (bread-loafing).
                        </span>
                      </div>
                    </label>

                    {step.deposition?.convexCornerEffect && (
                      <div>
                        <div className="flex justify-between text-[10.5px] text-slate-400 mb-0.5">
                          <span>Corner Rate Boost</span>
                          <span className="font-mono text-sky-400 tabular-nums">
                            +{Math.round((step.deposition?.convexCornerStrength ?? 0.6) * 100)}%{' '}
                            {(step.deposition?.convexCornerStrength ?? 0.6) < 0.4
                              ? '(Mild)'
                              : (step.deposition?.convexCornerStrength ?? 0.6) > 0.9
                              ? '(Strong)'
                              : '(Moderate)'}
                          </span>
                        </div>
                        <input
                          type="range"
                          min="20"
                          max="150"
                          step="5"
                          value={Math.round((step.deposition?.convexCornerStrength ?? 0.6) * 100)}
                          onChange={(e) =>
                            handleUpdate({
                              deposition: {
                                ...step.deposition!,
                                convexCornerStrength: parseInt(e.target.value) / 100,
                              },
                            })
                          }
                          className="w-full accent-sky-500"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Customization for LITHOGRAPHY */}
            {step.type === 'lithography' && (
              <div className="space-y-2 bg-slate-950/70 p-2.5 rounded-lg border border-slate-800 min-w-0">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-[11px] font-semibold text-rose-400">
                    Photoresist &amp; Exposure
                  </span>
                </div>

                {/* Mask Level Linking / Reticle Assignment */}
                <div className="p-2 rounded-md bg-slate-900 border border-slate-800 space-y-1.5 min-w-0">
                  <div className="flex items-center justify-between gap-1.5 flex-wrap">
                    <span className="text-[10.5px] font-semibold text-sky-400 flex items-center gap-1 min-w-0 flex-wrap">
                      <Scan className="w-3 h-3 shrink-0" />
                      <span className="truncate">Photomask Reticle</span>
                      {step.variants && step.variants.length > 1 && step.lithography?.maskId && (() => {
                        const curVar = getActiveStepVariant(step);
                        const sharedCount = step.variants.filter(
                          (v) => v.type === 'lithography' && v.lithography?.maskId === step.lithography?.maskId
                        ).length;
                        const isSharedMode = step.variantMaskEditMode === 'shared';
                        return (
                          <span
                            className={`px-1.5 py-0.5 rounded border text-[9.5px] font-medium shrink-0 ${
                              sharedCount > 1
                                ? isSharedMode
                                  ? 'bg-sky-500/15 text-sky-300 border-sky-500/35'
                                  : 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                                : 'bg-violet-500/15 text-violet-300 border-violet-500/35'
                            }`}
                            title={
                              sharedCount > 1
                                ? isSharedMode
                                  ? `Shared across ${sharedCount} variants — track edits carry over to all sharing variants`
                                  : `Shared across ${sharedCount} variants — modifying the aperture track creates a new mask branch automatically`
                                : `Dedicated mask branch for ${curVar?.name || 'this variant'}`
                            }
                          >
                            {sharedCount > 1
                              ? isSharedMode
                                ? `Shared Edit (${sharedCount} var)`
                                : `Auto-Branch (${sharedCount} var)`
                              : `Branch · ${curVar?.name || 'Variant'}`}
                          </span>
                        );
                      })()}
                    </span>
                    {onOpenMaskLevelsModal && (
                      <button
                        onClick={() => onOpenMaskLevelsModal(step.lithography?.maskId)}
                        className="text-[10.5px] text-sky-400 hover:text-sky-300 hover:underline flex items-center gap-1 font-medium shrink-0"
                      >
                        <span>Reticles →</span>
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 min-w-0">
                    <select
                      value={step.lithography?.maskId || 'none'}
                      onChange={(e) => {
                        const maskId = e.target.value === 'none' ? undefined : e.target.value;
                        const matchingMask = masks?.find((m) => m.id === maskId);
                        if (matchingMask) {
                          handleUpdate({
                            lithography: {
                              ...(step.lithography || {
                                resistMaterialId: 'mat_pr_pos',
                                resistThickness: 1000,
                                polarity: 'positive',
                                windows: [],
                                sidewallAngle: 90,
                                exposureMethod: 'UV Contact (365nm)',
                              }),
                              maskId: matchingMask.id,
                              maskName: matchingMask.name,
                              maskColor: matchingMask.color,
                              polarity: matchingMask.polarity,
                              maskField: matchingMask.maskField || 'dark-field',
                              resistMaterialId: resolveResistMaterialId(
                                matchingMask.polarity,
                                step.lithography?.resistMaterialId
                              ),
                              windows: matchingMask.windows.map((w) => ({ ...w })),
                            },
                          });
                          setIsEditingMaskName(false);
                        } else {
                          handleUpdate({
                            lithography: {
                              ...step.lithography!,
                              maskId: undefined,
                            },
                          });
                          setIsEditingMaskName(false);
                        }
                      }}
                      className="min-w-0 flex-1 w-full truncate px-2 py-1 rounded-md bg-slate-950 border border-slate-700 text-slate-200 text-[11px] font-mono focus:outline-none focus:border-sky-500"
                    >
                      <option value="none">-- Unlinked Custom Features --</option>
                      {masks?.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.windows?.length || 0}{' '}
                          {m.maskField === 'light-field' ? 'blockers' : 'apertures'} ·{' '}
                          {m.maskField === 'light-field' ? 'light-field' : 'dark-field'} ·{' '}
                          {m.polarity})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Click-to-edit Assigned Mask Name */}
                  <div className="flex items-center justify-between gap-2 pt-0.5 min-w-0">
                    <span className="text-[11px] text-slate-400 shrink-0">Mask Name:</span>
                    {isEditingMaskName ? (
                      <div className="flex items-center gap-1 flex-1 min-w-0">
                        <input
                          type="text"
                          autoFocus
                          value={editingMaskName}
                          onChange={(e) => setEditingMaskName(e.target.value)}
                          onBlur={() => {
                            const trimmed = editingMaskName.trim();
                            if (trimmed && step.lithography) {
                              handleUpdate({
                                lithography: {
                                  ...step.lithography,
                                  maskName: trimmed,
                                },
                              });
                            }
                            setIsEditingMaskName(false);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const trimmed = editingMaskName.trim();
                              if (trimmed && step.lithography) {
                                handleUpdate({
                                  lithography: {
                                    ...step.lithography,
                                    maskName: trimmed,
                                  },
                                });
                              }
                              setIsEditingMaskName(false);
                            }
                            if (e.key === 'Escape') {
                              setIsEditingMaskName(false);
                            }
                          }}
                          className="flex-1 min-w-0 px-2 py-0.5 rounded bg-slate-950 border border-sky-500 text-xs text-white font-mono focus:outline-none"
                        />
                        <button
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            const trimmed = editingMaskName.trim();
                            if (trimmed && step.lithography) {
                              handleUpdate({
                                lithography: {
                                  ...step.lithography,
                                  maskName: trimmed,
                                },
                              });
                            }
                            setIsEditingMaskName(false);
                          }}
                          className="p-0.5 text-emerald-400 hover:text-emerald-300"
                          title="Save Mask Name"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingMaskName(step.lithography?.maskName || 'Photomask Layer');
                          setIsEditingMaskName(true);
                        }}
                        className="group/editmask flex items-center gap-1.5 text-xs font-mono text-slate-200 hover:text-white px-2 py-0.5 rounded bg-slate-950/60 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 transition-colors truncate min-w-0 max-w-full"
                        title="Click to rename assigned mask"
                      >
                        <span className="truncate">
                          {step.lithography?.maskName || 'Photomask Layer'}
                        </span>
                        <Edit2 className="w-3 h-3 text-slate-500 group-hover/editmask:text-sky-400 shrink-0" />
                      </button>
                    )}
                  </div>

                  {step.lithography?.windows && (
                    <div className="flex items-center justify-between gap-2 flex-wrap text-[10px] text-slate-400 font-mono pt-0.5">
                      <span>
                        {step.lithography.maskField === 'light-field'
                          ? 'Light-Field'
                          : 'Dark-Field'}{' '}
                        · {step.lithography.windows.length}{' '}
                        {step.lithography.maskField === 'light-field'
                          ? step.lithography.windows.length === 1
                            ? 'blocker'
                            : 'blockers'
                          : step.lithography.windows.length === 1
                          ? 'aperture'
                          : 'apertures'}
                      </span>
                      <span className="text-amber-400">
                        {step.lithography.polarity === 'positive'
                          ? 'Positive Resist (Exposed dissolves)'
                          : 'Negative Resist (Exposed crosslinks)'}
                      </span>
                    </div>
                  )}

                  {step.lithography && (
                    <button
                      type="button"
                      onClick={() =>
                        handleUpdate({
                          lithography: {
                            ...step.lithography!,
                            definesAlignmentMarks: !step.lithography!.definesAlignmentMarks,
                          },
                        })
                      }
                      aria-pressed={Boolean(step.lithography.definesAlignmentMarks)}
                      className={`w-full flex items-center justify-between gap-2 px-2.5 py-1 rounded-md border text-[11px] font-medium transition-colors ${
                        step.lithography.definesAlignmentMarks
                          ? 'bg-cyan-500/15 border-cyan-500/50 text-cyan-200 hover:bg-cyan-500/20'
                          : 'bg-slate-950/70 border-slate-800 text-slate-300 hover:border-slate-700 hover:text-slate-100'
                      }`}
                      title="Toggle whether this photolithography step defines alignment marks on the substrate"
                    >
                      <span className="flex items-center gap-1.5">
                        <Crosshair className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                        <span>Defines Alignment Marks</span>
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded-xs text-[9.5px] font-mono ${
                          step.lithography.definesAlignmentMarks
                            ? 'bg-cyan-500/30 text-cyan-100'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {step.lithography.definesAlignmentMarks ? 'ON' : 'OFF'}
                      </span>
                    </button>
                  )}

                  {onToggleMaskTrack && (
                    <button
                      type="button"
                      onClick={onToggleMaskTrack}
                      aria-pressed={isMaskTrackOpen}
                      className={`w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md border text-[11px] font-medium transition-colors ${
                        isMaskTrackOpen
                          ? 'bg-sky-600/20 border-sky-500/60 text-sky-200 hover:bg-sky-600/30'
                          : 'bg-sky-600 hover:bg-sky-500 border-sky-500 text-white shadow-sm'
                      }`}
                    >
                      <Scan className="w-3.5 h-3.5 shrink-0" />
                      <span>{isMaskTrackOpen ? 'Hide Aperture Track' : 'Edit Aperture Track'}</span>
                    </button>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="block text-[10.5px] text-slate-400">
                    Resist Application Method
                  </label>
                  <div className="grid grid-cols-3 gap-0.5 p-0.5 rounded-md bg-slate-900 border border-slate-800 text-[10.5px]">
                    {(
                      [
                        {
                          id: 'spin-coat' as const,
                          label: 'Spin Coat',
                          title: 'Single-layer spin-coated photoresist',
                        },
                        {
                          id: 'lor-bilayer' as const,
                          label: 'LOR Double',
                          title: 'Bilayer coat: LOR underlayer + top imaging resist with adjustable lift-off undercut',
                        },
                        {
                          id: 'dry-film' as const,
                          label: 'Dry Film',
                          title: 'Laminated dry film photoresist sheet that tents across cavities',
                        },
                      ]
                    ).map((opt) => {
                      const active = (step.lithography?.coatMethod ?? 'spin-coat') === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          title={opt.title}
                          onClick={() => {
                            const prevLith = step.lithography || {
                              resistMaterialId: 'mat_pr_pos',
                              resistThickness: 1000,
                              polarity: 'positive' as const,
                              windows: [],
                              sidewallAngle: 90,
                              exposureMethod: 'UV Contact (365nm)' as const,
                            };
                            const hasDfr = materials.some((m) => m.id === 'mat_dfr');
                            handleUpdate({
                              lithography: {
                                ...prevLith,
                                coatMethod: opt.id,
                                ...(opt.id === 'lor-bilayer'
                                  ? {
                                      lorMaterialId: prevLith.lorMaterialId || 'mat_pr_lor',
                                      lorThickness: prevLith.lorThickness ?? 400,
                                      lorUndercut: prevLith.lorUndercut ?? 350,
                                      ...(prevLith.resistMaterialId === 'mat_dfr'
                                        ? {
                                            resistMaterialId:
                                              prevLith.polarity === 'negative'
                                                ? 'mat_pr_neg'
                                                : 'mat_pr_pos',
                                          }
                                        : {}),
                                    }
                                  : opt.id === 'dry-film' &&
                                    hasDfr &&
                                    (prevLith.resistMaterialId === 'mat_pr_pos' ||
                                      prevLith.resistMaterialId === 'mat_pr_neg')
                                  ? { resistMaterialId: 'mat_dfr' }
                                  : opt.id === 'spin-coat' &&
                                    prevLith.resistMaterialId === 'mat_dfr'
                                  ? {
                                      resistMaterialId:
                                        prevLith.polarity === 'negative'
                                          ? 'mat_pr_neg'
                                          : 'mat_pr_pos',
                                    }
                                  : {}),
                              },
                            });
                          }}
                          className={`py-0.5 px-1 rounded font-medium transition-colors truncate ${
                            active
                              ? opt.id === 'lor-bilayer'
                                ? 'bg-violet-600 text-white shadow-sm'
                                : 'bg-rose-600 text-white shadow-sm'
                              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/70'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {(step.lithography?.coatMethod ?? 'spin-coat') === 'lor-bilayer' && (() => {
                  const lorMat = getMaterialById(
                    materials,
                    step.lithography?.lorMaterialId || 'mat_pr_lor'
                  );
                  const lorThick = step.lithography?.lorThickness ?? 400;
                  const lorUndercut = step.lithography?.lorUndercut ?? 350;
                  const maxUndercutSlider = Math.max(1200, Math.round(waferWidth * 0.2));
                  return (
                    <div className="p-2 rounded-md bg-violet-950/25 border border-violet-500/35 space-y-1.5">
                      <div className="flex items-center justify-between gap-1.5">
                        <div className="flex items-center gap-1 min-w-0">
                          <span
                            className="w-2 h-2 rounded-xs shrink-0 border border-white/20"
                            style={{ backgroundColor: lorMat?.color || '#8b5cf6' }}
                          />
                          <span className="text-[10.5px] font-semibold text-violet-300 truncate">
                            Bilayer · {lorMat?.name || 'LOR Resist'}
                          </span>
                        </div>
                        <span className="text-[9.5px] font-mono text-violet-300/90 shrink-0 tabular-nums">
                          Total {formatThickness(lorThick + (step.lithography?.resistThickness ?? 1000), thicknessUnit)}
                        </span>
                      </div>

                      <div>
                        <label className="block text-[10px] text-slate-300 mb-0.5">
                          LOR Underlayer Thickness ({getUnitLabel(thicknessUnit)})
                        </label>
                        <ParametricThicknessInput
                          valueNm={lorThick}
                          onChangeNm={(val) =>
                            handleUpdate({
                              lithography: {
                                ...step.lithography!,
                                lorThickness: Math.max(50, val),
                              },
                            })
                          }
                          unit={thicknessUnit}
                          minNm={50}
                          stepNm={50}
                          className="w-full px-2 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-100 font-mono text-[11px] tabular-nums focus:outline-none focus:border-violet-500"
                          expression={step.paramBindings?.['lithography.lorThickness']}
                          variables={variables}
                          waferWidth={waferWidth}
                          suggestedVarName="lor_thick"
                          targetLabel={`${step.title} · LOR Underlayer Thickness`}
                          onChangeExpression={(expr) => setStepParamBinding('lithography.lorThickness', expr)}
                          onCreateVariable={onCreateVariable}
                          onOpenVariablesModal={onOpenVariablesModal}
                        />
                      </div>

                      <div className="space-y-1 pt-0.5">
                        <div className="flex items-center justify-between text-[10.5px]">
                          <span className="text-slate-300 font-medium">
                            LOR Lateral Undercut ({getUnitLabel(thicknessUnit)})
                          </span>
                          <span className="font-mono text-violet-300 tabular-nums">
                            {formatThickness(lorUndercut, thicknessUnit)}
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max={maxUndercutSlider}
                          step="25"
                          value={Math.min(maxUndercutSlider, lorUndercut)}
                          onChange={(e) =>
                            handleUpdate({
                              lithography: {
                                ...step.lithography!,
                                lorUndercut: parseInt(e.target.value, 10),
                              },
                            })
                          }
                          className="w-full accent-violet-500"
                        />
                        <ParametricThicknessInput
                          valueNm={lorUndercut}
                          onChangeNm={(val) =>
                            handleUpdate({
                              lithography: {
                                ...step.lithography!,
                                lorUndercut: Math.max(0, val),
                              },
                            })
                          }
                          unit={thicknessUnit}
                          minNm={0}
                          stepNm={25}
                          className="w-full px-2 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-100 font-mono text-[11px] tabular-nums focus:outline-none focus:border-violet-500"
                          expression={step.paramBindings?.['lithography.lorUndercut']}
                          variables={variables}
                          waferWidth={waferWidth}
                          suggestedVarName="lor_undercut"
                          targetLabel={`${step.title} · LOR Lateral Undercut`}
                          onChangeExpression={(expr) => setStepParamBinding('lithography.lorUndercut', expr)}
                          onCreateVariable={onCreateVariable}
                          onOpenVariablesModal={onOpenVariablesModal}
                        />
                        <div className="flex items-center justify-between gap-1">
                          {[0, 150, 350, 600].map((val) => {
                            const active = lorUndercut === val;
                            return (
                              <button
                                key={val}
                                type="button"
                                onClick={() =>
                                  handleUpdate({
                                    lithography: {
                                      ...step.lithography!,
                                      lorUndercut: val,
                                    },
                                  })
                                }
                                className={`flex-1 py-0.5 rounded text-[9.5px] font-mono border transition-colors ${
                                  active
                                    ? 'bg-violet-500/20 border-violet-500/60 text-violet-200'
                                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                                }`}
                              >
                                {formatThickness(val, thicknessUnit)}
                              </button>
                            );
                          })}
                        </div>
                        <p className="text-[9.5px] text-slate-400 leading-tight">
                          {lorUndercut === 0
                            ? 'Flush LOR wall (0 nm undercut). Increase undercut to form a re-entrant overhang for clean lift-off.'
                            : `Isotropic developer recesses LOR ${formatThickness(lorUndercut, thicknessUnit)} beneath the top imaging resist overhang.`}
                        </p>
                      </div>
                    </div>
                  );
                })()}

                {(step.lithography?.coatMethod ?? 'spin-coat') !== 'dry-film' ? (
                  <div className="p-2 rounded-md bg-slate-900/90 border border-slate-800 space-y-1">
                    <div className="flex items-center justify-between text-[10.5px]">
                      <span className="text-slate-300 font-medium">
                        Spin-Coat Planarization
                      </span>
                      <span className="font-mono text-rose-400 tabular-nums">
                        {step.lithography?.planarization ?? 100}%{' '}
                        {(step.lithography?.planarization ?? 100) >= 95
                          ? '(Ideal)'
                          : (step.lithography?.planarization ?? 100) >= 50
                          ? '(Partial)'
                          : '(High Visc.)'}
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={step.lithography?.planarization ?? 100}
                      onChange={(e) =>
                        handleUpdate({
                          lithography: {
                            ...(step.lithography || {
                              resistMaterialId: 'mat_pr_pos',
                              resistThickness: 1000,
                              polarity: 'positive',
                              windows: [],
                              sidewallAngle: 90,
                              exposureMethod: 'UV Contact (365nm)',
                            }),
                            planarization: parseInt(e.target.value, 10),
                          },
                        })
                      }
                      className="w-full accent-rose-500"
                    />
                    <div className="flex items-center justify-between gap-1">
                      {[
                        { val: 25, label: '25% High Visc.' },
                        { val: 65, label: '65% Standard' },
                        { val: 100, label: '100% Ideal' },
                      ].map((preset) => {
                        const active = (step.lithography?.planarization ?? 100) === preset.val;
                        return (
                          <button
                            key={preset.val}
                            type="button"
                            onClick={() =>
                              handleUpdate({
                                lithography: {
                                  ...(step.lithography || {
                                    resistMaterialId: 'mat_pr_pos',
                                    resistThickness: 1000,
                                    polarity: 'positive',
                                    windows: [],
                                    sidewallAngle: 90,
                                    exposureMethod: 'UV Contact (365nm)',
                                  }),
                                  planarization: preset.val,
                                },
                              })
                            }
                            className={`flex-1 py-0.5 rounded text-[9.5px] font-mono border transition-colors ${
                              active
                                ? 'bg-rose-500/20 border-rose-500/60 text-rose-300'
                                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                            }`}
                          >
                            {preset.label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[9.5px] text-slate-400 leading-tight">
                      {(step.lithography?.planarization ?? 100) >= 95
                        ? 'Flat planarized resist surface across all underlying topography.'
                        : 'High-viscosity resist dips over wide valleys while narrow trenches fill more flatly.'}
                    </p>
                  </div>
                ) : (
                  <div className="p-2 rounded-md bg-slate-900/90 border border-slate-800 space-y-1">
                    <div className="flex items-center justify-between text-[10.5px]">
                      <span className="text-slate-300 font-medium">
                        Lamination Conformality (Sag)
                      </span>
                      <span className="font-mono text-rose-400 tabular-nums">
                        {step.lithography?.laminationSag ?? 0}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={step.lithography?.laminationSag ?? 0}
                      onChange={(e) =>
                        handleUpdate({
                          lithography: {
                            ...step.lithography!,
                            laminationSag: parseInt(e.target.value, 10),
                          },
                        })
                      }
                      className="w-full accent-rose-500"
                    />
                    <p className="text-[9.5px] text-slate-400 leading-tight">
                      {(step.lithography?.laminationSag ?? 0) === 0
                        ? 'Dry film resist tents flat across cavities before UV exposure & development.'
                        : 'Dry film bridges narrow trenches while draping into wider topography.'}
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10.5px] text-slate-400 mb-0.5">
                      Mask Field Polarity
                    </label>
                    <select
                      value={step.lithography?.maskField || 'dark-field'}
                      onChange={(e) => {
                        const nextField = e.target.value as 'dark-field' | 'light-field';
                        handleUpdate({
                          lithography: {
                            ...(step.lithography || {
                              resistMaterialId: 'mat_pr_pos',
                              resistThickness: 1000,
                              polarity: 'positive',
                              windows: [],
                              sidewallAngle: 90,
                              exposureMethod: 'UV Contact (365nm)',
                            }),
                            maskField: nextField,
                          },
                        });
                      }}
                      className="w-full px-1.5 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-200 text-[11px] focus:outline-none focus:border-sky-500"
                    >
                      <option value="dark-field">Dark-Field (Blocks = Apertures)</option>
                      <option value="light-field">Light-Field (Blocks = Chrome Blockers)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10.5px] text-slate-400 mb-0.5">
                      {(step.lithography?.coatMethod ?? 'spin-coat') === 'lor-bilayer'
                        ? 'Top Resist Tone'
                        : 'Resist Tone'}
                    </label>
                    <select
                      value={step.lithography?.polarity || 'positive'}
                      onChange={(e) => {
                        const nextPolarity = e.target.value as 'positive' | 'negative';
                        handleUpdate({
                          lithography: {
                            ...(step.lithography || {
                              resistMaterialId: 'mat_pr_pos',
                              resistThickness: 1000,
                              polarity: 'positive',
                              windows: [],
                              sidewallAngle: 90,
                              exposureMethod: 'UV Contact (365nm)',
                            }),
                            polarity: nextPolarity,
                            resistMaterialId: resolveResistMaterialId(
                              nextPolarity,
                              step.lithography?.resistMaterialId
                            ),
                          },
                        });
                      }}
                      className="w-full px-1.5 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-200 text-[11px] focus:outline-none focus:border-sky-500"
                    >
                      <option value="positive">Positive (Exposed dissolves)</option>
                      <option value="negative">Negative (Unexposed dissolves)</option>
                    </select>
                  </div>
                </div>

                <div className="px-2 py-1 rounded-md bg-slate-900/80 border border-slate-800 text-[9.5px] text-slate-400 leading-tight">
                  {(step.lithography?.maskField || 'dark-field') === 'light-field' ? (
                    (step.lithography?.polarity || 'positive') === 'positive' ? (
                      <span>
                        <strong className="text-sky-300">Light-Field + Positive:</strong> Clear quartz exposes &amp; dissolves background resist; resist <strong className="text-slate-200">remains under chrome blockers</strong>.
                      </span>
                    ) : (
                      <span>
                        <strong className="text-sky-300">Light-Field + Negative:</strong> Clear quartz crosslinks background resist; resist <strong className="text-slate-200">dissolves under chrome blockers</strong>.
                      </span>
                    )
                  ) : (step.lithography?.polarity || 'positive') === 'positive' ? (
                    <span>
                      <strong className="text-amber-300">Dark-Field + Positive:</strong> UV passes through apertures to <strong className="text-slate-200">dissolve resist at apertures</strong>; background chrome protects resist.
                    </span>
                  ) : (
                    <span>
                      <strong className="text-amber-300">Dark-Field + Negative:</strong> UV passes through apertures to <strong className="text-slate-200">crosslink resist at apertures</strong>; unexposed background dissolves.
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10.5px] text-slate-400 mb-0.5">
                      {(step.lithography?.coatMethod ?? 'spin-coat') === 'lor-bilayer'
                        ? `Top Resist (${getUnitLabel(thicknessUnit)})`
                        : `Resist Thick. (${getUnitLabel(thicknessUnit)})`}
                    </label>
                    <ParametricThicknessInput
                      valueNm={step.lithography?.resistThickness ?? 1000}
                      onChangeNm={(val) =>
                        handleUpdate({
                          lithography: {
                            ...(step.lithography || {
                              resistMaterialId: 'mat_pr_pos',
                              polarity: 'positive',
                              windows: [],
                              sidewallAngle: 90,
                              exposureMethod: 'UV Contact (365nm)',
                              resistThickness: 1000,
                            }),
                            resistThickness: val,
                          },
                        })
                      }
                      unit={thicknessUnit}
                      minNm={100}
                      stepNm={100}
                      className="w-full px-2 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-100 font-mono text-[11px] tabular-nums focus:outline-none focus:border-sky-500"
                      expression={step.paramBindings?.['lithography.resistThickness']}
                      variables={variables}
                      waferWidth={waferWidth}
                      suggestedVarName="pr_thick"
                      targetLabel={`${step.title} · Resist Thickness`}
                      onChangeExpression={(expr) => setStepParamBinding('lithography.resistThickness', expr)}
                      onCreateVariable={onCreateVariable}
                      onOpenVariablesModal={onOpenVariablesModal}
                    />
                  </div>

                  <div>
                    <label className="block text-[10.5px] text-slate-400 mb-0.5">
                      Exposure Tool
                    </label>
                    <select
                      value={step.lithography?.exposureMethod || 'UV Contact (365nm)'}
                      onChange={(e) =>
                        handleUpdate({
                          lithography: {
                            ...step.lithography!,
                            exposureMethod: e.target.value as any,
                          },
                        })
                      }
                      className="w-full px-1.5 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-200 text-[11px] focus:outline-none focus:border-sky-500"
                    >
                      <option value="UV Contact (365nm)">UV Contact Aligner (i-line 365nm)</option>
                      <option value="DUV Stepper (248nm)">DUV Projection Stepper (248nm)</option>
                      <option value="E-Beam Litho">Electron Beam Lithography (EBL)</option>
                      <option value="Direct Write Laser">Direct Write Laser (MLA150)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-[10.5px] text-slate-400 mb-0.5">
                    <span>Sidewall Profile Angle</span>
                    <span className="font-mono text-rose-400 tabular-nums">
                      {step.lithography?.sidewallAngle ?? 90}°{' '}
                      {(step.lithography?.sidewallAngle ?? 90) > 90
                        ? '(Undercut)'
                        : (step.lithography?.sidewallAngle ?? 90) < 90
                        ? '(Tapered)'
                        : '(Vertical)'}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="75"
                    max="105"
                    value={step.lithography?.sidewallAngle ?? 90}
                    onChange={(e) =>
                      handleUpdate({
                        lithography: {
                          ...step.lithography!,
                          sidewallAngle: parseInt(e.target.value),
                        },
                      })
                    }
                    className="w-full accent-rose-500"
                  />
                </div>
              </div>
            )}

            {/* Customization for ETCH */}
            {step.type === 'etch' && (() => {
              const libraryRecipes = getEtchRecipes(etchRecipes);
              const currentEtchType = step.etch?.etchType || 'rie';
              const matchingRecipes = libraryRecipes.filter(
                (r) => r.etchType === currentEtchType
              );
              const linkedRecipe = step.etch?.etchRecipeId
                ? matchingRecipes.find((r) => r.id === step.etch?.etchRecipeId)
                : undefined;
              const rateMode =
                linkedRecipe && step.etch?.rateMode === 'time-rate'
                  ? 'time-rate'
                  : 'manual';
              const targetMatId = step.etch?.targetMaterialId || 'all';
              const defaultRefMatId =
                targetMatId !== 'all'
                  ? targetMatId
                  : linkedRecipe?.primaryMaterialId || 'mat_si_sub';
              const refMatId =
                linkedRecipe && step.etch?.referenceMaterialId
                  ? step.etch.referenceMaterialId
                  : defaultRefMatId;
              const refMat = materials.find((m) => m.id === refMatId);
              const refRate = linkedRecipe ? getEtchRateNmMin(linkedRecipe, refMatId) : 0;
              const prRate = linkedRecipe ? getEtchRateNmMin(linkedRecipe, 'mat_pr_pos') : 0;
              const stopMatId = step.etch?.stopLayerMaterialId;
              const stopRate =
                linkedRecipe && stopMatId
                  ? getEtchRateNmMin(linkedRecipe, stopMatId)
                  : undefined;
              const etchTimeSec = step.etch?.etchTimeSec ?? 60;
              const currentDepth = step.etch?.depth ?? step.thickness ?? 300;
              const estTimeSec =
                refRate > 0 ? Math.max(1, (currentDepth / refRate) * 60) : 0;

              return (
              <div className="space-y-2 bg-slate-950/70 p-2.5 rounded-lg border border-slate-800">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-amber-400">
                    Etch Parameters &amp; Isotropy
                  </span>
                  {onOpenEtchLibrary && (
                    <button
                      type="button"
                      onClick={onOpenEtchLibrary}
                      className="flex items-center gap-1 text-[10.5px] text-amber-400 hover:text-amber-300 hover:underline shrink-0"
                    >
                      <FlaskConical className="w-3 h-3" />
                      <span>Etch Library</span>
                    </button>
                  )}
                </div>

                {/* Etch Rate Library Recipe Selector */}
                <div>
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <label className="block text-[10.5px] text-slate-400">
                      Etch Chemistry / Rate Recipe
                    </label>
                    <span className="text-[9.5px] font-mono text-slate-500 tabular-nums">
                      {matchingRecipes.length}{' '}
                      {matchingRecipes.length === 1 ? 'recipe' : 'recipes'}
                    </span>
                  </div>
                  <select
                    value={
                      step.etch?.etchRecipeId &&
                      matchingRecipes.some((r) => r.id === step.etch?.etchRecipeId)
                        ? step.etch.etchRecipeId
                        : ''
                    }
                    onChange={(e) => {
                      const nextId = e.target.value;
                      if (!nextId) {
                        handleUpdate({
                          etch: {
                            ...(step.etch || {
                              etchType: currentEtchType,
                              depth: currentDepth,
                              targetMaterialId: 'all',
                              isotropy: 0.05,
                              sidewallAngle: 90,
                            }),
                            etchRecipeId: undefined,
                            referenceMaterialId: undefined,
                            rateMode: 'manual',
                          },
                        });
                        return;
                      }
                      const chosen = matchingRecipes.find((r) => r.id === nextId);
                      if (!chosen) return;
                      const isSameRecipe = step.etch?.etchRecipeId === chosen.id;
                      const nextRefMatId = isSameRecipe
                        ? step.etch?.referenceMaterialId
                        : undefined;
                      const chosenRefMatId =
                        nextRefMatId ||
                        (targetMatId !== 'all' ? targetMatId : chosen.primaryMaterialId);
                      const chosenRefRate = getEtchRateNmMin(chosen, chosenRefMatId);
                      const nextMode = step.etch?.rateMode || 'time-rate';
                      const nextSec =
                        step.etch?.etchTimeSec ||
                        (chosenRefRate > 0
                          ? Math.max(5, Math.min(600, Math.round((currentDepth / chosenRefRate) * 60)))
                          : 60);
                      const derivedDepth =
                        nextMode === 'time-rate' && chosenRefRate > 0
                          ? Math.max(5, Math.round((chosenRefRate * nextSec) / 60))
                          : currentDepth;

                      handleUpdate({
                        thickness: derivedDepth,
                        etch: {
                          ...(step.etch || {
                            etchType: chosen.etchType,
                            depth: derivedDepth,
                            targetMaterialId: 'all',
                            isotropy: chosen.isotropy,
                            sidewallAngle: chosen.sidewallAngle,
                          }),
                          etchRecipeId: chosen.id,
                          referenceMaterialId: nextRefMatId,
                          etchType: chosen.etchType,
                          isotropy: chosen.isotropy,
                          sidewallAngle: chosen.sidewallAngle,
                          scallopEffect: chosen.scallopEffect ?? (chosen.etchType === 'drie-bosch'),
                          scallopDepth: chosen.scallopDepth ?? step.etch?.scallopDepth,
                          scallopPitch: chosen.scallopPitch ?? step.etch?.scallopPitch,
                          ardeEnabled: chosen.ardeEnabled ?? step.etch?.ardeEnabled,
                          ardeStrength: chosen.ardeStrength ?? step.etch?.ardeStrength,
                          rateMode: nextMode,
                          etchTimeSec: nextSec,
                          depth: derivedDepth,
                        },
                        toolRecipe: {
                          ...(step.toolRecipe || {
                            toolName: '',
                            gases: '',
                            power: '',
                            pressure: '',
                            temperature: '',
                            duration: '',
                          }),
                          toolName: chosen.toolName || step.toolRecipe?.toolName || '',
                          gases: chosen.gases || chosen.chemistry,
                          power: chosen.power || '',
                          pressure: chosen.pressure || '',
                          temperature: chosen.temperature || '',
                          duration: formatDurationCompact(nextSec),
                          targetRate:
                            chosenRefRate > 0
                              ? formatEtchRate(chosenRefRate, thicknessUnit)
                              : '',
                        },
                      });
                    }}
                    className="w-full px-2 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-200 text-[11px] focus:outline-none focus:border-amber-500"
                  >
                    <option value="">-- Manual Depth (Custom Parameters) --</option>
                    {matchingRecipes.map((r) => {
                      const rRate = getEtchRateNmMin(r, r.primaryMaterialId);
                      return (
                        <option key={r.id} value={r.id}>
                          {r.name} ({r.chemistry} · {formatEtchRate(rRate, thicknessUnit)})
                        </option>
                      );
                    })}
                  </select>
                </div>

                {/* Mode Switcher & Selectivity Readout when Recipe Linked */}
                {linkedRecipe && (
                  <div className="p-2 rounded-md bg-amber-950/25 border border-amber-500/30 space-y-1.5 text-[10.5px]">
                    <div className="grid grid-cols-2 gap-0.5 p-0.5 rounded-md bg-slate-950 border border-slate-800">
                      <button
                        type="button"
                        onClick={() => {
                          const syncedDepth =
                            refRate > 0
                              ? Math.max(5, Math.round((refRate * etchTimeSec) / 60))
                              : currentDepth;
                          handleUpdate({
                            thickness: syncedDepth,
                            etch: {
                              ...step.etch!,
                              rateMode: 'time-rate',
                              etchTimeSec,
                              depth: syncedDepth,
                            },
                          });
                        }}
                        className={`py-0.5 px-1.5 rounded text-[10px] font-medium transition-colors ${
                          rateMode === 'time-rate'
                            ? 'bg-amber-600 text-white shadow-sm'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Time &amp; Rate
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleUpdate({
                            etch: {
                              ...step.etch!,
                              rateMode: 'manual',
                            },
                          })
                        }
                        className={`py-0.5 px-1.5 rounded text-[10px] font-medium transition-colors ${
                          rateMode === 'manual'
                            ? 'bg-amber-600 text-white shadow-sm'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Target Depth
                      </button>
                    </div>

                    {rateMode === 'manual' && (
                      <div>
                        <label className="block text-[9.5px] text-slate-400 mb-0.5">
                          Reference Material (Equiv. Time)
                        </label>
                        <select
                          value={refMatId}
                          onChange={(e) =>
                            handleUpdate({
                              etch: {
                                ...step.etch!,
                                referenceMaterialId: e.target.value,
                              },
                            })
                          }
                          className="w-full px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-200 text-[11px] focus:outline-none focus:border-amber-500"
                        >
                          {[...materials]
                            .sort((a, b) => {
                              const ra = getEtchRateNmMin(linkedRecipe, a.id);
                              const rb = getEtchRateNmMin(linkedRecipe, b.id);
                              if ((ra > 0) !== (rb > 0)) return rb > 0 ? 1 : -1;
                              return rb - ra;
                            })
                            .map((m) => {
                              const mRate = getEtchRateNmMin(linkedRecipe, m.id);
                              return (
                                <option
                                  key={m.id}
                                  value={m.id}
                                  disabled={mRate <= 0 && m.id !== refMatId}
                                >
                                  {m.name} ({m.formula}) ·{' '}
                                  {mRate > 0
                                    ? formatEtchRate(mRate, thicknessUnit)
                                    : '0 (Etch Stop)'}
                                </option>
                              );
                            })}
                        </select>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-1 text-[9.5px] font-mono text-slate-300 tabular-nums">
                      <span>
                        {refMat?.formula || 'Ref'}:{' '}
                        <strong className="text-amber-300">
                          {formatEtchRate(refRate, thicknessUnit)}
                        </strong>
                      </span>
                      <span>
                        vs PR:{' '}
                        <strong className="text-emerald-300">
                          {computeSelectivityRatio(refRate, prRate)}
                        </strong>
                        {prRate > 0 && (() => {
                          const effSec =
                            rateMode === 'time-rate' ? etchTimeSec : estTimeSec;
                          const prLossNm = Math.round((prRate * effSec) / 60);
                          return prLossNm > 0 ? (
                            <span className="text-rose-300">
                              {' '}(-{formatThickness(prLossNm, thicknessUnit)})
                            </span>
                          ) : null;
                        })()}
                      </span>
                      {stopRate !== undefined && (
                        <span>
                          vs Stop:{' '}
                          <strong className="text-sky-300">
                            {computeSelectivityRatio(refRate, stopRate)}
                          </strong>
                        </span>
                      )}
                    </div>

                    <p className="text-[9.5px] text-slate-400 leading-tight">
                      {rateMode === 'time-rate'
                        ? 'Multi-layer selectivity & photoresist mask erosion active; 0-rate layers act as etch stops.'
                        : refRate > 0
                        ? `Equiv. time from ${refMat?.formula || 'reference'} (${formatDurationCompact(estTimeSec)}); layers follow recipe etch rates.`
                        : 'Selected reference material has 0 nm/min etch rate in this recipe — select an etched material.'}
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  {linkedRecipe && rateMode === 'time-rate' ? (
                    <div>
                      <label className="block text-[10.5px] text-slate-400 mb-0.5">
                        Etch Time (sec)
                      </label>
                      <div className="space-y-0.5">
                        <input
                          type="number"
                          min={1}
                          step={5}
                          value={etchTimeSec}
                          onChange={(e) => {
                            const sec = Math.max(1, parseFloat(e.target.value) || 1);
                            const nextDepth =
                              refRate > 0
                                ? Math.max(5, Math.round((refRate * sec) / 60))
                                : currentDepth;
                            handleUpdate({
                              thickness: nextDepth,
                              etch: {
                                ...step.etch!,
                                etchTimeSec: sec,
                                depth: nextDepth,
                              },
                            });
                          }}
                          className="w-full px-2 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-100 font-mono text-[11px] tabular-nums focus:outline-none focus:border-amber-500"
                        />
                        <div className="flex items-center justify-between text-[9.5px] font-mono text-amber-300/90 tabular-nums">
                          <span>{formatDurationCompact(etchTimeSec)}</span>
                          <span>
                            {refRate > 0
                              ? `→ ${formatThickness(Math.round((refRate * etchTimeSec) / 60), thicknessUnit)}`
                              : '0 nm'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <label className="block text-[10.5px] text-slate-400 mb-0.5">
                        Etch Depth ({getUnitLabel(thicknessUnit)})
                      </label>
                      <ParametricThicknessInput
                        valueNm={step.etch?.depth ?? step.thickness ?? 300}
                        onChangeNm={(val) => {
                          handleUpdate({
                            thickness: val,
                            etch: {
                              ...(step.etch || {
                                etchType: 'rie',
                                targetMaterialId: 'all',
                                depth: val,
                                isotropy: 0.05,
                                sidewallAngle: 90,
                              }),
                              depth: val,
                            },
                          });
                        }}
                        unit={thicknessUnit}
                        minNm={10}
                        stepNm={25}
                        className="w-full px-2 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-100 font-mono text-[11px] tabular-nums focus:outline-none focus:border-sky-500"
                        expression={step.paramBindings?.['etch.depth']}
                        variables={variables}
                        waferWidth={waferWidth}
                        suggestedVarName="etch_depth"
                        targetLabel={`${step.title} · Etch Depth`}
                        onChangeExpression={(expr) => setStepParamBinding('etch.depth', expr)}
                        onCreateVariable={onCreateVariable}
                        onOpenVariablesModal={onOpenVariablesModal}
                      />
                      {linkedRecipe && refRate > 0 && (
                        <span className="text-[9.5px] font-mono text-amber-300/90 block mt-0.5 tabular-nums">
                          Est. time: {formatDurationCompact(estTimeSec)}
                        </span>
                      )}
                    </div>
                  )}

                  <div>
                    <label className="block text-[10.5px] text-slate-400 mb-0.5">
                      Etch Mechanism
                    </label>
                    <select
                      value={currentEtchType}
                      onChange={(e) => {
                        const nextEtchType = e.target.value as any;
                        const keepRecipe =
                          linkedRecipe && linkedRecipe.etchType === nextEtchType;
                        handleUpdate({
                          etch: {
                            ...(step.etch || {
                              depth: step.thickness || 300,
                              targetMaterialId: 'all',
                              isotropy: 0.05,
                              sidewallAngle: 90,
                              etchType: 'rie',
                            }),
                            etchType: nextEtchType,
                            ...(keepRecipe
                              ? {}
                              : {
                                  etchRecipeId: undefined,
                                  referenceMaterialId: undefined,
                                  rateMode: 'manual' as const,
                                }),
                            isotropy:
                              nextEtchType === 'wet-isotropic'
                                ? 0.95
                                : nextEtchType === 'drie-bosch' || nextEtchType === 'wet-koh'
                                ? 0.02
                                : nextEtchType === 'ashing'
                                ? 0.45
                                : 0.05,
                            sidewallAngle:
                              nextEtchType === 'wet-koh'
                                ? 54.74
                                : nextEtchType === 'wet-isotropic' || nextEtchType === 'ashing'
                                ? 90
                                : nextEtchType === 'ion-beam'
                                ? Math.min(
                                    90,
                                    step.etch?.sidewallAngle === 54.74
                                      ? 85
                                      : step.etch?.sidewallAngle ?? 85
                                  )
                                : step.etch?.sidewallAngle === 54.74
                                ? 90
                                : step.etch?.sidewallAngle ?? 90,
                            scallopEffect: nextEtchType === 'drie-bosch',
                            scallopDepth:
                              nextEtchType === 'drie-bosch'
                                ? step.etch?.scallopDepth ?? 45
                                : step.etch?.scallopDepth,
                            scallopPitch:
                              nextEtchType === 'drie-bosch'
                                ? step.etch?.scallopPitch ?? 200
                                : step.etch?.scallopPitch,
                          },
                        });
                      }}
                      className="w-full px-1.5 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-200 text-[11px] focus:outline-none focus:border-sky-500"
                    >
                      <option value="rie">Reactive Ion Etch (RIE)</option>
                      <option value="drie-bosch">Deep RIE (Bosch DRIE)</option>
                      <option value="wet-isotropic">Wet Chemical (HF/BOE - Isotropic)</option>
                      <option value="wet-koh">Wet KOH / TMAH Anisotropic (54.74°)</option>
                      <option value="ion-beam">Ion Beam Milling</option>
                      <option value="ashing">Oxygen Plasma Ashing</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10.5px] text-slate-400 mb-0.5">
                      Target Material
                    </label>
                    <select
                      value={step.etch?.targetMaterialId || 'all'}
                      onChange={(e) => {
                        const nextTarget = e.target.value;
                        handleUpdate({
                          etch: {
                            ...(step.etch || {
                              etchType: 'rie',
                              depth: step.thickness || 300,
                              isotropy: 0.05,
                              sidewallAngle: 90,
                            }),
                            targetMaterialId: nextTarget,
                            ...(nextTarget !== 'all'
                              ? { referenceMaterialId: undefined }
                              : {}),
                          },
                        });
                      }}
                      className="w-full px-1.5 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-200 text-[11px] focus:outline-none focus:border-sky-500"
                    >
                      <option value="all">All Exposed Layers</option>
                      {materials.map((m) => (
                        <option key={m.id} value={m.id}>
                          Selective: {m.name} ({m.formula})
                          {currentEtchType === 'wet-koh'
                            ? isCrystallineKohMaterial(m)
                              ? ' — Crystal {111}'
                              : ' — Isotropic'
                            : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10.5px] text-slate-400 mb-0.5">
                      Etch Stop Layer
                    </label>
                    <select
                      value={step.etch?.stopLayerMaterialId || ''}
                      onChange={(e) =>
                        handleUpdate({
                          etch: {
                            ...step.etch!,
                            stopLayerMaterialId: e.target.value || undefined,
                          },
                        })
                      }
                      className="w-full px-1.5 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-200 text-[11px] focus:outline-none focus:border-sky-500"
                    >
                      <option value="">None (Time Etch)</option>
                      {materials.map((m) => (
                        <option key={m.id} value={m.id}>
                          Stop: {m.name} ({m.formula})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {currentEtchType === 'wet-koh' && (() => {
                  const selectedTargetMat =
                    targetMatId !== 'all'
                      ? materials.find((m) => m.id === targetMatId)
                      : undefined;
                  if (selectedTargetMat && !isCrystallineKohMaterial(selectedTargetMat)) {
                    return (
                      <p className="px-2 py-1 rounded-md bg-sky-950/40 border border-sky-500/30 text-[9.5px] text-sky-200 leading-tight">
                        <strong>{selectedTargetMat.name}</strong> is not monocrystalline and does not etch along crystal planes — it will etch <strong>isotropically</strong> in KOH / TMAH.
                      </p>
                    );
                  }
                  return (
                    <p className="text-[9.5px] text-slate-400 leading-tight">
                      {selectedTargetMat
                        ? `${selectedTargetMat.name} etches anisotropically along crystal planes (${step.etch?.sidewallAngle ?? 54.74}°).`
                        : 'Crystal-plane etching (54.74°) applies only to single-crystal materials (Si <100>, Si:P); other layers etch isotropically.'}
                    </p>
                  );
                })()}

                <div>
                  <div className="flex justify-between text-[10.5px] text-slate-400 mb-0.5">
                    <span>
                      {step.etch?.etchType === 'wet-koh'
                        ? 'Crystal {111} Undercut'
                        : 'Etch Isotropy (Undercut)'}
                    </span>
                    {(() => {
                      const isoVal =
                        step.etch?.isotropy ??
                        (step.etch?.etchType === 'wet-isotropic' ? 0.95 : 0.05);
                      const isKoh = step.etch?.etchType === 'wet-koh';
                      const angleLabel = `${step.etch?.sidewallAngle ?? 54.74}°`;
                      return (
                        <span className="font-mono text-amber-400 tabular-nums">
                          {Math.round(isoVal * 100)}%{' '}
                          {isKoh
                            ? isoVal < 0.05
                              ? `(${angleLabel} Zero)`
                              : isoVal > 0.7
                              ? `(${angleLabel} High)`
                              : `(${angleLabel} Lat.)`
                            : isoVal < 0.1
                            ? '(Anisotropic)'
                            : isoVal > 0.7
                            ? '(Isotropic)'
                            : '(Moderate)'}
                        </span>
                      );
                    })()}
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={Math.round(
                      (step.etch?.isotropy ??
                        (step.etch?.etchType === 'wet-isotropic' ? 0.95 : 0.05)) * 100
                    )}
                    onChange={(e) =>
                      handleUpdate({
                        etch: {
                          ...step.etch!,
                          isotropy: parseInt(e.target.value) / 100,
                        },
                      })
                    }
                    className="w-full accent-amber-500"
                  />
                </div>

                {/* Sidewall Taper Angle for RIE, DRIE, and Ion Beam Milling */}
                {(['rie', 'drie-bosch', 'ion-beam'].includes(step.etch?.etchType || 'rie')) && (
                  <div className="pt-2 border-t border-slate-800 space-y-1.5">
                    <div className="flex justify-between text-[10.5px] text-slate-400">
                      <span>Sidewall Taper Angle</span>
                      {(() => {
                        const isIonBeam = step.etch?.etchType === 'ion-beam';
                        const rawAngle = step.etch?.sidewallAngle ?? (isIonBeam ? 85 : 90);
                        const angleVal = isIonBeam ? Math.min(90, rawAngle) : rawAngle;
                        return (
                          <span className="font-mono text-amber-400">
                            {angleVal}°{' '}
                            {angleVal > 90.25
                              ? `(${+(angleVal - 90).toFixed(1)}° Re-entrant)`
                              : angleVal < 89.75
                              ? `(${+(90 - angleVal).toFixed(1)}° Positive Taper)`
                              : '(Vertical 90°)'}
                          </span>
                        );
                      })()}
                    </div>
                    <input
                      type="range"
                      min={step.etch?.etchType === 'ion-beam' ? '75' : '80'}
                      max={step.etch?.etchType === 'ion-beam' ? '90' : '100'}
                      step="0.5"
                      value={
                        step.etch?.etchType === 'ion-beam'
                          ? Math.max(75, Math.min(90, step.etch?.sidewallAngle ?? 85))
                          : Math.max(80, Math.min(100, step.etch?.sidewallAngle ?? 90))
                      }
                      onChange={(e) =>
                        handleUpdate({
                          etch: {
                            ...(step.etch || {
                              etchType: 'rie',
                              depth: step.thickness || 300,
                              targetMaterialId: 'all',
                              isotropy: 0.05,
                              sidewallAngle: 90,
                            }),
                            sidewallAngle: parseFloat(e.target.value),
                          },
                        })
                      }
                      className="w-full accent-amber-500"
                    />
                    <div className="flex items-center justify-between gap-1">
                      {(step.etch?.etchType === 'ion-beam'
                        ? [75, 80, 85, 88, 90]
                        : [80, 85, 88, 90, 95, 100]
                      ).map((presetAngle) => {
                        const currentA =
                          step.etch?.sidewallAngle ??
                          (step.etch?.etchType === 'ion-beam' ? 85 : 90);
                        const active = Math.abs(currentA - presetAngle) < 0.25;
                        return (
                          <button
                            key={presetAngle}
                            type="button"
                            onClick={() =>
                              handleUpdate({
                                etch: {
                                  ...(step.etch || {
                                    etchType: 'rie',
                                    depth: step.thickness || 300,
                                    targetMaterialId: 'all',
                                    isotropy: 0.05,
                                    sidewallAngle: 90,
                                  }),
                                  sidewallAngle: presetAngle,
                                },
                              })
                            }
                            className={`flex-1 py-0.5 rounded text-[9.5px] font-mono border transition-colors ${
                              active
                                ? 'bg-amber-500/20 border-amber-500/60 text-amber-300'
                                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                            }`}
                          >
                            {presetAngle}°
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Adjustable Bosch DRIE Sidewall Scallops */}
                {step.etch?.etchType === 'drie-bosch' && (
                  <div className="pt-2 border-t border-slate-800 space-y-1.5">
                    <label className="flex items-start gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(step.etch?.scallopEffect)}
                        onChange={(e) =>
                          handleUpdate({
                            etch: {
                              ...step.etch!,
                              scallopEffect: e.target.checked,
                              scallopDepth: step.etch?.scallopDepth ?? 45,
                              scallopPitch: step.etch?.scallopPitch ?? 200,
                            },
                          })
                        }
                        className="mt-0.5 rounded bg-slate-800 border-slate-700 text-amber-500 focus:ring-0"
                      />
                      <div>
                        <span className="text-[10.5px] font-medium text-slate-200 block leading-tight">
                          Bosch DRIE Sidewall Scallops
                        </span>
                        <span className="text-[9.5px] text-slate-400 leading-tight block">
                          Periodic SF₆/C₄F₈ etch-passivation undulations along trench walls.
                        </span>
                      </div>
                    </label>

                    {step.etch?.scallopEffect && (
                      <div className="space-y-1.5 pl-1">
                        <div>
                          <div className="flex justify-between text-[10.5px] text-slate-400 mb-0.5">
                            <span>Scallop Depth</span>
                            <span className="font-mono text-amber-400 tabular-nums">
                              {formatThickness(step.etch?.scallopDepth ?? 45, thicknessUnit)}
                            </span>
                          </div>
                          <input
                            type="range"
                            min="10"
                            max="250"
                            step="5"
                            value={step.etch?.scallopDepth ?? 45}
                            onChange={(e) =>
                              handleUpdate({
                                etch: {
                                  ...step.etch!,
                                  scallopDepth: parseInt(e.target.value, 10),
                                },
                              })
                            }
                            className="w-full accent-amber-500"
                          />
                        </div>

                        <div>
                          <div className="flex justify-between text-[10.5px] text-slate-400 mb-0.5">
                            <span>Scallop Pitch</span>
                            {(() => {
                              const effCycleDepth =
                                linkedRecipe && rateMode === 'time-rate' && refRate > 0
                                  ? Math.round((refRate * etchTimeSec) / 60)
                                  : step.etch?.depth ?? step.thickness ?? 300;
                              const pitchNm = Math.max(20, step.etch?.scallopPitch ?? 200);
                              return (
                                <span className="font-mono text-amber-400 tabular-nums">
                                  {formatThickness(step.etch?.scallopPitch ?? 200, thicknessUnit)} (~
                                  {Math.max(1, Math.round(effCycleDepth / pitchNm))}{' '}
                                  cyc)
                                </span>
                              );
                            })()}
                          </div>
                          <input
                            type="range"
                            min="60"
                            max="600"
                            step="10"
                            value={step.etch?.scallopPitch ?? 200}
                            onChange={(e) =>
                              handleUpdate({
                                etch: {
                                  ...step.etch!,
                                  scallopPitch: parseInt(e.target.value, 10),
                                },
                              })
                            }
                            className="w-full accent-amber-500"
                          />
                        </div>
                        {step.etch?.ardeEnabled && (
                          <p className="text-[9.5px] text-slate-400 leading-tight">
                            Knudsen ARDE transport preserves total cycle count across narrow &amp; wide trenches while compressing local pitch.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Aspect Ratio Dependent Etching (ARDE / RIE Lag) for Dry Etching */}
                {(['rie', 'drie-bosch', 'ion-beam', 'ashing'].includes(
                  step.etch?.etchType || 'rie'
                )) && (
                  <div className="pt-2 border-t border-slate-800 space-y-1.5">
                    <label className="flex items-start gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(step.etch?.ardeEnabled)}
                        onChange={(e) =>
                          handleUpdate({
                            etch: {
                              ...(step.etch || {
                                etchType: 'rie',
                                depth: step.thickness || 300,
                                targetMaterialId: 'all',
                                isotropy: 0.05,
                                sidewallAngle: 90,
                              }),
                              ardeEnabled: e.target.checked,
                              ardeStrength: step.etch?.ardeStrength ?? 0.5,
                            },
                          })
                        }
                        className="mt-0.5 rounded bg-slate-800 border-slate-700 text-amber-500 focus:ring-0"
                      />
                      <div>
                        <span className="text-[10.5px] font-medium text-slate-200 block leading-tight">
                          Apply ARDE / RIE Lag Effect
                        </span>
                        <span className="text-[9.5px] text-slate-400 leading-tight block">
                          Narrow openings etch shallower than wide openings based on aspect ratio.
                        </span>
                      </div>
                    </label>

                    {step.etch?.ardeEnabled && (
                      <div>
                        <div className="flex justify-between text-[10.5px] text-slate-400 mb-0.5">
                          <span>RIE Lag Strength (k)</span>
                          <span className="font-mono text-amber-400 tabular-nums">
                            {Math.round((step.etch?.ardeStrength ?? 0.5) * 100)}%{' '}
                            {(step.etch?.ardeStrength ?? 0.5) < 0.35
                              ? '(Mild)'
                              : (step.etch?.ardeStrength ?? 0.5) > 0.7
                              ? '(Strong)'
                              : '(Moderate)'}
                          </span>
                        </div>
                        <input
                          type="range"
                          min="10"
                          max="100"
                          step="5"
                          value={Math.round((step.etch?.ardeStrength ?? 0.5) * 100)}
                          onChange={(e) =>
                            handleUpdate({
                              etch: {
                                ...step.etch!,
                                ardeStrength: parseInt(e.target.value) / 100,
                              },
                            })
                          }
                          className="w-full accent-amber-500"
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Convex Corner Acceleration for Isotropic Etching (and isotropic layers in KOH/TMAH) */}
                {(step.etch?.etchType === 'wet-isotropic' ||
                  step.etch?.etchType === 'wet-koh' ||
                  (step.etch?.isotropy ?? 0.05) >= 0.15) && (
                  <div className="pt-2 border-t border-slate-800 space-y-1.5">
                    <label className="flex items-start gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(step.etch?.convexCornerEffect)}
                        onChange={(e) =>
                          handleUpdate({
                            etch: {
                              ...(step.etch || {
                                etchType: 'wet-isotropic',
                                depth: step.thickness || 300,
                                targetMaterialId: 'all',
                                isotropy: 0.95,
                                sidewallAngle: 90,
                              }),
                              convexCornerEffect: e.target.checked,
                              convexCornerStrength:
                                step.etch?.convexCornerStrength ?? 0.6,
                            },
                          })
                        }
                        className="mt-0.5 rounded bg-slate-800 border-slate-700 text-amber-500 focus:ring-0"
                      />
                      <div>
                        <span className="text-[10.5px] font-medium text-slate-200 block leading-tight">
                          Faster Etch at Convex Corners
                        </span>
                        <span className="text-[9.5px] text-slate-400 leading-tight block">
                          Convex corners exposed to wider etchant solid angle etch faster, rounding step edges.
                        </span>
                      </div>
                    </label>

                    {step.etch?.convexCornerEffect && (
                      <div>
                        <div className="flex justify-between text-[10.5px] text-slate-400 mb-0.5">
                          <span>Corner Rate Boost</span>
                          <span className="font-mono text-amber-400 tabular-nums">
                            +{Math.round((step.etch?.convexCornerStrength ?? 0.6) * 100)}%{' '}
                            {(step.etch?.convexCornerStrength ?? 0.6) < 0.4
                              ? '(Mild)'
                              : (step.etch?.convexCornerStrength ?? 0.6) > 0.9
                              ? '(Strong)'
                              : '(Moderate)'}
                          </span>
                        </div>
                        <input
                          type="range"
                          min="20"
                          max="150"
                          step="5"
                          value={Math.round((step.etch?.convexCornerStrength ?? 0.6) * 100)}
                          onChange={(e) =>
                            handleUpdate({
                              etch: {
                                ...step.etch!,
                                convexCornerStrength: parseInt(e.target.value) / 100,
                              },
                            })
                          }
                          className="w-full accent-amber-500"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
              );
            })()}

            {/* Customization for STRIP / LIFTOFF */}
            {(step.type === 'strip' || step.type === 'liftoff') && (
              <div className="space-y-2 bg-slate-950/70 p-2.5 rounded-lg border border-slate-800">
                <span className="text-[11px] font-semibold text-emerald-400">
                  Strip &amp; Release Mechanism
                </span>

                <div>
                  <label className="block text-[10.5px] text-slate-400 mb-0.5">
                    Action Type
                  </label>
                  <select
                    value={step.strip?.stripType || (step.type === 'liftoff' ? 'metal-liftoff' : 'resist-strip')}
                    onChange={(e) =>
                      handleUpdate({
                        strip: {
                          ...(step.strip || { solvent: 'Acetone / Plasma' }),
                          stripType: e.target.value as any,
                        },
                      })
                    }
                    className="w-full px-2 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-200 text-[11px] focus:outline-none focus:border-sky-500"
                  >
                    <option value="resist-strip">Standard Resist Strip (Dissolves PR only)</option>
                    <option value="metal-liftoff">Metal Lift-off (Dissolves PR + lifts top films)</option>
                    <option value="sacrificial-release">MEMS Sacrificial Release (Releases cavities)</option>
                  </select>
                </div>

                {step.strip?.stripType === 'sacrificial-release' && (() => {
                  const releaseScope = step.strip?.releaseScope ?? 'all';
                  const regions = step.strip?.releaseRegions ?? [];
                  const activeSide = step.side || 'front';

                  const updateStripPatch = (patch: Partial<NonNullable<ProcessStep['strip']>>) => {
                    handleUpdate({
                      strip: {
                        ...(step.strip || {
                          stripType: 'sacrificial-release',
                          solvent: 'HF Vapor / BOE',
                          targetMaterialId: 'mat_sio2_thermal',
                        }),
                        ...patch,
                      },
                    });
                  };

                  const handleAddManualRegion = () => {
                    const span = Math.max(200, Math.round(waferWidth * 0.2));
                    const xStart = Math.max(0, Math.round((waferWidth - span) * 0.5));
                    const xEnd = Math.min(waferWidth, xStart + span);
                    const nextRegion: SacrificialReleaseRegion = {
                      id: `rel_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                      xStart,
                      xEnd,
                    };
                    updateStripPatch({
                      releaseScope: 'regions',
                      releaseRegions: [...regions, nextRegion],
                    });
                  };

                  return (
                    <div className="space-y-2">
                      <div>
                        <label className="block text-[10.5px] text-slate-400 mb-0.5">
                          Sacrificial Material to Dissolve
                        </label>
                        <select
                          value={step.strip?.targetMaterialId || 'mat_sio2_thermal'}
                          onChange={(e) =>
                            updateStripPatch({
                              targetMaterialId: e.target.value,
                            })
                          }
                          className="w-full px-2 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-200 text-[11px] focus:outline-none focus:border-sky-500"
                        >
                          {materials.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name} ({m.formula})
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Side summary & Release Scope Selector */}
                      <div className="space-y-1.5 pt-1 border-t border-slate-800/80">
                        <div className="flex items-center justify-between gap-2">
                          <label className="text-[10.5px] text-slate-400 font-medium">
                            Release Region Scope
                          </label>
                          <span className="text-[9.5px] font-mono text-slate-400">
                            {activeSide === 'front'
                              ? 'Front (+Z) only'
                              : activeSide === 'back'
                              ? 'Back (-Z) only'
                              : 'Both (±Z)'}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-0.5 p-0.5 rounded-md bg-slate-900 border border-slate-800 text-[10.5px]">
                          <button
                            type="button"
                            onClick={() => {
                              updateStripPatch({ releaseScope: 'all' });
                              if (pickReleaseMode && onTogglePickReleaseMode) {
                                onTogglePickReleaseMode();
                              }
                            }}
                            className={`py-1 px-1.5 rounded font-medium transition-colors ${
                              releaseScope === 'all'
                                ? 'bg-emerald-600 text-white shadow-sm'
                                : 'text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            Etch Entire Side
                          </button>
                          <button
                            type="button"
                            onClick={() => updateStripPatch({ releaseScope: 'regions' })}
                            className={`py-1 px-1.5 rounded font-medium transition-colors ${
                              releaseScope === 'regions'
                                ? 'bg-emerald-600 text-white shadow-sm'
                                : 'text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            Keep Regions
                          </button>
                        </div>

                        {releaseScope === 'regions' && (
                          <div className="space-y-1.5 p-2 rounded-md bg-slate-900/75 border border-emerald-500/25">
                            <p className="text-[9.5px] text-slate-400 leading-tight">
                              Selected regions are <span className="text-emerald-300 font-medium">protected</span>; all other matching material on this side is dissolved.
                            </p>

                            {/* Toolbar */}
                            <div className="flex flex-wrap items-center justify-between gap-1">
                              {onTogglePickReleaseMode && (
                                <button
                                  type="button"
                                  onClick={onTogglePickReleaseMode}
                                  className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10.5px] font-medium border transition-colors ${
                                    pickReleaseMode
                                      ? 'bg-emerald-500 text-slate-950 border-emerald-400 shadow-sm'
                                      : 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border-emerald-500/40'
                                  }`}
                                  title="Click sacrificial pockets or drag an X range on the cross-section canvas to keep them unetched"
                                >
                                  <Crosshair className="w-3 h-3 shrink-0" />
                                  <span>{pickReleaseMode ? 'Picking Kept' : 'Pick Canvas'}</span>
                                </button>
                              )}

                              <div className="flex items-center gap-1 ml-auto">
                                <button
                                  type="button"
                                  onClick={handleAddManualRegion}
                                  className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-[10.5px] font-medium transition-colors"
                                >
                                  <Plus className="w-3 h-3" />
                                  <span>Add</span>
                                </button>
                                {regions.length > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => updateStripPatch({ releaseRegions: [] })}
                                    className="px-2 py-0.5 rounded bg-slate-800 hover:bg-rose-950/60 border border-slate-700 hover:border-rose-500/40 text-slate-400 hover:text-rose-300 text-[10.5px] transition-colors"
                                    title="Clear all kept regions"
                                  >
                                    Clear
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Mini Wafer X-Track Preview */}
                            <div className="space-y-0.5">
                              <div className="relative h-4 w-full rounded bg-slate-950 border border-slate-800 overflow-hidden">
                                {regions.map((reg, rIdx) => {
                                  const lo = Math.max(0, Math.min(reg.xStart, reg.xEnd));
                                  const hi = Math.min(waferWidth, Math.max(reg.xStart, reg.xEnd));
                                  const leftPct = waferWidth > 0 ? (lo / waferWidth) * 100 : 0;
                                  const widthPct = waferWidth > 0 ? Math.max(1.5, ((hi - lo) / waferWidth) * 100) : 0;
                                  return (
                                    <div
                                      key={reg.id}
                                      style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                                      className="absolute top-0.5 bottom-0.5 rounded-xs bg-emerald-500/35 border border-emerald-400/80 flex items-center justify-center overflow-hidden"
                                      title={`Keep K${rIdx + 1} (not etched): ${(lo / 1000).toFixed(2)} – ${(hi / 1000).toFixed(2)} µm`}
                                    >
                                      <span className="text-[8.5px] font-mono font-bold text-emerald-200">
                                        K{rIdx + 1}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                              <div className="flex justify-between text-[8.5px] font-mono text-slate-500 tabular-nums">
                                <span>0 µm</span>
                                <span>{(waferWidth / 1000).toFixed(1)} µm</span>
                              </div>
                            </div>

                            {/* Region List */}
                            {regions.length === 0 ? (
                              <p className="text-[10px] text-slate-400 leading-tight">
                                No protected regions yet — all matching sacrificial material on this side will be etched. Click{' '}
                                <span className="text-emerald-300 font-medium">Pick Canvas</span> to select pockets or drag an X range to keep intact.
                              </p>
                            ) : (
                              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
                                {regions.map((reg, rIdx) => {
                                  const lo = Math.min(reg.xStart, reg.xEnd);
                                  const hi = Math.max(reg.xStart, reg.xEnd);
                                  const hasZBand = reg.yMin !== undefined && reg.yMax !== undefined;
                                  return (
                                    <div
                                      key={reg.id}
                                      className="p-1.5 rounded-md bg-slate-950/90 border border-slate-800 space-y-1"
                                    >
                                      <div className="flex items-center justify-between gap-1.5">
                                        <div className="flex items-center gap-1 min-w-0">
                                          <span className="px-1 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-mono text-[9.5px] font-semibold">
                                            K{rIdx + 1}
                                          </span>
                                          <span className="text-[9.5px] font-mono text-slate-400 truncate tabular-nums">
                                            Keep ΔX = {formatThickness(hi - lo, thicknessUnit)}
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-0.5 shrink-0">
                                          {hasZBand && (
                                            <button
                                              type="button"
                                              onClick={() =>
                                                updateStripPatch({
                                                  releaseRegions: regions.map((r) =>
                                                    r.id === reg.id
                                                      ? { ...r, yMin: undefined, yMax: undefined }
                                                      : r
                                                  ),
                                                })
                                              }
                                              className="px-1 py-0.5 rounded bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-300 text-[8.5px] font-mono"
                                              title={`Protected Z-band: ${(reg.yMin! / 1000).toFixed(2)}–${(reg.yMax! / 1000).toFixed(2)} µm. Click to protect Full Z at this X range.`}
                                            >
                                              Z-Band · Full Z
                                            </button>
                                          )}
                                          <button
                                            type="button"
                                            onClick={() =>
                                              updateStripPatch({
                                                releaseRegions: regions.filter((r) => r.id !== reg.id),
                                              })
                                            }
                                            className="p-0.5 text-slate-400 hover:text-rose-400 rounded hover:bg-slate-800 transition-colors"
                                            title="Remove release region"
                                          >
                                            <Trash2 className="w-3 h-3" />
                                          </button>
                                        </div>
                                      </div>

                                      <div className="grid grid-cols-2 gap-1.5">
                                        <div>
                                          <label className="block text-[9px] text-slate-400 mb-0.5">
                                            Start (µm)
                                          </label>
                                          <RegionUmInput
                                            valueNm={lo}
                                            minNm={0}
                                            maxNm={Math.max(0, hi - 10)}
                                            ariaLabel={`Region ${rIdx + 1} Start X in micrometers`}
                                            onCommitNm={(valNm) => {
                                              const nextStart = Math.max(0, Math.min(hi - 10, valNm));
                                              updateStripPatch({
                                                releaseRegions: regions.map((r) =>
                                                  r.id === reg.id
                                                    ? { ...r, xStart: nextStart, xEnd: hi }
                                                    : r
                                                ),
                                              });
                                            }}
                                          />
                                        </div>
                                        <div>
                                          <label className="block text-[9px] text-slate-400 mb-0.5">
                                            End (µm)
                                          </label>
                                          <RegionUmInput
                                            valueNm={hi}
                                            minNm={Math.min(waferWidth, lo + 10)}
                                            maxNm={waferWidth}
                                            ariaLabel={`Region ${rIdx + 1} End X in micrometers`}
                                            onCommitNm={(valNm) => {
                                              const nextEnd = Math.min(waferWidth, Math.max(lo + 10, valNm));
                                              updateStripPatch({
                                                releaseRegions: regions.map((r) =>
                                                  r.id === reg.id
                                                    ? { ...r, xStart: lo, xEnd: nextEnd }
                                                    : r
                                                ),
                                              });
                                            }}
                                          />
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}

                <div>
                  <label className="block text-[10.5px] text-slate-400 mb-0.5">
                    Solvent / Chemical Bath
                  </label>
                  <input
                    type="text"
                    value={step.strip?.solvent || 'Remover PG at 65°C'}
                    onChange={(e) =>
                      handleUpdate({
                        strip: {
                          ...(step.strip || { stripType: 'resist-strip', solvent: '' }),
                          solvent: e.target.value,
                        },
                      })
                    }
                    placeholder="e.g. Acetone, O2 Plasma, HF Vapor..."
                    className="w-full px-2 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-100 text-[11px] focus:outline-none focus:border-sky-500"
                  />
                </div>
              </div>
            )}

            {/* Customization for Grind / Polish / Planarize (CMP & Grinding) */}
            {step.type === 'cmp' && (
              <div className="space-y-2 bg-slate-950/70 p-2.5 rounded-lg border border-slate-800">
                <span className="text-[11px] font-semibold text-cyan-400">
                  Grind / Polish / Planarize
                </span>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10.5px] text-slate-400 mb-0.5">
                      Operation Type
                    </label>
                    <select
                      value={step.cmp?.operation || 'cmp'}
                      onChange={(e) =>
                        handleUpdate({
                          cmp: {
                            ...(step.cmp || { mode: 'polish-depth', depth: 300 }),
                            operation: e.target.value as any,
                          },
                        })
                      }
                      className="w-full px-1.5 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-200 text-[11px] focus:outline-none focus:border-sky-500"
                    >
                      <option value="cmp">CMP Planarization</option>
                      <option value="grind">Wafer Grinding / Thinning</option>
                      <option value="polish">Fine Lapping / Polishing</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10.5px] text-slate-400 mb-0.5">
                      Removal Mode
                    </label>
                    <select
                      value={step.cmp?.mode || 'polish-depth'}
                      onChange={(e) =>
                        handleUpdate({
                          cmp: {
                            ...(step.cmp || { depth: 300 }),
                            mode: e.target.value as any,
                          },
                        })
                      }
                      className="w-full px-1.5 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-200 text-[11px] focus:outline-none focus:border-sky-500"
                    >
                      <option value="polish-depth">Fixed Removal ({getUnitLabel(thicknessUnit)})</option>
                      <option value="stop-on-layer">Stop on Barrier Layer</option>
                      <option value="target-height">Target Z Plane ({getUnitLabel(thicknessUnit)})</option>
                    </select>
                  </div>
                </div>

                {(step.cmp?.mode || 'polish-depth') === 'polish-depth' && (
                  <div>
                    <label className="block text-[10.5px] text-slate-400 mb-0.5">
                      Removed Thickness / Grind Depth ({getUnitLabel(thicknessUnit)})
                    </label>
                    <ParametricThicknessInput
                      valueNm={step.cmp?.depth ?? 300}
                      onChangeNm={(val) =>
                        handleUpdate({
                          cmp: {
                            ...(step.cmp || { mode: 'polish-depth' }),
                            depth: val,
                          },
                        })
                      }
                      unit={thicknessUnit}
                      minNm={10}
                      stepNm={25}
                      className="w-full px-2 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-100 font-mono text-[11px] tabular-nums focus:outline-none focus:border-sky-500"
                      expression={step.paramBindings?.['cmp.depth']}
                      variables={variables}
                      waferWidth={waferWidth}
                      suggestedVarName="cmp_depth"
                      targetLabel={`${step.title} · CMP Removal Depth`}
                      onChangeExpression={(expr) => setStepParamBinding('cmp.depth', expr)}
                      onCreateVariable={onCreateVariable}
                      onOpenVariablesModal={onOpenVariablesModal}
                    />
                  </div>
                )}

                {step.cmp?.mode === 'target-height' && (
                  <div>
                    <label className="block text-[10.5px] text-slate-400 mb-0.5">
                      Target Z Plane Coordinate ({getUnitLabel(thicknessUnit)})
                    </label>
                    <ParametricThicknessInput
                      valueNm={step.cmp?.targetHeight ?? 2500}
                      onChangeNm={(val) =>
                        handleUpdate({
                          cmp: {
                            ...(step.cmp || { mode: 'target-height' }),
                            targetHeight: val,
                          },
                        })
                      }
                      unit={thicknessUnit}
                      minNm={-10000}
                      stepNm={50}
                      className="w-full px-2 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-100 font-mono text-[11px] tabular-nums focus:outline-none focus:border-sky-500"
                      expression={step.paramBindings?.['cmp.targetHeight']}
                      variables={variables}
                      waferWidth={waferWidth}
                      suggestedVarName="cmp_z"
                      targetLabel={`${step.title} · CMP Target Z`}
                      onChangeExpression={(expr) => setStepParamBinding('cmp.targetHeight', expr)}
                      onCreateVariable={onCreateVariable}
                      onOpenVariablesModal={onOpenVariablesModal}
                    />
                  </div>
                )}

                {step.cmp?.mode === 'stop-on-layer' && (
                  <div>
                    <label className="block text-[10.5px] text-slate-400 mb-0.5">
                      Stop Layer (e.g. Si3N4)
                    </label>
                    <select
                      value={step.cmp?.stopMaterialId || 'mat_si3n4'}
                      onChange={(e) =>
                        handleUpdate({
                          cmp: {
                            ...(step.cmp || { mode: 'stop-on-layer' }),
                            stopMaterialId: e.target.value,
                          },
                        })
                      }
                      className="w-full px-2 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-200 text-[11px] focus:outline-none focus:border-sky-500"
                    >
                      {materials.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.formula})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {(step.cmp?.operation || 'cmp') === 'cmp' && (() => {
                  const dishingPct = step.cmp?.dishing ?? 0;
                  const erosionPct = step.cmp?.erosion ?? 0;
                  const hasNonIdeality = dishingPct > 0 || erosionPct > 0;
                  return (
                    <div className="pt-2 border-t border-slate-800 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10.5px] font-semibold text-cyan-300">
                          CMP Non-Idealities
                        </span>
                        {hasNonIdeality && (
                          <button
                            type="button"
                            onClick={() =>
                              handleUpdate({
                                cmp: {
                                  ...(step.cmp || { mode: 'polish-depth', depth: 300 }),
                                  dishing: 0,
                                  erosion: 0,
                                },
                              })
                            }
                            className="text-[9.5px] font-mono text-slate-400 hover:text-cyan-300 transition-colors"
                          >
                            Reset 0%
                          </button>
                        )}
                      </div>

                      <div>
                        <div className="flex justify-between text-[10.5px] text-slate-400 mb-0.5">
                          <span>Dishing Effect</span>
                          <span className="font-mono text-cyan-400 tabular-nums">
                            {dishingPct === 0 ? '0% (Ideal)' : `${dishingPct}%`}
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="5"
                          value={dishingPct}
                          onChange={(e) =>
                            handleUpdate({
                              cmp: {
                                ...(step.cmp || { mode: 'polish-depth', depth: 300 }),
                                dishing: parseInt(e.target.value, 10),
                              },
                            })
                          }
                          className="w-full accent-cyan-500"
                        />
                        <p className="text-[9.5px] text-slate-500 leading-tight mt-0.5">
                          Concave recess inside wider softer/inlaid features (e.g. Cu or oxide trenches).
                        </p>
                      </div>

                      <div>
                        <div className="flex justify-between text-[10.5px] text-slate-400 mb-0.5">
                          <span>Erosion Effect</span>
                          <span className="font-mono text-cyan-400 tabular-nums">
                            {erosionPct === 0 ? '0% (Ideal)' : `${erosionPct}%`}
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="5"
                          value={erosionPct}
                          onChange={(e) =>
                            handleUpdate({
                              cmp: {
                                ...(step.cmp || { mode: 'polish-depth', depth: 300 }),
                                erosion: parseInt(e.target.value, 10),
                              },
                            })
                          }
                          className="w-full accent-cyan-500"
                        />
                        <p className="text-[9.5px] text-slate-500 leading-tight mt-0.5">
                          Pattern-density thinning of surrounding dielectric/stop areas across dense arrays.
                        </p>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Customization for WAFER BONDING */}
            {step.type === 'bonding' && (() => {
              const bondCfg: BondingConfig = step.bonding || {
                sourceType: 'custom-substrate',
                bondingMethod: 'fusion',
                incomingFace: 'front',
                customLayers: [
                  {
                    id: 'bond_layer_default',
                    name: 'Cap Wafer (Silicon <100>)',
                    materialId: 'mat_si_sub',
                    thickness: 2500,
                  },
                ],
              };
              const customLayers: SubstrateLayer[] =
                bondCfg.customLayers && bondCfg.customLayers.length > 0
                  ? bondCfg.customLayers
                  : [
                      {
                        id: 'bond_layer_default',
                        name: 'Cap Wafer (Silicon <100>)',
                        materialId: 'mat_si_sub',
                        thickness: 2500,
                      },
                    ];

              const updateBonding = (patch: Partial<BondingConfig>) => {
                handleUpdate({
                  bonding: {
                    ...bondCfg,
                    ...patch,
                  },
                });
              };

              const handleBondFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setBondingImportError(null);
                const reader = new FileReader();
                reader.onload = (ev) => {
                  try {
                    const parsed = JSON.parse(ev.target?.result as string) as ProcessFlow;
                    if (!parsed || !Array.isArray(parsed.steps) || !parsed.substrateWidth) {
                      setBondingImportError('Invalid MicroFlow JSON: missing steps or substrateWidth.');
                      return;
                    }
                    if (!parsed.substrateLayers || parsed.substrateLayers.length === 0) {
                      parsed.substrateLayers = [
                        {
                          id: 'sub_imported_default',
                          name: 'Bulk Silicon <100>',
                          materialId: parsed.substrateMaterialId || 'mat_si_sub',
                          thickness: parsed.substrateThickness || 3000,
                        },
                      ];
                    }
                    const resolvedImported = resolveFlowParameters(parsed);
                    const importedWidth = resolvedImported.substrateWidth || parsed.substrateWidth;
                    const flowTitle = parsed.title || file.name;

                    if (Math.abs(importedWidth - waferWidth) <= 1) {
                      commitImportedFlow(parsed, flowTitle, 'rescale', 'center', undefined, 'empty');
                    } else {
                      setPendingBondImport({
                        flow: parsed,
                        title: flowTitle,
                        importedWidth,
                        mode: bondCfg.widthMismatchMode || 'crop-pad',
                        alignment: bondCfg.widthAlignment || 'center',
                        offsetNm: bondCfg.widthOffsetNm,
                        paddingMode: bondCfg.widthPaddingMode || 'empty',
                      });
                    }
                  } catch {
                    setBondingImportError('Could not parse JSON process file.');
                  }
                };
                reader.readAsText(file);
                e.target.value = '';
              };

              return (
                <div className="space-y-2 bg-slate-950/70 p-2.5 rounded-lg border border-slate-800">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-indigo-400 flex items-center gap-1.5">
                      <Link2 className="w-3.5 h-3.5" />
                      <span>Wafer Bonding Parameters</span>
                    </span>
                  </div>

                  {/* Bonding Method */}
                  <div>
                    <label className="block text-[10.5px] text-slate-400 mb-0.5">
                      Bonding Mechanism
                    </label>
                    <select
                      value={bondCfg.bondingMethod || 'fusion'}
                      onChange={(e) =>
                        updateBonding({ bondingMethod: e.target.value as any })
                      }
                      className="w-full px-2 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-200 text-[11px] focus:outline-none focus:border-sky-500"
                    >
                      <option value="fusion">Direct / Fusion Bond (Si–Si / SiO₂–SiO₂)</option>
                      <option value="anodic">Anodic Bond (Si–Glass / Quartz)</option>
                      <option value="adhesive">Adhesive / Polymer Bond (SU-8 / BCB)</option>
                      <option value="eutectic">Eutectic / Thermo-Compression (Au–Au / Au–Sn)</option>
                      <option value="hybrid">Cu–Cu Hybrid Direct Bond</option>
                    </select>
                  </div>

                  {/* Second Wafer Source Selector */}
                  <div>
                    <label className="block text-[10.5px] text-slate-400 mb-0.5">
                      Bonded Substrate Source
                    </label>
                    <div className="grid grid-cols-2 gap-0.5 p-0.5 rounded-md bg-slate-900 border border-slate-800 text-[10.5px]">
                      <button
                        type="button"
                        onClick={() => updateBonding({ sourceType: 'custom-substrate' })}
                        className={`py-1 px-1.5 rounded font-medium transition-colors ${
                          bondCfg.sourceType === 'custom-substrate'
                            ? 'bg-indigo-600 text-white shadow-sm'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        New User Substrate
                      </button>
                      <button
                        type="button"
                        onClick={() => updateBonding({ sourceType: 'imported-flow' })}
                        className={`py-1 px-1.5 rounded font-medium transition-colors ${
                          bondCfg.sourceType === 'imported-flow'
                            ? 'bg-indigo-600 text-white shadow-sm'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Imported Process File
                      </button>
                    </div>
                  </div>

                  {/* Incoming Wafer Orientation */}
                  <div>
                    <label className="block text-[10.5px] text-slate-400 mb-0.5">
                      Incoming Wafer Mating Face
                    </label>
                    <select
                      value={bondCfg.incomingFace || 'front'}
                      onChange={(e) =>
                        updateBonding({ incomingFace: e.target.value as 'front' | 'back' })
                      }
                      className="w-full px-2 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-200 text-[11px] focus:outline-none focus:border-sky-500"
                    >
                      <option value="front">Frontside Face (Face-to-Face / Flip-Chip)</option>
                      <option value="back">Backside Face (Face-to-Back Stacking)</option>
                    </select>
                  </div>

                  {/* Source 1: Newly User-Defined Substrate Stack */}
                  {bondCfg.sourceType === 'custom-substrate' && (
                    <div className="space-y-1.5 pt-2 border-t border-slate-800">
                      <div className="flex items-center justify-between">
                        <span className="text-[10.5px] font-semibold text-slate-300">
                          Bonded Stack ({customLayers.length}{' '}
                          {customLayers.length === 1 ? 'Layer' : 'Layers'})
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            updateBonding({
                              customLayers: [
                                ...customLayers,
                                {
                                  id: `bond_layer_${Date.now()}`,
                                  name: `Film Layer #${customLayers.length + 1}`,
                                  materialId: 'mat_sio2_thermal',
                                  thickness: 300,
                                },
                              ],
                            })
                          }
                          className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-600 hover:bg-sky-500 text-white text-[10.5px] font-medium"
                        >
                          <Plus className="w-3 h-3" />
                          <span>Add Layer</span>
                        </button>
                      </div>

                      {/* Quick Substrate Presets */}
                      <div className="flex flex-wrap gap-1">
                        {[
                          {
                            label: 'Bare Si',
                            layers: [
                              { name: 'Silicon <100>', materialId: 'mat_si_sub', thickness: 2500 },
                            ],
                          },
                          {
                            label: 'Quartz Cap',
                            layers: [
                              { name: 'Quartz Glass Lid', materialId: 'mat_quartz', thickness: 2000 },
                            ],
                          },
                          {
                            label: 'Si + Oxide',
                            layers: [
                              { name: 'Silicon Handle', materialId: 'mat_si_sub', thickness: 2500 },
                              { name: 'Thermal Oxide', materialId: 'mat_sio2_thermal', thickness: 400 },
                            ],
                          },
                        ].map((preset) => (
                          <button
                            key={preset.label}
                            type="button"
                            onClick={() =>
                              updateBonding({
                                customLayers: preset.layers.map((l, idx) => ({
                                  ...l,
                                  id: `bond_layer_${Date.now()}_${idx}`,
                                })),
                              })
                            }
                            className="px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[9.5px] text-slate-300 hover:text-white transition-colors"
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>

                      {/* Layer cards (rendered top surface first) */}
                      <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
                        {[...customLayers].reverse().map((layer, revIdx) => {
                          const actualIdx = customLayers.length - 1 - revIdx;
                          return (
                            <div
                              key={layer.id}
                              className="p-1.5 rounded-md bg-slate-900 border border-slate-800 space-y-1"
                            >
                              <div className="flex items-center justify-between gap-1">
                                <input
                                  type="text"
                                  value={layer.name || ''}
                                  onChange={(e) => {
                                    const next = customLayers.map((l, i) =>
                                      i === actualIdx ? { ...l, name: e.target.value } : l
                                    );
                                    updateBonding({ customLayers: next });
                                  }}
                                  placeholder="Layer name..."
                                  className="flex-1 px-2 py-0.5 rounded bg-slate-950 border border-slate-700 text-[11px] text-white focus:outline-none focus:border-sky-500"
                                />
                                <button
                                  type="button"
                                  disabled={customLayers.length <= 1}
                                  onClick={() => {
                                    if (customLayers.length <= 1) return;
                                    updateBonding({
                                      customLayers: customLayers.filter((_, i) => i !== actualIdx),
                                    });
                                  }}
                                  className="p-0.5 rounded text-slate-400 hover:text-rose-400 disabled:opacity-20"
                                  title="Remove Layer"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>

                              <div className="grid grid-cols-2 gap-1.5">
                                <select
                                  value={layer.materialId}
                                  onChange={(e) => {
                                    const next = customLayers.map((l, i) =>
                                      i === actualIdx ? { ...l, materialId: e.target.value } : l
                                    );
                                    updateBonding({ customLayers: next });
                                  }}
                                  className="px-1.5 py-0.5 rounded bg-slate-950 border border-slate-700 text-[11px] text-slate-200 focus:outline-none focus:border-sky-500"
                                >
                                  {materials.map((m) => (
                                    <option key={m.id} value={m.id}>
                                      {m.name}
                                    </option>
                                  ))}
                                </select>
                                <div className="flex items-center gap-1">
                                  <ThicknessInput
                                    valueNm={layer.thickness}
                                    onChangeNm={(val) => {
                                      const next = customLayers.map((l, i) =>
                                        i === actualIdx ? { ...l, thickness: val } : l
                                      );
                                      updateBonding({ customLayers: next });
                                    }}
                                    unit={thicknessUnit}
                                    minNm={5}
                                    stepNm={50}
                                    className="w-full px-1.5 py-0.5 rounded bg-slate-950 border border-slate-700 text-[11px] font-mono tabular-nums text-white focus:outline-none focus:border-sky-500"
                                  />
                                  <span className="text-[9.5px] text-slate-500">
                                    {getUnitLabel(thicknessUnit)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Source 2: Pre-Processed Substrate from Imported Process JSON */}
                  {bondCfg.sourceType === 'imported-flow' && (
                    <div className="space-y-1.5 pt-2 border-t border-slate-800">
                      <label className="flex items-center justify-center gap-1.5 w-full py-1.5 px-2.5 rounded-md bg-slate-900 hover:bg-slate-800 border border-dashed border-indigo-500/60 hover:border-indigo-400 text-[11px] font-medium text-indigo-300 cursor-pointer transition-colors">
                        <Upload className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          {bondCfg.importedFlow
                            ? 'Replace Imported Process File (.json)'
                            : 'Import Pre-Processed Wafer (.json)'}
                        </span>
                        <input
                          type="file"
                          accept=".json"
                          onChange={handleBondFileUpload}
                          className="hidden"
                        />
                      </label>

                      {bondingImportError && (
                        <div className="p-1.5 rounded-md bg-rose-950/50 border border-rose-500/40 text-[10.5px] text-rose-300">
                          {bondingImportError}
                        </div>
                      )}

                      {bondCfg.importedFlow ? (
                        (() => {
                          const effectiveImportedWidth =
                            resolveFlowParameters(bondCfg.importedFlow).substrateWidth ||
                            bondCfg.importedFlow.substrateWidth;
                          const hasWidthMismatch = Math.abs(effectiveImportedWidth - waferWidth) > 1;
                          const mismatchMode = bondCfg.widthMismatchMode || 'rescale';
                          const widthAlignment = bondCfg.widthAlignment || 'center';

                          return (
                            <div
                              className={`p-2 rounded-md bg-slate-900 border space-y-1.5 text-[11px] ${
                                hasWidthMismatch ? 'border-amber-500/40' : 'border-emerald-500/40'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-1.5">
                                <span className="font-semibold text-emerald-300 flex items-center gap-1 truncate">
                                  <FileCheck className="w-3 h-3 shrink-0" />
                                  <span className="truncate">
                                    {bondCfg.importedFlowTitle || bondCfg.importedFlow.title}
                                  </span>
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateBonding({
                                      importedFlow: undefined,
                                      importedFlowTitle: undefined,
                                      widthMismatchMode: undefined,
                                      widthAlignment: undefined,
                                      widthOffsetNm: undefined,
                                      widthPaddingMode: undefined,
                                    })
                                  }
                                  className="text-[9.5px] text-slate-400 hover:text-rose-400 shrink-0"
                                >
                                  Clear
                                </button>
                              </div>

                              <div className="text-[9.5px] font-mono text-slate-400 flex items-center justify-between gap-2 tabular-nums">
                                <span>
                                  {bondCfg.importedFlow.steps.filter((s) => s.enabled).length} enabled steps simulated
                                </span>
                                <span className={hasWidthMismatch ? 'text-amber-300' : ''}>
                                  Width: {(effectiveImportedWidth / 1000).toFixed(2)} µm
                                  {hasWidthMismatch && ` (wafer ${(waferWidth / 1000).toFixed(2)} µm)`}
                                </span>
                              </div>

                              {hasWidthMismatch && (
                                <div className="pt-1.5 border-t border-slate-800 space-y-1.5">
                                  <div className="flex items-center justify-between gap-1.5">
                                    <span className="text-[9.5px] font-medium text-amber-300 flex items-center gap-1">
                                      <AlertTriangle className="w-3 h-3 shrink-0" />
                                      <span>Width Mismatch Handling</span>
                                    </span>
                                    <span className="text-[9.5px] font-mono text-slate-400">
                                      {effectiveImportedWidth > waferWidth ? 'Imported wider' : 'Imported narrower'}
                                    </span>
                                  </div>

                                  <div className="grid grid-cols-2 gap-0.5 p-0.5 rounded bg-slate-950 border border-slate-800 text-[9.5px]">
                                    <button
                                      type="button"
                                      onClick={() => updateBonding({ widthMismatchMode: 'rescale' })}
                                      className={`py-0.5 px-1.5 rounded font-medium flex items-center justify-center gap-1 transition-colors ${
                                        mismatchMode === 'rescale'
                                          ? 'bg-indigo-600 text-white'
                                          : 'text-slate-400 hover:text-slate-200'
                                      }`}
                                    >
                                      <Maximize2 className="w-2.5 h-2.5" />
                                      <span>Rescale</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        updateBonding({
                                          widthMismatchMode: 'crop-pad',
                                          widthAlignment: bondCfg.widthAlignment || 'center',
                                        })
                                      }
                                      className={`py-0.5 px-1.5 rounded font-medium flex items-center justify-center gap-1 transition-colors ${
                                        mismatchMode === 'crop-pad'
                                          ? 'bg-indigo-600 text-white'
                                          : 'text-slate-400 hover:text-slate-200'
                                      }`}
                                    >
                                      <Scissors className="w-2.5 h-2.5" />
                                      <span>{effectiveImportedWidth > waferWidth ? 'Crop + Align' : 'Pad + Align'}</span>
                                    </button>
                                  </div>

                                  {mismatchMode === 'crop-pad' && (
                                    <BondingAlignmentControl
                                      waferWidth={waferWidth}
                                      importedWidth={effectiveImportedWidth}
                                      alignment={widthAlignment}
                                      offsetNm={bondCfg.widthOffsetNm}
                                      paddingMode={bondCfg.widthPaddingMode || 'empty'}
                                      onChangeAlignment={(nextAlign, nextOffsetNm) =>
                                        updateBonding({
                                          widthAlignment: nextAlign,
                                          widthOffsetNm: nextOffsetNm,
                                        })
                                      }
                                      onChangePaddingMode={(nextPad) =>
                                        updateBonding({ widthPaddingMode: nextPad })
                                      }
                                      showPreview={true}
                                      compact={true}
                                    />
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })()
                      ) : (
                        <p className="text-[10px] text-slate-500 italic leading-tight">
                          Upload an exported MicroFlow <span className="font-mono">.json</span> process file. All enabled steps will be simulated and bonded onto the selected side.
                        </p>
                      )}

                      <label className="flex items-start gap-2 pt-0.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean(bondCfg.mirrorHorizontal)}
                          onChange={(e) =>
                            updateBonding({ mirrorHorizontal: e.target.checked })
                          }
                          className="mt-0.5 rounded bg-slate-800 border-slate-700 text-indigo-500 focus:ring-0"
                        />
                        <div>
                          <span className="text-[10.5px] font-medium text-slate-200 flex items-center gap-1">
                            <FlipHorizontal2 className="w-3 h-3 text-indigo-400 shrink-0" />
                            <span>Mirror Pre-Processed Substrate (L ↔ R)</span>
                          </span>
                          <span className="text-[9.5px] text-slate-400 leading-tight block">
                            Mirrors the imported wafer horizontally across X for asymmetric structures.
                          </span>
                        </div>
                      </label>
                    </div>
                  )}

                  {/* Optional Bonding Interface Seam Layer */}
                  <div className="pt-2 border-t border-slate-800 space-y-1.5">
                    <label className="flex items-center gap-1.5 text-[10.5px] text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(bondCfg.interfaceLayer?.enabled)}
                        onChange={(e) =>
                          updateBonding({
                            interfaceLayer: {
                              enabled: e.target.checked,
                              materialId: bondCfg.interfaceLayer?.materialId || 'mat_sio2_thermal',
                              thickness: bondCfg.interfaceLayer?.thickness || 100,
                            },
                          })
                        }
                        className="rounded bg-slate-800 border-slate-700 text-indigo-500 focus:ring-0"
                      />
                      <span>Include Bonding Interface / Adhesive Seam Layer</span>
                    </label>

                    {bondCfg.interfaceLayer?.enabled && (
                      <div className="grid grid-cols-2 gap-1.5">
                        <select
                          value={bondCfg.interfaceLayer.materialId}
                          onChange={(e) =>
                            updateBonding({
                              interfaceLayer: {
                                ...bondCfg.interfaceLayer!,
                                materialId: e.target.value,
                              },
                            })
                          }
                          className="px-1.5 py-1 rounded-md bg-slate-900 border border-slate-700 text-[11px] text-slate-200 focus:outline-none focus:border-sky-500"
                        >
                          {materials.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                        <div>
                          <ParametricThicknessInput
                            valueNm={bondCfg.interfaceLayer.thickness}
                            onChangeNm={(val) =>
                              updateBonding({
                                interfaceLayer: {
                                  ...bondCfg.interfaceLayer!,
                                  thickness: val,
                                },
                              })
                            }
                            unit={thicknessUnit}
                            minNm={5}
                            stepNm={25}
                            className="w-full px-2 py-1 rounded-md bg-slate-900 border border-slate-700 text-[11px] font-mono tabular-nums text-white focus:outline-none focus:border-sky-500"
                            expression={step.paramBindings?.['bonding.interfaceLayer.thickness']}
                            variables={variables}
                            waferWidth={waferWidth}
                            suggestedVarName="bond_seam"
                            targetLabel={`${step.title} · Bond Seam`}
                            onChangeExpression={(expr) =>
                              setStepParamBinding('bonding.interfaceLayer.thickness', expr)
                            }
                            onCreateVariable={onCreateVariable}
                            onOpenVariablesModal={onOpenVariablesModal}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Customization for TAPE & FRAME */}
            {step.type === 'tape-frame' && (() => {
              const tfCfg: TapeFrameConfig = step.tapeFrame || {
                action: 'mount',
                tapeMaterialId: 'mat_dicing_tape',
                thickness: 600,
                conformality: 'flat',
                showFrame: true,
              };
              const updateTf = (patch: Partial<TapeFrameConfig>) => {
                handleUpdate({
                  tapeFrame: {
                    ...tfCfg,
                    ...patch,
                  },
                });
              };
              const tapeMaterials = materials.filter(
                (m) =>
                  m.id === 'mat_dicing_tape' ||
                  m.id === 'mat_uv_tape' ||
                  m.id === 'mat_bg_tape' ||
                  m.id === 'mat_daf' ||
                  m.category === 'polymer'
              );

              return (
                <div className="space-y-2 bg-slate-950/70 p-2.5 rounded-lg border border-slate-800">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-sky-300 flex items-center gap-1.5">
                      <Frame className="w-3.5 h-3.5" />
                      <span>Tape &amp; Frame Parameters</span>
                    </span>
                  </div>

                  {/* Operation Toggle */}
                  <div>
                    <label className="block text-[10.5px] text-slate-400 mb-0.5">
                      Frame Operation
                    </label>
                    <div className="grid grid-cols-2 gap-0.5 p-0.5 rounded-md bg-slate-900 border border-slate-800 text-[10.5px]">
                      <button
                        type="button"
                        onClick={() => updateTf({ action: 'mount' })}
                        className={`py-1 px-1.5 rounded font-medium transition-colors ${
                          tfCfg.action === 'mount'
                            ? 'bg-sky-600 text-white shadow-sm'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Mount Tape &amp; Frame
                      </button>
                      <button
                        type="button"
                        onClick={() => updateTf({ action: 'demount' })}
                        className={`py-1 px-1.5 rounded font-medium transition-colors ${
                          tfCfg.action === 'demount'
                            ? 'bg-sky-600 text-white shadow-sm'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        UV Release / Demount
                      </button>
                    </div>
                  </div>

                  {tfCfg.action === 'mount' ? (
                    <>
                      <div>
                        <label className="block text-[10.5px] text-slate-400 mb-0.5">
                          Carrier Tape / Film Type
                        </label>
                        <select
                          value={tfCfg.tapeMaterialId}
                          onChange={(e) => updateTf({ tapeMaterialId: e.target.value })}
                          className="w-full px-2 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-200 text-[11px] focus:outline-none focus:border-sky-500"
                        >
                          {(tapeMaterials.length > 0 ? tapeMaterials : materials).map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name} ({m.formula})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10.5px] text-slate-400 mb-0.5">
                            Tape Thickness ({getUnitLabel(thicknessUnit)})
                          </label>
                          <ParametricThicknessInput
                            valueNm={tfCfg.thickness}
                            onChangeNm={(val) => updateTf({ thickness: val })}
                            unit={thicknessUnit}
                            minNm={25}
                            stepNm={50}
                            className="w-full px-2 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-100 font-mono text-[11px] tabular-nums focus:outline-none focus:border-sky-500"
                            expression={step.paramBindings?.['tapeFrame.thickness']}
                            variables={variables}
                            waferWidth={waferWidth}
                            suggestedVarName="tape_thick"
                            targetLabel={`${step.title} · Tape Thickness`}
                            onChangeExpression={(expr) => setStepParamBinding('tapeFrame.thickness', expr)}
                            onCreateVariable={onCreateVariable}
                            onOpenVariablesModal={onOpenVariablesModal}
                          />
                        </div>

                        <div>
                          <label className="block text-[10.5px] text-slate-400 mb-0.5">
                            Lamination Tension
                          </label>
                          <select
                            value={tfCfg.conformality}
                            onChange={(e) =>
                              updateTf({ conformality: e.target.value as 'flat' | 'conformal' })
                            }
                            className="w-full px-1.5 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-200 text-[11px] focus:outline-none focus:border-sky-500"
                          >
                            <option value="flat">Flat Tensioned Frame</option>
                            <option value="conformal">Conformal Roller Press</option>
                          </select>
                        </div>
                      </div>

                      <label className="flex items-start gap-2 pt-0.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={tfCfg.showFrame}
                          onChange={(e) => updateTf({ showFrame: e.target.checked })}
                          className="mt-0.5 rounded bg-slate-800 border-slate-700 text-sky-500 focus:ring-0"
                        />
                        <div>
                          <span className="text-[10.5px] font-medium text-slate-200 block">
                            Render Stainless Ring Frame Clamps
                          </span>
                          <span className="text-[9.5px] text-slate-400 leading-tight block">
                            Shows film-frame edge grips holding the wafer during grinding &amp; singulation.
                          </span>
                        </div>
                      </label>
                    </>
                  ) : (
                    <div className="p-2 rounded-md bg-slate-900 border border-slate-800 text-[10.5px] text-slate-300 leading-snug">
                      UV irradiation reduces tape tack and peels the mounted dicing / backgrind carrier tape off the selected wafer side, leaving any singulated dies free.
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Customization for WAFER DICING */}
            {step.type === 'dicing' && (() => {
              const dCfg: DicingConfig = step.dicing || {
                method: 'blade',
                cutMode: 'through-wafer',
                kerfWidth: 400,
                cutDepth: 1500,
                sidewallAngle: 90,
                tapeOvercut: 120,
                streets: [
                  { id: 'st_default', xCenter: Math.round(waferWidth * 0.5) },
                ],
              };
              const updateDicing = (patch: Partial<DicingConfig>) => {
                handleUpdate({
                  dicing: {
                    ...dCfg,
                    ...patch,
                  },
                });
              };
              const streets = dCfg.streets || [];

              const setEvenStreets = (count: number) => {
                const next = Array.from({ length: count }, (_, idx) => ({
                  id: `st_${Date.now()}_${idx}`,
                  xCenter: Math.round(((idx + 1) / (count + 1)) * waferWidth),
                }));
                updateDicing({ streets: next });
              };

              return (
                <div className="space-y-2 bg-slate-950/70 p-2.5 rounded-lg border border-slate-800">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-orange-400 flex items-center gap-1.5">
                      <Slice className="w-3.5 h-3.5" />
                      <span>Wafer Dicing &amp; Singulation</span>
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10.5px] text-slate-400 mb-0.5">
                        Dicing Method
                      </label>
                      <select
                        value={dCfg.method}
                        onChange={(e) => {
                          const nextMethod = e.target.value as DicingConfig['method'];
                          const defaultKerf =
                            nextMethod === 'blade'
                              ? 400
                              : nextMethod === 'laser-ablation'
                              ? 160
                              : 90;
                          const defaultAngle = nextMethod === 'laser-ablation' ? 82 : 90;
                          updateDicing({
                            method: nextMethod,
                            kerfWidth: defaultKerf,
                            sidewallAngle: defaultAngle,
                          });
                        }}
                        className="w-full px-1.5 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-200 text-[11px] focus:outline-none focus:border-sky-500"
                      >
                        <option value="blade">Mechanical Blade Saw</option>
                        <option value="laser-ablation">Laser Ablation / Grooving</option>
                        <option value="stealth">Stealth Dicing (Laser)</option>
                        <option value="plasma">Plasma Dicing (DRIE)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10.5px] text-slate-400 mb-0.5">
                        Kerf Width ({getUnitLabel(thicknessUnit)})
                      </label>
                      <ParametricThicknessInput
                        valueNm={dCfg.kerfWidth}
                        onChangeNm={(val) => updateDicing({ kerfWidth: val })}
                        unit={thicknessUnit}
                        minNm={20}
                        stepNm={25}
                        className="w-full px-2 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-100 font-mono text-[11px] tabular-nums focus:outline-none focus:border-sky-500"
                        expression={step.paramBindings?.['dicing.kerfWidth']}
                        variables={variables}
                        waferWidth={waferWidth}
                        suggestedVarName="kerf_w"
                        targetLabel={`${step.title} · Kerf Width`}
                        onChangeExpression={(expr) => setStepParamBinding('dicing.kerfWidth', expr)}
                        onCreateVariable={onCreateVariable}
                        onOpenVariablesModal={onOpenVariablesModal}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10.5px] text-slate-400 mb-0.5">
                      Cut Depth Mode
                    </label>
                    <div className="grid grid-cols-2 gap-0.5 p-0.5 rounded-md bg-slate-900 border border-slate-800 text-[10.5px]">
                      <button
                        type="button"
                        onClick={() => updateDicing({ cutMode: 'through-wafer' })}
                        className={`py-1 px-1.5 rounded font-medium transition-colors ${
                          dCfg.cutMode === 'through-wafer'
                            ? 'bg-orange-600 text-white shadow-sm'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Through-Wafer Cut
                      </button>
                      <button
                        type="button"
                        onClick={() => updateDicing({ cutMode: 'partial-depth' })}
                        className={`py-1 px-1.5 rounded font-medium transition-colors ${
                          dCfg.cutMode === 'partial-depth'
                            ? 'bg-orange-600 text-white shadow-sm'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Partial / Pre-Cut (DBG)
                      </button>
                    </div>
                  </div>

                  {dCfg.cutMode === 'partial-depth' ? (
                    <div>
                      <label className="block text-[10.5px] text-slate-400 mb-0.5">
                        Pre-Cut Kerf Depth ({getUnitLabel(thicknessUnit)})
                      </label>
                      <ParametricThicknessInput
                        valueNm={dCfg.cutDepth ?? 1500}
                        onChangeNm={(val) => updateDicing({ cutDepth: val })}
                        unit={thicknessUnit}
                        minNm={20}
                        stepNm={100}
                        className="w-full px-2 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-100 font-mono text-[11px] tabular-nums focus:outline-none focus:border-sky-500"
                        expression={step.paramBindings?.['dicing.cutDepth']}
                        variables={variables}
                        waferWidth={waferWidth}
                        suggestedVarName="cut_depth"
                        targetLabel={`${step.title} · Pre-Cut Depth`}
                        onChangeExpression={(expr) => setStepParamBinding('dicing.cutDepth', expr)}
                        onCreateVariable={onCreateVariable}
                        onOpenVariablesModal={onOpenVariablesModal}
                      />
                    </div>
                  ) : (
                    <div>
                      <label className="block text-[10.5px] text-slate-400 mb-0.5">
                        Dicing Tape Overcut Depth ({getUnitLabel(thicknessUnit)})
                      </label>
                      <ParametricThicknessInput
                        valueNm={dCfg.tapeOvercut ?? 120}
                        onChangeNm={(val) => updateDicing({ tapeOvercut: val })}
                        unit={thicknessUnit}
                        minNm={0}
                        stepNm={25}
                        className="w-full px-2 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-100 font-mono text-[11px] tabular-nums focus:outline-none focus:border-sky-500"
                        expression={step.paramBindings?.['dicing.tapeOvercut']}
                        variables={variables}
                        waferWidth={waferWidth}
                        suggestedVarName="tape_overcut"
                        targetLabel={`${step.title} · Tape Overcut`}
                        onChangeExpression={(expr) => setStepParamBinding('dicing.tapeOvercut', expr)}
                        onCreateVariable={onCreateVariable}
                        onOpenVariablesModal={onOpenVariablesModal}
                      />
                      <span className="text-[9.5px] text-slate-500 block mt-0.5 leading-tight">
                        Stops cleanly inside mounted dicing tape while cutting all wafer &amp; DAF layers.
                      </span>
                    </div>
                  )}

                  <div>
                    <div className="flex justify-between text-[10.5px] text-slate-400 mb-0.5">
                      <span>Kerf Sidewall Angle</span>
                      <span className="font-mono text-orange-400 tabular-nums">
                        {dCfg.sidewallAngle ?? 90}°{' '}
                        {(dCfg.sidewallAngle ?? 90) < 89 ? '(V-Taper)' : '(Vertical)'}
                      </span>
                    </div>
                    <input
                      type="range"
                      min="65"
                      max="90"
                      step="1"
                      value={dCfg.sidewallAngle ?? 90}
                      onChange={(e) =>
                        updateDicing({ sidewallAngle: parseInt(e.target.value, 10) })
                      }
                      className="w-full accent-orange-500"
                    />
                  </div>

                  {/* Dicing Streets List */}
                  <div className="pt-2 border-t border-slate-800 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10.5px] font-semibold text-slate-300">
                        Dicing Streets ({streets.length})
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          updateDicing({
                            streets: [
                              ...streets,
                              {
                                id: `st_${Date.now()}`,
                                xCenter: Math.round(waferWidth * 0.5),
                              },
                            ],
                          })
                        }
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-orange-600 hover:bg-orange-500 text-white text-[10.5px] font-medium"
                      >
                        <Plus className="w-3 h-3" />
                        <span>Add Cut</span>
                      </button>
                    </div>

                    <div className="flex items-center gap-1">
                      {[1, 2, 3, 4].map((cnt) => (
                        <button
                          key={cnt}
                          type="button"
                          onClick={() => setEvenStreets(cnt)}
                          className={`flex-1 py-0.5 rounded text-[9.5px] font-mono border transition-colors ${
                            streets.length === cnt
                              ? 'bg-orange-500/20 border-orange-500/60 text-orange-300'
                              : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {cnt} {cnt === 1 ? 'Cut' : 'Cuts'}
                        </button>
                      ))}
                    </div>

                    <div className="space-y-1 max-h-52 overflow-y-auto pr-0.5">
                      {streets.map((st, idx) => {
                        const streetExpr = st.paramBindings?.xCenter;
                        const isStreetOpen = openStreetBindId === st.id;
                        return (
                          <div
                            key={st.id}
                            className="p-1.5 rounded-md bg-slate-900 border border-slate-800 space-y-1"
                          >
                            <div className="flex items-center gap-1.5">
                              <span className="text-[9.5px] font-mono text-orange-400 w-6 shrink-0">
                                #{idx + 1}
                              </span>
                              {streetExpr ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setOpenStreetBindId(isStreetOpen ? null : st.id)
                                  }
                                  className="flex-1 min-w-0 px-1.5 py-0.5 rounded bg-violet-950/40 border border-violet-500/40 text-left text-[9.5px] font-mono text-violet-200 truncate"
                                >
                                  = {streetExpr}
                                </button>
                              ) : (
                                <input
                                  type="range"
                                  min={Math.round(waferWidth * 0.05)}
                                  max={Math.round(waferWidth * 0.95)}
                                  step={50}
                                  value={st.xCenter}
                                  onChange={(e) => {
                                    const val = parseInt(e.target.value, 10);
                                    updateDicing({
                                      streets: streets.map((s) =>
                                        s.id === st.id ? { ...s, xCenter: val } : s
                                      ),
                                    });
                                  }}
                                  className="flex-1 accent-orange-500 min-w-0"
                                />
                              )}
                              <span className="text-[9.5px] font-mono text-slate-300 w-12 text-right shrink-0 tabular-nums">
                                {(st.xCenter / 1000).toFixed(2)}µm
                              </span>
                              <ParamBindingBadge
                                expression={streetExpr}
                                isOpen={isStreetOpen}
                                onToggle={() =>
                                  setOpenStreetBindId(isStreetOpen ? null : st.id)
                                }
                                compact
                              />
                              <button
                                type="button"
                                disabled={streets.length <= 1}
                                onClick={() => {
                                  if (streets.length <= 1) return;
                                  updateDicing({
                                    streets: streets.filter((s) => s.id !== st.id),
                                  });
                                }}
                                className="p-0.5 text-slate-400 hover:text-rose-400 disabled:opacity-20 shrink-0"
                                title="Remove dicing street"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                            {isStreetOpen && (
                              <ParamBindingPanel
                                expression={streetExpr}
                                variables={variables}
                                waferWidth={waferWidth}
                                currentValue={st.xCenter}
                                unit="um"
                                suggestedVarName={`street_x_${idx + 1}`}
                                targetLabel={`Dicing Street #${idx + 1} X`}
                                onChangeExpression={(expr) => {
                                  updateDicing({
                                    streets: streets.map((s) => {
                                      if (s.id !== st.id) return s;
                                      const nextB = { ...(s.paramBindings || {}) };
                                      if (expr) nextB.xCenter = expr;
                                      else delete nextB.xCenter;
                                      return {
                                        ...s,
                                        paramBindings:
                                          Object.keys(nextB).length > 0 ? nextB : undefined,
                                      };
                                    }),
                                  });
                                }}
                                onCreateVariable={onCreateVariable}
                                onOpenVariablesModal={onOpenVariablesModal}
                                onClose={() => setOpenStreetBindId(null)}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })()}
          </>
        )}

        {/* Tab 2: Cleanroom Equipment & SOP Recipe */}
        {activeTab === 'equipment' && (
          <div className="space-y-2 bg-slate-950/70 p-2.5 rounded-lg border border-slate-800">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-sky-400">
                Cleanroom Run-Sheet &amp; Tool Parameters
              </span>
              {onOpenToolLibrary && (
                <button
                  type="button"
                  onClick={onOpenToolLibrary}
                  className="flex items-center gap-1 text-[10.5px] text-sky-400 hover:underline shrink-0"
                >
                  <Wrench className="w-3 h-3" />
                  <span>Tool Library</span>
                </button>
              )}
            </div>

            {/* Tool Library Selector */}
            <div className="p-2 rounded-md bg-slate-900/90 border border-slate-800 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <label className="text-[10.5px] font-medium text-slate-300">
                  Link Library Equipment
                </label>
                {linkedLibraryTool && (
                  <button
                    type="button"
                    onClick={() => handleSelectLibraryTool(linkedLibraryTool.id)}
                    className="text-[9.5px] text-cyan-300 hover:underline"
                    title="Reset SOP parameters from the linked tool defaults"
                  >
                    Reload Defaults
                  </button>
                )}
              </div>
              <select
                value={step.toolRecipe?.toolId || ''}
                onChange={(e) => handleSelectLibraryTool(e.target.value)}
                aria-label="Select cleanroom tool from library"
                className="w-full px-2 py-1 rounded-md bg-slate-950 border border-slate-700 text-slate-100 text-[11px] focus:outline-none focus:border-sky-500"
              >
                <option value="">-- Custom / Manual Tool Entry --</option>
                {groupedStepTools.exactMatches.length > 0 && (
                  <optgroup
                    label={`Matched (${
                      stepMechContext.primarySubLabel ||
                      getMechanismLabel(stepMechContext.mechanism, true)
                    })`}
                  >
                    {groupedStepTools.exactMatches.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {groupedStepTools.mechanismMatches.length > 0 && (
                  <optgroup
                    label={`Other ${getMechanismLabel(stepMechContext.mechanism, true)} Tools`}
                  >
                    {groupedStepTools.mechanismMatches.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {groupedStepTools.otherTools.length > 0 && (
                  <optgroup label="All Other Cleanroom Tools">
                    {groupedStepTools.otherTools.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              {linkedLibraryTool && (
                <div className="flex flex-wrap items-center justify-between gap-1 text-[9.5px] text-slate-400">
                  <span className="truncate">
                    {[linkedLibraryTool.vendor, linkedLibraryTool.bayLocation, linkedLibraryTool.waferSize]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  <span
                    className={`font-mono ${
                      linkedToolMatchLevel === 'exact'
                        ? 'text-emerald-300'
                        : linkedToolMatchLevel === 'mechanism'
                        ? 'text-sky-300'
                        : 'text-amber-300'
                    }`}
                  >
                    {linkedToolMatchLevel === 'exact'
                      ? 'Exact sub-mechanism match'
                      : linkedToolMatchLevel === 'mechanism'
                      ? 'Mechanism match'
                      : 'Unmatched sub-mechanism'}
                  </span>
                </div>
              )}
            </div>

            <div>
              <label className="block text-[10.5px] text-slate-400 mb-0.5">
                Equipment / Tool Tag
              </label>
              <input
                type="text"
                value={step.toolRecipe?.toolName || ''}
                onChange={(e) => handleUpdateRecipe('toolName', e.target.value)}
                placeholder="e.g. Plasma-Therm 790 RIE, Tystar Furnace..."
                className="w-full px-2 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-100 text-[11px] focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="flex items-center gap-1 text-[10.5px] text-slate-400 mb-0.5">
                  <Thermometer className="w-3 h-3 text-rose-400" />
                  <span>Temperature</span>
                </label>
                <input
                  type="text"
                  value={step.toolRecipe?.temperature || ''}
                  onChange={(e) => handleUpdateRecipe('temperature', e.target.value)}
                  placeholder="e.g. 950 °C"
                  className="w-full px-2 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-100 font-mono text-[11px] focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="flex items-center gap-1 text-[10.5px] text-slate-400 mb-0.5">
                  <Gauge className="w-3 h-3 text-sky-400" />
                  <span>Chamber Pressure</span>
                </label>
                <input
                  type="text"
                  value={step.toolRecipe?.pressure || ''}
                  onChange={(e) => handleUpdateRecipe('pressure', e.target.value)}
                  placeholder="e.g. 20 mTorr"
                  className="w-full px-2 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-100 font-mono text-[11px] focus:outline-none focus:border-sky-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="flex items-center gap-1 text-[10.5px] text-slate-400 mb-0.5">
                  <Zap className="w-3 h-3 text-amber-400" />
                  <span>RF / ICP Power</span>
                </label>
                <input
                  type="text"
                  value={step.toolRecipe?.power || ''}
                  onChange={(e) => handleUpdateRecipe('power', e.target.value)}
                  placeholder="e.g. 150 W RF"
                  className="w-full px-2 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-100 font-mono text-[11px] focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="flex items-center gap-1 text-[10.5px] text-slate-400 mb-0.5">
                  <Clock className="w-3 h-3 text-emerald-400" />
                  <span>Process Duration</span>
                </label>
                <input
                  type="text"
                  value={step.toolRecipe?.duration || ''}
                  onChange={(e) => handleUpdateRecipe('duration', e.target.value)}
                  placeholder="e.g. 75 s"
                  className="w-full px-2 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-100 font-mono text-[11px] focus:outline-none focus:border-sky-500"
                />
              </div>
            </div>

            <div>
              <label className="flex items-center gap-1 text-[10.5px] text-slate-400 mb-0.5">
                <Wind className="w-3 h-3 text-teal-400" />
                <span>Gas Flows (sccm)</span>
              </label>
              <input
                type="text"
                value={step.toolRecipe?.gases || ''}
                onChange={(e) => handleUpdateRecipe('gases', e.target.value)}
                placeholder="e.g. SF6: 30 sccm, O2: 5 sccm"
                className="w-full px-2 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-100 font-mono text-[11px] focus:outline-none focus:border-sky-500"
              />
            </div>

            <div>
              <label className="block text-[10.5px] text-slate-400 mb-0.5">
                Metrology &amp; Inspection Checkpoints
              </label>
              <textarea
                value={step.toolRecipe?.inspectionNotes || ''}
                onChange={(e) => handleUpdateRecipe('inspectionNotes', e.target.value)}
                rows={2}
                placeholder="e.g. Measure step height on Dektak stylus profilometer..."
                className="w-full px-2 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-100 text-[11px] focus:outline-none focus:border-sky-500"
              />
            </div>
          </div>
        )}

        {/* Tab 3: Process Documentation Notes */}
        {activeTab === 'notes' && (
          <div className="space-y-2 bg-slate-950/70 p-2.5 rounded-lg border border-slate-800">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="step-notes-tab-textarea"
                className="flex items-center gap-1.5 text-[11px] font-semibold text-cyan-300"
              >
                <FileText className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span>Notes</span>
                <span className="text-[10px] font-normal text-slate-500">(Optional)</span>
              </label>
              {Boolean(step.notes?.trim()) && (
                <button
                  type="button"
                  onClick={() => handleUpdate({ notes: undefined })}
                  className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[9.5px] text-slate-300 hover:text-white transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
            <textarea
              id="step-notes-tab-textarea"
              value={step.notes || ''}
              onChange={(e) => handleUpdate({ notes: e.target.value })}
              onBlur={() => {
                if (step.notes !== undefined && step.notes.trim() === '') {
                  handleUpdate({ notes: undefined });
                }
              }}
              rows={5}
              placeholder="Optional cleanroom instructions, chemical precautions, target specs, or design rationale..."
              className="w-full px-2 py-1.5 rounded-md bg-slate-900 border border-slate-700 text-slate-100 text-[11px] leading-snug resize-y focus:outline-none focus:border-sky-500 placeholder:text-slate-500"
            />
            <p className="text-[10px] text-slate-400 leading-tight">
              Appears as a documentation label and layer hover tooltip in the cross-section view.
            </p>
          </div>
        )}

        {/* Quick-access Optional Notes below Process / Tool SOP tabs */}
        {activeTab !== 'notes' && (
          <div className="pt-2 border-t border-slate-800/80">
            <div className="flex items-center justify-between gap-2 mb-1">
              <label
                htmlFor="step-notes-inline-textarea"
                className="flex items-center gap-1.5 text-[11px] font-medium text-slate-300"
              >
                <FileText className="w-3 h-3 text-cyan-400 shrink-0" />
                <span>Notes</span>
                <span className="text-[10px] font-normal text-slate-500">(Optional)</span>
              </label>
              {Boolean(step.notes?.trim()) && (
                <button
                  type="button"
                  onClick={() => handleUpdate({ notes: undefined })}
                  className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[9.5px] text-slate-300 hover:text-white transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
            <textarea
              id="step-notes-inline-textarea"
              value={step.notes || ''}
              onChange={(e) => handleUpdate({ notes: e.target.value })}
              onBlur={() => {
                if (step.notes !== undefined && step.notes.trim() === '') {
                  handleUpdate({ notes: undefined });
                }
              }}
              rows={2}
              placeholder="Optional cleanroom instructions, chemical precautions, target specs..."
              className="w-full px-2 py-1 rounded-md bg-slate-950 border border-slate-800 text-slate-200 text-[11px] leading-snug resize-y focus:outline-none focus:border-sky-500 placeholder:text-slate-500"
            />
            <p className="mt-0.5 text-[9.5px] text-slate-500">
              Shown in the cross-section view for process documentation.
            </p>
          </div>
        )}
      </div>

      {/* Wafer Bonding Imported Width Mismatch Modal */}
      {pendingBondImport &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4"
            onClick={() => setPendingBondImport(null)}
          >
            <div
              className="w-full max-w-3xl max-h-[92vh] flex flex-col rounded-xl bg-slate-900 border border-slate-700 shadow-2xl overflow-hidden text-slate-100"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-950/60 shrink-0">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                  <h3 className="text-sm font-semibold text-white">
                    Imported Wafer Width Mismatch
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setPendingBondImport(null)}
                  className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                  aria-label="Cancel import"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-4 overflow-y-auto">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                  {/* Left Column: Summary & Adaptation Controls */}
                  <div className="space-y-3">
                    <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800 space-y-1.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-400">Imported Process</span>
                        <span className="font-medium text-slate-100 truncate max-w-[200px]">
                          {pendingBondImport.title}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 font-mono">
                        <span className="text-slate-400 font-sans">Imported Wafer Width</span>
                        <span className="text-amber-300 font-semibold">
                          {(pendingBondImport.importedWidth / 1000).toFixed(2)} µm
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 font-mono">
                        <span className="text-slate-400 font-sans">Current Wafer Width</span>
                        <span className="text-sky-300 font-semibold">
                          {(waferWidth / 1000).toFixed(2)} µm
                        </span>
                      </div>
                    </div>

                    <p className="text-xs text-slate-300 leading-relaxed">
                      The imported wafer ({(pendingBondImport.importedWidth / 1000).toFixed(2)} µm) is{' '}
                      <span className="font-semibold text-white">
                        {pendingBondImport.importedWidth > waferWidth ? 'wider' : 'narrower'}
                      </span>{' '}
                      than the current wafer ({(waferWidth / 1000).toFixed(2)} µm). Choose how to adapt its lateral width during bonding:
                    </p>

                    <div className="space-y-2">
                      {/* Option 1: Rescale */}
                      <button
                        type="button"
                        onClick={() =>
                          setPendingBondImport((prev) =>
                            prev ? { ...prev, mode: 'rescale' } : null
                          )
                        }
                        className={`w-full text-left p-3 rounded-lg border transition-colors ${
                          pendingBondImport.mode === 'rescale'
                            ? 'bg-indigo-950/50 border-indigo-500 ring-1 ring-indigo-500/40'
                            : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                            <Maximize2 className="w-3.5 h-3.5 text-indigo-400" />
                            <span>Rescale to Current Wafer</span>
                          </span>
                          {pendingBondImport.mode === 'rescale' && (
                            <Check className="w-3.5 h-3.5 text-indigo-400" />
                          )}
                        </div>
                        <p className="text-[11px] text-slate-400 mt-1 leading-snug">
                          Proportionally scales the imported wafer horizontally from{' '}
                          {(pendingBondImport.importedWidth / 1000).toFixed(2)} µm to{' '}
                          {(waferWidth / 1000).toFixed(2)} µm to match edge-to-edge.
                        </p>
                      </button>

                      {/* Option 2: Crop / Pad + Align */}
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() =>
                          setPendingBondImport((prev) =>
                            prev ? { ...prev, mode: 'crop-pad' } : null
                          )
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setPendingBondImport((prev) =>
                              prev ? { ...prev, mode: 'crop-pad' } : null
                            );
                          }
                        }}
                        className={`w-full text-left p-3 rounded-lg border transition-colors cursor-pointer ${
                          pendingBondImport.mode === 'crop-pad'
                            ? 'bg-indigo-950/50 border-indigo-500 ring-1 ring-indigo-500/40'
                            : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                            <Scissors className="w-3.5 h-3.5 text-sky-400" />
                            <span>
                              {pendingBondImport.importedWidth > waferWidth
                                ? 'Crop & Align (Keep 1:1 Scale)'
                                : 'Pad & Align (Keep 1:1 Scale)'}
                            </span>
                          </span>
                          {pendingBondImport.mode === 'crop-pad' && (
                            <Check className="w-3.5 h-3.5 text-indigo-400" />
                          )}
                        </div>
                        <p className="text-[11px] text-slate-400 mt-1 leading-snug">
                          {pendingBondImport.importedWidth > waferWidth
                            ? 'Preserves true feature dimensions and crops overhanging edges outside the current wafer.'
                            : 'Preserves true feature dimensions and pads or leaves open the sides outside the imported wafer.'}
                        </p>

                        {pendingBondImport.mode === 'crop-pad' && (
                          <div
                            className="mt-2.5 pt-2.5 border-t border-slate-800/80"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <BondingAlignmentControl
                              waferWidth={waferWidth}
                              importedWidth={pendingBondImport.importedWidth}
                              alignment={pendingBondImport.alignment}
                              offsetNm={pendingBondImport.offsetNm}
                              paddingMode={pendingBondImport.paddingMode}
                              onChangeAlignment={(nextAlign, nextOffsetNm) =>
                                setPendingBondImport((prev) =>
                                  prev
                                    ? { ...prev, alignment: nextAlign, offsetNm: nextOffsetNm }
                                    : null
                                )
                              }
                              onChangePaddingMode={(nextPad) =>
                                setPendingBondImport((prev) =>
                                  prev ? { ...prev, paddingMode: nextPad } : null
                                )
                              }
                              showPreview={false}
                              compact={false}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Alignment Bar + Resulting Cross-Section Preview */}
                  <div className="space-y-3">
                    {/* Horizontal Alignment Diagram */}
                    {pendingBondImport.mode === 'rescale' ? (
                      <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 space-y-1.5">
                        <div className="flex items-center justify-between text-[10px] text-slate-400">
                          <span>Alignment Diagram</span>
                          <span className="font-mono text-slate-300">Scaled 100%</span>
                        </div>
                        <svg
                          viewBox="0 0 240 34"
                          className="w-full h-9 rounded bg-slate-900 border border-slate-800"
                          aria-label="Wafer bonding rescaled preview"
                        >
                          <rect
                            x={8}
                            y={5}
                            width={224}
                            height={10}
                            rx={2}
                            fill="#6366f1"
                            fillOpacity={0.85}
                            stroke="#a5b4fc"
                            strokeWidth={0.8}
                          />
                          <rect
                            x={8}
                            y={19}
                            width={224}
                            height={10}
                            rx={2}
                            fill="#0ea5e9"
                            fillOpacity={0.45}
                            stroke="#38bdf8"
                            strokeWidth={0.8}
                          />
                        </svg>
                        <div className="flex items-center justify-between text-[9px] text-slate-500">
                          <span className="flex items-center gap-1">
                            <span className="inline-block w-2 h-2 rounded-xs bg-indigo-500/85" />
                            Imported ({(pendingBondImport.importedWidth / 1000).toFixed(2)} µm → {(waferWidth / 1000).toFixed(2)} µm)
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="inline-block w-2 h-2 rounded-xs bg-sky-500/50 border border-sky-400/70" />
                            Current ({(waferWidth / 1000).toFixed(2)} µm)
                          </span>
                        </div>
                      </div>
                    ) : (
                      (() => {
                        const effectiveShiftX = resolveEffectiveShiftX(
                          waferWidth,
                          pendingBondImport.importedWidth,
                          pendingBondImport.alignment,
                          pendingBondImport.offsetNm
                        );
                        const hasGap =
                          effectiveShiftX > 1 ||
                          effectiveShiftX + pendingBondImport.importedWidth < waferWidth - 1;
                        const minCoord = Math.min(0, effectiveShiftX);
                        const maxCoord = Math.max(
                          waferWidth,
                          effectiveShiftX + pendingBondImport.importedWidth
                        );
                        const span = Math.max(1, maxCoord - minCoord);
                        const curLeftPct = ((0 - minCoord) / span) * 100;
                        const curWidthPct = (waferWidth / span) * 100;
                        const impLeftPct = ((effectiveShiftX - minCoord) / span) * 100;
                        const impWidthPct = (pendingBondImport.importedWidth / span) * 100;
                        const svgW = 240;
                        const padX = 8;
                        const usableW = svgW - padX * 2;
                        const curX = padX + (curLeftPct / 100) * usableW;
                        const curRectW = Math.max(2, (curWidthPct / 100) * usableW);
                        const impX = padX + (impLeftPct / 100) * usableW;
                        const impRectW = Math.max(2, (impWidthPct / 100) * usableW);
                        const leftPadW = Math.max(0, Math.min(curX + curRectW, impX) - curX);
                        const rightPadStart = Math.max(curX, impX + impRectW);
                        const rightPadW = Math.max(0, curX + curRectW - rightPadStart);

                        return (
                          <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 space-y-1.5">
                            <div className="flex items-center justify-between text-[10px] text-slate-400">
                              <span>Alignment Diagram</span>
                              <span className="font-mono text-slate-300">
                                Shift {(effectiveShiftX / 1000).toFixed(2)} µm
                                {hasGap && pendingBondImport.paddingMode === 'extend-edges'
                                  ? ' · Edge Fill'
                                  : ''}
                              </span>
                            </div>
                            <svg
                              viewBox="0 0 240 34"
                              className="w-full h-9 rounded bg-slate-900 border border-slate-800"
                              aria-label="Wafer bonding alignment preview"
                            >
                              <line
                                x1={curX}
                                y1={3}
                                x2={curX}
                                y2={31}
                                stroke="#38bdf8"
                                strokeOpacity={0.45}
                                strokeWidth={1}
                                strokeDasharray="2 2"
                              />
                              <line
                                x1={curX + curRectW}
                                y1={3}
                                x2={curX + curRectW}
                                y2={31}
                                stroke="#38bdf8"
                                strokeOpacity={0.45}
                                strokeWidth={1}
                                strokeDasharray="2 2"
                              />
                              {hasGap &&
                                pendingBondImport.paddingMode === 'extend-edges' &&
                                leftPadW > 0.5 && (
                                  <rect
                                    x={curX}
                                    y={6}
                                    width={leftPadW}
                                    height={8}
                                    rx={1}
                                    fill="#6366f1"
                                    fillOpacity={0.35}
                                    stroke="#818cf8"
                                    strokeWidth={0.7}
                                    strokeDasharray="2 1"
                                  />
                                )}
                              {hasGap &&
                                pendingBondImport.paddingMode === 'extend-edges' &&
                                rightPadW > 0.5 && (
                                  <rect
                                    x={rightPadStart}
                                    y={6}
                                    width={rightPadW}
                                    height={8}
                                    rx={1}
                                    fill="#6366f1"
                                    fillOpacity={0.35}
                                    stroke="#818cf8"
                                    strokeWidth={0.7}
                                    strokeDasharray="2 1"
                                  />
                                )}
                              <rect
                                x={impX}
                                y={5}
                                width={impRectW}
                                height={10}
                                rx={2}
                                fill="#6366f1"
                                fillOpacity={0.85}
                                stroke="#a5b4fc"
                                strokeWidth={0.8}
                              />
                              <rect
                                x={curX}
                                y={19}
                                width={curRectW}
                                height={10}
                                rx={2}
                                fill="#0ea5e9"
                                fillOpacity={0.45}
                                stroke="#38bdf8"
                                strokeWidth={0.8}
                              />
                            </svg>
                            <div className="flex items-center justify-between text-[9px] text-slate-500">
                              <span className="flex items-center gap-1">
                                <span className="inline-block w-2 h-2 rounded-xs bg-indigo-500/85" />
                                Imported ({(pendingBondImport.importedWidth / 1000).toFixed(2)} µm)
                              </span>
                              <span className="flex items-center gap-1">
                                <span className="inline-block w-2 h-2 rounded-xs bg-sky-500/50 border border-sky-400/70" />
                                Current ({(waferWidth / 1000).toFixed(2)} µm)
                              </span>
                            </div>
                          </div>
                        );
                      })()
                    )}

                    {/* Resulting Cross-Section Preview */}
                    {bondingResultPreview &&
                      (() => {
                        const {
                          mesh,
                          polygons,
                          materials: prevMats,
                          bounds,
                          incomingFace,
                          targetSide,
                          mirrorHorizontal,
                        } = bondingResultPreview;
                        const vbW = 380;
                        const vbH = 220;
                        const padX = 18;
                        const padY = 16;
                        const availW = vbW - padX * 2;
                        const availH = vbH - padY * 2;
                        const fSpanX = Math.max(100, bounds.maxX - bounds.minX);
                        const fSpanY = Math.max(300, bounds.maxY - bounds.minY);
                        const rawSx = availW / fSpanX;
                        const rawSy = (availH * 0.72) / fSpanY;
                        const rawH = fSpanY * rawSy;
                        const fit = rawH > availH ? availH / rawH : 1;
                        const sx = rawSx * fit;
                        const sy = rawSy * fit;
                        const offsetX = (vbW - fSpanX * sx) / 2 - bounds.minX * sx;
                        const baseBottomY = vbH / 2 + (fSpanY * sy) / 2;

                        const toScreen = (x: number, y: number) => ({
                          x: offsetX + x * sx,
                          y: baseBottomY - (y - bounds.minY) * sy,
                        });
                        const buildPath = (pts: { x: number; y: number }[]) => {
                          if (pts.length < 3) return '';
                          const first = toScreen(pts[0].x, pts[0].y);
                          let d = `M ${first.x.toFixed(1)} ${first.y.toFixed(1)}`;
                          for (let i = 1; i < pts.length; i++) {
                            const pt = toScreen(pts[i].x, pts[i].y);
                            d += ` L ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
                          }
                          return d + ' Z';
                        };

                        const datumL = toScreen(bounds.minX, bounds.minY);
                        const datumR = toScreen(bounds.maxX, bounds.minY);
                        const spanYLabel =
                          thicknessUnit === 'um'
                            ? `${((bounds.maxY - bounds.minY) / 1000).toFixed(2)} µm`
                            : `${Math.round(bounds.maxY - bounds.minY)} nm`;
                        const spanXLabel = `${((bounds.maxX - bounds.minX) / 1000).toFixed(2)} µm`;

                        return (
                          <div className="rounded-lg bg-slate-950 border border-slate-800 overflow-hidden">
                            <div className="px-2.5 py-1.5 bg-slate-950/90 border-b border-slate-800 flex items-center justify-between gap-2">
                              <span className="text-[11px] font-semibold text-slate-200">
                                Resulting Cross-Section Preview
                              </span>
                              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                                {targetSide === 'front' ? 'Top' : 'Bottom'} ← {incomingFace === 'front' ? 'Front' : 'Back'}
                                {mirrorHorizontal ? ' · Mirrored' : ''}
                              </span>
                            </div>
                            <div className="relative w-full h-52 sm:h-56 bg-[#060a12]">
                              <svg
                                viewBox={`0 0 ${vbW} ${vbH}`}
                                className="w-full h-full block"
                                preserveAspectRatio="xMidYMid meet"
                                aria-label="Resulting bonded wafer cross-section preview"
                              >
                                <SvgPatterns
                                  materials={prevMats}
                                  idPrefix="bond-mismatch-prev-"
                                />
                                <g>
                                  {polygons.map((poly) => {
                                    const mat = getMaterialById(prevMats, poly.materialId);
                                    const d = buildPath(poly.points);
                                    if (!d) return null;
                                    return (
                                      <path
                                        key={poly.id}
                                        d={d}
                                        fill={`url(#bond-mismatch-prev-mat-fill-${mat.id})`}
                                        stroke={mat.strokeColor || '#1e293b'}
                                        strokeWidth="0.9"
                                      />
                                    );
                                  })}
                                </g>
                                {mesh.mountedFrames &&
                                  mesh.mountedFrames.map((frame, fIdx) => {
                                    const leftX = toScreen(0, 0).x;
                                    const rightX = toScreen(waferWidth, 0).x;
                                    const yTopPx = toScreen(0, frame.yTop).y;
                                    const yBotPx = toScreen(0, frame.yBottom).y;
                                    const yMinPx = Math.min(yTopPx, yBotPx);
                                    const clampH = Math.max(3, Math.abs(yBotPx - yTopPx));
                                    return (
                                      <g key={`bm_frame_${fIdx}_${frame.side}`}>
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
                                  x1={datumL.x}
                                  y1={datumL.y}
                                  x2={datumR.x}
                                  y2={datumR.y}
                                  stroke="#334155"
                                  strokeWidth="0.7"
                                  strokeDasharray="3 2"
                                />
                              </svg>
                            </div>
                            <div className="px-2.5 py-1 bg-slate-950/90 border-t border-slate-800 flex items-center justify-between text-[10px] font-mono text-slate-400">
                              <span>W: {spanXLabel}</span>
                              <span>Total H: {spanYLabel}</span>
                            </div>
                          </div>
                        );
                      })()}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-slate-800 bg-slate-950/60 shrink-0">
                <button
                  type="button"
                  onClick={() => setPendingBondImport(null)}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-300 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    commitImportedFlow(
                      pendingBondImport.flow,
                      pendingBondImport.title,
                      pendingBondImport.mode,
                      pendingBondImport.alignment,
                      pendingBondImport.offsetNm,
                      pendingBondImport.paddingMode
                    );
                    setPendingBondImport(null);
                  }}
                  className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition-colors"
                >
                  Import & Apply
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
