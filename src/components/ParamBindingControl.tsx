/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { DesignVariable, VariableUnit } from '../types/microfab';
import {
  evaluateParamExpression,
  formatVariableValue,
  fromCanonicalValue,
  resolveVariables,
  suggestVariableName,
} from '../lib/variableUtils';
import { ThicknessUnit, formatThickness } from '../lib/units';
import { ThicknessInput } from './ThicknessInput';
import { Check, Plus, Unlink, Variable as VariableIcon, X } from 'lucide-react';

interface ParamBindingPopoverProps {
  expression?: string;
  variables: DesignVariable[];
  waferWidth: number;
  currentValue: number; // canonical nm for lengths, raw for deg/sec/none
  unit: VariableUnit;
  suggestedVarName?: string;
  targetLabel?: string;
  onChangeExpression: (expr: string | undefined) => void;
  onCreateVariable?: (name: string, value: number, unit: VariableUnit, description?: string) => void;
  onCreateAndBind?: (name: string, value: number, unit: VariableUnit, description?: string) => void;
  onOpenVariablesModal?: () => void;
  onClose: () => void;
}

export const ParamBindingPanel: React.FC<ParamBindingPopoverProps> = ({
  expression,
  variables,
  waferWidth,
  currentValue,
  unit,
  suggestedVarName = 'param',
  targetLabel,
  onChangeExpression,
  onCreateVariable,
  onCreateAndBind,
  onOpenVariablesModal,
  onClose,
}) => {
  const [draft, setDraft] = useState<string>(expression || '');

  useEffect(() => {
    setDraft(expression || '');
  }, [expression]);

  const { scope } = useMemo(
    () => resolveVariables(variables, waferWidth),
    [variables, waferWidth]
  );

  const preview = useMemo(() => {
    if (!draft.trim()) return null;
    return evaluateParamExpression(draft, scope);
  }, [draft, scope]);

  const handleApply = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      onChangeExpression(undefined);
      onClose();
      return;
    }
    const check = evaluateParamExpression(trimmed, scope);
    if (check.ok) {
      onChangeExpression(trimmed);
      onClose();
    }
  };

  const handleExtractVariable = () => {
    const varName = suggestVariableName(suggestedVarName, variables);
    const displayVal = Math.round(fromCanonicalValue(currentValue, unit) * 10000) / 10000;
    if (onCreateAndBind) {
      onCreateAndBind(varName, displayVal, unit, targetLabel);
      onClose();
      return;
    }
    if (!onCreateVariable) return;
    onCreateVariable(varName, displayVal, unit, targetLabel);
    onChangeExpression(varName);
    onClose();
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="mt-1 p-1.5 rounded-md bg-slate-950/95 border border-violet-500/45 shadow-xl space-y-1.5 text-[10.5px]"
    >
      <div className="flex items-center justify-between gap-1.5">
        <span className="text-[9.5px] font-semibold uppercase tracking-wider text-violet-300 flex items-center gap-1 truncate">
          <VariableIcon className="w-3 h-3 text-violet-400 shrink-0" />
          <span className="truncate">{targetLabel ? `Bind ${targetLabel}` : 'Parametric Formula'}</span>
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {expression && (
            <button
              type="button"
              onClick={() => {
                onChangeExpression(undefined);
                onClose();
              }}
              className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 text-[9.5px]"
              title="Unbind and keep current value as fixed number"
            >
              <Unlink className="w-2.5 h-2.5" />
              <span>Unbind</span>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="p-0.5 rounded text-slate-400 hover:text-white hover:bg-slate-800"
            title="Close formula editor"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Expression Input */}
      <div className="flex items-center gap-1">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleApply();
            } else if (e.key === 'Escape') {
              onClose();
            }
          }}
          placeholder="e.g. gate_cd * 2 + 50nm"
          autoFocus
          className="flex-1 min-w-0 px-2 py-0.5 rounded bg-slate-900 border border-slate-700 focus:border-violet-500 text-violet-200 font-mono text-[11px] focus:outline-none"
        />
        <button
          type="button"
          disabled={!draft.trim() || !preview?.ok}
          onClick={handleApply}
          className="px-2 py-0.5 rounded bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white font-semibold text-[10px] flex items-center gap-0.5 shrink-0"
          title="Apply formula"
        >
          <Check className="w-3 h-3" />
          <span>Bind</span>
        </button>
      </div>

      {/* Live Preview / Error */}
      {draft.trim() && preview && (
        <div
          className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
            preview.ok
              ? 'bg-emerald-950/50 text-emerald-300 border border-emerald-500/25'
              : 'bg-rose-950/50 text-rose-300 border border-rose-500/25'
          }`}
        >
          {preview.ok
            ? `= ${
                unit === 'nm' || unit === 'um'
                  ? `${Math.round(preview.value * 100) / 100} nm (${(preview.value / 1000).toFixed(3)} µm)`
                  : formatVariableValue(preview.value, unit)
              }`
            : preview.error}
        </div>
      )}

      {/* Existing Variables Quick Chips */}
      <div className="flex flex-wrap items-center gap-1">
        {variables.map((v) => {
          const valLabel = formatVariableValue(v.value, v.unit);
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => {
                if (!draft.trim()) {
                  onChangeExpression(v.name);
                  onClose();
                } else {
                  setDraft((prev) => {
                    const needsSpace = prev.length > 0 && !/[\s+\-*/^(,]$/.test(prev);
                    return `${prev}${needsSpace ? ' + ' : ''}${v.name}`;
                  });
                }
              }}
              className="px-1.5 py-0.5 rounded bg-slate-900 hover:bg-violet-600/25 text-slate-200 hover:text-violet-200 border border-slate-700 hover:border-violet-500/50 font-mono text-[10px] transition-colors"
              title={`${v.name} = ${valLabel}${v.description ? ` · ${v.description}` : ''}`}
            >
              {v.name}
              <span className="text-slate-500 ml-1">{valLabel}</span>
            </button>
          );
        })}

        {(onCreateAndBind || onCreateVariable) && (
          <button
            type="button"
            onClick={handleExtractVariable}
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-violet-500/15 hover:bg-violet-500/25 text-violet-300 border border-violet-500/40 text-[10px] font-medium transition-colors"
            title="Create a new design variable from the current value and bind this field to it"
          >
            <Plus className="w-2.5 h-2.5" />
            <span>New Var</span>
          </button>
        )}

        {onOpenVariablesModal && (
          <button
            type="button"
            onClick={onOpenVariablesModal}
            className="ml-auto text-[10px] text-sky-400 hover:underline px-1"
          >
            Manage…
          </button>
        )}
      </div>
    </div>
  );
};

interface ParamBindingBadgeProps {
  expression?: string;
  isOpen: boolean;
  onToggle: () => void;
  compact?: boolean;
}

export const ParamBindingBadge: React.FC<ParamBindingBadgeProps> = ({
  expression,
  isOpen,
  onToggle,
  compact = false,
}) => {
  const isBound = Boolean(expression && expression.trim());
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={`inline-flex items-center gap-0.5 rounded border font-mono transition-colors shrink-0 ${
        compact ? 'px-1 py-0.5 text-[9.5px]' : 'px-1.5 py-1 text-[10px]'
      } ${
        isBound
          ? 'bg-violet-500/20 border-violet-500/60 text-violet-200 hover:bg-violet-500/30'
          : isOpen
          ? 'bg-violet-600/20 border-violet-500/50 text-violet-300'
          : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-violet-300 hover:border-violet-500/40'
      }`}
      title={
        isBound
          ? `Parametric binding: ${expression} (click to edit or unbind)`
          : 'Bind this geometry parameter to a variable or formula'
      }
    >
      <span className="italic font-bold">fx</span>
      {isBound && !compact && (
        <span className="max-w-[72px] truncate">{expression}</span>
      )}
    </button>
  );
};

interface ParametricThicknessInputProps {
  valueNm: number;
  onChangeNm: (nm: number) => void;
  unit: ThicknessUnit;
  minNm?: number;
  maxNm?: number;
  stepNm?: number;
  className?: string;
  expression?: string;
  variables?: DesignVariable[];
  waferWidth?: number;
  suggestedVarName?: string;
  targetLabel?: string;
  onChangeExpression?: (expr: string | undefined) => void;
  onCreateVariable?: (name: string, value: number, unit: VariableUnit, description?: string) => void;
  onCreateAndBind?: (name: string, value: number, unit: VariableUnit, description?: string) => void;
  onOpenVariablesModal?: () => void;
}

export const ParametricThicknessInput: React.FC<ParametricThicknessInputProps> = ({
  valueNm,
  onChangeNm,
  unit,
  minNm = 0,
  maxNm,
  stepNm = 25,
  className = '',
  expression,
  variables = [],
  waferWidth = 10000,
  suggestedVarName = 'thickness',
  targetLabel,
  onChangeExpression,
  onCreateVariable,
  onCreateAndBind,
  onOpenVariablesModal,
}) => {
  const [open, setOpen] = useState(false);
  const isBound = Boolean(expression && expression.trim());

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        {isBound ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex-1 min-w-0 flex items-center justify-between gap-1.5 px-2 py-1 rounded-md bg-violet-950/35 border border-violet-500/50 text-left font-mono text-[11px] text-violet-200 hover:border-violet-400 transition-colors tabular-nums"
            title={`Bound to: ${expression} = ${formatThickness(valueNm, unit)}`}
          >
            <span className="truncate font-semibold">{formatThickness(valueNm, unit)}</span>
            <span className="text-[9.5px] text-violet-300/90 truncate max-w-[80px]">
              ={expression}
            </span>
          </button>
        ) : (
          <ThicknessInput
            valueNm={valueNm}
            onChangeNm={onChangeNm}
            unit={unit}
            minNm={minNm}
            maxNm={maxNm}
            stepNm={stepNm}
            className={className}
          />
        )}
        {onChangeExpression && (
          <ParamBindingBadge
            expression={expression}
            isOpen={open}
            onToggle={() => setOpen((v) => !v)}
            compact
          />
        )}
      </div>

      {open && onChangeExpression && (
        <ParamBindingPanel
          expression={expression}
          variables={variables}
          waferWidth={waferWidth}
          currentValue={valueNm}
          unit={unit === 'um' ? 'um' : 'nm'}
          suggestedVarName={suggestedVarName}
          targetLabel={targetLabel}
          onChangeExpression={onChangeExpression}
          onCreateVariable={onCreateVariable}
          onCreateAndBind={onCreateAndBind}
          onOpenVariablesModal={onOpenVariablesModal}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
};
