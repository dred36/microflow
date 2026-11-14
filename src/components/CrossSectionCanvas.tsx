/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState, useMemo, useCallback, useEffect, useLayoutEffect } from 'react';
import {
  ProcessFlow,
  ProcessSide,
  Material,
  CrossSectionMesh,
  RenderedPolygon,
} from '../types/microfab';
import { SvgPatterns } from './SvgPatterns';
import { getMaterialById } from '../lib/materials';
import { ThicknessUnit, formatThickness } from '../lib/units';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Ruler,
  Download,
  Maximize,
  Minimize,
  Search,
} from 'lucide-react';

interface CrossSectionCanvasProps {
  mesh: CrossSectionMesh;
  polygons: RenderedPolygon[];
  materials: Material[];
  waferWidth: number; // nm
  flowId?: string;
  thicknessUnit?: ThicknessUnit;
  title?: string;
  stepNumber?: number;
  totalSteps?: number;
  activeStepTitle?: string;
  activeStepSide?: ProcessSide;
}

export const CrossSectionCanvas: React.FC<CrossSectionCanvasProps> = ({
  mesh,
  polygons,
  materials,
  waferWidth,
  flowId,
  thicknessUnit = 'nm',
  title,
  stepNumber,
  totalSteps,
  activeStepTitle,
  activeStepSide,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

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

  // Region zoom (Magnifying glass) state
  const [regionZoomMode, setRegionZoomMode] = useState<boolean>(false);
  const [zoomSelection, setZoomSelection] = useState<{
    startX: number;
    startY: number;
    endX: number;
    endY: number;
  } | null>(null);

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

  // Locked projection baseline when user manually zooms or pans so step changes,
  // MaskEditor mounting/unmounting, and sidebar toggles never rescale or shift features.
  const [lockedMetrics, setLockedMetrics] = useState<{
    heightSpan: number;
    rawMinY: number;
    paddingX: number;
    datumScreenY: number;
    contentWidth: number;
    contentHeight: number;
  } | null>(null);
  const isLockedRef = useRef<boolean>(false);
  isLockedRef.current = lockedMetrics !== null;

  // SVG coordinate dimensions derived dynamically from container
  const svgWidth = Math.max(380, containerSize.width);
  const svgHeight = Math.max(260, containerSize.height);

  // Responsive margins
  const paddingX = Math.max(40, Math.min(80, svgWidth * 0.08));
  const bottomPadding = Math.max(50, Math.min(75, svgHeight * 0.14));
  const topPadding = Math.max(50, Math.min(75, svgHeight * 0.14));

  const contentWidth = svgWidth - paddingX * 2;
  const contentHeight = svgHeight - bottomPadding - topPadding;
  const datumScreenY = svgHeight - bottomPadding;

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
  const actualSpan = Math.max(300, rawMaxY - rawMinY);

  const effectiveMinY = lockedMetrics ? lockedMetrics.rawMinY : rawMinY;
  const effectiveSpan = lockedMetrics ? lockedMetrics.heightSpan : actualSpan;
  const effectivePaddingX = lockedMetrics ? lockedMetrics.paddingX : paddingX;
  const effectiveDatumScreenY = lockedMetrics ? lockedMetrics.datumScreenY : datumScreenY;
  const effectiveContentWidth = lockedMetrics ? lockedMetrics.contentWidth : contentWidth;
  const effectiveContentHeight = lockedMetrics ? lockedMetrics.contentHeight : contentHeight;

  // Coordinate transforms: world nm -> SVG canvas coordinates
  const scaleX = effectiveContentWidth / waferWidth;
  // baseScaleY is normalized so that at 2.0x zScale, the wafer occupies ~62% of vertical contentHeight
  const baseScaleY = (effectiveContentHeight * 0.62) / (effectiveSpan * 2.0);
  const scaleY = baseScaleY * zScale;

  const lockViewport = useCallback(() => {
    setLockedMetrics((prev) =>
      prev ?? {
        heightSpan: actualSpan,
        rawMinY,
        paddingX,
        datumScreenY,
        contentWidth,
        contentHeight,
      }
    );
  }, [actualSpan, rawMinY, paddingX, datumScreenY, contentWidth, contentHeight]);

  // World point to Screen point
  const toScreen = useCallback(
    (x: number, y: number) => {
      const sx = effectivePaddingX + x * scaleX;
      // Cleanroom physics: bottom of wafer is anchored to bottom datum line
      const sy = effectiveDatumScreenY - (y - effectiveMinY) * scaleY;
      return { x: sx, y: sy };
    },
    [scaleX, scaleY, effectiveMinY, effectiveDatumScreenY, effectivePaddingX]
  );

  // Screen point to World nm
  const toWorld = useCallback(
    (sx: number, sy: number) => {
      const wx = (sx - effectivePaddingX) / scaleX;
      const wy = effectiveMinY + (effectiveDatumScreenY - sy) / scaleY;
      return { x: Math.max(0, Math.min(waferWidth, wx)), y: wy };
    },
    [scaleX, scaleY, effectiveMinY, effectiveDatumScreenY, effectivePaddingX, waferWidth]
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
    setLockedMetrics(null);

    const actualBaseScaleY = (contentHeight * 0.62) / (actualSpan * 2.0);
    const actualScaleX = contentWidth / waferWidth;
    const actualScaleY = actualBaseScaleY * zScale;
    const project = (x: number, y: number) => ({
      x: paddingX + x * actualScaleX,
      y: (svgHeight - bottomPadding) - (y - rawMinY) * actualScaleY,
    });

    const pBL = project(boundMinX, boundMinY);
    const pTR = project(boundMaxX, boundMaxY);

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
    boundMinX,
    boundMinY,
    boundMaxX,
    boundMaxY,
    rawMinY,
    actualSpan,
    waferWidth,
    zScale,
    contentWidth,
    contentHeight,
    svgWidth,
    svgHeight,
    paddingX,
    bottomPadding,
    topPadding,
  ]);

  // Reset viewport lock when switching to a different flow preset or changing wafer width
  useEffect(() => {
    setLockedMetrics(null);
  }, [flowId, waferWidth]);

  // Keep the inspected center feature anchored when container resizes (e.g. MaskEditor mounting on litho steps)
  const prevSvgSizeRef = useRef<{ width: number; height: number }>({
    width: svgWidth,
    height: svgHeight,
  });

  useLayoutEffect(() => {
    const prev = prevSvgSizeRef.current;
    const dw = svgWidth - prev.width;
    const dh = svgHeight - prev.height;
    prevSvgSizeRef.current = { width: svgWidth, height: svgHeight };

    if (lockedMetrics !== null && (dw !== 0 || dh !== 0)) {
      setPan((p) => ({
        x: p.x + dw / 2,
        y: p.y + dh / 2,
      }));
    }
  }, [svgWidth, svgHeight, lockedMetrics]);

  // Auto-fit ONLY when user has not manually zoomed/panned
  useEffect(() => {
    if (lockedMetrics !== null) return;
    fitToScreen();
  }, [
    lockedMetrics,
    stepNumber,
    waferWidth,
    zScale,
    containerSize.width,
    containerSize.height,
    fitToScreen,
  ]);

  // Convert client pointer position to SVG viewBox coordinates
  const clientToSvg = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const svgP = pt.matrixTransform(ctm.inverse());
    return { x: svgP.x, y: svgP.y };
  }, []);

  // Uniform zoom around a pivot in SVG coordinates (never distorts geometry aspect ratio)
  const zoomAroundPoint = useCallback(
    (targetZoom: number, pivotSvgX: number, pivotSvgY: number) => {
      lockViewport();
      const clampedZoom = Math.max(0.12, Math.min(25.0, targetZoom));
      const ux = (pivotSvgX - pan.x) / zoom;
      const uy = (pivotSvgY - pan.y) / zoom;
      setZoom(clampedZoom);
      setPan({
        x: pivotSvgX - ux * clampedZoom,
        y: pivotSvgY - uy * clampedZoom,
      });
    },
    [pan.x, pan.y, zoom, lockViewport]
  );

  // Commit selected region zoom uniformly so selection aspect ratio never stretches geometry
  const commitRegionZoom = useCallback(
    (sel: { startX: number; startY: number; endX: number; endY: number }) => {
      const selLeft = Math.min(sel.startX, sel.endX);
      const selRight = Math.max(sel.startX, sel.endX);
      const selTop = Math.min(sel.startY, sel.endY);
      const selBottom = Math.max(sel.startY, sel.endY);
      const selW = selRight - selLeft;
      const selH = selBottom - selTop;

      if (selW < 8 && selH < 8) {
        // Single click in magnifying glass mode zooms 2x centered on clicked point
        zoomAroundPoint(zoom * 2.0, sel.startX, sel.startY);
        return;
      }

      lockViewport();
      const safeSelW = Math.max(8, selW);
      const safeSelH = Math.max(8, selH);

      // Selection center in unscaled SVG coordinates
      const selCenterSvgX = (selLeft + selRight) / 2;
      const selCenterSvgY = (selTop + selBottom) / 2;
      const uCenterX = (selCenterSvgX - pan.x) / zoom;
      const uCenterY = (selCenterSvgY - pan.y) / zoom;

      // Apply uniform scalar zoom based on tightest axis so entire region fits without distortion
      const scaleFactor = Math.min(
        (svgWidth * 0.92) / safeSelW,
        (svgHeight * 0.92) / safeSelH
      );
      const newZoom = Math.max(0.12, Math.min(25.0, zoom * scaleFactor));

      setZoom(newZoom);
      setPan({
        x: svgWidth / 2 - uCenterX * newZoom,
        y: svgHeight / 2 - uCenterY * newZoom,
      });
    },
    [pan.x, pan.y, zoom, svgWidth, svgHeight, zoomAroundPoint, lockViewport]
  );

  // Keyboard shortcuts: 'F' to fit to screen, 'Escape' to cancel region zoom / caliper
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        fitToScreen();
      } else if (e.key === 'Escape') {
        if (zoomSelection) {
          setZoomSelection(null);
        } else if (regionZoomMode) {
          setRegionZoomMode(false);
        } else if (measureMode) {
          setMeasureMode(false);
          setMeasurePoints([]);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [fitToScreen, zoomSelection, regionZoomMode, measureMode]);

  // Listen to fullscreen change
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFs = !!document.fullscreenElement;
      setIsFullscreen(isFs);
      // Only auto-fit on fullscreen toggle if user hasn't locked a custom zoom/pan
      if (!isLockedRef.current) {
        setTimeout(fitToScreen, 120);
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [fitToScreen]);

  // Complete marquee drag even if pointer leaves SVG bounds
  useEffect(() => {
    if (!zoomSelection) return;
    const handleWindowMouseMove = (e: MouseEvent) => {
      const svgP = clientToSvg(e.clientX, e.clientY);
      if (!svgP) return;
      setZoomSelection((prev) =>
        prev
          ? {
              ...prev,
              endX: Math.max(0, Math.min(svgWidth, svgP.x)),
              endY: Math.max(0, Math.min(svgHeight, svgP.y)),
            }
          : null
      );
    };
    const handleWindowMouseUp = () => {
      setZoomSelection((prev) => {
        if (prev) {
          commitRegionZoom(prev);
        }
        return null;
      });
    };
    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [zoomSelection !== null, clientToSvg, commitRegionZoom, svgWidth, svgHeight]);

  const toggleFullscreen = () => {
    if (!cardRef.current) return;
    if (!document.fullscreenElement) {
      cardRef.current.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  // Mouse pan / caliper / region zoom handlers
  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const svgP = clientToSvg(e.clientX, e.clientY);

    if (regionZoomMode && svgP) {
      setZoomSelection({
        startX: svgP.x,
        startY: svgP.y,
        endX: svgP.x,
        endY: svgP.y,
      });
      return;
    }

    if (measureMode && svgP) {
      const clickX = (svgP.x - pan.x) / zoom;
      const clickY = (svgP.y - pan.y) / zoom;
      const worldPt = toWorld(clickX, clickY);

      if (measurePoints.length >= 2) {
        setMeasurePoints([worldPt]);
      } else {
        setMeasurePoints([...measurePoints, worldPt]);
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
      const nextPanX = e.clientX - panStart.x;
      const nextPanY = e.clientY - panStart.y;
      if (Math.abs(nextPanX - pan.x) > 2 || Math.abs(nextPanY - pan.y) > 2) {
        lockViewport();
      }
      setPan({
        x: nextPanX,
        y: nextPanY,
      });
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 0.88;
    const svgP = clientToSvg(e.clientX, e.clientY);
    if (svgP) {
      zoomAroundPoint(zoom * factor, svgP.x, svgP.y);
    } else {
      zoomAroundPoint(zoom * factor, svgWidth / 2, svgHeight / 2);
    }
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
          {activeStepSide === 'back' && (
            <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 font-mono text-[10px] font-semibold shrink-0">
              Backside (-Z)
            </span>
          )}
          {activeStepSide === 'both' && (
            <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-mono text-[10px] font-semibold shrink-0">
              Both Sides (±Z)
            </span>
          )}
        </div>

        {/* Right: Viewport Controls with GUARANTEED Visible Fit Button */}
        <div className="flex items-center gap-1.5 shrink-0 ml-auto">
          {/* PRIMARY: Zoom & Resize to Screen (Fit) Controls - Always preserved! */}
          <div className="flex items-center gap-0.5 bg-slate-800/90 border border-slate-700/80 rounded-lg p-0.5 shrink-0 shadow-sm">
            <button
              onClick={() => zoomAroundPoint(zoom * 0.85, svgWidth / 2, svgHeight / 2)}
              className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
              title="Zoom Out (-)"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="px-1 text-[11px] font-mono text-slate-200 min-w-9 text-center select-none">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => zoomAroundPoint(zoom * 1.18, svgWidth / 2, svgHeight / 2)}
              className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
              title="Zoom In (+)"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            {/* Magnifying Glass Region Zoom */}
            <button
              onClick={() => {
                const next = !regionZoomMode;
                setRegionZoomMode(next);
                setZoomSelection(null);
                if (next) {
                  setMeasureMode(false);
                }
              }}
              className={`flex items-center gap-1 px-2 py-0.5 rounded transition-all font-medium text-[11px] ${
                regionZoomMode
                  ? 'bg-sky-500 text-white shadow-sm ring-1 ring-sky-300/60'
                  : 'text-slate-300 hover:text-white hover:bg-slate-700'
              }`}
              title="Magnifying Glass: Drag a region to zoom without altering geometry aspect ratio"
            >
              <Search className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Zoom Area</span>
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
              value={zScale.toFixed(1)}
              onChange={(e) => {
                const nextZ = parseFloat(e.target.value);
                if (lockedMetrics !== null && zScale > 0) {
                  const uyOld = (svgHeight / 2 - pan.y) / zoom;
                  const uyNew =
                    effectiveDatumScreenY -
                    (effectiveDatumScreenY - uyOld) * (nextZ / zScale);
                  setPan((p) => ({
                    ...p,
                    y: svgHeight / 2 - uyNew * zoom,
                  }));
                }
                setZScale(nextZ);
              }}
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
              const next = !measureMode;
              setMeasureMode(next);
              setMeasurePoints([]);
              if (next) {
                setRegionZoomMode(false);
                setZoomSelection(null);
              }
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
        className={`relative flex-1 w-full h-full overflow-hidden bg-[#060a12] ${
          regionZoomMode
            ? 'cursor-zoom-in'
            : measureMode
            ? 'cursor-crosshair'
            : isPanning
            ? 'cursor-grabbing'
            : 'cursor-grab'
        }`}
      >
        <svg
          ref={svgRef}
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
                    className="transition-colors cursor-pointer"
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
                      x1={effectivePaddingX}
                      y1={datumY}
                      x2={effectivePaddingX + effectiveContentWidth}
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

                    {/* Wafer Orientation Markers (Frontside +Z / Backside -Z) */}
                    <text
                      x={effectivePaddingX}
                      y={toScreen(0, rawMaxY).y - 10}
                      fill={
                        activeStepSide === 'front' || !activeStepSide
                          ? '#38bdf8'
                          : activeStepSide === 'both'
                          ? '#34d399'
                          : '#64748b'
                      }
                      fontSize="9.5"
                      fontWeight="600"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      ▲ FRONTSIDE (+Z)
                    </text>
                    <text
                      x={effectivePaddingX}
                      y={datumY + 34}
                      fill={
                        activeStepSide === 'back'
                          ? '#fbbf24'
                          : activeStepSide === 'both'
                          ? '#34d399'
                          : '#64748b'
                      }
                      fontSize="9.5"
                      fontWeight="600"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      ▼ BACKSIDE (-Z)
                    </text>
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
                        x={midX - 72}
                        y={midY - 26}
                        width="144"
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
                        ΔX: {formatThickness(dxNm, thicknessUnit)} | ΔY: {formatThickness(dyNm, thicknessUnit)}
                      </text>
                    </g>
                  );
                })()}
              </g>
            )}
          </g>

          {/* Magnifying Glass Region Selection Marquee (Screen / Viewport coordinates) */}
          {zoomSelection && (() => {
            const x = Math.min(zoomSelection.startX, zoomSelection.endX);
            const y = Math.min(zoomSelection.startY, zoomSelection.endY);
            const w = Math.abs(zoomSelection.endX - zoomSelection.startX);
            const h = Math.abs(zoomSelection.endY - zoomSelection.startY);
            const w1 = toWorld((x - pan.x) / zoom, (y - pan.y) / zoom);
            const w2 = toWorld((x + w - pan.x) / zoom, (y + h - pan.y) / zoom);
            const dxNm = Math.abs(w2.x - w1.x);
            const dyNm = Math.abs(w2.y - w1.y);
            return (
              <g pointerEvents="none">
                <rect
                  x={x}
                  y={y}
                  width={w}
                  height={h}
                  fill="rgba(56, 189, 248, 0.14)"
                  stroke="#38bdf8"
                  strokeWidth="1.5"
                  strokeDasharray="5 3"
                  rx="2"
                />
                {(w > 24 || h > 24) && (
                  <g transform={`translate(${Math.min(svgWidth - 140, x)}, ${Math.max(20, y - 6)})`}>
                    <rect
                      x="0"
                      y="-14"
                      width="136"
                      height="16"
                      rx="3"
                      fill="#0f172a"
                      fillOpacity="0.92"
                      stroke="#38bdf8"
                      strokeWidth="0.8"
                    />
                    <text
                      x="6"
                      y="-3"
                      fill="#7dd3fc"
                      fontSize="9.5"
                      fontFamily="JetBrains Mono, monospace"
                      fontWeight="600"
                    >
                      {formatThickness(dxNm, thicknessUnit)} × {formatThickness(dyNm, thicknessUnit)}
                    </text>
                  </g>
                )}
              </g>
            );
          })()}

          {/* Cleanroom Scale Bar HUD in bottom-left */}
          <g transform={`translate(${Math.min(paddingX, 40)}, ${svgHeight - 20})`}>
            {(() => {
              const pxPerNm = scaleX * zoom;
              if (!Number.isFinite(pxPerNm) || pxPerNm <= 0) return null;

              const leftOriginX = Math.min(paddingX, 40);
              const maxBarPx = Math.max(64, Math.min(180, svgWidth - leftOriginX - 210));
              const minBarPx = Math.min(44, maxBarPx * 0.45);
              const targetBarPx = Math.max(minBarPx, Math.min(115, maxBarPx * 0.72));

              // Pick the cleanest 1-2-5 * 10^k nm length within [minBarPx, maxBarPx]
              let bestNm = 1000;
              let bestScore = Infinity;
              for (let exp = -1; exp <= 7; exp++) {
                const pow = Math.pow(10, exp);
                for (const mult of [1, 2, 5]) {
                  const candidateNm = mult * pow;
                  const px = candidateNm * pxPerNm;
                  if (px > maxBarPx) continue;
                  const penalty = px < minBarPx ? (minBarPx - px) * 5 : 0;
                  const score = Math.abs(px - targetBarPx) + penalty;
                  if (score < bestScore) {
                    bestScore = score;
                    bestNm = candidateNm;
                  }
                }
              }

              // Fallback if even smallest candidate exceeded maxBarPx
              let barPixels = bestNm * pxPerNm;
              if (barPixels > maxBarPx) {
                barPixels = maxBarPx;
                bestNm = maxBarPx / pxPerNm;
              }

              const formatScaleLabel = (nm: number): string => {
                if (nm >= 1_000_000) {
                  const mm = Math.round((nm / 1_000_000) * 1000) / 1000;
                  return `${mm} mm`;
                }
                if (nm >= 1000) {
                  const um = Math.round((nm / 1000) * 1000) / 1000;
                  return `${um} µm`;
                }
                const cleanNm = Math.round(nm * 100) / 100;
                return `${cleanNm} nm`;
              };

              const label = formatScaleLabel(bestNm);
              const labelX = Math.max(22, barPixels / 2);

              return (
                <g>
                  <line
                    x1="0"
                    y1="0"
                    x2={barPixels}
                    y2="0"
                    stroke="#020617"
                    strokeWidth="5"
                    strokeLinecap="round"
                    opacity="0.7"
                  />
                  <line
                    x1="0"
                    y1="0"
                    x2={barPixels}
                    y2="0"
                    stroke="#e2e8f0"
                    strokeWidth="2.5"
                  />
                  <line x1="0" y1="-4.5" x2="0" y2="4.5" stroke="#e2e8f0" strokeWidth="2" />
                  <line
                    x1={barPixels}
                    y1="-4.5"
                    x2={barPixels}
                    y2="4.5"
                    stroke="#e2e8f0"
                    strokeWidth="2"
                  />
                  <text
                    x={labelX}
                    y="-7"
                    fill="#f1f5f9"
                    stroke="#020617"
                    strokeWidth="3"
                    paintOrder="stroke"
                    fontSize="10.5"
                    fontWeight="600"
                    fontFamily="JetBrains Mono, monospace"
                    textAnchor="middle"
                  >
                    {label}
                  </text>
                </g>
              );
            })()}
          </g>
        </svg>

        {/* Active Magnifying Glass Mode Banner */}
        {regionZoomMode && (
          <div className="absolute top-3 left-3 z-10 flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-900/90 border border-sky-500/60 text-sky-300 text-[11px] font-medium shadow-lg backdrop-blur-md">
            <Search className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <span>Drag rectangle to zoom region · Click to zoom 2× · Preserves geometry aspect ratio</span>
            <button
              type="button"
              onClick={() => {
                setRegionZoomMode(false);
                setZoomSelection(null);
              }}
              className="ml-1 px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[10px]"
            >
              Done
            </button>
          </div>
        )}

        {/* FLOATING QUICK-ACTION HUD (Bottom-Right) - Always accessible on canvas */}
        <div className="absolute bottom-3 right-3 z-10 flex items-center gap-1 bg-slate-900/90 backdrop-blur-md border border-slate-700/80 shadow-2xl rounded-xl p-1 text-xs">
          <button
            onClick={() => zoomAroundPoint(zoom * 0.85, svgWidth / 2, svgHeight / 2)}
            className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
            title="Zoom Out (-)"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => {
              const next = !regionZoomMode;
              setRegionZoomMode(next);
              setZoomSelection(null);
              if (next) {
                setMeasureMode(false);
              }
            }}
            className={`p-1.5 rounded-lg transition-colors ${
              regionZoomMode
                ? 'bg-sky-500 text-white shadow-sm'
                : 'text-slate-300 hover:text-white hover:bg-slate-800'
            }`}
            title="Magnifying Glass: Drag to zoom selected region"
          >
            <Search className="w-3.5 h-3.5" />
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
            onClick={() => zoomAroundPoint(zoom * 1.18, svgWidth / 2, svgHeight / 2)}
            className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
            title="Zoom In (+)"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Hover Layer Inspector Tooltip */}
        {hoveredPolygon && !zoomSelection && (
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
                      Thickness: {formatThickness(heightNm, thicknessUnit)}
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
