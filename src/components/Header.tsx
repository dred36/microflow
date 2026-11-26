/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { ProcessFlow } from '../types/microfab';
import { ThicknessUnit } from '../lib/units';
import {
  Layers,
  FolderOpen,
  Download,
  Upload,
  LayoutGrid,
  FileText,
  Sliders,
  PanelLeft,
  Scan,
  Menu,
  X,
  FlaskConical,
  Info,
  Variable,
  GitBranch,
  Maximize,
  Minimize,
  Files,
  FileSpreadsheet,
  FileInput,
  HelpCircle,
} from 'lucide-react';

interface HeaderProps {
  flow: ProcessFlow;
  thicknessUnit: ThicknessUnit;
  onChangeThicknessUnit: (unit: ThicknessUnit) => void;
  onUpdateTitle: (title: string) => void;
  onUpdateDescription?: (description: string) => void;
  onOpenPresets: () => void;
  onOpenImportFlow?: (initialMode?: 'steps-and-masks' | 'masks-only') => void;
  onOpenMaterials: () => void;
  onOpenEtchLibrary: () => void;
  onOpenMaskLevels: () => void;
  onOpenVariables?: () => void;
  variableCount?: number;
  onOpenVariantManager?: () => void;
  variantStepCount?: number;
  onOpenRunSheet: () => void;
  onOpenMultiStepView: () => void;
  onOpenBatchExport?: () => void;
  onOpenAbout: () => void;
  onOpenHelp?: () => void;
  onExportJson: () => void;
  onExportCsv?: () => void;
  onImportJson: (json: ProcessFlow) => void;
  leftSidebarOpen?: boolean;
  onToggleLeftSidebar?: () => void;
  rightSidebarOpen?: boolean;
  onToggleRightSidebar?: () => void;
  isFullScreen?: boolean;
  onToggleFullScreen?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  flow,
  thicknessUnit,
  onChangeThicknessUnit,
  onUpdateTitle,
  onUpdateDescription,
  onOpenPresets,
  onOpenImportFlow,
  onOpenMaterials,
  onOpenEtchLibrary,
  onOpenMaskLevels,
  onOpenVariables,
  variableCount = 0,
  onOpenVariantManager,
  variantStepCount = 0,
  onOpenRunSheet,
  onOpenMultiStepView,
  onOpenBatchExport,
  onOpenAbout,
  onOpenHelp,
  onExportJson,
  onExportCsv,
  onImportJson,
  leftSidebarOpen = true,
  onToggleLeftSidebar,
  rightSidebarOpen = true,
  onToggleRightSidebar,
  isFullScreen = false,
  onToggleFullScreen,
}) => {
  const [isEditingTitle, setIsEditingTitle] = useState<boolean>(false);
  const [titleInput, setTitleInput] = useState<string>(flow.title);
  const [descOpen, setDescOpen] = useState<boolean>(false);
  const [descDraft, setDescDraft] = useState<string>(flow.description || '');
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const descRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTitleInput(flow.title);
  }, [flow.title]);

  useEffect(() => {
    setDescDraft(flow.description || '');
  }, [flow.description]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMobileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (!descOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (descRef.current && !descRef.current.contains(e.target as Node)) {
        setDescOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [descOpen]);

  const handleTitleSubmit = () => {
    setIsEditingTitle(false);
    if (titleInput.trim()) {
      onUpdateTitle(titleInput.trim());
    }
  };

  const handleDescriptionSave = () => {
    onUpdateDescription?.(descDraft.trim());
    setDescOpen(false);
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
    e.target.value = '';
    setMobileMenuOpen(false);
  };

  return (
    <header className="flex flex-wrap items-center justify-between gap-2 px-2.5 sm:px-4 py-2 bg-slate-900 border-b border-slate-800 text-slate-200 shadow-md select-none shrink-0 relative z-40">
      {/* Brand & Process Title */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1 xl:flex-initial">
        {(onToggleLeftSidebar || onToggleRightSidebar) && (
          <div className="flex items-center gap-1 shrink-0">
            {onToggleLeftSidebar && (
              <button
                onClick={onToggleLeftSidebar}
                className={`p-1.5 rounded-lg border transition-colors shrink-0 ${
                  leftSidebarOpen
                    ? 'bg-slate-800 text-sky-400 border-slate-700 hover:bg-slate-700'
                    : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                }`}
                title={leftSidebarOpen ? 'Hide Flow Timeline' : 'Show Flow Timeline'}
              >
                <PanelLeft className="w-4 h-4" />
              </button>
            )}
            {onToggleRightSidebar && (
              <button
                onClick={onToggleRightSidebar}
                className={`p-1.5 rounded-lg border transition-colors shrink-0 ${
                  rightSidebarOpen
                    ? 'bg-slate-800 text-sky-400 border-slate-700 hover:bg-slate-700'
                    : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                }`}
                title={rightSidebarOpen ? 'Hide Parameters Panel' : 'Show Parameters Panel'}
              >
                <Sliders className="w-4 h-4" />
              </button>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 shrink-0">
          <span className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-gradient-to-tr from-sky-600 to-indigo-500 flex items-center justify-center text-white shadow-md shadow-sky-950/50">
            <Layers className="w-4 h-4" />
          </span>
          <div className="hidden sm:block">
            <div className="flex items-center gap-1.5">
              <span className="font-extrabold text-sm text-white tracking-wide">
                MicroFlow
              </span>
              <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20">
                CAD
              </span>
            </div>
            <span className="text-[10px] text-slate-400 hidden md:block -mt-0.5">
              Microfab Process Designer
            </span>
          </div>
          <button
            type="button"
            onClick={onOpenAbout}
            className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-sky-400 hover:text-sky-300 border border-slate-700/80 transition-colors shrink-0"
            title="About this app — App dependencies, local privacy & no-AI disclaimer"
            aria-label="About this app"
          >
            <Info className="w-3.5 h-3.5" />
          </button>
          {onOpenHelp && (
            <button
              type="button"
              onClick={onOpenHelp}
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700/80 text-xs font-medium transition-colors shrink-0"
              title="Open MicroFlow CAD Help Guide & Shortcuts"
              aria-label="Help Guide"
            >
              <HelpCircle className="w-3.5 h-3.5 text-sky-400" />
              <span className="hidden md:inline">Help</span>
            </button>
          )}
        </div>

        <span className="text-slate-700 hidden sm:inline">|</span>

        {/* Process Title & Custom Description */}
        <div className="flex items-center gap-1 min-w-0">
          {isEditingTitle ? (
            <input
              type="text"
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              onBlur={handleTitleSubmit}
              onKeyDown={(e) => e.key === 'Enter' && handleTitleSubmit()}
              autoFocus
              className="px-2 py-1 rounded bg-slate-950 border border-sky-500 text-xs sm:text-sm font-semibold text-white focus:outline-none min-w-0 max-w-[160px] sm:max-w-[220px]"
            />
          ) : (
            <div
              onClick={() => setIsEditingTitle(true)}
              className="group flex items-center gap-1 px-1.5 sm:px-2 py-1 rounded-lg hover:bg-slate-800 cursor-pointer transition-colors min-w-0"
              title="Click to rename process"
            >
              <span className="text-xs sm:text-sm font-semibold text-slate-100 group-hover:text-sky-300 transition-colors truncate max-w-[130px] sm:max-w-[200px] lg:max-w-[240px]">
                {flow.title}
              </span>
              <span className="text-[10px] text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                ✎
              </span>
            </div>
          )}

          {onUpdateDescription && (
            <div className="relative shrink-0" ref={descRef}>
              <button
                type="button"
                onClick={() => {
                  setDescDraft(flow.description || '');
                  setDescOpen((v) => !v);
                }}
                className={`flex items-center gap-1 px-1.5 py-1 rounded-md border text-[11px] font-medium transition-colors ${
                  descOpen || (flow.description && flow.description.trim().length > 0)
                    ? 'bg-sky-950/40 border-sky-500/40 text-sky-300 hover:bg-sky-950/60'
                    : 'bg-slate-800/70 border-slate-700/70 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
                title={
                  flow.description?.trim()
                    ? `Process Description: ${flow.description}`
                    : 'Add custom process description (shown when importing and in Run Sheet SOP)'
                }
              >
                <FileText className="w-3 h-3" />
                <span className="hidden 2xl:inline">
                  {flow.description?.trim() ? 'Notes' : 'Add Desc'}
                </span>
              </button>

              {descOpen && (
                <div className="fixed left-3 right-3 top-14 sm:absolute sm:left-0 sm:right-auto sm:top-auto sm:mt-1.5 sm:w-96 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl p-3 z-50 space-y-2.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-white">
                      Custom Process Description
                    </span>
                    <button
                      type="button"
                      onClick={() => setDescOpen(false)}
                      className="p-0.5 rounded text-slate-400 hover:text-white"
                      aria-label="Close description editor"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <textarea
                    rows={4}
                    autoFocus
                    value={descDraft}
                    onChange={(e) => setDescDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                        handleDescriptionSave();
                      } else if (e.key === 'Escape') {
                        setDescOpen(false);
                      }
                    }}
                    placeholder="Describe what this process flow fabricates, key targets, or module notes..."
                    className="w-full px-2.5 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 placeholder-slate-500 text-xs leading-relaxed focus:outline-none focus:border-sky-500 resize-y"
                  />

                  <p className="text-[10.5px] text-slate-400 leading-snug">
                    Saved in recipe JSON and shown in the Import Flow preview and Run Sheet SOP.
                  </p>

                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-800">
                    <button
                      type="button"
                      onClick={() => setDescDraft('')}
                      disabled={!descDraft}
                      className="text-[11px] text-slate-400 hover:text-rose-300 disabled:opacity-35"
                    >
                      Clear
                    </button>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setDescOpen(false)}
                        className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px]"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleDescriptionSave}
                        className="px-2.5 py-1 rounded-md bg-sky-600 hover:bg-sky-500 text-white font-semibold text-[11px]"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Primary Actions & Modals */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        {/* Base Thickness Unit Switcher */}
        <div
          className="flex items-center bg-slate-950/90 border border-slate-700/80 rounded-lg p-0.5 text-[11px]"
          title="Base Unit for Thicknesses (nm or µm)"
        >
          <span className="px-1.5 text-[10px] text-slate-400 font-mono hidden 2xl:inline">
            Unit:
          </span>
          <button
            type="button"
            onClick={() => onChangeThicknessUnit('nm')}
            className={`px-1.5 sm:px-2 py-1 rounded-md font-mono font-semibold transition-colors ${
              thicknessUnit === 'nm'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            nm
          </button>
          <button
            type="button"
            onClick={() => onChangeThicknessUnit('um')}
            className={`px-1.5 sm:px-2 py-1 rounded-md font-mono font-semibold transition-colors ${
              thicknessUnit === 'um'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            µm
          </button>
        </div>

        {/* Tablet quick shortcut for Masks (hidden on phone and desktop xl+) */}
        <button
          onClick={onOpenMaskLevels}
          className="hidden sm:flex xl:hidden items-center gap-1 px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-xs font-medium transition-colors"
          title="Photolithography Mask Levels & 2D GDS"
        >
          <Scan className="w-3.5 h-3.5 text-sky-400" />
          <span>Masks</span>
        </button>

        {/* Full Desktop Action Bar (xl+) */}
        <div className="hidden xl:flex items-center gap-1.5">
          <button
            onClick={onOpenPresets}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-xs font-medium transition-colors"
          >
            <FolderOpen className="w-3.5 h-3.5 text-sky-400" />
            <span>Presets</span>
          </button>

          {onOpenImportFlow && (
            <button
              type="button"
              onClick={() => onOpenImportFlow('steps-and-masks')}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-xs font-medium transition-colors"
              title="Preview & import selected steps or masks from another flow"
            >
              <FileInput className="w-3.5 h-3.5 text-emerald-400" />
              <span>Import Flow</span>
            </button>
          )}

          <button
            onClick={onOpenMaterials}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-xs font-medium transition-colors"
          >
            <Sliders className="w-3.5 h-3.5 text-emerald-400" />
            <span>Materials</span>
          </button>

          <button
            onClick={onOpenEtchLibrary}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-xs font-medium transition-colors"
            title="Etch Rate & Chemistry Library"
          >
            <FlaskConical className="w-3.5 h-3.5 text-amber-400" />
            <span>Etch Rates</span>
          </button>

          <button
            onClick={onOpenMaskLevels}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-xs font-medium transition-colors"
            title="Photolithography Mask Levels & Apertures"
          >
            <Scan className="w-3.5 h-3.5 text-sky-400" />
            <span>Mask Levels</span>
          </button>

          {onOpenVariables && (
            <button
              onClick={onOpenVariables}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-xs font-medium transition-colors"
              title="Design Variables & Parametric Geometries"
            >
              <Variable className="w-3.5 h-3.5 text-violet-400" />
              <span>Variables</span>
              {variableCount > 0 && (
                <span className="px-1 py-0.2 rounded bg-violet-500/20 text-violet-300 border border-violet-500/40 font-mono text-[10px]">
                  {variableCount}
                </span>
              )}
            </button>
          )}

          {onOpenVariantManager && (
            <button
              onClick={onOpenVariantManager}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-xs font-medium transition-colors"
              title="Centralized Variant Manager: switch, clone, rename, or delete process variants"
            >
              <GitBranch className="w-3.5 h-3.5 text-violet-400" />
              <span>Variants</span>
              {variantStepCount > 0 && (
                <span className="px-1 py-0.2 rounded bg-violet-500/20 text-violet-300 border border-violet-500/40 font-mono text-[10px]">
                  {variantStepCount}
                </span>
              )}
            </button>
          )}

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
            <span>Process Figure</span>
          </button>

          {onOpenBatchExport && (
            <button
              type="button"
              onClick={onOpenBatchExport}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-300 hover:text-sky-200 border border-slate-700 text-xs font-medium transition-colors"
              title="Batch Export All Step Cross-Sections (SVG / PNG)"
            >
              <Files className="w-3.5 h-3.5 text-sky-400" />
              <span className="hidden 2xl:inline">Batch Export</span>
            </button>
          )}

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
            {onExportCsv && (
              <button
                type="button"
                onClick={onExportCsv}
                className="flex items-center gap-1 px-1.5 py-1 rounded text-emerald-300 hover:text-emerald-200 hover:bg-slate-700 transition-colors text-[11px] font-medium"
                title="Export Process Flow CSV (for MES / Excel / PLM)"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
                <span className="hidden 2xl:inline">CSV</span>
              </button>
            )}
          </div>

          {onToggleFullScreen && (
            <button
              type="button"
              onClick={onToggleFullScreen}
              aria-pressed={isFullScreen}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                isFullScreen
                  ? 'bg-sky-600/25 border-sky-500/60 text-sky-200 shadow-sm'
                  : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300 hover:text-white'
              }`}
              title={isFullScreen ? 'Exit Full Screen Display Mode' : 'Full Screen Display Mode'}
            >
              {isFullScreen ? (
                <Minimize className="w-3.5 h-3.5" />
              ) : (
                <Maximize className="w-3.5 h-3.5" />
              )}
              <span className="hidden 2xl:inline">
                {isFullScreen ? 'Exit Full' : 'Full Screen'}
              </span>
            </button>
          )}
        </div>

        {/* Compact Full Screen button on <xl */}
        {onToggleFullScreen && (
          <button
            type="button"
            onClick={onToggleFullScreen}
            aria-pressed={isFullScreen}
            className={`xl:hidden p-1.5 rounded-lg border text-xs transition-colors ${
              isFullScreen
                ? 'bg-sky-600/25 border-sky-500/60 text-sky-200'
                : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300 hover:text-white'
            }`}
            title={isFullScreen ? 'Exit Full Screen Display Mode' : 'Full Screen Display Mode'}
          >
            {isFullScreen ? (
              <Minimize className="w-4 h-4" />
            ) : (
              <Maximize className="w-4 h-4" />
            )}
          </button>
        )}

        {/* Mobile & Tablet Tools Dropdown (< xl) */}
        <div className="relative xl:hidden" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMobileMenuOpen((v) => !v)}
            className={`flex items-center gap-1 px-2 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
              mobileMenuOpen
                ? 'bg-sky-600 border-sky-500 text-white'
                : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
            }`}
            title="Tools, Masks, Presets & Export"
          >
            {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            <span className="hidden sm:inline">Tools</span>
          </button>

          {mobileMenuOpen && (
            <div className="absolute right-0 mt-1.5 w-56 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl py-1.5 z-50 text-xs">
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onOpenPresets();
                }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-slate-200 hover:bg-slate-800"
              >
                <FolderOpen className="w-4 h-4 text-sky-400" />
                <span>Process Presets</span>
              </button>
              {onOpenImportFlow && (
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onOpenImportFlow('steps-and-masks');
                  }}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-slate-200 hover:bg-slate-800"
                >
                  <FileInput className="w-4 h-4 text-emerald-400" />
                  <span>Import Steps / Masks</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onOpenMaterials();
                }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-slate-200 hover:bg-slate-800"
              >
                <Sliders className="w-4 h-4 text-emerald-400" />
                <span>Materials Library</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onOpenEtchLibrary();
                }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-slate-200 hover:bg-slate-800"
              >
                <FlaskConical className="w-4 h-4 text-amber-400" />
                <span>Etch Rate Library</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onOpenMaskLevels();
                }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-slate-200 hover:bg-slate-800"
              >
                <Scan className="w-4 h-4 text-sky-400" />
                <span>Mask Levels &amp; 2D GDS</span>
              </button>
              {onOpenVariables && (
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onOpenVariables();
                  }}
                  className="w-full flex items-center justify-between gap-2.5 px-3.5 py-2.5 text-left text-slate-200 hover:bg-slate-800"
                >
                  <span className="flex items-center gap-2.5">
                    <Variable className="w-4 h-4 text-violet-400" />
                    <span>Design Variables</span>
                  </span>
                  {variableCount > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/40 font-mono text-[10px]">
                      {variableCount}
                    </span>
                  )}
                </button>
              )}
              {onOpenVariantManager && (
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onOpenVariantManager();
                  }}
                  className="w-full flex items-center justify-between gap-2.5 px-3.5 py-2.5 text-left text-slate-200 hover:bg-slate-800"
                >
                  <span className="flex items-center gap-2.5">
                    <GitBranch className="w-4 h-4 text-violet-400" />
                    <span>Variant Manager</span>
                  </span>
                  {variantStepCount > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/40 font-mono text-[10px]">
                      {variantStepCount}
                    </span>
                  )}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onOpenRunSheet();
                }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-slate-200 hover:bg-slate-800"
              >
                <FileText className="w-4 h-4 text-amber-400" />
                <span>Run Sheet SOP</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onOpenMultiStepView();
                }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-sky-300 font-semibold hover:bg-slate-800"
              >
                <LayoutGrid className="w-4 h-4 text-indigo-400" />
                <span>Process Figure</span>
              </button>

              <div className="my-1 border-t border-slate-800" />

              <label className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-slate-300 hover:bg-slate-800 cursor-pointer">
                <Upload className="w-4 h-4 text-slate-400" />
                <span>Import Recipe JSON</span>
                <input
                  type="file"
                  accept=".json"
                  onChange={handleFileInputChange}
                  className="hidden"
                />
              </label>
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onExportJson();
                }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-slate-300 hover:bg-slate-800"
              >
                <Download className="w-4 h-4 text-slate-400" />
                <span>Export Recipe JSON</span>
              </button>
              {onExportCsv && (
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onExportCsv();
                  }}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-emerald-300 hover:bg-slate-800"
                >
                  <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                  <span>Export Process Flow CSV</span>
                </button>
              )}
              {onOpenBatchExport && (
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onOpenBatchExport();
                  }}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-sky-300 hover:bg-slate-800"
                >
                  <Files className="w-4 h-4 text-sky-400" />
                  <span>Batch Export Steps (SVG / PNG)</span>
                </button>
              )}

              <div className="my-1 border-t border-slate-800" />

              {onOpenHelp && (
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onOpenHelp();
                  }}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-slate-200 hover:bg-slate-800"
                >
                  <HelpCircle className="w-4 h-4 text-sky-400" />
                  <span>User Guide &amp; Help</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onOpenAbout();
                }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-slate-200 hover:bg-slate-800"
              >
                <Info className="w-4 h-4 text-sky-400" />
                <span>About this app</span>
              </button>
            </div>
          )}
        </div>

      </div>
    </header>
  );
};
