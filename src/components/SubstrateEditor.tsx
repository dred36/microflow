/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { ProcessFlow, SubstrateLayer, VariableUnit } from '../types/microfab';
import { getMaterialById } from '../lib/materials';
import { ThicknessUnit, formatThickness, formatCleanDecimal, getUnitLabel } from '../lib/units';
import { resolveFlowParameters } from '../lib/variableUtils';
import {
  ParamBindingBadge,
  ParamBindingPanel,
  ParametricThicknessInput,
} from './ParamBindingControl';
import {
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Copy,
} from 'lucide-react';

interface SubstrateEditorProps {
  flow: ProcessFlow;
  thicknessUnit?: ThicknessUnit;
  onUpdateFlow: (updated: ProcessFlow) => void;
  onOpenMaterialsModal: () => void;
  onCreateVariable?: (name: string, value: number, unit: VariableUnit, description?: string) => void;
  onOpenVariablesModal?: () => void;
}

export const SUBSTRATE_PRESETS: {
  name: string;
  description: string;
  layers: Omit<SubstrateLayer, 'id'>[];
}[] = [
  {
    name: 'Bare Silicon <100> Wafer',
    description: 'Standard single-crystal p-type Cz silicon substrate',
    layers: [
      {
        name: 'Bulk Silicon <100>',
        materialId: 'mat_si_sub',
        thickness: 3000,
      },
    ],
  },
  {
    name: 'Silicon-on-Insulator (SOI)',
    description: 'Bulk silicon handle + 1.0 µm buried oxide (BOX) + 350 nm device silicon',
    layers: [
      {
        name: 'Bulk Silicon Handle',
        materialId: 'mat_si_sub',
        thickness: 2500,
      },
      {
        name: 'Buried Oxide (BOX)',
        materialId: 'mat_sio2_thermal',
        thickness: 1000,
      },
      {
        name: 'Device Silicon Layer',
        materialId: 'mat_poly_si',
        thickness: 350,
      },
    ],
  },
  {
    name: 'Thermal Oxidized Silicon',
    description: 'Silicon wafer with 500 nm high-quality dry thermal isolation oxide',
    layers: [
      {
        name: 'Bulk Silicon <100>',
        materialId: 'mat_si_sub',
        thickness: 3000,
      },
      {
        name: 'Thermal Oxide (SiO₂)',
        materialId: 'mat_sio2_thermal',
        thickness: 500,
      },
    ],
  },
  {
    name: 'Silicon Nitride Membrane Substrate',
    description: 'Silicon wafer pre-coated with 200 nm low-stress LPCVD Si₃N₄',
    layers: [
      {
        name: 'Bulk Silicon <100>',
        materialId: 'mat_si_sub',
        thickness: 3000,
      },
      {
        name: 'Low-Stress Silicon Nitride',
        materialId: 'mat_si3n4',
        thickness: 200,
      },
    ],
  },
  {
    name: 'Quartz / Fused Silica Slide',
    description: 'Optically transparent amorphous quartz bulk substrate',
    layers: [
      {
        name: 'Bulk Fused Silica (SiO₂)',
        materialId: 'mat_quartz',
        thickness: 3000,
      },
    ],
  },
  {
    name: 'Metallized Wafer (Ti/Pt Electrode)',
    description: 'Silicon + 300 nm SiO2 + 20 nm Ti adhesion + 150 nm Pt bottom electrode',
    layers: [
      {
        name: 'Bulk Silicon <100>',
        materialId: 'mat_si_sub',
        thickness: 2500,
      },
      {
        name: 'Isolation Oxide',
        materialId: 'mat_sio2_thermal',
        thickness: 300,
      },
      {
        name: 'Ti Adhesion Layer',
        materialId: 'mat_ti',
        thickness: 25,
      },
      {
        name: 'Platinum Electrode',
        materialId: 'mat_pt',
        thickness: 150,
      },
    ],
  },
];

export const SubstrateEditor: React.FC<SubstrateEditorProps> = ({
  flow,
  thicknessUnit = 'nm',
  onUpdateFlow,
  onOpenMaterialsModal,
  onCreateVariable,
  onOpenVariablesModal,
}) => {
  const [waferBindOpen, setWaferBindOpen] = useState(false);
  const formatWidthUm = (widthNm: number): string =>
    formatCleanDecimal(widthNm / 1000, 3);
  const [isWidthFocused, setIsWidthFocused] = useState(false);
  const [widthDraft, setWidthDraft] = useState<string>(() =>
    formatWidthUm(flow.substrateWidth)
  );
  const variables = flow.variables || [];

  useEffect(() => {
    if (!isWidthFocused) {
      setWidthDraft(formatWidthUm(flow.substrateWidth));
    }
  }, [flow.substrateWidth, isWidthFocused]);

  const layers = flow.substrateLayers || [
    {
      id: 'sub_default',
      name: 'Bulk Silicon <100>',
      materialId: flow.substrateMaterialId || 'mat_si_sub',
      thickness: flow.substrateThickness || 3000,
    },
  ];

  const totalThickness = layers.reduce((acc, l) => acc + (l.thickness || 0), 0);

  const handleUpdateLayers = (updatedLayers: SubstrateLayer[]) => {
    onUpdateFlow(
      resolveFlowParameters({
        ...flow,
        substrateLayers: updatedLayers,
        substrateThickness: updatedLayers.reduce((acc, l) => acc + (l.thickness || 0), 0),
        substrateMaterialId: updatedLayers[0]?.materialId || 'mat_si_sub',
      })
    );
  };

  const handleAddLayer = () => {
    const newLayer: SubstrateLayer = {
      id: `sub_layer_${Date.now()}`,
      name: `Substrate Film #${layers.length + 1}`,
      materialId: 'mat_sio2_thermal',
      thickness: 300,
    };
    // Add on top of stack
    handleUpdateLayers([...layers, newLayer]);
  };

  const handleUpdateLayer = (idx: number, patch: Partial<SubstrateLayer>) => {
    const updated = layers.map((l, i) => (i === idx ? { ...l, ...patch } : l));
    handleUpdateLayers(updated);
  };

  const handleDeleteLayer = (idx: number) => {
    if (layers.length <= 1) return;
    const updated = layers.filter((_, i) => i !== idx);
    handleUpdateLayers(updated);
  };

  const handleMoveLayer = (idx: number, direction: 'up' | 'down') => {
    const targetIdx = direction === 'up' ? idx + 1 : idx - 1; // 'up' in stack means towards top surface
    if (targetIdx < 0 || targetIdx >= layers.length) return;
    const updated = [...layers];
    const temp = updated[idx];
    updated[idx] = updated[targetIdx];
    updated[targetIdx] = temp;
    handleUpdateLayers(updated);
  };

  const handleDuplicateLayer = (idx: number) => {
    const original = layers[idx];
    const cloned: SubstrateLayer = {
      ...original,
      id: `sub_layer_${Date.now()}`,
      name: `${original.name || 'Layer'} (Copy)`,
    };
    const updated = [...layers];
    updated.splice(idx + 1, 0, cloned);
    handleUpdateLayers(updated);
  };

  const handleLoadPreset = (preset: typeof SUBSTRATE_PRESETS[0]) => {
    const newLayers: SubstrateLayer[] = preset.layers.map((l, i) => ({
      ...l,
      id: `sub_layer_${Date.now()}_${i}`,
    }));
    handleUpdateLayers(newLayers);
  };

  const handleWidthChange = (valUm: number) => {
    const clamped = Math.max(1, Math.min(1000, valUm));
    onUpdateFlow({
      ...flow,
      substrateWidth: Math.round(clamped * 1000),
    });
  };

  return (
    <div className="flex flex-col h-full min-w-0 bg-slate-900 text-slate-200">
      {/* Editor Header */}
      <div className="px-2.5 py-2 border-b border-slate-800 shrink-0">
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[9.5px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 shrink-0">
              Substrate
            </span>
            <span className="text-[10.5px] text-slate-400 font-mono tabular-nums shrink-0">
              {layers.length} {layers.length === 1 ? 'Layer' : 'Layers'}
            </span>
          </div>

          <div className="text-[11px] font-mono text-sky-400 font-semibold tabular-nums shrink-0">
            {formatThickness(totalThickness, thicknessUnit)} total
          </div>
        </div>

        <h2 className="text-xs font-bold text-white tracking-wide leading-tight truncate">
          Multi-Layer Substrate Architecture
        </h2>
        <p className="text-[10px] text-slate-400 leading-tight mt-0.5 truncate" title="Define the base wafer stack (e.g. bulk handle, buried oxide, SOI device layer) prior to Step 1.">
          Base wafer stack prior to Step 1.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5">
        {/* Process Flow Description */}
        <div className="p-2 rounded-lg bg-slate-950/70 border border-slate-800 space-y-1">
          <div className="flex items-center justify-between text-[11px]">
            <label htmlFor="flow-description-input" className="font-semibold text-slate-300">
              Flow Description
            </label>
            <span className="text-[9.5px] text-slate-500">Shown on Import &amp; SOP</span>
          </div>
          <textarea
            id="flow-description-input"
            rows={2}
            value={flow.description || ''}
            onChange={(e) =>
              onUpdateFlow({
                ...flow,
                description: e.target.value,
              })
            }
            placeholder="Describe what this flow fabricates, key targets, or notes..."
            className="w-full px-2 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-100 placeholder-slate-500 text-[11px] leading-snug focus:outline-none focus:border-sky-500 resize-y"
          />
        </div>

        {/* Wafer Width Setting */}
        <div className="p-2 rounded-lg bg-slate-950/70 border border-slate-800 space-y-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-semibold text-slate-300">Wafer Slice Width</span>
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-sky-400 font-semibold tabular-nums">
                {(flow.substrateWidth / 1000).toFixed(1)} µm
              </span>
              <ParamBindingBadge
                expression={flow.paramBindings?.substrateWidth}
                isOpen={waferBindOpen}
                onToggle={() => setWaferBindOpen((v) => !v)}
                compact
              />
            </div>
          </div>

          {flow.paramBindings?.substrateWidth ? (
            <button
              type="button"
              onClick={() => setWaferBindOpen((v) => !v)}
              className="w-full flex items-center justify-between px-2 py-1 rounded-md bg-violet-950/35 border border-violet-500/50 text-[11px] font-mono text-violet-200 hover:border-violet-400"
            >
              <span>{(flow.substrateWidth / 1000).toFixed(2)} µm</span>
              <span className="text-[10px] text-violet-300 truncate">
                = {flow.paramBindings.substrateWidth}
              </span>
            </button>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min="1"
                  max="1000"
                  step="any"
                  value={isWidthFocused ? widthDraft : formatWidthUm(flow.substrateWidth)}
                  onFocus={(e) => {
                    setIsWidthFocused(true);
                    setWidthDraft(formatWidthUm(flow.substrateWidth));
                    e.target.select();
                  }}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setWidthDraft(raw);
                    const parsed = parseFloat(raw);
                    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 1000) {
                      handleWidthChange(parsed);
                    }
                  }}
                  onBlur={() => {
                    const parsed = parseFloat(widthDraft);
                    if (Number.isFinite(parsed)) {
                      handleWidthChange(parsed);
                      const clamped = Math.max(1, Math.min(1000, parsed));
                      setWidthDraft(formatCleanDecimal(clamped, 3));
                    } else {
                      setWidthDraft(formatWidthUm(flow.substrateWidth));
                    }
                    setIsWidthFocused(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      (e.target as HTMLInputElement).blur();
                    } else if (e.key === 'Escape') {
                      setWidthDraft(formatWidthUm(flow.substrateWidth));
                      setIsWidthFocused(false);
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  className="w-20 px-2 py-0.5 rounded-md bg-slate-900 border border-slate-700 text-slate-100 font-mono text-[11px] tabular-nums focus:outline-none focus:border-sky-500"
                />
                <span className="text-[11px] text-slate-400">µm</span>
              </div>

              {/* Quick presets */}
              <div className="grid grid-cols-6 gap-1">
                {[5, 10, 20, 50, 100, 500].map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => handleWidthChange(w)}
                    className={`py-0.5 rounded text-[10px] font-mono tabular-nums transition-colors ${
                      flow.substrateWidth === w * 1000
                        ? 'bg-sky-600 text-white'
                        : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {w}µm
                  </button>
                ))}
              </div>
            </div>
          )}

          {waferBindOpen && (
            <ParamBindingPanel
              expression={flow.paramBindings?.substrateWidth}
              variables={variables}
              waferWidth={flow.substrateWidth}
              currentValue={flow.substrateWidth}
              unit="um"
              suggestedVarName="wafer_w"
              targetLabel="Wafer Slice Width"
              onChangeExpression={(expr) => {
                const nextBindings = { ...(flow.paramBindings || {}) };
                if (expr) {
                  nextBindings.substrateWidth = expr;
                } else {
                  delete nextBindings.substrateWidth;
                }
                onUpdateFlow(
                  resolveFlowParameters({
                    ...flow,
                    paramBindings:
                      Object.keys(nextBindings).length > 0 ? nextBindings : undefined,
                  })
                );
              }}
              onCreateVariable={onCreateVariable}
              onCreateAndBind={(name, value, unit, description) => {
                const newVar = {
                  id: `var_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                  name,
                  value,
                  unit,
                  description,
                };
                onUpdateFlow(
                  resolveFlowParameters({
                    ...flow,
                    variables: [...variables, newVar],
                    paramBindings: {
                      ...(flow.paramBindings || {}),
                      substrateWidth: name,
                    },
                  })
                );
              }}
              onOpenVariablesModal={onOpenVariablesModal}
              onClose={() => setWaferBindOpen(false)}
            />
          )}
        </div>

        {/* Visual Layer Stack Bar Preview */}
        <div className="p-2 rounded-lg bg-slate-950/70 border border-slate-800 space-y-1.5">
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide block">
            Stack Preview (Top → Bottom)
          </span>

          <div className="flex flex-col-reverse rounded-md overflow-hidden border border-slate-700 shadow-inner bg-slate-900">
            {layers.map((layer, idx) => {
              const mat = getMaterialById(flow.materials, layer.materialId);
              const heightPct = Math.max(14, (layer.thickness / totalThickness) * 82);

              return (
                <div
                  key={layer.id}
                  style={{
                    backgroundColor: mat.color,
                    minHeight: '20px',
                    height: `${heightPct}px`,
                  }}
                  className="relative w-full border-b border-black/20 flex items-center justify-between px-2 text-[10.5px] font-medium text-slate-900 select-none transition-all"
                >
                  <div className="flex items-center gap-1.5 truncate">
                    <span className="w-3.5 h-3.5 rounded bg-black/25 flex items-center justify-center font-mono text-[9px] text-white font-bold shrink-0">
                      {idx + 1}
                    </span>
                    <span className="truncate font-bold text-slate-950">
                      {layer.name || mat.name}
                    </span>
                    <span className="text-[9.5px] font-mono opacity-80 text-slate-900 shrink-0">
                      ({mat.formula})
                    </span>
                  </div>
                  <span className="font-mono text-[9.5px] font-bold text-slate-950 ml-1.5 whitespace-nowrap tabular-nums">
                    {formatThickness(layer.thickness, thicknessUnit)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Multi-Layer Stack List (From Top to Bottom) */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-300">
              Layer Stack Definition
            </span>
            <button
              onClick={handleAddLayer}
              className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-semibold shadow-sm transition-colors"
            >
              <Plus className="w-3 h-3" />
              <span>Add Layer</span>
            </button>
          </div>

          {/* Render in order from top layer (highest index) down to bottom bulk handle (index 0) */}
          {[...layers].reverse().map((layer, revIdx) => {
            const actualIdx = layers.length - 1 - revIdx;
            const mat = getMaterialById(flow.materials, layer.materialId);
            const isTop = actualIdx === layers.length - 1;
            const isBottom = actualIdx === 0;

            return (
              <div
                key={layer.id}
                className="p-2 rounded-lg bg-slate-950/80 border border-slate-800 space-y-1.5 transition-all hover:border-slate-700"
              >
                {/* Layer Card Header */}
                <div className="flex items-center justify-between gap-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      className="w-2.5 h-2.5 rounded-xs border border-white/20 shrink-0"
                      style={{ backgroundColor: mat.color }}
                    />
                    <span className="text-[11px] font-bold text-white shrink-0">
                      #{actualIdx + 1}
                    </span>
                    <span className="text-[9.5px] font-mono text-slate-400 truncate">
                      {isTop ? 'Top Surface' : isBottom ? 'Bulk Handle' : ''}
                    </span>
                  </div>

                  {/* Move Up/Down & Delete */}
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      disabled={isTop}
                      onClick={() => handleMoveLayer(actualIdx, 'up')}
                      className="p-0.5 rounded text-slate-400 hover:text-white disabled:opacity-20 hover:bg-slate-800 transition-colors"
                      title="Move toward top surface"
                    >
                      <ArrowUp className="w-3 h-3" />
                    </button>
                    <button
                      disabled={isBottom}
                      onClick={() => handleMoveLayer(actualIdx, 'down')}
                      className="p-0.5 rounded text-slate-400 hover:text-white disabled:opacity-20 hover:bg-slate-800 transition-colors"
                      title="Move toward bulk substrate"
                    >
                      <ArrowDown className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => handleDuplicateLayer(actualIdx)}
                      className="p-0.5 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                      title="Duplicate layer"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                    <button
                      disabled={layers.length <= 1}
                      onClick={() => handleDeleteLayer(actualIdx)}
                      className="p-0.5 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 disabled:opacity-20 transition-colors"
                      title="Delete layer"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {/* Layer Name Input */}
                <div>
                  <input
                    type="text"
                    value={layer.name || ''}
                    onChange={(e) =>
                      handleUpdateLayer(actualIdx, { name: e.target.value })
                    }
                    aria-label={`Layer ${actualIdx + 1} name or role`}
                    placeholder="Layer name / role..."
                    className="w-full px-2 py-0.5 rounded-md bg-slate-900 border border-slate-700 text-slate-100 text-[11px] focus:outline-none focus:border-sky-500"
                  />
                </div>

                {/* Material & Thickness in Grid */}
                <div className="grid grid-cols-2 gap-1.5">
                  <div>
                    <label className="block text-[9.5px] text-slate-400 mb-0.5">
                      Material
                    </label>
                    <select
                      value={layer.materialId}
                      onChange={(e) =>
                        handleUpdateLayer(actualIdx, { materialId: e.target.value })
                      }
                      className="w-full px-1.5 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-200 text-[11px] focus:outline-none focus:border-sky-500"
                    >
                      {flow.materials.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.formula})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <div className="flex justify-between text-[9.5px] text-slate-400 mb-0.5">
                      <span>Thick. ({getUnitLabel(thicknessUnit)})</span>
                      <span className="font-mono text-sky-400 tabular-nums">
                        {formatThickness(layer.thickness, thicknessUnit === 'nm' ? 'um' : 'nm')}
                      </span>
                    </div>
                    <ParametricThicknessInput
                      valueNm={layer.thickness}
                      onChangeNm={(valNm) =>
                        handleUpdateLayer(actualIdx, {
                          thickness: valNm,
                        })
                      }
                      unit={thicknessUnit}
                      minNm={5}
                      stepNm={50}
                      className="w-full px-2 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-100 font-mono text-[11px] tabular-nums focus:outline-none focus:border-sky-500"
                      expression={layer.paramBindings?.thickness}
                      variables={variables}
                      waferWidth={flow.substrateWidth}
                      suggestedVarName={`sub_t_${actualIdx + 1}`}
                      targetLabel={layer.name || `Substrate Layer #${actualIdx + 1}`}
                      onChangeExpression={(expr) => {
                        const nextBindings = { ...(layer.paramBindings || {}) };
                        if (expr) nextBindings.thickness = expr;
                        else delete nextBindings.thickness;
                        handleUpdateLayer(actualIdx, {
                          paramBindings:
                            Object.keys(nextBindings).length > 0 ? nextBindings : undefined,
                        });
                      }}
                      onCreateVariable={onCreateVariable}
                      onCreateAndBind={(name, value, unit, description) => {
                        const newVar = {
                          id: `var_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                          name,
                          value,
                          unit,
                          description,
                        };
                        const nextLayers = layers.map((l, i) =>
                          i === actualIdx
                            ? {
                                ...l,
                                paramBindings: { ...(l.paramBindings || {}), thickness: name },
                              }
                            : l
                        );
                        onUpdateFlow(
                          resolveFlowParameters({
                            ...flow,
                            variables: [...variables, newVar],
                            substrateLayers: nextLayers,
                          })
                        );
                      }}
                      onOpenVariablesModal={onOpenVariablesModal}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Substrate Templates / Presets Quick Loader */}
        <div className="pt-2 border-t border-slate-800 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-300">
              Standard Substrate Presets
            </span>
            <span className="text-[9.5px] text-slate-500 font-mono">1-Click Apply</span>
          </div>

          <div className="grid grid-cols-1 gap-1">
            {SUBSTRATE_PRESETS.map((p) => (
              <button
                key={p.name}
                onClick={() => handleLoadPreset(p)}
                className="flex items-start justify-between px-2 py-1.5 rounded-md bg-slate-950/60 border border-slate-800 hover:border-sky-500/60 hover:bg-slate-800/40 text-left transition-all"
              >
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold text-slate-200 leading-tight truncate">
                    {p.name}
                  </div>
                  <div className="text-[9.5px] text-slate-400 leading-tight mt-0.5 line-clamp-1">
                    {p.description}
                  </div>
                </div>
                <span className="text-[9.5px] font-mono text-sky-400 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-700 shrink-0 ml-2 tabular-nums">
                  {p.layers.length}L
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
