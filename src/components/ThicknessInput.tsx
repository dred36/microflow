/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { ThicknessUnit, fromNm, toNm, formatCleanDecimal } from '../lib/units';

interface ThicknessInputProps {
  valueNm: number;
  onChangeNm: (nm: number) => void;
  unit: ThicknessUnit;
  minNm?: number;
  maxNm?: number;
  stepNm?: number;
  className?: string;
}

export const ThicknessInput: React.FC<ThicknessInputProps> = ({
  valueNm,
  onChangeNm,
  unit,
  minNm = 0,
  maxNm,
  stepNm = 25,
  className = '',
}) => {
  const formatForInput = (nm: number, u: ThicknessUnit): string => {
    const val = fromNm(nm, u);
    return formatCleanDecimal(val, u === 'um' ? 4 : 2);
  };

  const [isFocused, setIsFocused] = useState(false);
  const [draft, setDraft] = useState<string>(() => formatForInput(valueNm, unit));

  useEffect(() => {
    if (!isFocused) {
      setDraft(formatForInput(valueNm, unit));
    }
  }, [valueNm, unit, isFocused]);

  const minDisplay = unit === 'um' ? minNm / 1000 : minNm;
  const maxDisplay = maxNm !== undefined ? (unit === 'um' ? maxNm / 1000 : maxNm) : undefined;
  const stepDisplay = unit === 'um' ? Math.max(0.001, stepNm / 1000) : stepNm;

  const clampNm = (nm: number): number => {
    let clamped = Math.max(minNm, nm);
    if (maxNm !== undefined) {
      clamped = Math.min(maxNm, clamped);
    }
    return clamped;
  };

  return (
    <input
      type="number"
      min={minDisplay}
      max={maxDisplay}
      step={stepDisplay}
      value={draft}
      onFocus={() => {
        setIsFocused(true);
        setDraft(formatForInput(valueNm, unit));
      }}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        const parsed = parseFloat(raw);
        if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
          onChangeNm(clampNm(toNm(parsed, unit)));
        }
      }}
      onBlur={() => {
        setIsFocused(false);
        const parsed = parseFloat(draft);
        if (Number.isNaN(parsed) || !Number.isFinite(parsed)) {
          setDraft(formatForInput(valueNm, unit));
        } else {
          const clamped = clampNm(toNm(parsed, unit));
          onChangeNm(clamped);
          setDraft(formatForInput(clamped, unit));
        }
      }}
      className={className}
    />
  );
};
