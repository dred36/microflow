/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  X,
  HelpCircle,
  Search,
  Layers,
  ListOrdered,
  Sliders,
  Scan,
  Maximize2,
  Variable,
  FileInput,
  Download,
  Keyboard,
  Info,
} from 'lucide-react';

export type HelpTopicId =
  | 'overview'
  | 'timeline'
  | 'steps'
  | 'masks'
  | 'viewport'
  | 'variables'
  | 'import'
  | 'exports';

interface HelpEntry {
  title: string;
  where?: string;
  description: string;
}

interface HelpTopic {
  id: HelpTopicId;
  order: string;
  label: string;
  summary: string;
  entries: HelpEntry[];
  tips: string[];
}

const HELP_TOPICS: HelpTopic[] = [
  {
    id: 'overview',
    order: '01',
    label: 'Workspace Overview',
    summary:
      'MicroFlow CAD models wafer fabrication step-by-step from starting substrate layers through deposition, patterning, etching, bonding, and dicing—100% locally in your browser.',
    entries: [
      {
        title: 'Three-Column CAD Layout',
        where: 'Left · Center · Main Canvas',
        description:
          'Browse and reorder operations in the Process Traveller on the left, edit parameters for the selected substrate or step in the middle inspector, and inspect the simulated wafer cross-section on the right.',
      },
      {
        title: 'Step Playback & Transport',
        where: 'Process Traveller Header',
        description:
          'Use Play/Pause, First, Previous, and Next controls—or click any step directly—to animate fabrication progress at 0.5× to 3× speed.',
      },
      {
        title: 'Base Unit Switching (nm / µm)',
        where: 'Top Toolbar',
        description:
          'Switch displayed film thicknesses, depths, and wafer dimensions between nanometers (nm) and micrometers (µm) at any time without losing precision.',
      },
      {
        title: 'Full Screen Focus Mode',
        where: 'Top Toolbar & Viewport Toolbar',
        description:
          'Expand either the entire workspace or just the cross-section viewport for presentations and detailed inspection. Press Esc to exit.',
      },
    ],
    tips: [
      'Click the process title in the top bar at any time to rename your recipe.',
      'Your active flow, unit preference, and custom libraries are saved automatically in browser localStorage.',
    ],
  },
  {
    id: 'timeline',
    order: '02',
    label: 'Timeline, Blocks & Variants',
    summary:
      'Organize complex fabrication flows into reusable modules, reorder steps individually or in bulk, bookmark milestones, and branch alternative step variants.',
    entries: [
      {
        title: 'Process Modules (Blocks)',
        where: 'Process Traveller → + Block',
        description:
          'Group related steps (e.g., Gate Stack, STI Isolation, Backside Via) into color-coded collapsible blocks. Drag blocks or steps to reorder the sequence.',
      },
      {
        title: 'Bulk Edit Mode',
        where: 'Process Traveller → Bulk Edit',
        description:
          'Select multiple steps at once to move them together, assign or unassign them to a block, or delete them cleanly.',
      },
      {
        title: 'Step Variants (A/B Branching)',
        where: 'Step Config → Variants / Top Bar → Variants',
        description:
          'Attach alternative parameter variants to any step (such as different etch chemistries, thicknesses, or forked photomask levels) and switch between them globally in the Variant Manager.',
      },
      {
        title: 'Bookmarks & Timeline Filter',
        where: 'Step Config → Bookmark · Traveller Search',
        description:
          'Mark key process milestones with a bookmark tag and filter the Process Traveller by keyword or bookmarked steps only.',
      },
    ],
    tips: [
      'Temporarily uncheck Enabled on any step to skip it in the simulation without deleting its recipe parameters.',
      'Duplicate any existing step from its card action menu to iterate quickly.',
    ],
  },
  {
    id: 'steps',
    order: '03',
    label: 'Substrate & Process Steps',
    summary:
      'Configure front-side and back-side wafer operations across ten deterministic physical process models.',
    entries: [
      {
        title: 'Multi-Layer Starting Substrate',
        where: 'Top of Process Traveller → Substrate Stack',
        description:
          'Define wafer width and build multi-layer starting substrates such as SOI (Si / Buried Oxide / Handle Si), epi-wafers, or sapphire carriers.',
      },
      {
        title: 'Deposition (Conformal & Directional)',
        where: 'Add Step → Deposition',
        description:
          'Model LPCVD/ALD/Thermal conformal films that wrap sidewalls evenly, or directional PVD/sputter/evaporation line-of-sight coatings.',
      },
      {
        title: 'Photolithography & LOR Undercut',
        where: 'Add Step → Lithography',
        description:
          'Coat positive or negative photoresist, choose Dark-Field or Light-Field reticles, optionally add a lift-off resist (LOR) underlayer with controlled undercut, and edit apertures inline above the canvas.',
      },
      {
        title: 'Etching (RIE, Wet, Bosch DRIE, KOH)',
        where: 'Add Step → Etch',
        description:
          'Simulate anisotropic plasma RIE with tunable sidewall angle, isotropic wet undercutting, Bosch DRIE cyclic scalloping, or crystalline KOH 54.7° facets, with target material, etch-stop layer, or relative reference surface.',
      },
      {
        title: 'Strip, Sacrificial Release & Lift-Off',
        where: 'Add Step → Strip / Lift-off',
        description:
          'Strip photoresist cleanly, perform sacrificial release etching across the whole wafer or locally dragged release regions, or lift off over-coated films resting on resist/LOR.',
      },
      {
        title: 'CMP, Anneal, Bonding, Dicing & Tape',
        where: 'Add Step → Advanced Steps',
        description:
          'Planarize topography via CMP/Grind/Polish, reflow/anneal layers, bond custom or other-flow wafers with X-alignment shift, dice along defined kerf streets, and mount/UV-demount tape frames for double-sided processing.',
      },
    ],
    tips: [
      'Toggle Front / Back Side on any step to deposit, pattern, etch, or release from the wafer backside.',
      'For Sacrificial Release steps with Local Regions enabled, click Pick Release on the canvas toolbar and drag directly across the target region.',
    ],
  },
  {
    id: 'masks',
    order: '04',
    label: 'Masks, Aligned Stack & 2D GDS',
    summary:
      'Edit single aperture tracks inline, align every reticle layer vertically in one shared workspace, or slice 1D cross-sections from 2D GDSII layouts.',
    entries: [
      {
        title: 'Inline Aperture Track Editor',
        where: 'Above Cross-Section Canvas (Litho Step Active)',
        description:
          'Drag apertures to move, drag left/right edges to resize, click + Aperture or + Blocker to add openings, and switch Dark-Field vs Light-Field directly above the wafer.',
      },
      {
        title: 'Mask Levels Manager & Unassigned Reticles',
        where: 'Top Toolbar → Mask Levels',
        description:
          'Manage all Assigned and Unassigned photomask levels, generate periodic aperture arrays, inspect clear-area metrics, reassign or swap reticles between steps, and preview both the step and final cross-sections side-by-side.',
      },
      {
        title: 'Aligned Stack View',
        where: 'Mask Levels → Aligned Stack Tab',
        description:
          'View every photomask level stacked vertically over a shared X-axis ruler with a composite overlay strip, live alignment guidelines when dragging or nudging, and a hover crosshair.',
      },
      {
        title: '2D GDS Layout & Cutline Slicing',
        where: 'Mask Levels → 2D GDS Tab',
        description:
          'Load local .gds / .gds2 files (parsed strictly in browser memory) or draw 2D polygons, choose target GDS layer/datatype pairs, and drag the A–A′ cross-section cutline to project 2D features onto the 1D mask track.',
      },
    ],
    tips: [
      'On 1D aperture tracks, ← / → nudges selected apertures by a fine step and Shift + ← / → nudges by a coarse step. Drag empty track space to marquee-select, or Shift / Ctrl / Cmd + Click to multi-select.',
      'Use Ctrl/Cmd + Z and Ctrl/Cmd + Y (or Ctrl/Cmd + Shift + Z) to undo or redo aperture track and 2D GDS edits.',
      'In the 2D GDS tab, use ← / → / ↑ / ↓ to move selected shapes, Del / Backspace to delete them, Ctrl/Cmd + A to select visible shapes, and F to zoom-fit.',
    ],
  },
  {
    id: 'viewport',
    order: '05',
    label: 'Cross-Section Viewport',
    summary:
      'Inspect nanoscale thin films alongside multi-micron substrates using Z-exaggeration, piecewise compression, calipers, stack probes, and ghost overlays.',
    entries: [
      {
        title: 'Pan, Zoom & Region Zoom',
        where: 'Canvas Scroll / Drag · Zoom Box Button',
        description:
          'Scroll to zoom toward the cursor, drag to pan, or activate Region Zoom to draw a marquee box to zoom in (hold Ctrl while dragging to zoom out).',
      },
      {
        title: 'Z-Scale & Piecewise Z Compression',
        where: 'Viewport Toolbar → Z-Scale · Piecewise Z',
        description:
          'Exaggerate vertical scale (0.5×–10×) to inspect thin films, or turn on Piecewise Z to automatically compress thick substrate depths while keeping surface device layers expanded.',
      },
      {
        title: 'Measurement Caliper Tool',
        where: 'Viewport Toolbar → Measure',
        description:
          'Click two points on the cross-section to measure ΔX, ΔZ, and Euclidean distance. Use Snap to lock onto polygon vertices/edges and Ortho (or Shift) for horizontal/vertical locking.',
      },
      {
        title: 'Stack Thickness Probe',
        where: 'Viewport Toolbar → Stack',
        description:
          'Click anywhere across the wafer to pin vertical stack probes showing exact layer-by-layer materials and thicknesses at multiple X positions.',
      },
      {
        title: 'Prior-Step Ghost & Final Step Inset',
        where: 'Viewport Toolbar → Ghost · Final Inset',
        description:
          'Overlay the previous step’s outline behind the active cross-section to verify etch or deposition profiles, or pin the Final (or any later) step in a corner preview window.',
      },
    ],
    tips: [
      'Lock the shared Y scale across steps when stepping through playback so the wafer does not jump vertically as layers grow or etch away.',
      'Switch between Hatch (standard engineering material patterns) and Solid fill, or toggle outlines and axis labels cleanly for screenshots.',
    ],
  },
  {
    id: 'variables',
    order: '06',
    label: 'Parametric Design Variables',
    summary:
      'Define reusable dimensional variables and bind film thicknesses, etch depths, and mask aperture coordinates so geometry updates everywhere in one edit.',
    entries: [
      {
        title: 'Creating & Editing Variables',
        where: 'Top Toolbar → Variables',
        description:
          'Add named variables in nm, µm, deg, sec, or scalar units (or start from built-in variable presets) with live sliders and usage tracking across the flow.',
      },
      {
        title: 'Binding Step & Mask Dimensions',
        where: 'Bind Icons Next to Inputs',
        description:
          'Bind substrate layer thicknesses, deposition thicknesses, etch depths, sacrificial release windows, and mask aperture xStart / xEnd / width directly to variables or expressions.',
      },
    ],
    tips: [
      'Updating a variable value immediately recalculates every bound step, mask level, and cross-section in real time.',
      'Renaming a variable automatically updates every binding expression referencing it across steps and masks.',
    ],
  },
  {
    id: 'import',
    order: '07',
    label: 'Importing Flows & Presets',
    summary:
      'Load complete starter presets or selectively preview and merge steps and photomasks from another MicroFlow recipe without overwriting your current wafer.',
    entries: [
      {
        title: 'Presets vs. Import Flow',
        where: 'Top Bar → Presets vs. Import Flow / Traveller → Import',
        description:
          'Presets replaces the active workspace with a complete reference flow (CMOS, MEMS Cantilever, Photonic Waveguide, TSV). Import Flow inspects another .json recipe or template and merges only what you select into your current flow.',
      },
      {
        title: 'Pre-Import Analysis & Live Preview',
        where: 'Import Flow Modal → Right Pane',
        description:
          'Before importing, inspect what the incoming flow does—its starting substrate, operation counts, materials, masks, step-by-step simulated cross-sections, and the Projected Merge Result inside your active wafer.',
      },
      {
        title: 'Steps + Masks, Steps Only, or Masks Only',
        where: 'Import Flow Modal → Top Mode Switch',
        description:
          'Import checked steps together with their masks (either Linked to steps or Kept Unassigned), import Steps Only with blank lithography tracks, or choose Masks Only to add unassigned reticles without adding steps.',
      },
      {
        title: 'Process Block & Wafer Width Handling',
        where: 'Import Flow Modal → Merge Options',
        description:
          'Imported steps preserve their source process blocks by default (Keep Assigned), or you can group them into a Single Block or import with No Blocks. If wafer widths differ, choose Scale Proportionally or Keep Dimensions.',
      },
    ],
    tips: [
      'Click any step row in the Import Flow checklist to immediately simulate its cross-section in the preview pane.',
      'Inside Mask Levels Manager, click Import at the bottom of the reticle sidebar to open the importer directly in Masks Only mode.',
    ],
  },
  {
    id: 'exports',
    order: '08',
    label: 'Libraries, SOP & Exports',
    summary:
      'Customize material optics and etch rates, generate fabrication run sheets and multi-step figures, and export vector/raster graphics or machine-readable recipes.',
    entries: [
      {
        title: 'Materials & Etch Rate Libraries',
        where: 'Top Toolbar → Materials · Etch Rates',
        description:
          'Add custom materials with hatch patterns and colors, and define tool etch chemistries with per-material etch rates to calculate selectivity ratios and process durations automatically.',
      },
      {
        title: 'Run Sheet SOP & CSV Export',
        where: 'Top Toolbar → Run Sheet SOP · CSV',
        description:
          'Generate printable Standard Operating Procedure run sheets containing tool recipes, temperatures, gases, pressures, and inspection notes, or export structured CSVs for Excel/PLM/MES.',
      },
      {
        title: 'Process Figure & Batch Step Export',
        where: 'Top Toolbar → Process Figure · Batch Export',
        description:
          'Compose multi-step publication figures with synced Z scaling (1.0×–5.0× or 1:1 aspect), Shared Y vs. Per-Step Fit, and Piecewise Z-Map (Linear / Auto / Custom Zones), or batch-export every step cross-section as individual SVG or PNG images.',
      },
      {
        title: 'JSON Recipe Backup & Full Import',
        where: 'Top Toolbar → Upload / Download Icons',
        description:
          'Save your complete process flow—including substrates, variables, variants, masks, custom materials, and etch recipes—as a portable .json file.',
      },
    ],
    tips: [
      'For clean academic figures, toggle off axis labels or switch to Solid fill in the Cross-Section Viewport before clicking SVG or Batch Export.',
    ],
  },
];

const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: 'Scroll / Drag', action: 'Zoom & pan cross-section canvas' },
  { keys: 'Ctrl + Drag (Zoom)', action: 'Zoom out with Region Zoom tool' },
  { keys: 'Shift (Measure)', action: 'Lock caliper angle (when Ortho is on)' },
  { keys: '← / →', action: 'Nudge selected 1D mask aperture' },
  { keys: 'Shift + ← / →', action: 'Coarse nudge 1D mask aperture' },
  { keys: 'Ctrl/Cmd + Z / Y', action: 'Undo / Redo mask or 2D GDS edit' },
  { keys: 'Arrows / Del (GDS)', action: 'Nudge or delete selected 2D GDS shapes' },
  { keys: 'Ctrl/Cmd + A / F (GDS)', action: 'Select visible / Zoom-fit 2D GDS' },
  { keys: 'Esc', action: 'Clear selection, exit Full Screen, or close dialog' },
];

interface HelpModalProps {
  initialTopic?: HelpTopicId;
  onClose: () => void;
  onOpenAbout?: () => void;
}

export const HelpModal: React.FC<HelpModalProps> = ({
  initialTopic = 'overview',
  onClose,
  onOpenAbout,
}) => {
  const [activeTopicId, setActiveTopicId] = useState<HelpTopicId>(initialTopic);
  const [searchQuery, setSearchQuery] = useState<string>('');

  useEffect(() => {
    setActiveTopicId(initialTopic);
  }, [initialTopic]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  const trimmedQuery = searchQuery.trim().toLowerCase();

  const searchResults = useMemo(() => {
    if (!trimmedQuery) return null;
    const matches: {
      topic: HelpTopic;
      matchingEntries: HelpEntry[];
      matchingTips: string[];
    }[] = [];

    for (const topic of HELP_TOPICS) {
      const topicMatch =
        topic.label.toLowerCase().includes(trimmedQuery) ||
        topic.summary.toLowerCase().includes(trimmedQuery);
      const matchingEntries = topic.entries.filter(
        (e) =>
          topicMatch ||
          e.title.toLowerCase().includes(trimmedQuery) ||
          e.description.toLowerCase().includes(trimmedQuery) ||
          (e.where && e.where.toLowerCase().includes(trimmedQuery))
      );
      const matchingTips = topic.tips.filter(
        (t) => topicMatch || t.toLowerCase().includes(trimmedQuery)
      );
      if (matchingEntries.length > 0 || matchingTips.length > 0 || topicMatch) {
        matches.push({
          topic,
          matchingEntries:
            matchingEntries.length > 0 ? matchingEntries : topic.entries,
          matchingTips,
        });
      }
    }
    return matches;
  }, [trimmedQuery]);

  const activeTopic = useMemo(
    () => HELP_TOPICS.find((t) => t.id === activeTopicId) || HELP_TOPICS[0],
    [activeTopicId]
  );

  const getTopicIcon = (id: HelpTopicId) => {
    switch (id) {
      case 'overview':
        return <Layers className="w-3.5 h-3.5 shrink-0" />;
      case 'timeline':
        return <ListOrdered className="w-3.5 h-3.5 shrink-0" />;
      case 'steps':
        return <Sliders className="w-3.5 h-3.5 shrink-0" />;
      case 'masks':
        return <Scan className="w-3.5 h-3.5 shrink-0" />;
      case 'viewport':
        return <Maximize2 className="w-3.5 h-3.5 shrink-0" />;
      case 'variables':
        return <Variable className="w-3.5 h-3.5 shrink-0" />;
      case 'import':
        return <FileInput className="w-3.5 h-3.5 shrink-0" />;
      case 'exports':
        return <Download className="w-3.5 h-3.5 shrink-0" />;
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-0 sm:p-4 bg-slate-950/80 backdrop-blur-md">
      <div className="relative flex flex-col w-full max-w-5xl h-[100dvh] sm:h-[88vh] sm:max-h-[780px] bg-slate-950 border-0 sm:border sm:border-slate-800 rounded-none sm:rounded-2xl shadow-2xl overflow-hidden text-slate-100 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-4 py-3 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-7 h-7 rounded-lg bg-sky-600/20 border border-sky-500/40 flex items-center justify-center text-sky-400 shrink-0">
              <HelpCircle className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-white tracking-tight truncate">
                MicroFlow CAD User Guide
              </h2>
              <p className="text-[11px] text-slate-400 truncate">
                Feature reference, workflow guide &amp; keyboard shortcuts
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-1 sm:flex-initial justify-end min-w-[220px]">
            <div className="relative flex-1 sm:w-64 max-w-xs">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search tools, etch, GDS, import..."
                className="w-full pl-8 pr-7 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200"
                  aria-label="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors shrink-0"
              aria-label="Close help guide"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Mobile Topic Strip */}
        {!trimmedQuery && (
          <div className="md:hidden px-3 py-2 bg-slate-900/70 border-b border-slate-800 flex items-center gap-1.5 overflow-x-auto shrink-0">
            {HELP_TOPICS.map((topic) => (
              <button
                key={topic.id}
                type="button"
                onClick={() => setActiveTopicId(topic.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium whitespace-nowrap transition-colors shrink-0 ${
                  activeTopicId === topic.id
                    ? 'bg-sky-600 text-white'
                    : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                {getTopicIcon(topic.id)}
                <span>{topic.label}</span>
              </button>
            ))}
          </div>
        )}

        {/* Main Two-Column Guide Body */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Desktop Topic Sidebar */}
          <aside className="hidden md:flex flex-col w-60 lg:w-64 border-r border-slate-800 bg-slate-900/50 p-2.5 space-y-1 overflow-y-auto shrink-0">
            {HELP_TOPICS.map((topic) => {
              const isActive = !trimmedQuery && activeTopicId === topic.id;
              return (
                <button
                  key={topic.id}
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setActiveTopicId(topic.id);
                  }}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left text-xs transition-colors ${
                    isActive
                      ? 'bg-sky-600/20 text-sky-200 border border-sky-500/40 font-semibold'
                      : 'text-slate-300 hover:bg-slate-800/70 hover:text-white border border-transparent'
                  }`}
                >
                  <span className="font-mono text-[10px] text-slate-500 tabular-nums">
                    {topic.order}
                  </span>
                  <span className={isActive ? 'text-sky-400' : 'text-slate-400'}>
                    {getTopicIcon(topic.id)}
                  </span>
                  <span className="truncate">{topic.label}</span>
                </button>
              );
            })}

            {/* Compact Shortcuts Quick Card */}
            <div className="pt-3 mt-3 border-t border-slate-800 px-1.5 space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-300">
                <Keyboard className="w-3.5 h-3.5 text-sky-400" />
                <span>Quick Shortcuts</span>
              </div>
              <div className="space-y-1.5 text-[10.5px]">
                {SHORTCUTS.map((sc) => (
                  <div key={sc.keys} className="space-y-0.5">
                    <kbd className="inline-block font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 text-sky-300">
                      {sc.keys}
                    </kbd>
                    <div className="text-slate-400 leading-snug">{sc.action}</div>
                  </div>
                ))}
              </div>
            </div>
          </aside>

          {/* Content Reading Pane */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
            {searchResults ? (
              <div className="space-y-5">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                  <h3 className="text-sm font-bold text-white">
                    Search results for &ldquo;{searchQuery.trim()}&rdquo;
                  </h3>
                  <span className="text-xs font-mono tabular-nums text-slate-400">
                    {searchResults.length} topic{searchResults.length === 1 ? '' : 's'}
                  </span>
                </div>

                {searchResults.length === 0 ? (
                  <div className="p-6 rounded-xl border border-dashed border-slate-800 text-center space-y-2">
                    <p className="text-sm text-slate-300">No help entries matched your query.</p>
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="text-xs text-sky-400 hover:text-sky-300 hover:underline"
                    >
                      Clear filter and browse all topics
                    </button>
                  </div>
                ) : (
                  searchResults.map(({ topic, matchingEntries, matchingTips }) => (
                    <div key={topic.id} className="space-y-2.5 pb-4 border-b border-slate-800/80 last:border-b-0">
                      <div className="flex items-center justify-between gap-2">
                        <h4 className="text-xs font-bold text-sky-300">
                          {topic.order}. {topic.label}
                        </h4>
                        <button
                          type="button"
                          onClick={() => {
                            setSearchQuery('');
                            setActiveTopicId(topic.id);
                          }}
                          className="text-[11px] text-slate-400 hover:text-sky-300 hover:underline"
                        >
                          Open full topic
                        </button>
                      </div>

                      <div className="space-y-2">
                        {matchingEntries.map((entry) => (
                          <div
                            key={entry.title}
                            className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 space-y-1"
                          >
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                              <span className="text-xs font-semibold text-white">
                                {entry.title}
                              </span>
                              {entry.where && (
                                <span className="text-[10.5px] font-mono text-slate-400">
                                  {entry.where}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-slate-300 leading-relaxed">
                              {entry.description}
                            </p>
                          </div>
                        ))}
                      </div>

                      {matchingTips.length > 0 && (
                        <ul className="space-y-1 pl-4 list-disc text-[11.5px] text-slate-400">
                          {matchingTips.map((tip) => (
                            <li key={tip}>{tip}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))
                )}
              </div>
            ) : (
              <div className="space-y-6">
                {/* Topic Heading */}
                <div className="space-y-1.5 border-b border-slate-800 pb-4">
                  <div className="text-[11px] font-mono text-sky-400 tabular-nums">
                    Topic {activeTopic.order} of {String(HELP_TOPICS.length).padStart(2, '0')}
                  </div>
                  <h3 className="text-base sm:text-lg font-bold text-white tracking-tight">
                    {activeTopic.label}
                  </h3>
                  <p className="text-xs sm:text-[13px] text-slate-300 leading-relaxed max-w-3xl">
                    {activeTopic.summary}
                  </p>
                </div>

                {/* Entries */}
                <div className="space-y-3">
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    Capabilities &amp; Controls
                  </h4>
                  <div className="grid grid-cols-1 gap-2.5">
                    {activeTopic.entries.map((entry) => (
                      <div
                        key={entry.title}
                        className="p-3.5 rounded-xl bg-slate-900/55 border border-slate-800 space-y-1"
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="text-xs sm:text-[13px] font-semibold text-slate-100">
                            {entry.title}
                          </span>
                          {entry.where && (
                            <span className="text-[11px] font-mono text-sky-300/90">
                              {entry.where}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-300 leading-relaxed">
                          {entry.description}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Practical Tips */}
                {activeTopic.tips.length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-slate-800/80">
                    <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                      Workflow Tips
                    </h4>
                    <ul className="space-y-1.5 pl-4 list-disc text-xs text-slate-300 leading-relaxed">
                      {activeTopic.tips.map((tip) => (
                        <li key={tip}>{tip}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Mobile Shortcuts Section (since desktop shows in sidebar) */}
                <div className="md:hidden pt-3 border-t border-slate-800 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                    <Keyboard className="w-3.5 h-3.5 text-sky-400" />
                    <span>Keyboard &amp; Mouse Shortcuts</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                    {SHORTCUTS.map((sc) => (
                      <div
                        key={sc.keys}
                        className="p-2 rounded-lg bg-slate-900/60 border border-slate-800 flex items-center justify-between gap-2"
                      >
                        <span className="text-slate-300">{sc.action}</span>
                        <kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-950 border border-slate-700 text-sky-300 shrink-0">
                          {sc.keys}
                        </kbd>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 bg-slate-900 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2 shrink-0 text-xs">
          <div className="text-[11px] text-slate-400">
            All cross-section physics, mask alignments, and GDSII parsing run deterministically in your browser.
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onOpenAbout && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenAbout();
                }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white text-xs font-medium transition-colors"
              >
                <Info className="w-3.5 h-3.5 text-sky-400" />
                <span>About &amp; Privacy</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
