/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Material } from '../types/microfab';

interface SvgPatternsProps {
  materials: Material[];
}

export const SvgPatterns: React.FC<SvgPatternsProps> = ({ materials }) => {
  return (
    <defs>
      {/* Universal Hatch Patterns */}
      <pattern
        id="pattern-diagonal-right"
        width="10"
        height="10"
        patternTransform="rotate(45 0 0)"
        patternUnits="userSpaceOnUse"
      >
        <line x1="0" y1="0" x2="0" y2="10" stroke="#000" strokeWidth="1.2" strokeOpacity="0.25" />
      </pattern>

      <pattern
        id="pattern-diagonal-left"
        width="10"
        height="10"
        patternTransform="rotate(-45 0 0)"
        patternUnits="userSpaceOnUse"
      >
        <line x1="0" y1="0" x2="0" y2="10" stroke="#000" strokeWidth="1.2" strokeOpacity="0.25" />
      </pattern>

      <pattern
        id="pattern-crosshatch"
        width="12"
        height="12"
        patternUnits="userSpaceOnUse"
      >
        <path
          d="M 0 0 L 12 12 M 12 0 L 0 12"
          stroke="#000"
          strokeWidth="1"
          strokeOpacity="0.25"
        />
      </pattern>

      <pattern
        id="pattern-dots"
        width="10"
        height="10"
        patternUnits="userSpaceOnUse"
      >
        <circle cx="5" cy="5" r="1.5" fill="#000" fillOpacity="0.28" />
      </pattern>

      <pattern
        id="pattern-horizontal"
        width="8"
        height="6"
        patternUnits="userSpaceOnUse"
      >
        <line x1="0" y1="3" x2="8" y2="3" stroke="#000" strokeWidth="1" strokeOpacity="0.25" />
      </pattern>

      <pattern
        id="pattern-vertical"
        width="6"
        height="8"
        patternUnits="userSpaceOnUse"
      >
        <line x1="3" y1="0" x2="3" y2="8" stroke="#000" strokeWidth="1" strokeOpacity="0.25" />
      </pattern>

      <pattern
        id="pattern-stipple"
        width="14"
        height="14"
        patternUnits="userSpaceOnUse"
      >
        <circle cx="2" cy="2" r="1" fill="#000" fillOpacity="0.3" />
        <circle cx="9" cy="7" r="1" fill="#000" fillOpacity="0.3" />
        <circle cx="4" cy="11" r="1" fill="#000" fillOpacity="0.3" />
      </pattern>

      {/* Material Specific Composite Patterns (Base color + Hatch) */}
      {materials.map((mat) => {
        const patternId = `mat-fill-${mat.id}`;
        return (
          <pattern
            key={mat.id}
            id={patternId}
            width="12"
            height="12"
            patternUnits="userSpaceOnUse"
          >
            {/* Background color */}
            <rect width="12" height="12" fill={mat.color} />
            
            {/* Pattern overlay */}
            {mat.pattern === 'diagonal-right' && (
              <line x1="0" y1="0" x2="12" y2="12" stroke="#000" strokeWidth="1.2" strokeOpacity="0.2" />
            )}
            {mat.pattern === 'diagonal-left' && (
              <line x1="12" y1="0" x2="0" y2="12" stroke="#000" strokeWidth="1.2" strokeOpacity="0.2" />
            )}
            {mat.pattern === 'crosshatch' && (
              <path d="M 0 0 L 12 12 M 12 0 L 0 12" stroke="#000" strokeWidth="1" strokeOpacity="0.22" />
            )}
            {mat.pattern === 'dots' && (
              <circle cx="6" cy="6" r="1.5" fill="#000" fillOpacity="0.25" />
            )}
            {mat.pattern === 'horizontal' && (
              <line x1="0" y1="6" x2="12" y2="6" stroke="#000" strokeWidth="1" strokeOpacity="0.2" />
            )}
            {mat.pattern === 'vertical' && (
              <line x1="6" y1="0" x2="6" y2="12" stroke="#000" strokeWidth="1" strokeOpacity="0.2" />
            )}
            {mat.pattern === 'stipple' && (
              <>
                <circle cx="3" cy="3" r="1" fill="#000" fillOpacity="0.25" />
                <circle cx="9" cy="9" r="1" fill="#000" fillOpacity="0.25" />
              </>
            )}
          </pattern>
        );
      })}

      {/* Markers for dimension callouts */}
      <marker
        id="arrow-start"
        markerWidth="8"
        markerHeight="8"
        refX="4"
        refY="4"
        orient="auto"
      >
        <path d="M 7 1 L 1 4 L 7 7 Z" fill="#475569" />
      </marker>

      <marker
        id="arrow-end"
        markerWidth="8"
        markerHeight="8"
        refX="4"
        refY="4"
        orient="auto"
      >
        <path d="M 1 1 L 7 4 L 1 7 Z" fill="#475569" />
      </marker>
    </defs>
  );
};
