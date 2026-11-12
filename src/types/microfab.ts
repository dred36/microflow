/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type ProcessStepType = 
  | 'substrate'
  | 'deposition'
  | 'lithography'
  | 'etch'
  | 'strip'
  | 'liftoff'
  | 'cmp'
  | 'anneal';

export type PatternType = 
  | 'solid'
  | 'diagonal-right'
  | 'diagonal-left'
  | 'crosshatch'
  | 'dots'
  | 'horizontal'
  | 'vertical'
  | 'stipple';

export type MaterialCategory = 
  | 'substrate'
  | 'dielectric'
  | 'metal'
  | 'semiconductor'
  | 'photoresist'
  | 'polymer'
  | 'custom';

export interface Material {
  id: string;
  name: string;
  formula: string;
  color: string;
  strokeColor?: string;
  pattern: PatternType;
  category: MaterialCategory;
  density?: number; // g/cm³
  refractiveIndex?: number;
  notes?: string;
  isCustom?: boolean;
}

export interface MaskWindow {
  id: string;
  xStart: number; // in nm
  xEnd: number;   // in nm
}

export interface DepositionConfig {
  depositionType: 'conformal' | 'directional' | 'semi-conformal' | 'spin-coat';
  method: 'PECVD' | 'LPCVD' | 'ALD' | 'Sputter' | 'E-Beam Evaporation' | 'Thermal Oxidation' | 'Spin Coat' | 'Electroplating';
  thickness: number; // nm
  stepCoverage?: number; // 0 - 100%
}

export interface LithographyConfig {
  resistMaterialId: string;
  resistThickness: number; // nm
  polarity: 'positive' | 'negative';
  windows: MaskWindow[];
  sidewallAngle: number; // degrees (e.g. 90 = vertical, >90 = retrograde/undercut for liftoff, <90 = tapered)
  exposureMethod: 'UV Contact (365nm)' | 'DUV Stepper (248nm)' | 'E-Beam Litho' | 'Direct Write Laser';
  maskName?: string;
  maskId?: string; // Linked PhotomaskLevel id
}

export interface PhotomaskLevel {
  id: string;
  levelNumber?: number; // 1, 2, 3...
  name: string; // e.g. "MASK 01: GATE"
  layerCode?: string; // e.g. "GATE-01", "VIA-01", "MET-01"
  description?: string; // e.g. "Defines gate line features"
  polarity: 'positive' | 'negative';
  color?: string; // Reticle accent color for UI tracking
  windows: MaskWindow[];
  assignedStepId?: string; // ID of assigned photolithography step
}

export interface EtchConfig {
  etchType: 'rie' | 'drie-bosch' | 'wet-isotropic' | 'wet-koh' | 'ion-beam' | 'ashing';
  depth: number; // nm
  targetMaterialId: string | 'all';
  isotropy: number; // 0 = perfectly anisotropic (vertical), 1 = fully isotropic (circular undercut)
  sidewallAngle: number; // degrees, 50 to 90
  stopLayerMaterialId?: string; // stops etch when reaching this material
  scallopEffect?: boolean; // Bosch DRIE sidewall scallops
  selectivityToMask?: number; // e.g. 20 (mask etches 20x slower)
}

export interface StripConfig {
  stripType: 'resist-strip' | 'metal-liftoff' | 'sacrificial-release';
  solvent: string;
  targetMaterialId?: string; // for sacrificial release
}

export interface CmpConfig {
  mode: 'polish-depth' | 'stop-on-layer' | 'target-height';
  depth?: number; // nm removed
  targetHeight?: number; // absolute height to level down to
  stopMaterialId?: string;
}

export interface ToolRecipe {
  toolName: string;
  gases: string;
  power: string;
  pressure: string;
  temperature: string;
  duration: string;
  targetRate?: string;
  inspectionNotes?: string;
}

export interface ProcessBlock {
  id: string;
  name: string; // e.g. "Module 1: Gate Dielectric & Poly Stack"
  description?: string;
  color?: string; // hex color for block visual distinction
  collapsed?: boolean;
}

export interface ProcessStep {
  id: string;
  title: string;
  type: ProcessStepType;
  enabled: boolean;
  notes?: string;
  materialId?: string;
  thickness?: number; // in nm
  blockId?: string; // ID of the fabrication block this step belongs to
  
  // Specific configurations
  deposition?: DepositionConfig;
  lithography?: LithographyConfig;
  etch?: EtchConfig;
  strip?: StripConfig;
  cmp?: CmpConfig;
  toolRecipe?: ToolRecipe;
}

export interface SubstrateLayer {
  id: string;
  name?: string; // e.g. "Silicon Bulk", "Buried Oxide", "Device Layer"
  materialId: string;
  thickness: number; // in nm
}

export interface ProcessFlow {
  id: string;
  title: string;
  description: string;
  substrateWidth: number; // in nm (e.g. 10000 nm = 10 µm)
  substrateThickness?: number; // legacy fallback in nm
  substrateMaterialId?: string; // legacy fallback
  substrateLayers: SubstrateLayer[]; // multi-layer starting substrate
  steps: ProcessStep[];
  materials: Material[];
  masks?: PhotomaskLevel[]; // Central mask set library
  blocks?: ProcessBlock[]; // Fabrication blocks / modules hierarchy
}

/**
 * 2D Cross Section representation
 * Each vertical column at X coordinate contains an array of segments:
 * [yBottom, yTop, materialId, stepId]
 */
export interface MaterialSegment {
  yBottom: number; // nm
  yTop: number;    // nm
  materialId: string;
  stepId?: string;
  isOverhang?: boolean;
}

export interface ColumnProfile {
  x: number; // nm
  segments: MaterialSegment[];
}

export interface CrossSectionMesh {
  width: number; // nm
  minY: number;  // nm
  maxY: number;  // nm
  columns: ColumnProfile[];
  stepSummaries: {
    stepId: string;
    stepIndex: number;
    title: string;
  }[];
}

export interface RenderedPolygon {
  id: string;
  materialId: string;
  stepId?: string;
  points: { x: number; y: number }[];
  pathData: string;
  yMin: number;
  yMax: number;
  xMin: number;
  xMax: number;
}
