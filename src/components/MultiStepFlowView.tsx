/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState, useMemo } from 'react';
import {
  ProcessFlow,
  Material,
  CrossSectionMesh,
  RenderedPolygon,
} from '../types/microfab';
import { simulateCrossSection, buildRenderPolygons } from '../lib/simulationEngine';
import { SvgPatterns } from './SvgPatterns';
import { getMaterialById } from '../lib/materials';
import { Download, LayoutGrid, Check, FileDown, Eye, Sliders } from 'lucide-react';

interface MultiStepFlowViewProps {
  flow: ProcessFlow;
  onSelectStepIndex: (idx: number) => void;
  onClose: () => void;
}

export const MultiStepFlowView: React.FC<MultiStepFlowViewProps> = ({
  flow,
  onSelectStepIndex,
  onClose,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [columnsCount, setColumnsCount] = useState<number>(2);
  const [theme, setTheme] = useState<'dark' | 'paper'>('paper');
  const [showToolInfo, setShowToolInfo] = useState<boolean>(true);
  const [showLegend, setShowLegend] = useState<boolean>(true);
  const [includeSubstrateFrame, setIncludeSubstrateFrame] = useState<boolean>(true);
  const [isExporting, setIsExporting] = useState<boolean>(false);

  // Pre-calculate cross sections for all enabled steps
  const enabledSteps = useMemo(
    () => flow.steps.filter((s) => s.enabled),
    [flow.steps]
  );

  const stepMeshes = useMemo(() => {
    const list: {
      step: {
        id: string;
        title: string;
        type: any;
        notes?: string;
        thickness?: number;
        deposition?: any;
        lithography?: any;
        etch?: any;
        strip?: any;
        cmp?: any;
      };
      idx: number;
      mesh: CrossSectionMesh;
      polygons: RenderedPolygon[];
      customSubtitle?: string;
      blockName?: string;
      blockColor?: string;
      reticleName?: string;
    }[] = [];

    const subLayers = flow.substrateLayers || [
      {
        id: 'sub_default',
        name: 'Bulk Silicon <100>',
        materialId: flow.substrateMaterialId || 'mat_si_sub',
        thickness: flow.substrateThickness || 3000,
      },
    ];

    if (includeSubstrateFrame) {
      const subMesh = simulateCrossSection(flow, -1);
      const subPolys = buildRenderPolygons(subMesh, flow.materials);
      const subDesc = subLayers
        .map((l) => `${l.name || l.materialId} (${l.thickness} nm)`)
        .join(' · ');
      list.push({
        step: {
          id: 'step_init_sub',
          title: 'Starting Substrate Architecture',
          type: 'substrate',
        },
        idx: -1,
        mesh: subMesh,
        polygons: subPolys,
        customSubtitle: `Pre-fab Stack: ${subDesc}`,
      });
    }

    enabledSteps.forEach((step, idx) => {
      const mesh = simulateCrossSection(flow, idx);
      const polygons = buildRenderPolygons(mesh, flow.materials);
      const block = flow.blocks?.find((b) => b.id === step.blockId);
      const maskId = step.lithography?.maskId;
      const mask = maskId
        ? flow.masks?.find((m) => m.id === maskId)
        : undefined;

      list.push({
        step,
        idx,
        mesh,
        polygons,
        blockName: block?.name,
        blockColor: block?.color,
        reticleName: mask ? `${mask.layerCode} ${mask.name}` : undefined,
      });
    });

    return list;
  }, [flow, enabledSteps, includeSubstrateFrame]);

  // Overall materials used
  const allUsedMaterials = useMemo(() => {
    const ids = new Set<string>();
    stepMeshes.forEach((item) => {
      item.polygons.forEach((p) => ids.add(p.materialId));
    });
    return Array.from(ids).map((id) => getMaterialById(flow.materials, id));
  }, [stepMeshes, flow.materials]);

  // Letters for IEEE/Nature figures: (a), (b), (c)...
  const getStepLetter = (idx: number) => {
    return `(${String.fromCharCode(97 + idx)})`;
  };

  // Export full multi-step diagram to SVG
  const handleExportSvg = () => {
    const svgEl = containerRef.current?.querySelector('#multi-step-master-svg');
    if (!svgEl) return;
    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(svgEl);
    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${flow.title.toLowerCase().replace(/\s+/g, '-')}-process-flow.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Export full multi-step diagram to PNG
  const handleExportPng = () => {
    const svgEl = containerRef.current?.querySelector('#multi-step-master-svg') as SVGSVGElement | null;
    if (!svgEl) return;
    setIsExporting(true);

    try {
      const serializer = new XMLSerializer();
      const svgStr = serializer.serializeToString(svgEl);
      const img = new Image();
      const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);

      img.onload = () => {
        const canvas = document.createElement('canvas');
        const scaleFactor = 2; // High-DPI 2x supersampling
        canvas.width = svgEl.clientWidth * scaleFactor || 1600 * scaleFactor;
        canvas.height = svgEl.clientHeight * scaleFactor || 1200 * scaleFactor;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.scale(scaleFactor, scaleFactor);
        ctx.fillStyle = theme === 'paper' ? '#ffffff' : '#090d16';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, svgEl.clientWidth || 1600, svgEl.clientHeight || 1200);

        const pngUrl = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = pngUrl;
        a.download = `${flow.title.toLowerCase().replace(/\s+/g, '-')}-publication-flow.png`;
        a.click();
        URL.revokeObjectURL(url);
        setIsExporting(false);
      };

      img.src = url;
    } catch (err) {
      console.error('PNG export failed', err);
      setIsExporting(false);
    }
  };

  const cellWidth = 560;
  const cellHeight = 220;
  const padX = 40;
  const padY = 30;

  const totalRows = Math.ceil(stepMeshes.length / columnsCount);
  const masterSvgWidth = columnsCount * cellWidth + (columnsCount + 1) * 20;
  const masterSvgHeight = totalRows * cellHeight + 120 + (showLegend ? 60 : 0);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950/95 backdrop-blur-md text-slate-100">
      {/* Top Header Controls */}
      <div className="flex items-center justify-between px-6 py-3.5 bg-slate-900 border-b border-slate-800 shadow-md">
        <div className="flex items-center gap-3">
          <LayoutGrid className="w-5 h-5 text-sky-400" />
          <div>
            <h2 className="text-sm font-bold text-white tracking-wide">
              Publication-Ready Process Flow Generator
            </h2>
            <span className="text-xs text-slate-400 font-mono">
              IEEE / Nature Style Cross-Section Figure Sequence
            </span>
          </div>
        </div>

        {/* Figure Customization Options */}
        <div className="flex items-center gap-3">
          {/* Columns */}
          <div className="flex items-center gap-1 bg-slate-800 p-1 rounded-lg border border-slate-700 text-xs">
            <span className="px-2 text-slate-400">Layout:</span>
            {[1, 2, 3].map((cols) => (
              <button
                key={cols}
                onClick={() => setColumnsCount(cols)}
                className={`px-2 py-0.5 rounded font-mono transition-colors ${
                  columnsCount === cols
                    ? 'bg-sky-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {cols} Col{cols > 1 ? 's' : ''}
              </button>
            ))}
          </div>

          {/* Substrate Frame Toggle */}
          <button
            onClick={() => setIncludeSubstrateFrame(!includeSubstrateFrame)}
            className={`px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors ${
              includeSubstrateFrame
                ? 'bg-emerald-600/20 border-emerald-500/50 text-emerald-300'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
            title="Toggle inclusion of initial starting substrate frame (a)"
          >
            Substrate (a): {includeSubstrateFrame ? 'ON' : 'OFF'}
          </button>

          {/* Theme Selector */}
          <div className="flex items-center gap-1 bg-slate-800 p-1 rounded-lg border border-slate-700 text-xs">
            <button
              onClick={() => setTheme('paper')}
              className={`px-2.5 py-0.5 rounded font-medium transition-colors ${
                theme === 'paper'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Paper White (IEEE)
            </button>
            <button
              onClick={() => setTheme('dark')}
              className={`px-2.5 py-0.5 rounded font-medium transition-colors ${
                theme === 'dark'
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              CAD Dark
            </button>
          </div>

          {/* Export Buttons */}
          <button
            onClick={handleExportSvg}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-medium transition-colors"
          >
            <FileDown className="w-3.5 h-3.5 text-sky-400" />
            <span>Export SVG</span>
          </button>

          <button
            onClick={handleExportPng}
            disabled={isExporting}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold shadow-md transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{isExporting ? 'Exporting...' : 'Export High-Res PNG'}</span>
          </button>

          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>

      {/* Main Multi-Step Canvas Viewport */}
      <div
        ref={containerRef}
        className={`flex-1 overflow-auto p-8 flex justify-center ${
          theme === 'paper' ? 'bg-slate-200' : 'bg-slate-950'
        }`}
      >
        <div
          className={`p-8 rounded-xl shadow-2xl transition-all ${
            theme === 'paper'
              ? 'bg-white text-slate-900 border border-slate-300'
              : 'bg-[#060a12] text-slate-100 border border-slate-800'
          }`}
          style={{ width: `${masterSvgWidth}px` }}
        >
          {/* Flow Title Header on Figure */}
          <div className="mb-6 border-b pb-3 border-slate-300/60 dark:border-slate-800">
            <h1 className="text-xl font-bold tracking-tight">
              {flow.title}
            </h1>
            <p className="text-xs text-slate-500 mt-1 max-w-3xl">
              {flow.description}
            </p>
          </div>

          {/* Master SVG containing all steps */}
          <svg
            id="multi-step-master-svg"
            viewBox={`0 0 ${masterSvgWidth} ${masterSvgHeight}`}
            width={masterSvgWidth}
            height={masterSvgHeight}
            className="overflow-visible"
          >
            <SvgPatterns materials={flow.materials} />

            {stepMeshes.map((item, idx) => {
              const colIdx = idx % columnsCount;
              const rowIdx = Math.floor(idx / columnsCount);
              const originX = colIdx * cellWidth + 20;
              const originY = rowIdx * cellHeight + 20;

              const { mesh, polygons, step } = item;
              const subW = flow.substrateWidth || 10000;
              const scaleX = (cellWidth - padX * 2) / subW;
              const scaleY = ((cellHeight - padY * 2) * 0.6) / 3500;

              const toScreenLocal = (x: number, y: number) => {
                const sx = padX + x * scaleX;
                const sy = cellHeight - padY - (y - mesh.minY) * scaleY;
                return { x: sx, y: sy };
              };

              return (
                <g
                  key={step.id}
                  transform={`translate(${originX}, ${originY})`}
                  className="cursor-pointer"
                  onClick={() => {
                    onSelectStepIndex(idx);
                    onClose();
                  }}
                >
                  {/* Step Card Border */}
                  <rect
                    width={cellWidth - 10}
                    height={cellHeight - 10}
                    rx="8"
                    fill={theme === 'paper' ? '#fafafa' : '#0f172a'}
                    stroke={theme === 'paper' ? '#e2e8f0' : '#1e293b'}
                    strokeWidth="1.2"
                  />

                  {/* Step Caption / Title */}
                  <text
                    x={padX}
                    y={22}
                    fill={theme === 'paper' ? '#0f172a' : '#f8fafc'}
                    fontSize="11.5"
                    fontWeight="700"
                    fontFamily="Plus Jakarta Sans, sans-serif"
                  >
                    {getStepLetter(idx)} {step.title}
                    {item.blockName && ` [${item.blockName}]`}
                  </text>

                  {/* Subtitle / Recipe detail */}
                  {showToolInfo && (
                    <text
                      x={padX}
                      y={36}
                      fill={theme === 'paper' ? '#64748b' : '#94a3b8'}
                      fontSize="9.5"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {item.customSubtitle ||
                        (step.type === 'deposition' &&
                          `${step.deposition?.method || 'CVD'} · ${
                            step.deposition?.thickness || step.thickness || 200
                          } nm`) ||
                        (step.type === 'lithography' &&
                          `Photolithography · ${step.lithography?.polarity} tone${
                            item.reticleName ? ` · Reticle: ${item.reticleName}` : ''
                          }`) ||
                        (step.type === 'etch' &&
                          `Etch: ${step.etch?.etchType?.toUpperCase()} · depth ${
                            step.etch?.depth || step.thickness || 200
                          } nm`) ||
                        (step.type === 'strip' &&
                          `${step.strip?.stripType} · ${step.strip?.solvent || 'solvent'}`) ||
                        (step.type === 'liftoff' && 'Metal Lift-off') ||
                        (step.type === 'cmp' && 'CMP Planarization')}
                    </text>
                  )}

                  {/* Cross-Section Polygons */}
                  <g id={`step-polys-${idx}`}>
                    {polygons.map((poly) => {
                      const mat = getMaterialById(flow.materials, poly.materialId);
                      const pts = poly.points;
                      if (pts.length < 3) return null;

                      const first = toScreenLocal(pts[0].x, pts[0].y);
                      let pathD = `M ${first.x.toFixed(1)} ${first.y.toFixed(1)}`;
                      for (let pIdx = 1; pIdx < pts.length; pIdx++) {
                        const pt = toScreenLocal(pts[pIdx].x, pts[pIdx].y);
                        pathD += ` L ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
                      }
                      pathD += ' Z';

                      return (
                        <path
                          key={poly.id}
                          d={pathD}
                          fill={`url(#mat-fill-${mat.id})`}
                          stroke={theme === 'paper' ? '#0f172a' : mat.strokeColor || '#1e293b'}
                          strokeWidth="1.2"
                        />
                      );
                    })}
                  </g>

                  {/* Datum line */}
                  <line
                    x1={padX}
                    y1={cellHeight - padY}
                    x2={cellWidth - padX}
                    y2={cellHeight - padY}
                    stroke={theme === 'paper' ? '#94a3b8' : '#475569'}
                    strokeWidth="1"
                  />
                </g>
              );
            })}

            {/* Overall Materials Legend at bottom */}
            {showLegend && (
              <g transform={`translate(20, ${totalRows * cellHeight + 30})`}>
                <text
                  x="0"
                  y="12"
                  fill={theme === 'paper' ? '#334155' : '#94a3b8'}
                  fontSize="11"
                  fontWeight="600"
                >
                  Materials Legend:
                </text>
                {allUsedMaterials.map((mat, i) => {
                  const legX = 120 + i * 160;
                  return (
                    <g key={mat.id} transform={`translate(${legX}, 0)`}>
                      <rect
                        width="14"
                        height="14"
                        rx="2"
                        fill={`url(#mat-fill-${mat.id})`}
                        stroke={theme === 'paper' ? '#334155' : '#64748b'}
                        strokeWidth="1"
                      />
                      <text
                        x="20"
                        y="11"
                        fill={theme === 'paper' ? '#0f172a' : '#e2e8f0'}
                        fontSize="10"
                        fontFamily="Plus Jakarta Sans, sans-serif"
                      >
                        {mat.name}
                      </text>
                    </g>
                  );
                })}
              </g>
            )}
          </svg>
        </div>
      </div>
    </div>
  );
};
