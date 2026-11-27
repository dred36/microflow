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
  | 'anneal'
  | 'bonding'
  | 'dicing'
  | 'tape-frame';

export type ProcessSide = 'front' | 'back' | 'both';

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
  crystallineAnisotropic?: boolean; // Etches along crystal planes (e.g. {111} 54.74°) in KOH / TMAH
}

export interface MaskWindow {
  id: string;
  xStart: number; // in nm
  xEnd: number;   // in nm
  fixedWidth?: boolean;
  isAlignKey?: boolean; // Flags this window/blocker shape as an alignment key feature
  paramBindings?: Record<string, string>;
}

export interface GlobalAlignmentMark {
  id: string;
  label: string; // e.g. "AM-1", "Left Key"
  xNm: number;   // Global X position on substrate in nm (0..substrateWidth)
  side?: ProcessSide; // Substrate face where fiducial mark is located (default 'front')
  color?: string; // Optional accent color
  definedByStepId?: string; // Optional lithography step ID that patterns this mark
  paramBindings?: Record<string, string>;
}

export type VariableUnit = 'nm' | 'um' | 'deg' | 'sec' | 'none';

export interface DesignVariable {
  id: string;
  name: string;
  value: number;
  unit: VariableUnit;
  expression?: string;
  description?: string;
}

export interface DepositionConfig {
  depositionType: 'conformal' | 'directional' | 'semi-conformal' | 'spin-coat' | 'bottom-up' | 'dry-film';
  method:
    | 'PECVD'
    | 'LPCVD'
    | 'ALD'
    | 'Sputter'
    | 'E-Beam Evaporation'
    | 'Thermal Oxidation'
    | 'Spin Coat'
    | 'Electroplating'
    | 'Electroless Plating'
    | 'Dry Film Lamination';
  thickness: number; // nm
  stepCoverage?: number; // 0 - 100%
  tiltAngle?: number; // Substrate tilt in degrees (-75 to +75, 0 = normal incidence)
  convexCornerEffect?: boolean; // Faster deposition around convex corners (bread-loafing)
  convexCornerStrength?: number; // 0.2 - 1.5 (default 0.6 = +60% at sharp 90° convex corners)
  platingSelective?: boolean; // Grow selectively on exposed conductive / seed surfaces
  platingSeedScope?: 'conductive' | 'metal-only'; // Conductive (metals + Si) vs metal seed only
  laminationSag?: number; // 0 - 100% (0 = rigid flat tenting, >0 = vacuum/roller drape into wide features)
  planarization?: number; // 0 - 100% (100 = ideal flat planarization, <100 = viscous non-ideal spin coat)
}

export type MaskFieldPolarity = 'dark-field' | 'light-field';

export interface LithographyConfig {
  resistMaterialId: string;
  resistThickness: number; // nm
  polarity: 'positive' | 'negative';
  maskField?: MaskFieldPolarity; // 'dark-field' (blocks = apertures, default) vs 'light-field' (blocks = opaque chrome blockers)
  coatMethod?: 'spin-coat' | 'dry-film' | 'lor-bilayer'; // Spin Coat (single) vs LOR Double Coat (bilayer undercut) vs Dry Film Lamination
  laminationSag?: number; // 0 - 100% when coatMethod === 'dry-film'
  planarization?: number; // 0 - 100% when coatMethod === 'spin-coat' | 'lor-bilayer' (default 100)
  lorMaterialId?: string; // Bottom lift-off resist material when coatMethod === 'lor-bilayer' (default 'mat_pr_lor')
  lorThickness?: number; // Bottom LOR underlayer thickness in nm when coatMethod === 'lor-bilayer' (default 400)
  lorUndercut?: number; // Adjustable lateral LOR undercut beneath top resist in nm (default 350)
  windows: MaskWindow[];
  sidewallAngle: number; // degrees (e.g. 90 = vertical, >90 = retrograde/undercut for liftoff, <90 = tapered)
  exposureMethod: 'UV Contact (365nm)' | 'DUV Stepper (248nm)' | 'E-Beam Litho' | 'Direct Write Laser';
  maskName?: string;
  maskId?: string; // Linked PhotomaskLevel id
  maskColor?: string; // Reticle accent color
  definesAlignmentMarks?: boolean; // Marks this photolithography step as patterning alignment fiducials
}

export interface PhotomaskLevel {
  id: string;
  levelNumber?: number; // 1, 2, 3...
  name: string; // e.g. "MASK 01: GATE"
  layerCode?: string; // e.g. "GATE-01", "VIA-01", "MET-01"
  description?: string; // e.g. "Defines gate line features"
  polarity: 'positive' | 'negative';
  maskField?: MaskFieldPolarity; // 'dark-field' (blocks = apertures) vs 'light-field' (blocks = chrome blockers)
  color?: string; // Reticle accent color for UI tracking
  windows: MaskWindow[];
  assignedStepId?: string; // ID of assigned photolithography step
  assignedVariantId?: string; // Optional ID of assigned variant when the step is branched
  definesAlignmentMarks?: boolean; // Flags this photomask level as defining alignment key features
}

export interface EtchConfig {
  etchType: 'rie' | 'drie-bosch' | 'wet-isotropic' | 'wet-koh' | 'ion-beam' | 'ashing';
  depth: number; // nm
  targetMaterialId: string | 'all';
  isotropy: number; // 0 = perfectly anisotropic (vertical), 1 = fully isotropic (circular undercut)
  sidewallAngle: number; // degrees, 80 to 100 for RIE/DRIE (54.74 for KOH)
  stopLayerMaterialId?: string; // stops etch when reaching this material
  scallopEffect?: boolean; // Bosch DRIE sidewall scallops
  scallopDepth?: number; // Lateral scallop amplitude in nm (default 45 nm)
  scallopPitch?: number; // Vertical Bosch cycle pitch in nm (default 200 nm)
  selectivityToMask?: number; // e.g. 20 (mask etches 20x slower)
  ardeEnabled?: boolean; // Aspect Ratio Dependent Etching (RIE Lag) for dry etching
  ardeStrength?: number; // Lag factor k (0.1 = mild to 1.0 = strong, default 0.5)
  convexCornerEffect?: boolean; // Faster isotropic etching around convex corners
  convexCornerStrength?: number; // 0.2 - 1.5 (default 0.6 = +60% at sharp 90° convex corners)
  etchRecipeId?: string; // Linked recipe from Etch Rate Library
  rateMode?: 'manual' | 'time-rate'; // 'manual' = fixed depth budget; 'time-rate' = duration * material etch rates
  etchTimeSec?: number; // Etch duration in seconds when rateMode === 'time-rate'
  referenceMaterialId?: string; // Reference material used in Fixed Target Depth mode to derive equivalent etch time
}

export type EtchRateCategory =
  | 'dry-rie'
  | 'drie-vapor'
  | 'wet-chemical'
  | 'physical-ash'
  | 'custom';

export interface EtchRecipe {
  id: string;
  name: string;
  chemistry: string;
  category: EtchRateCategory;
  etchType: EtchConfig['etchType'];
  isotropy: number; // 0 - 1
  sidewallAngle: number; // degrees
  scallopEffect?: boolean;
  scallopDepth?: number;
  scallopPitch?: number;
  ardeEnabled?: boolean;
  ardeStrength?: number;
  primaryMaterialId: string;
  rates: Record<string, number>; // nm/min keyed by materialId (0 = immune / etch stop)
  defaultRateNmMin?: number; // fallback rate for materials not explicitly listed
  toolName?: string;
  gases?: string;
  power?: string;
  pressure?: string;
  temperature?: string;
  notes?: string;
  isCustom?: boolean;
}

export interface SacrificialReleaseRegion {
  id: string;
  label?: string;
  xStart: number; // nm
  xEnd: number;   // nm
  yMin?: number;  // optional nm lower Z bound (for targeting one of multiple stacked layers)
  yMax?: number;  // optional nm upper Z bound
  paramBindings?: Record<string, string>;
}

export interface StripConfig {
  stripType: 'resist-strip' | 'metal-liftoff' | 'sacrificial-release';
  solvent: string;
  targetMaterialId?: string; // for sacrificial release
  releaseScope?: 'all' | 'regions'; // 'all' (default) or 'regions'
  releaseRegions?: SacrificialReleaseRegion[];
}

export interface CmpConfig {
  operation?: 'cmp' | 'grind' | 'polish';
  mode: 'polish-depth' | 'stop-on-layer' | 'target-height';
  depth?: number; // nm removed
  targetHeight?: number; // absolute height to level down to
  stopMaterialId?: string;
  dishing?: number; // 0 - 100 (%) concave feature-scale dishing inside softer inlaid features
  erosion?: number; // 0 - 100 (%) pattern-density-dependent erosion of surrounding field/stop layers
}

export interface BondingConfig {
  sourceType: 'custom-substrate' | 'imported-flow';
  bondingMethod: 'fusion' | 'anodic' | 'adhesive' | 'eutectic' | 'hybrid';
  incomingFace?: 'front' | 'back';
  mirrorHorizontal?: boolean;
  widthMismatchMode?: 'rescale' | 'crop-pad';
  widthAlignment?: 'left' | 'center' | 'right' | 'custom';
  widthOffsetNm?: number;
  widthPaddingMode?: 'empty' | 'extend-edges';
  customLayers?: SubstrateLayer[];
  importedFlow?: ProcessFlow;
  importedFlowTitle?: string;
  interfaceLayer?: {
    enabled: boolean;
    materialId: string;
    thickness: number; // nm
  };
}

export interface DicingStreet {
  id: string;
  xCenter: number; // nm
  paramBindings?: Record<string, string>;
}

export interface DicingConfig {
  method: 'blade' | 'laser-ablation' | 'stealth' | 'plasma';
  cutMode: 'through-wafer' | 'partial-depth';
  kerfWidth: number; // nm
  cutDepth?: number; // nm (when cutMode === 'partial-depth')
  sidewallAngle?: number; // degrees (90 = vertical, <90 = V-taper)
  tapeOvercut?: number; // nm cut depth into carrier dicing tape on through-wafer cut
  streets: DicingStreet[];
}

export interface TapeFrameConfig {
  action: 'mount' | 'demount';
  tapeMaterialId: string;
  thickness: number; // nm
  conformality: 'flat' | 'conformal';
  showFrame: boolean;
}

export interface MountedTapeFrame {
  side: 'front' | 'back';
  yBottom: number;
  yTop: number;
  materialId: string;
}

export interface ToolRecipe {
  toolId?: string;
  toolName: string;
  gases: string;
  power: string;
  pressure: string;
  temperature: string;
  duration: string;
  targetRate?: string;
  inspectionNotes?: string;
}

export interface ToolCapabilityLink {
  mechanism: ProcessStepType;
  /**
   * Supported sub-mechanisms for this mechanism (e.g. 'PECVD', 'rie', 'drie-bosch',
   * 'UV Contact (365nm)', 'fusion', 'blade'). Empty/omitted matches all sub-mechanisms.
   */
  subMechanisms?: string[];
}

export interface CleanroomTool {
  id: string;
  name: string;
  vendor?: string;
  category: string;
  bayLocation?: string;
  waferSize?: string;
  capabilities: ToolCapabilityLink[];
  defaultRecipe: Partial<ToolRecipe>;
  notes?: string;
  isCustom?: boolean;
}

export interface ProcessBlock {
  id: string;
  name: string; // e.g. "Module 1: Gate Dielectric & Poly Stack"
  description?: string;
  color?: string; // hex color for block visual distinction
  collapsed?: boolean;
  placeholderStepIndex?: number; // Timeline step position when block has 0 steps
}

export interface ProcessStepVariant {
  id: string;
  name: string;
  notes?: string;
  title: string;
  type: ProcessStepType;
  side?: ProcessSide;
  materialId?: string;
  thickness?: number; // in nm
  deposition?: DepositionConfig;
  lithography?: LithographyConfig;
  etch?: EtchConfig;
  strip?: StripConfig;
  cmp?: CmpConfig;
  bonding?: BondingConfig;
  dicing?: DicingConfig;
  tapeFrame?: TapeFrameConfig;
  toolRecipe?: ToolRecipe;
  paramBindings?: Record<string, string>;
}

export interface ProcessStep {
  id: string;
  title: string;
  type: ProcessStepType;
  side?: ProcessSide; // Defaults to 'front' when omitted
  enabled: boolean;
  notes?: string;
  bookmarked?: boolean;
  bookmarkLabel?: string;
  materialId?: string;
  thickness?: number; // in nm
  blockId?: string; // ID of the fabrication block this step belongs to
  
  // Specific configurations
  deposition?: DepositionConfig;
  lithography?: LithographyConfig;
  etch?: EtchConfig;
  strip?: StripConfig;
  cmp?: CmpConfig;
  bonding?: BondingConfig;
  dicing?: DicingConfig;
  tapeFrame?: TapeFrameConfig;
  toolRecipe?: ToolRecipe;
  paramBindings?: Record<string, string>;

  // Process step variants (alternative recipes/parameters for A/B exploration)
  variants?: ProcessStepVariant[];
  activeVariantId?: string;
  variantMaskEditMode?: 'branch' | 'shared'; // 'branch' = fork new mask on variant track edit (default); 'shared' = carry edit to all variants sharing the reticle
}

export interface SubstrateLayer {
  id: string;
  name?: string; // e.g. "Silicon Bulk", "Buried Oxide", "Device Layer"
  materialId: string;
  thickness: number; // in nm
  paramBindings?: Record<string, string>;
}

export interface GdsPoint {
  x: number; // nm
  y: number; // nm
}

export type GdsPatternType = PatternType | 'outline';

export interface GdsShape {
  id: string;
  type: 'rect' | 'polygon' | 'path' | 'circle';
  layer: number;
  datatype?: number;
  pattern?: GdsPatternType;
  // rect
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  // polygon & path
  points?: GdsPoint[];
  pathWidth?: number; // nm
  // circle
  cx?: number;
  cy?: number;
  radius?: number;
  paramBindings?: Record<string, string>;
}

export interface GdsLayerInfo {
  layer: number;
  datatype: number;
  name: string;
  color: string;
  visible: boolean;
  pattern?: GdsPatternType;
  assignedMaskId?: string;
}

export interface GdsSectionLine {
  id: string;
  label: string;
  x1: number; // nm (start X, kept synced with points[0].x)
  y1: number; // nm (start Y, kept synced with points[0].y)
  x2: number; // nm (end X, kept synced with points[last].x)
  y2: number; // nm (end Y, kept synced with points[last].y)
  points?: GdsPoint[]; // Optional multi-point polyline vertices (>= 2 points)
  color?: string;
  resizeWaferToCut?: boolean;
  paramBindings?: Record<string, string>;
}

export interface GdsConcatConfig {
  enabled: boolean;
  sectionIds: string[]; // Ordered list of section cut IDs to concatenate
  gapNm: number; // Separation space between adjacent cuts in nm
}

export interface GdsLayoutData {
  name?: string;
  layers: GdsLayerInfo[];
  shapes: GdsShape[];
  sectionLine?: GdsSectionLine; // Legacy single section line (kept synced to active cut)
  sectionLines?: GdsSectionLine[]; // Multiple section lines (A-A', B-B', C-C', ...)
  activeSectionId?: string;
  concat?: GdsConcatConfig;
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
  alignmentMarks?: GlobalAlignmentMark[]; // Global substrate alignment fiducial marks
  blocks?: ProcessBlock[]; // Fabrication blocks / modules hierarchy
  gdsLayout?: GdsLayoutData; // Optional 2D GDS-style layout & section cut line
  etchLibrary?: EtchRecipe[]; // Custom & saved etch rate recipes
  toolLibrary?: CleanroomTool[]; // Custom & saved cleanroom tools linked to mechanisms
  variables?: DesignVariable[]; // Parametric design variables
  paramBindings?: Record<string, string>; // Flow-level parameter bindings (e.g. substrateWidth)
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
  side?: 'front' | 'back';
  isOverhang?: boolean;
}

export interface ColumnProfile {
  x: number; // nm
  segments: MaterialSegment[];
}

export interface ScallopWall {
  stepId: string;
  targetSide: 'front' | 'back';
  wallSide: 'left' | 'right';
  colTop: number;
  colBot: number;
  xTop: number; // nm
  xBot: number; // nm
  yTop: number; // nm
  yBot: number; // nm
  scallopDepth: number; // nm
  scallopPitch: number; // nm
  scallopBottomDepth?: number; // nm (Knudsen F* radical attenuation at trench bottom)
  isReentrant?: boolean;
  isDepositionWall?: boolean;
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
  scallopWalls?: ScallopWall[];
  mountedFrames?: MountedTapeFrame[];
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
