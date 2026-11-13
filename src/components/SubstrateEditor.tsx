/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ProcessFlow, SubstrateLayer, Material } from '../types/microfab';
import { getMaterialById } from '../lib/materials';
import { ThicknessUnit, formatThickness, getUnitLabel } from '../lib/units';
import { ThicknessInput } from './ThicknessInput';
import {
  Layers,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Copy,
  Sparkles,
  Info,
  Maximize2,
  Box,
} from 'lucide-react';

interface SubstrateEditorProps {
  flow: ProcessFlow;
  thicknessUnit?: ThicknessUnit;
  onUpdateFlow: (updated: ProcessFlow) => void;
  onOpenMaterialsModal: () => void;
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
}) => {
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
    onUpdateFlow({
      ...flow,
      substrateLayers: updatedLayers,
      substrateThickness: updatedLayers.reduce((acc, l) => acc + (l.thickness || 0), 0),
      substrateMaterialId: updatedLayers[0]?.materialId || 'mat_si_sub',
    });
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
    const clamped = Math.max(1, Math.min(200, valUm));
    onUpdateFlow({
      ...flow,
      substrateWidth: Math.round(clamped * 1000),
    });
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 border-l border-slate-800 text-slate-200">
      {/* Editor Header */}
      <div className="p-4 border-b border-slate-800">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
              Starting Wafer Substrate
            </span>
            <span className="text-xs text-slate-400 font-mono">
              {layers.length} {layers.length === 1 ? 'Layer' : 'Layers'}
            </span>
          </div>

          <div className="text-xs font-mono text-sky-400 font-semibold">
            {formatThickness(totalThickness, thicknessUnit)} total
          </div>
        </div>

        <h2 className="text-sm font-bold text-white tracking-wide">
          Multi-Layer Substrate Architecture
        </h2>
        <p className="text-[11px] text-slate-400 mt-0.5">
          Define the base wafer stack (e.g. bulk handle, buried oxide, SOI device layer) prior to Step 1.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Wafer Width Setting */}
        <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-300">Wafer Slice Width</span>
            <span className="font-mono text-sky-400 font-semibold">
              {(flow.substrateWidth / 1000).toFixed(1)} µm
            </span>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="number"
              min="1"
              max="200"
              step="1"
              value={(flow.substrateWidth / 1000).toFixed(1)}
              onChange={(e) => handleWidthChange(parseFloat(e.target.value || '10'))}
              className="w-24 px-2 py-1 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 font-mono text-xs focus:outline-none focus:border-sky-500"
            />
            <span className="text-xs text-slate-400">µm</span>

            {/* Quick presets */}
            <div className="flex items-center gap-1 ml-auto">
              {[5, 10, 20, 50].map((w) => (
                <button
                  key={w}
                  onClick={() => handleWidthChange(w)}
                  className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors ${
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
        </div>

        {/* Visual Layer Stack Bar Preview */}
        <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2">
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide block">
            Substrate Cross-Section Preview (Top to Bottom)
          </span>

          <div className="flex flex-col-reverse rounded-lg overflow-hidden border border-slate-700 shadow-inner bg-slate-900">
            {layers.map((layer, idx) => {
              const mat = getMaterialById(flow.materials, layer.materialId);
              const heightPct = Math.max(16, (layer.thickness / totalThickness) * 120);

              return (
                <div
                  key={layer.id}
                  style={{
                    backgroundColor: mat.color,
                    minHeight: '26px',
                    height: `${heightPct}px`,
                  }}
                  className="relative w-full border-b border-black/20 flex items-center justify-between px-3 text-[11px] font-medium text-slate-900 select-none shadow-sm transition-all"
                >
                  <div className="flex items-center gap-2 truncate">
                    <span className="w-4 h-4 rounded-full bg-black/20 flex items-center justify-center font-mono text-[9px] text-white font-bold">
                      {idx + 1}
                    </span>
                    <span className="truncate font-bold drop-shadow-sm text-slate-950">
                      {layer.name || mat.name}
                    </span>
                    <span className="text-[10px] font-mono opacity-80 drop-shadow-sm text-slate-900">
                      ({mat.formula})
                    </span>
                  </div>
                  <span className="font-mono text-[10px] font-bold text-slate-950 ml-2 whitespace-nowrap">
                    {formatThickness(layer.thickness, thicknessUnit)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Multi-Layer Stack List (From Top to Bottom) */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-300">
              Layer Stack Definition
            </span>
            <button
              onClick={handleAddLayer}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold shadow-sm transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
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
                className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2.5 transition-all hover:border-slate-700"
              >
                {/* Layer Card Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-3 h-3 rounded-full border border-white/20"
                      style={{ backgroundColor: mat.color }}
                    />
                    <span className="text-xs font-bold text-white">
                      Layer #{actualIdx + 1}
                    </span>
                    <span className="text-[10px] font-mono text-slate-400">
                      {isTop ? '(Top Surface)' : isBottom ? '(Bottom Bulk Handle)' : ''}
                    </span>
                  </div>

                  {/* Move Up/Down & Delete */}
                  <div className="flex items-center gap-1">
                    <button
                      disabled={isTop}
                      onClick={() => handleMoveLayer(actualIdx, 'up')}
                      className="p-1 rounded text-slate-400 hover:text-white disabled:opacity-20 hover:bg-slate-800 transition-colors"
                      title="Move toward top surface"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      disabled={isBottom}
                      onClick={() => handleMoveLayer(actualIdx, 'down')}
                      className="p-1 rounded text-slate-400 hover:text-white disabled:opacity-20 hover:bg-slate-800 transition-colors"
                      title="Move toward bulk substrate"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDuplicateLayer(actualIdx)}
                      className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                      title="Duplicate layer"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button
                      disabled={layers.length <= 1}
                      onClick={() => handleDeleteLayer(actualIdx)}
                      className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 disabled:opacity-20 transition-colors"
                      title="Delete layer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Layer Name Input */}
                <div>
                  <label className="block text-[10px] text-slate-400 mb-0.5">
                    Layer Name / Role
                  </label>
                  <input
                    type="text"
                    value={layer.name || ''}
                    onChange={(e) =>
                      handleUpdateLayer(actualIdx, { name: e.target.value })
                    }
                    placeholder="e.g. Bulk Silicon Handle, Buried Oxide (BOX)..."
                    className="w-full px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 text-xs focus:outline-none focus:border-sky-500"
                  />
                </div>

                {/* Material & Thickness in Grid */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-0.5">
                      Material
                    </label>
                    <select
                      value={layer.materialId}
                      onChange={(e) =>
                        handleUpdateLayer(actualIdx, { materialId: e.target.value })
                      }
                      className="w-full px-2 py-1 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 text-xs focus:outline-none focus:border-sky-500"
                    >
                      {flow.materials.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.formula})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <div className="flex justify-between text-[10px] text-slate-400 mb-0.5">
                      <span>Thickness ({getUnitLabel(thicknessUnit)})</span>
                      <span className="font-mono text-sky-400">
                        {formatThickness(layer.thickness, thicknessUnit === 'nm' ? 'um' : 'nm')}
                      </span>
                    </div>
                    <ThicknessInput
                      valueNm={layer.thickness}
                      onChangeNm={(valNm) =>
                        handleUpdateLayer(actualIdx, {
                          thickness: valNm,
                        })
                      }
                      unit={thicknessUnit}
                      minNm={5}
                      stepNm={50}
                      className="w-full px-2 py-1 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 font-mono text-xs focus:outline-none focus:border-sky-500"
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Substrate Templates / Presets Quick Loader */}
        <div className="pt-3 border-t border-slate-800 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-300">
              Standard Substrate Presets
            </span>
            <span className="text-[10px] text-slate-500 font-mono">1-Click Apply</span>
          </div>

          <div className="grid grid-cols-1 gap-1.5">
            {SUBSTRATE_PRESETS.map((p) => (
              <button
                key={p.name}
                onClick={() => handleLoadPreset(p)}
                className="flex items-start justify-between p-2 rounded-lg bg-slate-950/60 border border-slate-800 hover:border-sky-500/60 hover:bg-slate-800/40 text-left transition-all"
              >
                <div>
                  <div className="text-xs font-semibold text-slate-200">
                    {p.name}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    {p.description}
                  </div>
                </div>
                <span className="text-[10px] font-mono text-sky-400 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-700 flex-shrink-0 ml-2">
                  {p.layers.length} {p.layers.length === 1 ? 'layer' : 'layers'}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
