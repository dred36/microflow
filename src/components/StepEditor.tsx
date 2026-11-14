/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
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
} from '../types/microfab';
import { ThicknessUnit, getUnitLabel, formatThickness } from '../lib/units';
import { ThicknessInput } from './ThicknessInput';
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
} from 'lucide-react';

interface StepEditorProps {
  step: ProcessStep;
  waferWidth: number;
  materials: Material[];
  thicknessUnit?: ThicknessUnit;
  onUpdateStep: (updated: ProcessStep) => void;
  onOpenMaterialsModal: () => void;
  onMergeMaterials?: (materials: Material[]) => void;
  blocks?: ProcessBlock[];
  masks?: PhotomaskLevel[];
  onOpenMaskLevelsModal?: (maskId?: string) => void;
  onCreateBlock?: (name?: string) => void;
}

export const StepEditor: React.FC<StepEditorProps> = ({
  step,
  waferWidth,
  materials,
  thicknessUnit = 'nm',
  onUpdateStep,
  onOpenMaterialsModal,
  onMergeMaterials,
  blocks,
  masks,
  onOpenMaskLevelsModal,
  onCreateBlock,
}) => {
  const [activeTab, setActiveTab] = useState<'process' | 'equipment' | 'notes'>('process');
  const [isAddingBlockInline, setIsAddingBlockInline] = useState<boolean>(false);
  const [inlineBlockName, setInlineBlockName] = useState<string>('');
  const [isEditingMaskName, setIsEditingMaskName] = useState<boolean>(false);
  const [editingMaskName, setEditingMaskName] = useState<string>('');
  const [bondingImportError, setBondingImportError] = useState<string | null>(null);

  useEffect(() => {
    setIsEditingMaskName(false);
    setEditingMaskName(step.lithography?.maskName || '');
    setBondingImportError(null);
  }, [step.id, step.lithography?.maskName]);

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
                  const patch: Partial<ProcessStep> = {
                    type: newType,
                    thickness: step.thickness || 200,
                  };
                  if (newType === 'cmp' && !step.cmp) {
                    patch.cmp = {
                      operation: 'cmp',
                      mode: 'polish-depth',
                      depth: 300,
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
                  handleUpdate(patch);
                }}
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-200 text-xs font-medium focus:outline-none focus:border-sky-500"
              >
                <option value="deposition">Deposition / Thin Film Growth</option>
                <option value="lithography">Photolithography &amp; Patterning</option>
                <option value="etch">Etching (Dry RIE / Wet / Bosch DRIE)</option>
                <option value="strip">Strip / Sacrificial Release</option>
                <option value="liftoff">Metal Lift-off</option>
                <option value="cmp">Grind/Polish/Planarize (Grinding &amp; CMP)</option>
                <option value="bonding">Wafer Bonding (Substrate / Pre-Processed Flow)</option>
                <option value="anneal">Thermal Anneal / Drive-In</option>
                <option value="substrate">Substrate Initialization</option>
              </select>
            </div>

            {/* Wafer Processing Side Selector (Front / Back / Both) */}
            {step.type !== 'substrate' && step.type !== 'anneal' && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-slate-400">
                    {step.type === 'bonding' ? 'Bond Target Side' : 'Substrate Side'}
                  </label>
                  <span className="text-[10px] font-mono text-slate-500">
                    {(step.side || 'front') === 'front'
                      ? 'Top Surface (+Z)'
                      : step.side === 'back'
                      ? 'Backside (-Z)'
                      : 'Double-Sided (±Z)'}
                  </span>
                </div>
                <div
                  className={`grid ${
                    step.type === 'bonding' ? 'grid-cols-2' : 'grid-cols-3'
                  } gap-1 p-1 rounded-lg bg-slate-950 border border-slate-800 text-xs`}
                >
                  {(
                    [
                      { id: 'front' as ProcessSide, label: 'Front', icon: ArrowUp, activeClass: 'bg-sky-600 text-white shadow-sm' },
                      { id: 'back' as ProcessSide, label: 'Back', icon: ArrowDown, activeClass: 'bg-amber-600 text-white shadow-sm' },
                      ...(step.type === 'bonding'
                        ? []
                        : [{ id: 'both' as ProcessSide, label: 'Both Sides', icon: ArrowUpDown, activeClass: 'bg-emerald-600 text-white shadow-sm' }]),
                    ]
                  ).map((opt) => {
                    const currentSide: ProcessSide =
                      step.type === 'bonding' && step.side === 'both'
                        ? 'front'
                        : step.side || 'front';
                    const isActive = currentSide === opt.id;
                    const Icon = opt.icon;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => handleUpdate({ side: opt.id })}
                        className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md font-medium transition-all ${
                          isActive
                            ? opt.activeClass
                            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5 shrink-0" />
                        <span>{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

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
                      Film Thickness ({getUnitLabel(thicknessUnit)})
                    </label>
                    <ThicknessInput
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
                    <option value="directional">Directional (Line-of-sight, E-Beam)</option>
                    <option value="semi-conformal">Semi-Conformal (Custom sidewall coverage)</option>
                    <option value="spin-coat">Planarizing Spin-Coat (Fills valleys flat)</option>
                  </select>
                </div>

                {step.deposition?.depositionType === 'directional' && (
                  <div className="pt-2.5 border-t border-slate-800 space-y-2">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-300 font-medium">
                        Substrate Tilt Angle
                      </span>
                      <div className="flex items-center gap-2">
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
                            className="text-[10px] text-slate-400 hover:text-sky-400 underline"
                          >
                            Reset 0°
                          </button>
                        )}
                        <span className="font-mono text-sky-400">
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
                            className={`flex-1 py-1 rounded text-[10px] font-mono border transition-colors ${
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
                    <p className="text-[10px] text-slate-400 leading-snug">
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

                {((step.deposition?.depositionType || 'conformal') === 'conformal' ||
                  step.deposition?.depositionType === 'semi-conformal') && (
                  <div className="pt-2.5 border-t border-slate-800 space-y-2.5">
                    <label className="flex items-start gap-2 cursor-pointer">
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
                        <span className="text-[11px] font-medium text-slate-200 block">
                          Faster Deposition at Convex Corners
                        </span>
                        <span className="text-[10px] text-slate-400 leading-snug block">
                          Outer/convex step corners receive wider precursor flux and build thicker film (bread-loafing).
                        </span>
                      </div>
                    </label>

                    {step.deposition?.convexCornerEffect && (
                      <div>
                        <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                          <span>Corner Rate Boost</span>
                          <span className="font-mono text-sky-400">
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
                              maskColor: matchingMask.color,
                              polarity: matchingMask.polarity,
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

                  {/* Click-to-edit Assigned Mask Name */}
                  <div className="flex items-center justify-between gap-2 pt-0.5">
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
                        className="group/editmask flex items-center gap-1.5 text-xs font-mono text-slate-200 hover:text-white px-2 py-0.5 rounded bg-slate-950/60 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 transition-colors truncate min-w-0"
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
                      Resist Thickness ({getUnitLabel(thicknessUnit)})
                    </label>
                    <ThicknessInput
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
                      Etch Depth ({getUnitLabel(thicknessUnit)})
                    </label>
                    <ThicknessInput
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
                      className="w-full px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 font-mono text-xs focus:outline-none focus:border-sky-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Etch Mechanism
                    </label>
                    <select
                      value={step.etch?.etchType || 'rie'}
                      onChange={(e) => {
                        const nextEtchType = e.target.value as any;
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
                            isotropy:
                              nextEtchType === 'wet-isotropic'
                                ? 0.95
                                : nextEtchType === 'drie-bosch'
                                ? 0.02
                                : 0.05,
                            sidewallAngle:
                              nextEtchType === 'wet-koh'
                                ? 54.74
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
                    {(() => {
                      const isoVal =
                        step.etch?.isotropy ??
                        (step.etch?.etchType === 'wet-isotropic' ? 0.95 : 0.05);
                      const isKoh = step.etch?.etchType === 'wet-koh';
                      const angleLabel = `${step.etch?.sidewallAngle ?? 54.74}°`;
                      return (
                        <span className="font-mono text-amber-400">
                          {Math.round(isoVal * 100)}%{' '}
                          {isKoh
                            ? isoVal < 0.05
                              ? `(${angleLabel} Zero Undercut)`
                              : isoVal > 0.7
                              ? `(${angleLabel} High Lateral Undercut)`
                              : `(${angleLabel} Lateral Undercut)`
                            : isoVal < 0.1
                            ? '(Anisotropic Vertical)'
                            : isoVal > 0.7
                            ? '(Isotropic Circular Undercut)'
                            : '(Moderate Undercut)'}
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

                {/* Sidewall Taper Angle for RIE and DRIE */}
                {(['rie', 'drie-bosch'].includes(step.etch?.etchType || 'rie')) && (
                  <div className="pt-2.5 border-t border-slate-800 space-y-2">
                    <div className="flex justify-between text-[11px] text-slate-400">
                      <span>Sidewall Taper Angle</span>
                      {(() => {
                        const angleVal = step.etch?.sidewallAngle ?? 90;
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
                      min="80"
                      max="100"
                      step="0.5"
                      value={Math.max(80, Math.min(100, step.etch?.sidewallAngle ?? 90))}
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
                      {[80, 85, 88, 90, 95, 100].map((presetAngle) => {
                        const active =
                          Math.abs((step.etch?.sidewallAngle ?? 90) - presetAngle) < 0.25;
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
                            className={`flex-1 py-1 rounded text-[10px] font-mono border transition-colors ${
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
                  <div className="pt-2.5 border-t border-slate-800 space-y-2.5">
                    <label className="flex items-start gap-2 cursor-pointer">
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
                        <span className="text-[11px] font-medium text-slate-200 block">
                          Bosch DRIE Sidewall Scallops
                        </span>
                        <span className="text-[10px] text-slate-400 leading-snug block">
                          Periodic SF₆/C₄F₈ etch-passivation undulations along etched trench walls.
                        </span>
                      </div>
                    </label>

                    {step.etch?.scallopEffect && (
                      <div className="space-y-2.5 pl-1">
                        <div>
                          <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                            <span>Scallop Depth (Amplitude)</span>
                            <span className="font-mono text-amber-400">
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
                          <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                            <span>Scallop Pitch (Cycle Height)</span>
                            <span className="font-mono text-amber-400">
                              {formatThickness(step.etch?.scallopPitch ?? 200, thicknessUnit)} (~
                              {Math.max(
                                1,
                                Math.round(
                                  (step.etch?.depth ?? step.thickness ?? 300) /
                                    Math.max(20, step.etch?.scallopPitch ?? 200)
                                )
                              )}{' '}
                              cycles)
                            </span>
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
                      </div>
                    )}
                  </div>
                )}

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

                {/* Aspect Ratio Dependent Etching (ARDE / RIE Lag) for Dry Etching */}
                {(['rie', 'drie-bosch', 'ion-beam', 'ashing'].includes(
                  step.etch?.etchType || 'rie'
                )) && (
                  <div className="pt-2.5 border-t border-slate-800 space-y-2.5">
                    <label className="flex items-start gap-2 cursor-pointer">
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
                        <span className="text-[11px] font-medium text-slate-200 block">
                          Apply ARDE / RIE Lag Effect
                        </span>
                        <span className="text-[10px] text-slate-400 leading-snug block">
                          Narrow openings etch shallower than wide openings based on local feature aspect ratio.
                        </span>
                      </div>
                    </label>

                    {step.etch?.ardeEnabled && (
                      <div>
                        <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                          <span>RIE Lag Strength (k)</span>
                          <span className="font-mono text-amber-400">
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

                {/* Convex Corner Acceleration for Isotropic Etching */}
                {(step.etch?.etchType === 'wet-isotropic' ||
                  (step.etch?.isotropy ?? 0.05) >= 0.15) && (
                  <div className="pt-2.5 border-t border-slate-800 space-y-2.5">
                    <label className="flex items-start gap-2 cursor-pointer">
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
                        <span className="text-[11px] font-medium text-slate-200 block">
                          Faster Etch at Convex Corners
                        </span>
                        <span className="text-[10px] text-slate-400 leading-snug block">
                          Convex corners exposed to wider etchant solid angle etch faster, rounding sharp step edges.
                        </span>
                      </div>
                    </label>

                    {step.etch?.convexCornerEffect && (
                      <div>
                        <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                          <span>Corner Rate Boost</span>
                          <span className="font-mono text-amber-400">
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

            {/* Customization for Grind / Polish / Planarize (CMP & Grinding) */}
            {step.type === 'cmp' && (
              <div className="space-y-3.5 bg-slate-950/70 p-3.5 rounded-xl border border-slate-800">
                <span className="text-xs font-semibold text-cyan-400">
                  Grind / Polish / Planarize Parameters
                </span>

                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
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
                    className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 text-xs focus:outline-none focus:border-sky-500"
                  >
                    <option value="cmp">CMP Planarization (Chemical Mechanical Polish)</option>
                    <option value="grind">Mechanical Wafer Grinding / Thinning</option>
                    <option value="polish">Fine Lapping / Surface Polishing</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Removal / Planarization Mode
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
                    <option value="polish-depth">Fixed Removal Depth ({getUnitLabel(thicknessUnit)})</option>
                    <option value="stop-on-layer">Endpoint Stop on Barrier Layer</option>
                    <option value="target-height">Planarize to Absolute Z Plane ({getUnitLabel(thicknessUnit)})</option>
                  </select>
                </div>

                {(step.cmp?.mode || 'polish-depth') === 'polish-depth' && (
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Removed Thickness / Grind Depth ({getUnitLabel(thicknessUnit)})
                    </label>
                    <ThicknessInput
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
                      className="w-full px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 font-mono text-xs focus:outline-none focus:border-sky-500"
                    />
                  </div>
                )}

                {step.cmp?.mode === 'target-height' && (
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Target Z Plane Coordinate ({getUnitLabel(thicknessUnit)})
                    </label>
                    <ThicknessInput
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
                            ...(step.cmp || { mode: 'stop-on-layer' }),
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
                    if (parsed.materials && parsed.materials.length > 0 && onMergeMaterials) {
                      onMergeMaterials(parsed.materials);
                    }
                    updateBonding({
                      sourceType: 'imported-flow',
                      importedFlow: parsed,
                      importedFlowTitle: parsed.title || file.name,
                    });
                  } catch {
                    setBondingImportError('Could not parse JSON process file.');
                  }
                };
                reader.readAsText(file);
                e.target.value = '';
              };

              return (
                <div className="space-y-3.5 bg-slate-950/70 p-3.5 rounded-xl border border-slate-800">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-indigo-400 flex items-center gap-1.5">
                      <Link2 className="w-3.5 h-3.5" />
                      <span>Wafer Bonding Parameters</span>
                    </span>
                  </div>

                  {/* Bonding Method */}
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Bonding Mechanism
                    </label>
                    <select
                      value={bondCfg.bondingMethod || 'fusion'}
                      onChange={(e) =>
                        updateBonding({ bondingMethod: e.target.value as any })
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 text-xs focus:outline-none focus:border-sky-500"
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
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Bonded Substrate Source
                    </label>
                    <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-slate-900 border border-slate-800 text-[11px]">
                      <button
                        type="button"
                        onClick={() => updateBonding({ sourceType: 'custom-substrate' })}
                        className={`py-1.5 px-2 rounded-md font-medium transition-colors ${
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
                        className={`py-1.5 px-2 rounded-md font-medium transition-colors ${
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
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Incoming Wafer Mating Face
                    </label>
                    <select
                      value={bondCfg.incomingFace || 'front'}
                      onChange={(e) =>
                        updateBonding({ incomingFace: e.target.value as 'front' | 'back' })
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 text-xs focus:outline-none focus:border-sky-500"
                    >
                      <option value="front">Frontside Face (Face-to-Face / Flip-Chip)</option>
                      <option value="back">Backside Face (Face-to-Back Stacking)</option>
                    </select>
                  </div>

                  {/* Source 1: Newly User-Defined Substrate Stack */}
                  {bondCfg.sourceType === 'custom-substrate' && (
                    <div className="space-y-2.5 pt-2 border-t border-slate-800">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-slate-300">
                          Bonded Substrate Stack ({customLayers.length}{' '}
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
                          className="flex items-center gap-1 px-2 py-0.5 rounded bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-medium"
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
                            className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] text-slate-300 hover:text-white transition-colors"
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>

                      {/* Layer cards (rendered top surface first) */}
                      <div className="space-y-2 max-h-56 overflow-y-auto pr-0.5">
                        {[...customLayers].reverse().map((layer, revIdx) => {
                          const actualIdx = customLayers.length - 1 - revIdx;
                          return (
                            <div
                              key={layer.id}
                              className="p-2 rounded-lg bg-slate-900 border border-slate-800 space-y-1.5"
                            >
                              <div className="flex items-center justify-between gap-1.5">
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
                                  className="p-1 rounded text-slate-400 hover:text-rose-400 disabled:opacity-20"
                                  title="Remove Layer"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>

                              <div className="grid grid-cols-2 gap-2">
                                <select
                                  value={layer.materialId}
                                  onChange={(e) => {
                                    const next = customLayers.map((l, i) =>
                                      i === actualIdx ? { ...l, materialId: e.target.value } : l
                                    );
                                    updateBonding({ customLayers: next });
                                  }}
                                  className="px-2 py-1 rounded bg-slate-950 border border-slate-700 text-[11px] text-slate-200 focus:outline-none focus:border-sky-500"
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
                                    className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 text-[11px] font-mono text-white focus:outline-none focus:border-sky-500"
                                  />
                                  <span className="text-[10px] text-slate-500">
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
                    <div className="space-y-2.5 pt-2 border-t border-slate-800">
                      <label className="flex items-center justify-center gap-2 w-full py-2.5 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 border border-dashed border-indigo-500/60 hover:border-indigo-400 text-xs font-medium text-indigo-300 cursor-pointer transition-colors">
                        <Upload className="w-4 h-4 shrink-0" />
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
                        <div className="p-2 rounded-lg bg-rose-950/50 border border-rose-500/40 text-[11px] text-rose-300">
                          {bondingImportError}
                        </div>
                      )}

                      {bondCfg.importedFlow ? (
                        <div className="p-2.5 rounded-lg bg-slate-900 border border-emerald-500/40 space-y-1.5 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-emerald-300 flex items-center gap-1.5 truncate">
                              <FileCheck className="w-3.5 h-3.5 shrink-0" />
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
                                })
                              }
                              className="text-[10px] text-slate-400 hover:text-rose-400 shrink-0"
                            >
                              Clear
                            </button>
                          </div>
                          <div className="text-[10px] font-mono text-slate-400 flex items-center justify-between">
                            <span>
                              {bondCfg.importedFlow.steps.filter((s) => s.enabled).length} enabled steps simulated
                            </span>
                            <span>
                              Width: {(bondCfg.importedFlow.substrateWidth / 1000).toFixed(1)} µm
                            </span>
                          </div>
                        </div>
                      ) : (
                        <p className="text-[11px] text-slate-500 italic leading-relaxed">
                          Upload an exported MicroFlow <span className="font-mono">.json</span> process file. All its enabled fabrication steps will be simulated and bonded onto the selected side.
                        </p>
                      )}

                      <label className="flex items-start gap-2 pt-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean(bondCfg.mirrorHorizontal)}
                          onChange={(e) =>
                            updateBonding({ mirrorHorizontal: e.target.checked })
                          }
                          className="mt-0.5 rounded bg-slate-800 border-slate-700 text-indigo-500 focus:ring-0"
                        />
                        <div>
                          <span className="text-[11px] font-medium text-slate-200 flex items-center gap-1.5">
                            <FlipHorizontal2 className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                            <span>Mirror Pre-Processed Substrate (Left ↔ Right)</span>
                          </span>
                          <span className="text-[10px] text-slate-400 leading-snug block">
                            Mirrors the imported wafer horizontally across X (useful for flipping asymmetric structures during bonding).
                          </span>
                        </div>
                      </label>
                    </div>
                  )}

                  {/* Optional Bonding Interface Seam Layer */}
                  <div className="pt-2 border-t border-slate-800 space-y-2">
                    <label className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer">
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
                      <div className="grid grid-cols-2 gap-2">
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
                          className="px-2 py-1 rounded bg-slate-900 border border-slate-700 text-[11px] text-slate-200 focus:outline-none focus:border-sky-500"
                        >
                          {materials.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                        <div className="flex items-center gap-1">
                          <ThicknessInput
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
                            className="w-full px-2 py-1 rounded bg-slate-900 border border-slate-700 text-[11px] font-mono text-white focus:outline-none focus:border-sky-500"
                          />
                          <span className="text-[10px] text-slate-500">
                            {getUnitLabel(thicknessUnit)}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
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
