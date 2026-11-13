/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { ProcessFlow } from '../types/microfab';
import { ThicknessUnit, formatThickness } from '../lib/units';
import { X, Copy, Check, Printer, FileText } from 'lucide-react';

interface RunSheetModalProps {
  flow: ProcessFlow;
  thicknessUnit?: ThicknessUnit;
  onClose: () => void;
}

export const RunSheetModal: React.FC<RunSheetModalProps> = ({
  flow,
  thicknessUnit = 'nm',
  onClose,
}) => {
  const [copied, setCopied] = useState<boolean>(false);

  const generateMarkdown = () => {
    const subLayers = flow.substrateLayers || [
      {
        id: 'sub_default',
        name: 'Bulk Silicon <100>',
        materialId: flow.substrateMaterialId || 'mat_si_sub',
        thickness: flow.substrateThickness || 3000,
      },
    ];
    const totalSubThick = subLayers.reduce((acc, l) => acc + (l.thickness || 0), 0);
    const subDesc = subLayers
      .map((l) => `${l.name || l.materialId} (${formatThickness(l.thickness, thicknessUnit)})`)
      .join(' / ');

    let md = `# Cleanroom Process Traveller: ${flow.title}\n\n`;
    md += `**Description**: ${flow.description}\n`;
    md += `**Starting Substrate**: ${subDesc} · Total: ${formatThickness(totalSubThick, thicknessUnit)} · Width: ${(flow.substrateWidth / 1000).toFixed(1)} µm\n\n`;
    md += `| Step | Process Operation | Tool / Equipment | Recipe & Parameters | Target / Metrology |\n`;
    md += `|---|---|---|---|---|\n`;
    md += `| 0 | Starting Substrate Stack | Substrate Preparation | Multi-layer stack: ${subDesc} | Cleanliness & layer thickness verification |\n`;

    flow.steps.forEach((step, idx) => {
      const r = step.toolRecipe;
      const params = [
        r?.temperature ? `Temp: ${r.temperature}` : null,
        r?.gases ? `Gases: ${r.gases}` : null,
        r?.pressure ? `Pressure: ${r.pressure}` : null,
        r?.power ? `Power: ${r.power}` : null,
        r?.duration ? `Time: ${r.duration}` : null,
      ]
        .filter(Boolean)
        .join(', ');

      const sideLabel =
        step.side === 'back' ? 'Backside' : step.side === 'both' ? 'Both Sides' : 'Frontside';
      md += `| ${idx + 1} | ${step.title} (${sideLabel}) | ${r?.toolName || 'Standard Cleanroom Bench'} | ${params || 'Standard Recipe'} | ${r?.inspectionNotes || step.notes || 'Visual microscope inspection'} |\n`;
    });

    return md;
  };

  const handleCopyMarkdown = () => {
    navigator.clipboard.writeText(generateMarkdown());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePrint = () => {
    window.print();
  };

  const subLayers = flow.substrateLayers || [
    {
      id: 'sub_default',
      name: 'Bulk Silicon <100>',
      materialId: flow.substrateMaterialId || 'mat_si_sub',
      thickness: flow.substrateThickness || 3000,
    },
  ];
  const totalSubThickness = subLayers.reduce((acc, l) => acc + (l.thickness || 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-5xl max-h-[90vh] bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl flex flex-col text-slate-200 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900">
          <div className="flex items-center gap-3">
            <FileText className="w-5 h-5 text-sky-400" />
            <div>
              <h2 className="text-base font-bold text-white">
                Cleanroom Traveller & SOP Run-Card
              </h2>
              <p className="text-xs text-slate-400">
                Printable fabrication traveller sheet for cleanroom processing & metrology checkpoints
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyMarkdown}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium transition-colors"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Copied Markdown!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-slate-400" />
                  <span>Copy Markdown</span>
                </>
              )}
            </button>

            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold shadow-md transition-colors"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print Traveller</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Printable Run Card Sheet */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-950/50 space-y-4 font-sans text-xs">
          {/* Metadata Card */}
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 grid grid-cols-3 gap-4">
            <div>
              <span className="text-[11px] text-slate-400 block">Process Title</span>
              <span className="font-semibold text-white text-sm">{flow.title}</span>
            </div>
            <div>
              <span className="text-[11px] text-slate-400 block">Starting Substrate Stack</span>
              <span className="font-mono text-emerald-400 font-semibold block">
                {subLayers.length} {subLayers.length === 1 ? 'Layer' : 'Layers'} · {formatThickness(totalSubThickness, thicknessUnit)}
              </span>
              <span className="text-[10px] text-slate-400 font-mono truncate block">
                {subLayers.map((l) => l.name || l.materialId).join(' / ')}
              </span>
            </div>
            <div>
              <span className="text-[11px] text-slate-400 block">Total Operations</span>
              <span className="font-mono text-sky-400">
                Substrate + {flow.steps.length} fabrication steps
              </span>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-900/90 border-b border-slate-800 text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
                  <th className="py-2.5 px-3 w-12 text-center">#</th>
                  <th className="py-2.5 px-3">Process Operation</th>
                  <th className="py-2.5 px-3">Equipment / Tool</th>
                  <th className="py-2.5 px-3">Recipe & Parameter Specs</th>
                  <th className="py-2.5 px-3">Metrology & Quality Target</th>
                  <th className="py-2.5 px-3 w-20 text-center">Sign-off</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {flow.steps.map((step, idx) => {
                  const r = step.toolRecipe;
                  return (
                    <tr
                      key={step.id}
                      className="hover:bg-slate-900/40 transition-colors"
                    >
                      <td className="py-3 px-3 text-center font-mono font-semibold text-sky-400">
                        {idx + 1}
                      </td>
                      <td className="py-3 px-3">
                        <div className="font-semibold text-slate-100">{step.title}</div>
                        <div className="text-[10px] text-slate-400 uppercase tracking-wide flex items-center gap-1.5 flex-wrap">
                          <span>
                            {step.type === 'cmp'
                              ? 'Grind/Polish/Planarize'
                              : step.type === 'bonding'
                              ? 'Wafer Bonding'
                              : step.type}
                          </span>
                          <span>·</span>
                          <span
                            className={
                              step.side === 'back'
                                ? 'text-amber-400 font-semibold'
                                : step.side === 'both'
                                ? 'text-emerald-400 font-semibold'
                                : 'text-slate-400'
                            }
                          >
                            {step.side === 'back'
                              ? 'Backside'
                              : step.side === 'both'
                              ? 'Both Sides'
                              : 'Frontside'}
                          </span>
                          {step.blockId && (() => {
                            const blk = flow.blocks?.find((b) => b.id === step.blockId);
                            return blk ? (
                              <>
                                <span>·</span>
                                <span className="text-sky-400/90 font-medium">{blk.name}</span>
                              </>
                            ) : null;
                          })()}
                          {step.type === 'lithography' && step.lithography?.maskName && (
                            <>
                              <span>·</span>
                              <span className="text-amber-400/90 font-medium">Reticle: {step.lithography.maskName}</span>
                            </>
                          )}
                          {step.type === 'bonding' && step.bonding && (
                            <>
                              <span>·</span>
                              <span className="text-indigo-400/90 font-medium">
                                {step.bonding.sourceType === 'imported-flow'
                                  ? step.bonding.importedFlowTitle || step.bonding.importedFlow?.title || 'Imported Flow'
                                  : 'Custom Substrate'}
                              </span>
                            </>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-3 font-mono text-slate-300">
                        {r?.toolName || 'Cleanroom Station'}
                      </td>
                      <td className="py-3 px-3">
                        <div className="space-y-0.5 font-mono text-[11px] text-slate-300">
                          {r?.gases && <div>Gases: {r.gases}</div>}
                          {r?.temperature && <div>Temp: {r.temperature}</div>}
                          {r?.power && <div>Power: {r.power}</div>}
                          {r?.pressure && <div>Pressure: {r.pressure}</div>}
                          {r?.duration && <div>Duration: {r.duration}</div>}
                          {!r?.gases && !r?.duration && (
                            <span className="text-slate-500">Standard cleanroom recipe</span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <div className="text-slate-300">
                          {r?.inspectionNotes || step.notes || 'Optical microscope check'}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-center">
                        <div className="w-12 h-6 border border-slate-700 rounded bg-slate-950/60 mx-auto" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
