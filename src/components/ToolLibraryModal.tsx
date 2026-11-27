/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  CleanroomTool,
  ProcessStep,
  ProcessStepType,
  ToolCapabilityLink,
} from '../types/microfab';
import {
  PROCESS_MECHANISM_OPTIONS,
  SUB_MECHANISM_OPTIONS,
  TOOL_CATEGORIES,
  getMechanismLabel,
  getSubMechanismLabel,
  getStepMechanismContext,
  getToolMatchLevel,
} from '../lib/toolLibrary';
import {
  Wrench,
  Plus,
  Trash2,
  X,
  Search,
  Copy,
  Check,
  Edit2,
  ArrowRight,
  Thermometer,
  Gauge,
  Zap,
  Clock,
  Wind,
  MapPin,
  Cpu,
  Link2,
} from 'lucide-react';

interface ToolLibraryModalProps {
  tools: CleanroomTool[];
  activeStep?: ProcessStep;
  onUpdateTools: (updatedCustomTools: CleanroomTool[]) => void;
  onApplyToolToStep?: (tool: CleanroomTool, syncSubMechanism?: boolean) => void;
  onClose: () => void;
}

type MechanismFilter = 'all' | 'active-step' | ProcessStepType;

export const ToolLibraryModal: React.FC<ToolLibraryModalProps> = ({
  tools,
  activeStep,
  onUpdateTools,
  onApplyToolToStep,
  onClose,
}) => {
  const activeStepCtx = useMemo(
    () => (activeStep ? getStepMechanismContext(activeStep) : null),
    [activeStep]
  );

  const [selectedId, setSelectedId] = useState<string>(() => {
    if (activeStep?.toolRecipe?.toolId) {
      return activeStep.toolRecipe.toolId;
    }
    if (activeStep) {
      const ctx = getStepMechanismContext(activeStep);
      const exact = tools.find((t) => getToolMatchLevel(t, ctx.mechanism, ctx.subMechanisms) === 'exact');
      if (exact) return exact.id;
      const mech = tools.find((t) => getToolMatchLevel(t, ctx.mechanism, ctx.subMechanisms) !== null);
      if (mech) return mech.id;
    }
    return tools[0]?.id || '';
  });

  const [mechanismFilter, setMechanismFilter] = useState<MechanismFilter>(() =>
    activeStep ? 'active-step' : 'all'
  );
  const [subMechanismFilter, setSubMechanismFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [syncSubMechOnApply, setSyncSubMechOnApply] = useState<boolean>(false);

  // Edit / Create Draft State
  const [editingTool, setEditingTool] = useState<CleanroomTool | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editingTool) {
          setEditingTool(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editingTool, onClose]);

  const selectedTool = useMemo(
    () => tools.find((t) => t.id === selectedId) || tools[0] || null,
    [tools, selectedId]
  );

  const availableSubFilterOptions = useMemo(() => {
    if (mechanismFilter === 'all' || mechanismFilter === 'active-step') return [];
    return SUB_MECHANISM_OPTIONS[mechanismFilter] || [];
  }, [mechanismFilter]);

  const filteredTools = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = tools.filter((tool) => {
      if (mechanismFilter === 'active-step' && activeStepCtx) {
        if (getToolMatchLevel(tool, activeStepCtx.mechanism, activeStepCtx.subMechanisms) === null) {
          return false;
        }
      } else if (mechanismFilter !== 'all' && mechanismFilter !== 'active-step') {
        const subArg = subMechanismFilter !== 'all' ? [subMechanismFilter] : [];
        const level = getToolMatchLevel(tool, mechanismFilter, subArg);
        if (subMechanismFilter !== 'all') {
          if (level === null) return false;
        } else if (!tool.capabilities.some((c) => c.mechanism === mechanismFilter)) {
          return false;
        }
      }

      if (!q) return true;
      const capText = tool.capabilities
        .map((c) => {
          const mechLabel = getMechanismLabel(c.mechanism);
          const subs = (c.subMechanisms || [])
            .map((s) => `${s} ${getSubMechanismLabel(c.mechanism, s)}`)
            .join(' ');
          return `${c.mechanism} ${mechLabel} ${subs}`;
        })
        .join(' ');
      const hay = [
        tool.name,
        tool.vendor || '',
        tool.category,
        tool.bayLocation || '',
        tool.defaultRecipe.gases || '',
        tool.defaultRecipe.toolName || '',
        tool.notes || '',
        capText,
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });

    if (activeStepCtx) {
      list.sort((a, b) => {
        const la = getToolMatchLevel(a, activeStepCtx.mechanism, activeStepCtx.subMechanisms);
        const lb = getToolMatchLevel(b, activeStepCtx.mechanism, activeStepCtx.subMechanisms);
        const rank = (lvl: ReturnType<typeof getToolMatchLevel>) =>
          lvl === 'exact' ? 0 : lvl === 'mechanism' ? 1 : 2;
        const diff = rank(la) - rank(lb);
        if (diff !== 0) return diff;
        return a.name.localeCompare(b.name);
      });
    }
    return list;
  }, [tools, mechanismFilter, subMechanismFilter, searchQuery, activeStepCtx]);

  const handleStartNew = () => {
    const initialMech: ProcessStepType = activeStepCtx?.mechanism || 'deposition';
    const initialSubs =
      activeStepCtx && activeStepCtx.subMechanisms.length > 0
        ? [activeStepCtx.subMechanisms[0]]
        : SUB_MECHANISM_OPTIONS[initialMech]?.[0]
        ? [SUB_MECHANISM_OPTIONS[initialMech][0].value]
        : [];
    const draft: CleanroomTool = {
      id: `tool_custom_${Date.now()}`,
      name: 'Custom Cleanroom Tool',
      vendor: '',
      category: 'Custom',
      bayLocation: '',
      waferSize: '100 / 150 mm',
      capabilities: [
        {
          mechanism: initialMech,
          subMechanisms: initialSubs,
        },
      ],
      defaultRecipe: {
        toolName: 'Custom Cleanroom Tool',
        gases: '',
        power: '',
        pressure: '',
        temperature: '20 °C',
        duration: '',
        targetRate: '',
        inspectionNotes: '',
      },
      notes: '',
      isCustom: true,
    };
    setEditingTool(draft);
    setSelectedId(draft.id);
  };

  const handleDuplicate = (base: CleanroomTool) => {
    const draft: CleanroomTool = {
      ...base,
      id: `tool_custom_${Date.now()}`,
      name: `${base.name} (Custom)`,
      capabilities: base.capabilities.map((c) => ({
        mechanism: c.mechanism,
        subMechanisms: c.subMechanisms ? [...c.subMechanisms] : undefined,
      })),
      defaultRecipe: {
        ...base.defaultRecipe,
        toolName: `${base.defaultRecipe.toolName || base.name} (Custom)`,
      },
      isCustom: true,
    };
    setEditingTool(draft);
  };

  const handleSaveDraft = () => {
    if (!editingTool || !editingTool.name.trim()) return;
    const validCaps = editingTool.capabilities.filter(
      (c, idx, arr) => arr.findIndex((x) => x.mechanism === c.mechanism) === idx
    );
    const cleaned: CleanroomTool = {
      ...editingTool,
      name: editingTool.name.trim(),
      vendor: editingTool.vendor?.trim() || undefined,
      bayLocation: editingTool.bayLocation?.trim() || undefined,
      waferSize: editingTool.waferSize?.trim() || undefined,
      capabilities:
        validCaps.length > 0 ? validCaps : [{ mechanism: 'deposition', subMechanisms: ['PECVD'] }],
      defaultRecipe: {
        ...editingTool.defaultRecipe,
        toolName: editingTool.defaultRecipe.toolName?.trim() || editingTool.name.trim(),
      },
      isCustom: true,
    };
    const customList = tools.filter((t) => t.isCustom);
    const exists = customList.some((t) => t.id === cleaned.id);
    const nextCustom = exists
      ? customList.map((t) => (t.id === cleaned.id ? cleaned : t))
      : [...customList, cleaned];
    onUpdateTools(nextCustom);
    setSelectedId(cleaned.id);
    setEditingTool(null);
  };

  const handleDeleteCustom = (id: string) => {
    const nextCustom = tools.filter((t) => t.isCustom && t.id !== id);
    onUpdateTools(nextCustom);
    if (editingTool?.id === id) setEditingTool(null);
    if (selectedId === id) {
      setSelectedId(tools.find((t) => t.id !== id)?.id || '');
    }
  };

  const toggleDraftMechanism = (mech: ProcessStepType) => {
    if (!editingTool) return;
    const exists = editingTool.capabilities.some((c) => c.mechanism === mech);
    if (exists) {
      if (editingTool.capabilities.length <= 1) return;
      setEditingTool({
        ...editingTool,
        capabilities: editingTool.capabilities.filter((c) => c.mechanism !== mech),
      });
    } else {
      const firstSub = SUB_MECHANISM_OPTIONS[mech]?.[0]?.value;
      const nextCap: ToolCapabilityLink = {
        mechanism: mech,
        subMechanisms: firstSub ? [firstSub] : undefined,
      };
      setEditingTool({
        ...editingTool,
        capabilities: [...editingTool.capabilities, nextCap],
      });
    }
  };

  const toggleDraftSubMechanism = (mech: ProcessStepType, subValue: string) => {
    if (!editingTool) return;
    setEditingTool({
      ...editingTool,
      capabilities: editingTool.capabilities.map((cap) => {
        if (cap.mechanism !== mech) return cap;
        const current = cap.subMechanisms || [];
        const has = current.includes(subValue);
        const nextSubs = has
          ? current.filter((s) => s !== subValue)
          : [...current, subValue];
        return {
          ...cap,
          subMechanisms: nextSubs.length > 0 ? nextSubs : undefined,
        };
      }),
    });
  };

  const setDraftAllSubMechanisms = (mech: ProcessStepType) => {
    if (!editingTool) return;
    setEditingTool({
      ...editingTool,
      capabilities: editingTool.capabilities.map((cap) =>
        cap.mechanism === mech ? { ...cap, subMechanisms: undefined } : cap
      ),
    });
  };

  const inspected = editingTool || selectedTool;
  const inspectedMatchLevel =
    inspected && activeStepCtx
      ? getToolMatchLevel(inspected, activeStepCtx.mechanism, activeStepCtx.subMechanisms)
      : null;

  const canSyncSubMechForInspected = useMemo(() => {
    if (!inspected || !activeStepCtx || inspectedMatchLevel === 'exact') return false;
    const cap = inspected.capabilities.find((c) => c.mechanism === activeStepCtx.mechanism);
    return Boolean(cap && cap.subMechanisms && cap.subMechanisms.length > 0);
  }, [inspected, activeStepCtx, inspectedMatchLevel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-2 sm:p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-5xl max-h-[94dvh] sm:max-h-[88vh] bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl flex flex-col text-slate-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-6 sm:py-4 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-8 h-8 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400 shrink-0">
              <Wrench className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-bold text-white truncate">
                Cleanroom Tool &amp; Equipment Library
              </h2>
              <p className="hidden sm:block text-xs text-slate-400">
                Equipment catalog linked to process mechanisms, sub-mechanisms, and default SOP recipes
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <button
              type="button"
              onClick={handleStartNew}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold shadow-md transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Add Custom Tool</span>
              <span className="sm:hidden">Custom</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              aria-label="Close Tool Library"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Main Body */}
        <div className="flex-1 flex flex-col md:flex-row overflow-y-auto md:overflow-hidden">
          {/* Left: Search, Mechanism/Sub-Mechanism Filters & Tool List */}
          <div className="w-full md:w-[42%] border-b md:border-b-0 md:border-r border-slate-800 flex flex-col max-h-[42dvh] md:max-h-none shrink-0 md:shrink">
            <div className="p-2.5 bg-slate-950/60 border-b border-slate-800 space-y-2">
              <div className="relative flex items-center">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search tool, vendor, PECVD, DRIE, aligner..."
                  className="w-full pl-8 pr-7 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 text-slate-500 hover:text-slate-200"
                    aria-label="Clear search"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Mechanism & Sub-Mechanism Filter Controls */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px]">
                <select
                  value={mechanismFilter}
                  onChange={(e) => {
                    setMechanismFilter(e.target.value as MechanismFilter);
                    setSubMechanismFilter('all');
                  }}
                  aria-label="Filter tools by process mechanism"
                  className="w-full px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 focus:outline-none focus:border-sky-500"
                >
                  {activeStepCtx && (
                    <option value="active-step">
                      Active Step ({getMechanismLabel(activeStepCtx.mechanism, true)}
                      {activeStepCtx.primarySubLabel ? ` · ${activeStepCtx.primarySubLabel}` : ''})
                    </option>
                  )}
                  <option value="all">All Mechanisms ({tools.length})</option>
                  {PROCESS_MECHANISM_OPTIONS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.shortLabel}
                    </option>
                  ))}
                </select>

                <select
                  value={subMechanismFilter}
                  disabled={availableSubFilterOptions.length === 0}
                  onChange={(e) => setSubMechanismFilter(e.target.value)}
                  aria-label="Filter tools by sub-mechanism"
                  className="w-full px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 disabled:opacity-45 focus:outline-none focus:border-sky-500"
                >
                  <option value="all">
                    {availableSubFilterOptions.length === 0
                      ? 'All Sub-Mechanisms'
                      : `All (${availableSubFilterOptions.length}) Sub-Types`}
                  </option>
                  {availableSubFilterOptions.map((sub) => (
                    <option key={sub.value} value={sub.value}>
                      {sub.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5">
              {filteredTools.length === 0 ? (
                <div className="text-center py-8 px-3 text-xs text-slate-500 space-y-2">
                  <p>No tools match the current filter.</p>
                  {mechanismFilter !== 'all' && (
                    <button
                      type="button"
                      onClick={() => {
                        setMechanismFilter('all');
                        setSubMechanismFilter('all');
                        setSearchQuery('');
                      }}
                      className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-sky-300 text-[11px] font-medium"
                    >
                      Show All Tools
                    </button>
                  )}
                </div>
              ) : (
                filteredTools.map((tool) => {
                  const isSelected = !editingTool && selectedTool?.id === tool.id;
                  const matchLevel = activeStepCtx
                    ? getToolMatchLevel(tool, activeStepCtx.mechanism, activeStepCtx.subMechanisms)
                    : null;
                  const isLinkedToActive = activeStep?.toolRecipe?.toolId === tool.id;

                  return (
                    <div
                      key={tool.id}
                      onClick={() => {
                        setEditingTool(null);
                        setSelectedId(tool.id);
                      }}
                      className={`p-2.5 rounded-xl text-xs cursor-pointer border transition-colors ${
                        isSelected
                          ? 'bg-sky-950/45 border-sky-500/80 text-white shadow-md'
                          : 'bg-slate-950/40 border-slate-800 hover:bg-slate-800/40 text-slate-300'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-semibold truncate">{tool.name}</span>
                            {tool.isCustom && (
                              <span className="px-1.5 py-0.2 rounded bg-sky-500/20 border border-sky-500/40 text-[9px] font-mono uppercase text-sky-300">
                                Custom
                              </span>
                            )}
                            {isLinkedToActive && (
                              <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 border border-emerald-500/40 text-[9px] font-mono uppercase text-emerald-300">
                                Linked
                              </span>
                            )}
                            {!isLinkedToActive && matchLevel === 'exact' && (
                              <span className="px-1.5 py-0.2 rounded bg-cyan-500/15 border border-cyan-500/35 text-[9px] font-mono text-cyan-300">
                                Match
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                            {[tool.vendor, tool.bayLocation].filter(Boolean).join(' · ') || tool.category}
                          </div>
                        </div>

                        {tool.isCustom && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteCustom(tool.id);
                            }}
                            className="p-1 text-slate-500 hover:text-rose-400 transition-colors shrink-0"
                            title="Delete custom tool"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      {/* Linked Mechanism / Sub-Mechanism Chips */}
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {tool.capabilities.map((cap) => {
                          const subs = cap.subMechanisms;
                          const label =
                            subs && subs.length > 0
                              ? `${getMechanismLabel(cap.mechanism, true)}: ${subs
                                  .map((s) => getSubMechanismLabel(cap.mechanism, s))
                                  .join(', ')}`
                              : `${getMechanismLabel(cap.mechanism, true)}: All`;
                          const isMechMatch = activeStepCtx?.mechanism === cap.mechanism;
                          return (
                            <span
                              key={cap.mechanism}
                              className={`px-1.5 py-0.5 rounded border font-mono text-[10px] truncate max-w-full ${
                                isMechMatch
                                  ? 'bg-sky-500/15 border-sky-500/40 text-sky-200'
                                  : 'bg-slate-900 border-slate-800 text-slate-400'
                              }`}
                              title={label}
                            >
                              {label}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right: Tool Inspector / Custom Tool Editor */}
          <div className="w-full md:w-[58%] p-3.5 sm:p-5 md:overflow-y-auto bg-slate-950/40 space-y-4">
            {inspected ? (
              <>
                {/* Top Action / Title Header */}
                <div className="flex flex-wrap items-start justify-between gap-2 pb-3 border-b border-slate-800">
                  <div className="min-w-0">
                    {editingTool ? (
                      <span className="text-[11px] font-bold uppercase tracking-wider text-sky-400 block mb-1">
                        {tools.some((t) => t.id === editingTool.id)
                          ? 'Editing Custom Cleanroom Tool'
                          : 'Creating Custom Cleanroom Tool'}
                      </span>
                    ) : (
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm sm:text-base font-bold text-white">
                          {inspected.name}
                        </h3>
                        <span className="px-2 py-0.5 rounded bg-sky-500/15 border border-sky-500/30 text-[10px] font-mono text-sky-300">
                          {inspected.category}
                        </span>
                      </div>
                    )}
                    {!editingTool && (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400 mt-1">
                        {inspected.vendor && (
                          <span className="flex items-center gap-1">
                            <Cpu className="w-3 h-3 text-slate-500" />
                            <span>{inspected.vendor}</span>
                          </span>
                        )}
                        {inspected.bayLocation && (
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3 h-3 text-slate-500" />
                            <span>{inspected.bayLocation}</span>
                          </span>
                        )}
                        {inspected.waferSize && (
                          <span className="font-mono text-[11px] text-slate-400">
                            {inspected.waferSize}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                    {editingTool ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setEditingTool(null)}
                          className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleSaveDraft}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Save Tool</span>
                        </button>
                      </>
                    ) : (
                      <>
                        {inspected.isCustom ? (
                          <button
                            type="button"
                            onClick={() =>
                              setEditingTool({
                                ...inspected,
                                capabilities: inspected.capabilities.map((c) => ({
                                  mechanism: c.mechanism,
                                  subMechanisms: c.subMechanisms ? [...c.subMechanisms] : undefined,
                                })),
                                defaultRecipe: { ...inspected.defaultRecipe },
                              })
                            }
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-medium"
                          >
                            <Edit2 className="w-3.5 h-3.5 text-sky-400" />
                            <span>Edit</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleDuplicate(inspected)}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-medium"
                            title="Clone into an editable custom tool"
                          >
                            <Copy className="w-3.5 h-3.5 text-sky-400" />
                            <span>Customize</span>
                          </button>
                        )}
                        {onApplyToolToStep && activeStep && (
                          <button
                            type="button"
                            onClick={() => {
                              onApplyToolToStep(inspected, syncSubMechOnApply);
                              onClose();
                            }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold shadow-md transition-colors"
                          >
                            <span>
                              {activeStep.toolRecipe?.toolId === inspected.id
                                ? 'Re-apply SOP'
                                : 'Link to Step'}
                            </span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* Edit Mode Form */}
                {editingTool ? (
                  <div className="space-y-4 text-xs">
                    {/* Metadata */}
                    <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2.5">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <div>
                          <label className="block text-[11px] text-slate-400 mb-1">Tool Name</label>
                          <input
                            type="text"
                            value={editingTool.name}
                            onChange={(e) =>
                              setEditingTool({ ...editingTool, name: e.target.value })
                            }
                            className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white focus:outline-none focus:border-sky-500"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-400 mb-1">Vendor / OEM</label>
                          <input
                            type="text"
                            value={editingTool.vendor || ''}
                            onChange={(e) =>
                              setEditingTool({ ...editingTool, vendor: e.target.value })
                            }
                            placeholder="e.g. Oxford Instruments"
                            className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-slate-200 focus:outline-none focus:border-sky-500"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                        <div>
                          <label className="block text-[11px] text-slate-400 mb-1">Category</label>
                          <select
                            value={editingTool.category}
                            onChange={(e) =>
                              setEditingTool({ ...editingTool, category: e.target.value })
                            }
                            className="w-full px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-slate-200 focus:outline-none focus:border-sky-500"
                          >
                            {TOOL_CATEGORIES.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-400 mb-1">Cleanroom Bay</label>
                          <input
                            type="text"
                            value={editingTool.bayLocation || ''}
                            onChange={(e) =>
                              setEditingTool({ ...editingTool, bayLocation: e.target.value })
                            }
                            placeholder="e.g. Bay 2 · Dry Etch"
                            className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-slate-200 focus:outline-none focus:border-sky-500"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-400 mb-1">Wafer Size</label>
                          <input
                            type="text"
                            value={editingTool.waferSize || ''}
                            onChange={(e) =>
                              setEditingTool({ ...editingTool, waferSize: e.target.value })
                            }
                            placeholder="e.g. 100 / 150 mm"
                            className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-slate-200 focus:outline-none focus:border-sky-500"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Linked Mechanisms & Sub-Mechanisms Selector */}
                    <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-sky-300 flex items-center gap-1.5">
                          <Link2 className="w-3.5 h-3.5 text-sky-400" />
                          <span>Linked Process Mechanisms &amp; Sub-Mechanisms</span>
                        </span>
                      </div>

                      {/* Mechanism Checkboxes */}
                      <div className="flex flex-wrap gap-1.5">
                        {PROCESS_MECHANISM_OPTIONS.map((mech) => {
                          const enabled = editingTool.capabilities.some(
                            (c) => c.mechanism === mech.value
                          );
                          return (
                            <button
                              key={mech.value}
                              type="button"
                              onClick={() => toggleDraftMechanism(mech.value)}
                              className={`px-2 py-1 rounded-md border text-[11px] font-medium transition-colors ${
                                enabled
                                  ? 'bg-sky-600/25 border-sky-500 text-sky-200'
                                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                              }`}
                            >
                              {mech.shortLabel}
                            </button>
                          );
                        })}
                      </div>

                      {/* Per-Mechanism Sub-Mechanism Pickers */}
                      <div className="space-y-2 pt-1">
                        {editingTool.capabilities.map((cap) => {
                          const subOpts = SUB_MECHANISM_OPTIONS[cap.mechanism] || [];
                          const isAll = !cap.subMechanisms || cap.subMechanisms.length === 0;
                          return (
                            <div
                              key={cap.mechanism}
                              className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 space-y-1.5"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold text-slate-200">
                                  {getMechanismLabel(cap.mechanism)}
                                </span>
                                {subOpts.length > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => setDraftAllSubMechanisms(cap.mechanism)}
                                    className={`px-1.5 py-0.5 rounded border text-[10px] font-mono transition-colors ${
                                      isAll
                                        ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                                        : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
                                    }`}
                                  >
                                    All Sub-Mechanisms
                                  </button>
                                )}
                              </div>
                              {subOpts.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                  {subOpts.map((sub) => {
                                    const active = cap.subMechanisms?.includes(sub.value) ?? false;
                                    return (
                                      <button
                                        key={sub.value}
                                        type="button"
                                        onClick={() =>
                                          toggleDraftSubMechanism(cap.mechanism, sub.value)
                                        }
                                        className={`px-2 py-0.5 rounded border text-[10.5px] font-mono transition-colors ${
                                          active
                                            ? 'bg-cyan-500/20 border-cyan-500/60 text-cyan-200'
                                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                                        }`}
                                      >
                                        {sub.label}
                                      </button>
                                    );
                                  })}
                                </div>
                              ) : (
                                <p className="text-[11px] text-slate-500">
                                  Matches all operations for this mechanism.
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Default SOP Parameters */}
                    <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2.5">
                      <span className="font-semibold text-slate-200 block">
                        Default Tool Recipe / SOP Parameters
                      </span>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        <div>
                          <label className="block text-[11px] text-slate-400 mb-1">Temperature</label>
                          <input
                            type="text"
                            value={editingTool.defaultRecipe.temperature || ''}
                            onChange={(e) =>
                              setEditingTool({
                                ...editingTool,
                                defaultRecipe: {
                                  ...editingTool.defaultRecipe,
                                  temperature: e.target.value,
                                },
                              })
                            }
                            placeholder="e.g. 300 °C"
                            className="w-full px-2 py-1 rounded-lg bg-slate-950 border border-slate-700 text-slate-200 font-mono text-[11px]"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-400 mb-1">Pressure</label>
                          <input
                            type="text"
                            value={editingTool.defaultRecipe.pressure || ''}
                            onChange={(e) =>
                              setEditingTool({
                                ...editingTool,
                                defaultRecipe: {
                                  ...editingTool.defaultRecipe,
                                  pressure: e.target.value,
                                },
                              })
                            }
                            placeholder="e.g. 20 mTorr"
                            className="w-full px-2 py-1 rounded-lg bg-slate-950 border border-slate-700 text-slate-200 font-mono text-[11px]"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-400 mb-1">Power / Force</label>
                          <input
                            type="text"
                            value={editingTool.defaultRecipe.power || ''}
                            onChange={(e) =>
                              setEditingTool({
                                ...editingTool,
                                defaultRecipe: {
                                  ...editingTool.defaultRecipe,
                                  power: e.target.value,
                                },
                              })
                            }
                            placeholder="e.g. 200 W RF"
                            className="w-full px-2 py-1 rounded-lg bg-slate-950 border border-slate-700 text-slate-200 font-mono text-[11px]"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-400 mb-1">Duration</label>
                          <input
                            type="text"
                            value={editingTool.defaultRecipe.duration || ''}
                            onChange={(e) =>
                              setEditingTool({
                                ...editingTool,
                                defaultRecipe: {
                                  ...editingTool.defaultRecipe,
                                  duration: e.target.value,
                                },
                              })
                            }
                            placeholder="e.g. 60 s"
                            className="w-full px-2 py-1 rounded-lg bg-slate-950 border border-slate-700 text-slate-200 font-mono text-[11px]"
                          />
                        </div>
                        <div className="col-span-2">
                          <label className="block text-[11px] text-slate-400 mb-1">
                            Target Rate / Dose
                          </label>
                          <input
                            type="text"
                            value={editingTool.defaultRecipe.targetRate || ''}
                            onChange={(e) =>
                              setEditingTool({
                                ...editingTool,
                                defaultRecipe: {
                                  ...editingTool.defaultRecipe,
                                  targetRate: e.target.value,
                                },
                              })
                            }
                            placeholder="e.g. 50 nm/min"
                            className="w-full px-2 py-1 rounded-lg bg-slate-950 border border-slate-700 text-slate-200 font-mono text-[11px]"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-400 mb-1">
                          Gases / Chemistry / Source
                        </label>
                        <input
                          type="text"
                          value={editingTool.defaultRecipe.gases || ''}
                          onChange={(e) =>
                            setEditingTool({
                              ...editingTool,
                              defaultRecipe: {
                                ...editingTool.defaultRecipe,
                                gases: e.target.value,
                              },
                            })
                          }
                          placeholder="e.g. SiH4: 10 sccm, N2O: 710 sccm"
                          className="w-full px-2 py-1 rounded-lg bg-slate-950 border border-slate-700 text-slate-200 font-mono text-[11px]"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-400 mb-1">
                          Default Metrology / Inspection Checkpoint
                        </label>
                        <input
                          type="text"
                          value={editingTool.defaultRecipe.inspectionNotes || ''}
                          onChange={(e) =>
                            setEditingTool({
                              ...editingTool,
                              defaultRecipe: {
                                ...editingTool.defaultRecipe,
                                inspectionNotes: e.target.value,
                              },
                            })
                          }
                          placeholder="e.g. Check thickness via ellipsometry..."
                          className="w-full px-2 py-1 rounded-lg bg-slate-950 border border-slate-700 text-slate-200 text-[11px]"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-400 mb-1">Tool Notes</label>
                        <textarea
                          rows={2}
                          value={editingTool.notes || ''}
                          onChange={(e) =>
                            setEditingTool({ ...editingTool, notes: e.target.value })
                          }
                          placeholder="Tool capabilities, contamination rules, wafer limits..."
                          className="w-full px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-slate-200 text-[11px]"
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Inspector Mode */
                  <>
                    {/* Active Step Compatibility Notice */}
                    {activeStepCtx && (
                      <div
                        className={`p-2.5 rounded-xl border text-xs flex flex-wrap items-center justify-between gap-2 ${
                          inspectedMatchLevel === 'exact'
                            ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-200'
                            : inspectedMatchLevel === 'mechanism'
                            ? 'bg-sky-950/35 border-sky-500/40 text-sky-200'
                            : 'bg-amber-950/30 border-amber-500/40 text-amber-200'
                        }`}
                      >
                        <span className="leading-snug">
                          {inspectedMatchLevel === 'exact' ? (
                            <>
                              Exact match for active step:{' '}
                              <strong className="font-semibold">
                                {getMechanismLabel(activeStepCtx.mechanism, true)}
                                {activeStepCtx.primarySubLabel
                                  ? ` · ${activeStepCtx.primarySubLabel}`
                                  : ''}
                              </strong>
                            </>
                          ) : inspectedMatchLevel === 'mechanism' ? (
                            <>
                              Compatible with{' '}
                              <strong className="font-semibold">
                                {getMechanismLabel(activeStepCtx.mechanism, true)}
                              </strong>{' '}
                              (different sub-mechanism than{' '}
                              <span className="font-mono">
                                {activeStepCtx.primarySubLabel || 'current'}
                              </span>
                              )
                            </>
                          ) : (
                            <>
                              Not linked to active step mechanism (
                              <strong className="font-semibold">
                                {getMechanismLabel(activeStepCtx.mechanism, true)}
                              </strong>
                              ) — linking will still copy SOP parameters.
                            </>
                          )}
                        </span>

                        {canSyncSubMechForInspected && (
                          <label className="flex items-center gap-1.5 text-[11px] cursor-pointer shrink-0">
                            <input
                              type="checkbox"
                              checked={syncSubMechOnApply}
                              onChange={(e) => setSyncSubMechOnApply(e.target.checked)}
                              className="rounded bg-slate-800 border-slate-700 text-sky-500 focus:ring-0"
                            />
                            <span>Switch step sub-mechanism on link</span>
                          </label>
                        )}
                      </div>
                    )}

                    {/* Linked Mechanisms & Sub-Mechanisms Breakdown */}
                    <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2.5">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-sky-300">
                        <Link2 className="w-3.5 h-3.5 text-sky-400" />
                        <span>Linked Process Mechanisms &amp; Sub-Mechanisms</span>
                      </div>

                      <div className="space-y-2">
                        {inspected.capabilities.map((cap) => {
                          const isMechActive = activeStepCtx?.mechanism === cap.mechanism;
                          const subOpts = cap.subMechanisms || [];
                          return (
                            <div
                              key={cap.mechanism}
                              className={`p-2.5 rounded-lg border text-xs ${
                                isMechActive
                                  ? 'bg-sky-950/35 border-sky-500/45'
                                  : 'bg-slate-950/70 border-slate-800'
                              }`}
                            >
                              <div className="font-semibold text-slate-100 mb-1.5">
                                {getMechanismLabel(cap.mechanism)}
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {subOpts.length > 0 ? (
                                  subOpts.map((sub) => {
                                    const isSubActive =
                                      isMechActive &&
                                      (activeStepCtx?.subMechanisms.includes(sub) ?? false);
                                    return (
                                      <span
                                        key={sub}
                                        className={`px-2 py-0.5 rounded border font-mono text-[11px] ${
                                          isSubActive
                                            ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-200 font-semibold'
                                            : 'bg-slate-900 border-slate-700/80 text-slate-300'
                                        }`}
                                      >
                                        {getSubMechanismLabel(cap.mechanism, sub)}
                                      </span>
                                    );
                                  })
                                ) : (
                                  <span className="px-2 py-0.5 rounded border bg-slate-900 border-slate-700/80 text-slate-300 font-mono text-[11px]">
                                    All Sub-Mechanisms
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Default Recipe / SOP Specifications */}
                    <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 space-y-3 text-xs">
                      <span className="font-semibold text-slate-200 block">
                        Baseline SOP Parameters
                      </span>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {inspected.defaultRecipe.temperature && (
                          <div className="p-2 rounded-lg bg-slate-950/70 border border-slate-800/80">
                            <div className="flex items-center gap-1 text-[10px] text-slate-400 mb-0.5">
                              <Thermometer className="w-3 h-3 text-rose-400" />
                              <span>Temperature</span>
                            </div>
                            <div className="font-mono text-slate-100">
                              {inspected.defaultRecipe.temperature}
                            </div>
                          </div>
                        )}
                        {inspected.defaultRecipe.pressure && (
                          <div className="p-2 rounded-lg bg-slate-950/70 border border-slate-800/80">
                            <div className="flex items-center gap-1 text-[10px] text-slate-400 mb-0.5">
                              <Gauge className="w-3 h-3 text-sky-400" />
                              <span>Pressure</span>
                            </div>
                            <div className="font-mono text-slate-100">
                              {inspected.defaultRecipe.pressure}
                            </div>
                          </div>
                        )}
                        {inspected.defaultRecipe.power && (
                          <div className="p-2 rounded-lg bg-slate-950/70 border border-slate-800/80">
                            <div className="flex items-center gap-1 text-[10px] text-slate-400 mb-0.5">
                              <Zap className="w-3 h-3 text-amber-400" />
                              <span>Power / Force</span>
                            </div>
                            <div className="font-mono text-slate-100">
                              {inspected.defaultRecipe.power}
                            </div>
                          </div>
                        )}
                        {(inspected.defaultRecipe.duration || inspected.defaultRecipe.targetRate) && (
                          <div className="p-2 rounded-lg bg-slate-950/70 border border-slate-800/80">
                            <div className="flex items-center gap-1 text-[10px] text-slate-400 mb-0.5">
                              <Clock className="w-3 h-3 text-emerald-400" />
                              <span>
                                {inspected.defaultRecipe.targetRate ? 'Target Rate' : 'Duration'}
                              </span>
                            </div>
                            <div className="font-mono text-slate-100">
                              {inspected.defaultRecipe.targetRate || inspected.defaultRecipe.duration}
                            </div>
                          </div>
                        )}
                      </div>

                      {inspected.defaultRecipe.gases && (
                        <div className="p-2 rounded-lg bg-slate-950/70 border border-slate-800/80">
                          <div className="flex items-center gap-1 text-[10px] text-slate-400 mb-0.5">
                            <Wind className="w-3 h-3 text-teal-400" />
                            <span>Gases / Chemistry / Source</span>
                          </div>
                          <div className="font-mono text-slate-100">
                            {inspected.defaultRecipe.gases}
                          </div>
                        </div>
                      )}

                      {inspected.defaultRecipe.inspectionNotes && (
                        <div className="p-2 rounded-lg bg-slate-950/70 border border-slate-800/80">
                          <div className="text-[10px] text-slate-400 mb-0.5">
                            Metrology &amp; Inspection Checkpoint
                          </div>
                          <div className="text-slate-200 leading-relaxed">
                            {inspected.defaultRecipe.inspectionNotes}
                          </div>
                        </div>
                      )}

                      {inspected.notes && (
                        <p className="text-[11px] text-slate-400 leading-relaxed pt-1 border-t border-slate-800/70">
                          {inspected.notes}
                        </p>
                      )}
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-slate-500">
                Select a cleanroom tool or click &ldquo;Add Custom Tool&rdquo;.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
