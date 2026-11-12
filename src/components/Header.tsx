/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { ProcessFlow } from '../types/microfab';
import {
  Layers,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  FolderOpen,
  Save,
  Download,
  Upload,
  BookOpen,
  LayoutGrid,
  Sparkles,
  FileText,
  Sliders,
  PanelLeft,
  PanelRight,
  Scan,
} from 'lucide-react';

interface HeaderProps {
  flow: ProcessFlow;
  activeStepIndex: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onStepChange: (index: number) => void;
  onUpdateTitle: (title: string) => void;
  onOpenPresets: () => void;
  onOpenMaterials: () => void;
  onOpenMaskLevels: () => void;
  onOpenRunSheet: () => void;
  onOpenMultiStepView: () => void;
  onExportJson: () => void;
  onImportJson: (json: ProcessFlow) => void;
  leftSidebarOpen?: boolean;
  onToggleLeftSidebar?: () => void;
  rightSidebarOpen?: boolean;
  onToggleRightSidebar?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  flow,
  activeStepIndex,
  isPlaying,
  onTogglePlay,
  onStepChange,
  onUpdateTitle,
  onOpenPresets,
  onOpenMaterials,
  onOpenMaskLevels,
  onOpenRunSheet,
  onOpenMultiStepView,
  onExportJson,
  onImportJson,
  leftSidebarOpen = true,
  onToggleLeftSidebar,
  rightSidebarOpen = true,
  onToggleRightSidebar,
}) => {
  const [isEditingTitle, setIsEditingTitle] = useState<boolean>(false);
  const [titleInput, setTitleInput] = useState<string>(flow.title);

  useEffect(() => {
    setTitleInput(flow.title);
  }, [flow.title]);

  const handleTitleSubmit = () => {
    setIsEditingTitle(false);
    if (titleInput.trim()) {
      onUpdateTitle(titleInput.trim());
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (parsed.steps && parsed.substrateWidth) {
          onImportJson(parsed);
        } else {
          console.error('Invalid process flow JSON schema.');
        }
      } catch (err) {
        console.error('Failed to parse JSON file.', err);
      }
    };
    reader.readAsText(file);
  };

  return (
    <header className="flex items-center justify-between px-4 py-2.5 bg-slate-900 border-b border-slate-800 text-slate-200 shadow-md select-none">
      {/* Brand & Process Title */}
      <div className="flex items-center gap-3">
        {onToggleLeftSidebar && (
          <button
            onClick={onToggleLeftSidebar}
            className={`p-1.5 rounded-lg border transition-colors ${
              leftSidebarOpen
                ? 'bg-slate-800 text-sky-400 border-slate-700 hover:bg-slate-700'
                : 'bg-slate-900 text-slate-500 border-slate-800 hover:text-slate-300'
            }`}
            title={leftSidebarOpen ? 'Hide Flow Timeline' : 'Show Flow Timeline'}
          >
            <PanelLeft className="w-4 h-4" />
          </button>
        )}

        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-xl bg-gradient-to-tr from-sky-600 to-indigo-500 flex items-center justify-center text-white shadow-md shadow-sky-950/50">
            <Layers className="w-4 h-4" />
          </span>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-extrabold text-sm text-white tracking-wide">
                MicroFlow
              </span>
              <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20">
                CAD
              </span>
            </div>
            <span className="text-[10px] text-slate-400 block -mt-0.5">
              Microfab Process Designer
            </span>
          </div>
        </div>

        <span className="text-slate-700">|</span>

        {/* Process Title (Click to edit) */}
        {isEditingTitle ? (
          <input
            type="text"
            value={titleInput}
            onChange={(e) => setTitleInput(e.target.value)}
            onBlur={handleTitleSubmit}
            onKeyDown={(e) => e.key === 'Enter' && handleTitleSubmit()}
            autoFocus
            className="px-2 py-1 rounded bg-slate-950 border border-sky-500 text-sm font-semibold text-white focus:outline-none"
          />
        ) : (
          <div
            onClick={() => setIsEditingTitle(true)}
            className="group flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-slate-800 cursor-pointer transition-colors"
            title="Click to rename process"
          >
            <span className="text-sm font-semibold text-slate-100 group-hover:text-sky-300 transition-colors">
              {flow.title}
            </span>
            <span className="text-[10px] text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity">
              ✎
            </span>
          </div>
        )}
      </div>

      {/* Step Playback Controller */}
      <div className="flex items-center gap-2 bg-slate-950/80 border border-slate-800 rounded-xl px-3 py-1 text-xs">
        <button
          disabled={activeStepIndex <= -1}
          onClick={() => onStepChange(activeStepIndex - 1)}
          className="p-1 rounded text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
          title="Previous Step"
        >
          <SkipBack className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={onTogglePlay}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
            isPlaying
              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
              : 'bg-sky-600 hover:bg-sky-500 text-white shadow-sm'
          }`}
          title={isPlaying ? 'Pause Playback' : 'Play Process Sequence'}
        >
          {isPlaying ? (
            <>
              <Pause className="w-3 h-3 fill-current" />
              <span>Pause</span>
            </>
          ) : (
            <>
              <Play className="w-3 h-3 fill-current" />
              <span>Play Flow</span>
            </>
          )}
        </button>

        <button
          disabled={activeStepIndex >= flow.steps.length - 1}
          onClick={() => onStepChange(activeStepIndex + 1)}
          className="p-1 rounded text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
          title="Next Step"
        >
          <SkipForward className="w-3.5 h-3.5" />
        </button>

        <span className="text-slate-700">|</span>

        <span className="font-mono text-slate-300 text-[11px]">
          {activeStepIndex === -1
            ? `Substrate (Step 0 / ${flow.steps.length})`
            : `Step ${activeStepIndex + 1} / ${flow.steps.length}`}
        </span>
      </div>

      {/* Primary Actions & Modals */}
      <div className="flex items-center gap-2">
        <button
          onClick={onOpenPresets}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-xs font-medium transition-colors"
        >
          <FolderOpen className="w-3.5 h-3.5 text-sky-400" />
          <span>Presets</span>
        </button>

        <button
          onClick={onOpenMaterials}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-xs font-medium transition-colors"
        >
          <Sliders className="w-3.5 h-3.5 text-emerald-400" />
          <span>Materials</span>
        </button>

        <button
          onClick={onOpenMaskLevels}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-xs font-medium transition-colors"
          title="Photolithography Mask Levels & Apertures"
        >
          <Scan className="w-3.5 h-3.5 text-sky-400" />
          <span>Mask Levels</span>
        </button>

        <button
          onClick={onOpenRunSheet}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-xs font-medium transition-colors"
        >
          <FileText className="w-3.5 h-3.5 text-amber-400" />
          <span>Run Sheet SOP</span>
        </button>

        <button
          onClick={onOpenMultiStepView}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white text-xs font-semibold shadow-md transition-all"
        >
          <LayoutGrid className="w-3.5 h-3.5" />
          <span>Publication Figure</span>
        </button>

        {/* JSON Import / Export */}
        <div className="flex items-center gap-1 ml-1 bg-slate-800 p-0.5 rounded-lg border border-slate-700">
          <label
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-700 cursor-pointer transition-colors"
            title="Import Recipe JSON"
          >
            <Upload className="w-3.5 h-3.5" />
            <input
              type="file"
              accept=".json"
              onChange={handleFileInputChange}
              className="hidden"
            />
          </label>
          <button
            onClick={onExportJson}
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
            title="Export Recipe JSON"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        </div>

        {onToggleRightSidebar && (
          <button
            onClick={onToggleRightSidebar}
            className={`p-1.5 rounded-lg border transition-colors ml-1 ${
              rightSidebarOpen
                ? 'bg-slate-800 text-sky-400 border-slate-700 hover:bg-slate-700'
                : 'bg-slate-900 text-slate-500 border-slate-800 hover:text-slate-300'
            }`}
            title={rightSidebarOpen ? 'Hide Parameters Panel' : 'Show Parameters Panel'}
          >
            <PanelRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </header>
  );
};
