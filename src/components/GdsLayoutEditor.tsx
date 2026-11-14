/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import {
  GdsConcatConfig,
  GdsLayerInfo,
  GdsLayoutData,
  GdsPoint,
  GdsSectionLine,
  GdsShape,
  PhotomaskLevel,
  ProcessFlow,
} from '../types/microfab';
import {
  GDS_LAYER_PALETTE,
  SECTION_LINE_COLORS,
  arcIntervalToPolylineSegments,
  computeGdsBounds,
  computeRawSectionIntervals,
  createDefaultGdsLayout,
  createSampleGdsLayout,
  getGdsShapeBounds,
  getLayoutSectionLines,
  getNextSectionLabel,
  getSectionEndLabels,
  getSectionMidpoint,
  getSectionPoints,
  moveGdsSectionLine,
  moveGdsShape,
  parseGdsFile,
  resizePointShapeToBounds,
  shapeToPolygons,
  sliceGdsLayoutAlongSection,
  sliceGdsLayoutConcatenated,
  withSectionPoints,
} from '../lib/gdsUtils';
import { createNewMaskInFlow, updateMaskAndSyncSteps } from '../lib/maskUtils';
import {
  MousePointer2,
  Square,
  Pentagon,
  Spline,
  Circle,
  Scissors,
  Hand,
  Upload,
  Sparkles,
  Trash2,
  Plus,
  Copy,
  Grid,
  ChevronLeft,
  ChevronRight,
  Link2,
  Eye,
  EyeOff,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Check,
  ArrowRight,
  Layers,
  MoveHorizontal,
  MoveVertical,
} from 'lucide-react';

interface NmNumberInputProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (val: number) => void;
  className?: string;
}

const NmNumberInput: React.FC<NmNumberInputProps> = ({
  value,
  min = -10000000,
  max = 10000000,
  step = 50,
  onChange,
  className = '',
}) => {
  const [text, setText] = useState<string>(String(Math.round(value)));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) {
      setText(String(Math.round(value)));
    }
  }, [value, focused]);

  const commit = (raw: string) => {
    const parsed = parseFloat(raw);
    if (!Number.isFinite(parsed)) {
      setText(String(Math.round(value)));
      return;
    }
    const clamped = Math.round(Math.max(min, Math.min(max, parsed)));
    setText(String(clamped));
    if (clamped !== Math.round(value)) {
      onChange(clamped);
    }
  };

  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      value={text}
      onFocus={() => setFocused(true)}
      onChange={(e) => {
        const next = e.target.value;
        if (min >= 0 && next.includes('-')) {
          setText(String(min));
          onChange(min);
          return;
        }
        const parsed = parseFloat(next);
        if (Number.isFinite(parsed) && parsed < min && min >= 0) {
          setText(String(min));
          onChange(min);
          return;
        }
        setText(next);
        if (Number.isFinite(parsed) && parsed >= min && parsed <= max) {
          onChange(Math.round(parsed));
        }
      }}
      onBlur={() => {
        setFocused(false);
        commit(text);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={className}
    />
  );
};

interface GdsLayoutEditorProps {
  flow: ProcessFlow;
  selectedMask: PhotomaskLevel | null;
  onUpdateFlow: (updatedFlow: ProcessFlow) => void;
  onNotify?: (message: string, type: 'success' | 'warn') => void;
}

type DrawTool = 'select' | 'pan' | 'rect' | 'path' | 'polygon' | 'circle' | 'section';

export const GdsLayoutEditor: React.FC<GdsLayoutEditorProps> = ({
  flow,
  selectedMask,
  onUpdateFlow,
  onNotify,
}) => {
  const waferWidth = flow.substrateWidth || 10000;
  const masks = flow.masks || [];

  // Initialize gdsLayout lazily in memory if not yet stored on flow
  const layout: GdsLayoutData = useMemo(() => {
    if (flow.gdsLayout) return flow.gdsLayout;
    return createDefaultGdsLayout(masks, waferWidth);
  }, [flow.gdsLayout, masks, waferWidth]);

  const updateLayout = useCallback(
    (nextLayout: GdsLayoutData) => {
      onUpdateFlow({
        ...flow,
        gdsLayout: nextLayout,
      });
    },
    [flow, onUpdateFlow]
  );

  // Active tool & drawing preferences
  const [tool, setTool] = useState<DrawTool>('rect');
  const [gridSnapNm, setGridSnapNm] = useState<number>(100);
  const [pathWidthNm, setPathWidthNm] = useState<number>(400);
  const [activeLayerNum, setActiveLayerNum] = useState<number>(() => {
    const mapped = layout.layers.find((l) => l.assignedMaskId === selectedMask?.id);
    return mapped?.layer ?? layout.layers[0]?.layer ?? 1;
  });

  // Sync activeLayerNum when user clicks a different mask in the left reticle sidebar
  useEffect(() => {
    if (!selectedMask) return;
    const mapped = layout.layers.find((l) => l.assignedMaskId === selectedMask.id);
    if (mapped) {
      setActiveLayerNum(mapped.layer);
    }
  }, [selectedMask?.id, layout.layers]);

  // Selected shape / multi-click draft state
  const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null);
  const [showArrayTool, setShowArrayTool] = useState<boolean>(false);
  const [arrayCols, setArrayCols] = useState<number>(3);
  const [arrayRows, setArrayRows] = useState<number>(2);
  const [arrayPitchX, setArrayPitchX] = useState<number>(1500);
  const [arrayPitchY, setArrayPitchY] = useState<number>(1500);
  const [draggingConcatId, setDraggingConcatId] = useState<string | null>(null);
  const [draftPoints, setDraftPoints] = useState<GdsPoint[]>([]);
  const [dragBox, setDragBox] = useState<{ start: GdsPoint; current: GdsPoint } | null>(null);
  const [cursorWorld, setCursorWorld] = useState<GdsPoint | null>(null);
  const [targetMaskId, setTargetMaskId] = useState<string>(() => selectedMask?.id || masks[0]?.id || '');

  useEffect(() => {
    if (selectedMask?.id) {
      setTargetMaskId(selectedMask.id);
    }
  }, [selectedMask?.id]);

  // Viewport camera in world nm (center + horizontal span)
  const svgContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [svgSize, setSvgSize] = useState<{ w: number; h: number }>({ w: 680, h: 420 });
  const [camera, setCamera] = useState<{ cx: number; cy: number; spanX: number }>(() => ({
    cx: waferWidth * 0.5,
    cy: waferWidth * 0.5,
    spanX: waferWidth * 1.25,
  }));

  useEffect(() => {
    const el = svgContainerRef.current;
    if (!el) return;
    const measure = () => {
      if (el.clientWidth > 0 && el.clientHeight > 0) {
        setSvgSize({ w: el.clientWidth, h: el.clientHeight });
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fitCameraToLayout = useCallback(
    (targetLayout: GdsLayoutData) => {
      const b = computeGdsBounds(targetLayout.shapes, waferWidth);
      let spanX = b.maxX - b.minX;
      let spanY = b.maxY - b.minY;
      if (targetLayout.shapes.length === 0) {
        spanX = waferWidth;
        spanY = waferWidth;
      }
      const aspect = svgSize.w > 0 && svgSize.h > 0 ? svgSize.w / svgSize.h : 1.6;
      const neededSpanX = Math.max(500, spanX * 1.25, spanY * 1.25 * aspect);
      setCamera({
        cx: (b.minX + b.maxX) * 0.5,
        cy: (b.minY + b.maxY) * 0.5,
        spanX: neededSpanX,
      });
    },
    [svgSize.w, svgSize.h, waferWidth]
  );

  // Coordinate conversions: GDS Y+ is UP; SVG Y+ is DOWN
  const pxPerNm = svgSize.w / Math.max(100, camera.spanX);
  const worldToScreen = useCallback(
    (wx: number, wy: number) => ({
      x: svgSize.w * 0.5 + (wx - camera.cx) * pxPerNm,
      y: svgSize.h * 0.5 - (wy - camera.cy) * pxPerNm,
    }),
    [svgSize.w, svgSize.h, camera.cx, camera.cy, pxPerNm]
  );

  const screenToWorld = useCallback(
    (sx: number, sy: number, snap: boolean = true): GdsPoint => {
      const rawX = camera.cx + (sx - svgSize.w * 0.5) / pxPerNm;
      const rawY = camera.cy - (sy - svgSize.h * 0.5) / pxPerNm;
      if (!snap || gridSnapNm <= 1) {
        return { x: Math.round(rawX), y: Math.round(rawY) };
      }
      return {
        x: Math.round(rawX / gridSnapNm) * gridSnapNm,
        y: Math.round(rawY / gridSnapNm) * gridSnapNm,
      };
    },
    [camera.cx, camera.cy, pxPerNm, svgSize.w, svgSize.h, gridSnapNm]
  );

  // Active pointer interaction state
  const [hoveredSectionId, setHoveredSectionId] = useState<string | null>(null);
  const [pointerOp, setPointerOp] = useState<
    | null
    | { kind: 'pan'; startClientX: number; startClientY: number; initCx: number; initCy: number }
    | { kind: 'move-shape'; shape: GdsShape; startWorld: GdsPoint }
    | { kind: 'drag-section-vertex'; initSection: GdsSectionLine; vertexIndex: number }
    | { kind: 'drag-section-move'; initSection: GdsSectionLine; startWorld: GdsPoint }
    | { kind: 'draw-drag'; startWorld: GdsPoint }
  >(null);

  // Multi-section-cut normalization & updater
  const { sectionLines, activeSectionLine } = useMemo(
    () => getLayoutSectionLines(layout, waferWidth),
    [layout, waferWidth]
  );

  const updateSectionLines = useCallback(
    (nextLines: GdsSectionLine[], nextActiveId?: string) => {
      const targetId = nextActiveId || activeSectionLine.id;
      const active = nextLines.find((s) => s.id === targetId) || nextLines[0];
      updateLayout({
        ...layout,
        sectionLines: nextLines,
        activeSectionId: active?.id,
        sectionLine: active,
      });
    },
    [layout, activeSectionLine.id, updateLayout]
  );

  const updateSingleSection = useCallback(
    (updatedCut: GdsSectionLine) => {
      const exists = sectionLines.some((s) => s.id === updatedCut.id);
      const nextLines = exists
        ? sectionLines.map((s) => (s.id === updatedCut.id ? updatedCut : s))
        : [...sectionLines, updatedCut];
      updateSectionLines(nextLines, updatedCut.id);
    },
    [sectionLines, updateSectionLines]
  );

  const handleUpdateShape = useCallback(
    (updatedShape: GdsShape) => {
      updateLayout({
        ...layout,
        shapes: layout.shapes.map((s) => (s.id === updatedShape.id ? updatedShape : s)),
      });
    },
    [layout, updateLayout]
  );

  // Keyboard shortcuts: Escape cancels draft, Delete removes selected shape, Enter finishes polyline
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === 'Escape') {
        setDraftPoints([]);
        setDragBox(null);
        setSelectedShapeId(null);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedShapeId) {
        e.preventDefault();
        updateLayout({
          ...layout,
          shapes: layout.shapes.filter((s) => s.id !== selectedShapeId),
        });
        setSelectedShapeId(null);
      } else if (e.key === 'Enter' && draftPoints.length >= 2) {
        finalizeMultiClickShape(draftPoints);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const finalizeMultiClickShape = (pts: GdsPoint[]) => {
    if (tool === 'polygon' && pts.length >= 3) {
      const newShape: GdsShape = {
        id: `gds_poly_${Date.now()}`,
        type: 'polygon',
        layer: activeLayerNum,
        datatype: 0,
        points: pts,
      };
      updateLayout({ ...layout, shapes: [...layout.shapes, newShape] });
      setSelectedShapeId(newShape.id);
    } else if (tool === 'path' && pts.length >= 2) {
      const newShape: GdsShape = {
        id: `gds_path_${Date.now()}`,
        type: 'path',
        layer: activeLayerNum,
        datatype: 0,
        points: pts,
        pathWidth: pathWidthNm,
      };
      updateLayout({ ...layout, shapes: [...layout.shapes, newShape] });
      setSelectedShapeId(newShape.id);
    } else if (tool === 'section' && pts.length >= 2) {
      updateSingleSection(withSectionPoints(activeSectionLine, pts));
    }
    setDraftPoints([]);
  };

  // Hit-testing for Select tool (including distance-to-segment fallback for thin paths)
  const findShapeAtPoint = (pt: GdsPoint): GdsShape | null => {
    const visibleLayers = new Set(layout.layers.filter((l) => l.visible).map((l) => l.layer));
    const minHitRadius = 8 / Math.max(1e-6, pxPerNm);
    for (let i = layout.shapes.length - 1; i >= 0; i--) {
      const s = layout.shapes[i];
      if (!visibleLayers.has(s.layer)) continue;

      if (s.type === 'path' && s.points && s.points.length >= 2) {
        const hitHalfW = Math.max((s.pathWidth ?? 200) * 0.5, minHitRadius);
        for (let k = 0; k < s.points.length - 1; k++) {
          const a = s.points[k];
          const b = s.points[k + 1];
          const abx = b.x - a.x;
          const aby = b.y - a.y;
          const lenSq = abx * abx + aby * aby;
          const t =
            lenSq > 1e-6
              ? Math.max(0, Math.min(1, ((pt.x - a.x) * abx + (pt.y - a.y) * aby) / lenSq))
              : 0;
          const dist = Math.hypot(pt.x - (a.x + t * abx), pt.y - (a.y + t * aby));
          if (dist <= hitHalfW) return s;
        }
      }

      const polys = shapeToPolygons(s);
      for (const poly of polys) {
        let inside = false;
        for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
          const xi = poly[a].x;
          const yi = poly[a].y;
          const xj = poly[b].x;
          const yj = poly[b].y;
          const intersect =
            yi > pt.y !== yj > pt.y &&
            pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-9) + xi;
          if (intersect) inside = !inside;
        }
        if (inside) return s;
      }
    }
    return null;
  };

  const getLocalCoords = (clientX: number, clientY: number) => {
    const rect = svgContainerRef.current?.getBoundingClientRect();
    if (!rect) return { sx: 0, sy: 0 };
    return { sx: clientX - rect.left, sy: clientY - rect.top };
  };

  const handleSvgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const { sx, sy } = getLocalCoords(e.clientX, e.clientY);

    // Middle-mouse / Alt-click / Pan tool -> pan
    if (e.button === 1 || e.button === 2 || e.altKey || tool === 'pan') {
      e.preventDefault();
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      setPointerOp({
        kind: 'pan',
        startClientX: e.clientX,
        startClientY: e.clientY,
        initCx: camera.cx,
        initCy: camera.cy,
      });
      return;
    }

    if (e.button !== 0) return;

    const worldPt = screenToWorld(sx, sy, true);
    const rawWorldPt = screenToWorld(sx, sy, false);

    if (tool === 'select') {
      const hit = findShapeAtPoint(rawWorldPt);
      if (hit) {
        setSelectedShapeId(hit.id);
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
        setPointerOp({
          kind: 'move-shape',
          shape: hit,
          startWorld: worldPt,
        });
      } else {
        setSelectedShapeId(null);
      }
      return;
    }

    if (tool === 'rect' || tool === 'circle') {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      setDragBox({ start: worldPt, current: worldPt });
      setPointerOp({ kind: 'draw-drag', startWorld: worldPt });
      return;
    }

    if (tool === 'section') {
      if (draftPoints.length === 0) {
        // Supports both drag-for-2-point cut OR click-click-dblclick for multi-point cut
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
        setDragBox({ start: worldPt, current: worldPt });
        setPointerOp({ kind: 'draw-drag', startWorld: worldPt });
        return;
      }
      const last = draftPoints[draftPoints.length - 1];
      if (!last || Math.hypot(last.x - worldPt.x, last.y - worldPt.y) > 1) {
        setDraftPoints((prev) => [...prev, worldPt]);
      }
      return;
    }

    if (tool === 'polygon' || tool === 'path') {
      // Check if clicking near first point of polygon to close
      if (tool === 'polygon' && draftPoints.length >= 3) {
        const firstScr = worldToScreen(draftPoints[0].x, draftPoints[0].y);
        if (Math.hypot(sx - firstScr.x, sy - firstScr.y) < 12) {
          finalizeMultiClickShape(draftPoints);
          return;
        }
      }
      // Avoid duplicate consecutive vertices
      const last = draftPoints[draftPoints.length - 1];
      if (!last || Math.hypot(last.x - worldPt.x, last.y - worldPt.y) > 1) {
        setDraftPoints((prev) => [...prev, worldPt]);
      }
    }
  };

  const handleSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const { sx, sy } = getLocalCoords(e.clientX, e.clientY);
    const worldPt = screenToWorld(sx, sy, true);
    setCursorWorld(worldPt);

    if (!pointerOp) return;

    if (pointerOp.kind === 'pan') {
      const dxNm = (e.clientX - pointerOp.startClientX) / pxPerNm;
      const dyNm = (e.clientY - pointerOp.startClientY) / pxPerNm;
      setCamera((prev) => ({
        ...prev,
        cx: pointerOp.initCx - dxNm,
        cy: pointerOp.initCy + dyNm,
      }));
      return;
    }

    if (pointerOp.kind === 'draw-drag') {
      setDragBox({ start: pointerOp.startWorld, current: worldPt });
      return;
    }

    if (pointerOp.kind === 'move-shape') {
      const dx = worldPt.x - pointerOp.startWorld.x;
      const dy = worldPt.y - pointerOp.startWorld.y;
      const moved = moveGdsShape(pointerOp.shape, dx, dy);
      updateLayout({
        ...layout,
        shapes: layout.shapes.map((s) => (s.id === moved.id ? moved : s)),
      });
      return;
    }

    if (pointerOp.kind === 'drag-section-vertex') {
      const nextPts = getSectionPoints(pointerOp.initSection).map((p, idx) =>
        idx === pointerOp.vertexIndex ? worldPt : p
      );
      updateSingleSection(withSectionPoints(pointerOp.initSection, nextPts));
      return;
    }

    if (pointerOp.kind === 'drag-section-move') {
      const dx = worldPt.x - pointerOp.startWorld.x;
      const dy = worldPt.y - pointerOp.startWorld.y;
      updateSingleSection(moveGdsSectionLine(pointerOp.initSection, dx, dy));
    }
  };

  const handleSvgPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (pointerOp?.kind === 'draw-drag' && dragBox) {
      const { start, current } = dragBox;

      if (tool === 'rect') {
        const minX = Math.min(start.x, current.x);
        const minY = Math.min(start.y, current.y);
        const width = Math.abs(current.x - start.x);
        const height = Math.abs(current.y - start.y);
        if (width >= 10 && height >= 10) {
          const newShape: GdsShape = {
            id: `gds_rect_${Date.now()}`,
            type: 'rect',
            layer: activeLayerNum,
            datatype: 0,
            x: minX,
            y: minY,
            width,
            height,
          };
          updateLayout({ ...layout, shapes: [...layout.shapes, newShape] });
          setSelectedShapeId(newShape.id);
        }
      } else if (tool === 'circle') {
        const radius = Math.round(Math.hypot(current.x - start.x, current.y - start.y));
        if (radius >= 10) {
          const newShape: GdsShape = {
            id: `gds_circ_${Date.now()}`,
            type: 'circle',
            layer: activeLayerNum,
            datatype: 0,
            cx: start.x,
            cy: start.y,
            radius,
          };
          updateLayout({ ...layout, shapes: [...layout.shapes, newShape] });
          setSelectedShapeId(newShape.id);
        }
      } else if (tool === 'section') {
        const sStart = worldToScreen(start.x, start.y);
        const sEnd = worldToScreen(current.x, current.y);
        const pxDist = Math.hypot(sEnd.x - sStart.x, sEnd.y - sStart.y);
        const dist = Math.hypot(current.x - start.x, current.y - start.y);
        if (pxDist >= 8 && dist >= 50) {
          // Quick 2-point drag cut
          updateSingleSection(
            withSectionPoints(activeSectionLine, [start, current])
          );
        } else {
          // Click started a multi-point polyline cut
          setDraftPoints([start]);
        }
      }
      setDragBox(null);
    }

    try {
      (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    setPointerOp(null);
  };

  const handleSvgDoubleClick = () => {
    if ((tool === 'polygon' || tool === 'path' || tool === 'section') && draftPoints.length >= 2) {
      finalizeMultiClickShape(draftPoints);
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const { sx, sy } = getLocalCoords(e.clientX, e.clientY);
    const anchor = screenToWorld(sx, sy, false);
    const factor = e.deltaY > 0 ? 1.15 : 0.87;
    const nextSpanX = Math.max(400, Math.min(2000000, camera.spanX * factor));
    const nextPxPerNm = svgSize.w / nextSpanX;
    setCamera({
      cx: anchor.x - (sx - svgSize.w * 0.5) / nextPxPerNm,
      cy: anchor.y + (sy - svgSize.h * 0.5) / nextPxPerNm,
      spanX: nextSpanX,
    });
  };

  // Import .gds binary file
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      const buf = await file.arrayBuffer();
      const parsed = parseGdsFile(buf, file.name, masks);
      updateLayout(parsed);
      setSelectedShapeId(null);
      setDraftPoints([]);
      if (parsed.layers.length > 0) {
        setActiveLayerNum(parsed.layers[0].layer);
      }
      fitCameraToLayout(parsed);
      onNotify?.(
        `Imported ${parsed.shapes.length} shapes across ${parsed.layers.length} GDS layer(s) from ${file.name}.`,
        'success'
      );
    } catch (err: any) {
      onNotify?.(err?.message || 'Failed to parse GDSII file.', 'warn');
    }
  };

  const handleLoadSample = () => {
    const sample = createSampleGdsLayout(masks, waferWidth);
    updateLayout(sample);
    setSelectedShapeId(null);
    setDraftPoints([]);
    setActiveLayerNum(sample.layers[0]?.layer ?? 1);
    fitCameraToLayout(sample);
    onNotify?.('Loaded multi-layer Dual-Gate example GDS layout.', 'success');
  };

  const handleQuickCut = (orientation: 'horizontal' | 'vertical') => {
    const b = computeGdsBounds(layout.shapes, waferWidth);
    const spanX = layout.shapes.length > 0 ? b.maxX - b.minX : waferWidth;
    const spanY = layout.shapes.length > 0 ? b.maxY - b.minY : waferWidth;
    const padX = layout.shapes.length > 0 ? Math.max(400, spanX * 0.1) : 0;
    const padY = layout.shapes.length > 0 ? Math.max(400, spanY * 0.1) : 0;

    const midX = Math.round((b.minX + b.maxX) * 0.5);
    const midY = Math.round((b.minY + b.maxY) * 0.5);

    const nextSection: GdsSectionLine =
      orientation === 'horizontal'
        ? withSectionPoints(activeSectionLine, [
            { x: Math.round(b.minX - padX), y: midY },
            { x: Math.round(b.maxX + padX), y: midY },
          ])
        : withSectionPoints(activeSectionLine, [
            { x: midX, y: Math.round(b.minY - padY) },
            { x: midX, y: Math.round(b.maxY + padY) },
          ]);

    updateSingleSection(nextSection);
  };

  const handleAddSectionCut = () => {
    const b = computeGdsBounds(layout.shapes, waferWidth);
    const spanX = layout.shapes.length > 0 ? b.maxX - b.minX : waferWidth;
    const spanY = layout.shapes.length > 0 ? b.maxY - b.minY : waferWidth;
    const padX = layout.shapes.length > 0 ? Math.max(400, spanX * 0.1) : 0;
    const padY = layout.shapes.length > 0 ? Math.max(400, spanY * 0.1) : 0;

    const label = getNextSectionLabel(sectionLines);
    const color = SECTION_LINE_COLORS[sectionLines.length % SECTION_LINE_COLORS.length];
    const indexOffset = (sectionLines.length % 4) * Math.round(Math.max(200, Math.min(spanX, spanY) * 0.12));
    // Alternate vertical vs horizontal default placement for new cuts so they are distinct
    const makeVertical = sectionLines.length % 2 === 1;
    const midX = Math.round((b.minX + b.maxX) * 0.5 + (makeVertical ? indexOffset : 0));
    const midY = Math.round((b.minY + b.maxY) * 0.5 + (!makeVertical ? indexOffset : 0));

    const newCut: GdsSectionLine = makeVertical
      ? {
          id: `sec_${Date.now()}`,
          label,
          x1: midX,
          y1: Math.round(b.minY - padY),
          x2: midX,
          y2: Math.round(b.maxY + padY),
          color,
          resizeWaferToCut: activeSectionLine.resizeWaferToCut ?? false,
        }
      : {
          id: `sec_${Date.now()}`,
          label,
          x1: Math.round(b.minX - padX),
          y1: midY,
          x2: Math.round(b.maxX + padX),
          y2: midY,
          color,
          resizeWaferToCut: activeSectionLine.resizeWaferToCut ?? false,
        };

    updateSectionLines([...sectionLines, newCut], newCut.id);
    setTool('section');
  };

  const handleDeleteSectionCut = (cutId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (sectionLines.length <= 1) return;
    const remaining = sectionLines.filter((s) => s.id !== cutId);
    const nextActive =
      activeSectionLine.id === cutId ? remaining[0]?.id : activeSectionLine.id;
    updateSectionLines(remaining, nextActive);
  };

  const handleAddLayer = () => {
    const maxLayer = layout.layers.reduce((m, l) => Math.max(m, l.layer), 0);
    const nextNum = maxLayer + 1;
    const newLayer: GdsLayerInfo = {
      layer: nextNum,
      datatype: 0,
      name: `L${nextNum}/0`,
      color: GDS_LAYER_PALETTE[(nextNum - 1) % GDS_LAYER_PALETTE.length],
      visible: true,
    };
    updateLayout({
      ...layout,
      layers: [...layout.layers, newLayer],
    });
    setActiveLayerNum(nextNum);
  };

  // Current active section line & concatenation config
  const sectionLine = activeSectionLine;

  const concatConfig: GdsConcatConfig = useMemo(() => {
    const validIds = new Set(sectionLines.map((s) => s.id));
    const saved = layout.concat;
    if (!saved) {
      return {
        enabled: false,
        sectionIds: sectionLines.map((s) => s.id),
        gapNm: 1000,
      };
    }
    const filteredIds = (saved.sectionIds || []).filter((id) => validIds.has(id));
    return {
      enabled: Boolean(saved.enabled),
      sectionIds:
        filteredIds.length > 0
          ? filteredIds
          : sectionLines.slice(0, 1).map((s) => s.id),
      gapNm: Math.max(0, Math.round(saved.gapNm ?? 1000)),
    };
  }, [layout.concat, sectionLines]);

  const orderedConcatSections = useMemo(() => {
    const map = new Map<string, GdsSectionLine>(sectionLines.map((s) => [s.id, s]));
    return concatConfig.sectionIds
      .map((id) => map.get(id))
      .filter((s): s is GdsSectionLine => Boolean(s));
  }, [concatConfig.sectionIds, sectionLines]);

  const excludedConcatSections = useMemo(() => {
    const inc = new Set(concatConfig.sectionIds);
    return sectionLines.filter((s) => !inc.has(s.id));
  }, [concatConfig.sectionIds, sectionLines]);

  const updateConcatConfig = useCallback(
    (next: GdsConcatConfig) => {
      updateLayout({
        ...layout,
        concat: next,
      });
    },
    [layout, updateLayout]
  );

  const handleToggleConcat = () => {
    if (!concatConfig.enabled) {
      const existing = concatConfig.sectionIds.filter((id) =>
        sectionLines.some((s) => s.id === id)
      );
      const ids = existing.length > 0 ? existing : sectionLines.map((s) => s.id);
      updateConcatConfig({
        ...concatConfig,
        enabled: true,
        sectionIds: ids,
      });
    } else {
      updateConcatConfig({
        ...concatConfig,
        enabled: false,
      });
    }
  };

  const handleMoveConcatOrder = (id: string, dir: -1 | 1) => {
    const ids = [...concatConfig.sectionIds];
    const idx = ids.indexOf(id);
    if (idx < 0) return;
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= ids.length) return;
    [ids[idx], ids[swapIdx]] = [ids[swapIdx], ids[idx]];
    updateConcatConfig({ ...concatConfig, sectionIds: ids });
  };

  const handleReorderConcatDrop = (targetId: string) => {
    if (!draggingConcatId || draggingConcatId === targetId) return;
    const ids = [...concatConfig.sectionIds];
    const fromIdx = ids.indexOf(draggingConcatId);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, draggingConcatId);
    updateConcatConfig({ ...concatConfig, sectionIds: ids });
    setDraggingConcatId(null);
  };

  const activeLayerCut = useMemo(() => {
    return computeRawSectionIntervals(layout.shapes, activeLayerNum, sectionLine);
  }, [layout.shapes, activeLayerNum, sectionLine]);

  const previewSlice = useMemo(() => {
    if (concatConfig.enabled && orderedConcatSections.length > 0) {
      const res = sliceGdsLayoutConcatenated(
        layout.shapes,
        activeLayerNum,
        orderedConcatSections,
        concatConfig.gapNm,
        Boolean(sectionLine.resizeWaferToCut),
        waferWidth
      );
      return {
        windows: res.windows,
        cutLength: res.totalLength,
        segments: res.segments,
        isConcat: true,
      };
    }
    const res = sliceGdsLayoutAlongSection(
      layout.shapes,
      activeLayerNum,
      sectionLine,
      waferWidth
    );
    return {
      windows: res.windows,
      cutLength: res.cutLength,
      segments: [],
      isConcat: false,
    };
  }, [
    concatConfig.enabled,
    concatConfig.gapNm,
    orderedConcatSections,
    layout.shapes,
    activeLayerNum,
    sectionLine,
    waferWidth,
  ]);

  // Apply cut (or concatenated cuts) to chosen single reticle
  const handleApplyToSingleMask = () => {
    const destMask = masks.find((m) => m.id === targetMaskId) || selectedMask;
    if (!destMask) return;

    const { windows, cutLength, isConcat } = previewSlice;

    if (cutLength <= 10) {
      onNotify?.('Draw a section line across the layout first.', 'warn');
      return;
    }

    let updatedFlow: ProcessFlow = { ...flow, gdsLayout: layout };
    if (sectionLine.resizeWaferToCut && cutLength >= 200) {
      updatedFlow.substrateWidth = cutLength;
    }

    updatedFlow = updateMaskAndSyncSteps(updatedFlow, {
      ...destMask,
      windows,
    });
    onUpdateFlow(updatedFlow);
    if (isConcat) {
      const seq = orderedConcatSections.map((s) => s.label).join(' → ');
      onNotify?.(
        `Generated ${windows.length} concatenated aperture(s) on "${destMask.name}" from [${seq}] (gap ${concatConfig.gapNm} nm).`,
        'success'
      );
    } else {
      onNotify?.(
        `Generated ${windows.length} aperture(s) on "${destMask.name}" from GDS Layer ${activeLayerNum} (${sectionLine.label}).`,
        'success'
      );
    }
  };

  // Apply cut (or concatenated cuts) across ALL mapped GDS layers -> Reticles simultaneously
  const mappedLayerCount = layout.layers.filter((l) => l.assignedMaskId).length;
  const handleApplyToAllMapped = () => {
    const mapped = layout.layers.filter((l) => l.assignedMaskId);
    if (mapped.length === 0) {
      onNotify?.('Map at least one GDS layer to a reticle first.', 'warn');
      return;
    }

    let updatedFlow: ProcessFlow = { ...flow, gdsLayout: layout };
    const useConcat = concatConfig.enabled && orderedConcatSections.length > 0;
    const totalLength = useConcat
      ? sliceGdsLayoutConcatenated(
          layout.shapes,
          mapped[0].layer,
          orderedConcatSections,
          concatConfig.gapNm,
          Boolean(sectionLine.resizeWaferToCut),
          waferWidth
        ).totalLength
      : sliceGdsLayoutAlongSection(
          layout.shapes,
          mapped[0].layer,
          sectionLine,
          waferWidth
        ).cutLength;

    if (totalLength <= 10) {
      onNotify?.('Draw a section line across the layout first.', 'warn');
      return;
    }

    if (sectionLine.resizeWaferToCut && totalLength >= 200) {
      updatedFlow.substrateWidth = totalLength;
    }

    let totalWins = 0;
    for (const gdsLayer of mapped) {
      const mask = (updatedFlow.masks || []).find((m) => m.id === gdsLayer.assignedMaskId);
      if (!mask) continue;
      const windows = useConcat
        ? sliceGdsLayoutConcatenated(
            layout.shapes,
            gdsLayer.layer,
            orderedConcatSections,
            concatConfig.gapNm,
            Boolean(sectionLine.resizeWaferToCut),
            waferWidth
          ).windows
        : sliceGdsLayoutAlongSection(
            layout.shapes,
            gdsLayer.layer,
            sectionLine,
            waferWidth
          ).windows;
      totalWins += windows.length;
      updatedFlow = updateMaskAndSyncSteps(updatedFlow, {
        ...mask,
        windows,
      });
    }

    onUpdateFlow(updatedFlow);
    const labelSummary = useConcat
      ? `[${orderedConcatSections.map((s) => s.label).join(' → ')}]`
      : sectionLine.label;
    onNotify?.(
      `Updated ${mapped.length} mapped reticle(s) with ${totalWins} aperture(s) along ${labelSummary}.`,
      'success'
    );
  };

  // Auto-create reticles for unmapped GDS layers
  const unmappedWithShapes = layout.layers.filter(
    (l) => !l.assignedMaskId && layout.shapes.some((s) => s.layer === l.layer)
  );
  const handleCreateReticlesFromUnmapped = () => {
    if (unmappedWithShapes.length === 0) return;
    let nextFlow: ProcessFlow = { ...flow };
    const nextLayers = layout.layers.map((l) => ({ ...l }));
    const useConcat = concatConfig.enabled && orderedConcatSections.length > 0;

    for (const gLayer of unmappedWithShapes) {
      const windows = useConcat
        ? sliceGdsLayoutConcatenated(
            layout.shapes,
            gLayer.layer,
            orderedConcatSections,
            concatConfig.gapNm,
            Boolean(sectionLine.resizeWaferToCut),
            waferWidth
          ).windows
        : sliceGdsLayoutAlongSection(
            layout.shapes,
            gLayer.layer,
            sectionLine,
            waferWidth
          ).windows;
      const { flow: f2, newMask } = createNewMaskInFlow(nextFlow, {
        name: `GDS ${gLayer.name}`,
        layerCode: `GDS-${gLayer.layer}`,
        color: gLayer.color,
        windows: windows.length > 0 ? windows : [],
      });
      nextFlow = f2;
      const targetLayer = nextLayers.find((x) => x.layer === gLayer.layer);
      if (targetLayer) targetLayer.assignedMaskId = newMask.id;
    }

    onUpdateFlow({
      ...nextFlow,
      gdsLayout: {
        ...layout,
        layers: nextLayers,
      },
    });
    onNotify?.(
      `Created ${unmappedWithShapes.length} reticle(s) linked to imported GDS layers.`,
      'success'
    );
  };

  // Grid line spacing calculation
  const gridStepNm = useMemo(() => {
    const rawStep = camera.spanX / 10;
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const norm = rawStep / mag;
    if (norm < 1.5) return mag;
    if (norm < 3.5) return 2 * mag;
    if (norm < 7.5) return 5 * mag;
    return 10 * mag;
  }, [camera.spanX]);

  const gridLines = useMemo(() => {
    const viewMinX = camera.cx - camera.spanX * 0.5;
    const viewMaxX = camera.cx + camera.spanX * 0.5;
    const spanY = camera.spanX * (svgSize.h / Math.max(1, svgSize.w));
    const viewMinY = camera.cy - spanY * 0.5;
    const viewMaxY = camera.cy + spanY * 0.5;

    const xs: number[] = [];
    const ys: number[] = [];
    const startX = Math.floor(viewMinX / gridStepNm) * gridStepNm;
    const startY = Math.floor(viewMinY / gridStepNm) * gridStepNm;
    for (let x = startX; x <= viewMaxX; x += gridStepNm) xs.push(x);
    for (let y = startY; y <= viewMaxY; y += gridStepNm) ys.push(y);
    return { xs, ys };
  }, [camera, svgSize.w, svgSize.h, gridStepNm]);

  const layerByNum = useMemo(() => {
    const map = new Map<number, GdsLayerInfo>();
    for (const l of layout.layers) map.set(l.layer, l);
    return map;
  }, [layout.layers]);

  const selectedShape = layout.shapes.find((s) => s.id === selectedShapeId) || null;
  const activeLayerInfo = layerByNum.get(activeLayerNum) || layout.layers[0];

  const handleToggleArrayTool = () => {
    if (!showArrayTool && selectedShape) {
      const b = getGdsShapeBounds(selectedShape);
      setArrayPitchX(Math.max(100, Math.round(b.width + 500)));
      setArrayPitchY(Math.max(100, Math.round(b.height + 500)));
    }
    setShowArrayTool((v) => !v);
  };

  const handleGenerateArray = () => {
    if (!selectedShape) return;
    const cols = Math.max(1, Math.min(50, Math.round(arrayCols)));
    const rows = Math.max(1, Math.min(50, Math.round(arrayRows)));
    if (cols * rows <= 1) {
      onNotify?.('Set Cols or Rows greater than 1 to create an array.', 'warn');
      return;
    }

    const baseTs = Date.now();
    const newShapes: GdsShape[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (c === 0 && r === 0) continue;
        const shifted = moveGdsShape(selectedShape, c * arrayPitchX, r * arrayPitchY);
        newShapes.push({
          ...shifted,
          id: `gds_arr_${baseTs}_${c}_${r}`,
        });
      }
    }

    updateLayout({
      ...layout,
      shapes: [...layout.shapes, ...newShapes],
    });
    setShowArrayTool(false);
    onNotify?.(
      `Generated ${newShapes.length} array instance(s) (${cols} × ${rows} grid).`,
      'success'
    );
  };

  const handleDuplicateSelectedShape = () => {
    if (!selectedShape) return;
    const dup = moveGdsShape(selectedShape, 250, 250);
    const cloned: GdsShape = {
      ...dup,
      id: `gds_${dup.type}_${Date.now()}`,
    };
    updateLayout({ ...layout, shapes: [...layout.shapes, cloned] });
    setSelectedShapeId(cloned.id);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-slate-950">
      {/* Top CAD Toolbar */}
      <div className="px-4 py-2 bg-slate-900/90 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 shrink-0">
        {/* Drawing Tools */}
        <div className="flex items-center gap-1 flex-wrap">
          {(
            [
              { id: 'select', label: 'Select', icon: MousePointer2, tip: 'Select & Move GDS Shapes or Cut Lines' },
              { id: 'pan', label: 'Pan', icon: Hand, tip: 'Pan Canvas (or Alt/Middle-drag)' },
              { id: 'rect', label: 'Rect', icon: Square, tip: 'Draw GDS Box / Rectangle' },
              { id: 'path', label: 'Path', icon: Spline, tip: 'Draw Wire / Path (dbl-click to finish)' },
              { id: 'polygon', label: 'Poly', icon: Pentagon, tip: 'Draw Polygon (dbl-click or click start to close)' },
              { id: 'circle', label: 'Circle', icon: Circle, tip: 'Draw Circular Via / Pad' },
              {
                id: 'section',
                label: `Cut ${sectionLine.label}`,
                icon: Scissors,
                tip: 'Drag for 2-pt cut, or click multiple points & double-click for multi-point cut',
              },
            ] as const
          ).map((item) => {
            const Icon = item.icon;
            const active = tool === item.id;
            const isSection = item.id === 'section';
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setTool(item.id);
                  setDraftPoints([]);
                  setDragBox(null);
                }}
                title={item.tip}
                className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium border transition-colors ${
                  active
                    ? isSection
                      ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                      : 'bg-sky-600 border-sky-500 text-white shadow-sm'
                    : 'bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{item.label}</span>
              </button>
            );
          })}

          {tool === 'path' && (
            <div className="flex items-center gap-1 ml-1 px-2 py-1 rounded-lg bg-slate-950 border border-slate-800 text-[11px]">
              <span className="text-slate-400">W:</span>
              <input
                type="number"
                min={20}
                max={10000}
                step={50}
                value={pathWidthNm}
                onChange={(e) => setPathWidthNm(Math.max(20, parseInt(e.target.value || '200', 10)))}
                className="w-16 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-slate-100 font-mono text-[11px]"
              />
              <span className="text-slate-500 font-mono">nm</span>
            </div>
          )}

          {(tool === 'polygon' || tool === 'path' || tool === 'section') && draftPoints.length >= 2 && (
            <button
              type="button"
              onClick={() => finalizeMultiClickShape(draftPoints)}
              className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold"
            >
              {tool === 'section'
                ? `Finish Cut (${draftPoints.length} pts)`
                : `Finish (${draftPoints.length} pts)`}
            </button>
          )}
        </div>

        {/* File Import & Layout Actions */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <input
            ref={fileInputRef}
            type="file"
            accept=".gds,.gds2,.gdsii,.sf"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold transition-colors"
            title="Import binary GDSII layout (.gds / .gds2 / .gdsii)"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Import .GDS</span>
          </button>

          <button
            type="button"
            onClick={handleLoadSample}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] transition-colors"
            title="Load a multi-layer example GDS layout"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>Example GDS</span>
          </button>

          <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-950 border border-slate-800 text-[11px]">
            <span className="text-slate-400">Snap:</span>
            <select
              value={gridSnapNm}
              onChange={(e) => setGridSnapNm(parseInt(e.target.value, 10))}
              className="bg-transparent text-sky-300 font-mono focus:outline-none cursor-pointer"
            >
              <option value={1} className="bg-slate-900">Off</option>
              <option value={50} className="bg-slate-900">50 nm</option>
              <option value={100} className="bg-slate-900">100 nm</option>
              <option value={250} className="bg-slate-900">250 nm</option>
              <option value={500} className="bg-slate-900">500 nm</option>
              <option value={1000} className="bg-slate-900">1 µm</option>
            </select>
          </div>

          <button
            type="button"
            onClick={() => handleQuickCut('horizontal')}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 text-[11px]"
            title="Place horizontal section line across center"
          >
            <MoveHorizontal className="w-3.5 h-3.5" />
            <span>H-Cut</span>
          </button>

          <button
            type="button"
            onClick={() => handleQuickCut('vertical')}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 text-[11px]"
            title="Place vertical section line across center"
          >
            <MoveVertical className="w-3.5 h-3.5" />
            <span>V-Cut</span>
          </button>

          {layout.shapes.length > 0 && (
            <button
              type="button"
              onClick={() => {
                updateLayout({ ...layout, shapes: [] });
                setSelectedShapeId(null);
              }}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-950/50 text-slate-400 hover:text-rose-400 border border-slate-700 transition-colors"
              title="Clear all GDS shapes"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Main Middle Area: 2D GDS Canvas + GDS Layers Sidebar */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* 2D GDS SVG Canvas */}
        <div
          ref={svgContainerRef}
          onWheel={handleWheel}
          onContextMenu={(e) => e.preventDefault()}
          className={`relative flex-1 bg-[#050811] overflow-hidden select-none ${
            tool === 'pan' || pointerOp?.kind === 'pan'
              ? 'cursor-grab'
              : tool === 'select'
              ? 'cursor-default'
              : 'cursor-crosshair'
          }`}
        >
          <svg
            width={svgSize.w}
            height={svgSize.h}
            className="w-full h-full block"
            onPointerDown={handleSvgPointerDown}
            onPointerMove={handleSvgPointerMove}
            onPointerUp={handleSvgPointerUp}
            onDoubleClick={handleSvgDoubleClick}
          >
            <defs>
              {layout.layers.map((layer) => (
                <pattern
                  key={`gds_pat_${layer.layer}`}
                  id={`gds-hatch-${layer.layer}`}
                  width="8"
                  height="8"
                  patternUnits="userSpaceOnUse"
                  patternTransform="rotate(45)"
                >
                  <rect width="8" height="8" fill={layer.color} fillOpacity="0.16" />
                  <line x1="0" y1="0" x2="0" y2="8" stroke={layer.color} strokeOpacity="0.55" strokeWidth="1.5" />
                </pattern>
              ))}
            </defs>

            {/* Coordinate Grid */}
            <g>
              {gridLines.xs.map((xNm) => {
                const sx = worldToScreen(xNm, 0).x;
                const isOrigin = Math.abs(xNm) < 1;
                return (
                  <g key={`gx_${xNm}`}>
                    <line
                      x1={sx}
                      y1={0}
                      x2={sx}
                      y2={svgSize.h}
                      stroke={isOrigin ? '#334155' : '#111827'}
                      strokeWidth={isOrigin ? 1.5 : 1}
                    />
                    <text
                      x={sx + 3}
                      y={12}
                      fill="#64748b"
                      fontSize="9"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {(xNm / 1000).toFixed(1)}µm
                    </text>
                  </g>
                );
              })}
              {gridLines.ys.map((yNm) => {
                const sy = worldToScreen(0, yNm).y;
                const isOrigin = Math.abs(yNm) < 1;
                return (
                  <g key={`gy_${yNm}`}>
                    <line
                      x1={0}
                      y1={sy}
                      x2={svgSize.w}
                      y2={sy}
                      stroke={isOrigin ? '#334155' : '#111827'}
                      strokeWidth={isOrigin ? 1.5 : 1}
                    />
                    <text
                      x={4}
                      y={sy - 3}
                      fill="#64748b"
                      fontSize="9"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {(yNm / 1000).toFixed(1)}µm
                    </text>
                  </g>
                );
              })}
            </g>

            {/* Reference Wafer Width Footprint (0 to waferWidth) */}
            {(() => {
              const bl = worldToScreen(0, 0);
              const tr = worldToScreen(waferWidth, waferWidth);
              return (
                <rect
                  x={bl.x}
                  y={tr.y}
                  width={Math.max(1, tr.x - bl.x)}
                  height={Math.max(1, bl.y - tr.y)}
                  fill="none"
                  stroke="#1e293b"
                  strokeDasharray="4 4"
                  strokeWidth="1"
                />
              );
            })()}

            {/* Rendered GDS Shapes */}
            <g>
              {layout.shapes.map((shape) => {
                const layerInfo = layerByNum.get(shape.layer);
                if (layerInfo && !layerInfo.visible) return null;
                const color = layerInfo?.color || '#38bdf8';
                const isSel = selectedShapeId === shape.id;
                const polys = shapeToPolygons(shape);

                return (
                  <g key={shape.id}>
                    {polys.map((poly, pIdx) => {
                      const ptsAttr = poly
                        .map((p) => {
                          const sp = worldToScreen(p.x, p.y);
                          return `${sp.x.toFixed(1)},${sp.y.toFixed(1)}`;
                        })
                        .join(' ');
                      return (
                        <polygon
                          key={`${shape.id}_p_${pIdx}`}
                          points={ptsAttr}
                          fill={`url(#gds-hatch-${shape.layer})`}
                          stroke={isSel ? '#ffffff' : color}
                          strokeWidth={isSel ? 2.2 : 1.4}
                        />
                      );
                    })}
                  </g>
                );
              })}
            </g>

            {/* Rubber-band Draw Preview (Rect / Circle / Section) */}
            {dragBox && tool === 'rect' && (() => {
              const p1 = worldToScreen(dragBox.start.x, dragBox.start.y);
              const p2 = worldToScreen(dragBox.current.x, dragBox.current.y);
              const x = Math.min(p1.x, p2.x);
              const y = Math.min(p1.y, p2.y);
              const w = Math.abs(p2.x - p1.x);
              const h = Math.abs(p2.y - p1.y);
              return (
                <rect
                  x={x}
                  y={y}
                  width={w}
                  height={h}
                  fill={activeLayerInfo?.color || '#38bdf8'}
                  fillOpacity="0.25"
                  stroke={activeLayerInfo?.color || '#38bdf8'}
                  strokeWidth="1.5"
                  strokeDasharray="4 2"
                />
              );
            })()}

            {dragBox && tool === 'circle' && (() => {
              const center = worldToScreen(dragBox.start.x, dragBox.start.y);
              const edge = worldToScreen(dragBox.current.x, dragBox.current.y);
              const rPx = Math.hypot(edge.x - center.x, edge.y - center.y);
              return (
                <circle
                  cx={center.x}
                  cy={center.y}
                  r={rPx}
                  fill={activeLayerInfo?.color || '#38bdf8'}
                  fillOpacity="0.25"
                  stroke={activeLayerInfo?.color || '#38bdf8'}
                  strokeWidth="1.5"
                  strokeDasharray="4 2"
                />
              );
            })()}

            {dragBox && tool === 'section' && (() => {
              const s1 = worldToScreen(dragBox.start.x, dragBox.start.y);
              const s2 = worldToScreen(dragBox.current.x, dragBox.current.y);
              return (
                <line
                  x1={s1.x}
                  y1={s1.y}
                  x2={s2.x}
                  y2={s2.y}
                  stroke="#fbbf24"
                  strokeWidth="2.5"
                  strokeDasharray="6 4"
                />
              );
            })()}

            {/* Multi-click Draft Preview (Polygon / Path / Multi-point Section Cut) */}
            {draftPoints.length > 0 && (() => {
              const allPts = cursorWorld ? [...draftPoints, cursorWorld] : draftPoints;
              const str = allPts
                .map((p) => {
                  const sp = worldToScreen(p.x, p.y);
                  return `${sp.x.toFixed(1)},${sp.y.toFixed(1)}`;
                })
                .join(' ');
              const cColor =
                tool === 'section'
                  ? sectionLine.color || '#fbbf24'
                  : activeLayerInfo?.color || '#38bdf8';
              return (
                <g>
                  <polyline
                    points={str}
                    fill={tool === 'polygon' ? cColor : 'none'}
                    fillOpacity={tool === 'polygon' ? 0.18 : 0}
                    stroke={cColor}
                    strokeWidth={
                      tool === 'path'
                        ? Math.max(2, pathWidthNm * pxPerNm)
                        : tool === 'section'
                        ? 2.4
                        : 2
                    }
                    strokeOpacity={tool === 'path' ? 0.55 : 1}
                    strokeDasharray={tool === 'section' ? '6 4' : undefined}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {draftPoints.map((p, i) => {
                    const sp = worldToScreen(p.x, p.y);
                    return (
                      <circle
                        key={i}
                        cx={sp.x}
                        cy={sp.y}
                        r={i === 0 && tool === 'polygon' ? 5 : 4}
                        fill={i === 0 ? '#fbbf24' : '#ffffff'}
                        stroke="#0f172a"
                        strokeWidth="1.2"
                      />
                    );
                  })}
                </g>
              );
            })()}

            {/* Array Step-and-Repeat Ghost Preview on Canvas */}
            {showArrayTool && selectedShape && (arrayCols > 1 || arrayRows > 1) && (
              <g pointerEvents="none">
                {Array.from({ length: Math.min(25, Math.max(1, arrayRows)) }).map((_, r) =>
                  Array.from({ length: Math.min(25, Math.max(1, arrayCols)) }).map((__, c) => {
                    if (c === 0 && r === 0) return null;
                    const ghost = moveGdsShape(selectedShape, c * arrayPitchX, r * arrayPitchY);
                    const gPolys = shapeToPolygons(ghost);
                    const gColor = layerByNum.get(selectedShape.layer)?.color || '#38bdf8';
                    return (
                      <g key={`arr_ghost_${c}_${r}`}>
                        {gPolys.map((poly, pIdx) => {
                          const ptsAttr = poly
                            .map((p) => {
                              const sp = worldToScreen(p.x, p.y);
                              return `${sp.x.toFixed(1)},${sp.y.toFixed(1)}`;
                            })
                            .join(' ');
                          return (
                            <polygon
                              key={`arr_g_${c}_${r}_${pIdx}`}
                              points={ptsAttr}
                              fill={gColor}
                              fillOpacity="0.14"
                              stroke={gColor}
                              strokeOpacity="0.75"
                              strokeWidth="1.2"
                              strokeDasharray="4 3"
                            />
                          );
                        })}
                      </g>
                    );
                  })
                )}
              </g>
            )}

            {/* MULTI-SECTION POLYLINES (A-A', B-B', C-C'...) + ACTIVE / CONCAT CUT INTERSECTION HIGHLIGHTS */}
            {sectionLines.map((cut, cutIdx) => {
              const isActiveCut = cut.id === sectionLine.id;
              const concatOrderIdx = concatConfig.enabled
                ? concatConfig.sectionIds.indexOf(cut.id)
                : -1;
              const isIncludedInConcat = concatOrderIdx >= 0;
              const isHovered = hoveredSectionId === cut.id;
              const cutColor =
                cut.color || SECTION_LINE_COLORS[cutIdx % SECTION_LINE_COLORS.length];

              const pts = getSectionPoints(cut);
              const scrPts = pts.map((p) => worldToScreen(p.x, p.y));
              let scrLen = 0;
              for (let i = 0; i < scrPts.length - 1; i++) {
                scrLen += Math.hypot(scrPts[i + 1].x - scrPts[i].x, scrPts[i + 1].y - scrPts[i].y);
              }
              if (scrLen <= 1) return null;

              const polyPointsAttr = scrPts
                .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
                .join(' ');
              const [lblStart, lblEnd] = getSectionEndLabels(cut.label);
              const midWorld = getSectionMidpoint(cut);
              const midScr = worldToScreen(midWorld.x, midWorld.y);
              const canDragLineBody = tool !== 'pan' && draftPoints.length === 0;
              const hitStrokeWidth = tool === 'select' || tool === 'section' ? 16 : 9;
              const showIntervals = isActiveCut || isIncludedInConcat;
              const cutIntervals = showIntervals
                ? isActiveCut
                  ? activeLayerCut
                  : computeRawSectionIntervals(layout.shapes, activeLayerNum, cut)
                : { cutLength: 0, intervals: [] };

              const startLineDrag = (e: React.PointerEvent<Element>) => {
                if (e.button !== 0 || e.altKey || tool === 'pan' || draftPoints.length > 0) return;
                e.stopPropagation();
                const { sx, sy } = getLocalCoords(e.clientX, e.clientY);
                const startWorld = screenToWorld(sx, sy, true);
                if (cut.id !== activeSectionLine.id) {
                  updateSectionLines(sectionLines, cut.id);
                }
                (e.currentTarget as Element).setPointerCapture(e.pointerId);
                setPointerOp({
                  kind: 'drag-section-move',
                  initSection: cut,
                  startWorld,
                });
              };

              const startVertexDrag = (vertexIndex: number, e: React.PointerEvent<Element>) => {
                if (e.button !== 0 || e.altKey || tool === 'pan' || draftPoints.length > 0) return;
                e.stopPropagation();
                if (cut.id !== activeSectionLine.id) {
                  updateSectionLines(sectionLines, cut.id);
                }
                (e.currentTarget as Element).setPointerCapture(e.pointerId);
                setPointerOp({ kind: 'drag-section-vertex', initSection: cut, vertexIndex });
              };

              const startInsertVertexDrag = (segIdx: number, e: React.PointerEvent<Element>) => {
                if (e.button !== 0 || e.altKey || tool === 'pan' || draftPoints.length > 0) return;
                e.stopPropagation();
                const segMid: GdsPoint = {
                  x: Math.round((pts[segIdx].x + pts[segIdx + 1].x) * 0.5),
                  y: Math.round((pts[segIdx].y + pts[segIdx + 1].y) * 0.5),
                };
                const nextPts = [
                  ...pts.slice(0, segIdx + 1),
                  segMid,
                  ...pts.slice(segIdx + 1),
                ];
                const updatedCut = withSectionPoints(cut, nextPts);
                updateSingleSection(updatedCut);
                (e.currentTarget as Element).setPointerCapture(e.pointerId);
                setPointerOp({
                  kind: 'drag-section-vertex',
                  initSection: updatedCut,
                  vertexIndex: segIdx + 1,
                });
              };

              const handleRemoveInteriorVertex = (
                vertexIndex: number,
                e: React.MouseEvent<Element>
              ) => {
                e.stopPropagation();
                if (pts.length <= 2 || vertexIndex <= 0 || vertexIndex >= pts.length - 1) return;
                const nextPts = pts.filter((_, i) => i !== vertexIndex);
                updateSingleSection(withSectionPoints(cut, nextPts));
              };

              const midText = isIncludedInConcat ? `#${concatOrderIdx + 1} ${cut.label}` : cut.label;
              const badgeW = isIncludedInConcat ? 54 : 38;

              return (
                <g
                  key={cut.id}
                  opacity={isActiveCut || isIncludedInConcat ? 1 : isHovered ? 0.9 : 0.65}
                >
                  {/* Cut polyline baseline */}
                  <polyline
                    points={polyPointsAttr}
                    fill="none"
                    stroke={cutColor}
                    strokeWidth={
                      isActiveCut || isIncludedInConcat
                        ? isHovered
                          ? 3
                          : 2.2
                        : isHovered
                        ? 2.2
                        : 1.5
                    }
                    strokeDasharray={isActiveCut || isIncludedInConcat ? '6 4' : '4 4'}
                    strokeLinejoin="round"
                  />

                  {/* Glowing active-layer cut intervals along every polyline segment */}
                  {showIntervals &&
                    cutIntervals.cutLength > 1 &&
                    cutIntervals.intervals.flatMap(([sA, sB], idx) =>
                      arcIntervalToPolylineSegments(pts, sA, sB).map((sub, subIdx) => {
                        const sa = worldToScreen(sub.p1.x, sub.p1.y);
                        const sb = worldToScreen(sub.p2.x, sub.p2.y);
                        return (
                          <line
                            key={`cut_seg_${cut.id}_${idx}_${subIdx}`}
                            x1={sa.x}
                            y1={sa.y}
                            x2={sb.x}
                            y2={sb.y}
                            stroke={activeLayerInfo?.color || '#38bdf8'}
                            strokeWidth="6"
                            strokeLinecap="butt"
                            opacity="0.92"
                          />
                        );
                      })
                    )}

                  {/* Invisible wide hit-area along the polyline to click & drag the entire cut line */}
                  {canDragLineBody && (
                    <polyline
                      points={polyPointsAttr}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={hitStrokeWidth}
                      strokeLinejoin="round"
                      className="cursor-grab active:cursor-grabbing"
                      onPointerEnter={() => setHoveredSectionId(cut.id)}
                      onPointerLeave={() =>
                        setHoveredSectionId((prev) => (prev === cut.id ? null : prev))
                      }
                      onPointerDown={startLineDrag}
                    />
                  )}

                  {/* Segment midpoint '+' bend handles on the active cut to add bends effortlessly */}
                  {isActiveCut &&
                    canDragLineBody &&
                    scrPts.slice(0, -1).map((spA, segIdx) => {
                      const spB = scrPts[segIdx + 1];
                      if (Math.hypot(spB.x - spA.x, spB.y - spA.y) < 36) return null;
                      // Offset slight visual handle along segment at 25% if near center badge
                      const tPos = pts.length === 2 ? 0.28 : 0.5;
                      const hx = spA.x + (spB.x - spA.x) * tPos;
                      const hy = spA.y + (spB.y - spA.y) * tPos;
                      return (
                        <g
                          key={`cut_ins_${cut.id}_${segIdx}`}
                          className="cursor-copy opacity-80 hover:opacity-100"
                          onPointerDown={(e) => startInsertVertexDrag(segIdx, e)}
                        >
                          <title>Drag to bend / add vertex to section cut</title>
                          <circle
                            cx={hx}
                            cy={hy}
                            r="5"
                            fill="#0f172a"
                            stroke={cutColor}
                            strokeWidth="1.4"
                          />
                          <line
                            x1={hx - 2.5}
                            y1={hy}
                            x2={hx + 2.5}
                            y2={hy}
                            stroke={cutColor}
                            strokeWidth="1.2"
                          />
                          <line
                            x1={hx}
                            y1={hy - 2.5}
                            x2={hx}
                            y2={hy + 2.5}
                            stroke={cutColor}
                            strokeWidth="1.2"
                          />
                        </g>
                      );
                    })}

                  {/* Center label badge (also acts as explicit drag handle for moving cut line) */}
                  <g
                    className={canDragLineBody ? 'cursor-grab active:cursor-grabbing' : ''}
                    onPointerEnter={() => setHoveredSectionId(cut.id)}
                    onPointerLeave={() =>
                      setHoveredSectionId((prev) => (prev === cut.id ? null : prev))
                    }
                    onPointerDown={startLineDrag}
                  >
                    <rect
                      x={midScr.x - badgeW * 0.5}
                      y={midScr.y - 9}
                      width={badgeW}
                      height={18}
                      rx={5}
                      fill="#0f172a"
                      fillOpacity="0.92"
                      stroke={cutColor}
                      strokeWidth={isActiveCut || isIncludedInConcat ? 1.5 : 1}
                    />
                    <text
                      x={midScr.x}
                      y={midScr.y + 3.5}
                      textAnchor="middle"
                      fill={cutColor}
                      fontSize="9.5"
                      fontWeight="bold"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {midText}
                    </text>
                  </g>

                  {/* Vertex Handles (Start A, Interior Bend Vertices, End A') */}
                  {scrPts.map((sp, vIdx) => {
                    const isFirst = vIdx === 0;
                    const isLast = vIdx === scrPts.length - 1;
                    const isInterior = !isFirst && !isLast;
                    return (
                      <g
                        key={`cut_vtx_${cut.id}_${vIdx}`}
                        className="cursor-move"
                        onPointerDown={(e) => startVertexDrag(vIdx, e)}
                        onDoubleClick={(e) => handleRemoveInteriorVertex(vIdx, e)}
                      >
                        {isInterior && <title>Drag to move bend · Double-click to remove vertex</title>}
                        <circle
                          cx={sp.x}
                          cy={sp.y}
                          r={isInterior ? (isActiveCut ? 5.5 : 4) : isActiveCut ? 7 : 5.5}
                          fill={isInterior ? '#0f172a' : cutColor}
                          stroke={isInterior ? cutColor : '#0f172a'}
                          strokeWidth="2"
                        />
                        {(isFirst || isLast) && (
                          <text
                            x={sp.x}
                            y={sp.y - 11}
                            textAnchor="middle"
                            fill={cutColor}
                            fontSize="11"
                            fontWeight="bold"
                            fontFamily="JetBrains Mono, monospace"
                          >
                            {isFirst ? lblStart : lblEnd}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </svg>

          {/* Bottom-left Viewport Zoom & Coordinates HUD */}
          <div className="absolute bottom-3 left-3 flex items-center gap-1.5 bg-slate-900/90 border border-slate-800 rounded-lg px-2 py-1 text-[10px] font-mono text-slate-300 backdrop-blur-sm">
            <button
              type="button"
              onClick={() => setCamera((c) => ({ ...c, spanX: Math.max(400, c.spanX * 0.75) }))}
              className="p-0.5 hover:text-white"
              title="Zoom In"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setCamera((c) => ({ ...c, spanX: Math.min(2000000, c.spanX * 1.33) }))}
              className="p-0.5 hover:text-white"
              title="Zoom Out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => fitCameraToLayout(layout)}
              className="p-0.5 hover:text-white"
              title="Fit Layout to View"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
            {cursorWorld && (
              <span className="pl-1.5 border-l border-slate-700 text-sky-300">
                X: {(cursorWorld.x / 1000).toFixed(2)} µm · Y: {(cursorWorld.y / 1000).toFixed(2)} µm
              </span>
            )}
          </div>

          {layout.shapes.length === 0 && (
            <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-lg bg-slate-900/85 border border-slate-800 text-[11px] text-slate-300">
              Draw shapes on the grid, click <span className="text-indigo-300 font-semibold">Import .GDS</span>, or load the <span className="text-amber-300 font-semibold">Example GDS</span>.
            </div>
          )}
        </div>

        {/* Right Layer, Reticle Mapping & Selected Object Inspector Panel */}
        <div className="w-64 sm:w-72 border-l border-slate-800 bg-slate-900/60 flex flex-col shrink-0 overflow-hidden">
          <div className="px-3 py-2.5 border-b border-slate-800 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
              <Layers className="w-3.5 h-3.5 text-sky-400" />
              <span>GDS Layers ({layout.layers.length})</span>
            </div>
            <button
              type="button"
              onClick={handleAddLayer}
              className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-sky-300 text-[10px] font-semibold border border-slate-700"
            >
              <Plus className="w-3 h-3" />
              <span>Layer</span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            {layout.layers.map((layer) => {
              const isActive = layer.layer === activeLayerNum;
              const shapeCount = layout.shapes.filter((s) => s.layer === layer.layer).length;
              return (
                <div
                  key={`${layer.layer}_${layer.datatype}`}
                  onClick={() => setActiveLayerNum(layer.layer)}
                  className={`p-2 rounded-lg border cursor-pointer transition-colors space-y-1.5 ${
                    isActive
                      ? 'bg-sky-950/35 border-sky-500/70'
                      : 'bg-slate-950/70 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-sm shrink-0"
                        style={{ backgroundColor: layer.color }}
                      />
                      <span className="font-mono text-[11px] font-bold text-slate-200 truncate">
                        L{layer.layer}/{layer.datatype}
                      </span>
                      <span className="text-[10px] text-slate-400 truncate">{layer.name}</span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-[10px] font-mono text-slate-500">{shapeCount}</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          updateLayout({
                            ...layout,
                            layers: layout.layers.map((l) =>
                              l.layer === layer.layer ? { ...l, visible: !l.visible } : l
                            ),
                          });
                        }}
                        className="p-0.5 text-slate-400 hover:text-white"
                        title={layer.visible ? 'Hide layer' : 'Show layer'}
                      >
                        {layer.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3 text-slate-600" />}
                      </button>
                    </div>
                  </div>

                  {/* Link GDS Layer -> Reticle Mask */}
                  <div onClick={(e) => e.stopPropagation()}>
                    <select
                      value={layer.assignedMaskId || ''}
                      onChange={(e) => {
                        const val = e.target.value || undefined;
                        updateLayout({
                          ...layout,
                          layers: layout.layers.map((l) =>
                            l.layer === layer.layer ? { ...l, assignedMaskId: val } : l
                          ),
                        });
                      }}
                      className="w-full px-1.5 py-1 rounded bg-slate-900 border border-slate-800 text-[10px] text-slate-300 focus:outline-none focus:border-sky-500"
                      title="Link GDS layer to a Photomask Reticle"
                    >
                      <option value="">Map to Reticle: (None)</option>
                      {masks.map((m) => (
                        <option key={m.id} value={m.id}>
                          → {m.layerCode || m.name} ({m.name})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              );
            })}

            {unmappedWithShapes.length > 0 && (
              <button
                type="button"
                onClick={handleCreateReticlesFromUnmapped}
                className="w-full py-1.5 px-2 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/40 text-indigo-300 text-[10px] font-semibold transition-colors"
              >
                + Auto-Create {unmappedWithShapes.length} Reticle(s) from GDS Layers
              </button>
            )}
          </div>

          {/* Selected Object Properties Inspector */}
          {selectedShape ? (
            <div className="p-2.5 border-t border-slate-800 bg-slate-950/90 space-y-2 text-[11px] max-h-[46%] overflow-y-auto shrink-0">
              <div className="flex items-center justify-between gap-1">
                <span className="font-semibold text-white capitalize flex items-center gap-1.5">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: layerByNum.get(selectedShape.layer)?.color || '#38bdf8' }}
                  />
                  <span>{selectedShape.type} Properties</span>
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={handleToggleArrayTool}
                    className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border transition-colors ${
                      showArrayTool
                        ? 'bg-sky-600 border-sky-500 text-white'
                        : 'bg-slate-800 border-slate-700 hover:bg-slate-700 text-sky-300'
                    }`}
                    title="Create 2D array (step & repeat) from selected object"
                  >
                    <Grid className="w-3 h-3" />
                    <span>Array</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDuplicateSelectedShape}
                    className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                    title="Duplicate selected object"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      updateLayout({
                        ...layout,
                        shapes: layout.shapes.filter((s) => s.id !== selectedShape.id),
                      });
                      setSelectedShapeId(null);
                      setShowArrayTool(false);
                    }}
                    className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-rose-950/60 hover:bg-rose-900/70 text-rose-300 text-[10px]"
                    title="Delete selected object"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {/* Array / Step-and-Repeat Generator Drawer */}
              {showArrayTool && (
                <div className="p-2 rounded-lg bg-sky-950/30 border border-sky-500/40 space-y-1.5">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="font-semibold text-sky-300 flex items-center gap-1">
                      <Grid className="w-3 h-3" />
                      <span>Create Array (Step &amp; Repeat)</span>
                    </span>
                    <span className="font-mono text-slate-400">
                      {Math.max(1, arrayCols) * Math.max(1, arrayRows)} total
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <label className="space-y-0.5">
                      <span className="text-[10px] text-slate-400 block">Cols (Nx)</span>
                      <NmNumberInput
                        value={arrayCols}
                        min={1}
                        max={50}
                        step={1}
                        onChange={(v) => setArrayCols(Math.max(1, Math.min(50, v)))}
                        className="w-full px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 font-mono text-[11px] text-white"
                      />
                    </label>
                    <label className="space-y-0.5">
                      <span className="text-[10px] text-slate-400 block">Rows (Ny)</span>
                      <NmNumberInput
                        value={arrayRows}
                        min={1}
                        max={50}
                        step={1}
                        onChange={(v) => setArrayRows(Math.max(1, Math.min(50, v)))}
                        className="w-full px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 font-mono text-[11px] text-white"
                      />
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <label className="space-y-0.5">
                      <span className="text-[10px] text-slate-400 block">Pitch X (nm)</span>
                      <NmNumberInput
                        value={arrayPitchX}
                        min={-500000}
                        max={500000}
                        step={100}
                        onChange={setArrayPitchX}
                        className="w-full px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 font-mono text-[11px] text-sky-300"
                      />
                    </label>
                    <label className="space-y-0.5">
                      <span className="text-[10px] text-slate-400 block">Pitch Y (nm)</span>
                      <NmNumberInput
                        value={arrayPitchY}
                        min={-500000}
                        max={500000}
                        step={100}
                        onChange={setArrayPitchY}
                        className="w-full px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 font-mono text-[11px] text-sky-300"
                      />
                    </label>
                  </div>
                  <div className="flex items-center gap-1.5 pt-0.5">
                    <button
                      type="button"
                      onClick={handleGenerateArray}
                      className="flex-1 py-1 px-2 rounded bg-sky-600 hover:bg-sky-500 text-white text-[10px] font-semibold transition-colors"
                    >
                      Create {Math.max(0, arrayCols * arrayRows - 1)} Copy(s)
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowArrayTool(false)}
                      className="py-1 px-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Layer Assignment */}
              <div className="grid grid-cols-3 gap-1.5 items-center">
                <span className="text-[10px] text-slate-400">GDS Layer</span>
                <select
                  value={selectedShape.layer}
                  onChange={(e) =>
                    handleUpdateShape({
                      ...selectedShape,
                      layer: parseInt(e.target.value, 10),
                    })
                  }
                  className="col-span-2 px-1.5 py-1 rounded bg-slate-900 border border-slate-700 text-[10px] font-mono text-slate-200 focus:outline-none focus:border-sky-500"
                >
                  {layout.layers.map((l) => (
                    <option key={l.layer} value={l.layer}>
                      L{l.layer}/{l.datatype} · {l.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* RECTANGLE PROPERTIES */}
              {selectedShape.type === 'rect' && (
                <div className="space-y-1.5">
                  <div className="grid grid-cols-2 gap-1.5">
                    <label className="space-y-0.5">
                      <span className="text-[10px] text-slate-400 block">Width (nm)</span>
                      <NmNumberInput
                        value={selectedShape.width ?? 100}
                        min={10}
                        onChange={(w) => handleUpdateShape({ ...selectedShape, width: w })}
                        className="w-full px-1.5 py-1 rounded bg-slate-900 border border-slate-700 font-mono text-[11px] text-sky-300 focus:outline-none focus:border-sky-500"
                      />
                    </label>
                    <label className="space-y-0.5">
                      <span className="text-[10px] text-slate-400 block">Height (nm)</span>
                      <NmNumberInput
                        value={selectedShape.height ?? 100}
                        min={10}
                        onChange={(h) => handleUpdateShape({ ...selectedShape, height: h })}
                        className="w-full px-1.5 py-1 rounded bg-slate-900 border border-slate-700 font-mono text-[11px] text-sky-300 focus:outline-none focus:border-sky-500"
                      />
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <label className="space-y-0.5">
                      <span className="text-[10px] text-slate-400 block">X (nm)</span>
                      <NmNumberInput
                        value={selectedShape.x ?? 0}
                        onChange={(x) => handleUpdateShape({ ...selectedShape, x })}
                        className="w-full px-1.5 py-1 rounded bg-slate-900 border border-slate-700 font-mono text-[11px] text-slate-200 focus:outline-none focus:border-sky-500"
                      />
                    </label>
                    <label className="space-y-0.5">
                      <span className="text-[10px] text-slate-400 block">Y (nm)</span>
                      <NmNumberInput
                        value={selectedShape.y ?? 0}
                        onChange={(y) => handleUpdateShape({ ...selectedShape, y })}
                        className="w-full px-1.5 py-1 rounded bg-slate-900 border border-slate-700 font-mono text-[11px] text-slate-200 focus:outline-none focus:border-sky-500"
                      />
                    </label>
                  </div>
                  <div className="text-[10px] font-mono text-slate-500">
                    {((selectedShape.width ?? 0) / 1000).toFixed(2)} ×{' '}
                    {((selectedShape.height ?? 0) / 1000).toFixed(2)} µm
                  </div>
                </div>
              )}

              {/* CIRCLE PROPERTIES */}
              {selectedShape.type === 'circle' && (
                <div className="space-y-1.5">
                  <label className="space-y-0.5 block">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-slate-400">Diameter (nm)</span>
                      <span className="font-mono text-slate-500">
                        R: {Math.round(selectedShape.radius ?? 0)} nm
                      </span>
                    </div>
                    <NmNumberInput
                      value={(selectedShape.radius ?? 100) * 2}
                      min={20}
                      onChange={(diam) =>
                        handleUpdateShape({
                          ...selectedShape,
                          radius: Math.max(10, Math.round(diam / 2)),
                        })
                      }
                      className="w-full px-1.5 py-1 rounded bg-slate-900 border border-slate-700 font-mono text-[11px] text-sky-300 focus:outline-none focus:border-sky-500"
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    <label className="space-y-0.5">
                      <span className="text-[10px] text-slate-400 block">Center X (nm)</span>
                      <NmNumberInput
                        value={selectedShape.cx ?? 0}
                        onChange={(cx) => handleUpdateShape({ ...selectedShape, cx })}
                        className="w-full px-1.5 py-1 rounded bg-slate-900 border border-slate-700 font-mono text-[11px] text-slate-200 focus:outline-none focus:border-sky-500"
                      />
                    </label>
                    <label className="space-y-0.5">
                      <span className="text-[10px] text-slate-400 block">Center Y (nm)</span>
                      <NmNumberInput
                        value={selectedShape.cy ?? 0}
                        onChange={(cy) => handleUpdateShape({ ...selectedShape, cy })}
                        className="w-full px-1.5 py-1 rounded bg-slate-900 border border-slate-700 font-mono text-[11px] text-slate-200 focus:outline-none focus:border-sky-500"
                      />
                    </label>
                  </div>
                </div>
              )}

              {/* PATH PROPERTIES */}
              {selectedShape.type === 'path' && (() => {
                const b = getGdsShapeBounds(selectedShape);
                return (
                  <div className="space-y-1.5">
                    <label className="space-y-0.5 block">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-slate-400">Path Width (nm)</span>
                        <span className="font-mono text-slate-500">
                          {selectedShape.points?.length || 0} pts
                        </span>
                      </div>
                      <NmNumberInput
                        value={selectedShape.pathWidth ?? 200}
                        min={10}
                        onChange={(pw) => handleUpdateShape({ ...selectedShape, pathWidth: pw })}
                        className="w-full px-1.5 py-1 rounded bg-slate-900 border border-slate-700 font-mono text-[11px] text-sky-300 focus:outline-none focus:border-sky-500"
                      />
                    </label>
                    <div className="grid grid-cols-2 gap-1.5">
                      <label className="space-y-0.5">
                        <span className="text-[10px] text-slate-400 block">Origin X (nm)</span>
                        <NmNumberInput
                          value={b.minX}
                          onChange={(nx) => handleUpdateShape(moveGdsShape(selectedShape, nx - b.minX, 0))}
                          className="w-full px-1.5 py-1 rounded bg-slate-900 border border-slate-700 font-mono text-[11px] text-slate-200 focus:outline-none focus:border-sky-500"
                        />
                      </label>
                      <label className="space-y-0.5">
                        <span className="text-[10px] text-slate-400 block">Origin Y (nm)</span>
                        <NmNumberInput
                          value={b.minY}
                          onChange={(ny) => handleUpdateShape(moveGdsShape(selectedShape, 0, ny - b.minY))}
                          className="w-full px-1.5 py-1 rounded bg-slate-900 border border-slate-700 font-mono text-[11px] text-slate-200 focus:outline-none focus:border-sky-500"
                        />
                      </label>
                    </div>
                    {selectedShape.points && selectedShape.points.length <= 10 && (
                      <div className="space-y-1 pt-1 border-t border-slate-800/80">
                        <span className="text-[10px] text-slate-500 block">Vertices (nm)</span>
                        {selectedShape.points.map((pt, idx) => (
                          <div key={idx} className="grid grid-cols-5 gap-1 items-center">
                            <span className="text-[9px] font-mono text-slate-500">P{idx + 1}</span>
                            <NmNumberInput
                              value={pt.x}
                              onChange={(vx) => {
                                const pts = (selectedShape.points || []).map((p, k) =>
                                  k === idx ? { ...p, x: vx } : p
                                );
                                handleUpdateShape({ ...selectedShape, points: pts });
                              }}
                              className="col-span-2 px-1 py-0.5 rounded bg-slate-900 border border-slate-800 font-mono text-[10px] text-slate-200"
                            />
                            <NmNumberInput
                              value={pt.y}
                              onChange={(vy) => {
                                const pts = (selectedShape.points || []).map((p, k) =>
                                  k === idx ? { ...p, y: vy } : p
                                );
                                handleUpdateShape({ ...selectedShape, points: pts });
                              }}
                              className="col-span-2 px-1 py-0.5 rounded bg-slate-900 border border-slate-800 font-mono text-[10px] text-slate-200"
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* POLYGON PROPERTIES */}
              {selectedShape.type === 'polygon' && (() => {
                const b = getGdsShapeBounds(selectedShape);
                return (
                  <div className="space-y-1.5">
                    <div className="grid grid-cols-2 gap-1.5">
                      <label className="space-y-0.5">
                        <span className="text-[10px] text-slate-400 block">Width (nm)</span>
                        <NmNumberInput
                          value={Math.max(10, b.width)}
                          min={10}
                          onChange={(tw) =>
                            handleUpdateShape(
                              resizePointShapeToBounds(selectedShape, b.minX, b.minY, tw, Math.max(10, b.height))
                            )
                          }
                          className="w-full px-1.5 py-1 rounded bg-slate-900 border border-slate-700 font-mono text-[11px] text-sky-300 focus:outline-none focus:border-sky-500"
                        />
                      </label>
                      <label className="space-y-0.5">
                        <span className="text-[10px] text-slate-400 block">Height (nm)</span>
                        <NmNumberInput
                          value={Math.max(10, b.height)}
                          min={10}
                          onChange={(th) =>
                            handleUpdateShape(
                              resizePointShapeToBounds(selectedShape, b.minX, b.minY, Math.max(10, b.width), th)
                            )
                          }
                          className="w-full px-1.5 py-1 rounded bg-slate-900 border border-slate-700 font-mono text-[11px] text-sky-300 focus:outline-none focus:border-sky-500"
                        />
                      </label>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <label className="space-y-0.5">
                        <span className="text-[10px] text-slate-400 block">X (nm)</span>
                        <NmNumberInput
                          value={b.minX}
                          onChange={(nx) => handleUpdateShape(moveGdsShape(selectedShape, nx - b.minX, 0))}
                          className="w-full px-1.5 py-1 rounded bg-slate-900 border border-slate-700 font-mono text-[11px] text-slate-200 focus:outline-none focus:border-sky-500"
                        />
                      </label>
                      <label className="space-y-0.5">
                        <span className="text-[10px] text-slate-400 block">Y (nm)</span>
                        <NmNumberInput
                          value={b.minY}
                          onChange={(ny) => handleUpdateShape(moveGdsShape(selectedShape, 0, ny - b.minY))}
                          className="w-full px-1.5 py-1 rounded bg-slate-900 border border-slate-700 font-mono text-[11px] text-slate-200 focus:outline-none focus:border-sky-500"
                        />
                      </label>
                    </div>
                    {selectedShape.points && selectedShape.points.length <= 10 && (
                      <div className="space-y-1 pt-1 border-t border-slate-800/80">
                        <span className="text-[10px] text-slate-500 block">
                          Vertices ({selectedShape.points.length} pts)
                        </span>
                        {selectedShape.points.map((pt, idx) => (
                          <div key={idx} className="grid grid-cols-5 gap-1 items-center">
                            <span className="text-[9px] font-mono text-slate-500">P{idx + 1}</span>
                            <NmNumberInput
                              value={pt.x}
                              onChange={(vx) => {
                                const pts = (selectedShape.points || []).map((p, k) =>
                                  k === idx ? { ...p, x: vx } : p
                                );
                                handleUpdateShape({ ...selectedShape, points: pts });
                              }}
                              className="col-span-2 px-1 py-0.5 rounded bg-slate-900 border border-slate-800 font-mono text-[10px] text-slate-200"
                            />
                            <NmNumberInput
                              value={pt.y}
                              onChange={(vy) => {
                                const pts = (selectedShape.points || []).map((p, k) =>
                                  k === idx ? { ...p, y: vy } : p
                                );
                                handleUpdateShape({ ...selectedShape, points: pts });
                              }}
                              className="col-span-2 px-1 py-0.5 rounded bg-slate-900 border border-slate-800 font-mono text-[10px] text-slate-200"
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          ) : (
            <div className="px-3 py-2 border-t border-slate-800 bg-slate-950/60 text-[10px] text-slate-500 shrink-0">
              Select a shape with the <span className="text-slate-300 font-medium">Select</span> tool to edit dimensions or drag cut lines.
            </div>
          )}
        </div>
      </div>

      {/* Bottom Section Cut Selector, Concatenation, Preview & Aperture Generator Bar */}
      <div className="px-4 py-2.5 bg-slate-900/90 border-t border-slate-800 space-y-2 shrink-0">
        {/* Multi-Cut Tabs Strip (A-A', B-B', C-C'...) + Concatenate Toggle */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-1.5 border-b border-slate-800/80">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1 mr-1">
              <Scissors className="w-3.5 h-3.5 text-amber-400" />
              <span>Section Cuts:</span>
            </span>

            {sectionLines.map((cut, idx) => {
              const active = cut.id === sectionLine.id;
              const color = cut.color || SECTION_LINE_COLORS[idx % SECTION_LINE_COLORS.length];
              return (
                <div
                  key={cut.id}
                  onClick={() => updateSectionLines(sectionLines, cut.id)}
                  className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11px] font-mono cursor-pointer transition-colors ${
                    active
                      ? 'bg-slate-800 border-slate-500 text-white shadow-sm'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                  }`}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <span className="font-semibold">{cut.label}</span>
                  {sectionLines.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => handleDeleteSectionCut(cut.id, e)}
                      className="ml-0.5 text-slate-500 hover:text-rose-400 leading-none"
                      title={`Remove section cut ${cut.label}`}
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}

            <button
              type="button"
              onClick={handleAddSectionCut}
              className="flex items-center gap-0.5 px-2 py-0.5 rounded-md bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 text-[11px] font-semibold transition-colors"
              title="Add another section cut line (B-B', C-C', ...)"
            >
              <Plus className="w-3 h-3" />
              <span>Add Cut ({getNextSectionLabel(sectionLines)})</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleToggleConcat}
              className={`flex items-center gap-1 px-2.5 py-0.5 rounded-md border text-[11px] font-semibold transition-colors ${
                concatConfig.enabled
                  ? 'bg-indigo-600 border-indigo-400 text-white shadow-sm'
                  : 'bg-slate-950 border-slate-700 text-slate-300 hover:border-slate-500'
              }`}
              title="Concatenate multiple section cuts into a single combined mask aperture"
            >
              <Link2 className="w-3 h-3" />
              <span>Concatenate Cuts</span>
            </button>
            <span className="hidden lg:inline text-[10px] text-slate-500">
              Drag any cut line or endpoint on the canvas
            </span>
          </div>
        </div>

        {/* Concatenation Order & Separation Bar (visible when Concatenate Cuts is ON) */}
        {concatConfig.enabled && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-indigo-950/30 border border-indigo-500/35 text-[11px]">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-indigo-300 mr-1">
                Order:
              </span>

              {orderedConcatSections.map((cut, idx) => {
                const cutColor = cut.color || SECTION_LINE_COLORS[idx % SECTION_LINE_COLORS.length];
                return (
                  <React.Fragment key={`cat_${cut.id}`}>
                    <div
                      draggable
                      onDragStart={() => setDraggingConcatId(cut.id)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => handleReorderConcatDrop(cut.id)}
                      onDragEnd={() => setDraggingConcatId(null)}
                      className={`flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-900 border font-mono text-[11px] cursor-grab active:cursor-grabbing ${
                        draggingConcatId === cut.id
                          ? 'border-indigo-400 opacity-60'
                          : 'border-slate-700 text-slate-200'
                      }`}
                      title="Drag or use arrows to change concatenation order"
                    >
                      <span className="text-[9px] text-slate-500">{idx + 1}.</span>
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: cutColor }}
                      />
                      <span className="font-semibold">{cut.label}</span>
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => handleMoveConcatOrder(cut.id, -1)}
                        className="p-0.5 text-slate-400 hover:text-white disabled:opacity-25"
                        title="Move earlier"
                      >
                        <ChevronLeft className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === orderedConcatSections.length - 1}
                        onClick={() => handleMoveConcatOrder(cut.id, 1)}
                        className="p-0.5 text-slate-400 hover:text-white disabled:opacity-25"
                        title="Move later"
                      >
                        <ChevronRight className="w-3 h-3" />
                      </button>
                      {orderedConcatSections.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            updateConcatConfig({
                              ...concatConfig,
                              sectionIds: concatConfig.sectionIds.filter((x) => x !== cut.id),
                            })
                          }
                          className="text-slate-500 hover:text-rose-400 pl-0.5 leading-none"
                          title={`Exclude ${cut.label}`}
                        >
                          ×
                        </button>
                      )}
                    </div>
                    {idx < orderedConcatSections.length - 1 && (
                      <span className="text-[10px] font-mono text-indigo-400/80">→</span>
                    )}
                  </React.Fragment>
                );
              })}

              {excludedConcatSections.map((cut) => (
                <button
                  key={`add_cat_${cut.id}`}
                  type="button"
                  onClick={() =>
                    updateConcatConfig({
                      ...concatConfig,
                      sectionIds: [...concatConfig.sectionIds, cut.id],
                    })
                  }
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-dashed border-slate-700 hover:border-indigo-400 text-slate-400 hover:text-indigo-300 font-mono text-[10px] transition-colors"
                  title={`Include ${cut.label} in concatenation`}
                >
                  <Plus className="w-2.5 h-2.5" />
                  <span>{cut.label}</span>
                </button>
              ))}
            </div>

            {/* Separation Space between cuts */}
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400 text-[10px]">Separation Gap:</span>
              <NmNumberInput
                value={concatConfig.gapNm}
                min={0}
                max={500000}
                step={100}
                onChange={(gapNm) =>
                  updateConcatConfig({
                    ...concatConfig,
                    gapNm: Math.max(0, gapNm),
                  })
                }
                className="w-20 px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 font-mono text-[11px] text-indigo-300 focus:outline-none focus:border-indigo-400"
              />
              <span className="text-slate-500 font-mono text-[10px]">
                nm ({(concatConfig.gapNm / 1000).toFixed(2)} µm)
              </span>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="font-semibold flex items-center gap-1"
              style={{
                color: previewSlice.isConcat
                  ? '#a5b4fc'
                  : sectionLine.color || '#fbbf24',
              }}
            >
              <span>
                {previewSlice.isConcat
                  ? `Concat (${orderedConcatSections.map((s) => s.label).join(' + ')})`
                  : `Active Cut ${sectionLine.label}`}
              </span>
            </span>
            <span className="text-[11px] font-mono text-slate-400">
              {previewSlice.isConcat ? 'Total:' : 'Length:'}{' '}
              {(previewSlice.cutLength / 1000).toFixed(2)} µm
            </span>
            <span className="text-[11px] font-mono text-sky-300">
              · Layer {activeLayerNum}: {previewSlice.windows.length} aperture(s)
            </span>

            <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer ml-2">
              <input
                type="checkbox"
                checked={Boolean(sectionLine.resizeWaferToCut)}
                onChange={(e) =>
                  updateSingleSection({
                    ...sectionLine,
                    resizeWaferToCut: e.target.checked,
                  })
                }
                className="rounded bg-slate-800 border-slate-700 text-amber-500 focus:ring-0"
              />
              <span>
                1:1 Scale (Resize wafer width to {previewSlice.isConcat ? 'total' : 'cut'} length)
              </span>
            </label>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="text-slate-400">Target:</span>
              <select
                value={targetMaskId}
                onChange={(e) => setTargetMaskId(e.target.value)}
                className="px-2 py-1 rounded-lg bg-slate-950 border border-slate-700 text-slate-200 font-mono text-[11px] focus:outline-none focus:border-sky-500"
              >
                {masks.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.layerCode || 'LVL'} · {m.name}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={handleApplyToSingleMask}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold transition-colors shadow-sm"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Generate Mask Apertures</span>
            </button>

            {mappedLayerCount > 0 && (
              <button
                type="button"
                onClick={handleApplyToAllMapped}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold transition-colors shadow-sm"
                title="Generate apertures for every reticle linked to a GDS layer"
              >
                <ArrowRight className="w-3.5 h-3.5" />
                <span>Apply All Mapped ({mappedLayerCount})</span>
              </button>
            )}
          </div>
        </div>

        {/* 1D Live Cut Aperture Strip Preview */}
        <div className="relative h-6 w-full rounded-lg bg-slate-950 border border-slate-800 overflow-hidden">
          <div
            className="absolute inset-0 opacity-35"
            style={{
              backgroundImage:
                'repeating-linear-gradient(45deg, #1e293b 0, #1e293b 6px, #0f172a 6px, #0f172a 12px)',
            }}
          />
          {/* Segmented cut bands when Concatenated */}
          {previewSlice.isConcat &&
            previewSlice.segments.map((seg, sIdx) => (
              <div
                key={`seg_band_${seg.section.id}_${sIdx}`}
                className="absolute top-0 bottom-0 border-x border-slate-700/80 pointer-events-none flex items-start px-1"
                style={{
                  left: `${seg.startPct}%`,
                  width: `${seg.widthPct}%`,
                  backgroundColor: `${seg.section.color || '#fbbf24'}12`,
                }}
              >
                <span
                  className="text-[8px] font-mono font-bold leading-tight opacity-85"
                  style={{ color: seg.section.color || '#fbbf24' }}
                >
                  {seg.section.label}
                </span>
              </div>
            ))}

          {previewSlice.windows.map((w, idx) => {
            const totalSpan = sectionLine.resizeWaferToCut
              ? Math.max(1, previewSlice.cutLength)
              : waferWidth;
            const leftPct = (w.xStart / totalSpan) * 100;
            const widthPct = ((w.xEnd - w.xStart) / totalSpan) * 100;
            return (
              <div
                key={`prev_${idx}`}
                className="absolute top-1 bottom-0.5 rounded flex items-center justify-center text-[9px] font-mono font-bold text-white"
                style={{
                  left: `${leftPct}%`,
                  width: `${Math.max(0.8, widthPct)}%`,
                  backgroundColor: activeLayerInfo?.color || '#38bdf8',
                }}
              >
                {widthPct > 8 ? `${((w.xEnd - w.xStart) / 1000).toFixed(2)}µm` : ''}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
