/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState, useEffect } from 'react';
import { MaskWindow, ProcessStep } from '../types/microfab';
import { Plus, Trash2, ArrowLeftRight, MoveHorizontal, GripVertical, Scan } from 'lucide-react';

interface MaskEditorProps {
  step: ProcessStep;
  waferWidth: number; // in nm
  onUpdateStep: (updated: ProcessStep) => void;
  onOpenMaskLevels?: () => void;
}

interface DragState {
  winId: string;
  type: 'resize-start' | 'resize-end' | 'move';
  startClientX: number;
  initialXStart: number;
  initialXEnd: number;
}

export const MaskEditor: React.FC<MaskEditorProps> = ({
  step,
  waferWidth,
  onUpdateStep,
  onOpenMaskLevels,
}) => {
  const litho = step.lithography;
  if (!litho) return null;

  const containerRef = useRef<HTMLDivElement>(null);
  const [activeWindowId, setActiveWindowId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);

  const windows = litho.windows || [];

  const handleAddWindow = () => {
    // Add default window in the center 1/3 of the wafer
    const start = Math.round(waferWidth * 0.35);
    const end = Math.round(waferWidth * 0.65);
    const newWin: MaskWindow = {
      id: `w_${Date.now()}`,
      xStart: start,
      xEnd: end,
    };
    const updatedLitho = {
      ...litho,
      windows: [...windows, newWin],
    };
    onUpdateStep({
      ...step,
      lithography: updatedLitho,
    });
    setActiveWindowId(newWin.id);
  };

  const handleRemoveWindow = (id: string) => {
    const updatedLitho = {
      ...litho,
      windows: windows.filter((w) => w.id !== id),
    };
    onUpdateStep({
      ...step,
      lithography: updatedLitho,
    });
    if (activeWindowId === id) setActiveWindowId(null);
  };

  const handleUpdateWindowCoord = (
    id: string,
    field: 'xStart' | 'xEnd',
    val: number
  ) => {
    const clamped = Math.max(0, Math.min(waferWidth, val));
    const updatedLitho = {
      ...litho,
      windows: windows.map((w) => {
        if (w.id === id) {
          const updated = { ...w, [field]: clamped };
          // Ensure start <= end
          if (updated.xStart > updated.xEnd) {
            if (field === 'xStart') updated.xEnd = updated.xStart;
            else updated.xStart = updated.xEnd;
          }
          return updated;
        }
        return w;
      }),
    };
    onUpdateStep({
      ...step,
      lithography: updatedLitho,
    });
  };

  const togglePolarity = () => {
    const newPol = litho.polarity === 'positive' ? 'negative' : 'positive';
    onUpdateStep({
      ...step,
      lithography: {
        ...litho,
        polarity: newPol,
      },
    });
  };

  // Pointer drag start handler
  const handlePointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    win: MaskWindow,
    type: 'resize-start' | 'resize-end' | 'move'
  ) => {
    e.preventDefault();
    e.stopPropagation();

    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setActiveWindowId(win.id);
    setDragState({
      winId: win.id,
      type,
      startClientX: e.clientX,
      initialXStart: win.xStart,
      initialXEnd: win.xEnd,
    });
  };

  // Pointer move handler
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;

    const pxToNm = waferWidth / rect.width;
    const deltaNm = (e.clientX - dragState.startClientX) * pxToNm;
    // Snap to 50 nm precision
    const snap = 50;

    let updatedWindows = windows;

    if (dragState.type === 'resize-start') {
      const rawStart = dragState.initialXStart + deltaNm;
      const snappedStart = Math.round(rawStart / snap) * snap;
      // Minimum aperture width 100 nm
      const clampedStart = Math.max(0, Math.min(dragState.initialXEnd - 100, snappedStart));

      updatedWindows = windows.map((w) =>
        w.id === dragState.winId ? { ...w, xStart: clampedStart } : w
      );
    } else if (dragState.type === 'resize-end') {
      const rawEnd = dragState.initialXEnd + deltaNm;
      const snappedEnd = Math.round(rawEnd / snap) * snap;
      const clampedEnd = Math.max(dragState.initialXStart + 100, Math.min(waferWidth, snappedEnd));

      updatedWindows = windows.map((w) =>
        w.id === dragState.winId ? { ...w, xEnd: clampedEnd } : w
      );
    } else if (dragState.type === 'move') {
      const width = dragState.initialXEnd - dragState.initialXStart;
      const rawStart = dragState.initialXStart + deltaNm;
      const snappedStart = Math.round(rawStart / snap) * snap;
      const clampedStart = Math.max(0, Math.min(waferWidth - width, snappedStart));
      const clampedEnd = clampedStart + width;

      updatedWindows = windows.map((w) =>
        w.id === dragState.winId
          ? { ...w, xStart: clampedStart, xEnd: clampedEnd }
          : w
      );
    }

    onUpdateStep({
      ...step,
      lithography: {
        ...litho,
        windows: updatedWindows,
      },
    });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragState) {
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch (err) {
        // ignore
      }
      setDragState(null);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-slate-200">
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold tracking-wider uppercase text-sky-400">
            Photomask Aperture Track
          </span>
          <span className="text-xs text-slate-500">·</span>
          <span className="text-xs text-slate-400 font-mono">
            {litho.maskName || 'Photomask Layer'}
          </span>
          <span className="text-xs text-slate-500">·</span>
          <span className="text-[11px] text-slate-400">
            Drag center to move · Drag left/right borders to resize
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={togglePolarity}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
            title="Switch between Positive (clear field) and Negative (dark field) photoresist"
          >
            <ArrowLeftRight className="w-3.5 h-3.5 text-amber-400" />
            <span>
              Tone: <strong className="capitalize text-white">{litho.polarity}</strong>
            </span>
          </button>

          <button
            onClick={handleAddWindow}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Aperture</span>
          </button>

          {onOpenMaskLevels && (
            <button
              onClick={onOpenMaskLevels}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-400 hover:text-sky-300 border border-slate-700 transition-colors"
              title="Open Photolithography Mask Levels Panel"
            >
              <Scan className="w-3.5 h-3.5" />
              <span>Mask Levels</span>
            </button>
          )}
        </div>
      </div>

      {/* Visual Photomask Bar */}
      <div className="relative my-2 select-none">
        <div className="text-[10px] text-slate-400 flex justify-between font-mono mb-1">
          <span>0 µm</span>
          <span className="text-slate-500">
            {dragState ? (
              <span className="text-amber-300 font-semibold animate-pulse">
                {dragState.type === 'move' ? 'Sliding Aperture...' : 'Resizing Boundary...'}
              </span>
            ) : (
              `Wafer Width: ${(waferWidth / 1000).toFixed(1)} µm`
            )}
          </span>
          <span>{(waferWidth / 1000).toFixed(1)} µm</span>
        </div>

        {/* Chrome base / Glass strip */}
        <div
          ref={containerRef}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="relative h-11 w-full bg-slate-950 border border-slate-700 rounded-lg overflow-hidden shadow-inner select-none"
        >
          {/* Default mask field: dark chrome or quartz background */}
          <div className="absolute inset-0 bg-slate-800/80 opacity-40 pattern-crosshatch" />

          {/* Aperture windows (Clear quartz openings for positive resist) */}
          {windows.map((win) => {
            const leftPct = (win.xStart / waferWidth) * 100;
            const widthPct = Math.max(1.5, ((win.xEnd - win.xStart) / waferWidth) * 100);
            const isActive = activeWindowId === win.id;
            const isDraggingThis = dragState?.winId === win.id;

            return (
              <div
                key={win.id}
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveWindowId(win.id);
                }}
                className={`absolute top-0 bottom-0 transition-shadow select-none group/box ${
                  isActive || isDraggingThis
                    ? 'bg-amber-400/40 border-y border-amber-400 shadow-xl'
                    : 'bg-emerald-400/25 border-y border-emerald-400/80 hover:bg-emerald-400/35'
                }`}
                style={{
                  left: `${leftPct}%`,
                  width: `${widthPct}%`,
                }}
              >
                {/* Left Resize Handle */}
                <div
                  onPointerDown={(e) => handlePointerDown(e, win, 'resize-start')}
                  className="absolute left-0 top-0 bottom-0 w-3 cursor-ew-resize flex items-center justify-center bg-amber-500/80 hover:bg-amber-400 text-slate-950 z-20 transition-all select-none group/left"
                  title="Drag to resize aperture left boundary"
                >
                  <div className="w-1 h-5 rounded-full bg-slate-950/70" />
                </div>

                {/* Central Drag & Slide Area */}
                <div
                  onPointerDown={(e) => handlePointerDown(e, win, 'move')}
                  className="w-full h-full flex items-center justify-center cursor-grab active:cursor-grabbing px-3 overflow-hidden select-none"
                  title="Click and drag to slide aperture"
                >
                  <div className="flex items-center gap-1 text-[11px] font-mono font-bold text-white drop-shadow truncate select-none pointer-events-none">
                    <MoveHorizontal className="w-3 h-3 text-amber-300 flex-shrink-0" />
                    <span>{((win.xEnd - win.xStart) / 1000).toFixed(2)} µm</span>
                  </div>
                </div>

                {/* Right Resize Handle */}
                <div
                  onPointerDown={(e) => handlePointerDown(e, win, 'resize-end')}
                  className="absolute right-0 top-0 bottom-0 w-3 cursor-ew-resize flex items-center justify-center bg-amber-500/80 hover:bg-amber-400 text-slate-950 z-20 transition-all select-none group/right"
                  title="Drag to resize aperture right boundary"
                >
                  <div className="w-1 h-5 rounded-full bg-slate-950/70" />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Numerical Apertures List & Controls */}
      {windows.length > 0 && (
        <div className="mt-3 space-y-1.5 max-h-36 overflow-y-auto pr-1">
          {windows.map((win, idx) => {
            const isSelected = activeWindowId === win.id;
            const startUm = (win.xStart / 1000).toFixed(2);
            const endUm = (win.xEnd / 1000).toFixed(2);
            const widthUm = ((win.xEnd - win.xStart) / 1000).toFixed(2);

            return (
              <div
                key={win.id}
                onClick={() => setActiveWindowId(win.id)}
                className={`flex items-center justify-between p-2 rounded-lg text-xs transition-colors ${
                  isSelected
                    ? 'bg-slate-800/90 border border-sky-500/50'
                    : 'bg-slate-950/60 border border-slate-800/80 hover:bg-slate-800/40'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-md bg-slate-800 flex items-center justify-center font-mono text-[11px] text-slate-300">
                    {idx + 1}
                  </span>
                  <span className="font-medium text-slate-300">Aperture #{idx + 1}</span>
                  <span className="text-[11px] text-slate-500 font-mono">
                    (Width: {widthUm} µm)
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1 font-mono text-[11px]">
                    <span className="text-slate-400">X:</span>
                    <input
                      type="number"
                      step="0.05"
                      min="0"
                      max={(waferWidth / 1000).toFixed(2)}
                      value={startUm}
                      onChange={(e) =>
                        handleUpdateWindowCoord(
                          win.id,
                          'xStart',
                          parseFloat(e.target.value || '0') * 1000
                        )
                      }
                      className="w-14 px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-100 text-right focus:outline-none focus:border-sky-500"
                    />
                    <span className="text-slate-500">→</span>
                    <input
                      type="number"
                      step="0.05"
                      min="0"
                      max={(waferWidth / 1000).toFixed(2)}
                      value={endUm}
                      onChange={(e) =>
                        handleUpdateWindowCoord(
                          win.id,
                          'xEnd',
                          parseFloat(e.target.value || '0') * 1000
                        )
                      }
                      className="w-14 px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-100 text-right focus:outline-none focus:border-sky-500"
                    />
                    <span className="text-slate-500">µm</span>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveWindow(win.id);
                    }}
                    className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                    title="Delete aperture"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
