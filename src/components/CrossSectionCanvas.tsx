/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState, useMemo, useCallback, useEffect } from 'react';
import {
  ProcessFlow,
  Material,
  CrossSectionMesh,
  RenderedPolygon,
} from '../types/microfab';
import { SvgPatterns } from './SvgPatterns';
import { getMaterialById } from '../lib/materials';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  Ruler,
  Layers,
  Sparkles,
  Info,
  Download,
  Maximize,
  Minimize,
} from 'lucide-react';

interface CrossSectionCanvasProps {
  mesh: CrossSectionMesh;
  polygons: RenderedPolygon[];
  materials: Material[];
  waferWidth: number; // nm
  title?: string;
  stepNumber?: number;
  totalSteps?: number;
  activeStepTitle?: string;
}

export const CrossSectionCanvas: React.FC<CrossSectionCanvasProps> = ({
  mesh,
  polygons,
  materials,
  waferWidth,
  title,
  stepNumber,
  totalSteps,
  activeStepTitle,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // Dynamic container sizing via ResizeObserver for perfect full-screen and small-window scaling
  const [containerSize, setContainerSize] = useState<{ width: number; height: number }>({
    width: 1000,
    height: 520,
  });

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;

    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) {
        setContainerSize({ width: w, height: h });
      }
    };
    measure();

    const ro = new ResizeObserver(() => {
      measure();
    });
    ro.observe(el);

    return () => ro.disconnect();
  }, []);

  // Pan and Zoom state
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Fullscreen state
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Vertical Z-exaggeration factor (essential in semiconductor CAD)
  const [zScale, setZScale] = useState<number>(2.0);

  // Measurement caliper tool
  const [measureMode, setMeasureMode] = useState<boolean>(false);
  const [measurePoints, setMeasurePoints] = useState<{ x: number; y: number }[]>([]);

  // Hovered layer inspector
  const [hoveredPolygon, setHoveredPolygon] = useState<RenderedPolygon | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Display toggles
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [renderMode, setRenderMode] = useState<'hatch' | 'solid'>('hatch');

  // SVG coordinate dimensions derived dynamically from container
  const svgWidth = Math.max(380, containerSize.width);
  const svgHeight = Math.max(260, containerSize.height);

  // Responsive margins
  const paddingX = Math.max(40, Math.min(80, svgWidth * 0.08));
  const bottomPadding = Math.max(50, Math.min(75, svgHeight * 0.14));
  const topPadding = Math.max(50, Math.min(75, svgHeight * 0.14));

  const contentWidth = svgWidth - paddingX * 2;
  const contentHeight = svgHeight - bottomPadding - topPadding;

  // True mathematical bounding box of the wafer geometry across all layers
  const { boundMinX, boundMaxX, boundMinY, boundMaxY } = useMemo(() => {
    let minX = 0;
    let maxX = waferWidth;
    let minY = mesh.minY ?? 0;
    let maxY = Math.max(mesh.maxY ?? 3000, 2500);

    for (const poly of polygons) {
      if (poly.xMin < minX) minX = poly.xMin;
      if (poly.xMax > maxX) maxX = poly.xMax;
      if (poly.yMin < minY) minY = poly.yMin;
      if (poly.yMax > maxY) maxY = poly.yMax;
      for (const p of poly.points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
    }

    return {
      boundMinX: minX,
      boundMaxX: maxX,
      boundMinY: minY,
      boundMaxY: maxY,
    };
  }, [polygons, waferWidth, mesh.minY, mesh.maxY]);

  const rawMinY = boundMinY;
  const rawMaxY = boundMaxY;
  const heightSpan = Math.max(300, rawMaxY - rawMinY);

  // Coordinate transforms: world nm -> SVG canvas coordinates
  const scaleX = contentWidth / waferWidth;
  // baseScaleY is normalized so that at 2.0x zScale, the wafer occupies ~62% of vertical contentHeight
  const baseScaleY = (contentHeight * 0.62) / (heightSpan * 2.0);
  const scaleY = baseScaleY * zScale;

  // World point to Screen point
  const toScreen = useCallback(
    (x: number, y: number) => {
      const sx = paddingX + x * scaleX;
      // Cleanroom physics: bottom of wafer is anchored to bottom datum line
      const sy = (svgHeight - bottomPadding) - (y - rawMinY) * scaleY;
      return { x: sx, y: sy };
    },
    [scaleX, scaleY, rawMinY, svgHeight, bottomPadding, paddingX]
  );

  // Screen point to World nm
  const toWorld = useCallback(
    (sx: number, sy: number) => {
      const wx = (sx - paddingX) / scaleX;
      const wy = rawMinY + ((svgHeight - bottomPadding) - sy) / scaleY;
      return { x: Math.max(0, Math.min(waferWidth, wx)), y: wy };
    },
    [scaleX, scaleY, rawMinY, svgHeight, bottomPadding, paddingX, waferWidth]
  );

  // Convert polygon points to SVG path with Z-scale
  const getTransformedPath = (pts: { x: number; y: number }[]) => {
    if (pts.length < 3) return '';
    const first = toScreen(pts[0].x, pts[0].y);
    let d = `M ${first.x.toFixed(1)} ${first.y.toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) {
      const p = toScreen(pts[i].x, pts[i].y);
      d += ` L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    }
    d += ' Z';
    return d;
  };

  // Intelligent Fit to Screen: centers the entire wafer bounding box into the viewport with 100% visibility
  const fitToScreen = useCallback(() => {
    const pBL = toScreen(boundMinX, boundMinY);
    const pTR = toScreen(boundMaxX, boundMaxY);

    const waferScreenW = Math.max(20, Math.abs(pTR.x - pBL.x));
    const waferScreenH = Math.max(20, Math.abs(pBL.y - pTR.y));

    // Target viewport area leaving comfortable clearance on all sides
    const targetAvailW = Math.max(150, svgWidth - paddingX * 2 - 30);
    const targetAvailH = Math.max(120, svgHeight - bottomPadding - topPadding - 30);

    const zoomW = targetAvailW / waferScreenW;
    const zoomH = targetAvailH / waferScreenH;
    // Apply 92% factor so nothing touches the screen border
    const optimalZoom = Math.min(zoomW, zoomH) * 0.92;
    const safeZoom = Math.max(0.12, Math.min(4.0, optimalZoom));

    // Center of wafer in unscaled screen coordinates
    const waferCenterX = (pBL.x + pTR.x) / 2;
    // Shift up slightly (by 10px) to provide ample room for the bottom coordinate axis labels
    const waferCenterY = (pBL.y + pTR.y) / 2 - 10;

    const panX = svgWidth / 2 - waferCenterX * safeZoom;
    const panY = svgHeight / 2 - waferCenterY * safeZoom;

    setZoom(safeZoom);
    setPan({ x: panX, y: panY });
    setMeasurePoints([]);
  }, [
    toScreen,
    boundMinX,
    boundMinY,
    boundMaxX,
    boundMaxY,
    svgWidth,
    svgHeight,
    paddingX,
    bottomPadding,
    topPadding,
  ]);

  // Auto-fit on initial render or when step/dimensions/containerSize change
  useEffect(() => {
    fitToScreen();
  }, [
    stepNumber,
    waferWidth,
    zScale,
    containerSize.width,
    containerSize.height,
    fitToScreen,
  ]);

  // Keyboard shortcut: Press 'F' to fit to screen
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        fitToScreen();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [fitToScreen]);

  // Listen to fullscreen change
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFs = !!document.fullscreenElement;
      setIsFullscreen(isFs);
      // Re-measure and fit shortly after animation completes
      setTimeout(fitToScreen, 120);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [fitToScreen]);

  const toggleFullscreen = () => {
    if (!cardRef.current) return;
    if (!document.fullscreenElement) {
      cardRef.current.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  // Mouse pan handlers
  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (measureMode) {
      const svg = e.currentTarget;
      const ctm = svg.getScreenCTM();
      if (ctm) {
        const pt = svg.createSVGPoint();
        pt.x = e.clientX;
        pt.y = e.clientY;
        const svgP = pt.matrixTransform(ctm.inverse());
        const clickX = (svgP.x - pan.x) / zoom;
        const clickY = (svgP.y - pan.y) / zoom;
        const worldPt = toWorld(clickX, clickY);

        if (measurePoints.length >= 2) {
          setMeasurePoints([worldPt]);
        } else {
          setMeasurePoints([...measurePoints, worldPt]);
        }
      }
      return;
    }

    setIsPanning(true);
    setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });

    if (isPanning) {
      setPan({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
      });
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 0.88;
    setZoom((prev) => Math.max(0.15, Math.min(6.0, prev * factor)));
  };

  // Download high-res SVG of active canvas
  const handleExportSingleSvg = () => {
    const svgEl = containerRef.current?.querySelector('svg');
    if (!svgEl) return;
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svgEl);
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wafer-cross-section-step-${stepNumber ?? 1}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      ref={cardRef}
      className="relative flex flex-col h-full bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl select-none"
    >
      {/* Top CAD Control Bar - Truly responsive layout */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-900 border-b border-slate-800 text-xs gap-2 min-w-0">
        {/* Left: Status & Active Step Title */}
        <div className="flex items-center gap-2 min-w-0 flex-1 truncate">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shrink-0 animate-pulse" />
          <span className="font-semibold text-slate-200 truncate text-xs">
            {title || 'Wafer Cross-Section'}
          </span>
          {stepNumber !== undefined && (
            <span className="text-slate-300 font-mono text-[11px] shrink-0 bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700/80">
              {stepNumber === 0 ? 'Substrate' : `Step ${stepNumber}/${totalSteps}`}
            </span>
          )}
          {activeStepTitle && (
            <span className="text-sky-400 font-medium truncate text-[11px] hidden xl:inline">
              · {activeStepTitle}
            </span>
          )}
        </div>

        {/* Right: Viewport Controls with GUARANTEED Visible Fit Button */}
        <div className="flex items-center gap-1.5 shrink-0 ml-auto">
          {/* PRIMARY: Zoom & Resize to Screen (Fit) Controls - Always preserved! */}
          <div className="flex items-center gap-0.5 bg-slate-800/90 border border-slate-700/80 rounded-lg p-0.5 shrink-0 shadow-sm">
            <button
              onClick={() => setZoom((z) => Math.max(0.15, z * 0.85))}
              className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
              title="Zoom Out (-)"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="px-1 text-[11px] font-mono text-slate-200 min-w-8 text-center select-none">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom((z) => Math.min(5.0, z * 1.18))}
              className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
              title="Zoom In (+)"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            {/* The Resize to Screen Button */}
            <button
              onClick={fitToScreen}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/50 hover:border-sky-400 transition-all font-semibold text-[11px] shadow-sm active:scale-95"
              title="Resize to Screen / Fit Wafer (F)"
            >
              <Maximize2 className="w-3.5 h-3.5 text-sky-400" />
              <span className="inline font-medium">Fit</span>
            </button>
          </div>

          {/* Vertical Z-Scale Selector */}
          <div
            className="flex items-center gap-1 px-1.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 shrink-0"
            title="Vertical Exaggeration Factor"
          >
            <span className="text-[10px] text-slate-400 font-mono">Z:</span>
            <select
              value={zScale}
              onChange={(e) => setZScale(parseFloat(e.target.value))}
              className="bg-transparent text-white font-mono text-[11px] focus:outline-none cursor-pointer"
            >
              <option value="1.0" className="bg-slate-900">1.0x</option>
              <option value="1.5" className="bg-slate-900">1.5x</option>
              <option value="2.0" className="bg-slate-900">2.0x</option>
              <option value="3.5" className="bg-slate-900">3.5x</option>
              <option value="5.0" className="bg-slate-900">5.0x</option>
            </select>
          </div>

          {/* Hatch vs Solid toggle */}
          <button
            onClick={() => setRenderMode(renderMode === 'hatch' ? 'solid' : 'hatch')}
            className={`px-2 py-1 rounded-lg border text-[11px] font-medium transition-colors hidden sm:inline-flex ${
              renderMode === 'hatch'
                ? 'bg-sky-600/20 border-sky-500/50 text-sky-300'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
            title="Toggle Cleanroom Hatching Patterns"
          >
            Hatch
          </button>

          {/* Caliper Measurement tool */}
          <button
            onClick={() => {
              setMeasureMode(!measureMode);
              setMeasurePoints([]);
            }}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-medium transition-colors ${
              measureMode
                ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
            title="Measure distances (Caliper)"
          >
            <Ruler className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Caliper</span>
          </button>

          {/* Export SVG */}
          <button
            onClick={handleExportSingleSvg}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-[11px] transition-colors"
            title="Download SVG Vector"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">SVG</span>
          </button>

          {/* Canvas Fullscreen Toggle */}
          <button
            onClick={toggleFullscreen}
            className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white transition-colors"
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen Canvas'}
          >
            {isFullscreen ? (
              <Minimize className="w-3.5 h-3.5" />
            ) : (
              <Maximize className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Main SVG Cross-Section Viewport */}
      <div
        ref={containerRef}
        onWheel={handleWheel}
        className="relative flex-1 w-full h-full overflow-hidden cursor-crosshair bg-[#060a12]"
      >
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="w-full h-full block"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
        >
          <SvgPatterns materials={materials} />

          {/* Master Transform Group (Pan & Zoom) */}
          <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
            {/* Grid background */}
            {showGrid && (
              <g opacity="0.15">
                {/* Vertical grid lines (every 1 µm) */}
                {Array.from({ length: 11 }).map((_, i) => {
                  const xNm = (waferWidth / 10) * i;
                  const pt = toScreen(xNm, 0);
                  const datumY = toScreen(0, rawMinY).y;
                  return (
                    <line
                      key={`vgrid_${i}`}
                      x1={pt.x}
                      y1={toScreen(0, rawMaxY).y - 40}
                      x2={pt.x}
                      y2={datumY + 25}
                      stroke="#94a3b8"
                      strokeWidth="1"
                      strokeDasharray="3 3"
                    />
                  );
                })}
              </g>
            )}

            {/* Simulated Material Polygons */}
            <g id="wafer-layers">
              {polygons.map((poly) => {
                const mat = getMaterialById(materials, poly.materialId);
                const isHovered = hoveredPolygon?.id === poly.id;
                const pathStr = getTransformedPath(poly.points);
                const fillRef =
                  renderMode === 'hatch'
                    ? `url(#mat-fill-${mat.id})`
                    : mat.color;

                return (
                  <path
                    key={poly.id}
                    d={pathStr}
                    fill={fillRef}
                    stroke={isHovered ? '#38bdf8' : mat.strokeColor || '#1e293b'}
                    strokeWidth={isHovered ? 2.5 : 1.2}
                    className="transition-all cursor-pointer"
                    onMouseEnter={() => setHoveredPolygon(poly)}
                    onMouseLeave={() => setHoveredPolygon(null)}
                  />
                );
              })}
            </g>

            {/* Wafer X Axis & Coordinates */}
            <g id="wafer-axes">
              {/* Bottom datum line */}
              {(() => {
                const datumY = toScreen(0, rawMinY).y;
                return (
                  <>
                    <line
                      x1={paddingX}
                      y1={datumY}
                      x2={paddingX + contentWidth}
                      y2={datumY}
                      stroke="#64748b"
                      strokeWidth="1.5"
                    />

                    {/* Ticks along X */}
                    {Array.from({ length: 11 }).map((_, i) => {
                      const xNm = (waferWidth / 10) * i;
                      const xUm = (xNm / 1000).toFixed(1);
                      const pt = toScreen(xNm, 0);
                      return (
                        <g key={`xtick_${i}`} transform={`translate(${pt.x}, ${datumY})`}>
                          <line y1="0" y2="6" stroke="#64748b" strokeWidth="1" />
                          <text
                            y="18"
                            textAnchor="middle"
                            fill="#94a3b8"
                            fontSize="9.5"
                            fontFamily="JetBrains Mono, monospace"
                          >
                            {xUm} µm
                          </text>
                        </g>
                      );
                    })}
                  </>
                );
              })()}
            </g>

            {/* Caliper measurement lines */}
            {measurePoints.length > 0 && (
              <g id="caliper-measurement">
                {measurePoints.map((pt, i) => {
                  const s = toScreen(pt.x, pt.y);
                  return (
                    <circle
                      key={`meas_pt_${i}`}
                      cx={s.x}
                      cy={s.y}
                      r="4"
                      fill="#f59e0b"
                      stroke="#fff"
                      strokeWidth="1.5"
                    />
                  );
                })}

                {measurePoints.length === 2 && (() => {
                  const p1 = toScreen(measurePoints[0].x, measurePoints[0].y);
                  const p2 = toScreen(measurePoints[1].x, measurePoints[1].y);
                  const dxNm = Math.abs(measurePoints[1].x - measurePoints[0].x);
                  const dyNm = Math.abs(measurePoints[1].y - measurePoints[0].y);
                  const distNm = Math.sqrt(dxNm * dxNm + dyNm * dyNm);
                  const midX = (p1.x + p2.x) / 2;
                  const midY = (p1.y + p2.y) / 2;

                  return (
                    <g>
                      <line
                        x1={p1.x}
                        y1={p1.y}
                        x2={p2.x}
                        y2={p2.y}
                        stroke="#f59e0b"
                        strokeWidth="1.8"
                        strokeDasharray="4 3"
                      />
                      <rect
                        x={midX - 55}
                        y={midY - 26}
                        width="110"
                        height="24"
                        rx="5"
                        fill="#0f172a"
                        stroke="#f59e0b"
                        strokeWidth="1.2"
                      />
                      <text
                        x={midX}
                        y={midY - 11}
                        fill="#fbbf24"
                        fontSize="10"
                        fontWeight="600"
                        fontFamily="JetBrains Mono, monospace"
                        textAnchor="middle"
                      >
                        {dxNm >= 1000
                          ? `ΔX: ${(dxNm / 1000).toFixed(2)} µm`
                          : `ΔX: ${Math.round(dxNm)} nm`}{' '}
                        | ΔY: {Math.round(dyNm)} nm
                      </text>
                    </g>
                  );
                })()}
              </g>
            )}
          </g>

          {/* Cleanroom Scale Bar HUD in bottom-left */}
          <g transform={`translate(${paddingX}, ${svgHeight - 20})`}>
            {(() => {
              // 1.0 µm or 0.5 µm scale bar length in screen pixels
              const barUm = waferWidth >= 5000 ? 1.0 : 0.5;
              const barNm = barUm * 1000;
              const barPixels = barNm * scaleX * zoom;

              return (
                <g>
                  <line
                    x1="0"
                    y1="0"
                    x2={barPixels}
                    y2="0"
                    stroke="#e2e8f0"
                    strokeWidth="3"
                  />
                  <line x1="0" y1="-4" x2="0" y2="4" stroke="#e2e8f0" strokeWidth="2" />
                  <line
                    x1={barPixels}
                    y1="-4"
                    x2={barPixels}
                    y2="4"
                    stroke="#e2e8f0"
                    strokeWidth="2"
                  />
                  <text
                    x={barPixels / 2}
                    y="-6"
                    fill="#e2e8f0"
                    fontSize="10"
                    fontWeight="600"
                    fontFamily="JetBrains Mono, monospace"
                    textAnchor="middle"
                  >
                    {barUm} µm
                  </text>
                </g>
              );
            })()}
          </g>
        </svg>

        {/* FLOATING QUICK-ACTION HUD (Bottom-Right) - Always accessible on canvas */}
        <div className="absolute bottom-3 right-3 z-10 flex items-center gap-1 bg-slate-900/90 backdrop-blur-md border border-slate-700/80 shadow-2xl rounded-xl p-1 text-xs">
          <button
            onClick={() => setZoom((z) => Math.max(0.15, z * 0.85))}
            className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
            title="Zoom Out (-)"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={fitToScreen}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-medium text-[11px] shadow-sm transition-all active:scale-95"
            title="Resize / Fit Wafer to Screen (F)"
          >
            <Maximize2 className="w-3.5 h-3.5" />
            <span>Fit</span>
          </button>
          <button
            onClick={() => setZoom((z) => Math.min(5.0, z * 1.18))}
            className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
            title="Zoom In (+)"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Hover Layer Inspector Tooltip */}
        {hoveredPolygon && (
          <div
            className="absolute pointer-events-none z-20 px-3 py-2 rounded-xl bg-slate-900/95 border border-sky-500/50 text-white shadow-2xl backdrop-blur-md"
            style={{
              left: `${Math.min(svgWidth - 200, Math.max(10, mousePos.x + 15))}px`,
              top: `${Math.max(10, Math.min(svgHeight - 85, mousePos.y - 65))}px`,
            }}
          >
            {(() => {
              const mat = getMaterialById(materials, hoveredPolygon.materialId);
              const heightNm = Math.round(hoveredPolygon.yMax - hoveredPolygon.yMin);
              return (
                <div className="space-y-1 text-xs">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-3 h-3 rounded-full border border-white/20 shrink-0"
                      style={{ backgroundColor: mat.color }}
                    />
                    <span className="font-semibold text-sky-300">{mat.name}</span>
                  </div>
                  <div className="text-[11px] text-slate-300 font-mono flex items-center gap-2">
                    <span>
                      Thickness: {heightNm >= 1000 ? `${(heightNm / 1000).toFixed(2)} µm` : `${heightNm} nm`}
                    </span>
                    <span className="text-slate-500">|</span>
                    <span className="text-slate-400 capitalize">{mat.category}</span>
                  </div>
                  {hoveredPolygon.stepId && (
                    <div className="text-[10px] text-slate-400">
                      Step: {hoveredPolygon.stepId}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
};
