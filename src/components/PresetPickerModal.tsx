/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ProcessFlow } from '../types/microfab';
import { PRESET_PROCESS_FLOWS } from '../lib/presets';
import { X, Cpu, Layers, Sparkles, Activity, Plus } from 'lucide-react';

interface PresetPickerModalProps {
  onSelectPreset: (preset: ProcessFlow) => void;
  onClose: () => void;
}

export const PresetPickerModal: React.FC<PresetPickerModalProps> = ({
  onSelectPreset,
  onClose,
}) => {
  const handleLoadBlank = () => {
    const blank: ProcessFlow = {
      id: `flow_${Date.now()}`,
      title: 'Custom Cleanroom Fabrication Flow',
      description: 'Custom microfabrication process flow sequence.',
      substrateWidth: 10000,
      substrateThickness: 3000,
      substrateMaterialId: 'mat_si_sub',
      substrateLayers: [
        {
          id: `sub_layer_${Date.now()}`,
          name: 'Bulk Silicon <100>',
          materialId: 'mat_si_sub',
          thickness: 3000,
        },
      ],
      materials: [...PRESET_PROCESS_FLOWS[0].materials],
      steps: [
        {
          id: `step_${Date.now()}`,
          title: 'Substrate Thermal Oxide',
          type: 'deposition',
          enabled: true,
          materialId: 'mat_sio2_thermal',
          thickness: 200,
          deposition: {
            method: 'Thermal Oxidation',
            depositionType: 'conformal',
            thickness: 200,
          },
        },
      ],
    };
    onSelectPreset(blank);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-4xl max-h-[85vh] bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl flex flex-col text-slate-200 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900">
          <div>
            <h2 className="text-base font-bold text-white">
              Microfabrication Process Flow Templates
            </h2>
            <p className="text-xs text-slate-400">
              Load established semiconductor, MEMS, and photonics cleanroom recipes
            </p>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Preset Cards Grid */}
        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-2 gap-4 bg-slate-950/40">
          {PRESET_PROCESS_FLOWS.map((preset) => (
            <div
              key={preset.id}
              onClick={() => onSelectPreset(preset)}
              className="group p-4 rounded-xl bg-slate-900/90 border border-slate-800 hover:border-sky-500/80 hover:bg-slate-850 cursor-pointer transition-all flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="w-7 h-7 rounded-lg bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400">
                    <Cpu className="w-4 h-4" />
                  </span>
                  <span className="text-[11px] font-mono text-slate-400 bg-slate-800 px-2 py-0.5 rounded-md">
                    {preset.steps.length} steps
                  </span>
                </div>

                <h3 className="font-semibold text-white text-sm group-hover:text-sky-300 transition-colors">
                  {preset.title}
                </h3>
                <p className="text-xs text-slate-400 mt-1 line-clamp-2">
                  {preset.description}
                </p>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
                <span className="font-mono">
                  Wafer: {(preset.substrateWidth / 1000).toFixed(1)} µm slice
                </span>
                <span className="text-sky-400 font-semibold group-hover:underline">
                  Load Template →
                </span>
              </div>
            </div>
          ))}

          {/* Blank Recipe Option */}
          <div
            onClick={handleLoadBlank}
            className="group p-4 rounded-xl border border-dashed border-slate-700 hover:border-sky-500/80 bg-slate-950/30 hover:bg-slate-900/40 cursor-pointer transition-all flex flex-col items-center justify-center text-center"
          >
            <span className="w-9 h-9 rounded-full bg-slate-800 flex items-center justify-center text-slate-300 mb-2 group-hover:bg-sky-600 group-hover:text-white transition-colors">
              <Plus className="w-5 h-5" />
            </span>
            <h3 className="font-semibold text-white text-sm">
              Blank Process Flow
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Start from scratch with a bare silicon wafer substrate
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
