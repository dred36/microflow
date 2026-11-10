/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  ProcessFlow,
  ProcessStep,
  ProcessStepType,
  Material,
} from '../types/microfab';
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
  Sliders,
  FileCode,
} from 'lucide-react';

interface ProcessFlowSidebarProps {
  flow: ProcessFlow;
  activeStepIndex: number;
  onSelectStepIndex: (index: number) => void;
  onUpdateFlow: (updated: ProcessFlow) => void;
  onOpenPresets: () => void;
}

export const ProcessFlowSidebar: React.FC<ProcessFlowSidebarProps> = ({
  flow,
  activeStepIndex,
  onSelectStepIndex,
  onUpdateFlow,
  onOpenPresets,
}) => {
  const [showAddMenu, setShowAddMenu] = useState<boolean>(false);

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
      case 'anneal':
        return <Sliders className="w-4 h-4 text-purple-400" />;
      default:
        return <Layers className="w-4 h-4 text-slate-400" />;
    }
  };

  const handleAddStep = (type: ProcessStepType) => {
    const id = `step_${Date.now()}`;
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
          strip: {
            stripType: 'resist-strip',
            solvent: 'O₂ Plasma Ashing',
          },
        };
        break;
      case 'liftoff':
        newStep = {
          id,
          title: 'Metal Lift-Off',
          type: 'liftoff',
          enabled: true,
          strip: {
            stripType: 'metal-liftoff',
            solvent: 'Acetone / Remover PG',
          },
        };
        break;
      case 'cmp':
        newStep = {
          id,
          title: 'CMP Planarization',
          type: 'cmp',
          enabled: true,
          cmp: {
            mode: 'polish-depth',
            depth: 300,
          },
        };
        break;
      case 'anneal':
        newStep = {
          id,
          title: 'Thermal Anneal / Drive-In',
          type: 'anneal',
          enabled: true,
          notes: 'High-temp furnace anneal',
        };
        break;
      default:
        newStep = {
          id,
          title: 'Process Step',
          type: 'deposition',
          enabled: true,
        };
    }

    const updatedSteps = [...flow.steps, newStep];
    onUpdateFlow({ ...flow, steps: updatedSteps });
    onSelectStepIndex(updatedSteps.length - 1);
    setShowAddMenu(false);
  };

  const handleMoveStep = (idx: number, direction: 'up' | 'down') => {
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= flow.steps.length) return;

    const updated = [...flow.steps];
    const temp = updated[idx];
    updated[idx] = updated[targetIdx];
    updated[targetIdx] = temp;

    onUpdateFlow({ ...flow, steps: updated });
    onSelectStepIndex(targetIdx);
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
    onUpdateFlow({ ...flow, steps: updated });
    onSelectStepIndex(idx + 1);
  };

  const handleDeleteStep = (idx: number) => {
    if (flow.steps.length <= 1) return;
    const updated = flow.steps.filter((_, i) => i !== idx);
    onUpdateFlow({ ...flow, steps: updated });
    onSelectStepIndex(Math.max(0, idx - 1));
  };

  const handleToggleStep = (idx: number) => {
    const updated = flow.steps.map((s, i) =>
      i === idx ? { ...s, enabled: !s.enabled } : s
    );
    onUpdateFlow({ ...flow, steps: updated });
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

  return (
    <div className="flex flex-col h-full bg-slate-900 border-r border-slate-800 text-slate-200">
      {/* Sidebar Header */}
      <div className="p-3.5 border-b border-slate-800 flex items-center justify-between">
        <div>
          <span className="text-xs font-bold text-slate-200 tracking-wider uppercase">
            Process Traveller
          </span>
          <span className="text-xs text-slate-500 block font-mono">
            Substrate + {flow.steps.length} sequential steps
          </span>
        </div>

        <button
          onClick={onOpenPresets}
          className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-400 border border-slate-700 transition-colors"
        >
          <span>Presets</span>
        </button>
      </div>

      {/* Starting Substrate (Step 0) Interactive Item */}
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
                Starting Substrate
              </span>
            </div>

            <span className="text-[10px] font-mono text-emerald-400 font-semibold">
              {(totalSubThickness / 1000).toFixed(2)} µm
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
                  title={`${l.name || mat?.name || 'Layer'}: ${l.thickness} nm`}
                />
              );
            })}
          </div>

          <div className="mt-2 flex items-center justify-between text-[10px] text-emerald-400/90 font-medium group-hover:text-emerald-300">
            <span>Click to configure starting layers</span>
            <span>Configure →</span>
          </div>
        </div>
      </div>

      {/* Ordered Fabrication Steps Header */}
      <div className="px-3 pt-2.5 pb-1 flex items-center justify-between text-[10px] uppercase font-bold text-slate-400 tracking-wider">
        <span>Fabrication Operations</span>
        <span className="font-mono text-slate-500">{flow.steps.length} Steps</span>
      </div>

      {/* Ordered Step List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {flow.steps.map((step, idx) => {
          const isSelected = activeStepIndex === idx;

          return (
            <div
              key={step.id}
              onClick={() => onSelectStepIndex(idx)}
              className={`group relative flex items-center justify-between p-2.5 rounded-xl text-xs transition-all cursor-pointer border ${
                isSelected
                  ? 'bg-sky-950/60 border-sky-500 text-white shadow-md'
                  : step.enabled
                  ? 'bg-slate-950/40 border-slate-800/80 hover:bg-slate-800/50 text-slate-300'
                  : 'bg-slate-950/20 border-slate-800/40 opacity-50 text-slate-500'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0 pr-1">
                {/* Step index badge */}
                <span
                  className={`w-5 h-5 rounded-md flex items-center justify-center font-mono text-[10px] font-semibold flex-shrink-0 ${
                    isSelected
                      ? 'bg-sky-500 text-white'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {idx + 1}
                </span>

                {/* Step icon */}
                <div className="flex-shrink-0">{getStepIcon(step.type)}</div>

                {/* Step info */}
                <div className="min-w-0">
                  <div className="font-medium truncate">{step.title}</div>
                  <div className="text-[10px] text-slate-400 truncate font-mono">
                    {step.type === 'deposition' &&
                      `${step.deposition?.method || 'CVD'} · ${
                        step.deposition?.thickness || step.thickness || 200
                      } nm`}
                    {step.type === 'lithography' &&
                      `${step.lithography?.polarity || 'pos'} resist · ${
                        step.lithography?.windows.length || 0
                      } apertures`}
                    {step.type === 'etch' &&
                      `${step.etch?.etchType?.toUpperCase() || 'RIE'} · ${
                        step.etch?.depth || step.thickness || 200
                      } nm`}
                    {step.type === 'strip' &&
                      `${step.strip?.stripType || 'Resist Strip'}`}
                    {step.type === 'liftoff' && 'Metal Lift-off'}
                    {step.type === 'cmp' && 'CMP Planarization'}
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
                  onClick={() => handleToggleStep(idx)}
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
                  disabled={idx === 0}
                  onClick={() => handleMoveStep(idx, 'up')}
                  className="p-1 rounded hover:bg-slate-700/80 text-slate-400 hover:text-slate-200 disabled:opacity-20 transition-colors"
                  title="Move Up"
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
                <button
                  disabled={idx === flow.steps.length - 1}
                  onClick={() => handleMoveStep(idx, 'down')}
                  className="p-1 rounded hover:bg-slate-700/80 text-slate-400 hover:text-slate-200 disabled:opacity-20 transition-colors"
                  title="Move Down"
                >
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handleDuplicateStep(idx)}
                  className="p-1 rounded hover:bg-slate-700/80 text-slate-400 hover:text-slate-200 transition-colors"
                  title="Duplicate Step"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                <button
                  disabled={flow.steps.length <= 1}
                  onClick={() => handleDeleteStep(idx)}
                  className="p-1 rounded hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 disabled:opacity-20 transition-colors"
                  title="Delete Step"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add Step Action Button & Popover */}
      <div className="relative p-3 border-t border-slate-800 bg-slate-900">
        <button
          onClick={() => setShowAddMenu(!showAddMenu)}
          className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-medium text-xs transition-colors shadow-lg shadow-sky-950/50"
        >
          <Plus className="w-4 h-4" />
          <span>Add Process Step</span>
        </button>

        {showAddMenu && (
          <div className="absolute bottom-16 left-3 right-3 p-2 bg-slate-950 border border-slate-700 rounded-2xl shadow-2xl z-30 space-y-1">
            <span className="text-[10px] uppercase font-bold text-slate-400 px-2 py-1 block">
              Choose Process Step
            </span>
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
                <div className="text-[10px] text-slate-500">Photoresist coat, mask exposure</div>
              </div>
            </button>
            <button
              onClick={() => handleAddStep('etch')}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-left hover:bg-slate-800 text-slate-200"
            >
              <Flame className="w-4 h-4 text-amber-400" />
              <div>
                <div className="font-medium">Etch (Dry RIE / Wet / Bosch)</div>
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
                <div className="font-medium">CMP Planarization</div>
                <div className="text-[10px] text-slate-500">Chemical mechanical polishing</div>
              </div>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
