/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ProcessFlow, ProcessStep, Material } from './types/microfab';
import { PRESET_PROCESS_FLOWS } from './lib/presets';
import { simulateCrossSection, buildRenderPolygons } from './lib/simulationEngine';
import { Header } from './components/Header';
import { ProcessFlowSidebar } from './components/ProcessFlowSidebar';
import { CrossSectionCanvas } from './components/CrossSectionCanvas';
import { MaskEditor } from './components/MaskEditor';
import { StepEditor } from './components/StepEditor';
import { MultiStepFlowView } from './components/MultiStepFlowView';
import { MaterialsModal } from './components/MaterialsModal';
import { RunSheetModal } from './components/RunSheetModal';
import { PresetPickerModal } from './components/PresetPickerModal';
import { MaskLevelsModal } from './components/MaskLevelsModal';
import { SubstrateEditor } from './components/SubstrateEditor';
import { ensureFlowMasks, syncStepWindowsToMask } from './lib/maskUtils';
import { ensureFlowBlocks, createBlock, assignStepToBlock } from './lib/blockUtils';
import { ThicknessUnit } from './lib/units';

export default function App() {
  // Load initial process from localStorage if present, or fallback to CMOS preset
  const [flow, setFlow] = useState<ProcessFlow>(() => {
    try {
      const saved = localStorage.getItem('microflow_current_flow') || localStorage.getItem('etchflow_current_flow');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.steps?.length > 0) {
          // ensure substrateLayers exists
          if (!parsed.substrateLayers || parsed.substrateLayers.length === 0) {
            parsed.substrateLayers = [
              {
                id: 'sub_default',
                name: 'Silicon <100> Substrate',
                materialId: parsed.substrateMaterialId || 'mat_si_sub',
                thickness: parsed.substrateThickness || 3000,
              },
            ];
          }
          return ensureFlowBlocks(ensureFlowMasks(parsed));
        }
      }
    } catch (e) {
      // ignore
    }
    return ensureFlowBlocks(ensureFlowMasks(PRESET_PROCESS_FLOWS[0]));
  });

  const [activeStepIndex, setActiveStepIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playSpeed, setPlaySpeed] = useState<number>(1);
  const [thicknessUnit, setThicknessUnit] = useState<ThicknessUnit>(() => {
    try {
      const saved = localStorage.getItem('microflow_thickness_unit');
      if (saved === 'um' || saved === 'nm') return saved;
    } catch {
      // ignore
    }
    return 'nm';
  });

  // Modals state
  const [showPresets, setShowPresets] = useState<boolean>(false);
  const [showMaterials, setShowMaterials] = useState<boolean>(false);
  const [showMaskLevels, setShowMaskLevels] = useState<boolean>(false);
  const [focusMaskId, setFocusMaskId] = useState<string | undefined>(undefined);
  const [showRunSheet, setShowRunSheet] = useState<boolean>(false);
  const [showMultiStep, setShowMultiStep] = useState<boolean>(false);

  // Panel visibility state for flexible layout and maximized wafer canvas
  const [leftSidebarOpen, setLeftSidebarOpen] = useState<boolean>(true);
  const [rightSidebarOpen, setRightSidebarOpen] = useState<boolean>(true);

  // Save to localStorage on changes
  useEffect(() => {
    try {
      localStorage.setItem('microflow_current_flow', JSON.stringify(flow));
    } catch (e) {
      // ignore
    }
  }, [flow]);

  useEffect(() => {
    try {
      localStorage.setItem('microflow_thickness_unit', thicknessUnit);
    } catch {
      // ignore
    }
  }, [thicknessUnit]);

  // Handle Playback animation with adjustable speed
  useEffect(() => {
    if (!isPlaying) return;
    const intervalMs = Math.max(150, Math.round(1800 / playSpeed));
    const interval = setInterval(() => {
      setActiveStepIndex((prev) => {
        if (prev >= flow.steps.length - 1) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, intervalMs);
    return () => clearInterval(interval);
  }, [isPlaying, flow.steps.length, playSpeed]);

  const handleTogglePlay = () => {
    if (!isPlaying && flow.steps.length > 0 && activeStepIndex >= flow.steps.length - 1) {
      setActiveStepIndex(0);
      setIsPlaying(true);
    } else {
      setIsPlaying((prev) => !prev);
    }
  };

  // Clamp activeStepIndex if steps count changes
  useEffect(() => {
    if (activeStepIndex >= flow.steps.length) {
      setActiveStepIndex(Math.max(-1, flow.steps.length - 1));
    }
  }, [flow.steps.length, activeStepIndex]);

  // Compute simulation mesh and polygons for the active step
  const activeMesh = useMemo(() => {
    return simulateCrossSection(flow, activeStepIndex);
  }, [flow, activeStepIndex]);

  const activePolygons = useMemo(() => {
    return buildRenderPolygons(activeMesh, flow.materials);
  }, [activeMesh, flow.materials]);

  const isSubstrateActive = activeStepIndex === -1;
  const activeStep = !isSubstrateActive ? flow.steps[activeStepIndex] : undefined;

  // Handlers
  const handleUpdateStep = (updatedStep: ProcessStep) => {
    if (activeStepIndex < 0) return;
    const prevStep = flow.steps[activeStepIndex];
    const blockChanged = prevStep && updatedStep.blockId !== prevStep.blockId;

    // Preserve previous blockId temporarily if changed so assignStepToBlock can cleanly detect old vs new block
    const patchedStep = blockChanged ? { ...updatedStep, blockId: prevStep.blockId } : updatedStep;
    const updatedSteps = flow.steps.map((s, idx) =>
      idx === activeStepIndex ? patchedStep : s
    );
    let updatedFlow = { ...flow, steps: updatedSteps };
    if (updatedStep.type === 'lithography') {
      updatedFlow = syncStepWindowsToMask(updatedFlow, updatedStep);
    }

    if (blockChanged) {
      updatedFlow = assignStepToBlock(updatedFlow, updatedStep.id, updatedStep.blockId || null);
      const newIdx = updatedFlow.steps.findIndex((s) => s.id === updatedStep.id);
      if (newIdx >= 0 && newIdx !== activeStepIndex) {
        setActiveStepIndex(newIdx);
      }
    }

    setFlow(updatedFlow);
  };

  const handleUpdateTitle = (title: string) => {
    setFlow({ ...flow, title });
  };

  const handleSelectPreset = (preset: ProcessFlow) => {
    setFlow(ensureFlowBlocks(ensureFlowMasks(preset)));
    setActiveStepIndex(0);
    setIsPlaying(false);
    setShowPresets(false);
  };

  const handleUpdateMaterials = (updatedMats: Material[]) => {
    setFlow({ ...flow, materials: updatedMats });
  };

  const handleExportJson = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(flow, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute(
      'download',
      `${flow.title.toLowerCase().replace(/\s+/g, '_')}_recipe.json`
    );
    downloadAnchor.click();
  };

  const handleImportJson = (newFlow: ProcessFlow) => {
    // ensure substrateLayers exists
    if (!newFlow.substrateLayers || newFlow.substrateLayers.length === 0) {
      newFlow.substrateLayers = [
        {
          id: 'sub_default',
          name: 'Silicon <100> Substrate',
          materialId: newFlow.substrateMaterialId || 'mat_si_sub',
          thickness: newFlow.substrateThickness || 3000,
        },
      ];
    }
    setFlow(ensureFlowBlocks(ensureFlowMasks(newFlow)));
    setActiveStepIndex(0);
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-950 text-slate-100 font-sans">
      {/* Top Application Header */}
      <Header
        flow={flow}
        activeStepIndex={activeStepIndex}
        isPlaying={isPlaying}
        playSpeed={playSpeed}
        onChangePlaySpeed={setPlaySpeed}
        thicknessUnit={thicknessUnit}
        onChangeThicknessUnit={setThicknessUnit}
        onTogglePlay={handleTogglePlay}
        onStepChange={(idx) => {
          setActiveStepIndex(idx);
          setIsPlaying(false);
        }}
        onUpdateTitle={handleUpdateTitle}
        onOpenPresets={() => setShowPresets(true)}
        onOpenMaterials={() => setShowMaterials(true)}
        onOpenMaskLevels={() => {
          setFocusMaskId(undefined);
          setShowMaskLevels(true);
        }}
        onOpenRunSheet={() => setShowRunSheet(true)}
        onOpenMultiStepView={() => setShowMultiStep(true)}
        onExportJson={handleExportJson}
        onImportJson={handleImportJson}
        leftSidebarOpen={leftSidebarOpen}
        onToggleLeftSidebar={() => setLeftSidebarOpen(!leftSidebarOpen)}
        rightSidebarOpen={rightSidebarOpen}
        onToggleRightSidebar={() => setRightSidebarOpen(!rightSidebarOpen)}
      />

      {/* Main 3-Column CAD Workspace */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left: Process Flow Timeline */}
        {leftSidebarOpen && (
          <aside className="w-72 xl:w-80 flex-shrink-0 h-full border-r border-slate-800">
            <ProcessFlowSidebar
              flow={flow}
              activeStepIndex={activeStepIndex}
              thicknessUnit={thicknessUnit}
              onSelectStepIndex={(idx) => {
                setActiveStepIndex(idx);
                setIsPlaying(false);
              }}
              onUpdateFlow={setFlow}
              onOpenPresets={() => setShowPresets(true)}
            />
          </aside>
        )}

        {/* Center: Canvas Viewport & Photomask Track */}
        <main className="flex-1 flex flex-col h-full bg-[#030712] p-2.5 sm:p-3 overflow-hidden space-y-2.5 sm:space-y-3 min-w-0">
          {/* Photomask Aperture Editor (Active if current step is Lithography) */}
          {activeStep && activeStep.type === 'lithography' && (
            <div className="flex-shrink-0">
              <MaskEditor
                step={activeStep}
                waferWidth={flow.substrateWidth}
                onUpdateStep={handleUpdateStep}
                onOpenMaskLevels={() => {
                  setFocusMaskId(activeStep.lithography?.maskId);
                  setShowMaskLevels(true);
                }}
              />
            </div>
          )}

          {/* Interactive Cross-Section Canvas */}
          <div className="flex-1 min-h-0">
            <CrossSectionCanvas
              mesh={activeMesh}
              polygons={activePolygons}
              materials={flow.materials}
              waferWidth={flow.substrateWidth}
              thicknessUnit={thicknessUnit}
              title={flow.title}
              stepNumber={isSubstrateActive ? 0 : activeStepIndex + 1}
              totalSteps={flow.steps.length}
              activeStepTitle={
                isSubstrateActive
                  ? 'Multi-Layer Starting Substrate Stack'
                  : activeStep?.title
              }
              activeStepSide={isSubstrateActive ? undefined : activeStep?.side}
            />
          </div>
        </main>

        {/* Right: Substrate Layer Editor OR Step Deep Parameters Editor */}
        {rightSidebarOpen && (
          <aside className="w-80 xl:w-96 flex-shrink-0 h-full border-l border-slate-800">
            {isSubstrateActive ? (
              <SubstrateEditor
                flow={flow}
                thicknessUnit={thicknessUnit}
                onUpdateFlow={setFlow}
                onOpenMaterialsModal={() => setShowMaterials(true)}
              />
            ) : activeStep ? (
              <StepEditor
                step={activeStep}
                waferWidth={flow.substrateWidth}
                materials={flow.materials}
                thicknessUnit={thicknessUnit}
                onUpdateStep={handleUpdateStep}
                onOpenMaterialsModal={() => setShowMaterials(true)}
                onMergeMaterials={(incomingMats) => {
                  const existingIds = new Set(flow.materials.map((m) => m.id));
                  const missing = incomingMats.filter((m) => !existingIds.has(m.id));
                  if (missing.length > 0) {
                    setFlow((prev) => {
                      const prevIds = new Set(prev.materials.map((m) => m.id));
                      const toAdd = incomingMats.filter((m) => !prevIds.has(m.id));
                      if (toAdd.length === 0) return prev;
                      return { ...prev, materials: [...prev.materials, ...toAdd] };
                    });
                  }
                }}
                blocks={flow.blocks}
                masks={flow.masks}
                onOpenMaskLevelsModal={(maskId) => {
                  setFocusMaskId(maskId);
                  setShowMaskLevels(true);
                }}
                onCreateBlock={(name) => {
                  const { flow: updated, block: newBlock } = createBlock(flow, name);
                  const currentStep = updated.steps[activeStepIndex];
                  if (currentStep) {
                    const assignedFlow = assignStepToBlock(updated, currentStep.id, newBlock.id);
                    const newIdx = assignedFlow.steps.findIndex((s) => s.id === currentStep.id);
                    setFlow(assignedFlow);
                    if (newIdx >= 0 && newIdx !== activeStepIndex) {
                      setActiveStepIndex(newIdx);
                    }
                  } else {
                    setFlow(updated);
                  }
                }}
              />
            ) : null}
          </aside>
        )}
      </div>

      {/* Modals */}
      {showPresets && (
        <PresetPickerModal
          onSelectPreset={handleSelectPreset}
          onClose={() => setShowPresets(false)}
        />
      )}

      {showMaterials && (
        <MaterialsModal
          materials={flow.materials}
          onUpdateMaterials={handleUpdateMaterials}
          onClose={() => setShowMaterials(false)}
        />
      )}

      {showMaskLevels && (
        <MaskLevelsModal
          flow={flow}
          isOpen={showMaskLevels}
          onClose={() => setShowMaskLevels(false)}
          onUpdateFlow={setFlow}
          onSelectStepIndex={(idx) => {
            setActiveStepIndex(idx);
            setIsPlaying(false);
          }}
          initialMaskId={focusMaskId}
        />
      )}

      {showRunSheet && (
        <RunSheetModal
          flow={flow}
          thicknessUnit={thicknessUnit}
          onClose={() => setShowRunSheet(false)}
        />
      )}

      {showMultiStep && (
        <MultiStepFlowView
          flow={flow}
          thicknessUnit={thicknessUnit}
          onSelectStepIndex={(idx) => setActiveStepIndex(idx)}
          onClose={() => setShowMultiStep(false)}
        />
      )}
    </div>
  );
}
