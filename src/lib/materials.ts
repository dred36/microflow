/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Material } from '../types/microfab';

export const DEFAULT_MATERIALS: Material[] = [
  // Substrates & Base Semiconductors
  {
    id: 'mat_si_sub',
    name: 'Silicon Substrate',
    formula: 'Si <100>',
    color: '#64748b', // Slate 500
    strokeColor: '#334155',
    pattern: 'diagonal-right',
    category: 'substrate',
    density: 2.33,
    refractiveIndex: 3.88,
    notes: 'Single-crystal Czochralski silicon wafer, p-type boron doped',
  },
  {
    id: 'mat_si_n',
    name: 'Silicon (n-type)',
    formula: 'Si:P',
    color: '#475569',
    strokeColor: '#1e293b',
    pattern: 'diagonal-left',
    category: 'semiconductor',
    density: 2.33,
    refractiveIndex: 3.88,
    notes: 'Phosphorus doped n-type silicon region / well',
  },
  {
    id: 'mat_poly_si',
    name: 'Polysilicon',
    formula: 'poly-Si',
    color: '#f97316', // Orange 500
    strokeColor: '#c2410c',
    pattern: 'crosshatch',
    category: 'semiconductor',
    density: 2.32,
    refractiveIndex: 3.9,
    notes: 'LPCVD polycrystalline silicon gate material / structural MEMS layer',
  },
  {
    id: 'mat_quartz',
    name: 'Quartz / Fused Silica',
    formula: 'SiO₂ (bulk)',
    color: '#e0f2fe',
    strokeColor: '#7dd3fc',
    pattern: 'dots',
    category: 'substrate',
    density: 2.2,
    refractiveIndex: 1.46,
    notes: 'Optically transparent amorphous quartz substrate',
  },
  
  // Dielectrics & Oxides
  {
    id: 'mat_sio2_thermal',
    name: 'Thermal Silicon Dioxide',
    formula: 'SiO₂ (Thermal)',
    color: '#38bdf8', // Sky 400
    strokeColor: '#0284c7',
    pattern: 'solid',
    category: 'dielectric',
    density: 2.27,
    refractiveIndex: 1.46,
    notes: 'Dry or wet furnace thermal oxide, high quality gate or isolation dielectric',
  },
  {
    id: 'mat_sio2_pecvd',
    name: 'PECVD Silicon Dioxide',
    formula: 'SiO₂ (PECVD)',
    color: '#7dd3fc', // Sky 300
    strokeColor: '#0369a1',
    pattern: 'horizontal',
    category: 'dielectric',
    density: 2.15,
    refractiveIndex: 1.47,
    notes: 'Low-temperature plasma-enhanced chemical vapor deposition oxide',
  },
  {
    id: 'mat_si3n4',
    name: 'Silicon Nitride',
    formula: 'Si₃N₄',
    color: '#14b8a6', // Teal 500
    strokeColor: '#0f766e',
    pattern: 'diagonal-right',
    category: 'dielectric',
    density: 3.1,
    refractiveIndex: 2.01,
    notes: 'LPCVD low-stress silicon nitride, excellent etch stop and passivation barrier',
  },
  {
    id: 'mat_al2o3',
    name: 'Aluminum Oxide (ALD)',
    formula: 'Al₂O₃',
    color: '#a855f7', // Purple 500
    strokeColor: '#7e22ce',
    pattern: 'dots',
    category: 'dielectric',
    density: 3.95,
    refractiveIndex: 1.76,
    notes: 'Atomic Layer Deposition high-k gate dielectric or hermetic sealing layer',
  },
  {
    id: 'mat_hafnium',
    name: 'Hafnium Oxide',
    formula: 'HfO₂',
    color: '#c084fc',
    strokeColor: '#9333ea',
    pattern: 'crosshatch',
    category: 'dielectric',
    density: 9.68,
    refractiveIndex: 2.1,
    notes: 'High-k gate dielectric for sub-45nm CMOS',
  },

  // Metals & Conductors
  {
    id: 'mat_al',
    name: 'Aluminum',
    formula: 'Al',
    color: '#94a3b8', // Slate 400
    strokeColor: '#475569',
    pattern: 'vertical',
    category: 'metal',
    density: 2.7,
    notes: 'Sputtered metal interconnect and contact pads',
  },
  {
    id: 'mat_au',
    name: 'Gold',
    formula: 'Au',
    color: '#eab308', // Yellow 500
    strokeColor: '#a16207',
    pattern: 'solid',
    category: 'metal',
    density: 19.3,
    notes: 'E-beam evaporated wire-bond pads, electrodes, and plasmonic structures',
  },
  {
    id: 'mat_cr',
    name: 'Chromium',
    formula: 'Cr',
    color: '#64748b',
    strokeColor: '#334155',
    pattern: 'crosshatch',
    category: 'metal',
    density: 7.19,
    notes: 'Hard mask material and adhesion layer for gold',
  },
  {
    id: 'mat_ti',
    name: 'Titanium',
    formula: 'Ti',
    color: '#cbd5e1',
    strokeColor: '#64748b',
    pattern: 'diagonal-left',
    category: 'metal',
    density: 4.5,
    notes: 'Adhesion promoter layer for noble metals (Au, Pt) and contact barrier',
  },
  {
    id: 'mat_cu',
    name: 'Copper',
    formula: 'Cu',
    color: '#f87171', // Red 400
    strokeColor: '#dc2626',
    pattern: 'solid',
    category: 'metal',
    density: 8.96,
    notes: 'Damascene electroplated interconnect metallization',
  },
  {
    id: 'mat_pt',
    name: 'Platinum',
    formula: 'Pt',
    color: '#e2e8f0',
    strokeColor: '#94a3b8',
    pattern: 'stipple',
    category: 'metal',
    density: 21.45,
    notes: 'Inert electrode for electrochemical and bio-MEMS sensors',
  },

  // Polymers & Photoresists
  {
    id: 'mat_pr_pos',
    name: 'Positive Photoresist',
    formula: 'AZ1518 / SPR',
    color: '#f43f5e', // Rose 500
    strokeColor: '#be123c',
    pattern: 'diagonal-right',
    category: 'photoresist',
    density: 1.2,
    refractiveIndex: 1.62,
    notes: 'Diazoquinone (DNQ) positive tone resist; UV exposed areas dissolve in developer',
  },
  {
    id: 'mat_pr_su8',
    name: 'SU-8 Negative Resist',
    formula: 'SU-8 Epoxy',
    color: '#d97706', // Amber 600
    strokeColor: '#b45309',
    pattern: 'crosshatch',
    category: 'polymer',
    density: 1.19,
    refractiveIndex: 1.67,
    notes: 'High-aspect-ratio negative epoxy photoresist for microfluidics and MEMS molds',
  },
  {
    id: 'mat_pdms',
    name: 'PDMS Silicone',
    formula: '(C₂H₆OSi)ₙ',
    color: '#bae6fd',
    strokeColor: '#38bdf8',
    pattern: 'dots',
    category: 'polymer',
    density: 0.965,
    refractiveIndex: 1.41,
    notes: 'Polydimethylsiloxane elastomer for microfluidic channels and soft lithography',
  },
];

export function getMaterialById(materials: Material[], id: string): Material {
  const found = materials.find((m) => m.id === id);
  if (found) return found;
  const def = DEFAULT_MATERIALS.find((m) => m.id === id);
  if (def) return def;
  return {
    id,
    name: 'Unknown Material',
    formula: '?',
    color: '#94a3b8',
    pattern: 'solid',
    category: 'custom',
  };
}
