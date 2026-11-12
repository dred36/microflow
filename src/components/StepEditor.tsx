/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  ProcessStep,
  Material,
  ProcessStepType,
  ToolRecipe,
  MaskWindow,
  ProcessBlock,
  PhotomaskLevel,
} from '../types/microfab';
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
} from 'lucide-react';

interface StepEditorProps {
  step: ProcessStep;
  waferWidth: number;
  materials: Material[];
  onUpdateStep: (updated: ProcessStep) => void;
  onOpenMaterialsModal: () => void;
  blocks?: ProcessBlock[];
  masks?: PhotomaskLevel[];
  onOpenMaskLevelsModal?: (maskId?: string) => void;
  onCreateBlock?: (name?: string) => void;
}

export const StepEditor: React.FC<StepEditorProps> = ({
  step,
  waferWidth,
  materials,
  onUpdateStep,
  onOpenMaterialsModal,
  blocks,
  masks,
  onOpenMaskLevelsModal,
  onCreateBlock,
}) => {
  const [activeTab, setActiveTab] = useState<'process' | 'equipment' | 'notes'>('process');
  const [isAddingBlockInline, setIsAddingBlockInline] = useState<boolean>(false);
  const [inlineBlockName, setInlineBlockName] = useState<string>('');

  const handleUpdate = (patch: Partial<ProcessStep>) => {
    onUpdateStep({ ...step, ...patch });
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
    <div className="flex flex-col h-full bg-slate-900 border-l border-slate-800 text-slate-200">
      {/* Editor Header */}
      <div className="p-4 border-b border-slate-800">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/30">
              {step.type}
            </span>
            <span className="text-xs text-slate-400 font-mono">Step Config</span>
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={step.enabled}
              onChange={(e) => handleUpdate({ enabled: e.target.checked })}
              className="rounded bg-slate-800 border-slate-700 text-sky-500 focus:ring-0"
            />
            <span>Enabled</span>
          </label>
        </div>

        {/* Step Title Input */}
        <input
          type="text"
          value={step.title}
          onChange={(e) => handleUpdate({ title: e.target.value })}
          placeholder="Step title..."
          className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white font-medium text-sm focus:outline-none focus:border-sky-500 transition-colors"
        />

        {/* Fabrication Block / Module Assignment */}
        <div className="mt-2.5 flex items-center gap-2">
          <span className="text-[11px] text-slate-400 shrink-0 font-medium">Module:</span>
          <select
            value={step.blockId || 'none'}
            onChange={(e) =>
              handleUpdate({ blockId: e.target.value === 'none' ? undefined : e.target.value })
            }
            className="flex-1 px-2 py-1 rounded bg-slate-950 border border-slate-700 text-xs text-slate-200 focus:outline-none focus:border-sky-500 font-mono truncate"
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
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-400 border border-slate-700 text-xs transition-colors shrink-0"
              title="Create new fabrication block / module"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Inline Module Creation Row */}
        {isAddingBlockInline && (
          <div className="flex items-center gap-1.5 mt-2 p-1.5 rounded-lg bg-slate-950 border border-sky-500/60 animate-in fade-in zoom-in-95 duration-100">
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
              className="flex-1 px-2 py-1 rounded bg-slate-900 border border-slate-700 text-xs text-white focus:outline-none focus:border-sky-500 font-medium"
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
              className="px-2.5 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-semibold transition-colors"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => {
                setIsAddingBlockInline(false);
                setInlineBlockName('');
              }}
              className="p-1 rounded text-slate-400 hover:text-white text-xs"
            >
              ✕
            </button>
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="flex items-center gap-1 mt-3 p-1 rounded-lg bg-slate-950 border border-slate-800 text-xs">
          <button
            onClick={() => setActiveTab('process')}
            className={`flex-1 py-1 rounded-md font-medium transition-colors ${
              activeTab === 'process'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Process Physics
          </button>
          <button
            onClick={() => setActiveTab('equipment')}
            className={`flex-1 py-1 rounded-md font-medium transition-colors ${
              activeTab === 'equipment'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Tool & Recipe SOP
          </button>
        </div>
      </div>

      {/* Tab Contents */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {activeTab === 'process' && (
          <>
            {/* Step Type Selector */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                Process Mechanism
              </label>
              <select
                value={step.type}
                onChange={(e) => {
                  const newType = e.target.value as ProcessStepType;
                  handleUpdate({
                    type: newType,
                    // Initialize sensible defaults for the new type if missing
                    thickness: step.thickness || 200,
                  });
                }}
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-200 text-xs font-medium focus:outline-none focus:border-sky-500"
              >
                <option value="deposition">Deposition / Thin Film Growth</option>
                <option value="lithography">Photolithography & Patterning</option>
                <option value="etch">Etching (Dry RIE / Wet / Bosch DRIE)</option>
                <option value="strip">Strip / Sacrificial Release</option>
                <option value="liftoff">Metal Lift-off</option>
                <option value="cmp">Chemical Mechanical Polishing (CMP)</option>
                <option value="anneal">Thermal Anneal / Drive-In</option>
                <option value="substrate">Substrate Initialization</option>
              </select>
            </div>

            {/* Customization for DEPOSITION */}
            {step.type === 'deposition' && (
              <div className="space-y-3.5 bg-slate-950/70 p-3.5 rounded-xl border border-slate-800">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-sky-400">
                    Deposition Material
                  </label>
                  <button
                    onClick={onOpenMaterialsModal}
                    className="text-[11px] text-sky-400 hover:underline"
                  >
                    + Manage Materials
                  </button>
                </div>

                <select
                  value={step.materialId || 'mat_sio2_thermal'}
                  onChange={(e) => handleUpdate({ materialId: e.target.value })}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 text-xs focus:outline-none focus:border-sky-500"
                >
                  {materials.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.formula})
                    </option>
                  ))}
                </select>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Film Thickness (nm)
                    </label>
                    <input
                      type="number"
                      min="5"
                      step="10"
                      value={step.deposition?.thickness ?? step.thickness ?? 200}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value || '0');
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
                      className="w-full px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 font-mono text-xs focus:outline-none focus:border-sky-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Deposition Method
                    </label>
                    <select
                      value={step.deposition?.method || 'PECVD'}
                      onChange={(e) =>
                        handleUpdate({
                          deposition: {
                            ...(step.deposition || {
                              depositionType: 'conformal',
                              thickness: step.thickness || 200,
                              method: 'PECVD',
                            }),
                            method: e.target.value as any,
                          },
                        })
                      }
                      className="w-full px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 text-xs focus:outline-none focus:border-sky-500"
                    >
                      <option value="PECVD">PECVD</option>
                      <option value="LPCVD">LPCVD</option>
                      <option value="ALD">ALD (Atomic Layer)</option>
                      <option value="Sputter">Sputtering (PVD)</option>
                      <option value="E-Beam Evaporation">E-Beam Evap</option>
                      <option value="Thermal Oxidation">Thermal Oxide</option>
                      <option value="Spin Coat">Spin Coat</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
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
                    className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 text-xs focus:outline-none focus:border-sky-500"
                  >
                    <option value="conformal">Conformal (Uniform sidewalls & top)</option>
                    <option value="directional">Directional (Line-of-sight top only, E-Beam)</option>
                    <option value="semi-conformal">Semi-Conformal (Custom sidewall coverage)</option>
                    <option value="spin-coat">Planarizing Spin-Coat (Fills valleys flat)</option>
                  </select>
                </div>

                {step.deposition?.depositionType === 'semi-conformal' && (
                  <div>
                    <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                      <span>Sidewall Step Coverage</span>
                      <span className="font-mono text-sky-400">
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
              </div>
            )}

            {/* Customization for LITHOGRAPHY */}
            {step.type === 'lithography' && (
              <div className="space-y-3.5 bg-slate-950/70 p-3.5 rounded-xl border border-slate-800">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-rose-400">
                    Photoresist & Exposure
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">
                    Mask apertures edited on canvas track
                  </span>
                </div>

                {/* Mask Level Linking / Reticle Assignment */}
                <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-sky-400 flex items-center gap-1.5">
                      <Scan className="w-3.5 h-3.5" />
                      <span>Photomask Level / Reticle</span>
                    </span>
                    {onOpenMaskLevelsModal && (
                      <button
                        onClick={() => onOpenMaskLevelsModal(step.lithography?.maskId)}
                        className="text-[11px] text-sky-400 hover:text-sky-300 hover:underline flex items-center gap-1 font-medium"
                      >
                        <span>Manage Reticles →</span>
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
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
                              polarity: matchingMask.polarity,
                              windows: matchingMask.windows.map((w) => ({ ...w })),
                            },
                          });
                        } else {
                          handleUpdate({
                            lithography: {
                              ...step.lithography!,
                              maskId: undefined,
                            },
                          });
                        }
                      }}
                      className="flex-1 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-slate-200 text-xs font-mono focus:outline-none focus:border-sky-500"
                    >
                      <option value="none">-- Unlinked Custom Apertures --</option>
                      {masks?.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.windows?.length || 0} slits · {m.polarity})
                        </option>
                      ))}
                    </select>
                  </div>

                  {step.lithography?.windows && (
                    <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono pt-0.5">
                      <span>{step.lithography.windows.length} Aperture {step.lithography.windows.length === 1 ? 'window' : 'windows'}</span>
                      <span className="text-amber-400">
                        {step.lithography.polarity === 'positive' ? 'Positive (Exposed Dissolves)' : 'Negative (Exposed Crosslinks)'}
                      </span>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Resist Tone (Polarity)
                    </label>
                    <select
                      value={step.lithography?.polarity || 'positive'}
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
                            polarity: e.target.value as any,
                          },
                        })
                      }
                      className="w-full px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 text-xs focus:outline-none focus:border-sky-500"
                    >
                      <option value="positive">Positive (Exposed dissolves)</option>
                      <option value="negative">Negative (Unexposed dissolves)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Resist Thickness (nm)
                    </label>
                    <input
                      type="number"
                      min="100"
                      step="100"
                      value={step.lithography?.resistThickness ?? 1000}
                      onChange={(e) =>
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
                            resistThickness: parseFloat(e.target.value || '1000'),
                          },
                        })
                      }
                      className="w-full px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 font-mono text-xs focus:outline-none focus:border-sky-500"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                    <span>Sidewall Profile Angle</span>
                    <span className="font-mono text-rose-400">
                      {step.lithography?.sidewallAngle ?? 90}°{' '}
                      {(step.lithography?.sidewallAngle ?? 90) > 90
                        ? '(Retrograde / Lift-off Undercut)'
                        : (step.lithography?.sidewallAngle ?? 90) < 90
                        ? '(Tapered)'
                        : '(Vertical 90°)'}
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

                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Exposure Tool Wavelength
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
                    className="w-full px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 text-xs focus:outline-none focus:border-sky-500"
                  >
                    <option value="UV Contact (365nm)">UV Contact Aligner (i-line 365nm)</option>
                    <option value="DUV Stepper (248nm)">DUV Projection Stepper (248nm)</option>
                    <option value="E-Beam Litho">Electron Beam Lithography (EBL)</option>
                    <option value="Direct Write Laser">Direct Write Laser (MLA150)</option>
                  </select>
                </div>
              </div>
            )}

            {/* Customization for ETCH */}
            {step.type === 'etch' && (
              <div className="space-y-3.5 bg-slate-950/70 p-3.5 rounded-xl border border-slate-800">
                <span className="text-xs font-semibold text-amber-400">
                  Etch Parameters & Isotropy
                </span>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Etch Depth (nm)
                    </label>
                    <input
                      type="number"
                      min="10"
                      step="25"
                      value={step.etch?.depth ?? step.thickness ?? 300}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value || '0');
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
                      className="w-full px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 font-mono text-xs focus:outline-none focus:border-sky-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Etch Mechanism
                    </label>
                    <select
                      value={step.etch?.etchType || 'rie'}
                      onChange={(e) =>
                        handleUpdate({
                          etch: {
                            ...(step.etch || {
                              depth: step.thickness || 300,
                              targetMaterialId: 'all',
                              isotropy: 0.05,
                              sidewallAngle: 90,
                              etchType: 'rie',
                            }),
                            etchType: e.target.value as any,
                            isotropy:
                              e.target.value === 'wet-isotropic'
                                ? 0.95
                                : e.target.value === 'drie-bosch'
                                ? 0.02
                                : 0.05,
                          },
                        })
                      }
                      className="w-full px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 text-xs focus:outline-none focus:border-sky-500"
                    >
                      <option value="rie">Reactive Ion Etch (RIE)</option>
                      <option value="drie-bosch">Deep RIE (Bosch DRIE)</option>
                      <option value="wet-isotropic">Wet Chemical (HF/BOE - Isotropic)</option>
                      <option value="wet-koh">Wet KOH Anisotropic (54.74°)</option>
                      <option value="ion-beam">Ion Beam Milling</option>
                      <option value="ashing">Oxygen Plasma Ashing</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Target Material to Etch
                  </label>
                  <select
                    value={step.etch?.targetMaterialId || 'all'}
                    onChange={(e) =>
                      handleUpdate({
                        etch: {
                          ...(step.etch || {
                            etchType: 'rie',
                            depth: step.thickness || 300,
                            isotropy: 0.05,
                            sidewallAngle: 90,
                          }),
                          targetMaterialId: e.target.value,
                        },
                      })
                    }
                    className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 text-xs focus:outline-none focus:border-sky-500"
                  >
                    <option value="all">All Exposed Layers</option>
                    {materials.map((m) => (
                      <option key={m.id} value={m.id}>
                        Selective: {m.name} ({m.formula})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                    <span>Etch Isotropy (Mask Undercut)</span>
                    <span className="font-mono text-amber-400">
                      {Math.round((step.etch?.isotropy ?? 0.05) * 100)}%{' '}
                      {(step.etch?.isotropy ?? 0.05) < 0.1
                        ? '(Anisotropic Vertical)'
                        : (step.etch?.isotropy ?? 0.05) > 0.7
                        ? '(Isotropic Circular Undercut)'
                        : '(Moderate Undercut)'}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={Math.round((step.etch?.isotropy ?? 0.05) * 100)}
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

                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Etch Stop Layer (Auto Endpoint)
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
                    className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 text-xs focus:outline-none focus:border-sky-500"
                  >
                    <option value="">None (Time Etch)</option>
                    {materials.map((m) => (
                      <option key={m.id} value={m.id}>
                        Stop at: {m.name} ({m.formula})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* Customization for STRIP / LIFTOFF */}
            {(step.type === 'strip' || step.type === 'liftoff') && (
              <div className="space-y-3.5 bg-slate-950/70 p-3.5 rounded-xl border border-slate-800">
                <span className="text-xs font-semibold text-emerald-400">
                  Strip & Release Mechanism
                </span>

                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
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
                    className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 text-xs focus:outline-none focus:border-sky-500"
                  >
                    <option value="resist-strip">Standard Resist Strip (Dissolves PR only)</option>
                    <option value="metal-liftoff">Metal Lift-off (Dissolves PR + lifts top films)</option>
                    <option value="sacrificial-release">MEMS Sacrificial Release (Releases cavities)</option>
                  </select>
                </div>

                {step.strip?.stripType === 'sacrificial-release' && (
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Sacrificial Material to Dissolve
                    </label>
                    <select
                      value={step.strip?.targetMaterialId || 'mat_sio2_thermal'}
                      onChange={(e) =>
                        handleUpdate({
                          strip: {
                            ...step.strip!,
                            targetMaterialId: e.target.value,
                          },
                        })
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 text-xs focus:outline-none focus:border-sky-500"
                    >
                      {materials.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.formula})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
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
                    className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 text-xs focus:outline-none focus:border-sky-500"
                  />
                </div>
              </div>
            )}

            {/* Customization for CMP */}
            {step.type === 'cmp' && (
              <div className="space-y-3.5 bg-slate-950/70 p-3.5 rounded-xl border border-slate-800">
                <span className="text-xs font-semibold text-cyan-400">
                  CMP Planarization Parameters
                </span>

                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Polish Mode
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
                    className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 text-xs focus:outline-none focus:border-sky-500"
                  >
                    <option value="polish-depth">Fixed Polish Depth (nm)</option>
                    <option value="stop-on-layer">Endpoint Stop on Polish-Stop Layer</option>
                    <option value="target-height">Planarize to Absolute Height (nm)</option>
                  </select>
                </div>

                {step.cmp?.mode === 'polish-depth' && (
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Removed Polish Thickness (nm)
                    </label>
                    <input
                      type="number"
                      min="10"
                      step="25"
                      value={step.cmp?.depth ?? 300}
                      onChange={(e) =>
                        handleUpdate({
                          cmp: {
                            ...step.cmp!,
                            depth: parseFloat(e.target.value || '0'),
                          },
                        })
                      }
                      className="w-full px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 font-mono text-xs focus:outline-none focus:border-sky-500"
                    />
                  </div>
                )}

                {step.cmp?.mode === 'stop-on-layer' && (
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Stop Layer (e.g. Si3N4)
                    </label>
                    <select
                      value={step.cmp?.stopMaterialId || 'mat_si3n4'}
                      onChange={(e) =>
                        handleUpdate({
                          cmp: {
                            ...step.cmp!,
                            stopMaterialId: e.target.value,
                          },
                        })
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 text-xs focus:outline-none focus:border-sky-500"
                    >
                      {materials.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.formula})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Tab 2: Cleanroom Equipment & SOP Recipe */}
        {activeTab === 'equipment' && (
          <div className="space-y-3.5 bg-slate-950/70 p-3.5 rounded-xl border border-slate-800">
            <span className="text-xs font-semibold text-sky-400">
              Cleanroom Run-Sheet & Tool Parameters
            </span>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                Equipment / Tool Tag
              </label>
              <input
                type="text"
                value={step.toolRecipe?.toolName || ''}
                onChange={(e) => handleUpdateRecipe('toolName', e.target.value)}
                placeholder="e.g. Plasma-Therm 790 RIE, Tystar Furnace..."
                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 text-xs focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="flex items-center gap-1 text-[11px] text-slate-400 mb-1">
                  <Thermometer className="w-3 h-3 text-rose-400" />
                  <span>Temperature</span>
                </label>
                <input
                  type="text"
                  value={step.toolRecipe?.temperature || ''}
                  onChange={(e) => handleUpdateRecipe('temperature', e.target.value)}
                  placeholder="e.g. 950 °C"
                  className="w-full px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 font-mono text-xs focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="flex items-center gap-1 text-[11px] text-slate-400 mb-1">
                  <Gauge className="w-3 h-3 text-sky-400" />
                  <span>Chamber Pressure</span>
                </label>
                <input
                  type="text"
                  value={step.toolRecipe?.pressure || ''}
                  onChange={(e) => handleUpdateRecipe('pressure', e.target.value)}
                  placeholder="e.g. 20 mTorr"
                  className="w-full px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 font-mono text-xs focus:outline-none focus:border-sky-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="flex items-center gap-1 text-[11px] text-slate-400 mb-1">
                  <Zap className="w-3 h-3 text-amber-400" />
                  <span>RF / ICP Power</span>
                </label>
                <input
                  type="text"
                  value={step.toolRecipe?.power || ''}
                  onChange={(e) => handleUpdateRecipe('power', e.target.value)}
                  placeholder="e.g. 150 W RF"
                  className="w-full px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 font-mono text-xs focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="flex items-center gap-1 text-[11px] text-slate-400 mb-1">
                  <Clock className="w-3 h-3 text-emerald-400" />
                  <span>Process Duration</span>
                </label>
                <input
                  type="text"
                  value={step.toolRecipe?.duration || ''}
                  onChange={(e) => handleUpdateRecipe('duration', e.target.value)}
                  placeholder="e.g. 75 s"
                  className="w-full px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 font-mono text-xs focus:outline-none focus:border-sky-500"
                />
              </div>
            </div>

            <div>
              <label className="flex items-center gap-1 text-[11px] text-slate-400 mb-1">
                <Wind className="w-3 h-3 text-teal-400" />
                <span>Gas Flows (sccm)</span>
              </label>
              <input
                type="text"
                value={step.toolRecipe?.gases || ''}
                onChange={(e) => handleUpdateRecipe('gases', e.target.value)}
                placeholder="e.g. SF6: 30 sccm, O2: 5 sccm"
                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 font-mono text-xs focus:outline-none focus:border-sky-500"
              />
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                Metrology & Inspection Checkpoints
              </label>
              <textarea
                value={step.toolRecipe?.inspectionNotes || ''}
                onChange={(e) => handleUpdateRecipe('inspectionNotes', e.target.value)}
                rows={2}
                placeholder="e.g. Measure step height on Dektak stylus profilometer..."
                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 text-xs focus:outline-none focus:border-sky-500"
              />
            </div>
          </div>
        )}

        {/* Step Notes / Description */}
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">
            Process Step Notes
          </label>
          <textarea
            value={step.notes || ''}
            onChange={(e) => handleUpdate({ notes: e.target.value })}
            rows={2}
            placeholder="Cleanroom instructions, chemical precautions, target specs..."
            className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-sky-500"
          />
        </div>
      </div>
    </div>
  );
};
