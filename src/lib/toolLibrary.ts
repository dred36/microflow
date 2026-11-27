/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CleanroomTool,
  ProcessStep,
  ProcessStepType,
  ToolRecipe,
} from '../types/microfab';

export interface MechanismOption {
  value: ProcessStepType;
  label: string;
  shortLabel: string;
}

export interface SubMechanismOption {
  value: string;
  label: string;
}

export const PROCESS_MECHANISM_OPTIONS: MechanismOption[] = [
  { value: 'deposition', label: 'Deposition / Thin Film Growth', shortLabel: 'Deposition' },
  { value: 'lithography', label: 'Photolithography & Patterning', shortLabel: 'Lithography' },
  { value: 'etch', label: 'Etching (Dry RIE / Wet / DRIE)', shortLabel: 'Etching' },
  { value: 'strip', label: 'Strip / Sacrificial Release', shortLabel: 'Strip / Release' },
  { value: 'liftoff', label: 'Metal Lift-off', shortLabel: 'Lift-off' },
  { value: 'cmp', label: 'Grind / Polish / Planarize (CMP)', shortLabel: 'CMP / Grind' },
  { value: 'bonding', label: 'Wafer Bonding', shortLabel: 'Bonding' },
  { value: 'dicing', label: 'Wafer Dicing', shortLabel: 'Dicing' },
  { value: 'tape-frame', label: 'Tape & Frame', shortLabel: 'Tape & Frame' },
  { value: 'anneal', label: 'Thermal Anneal / Drive-In', shortLabel: 'Anneal' },
  { value: 'substrate', label: 'Substrate Prep / Clean', shortLabel: 'Substrate' },
];

export const SUB_MECHANISM_OPTIONS: Record<ProcessStepType, SubMechanismOption[]> = {
  deposition: [
    { value: 'PECVD', label: 'PECVD' },
    { value: 'LPCVD', label: 'LPCVD' },
    { value: 'ALD', label: 'ALD (Atomic Layer)' },
    { value: 'Sputter', label: 'Sputtering (PVD)' },
    { value: 'E-Beam Evaporation', label: 'E-Beam Evaporation' },
    { value: 'Thermal Oxidation', label: 'Thermal Oxidation' },
    { value: 'Spin Coat', label: 'Spin Coat' },
    { value: 'Electroplating', label: 'Electroplating (ECD)' },
    { value: 'Electroless Plating', label: 'Electroless Plating' },
    { value: 'Dry Film Lamination', label: 'Dry Film Lamination' },
  ],
  lithography: [
    { value: 'UV Contact (365nm)', label: 'UV Contact Aligner (365nm)' },
    { value: 'DUV Stepper (248nm)', label: 'DUV Stepper (248nm)' },
    { value: 'E-Beam Litho', label: 'E-Beam Lithography (EBL)' },
    { value: 'Direct Write Laser', label: 'Direct Write Laser (MLA)' },
    { value: 'spin-coat', label: 'Resist Spin Coat' },
    { value: 'lor-bilayer', label: 'LOR Bilayer Coat' },
    { value: 'dry-film', label: 'Dry Film Lamination' },
  ],
  etch: [
    { value: 'rie', label: 'Reactive Ion Etch (RIE)' },
    { value: 'drie-bosch', label: 'Bosch DRIE' },
    { value: 'wet-isotropic', label: 'Wet Chemical (Isotropic)' },
    { value: 'wet-koh', label: 'Wet KOH / TMAH (54.74°)' },
    { value: 'ion-beam', label: 'Ion Beam Milling' },
    { value: 'ashing', label: 'O₂ Plasma Ashing' },
  ],
  strip: [
    { value: 'resist-strip', label: 'Resist Strip' },
    { value: 'metal-liftoff', label: 'Metal Lift-off' },
    { value: 'sacrificial-release', label: 'MEMS Sacrificial Release' },
  ],
  liftoff: [{ value: 'metal-liftoff', label: 'Metal Lift-off' }],
  cmp: [
    { value: 'cmp', label: 'CMP Planarization' },
    { value: 'grind', label: 'Mechanical Wafer Grinding' },
    { value: 'polish', label: 'Fine Lapping / Polishing' },
  ],
  bonding: [
    { value: 'fusion', label: 'Direct / Fusion Bond' },
    { value: 'anodic', label: 'Anodic Bond' },
    { value: 'adhesive', label: 'Adhesive / Polymer Bond' },
    { value: 'eutectic', label: 'Eutectic / Thermo-Compression' },
    { value: 'hybrid', label: 'Cu–Cu Hybrid Direct Bond' },
  ],
  dicing: [
    { value: 'blade', label: 'Mechanical Blade Saw' },
    { value: 'laser-ablation', label: 'Laser Ablation' },
    { value: 'stealth', label: 'Stealth Dicing' },
    { value: 'plasma', label: 'Plasma Dicing (DRIE)' },
  ],
  'tape-frame': [
    { value: 'mount', label: 'Mount on Tape & Frame' },
    { value: 'demount', label: 'UV Demount / Release' },
  ],
  anneal: [
    { value: 'furnace', label: 'Tube Furnace Anneal' },
    { value: 'rta', label: 'Rapid Thermal Anneal (RTA)' },
  ],
  substrate: [{ value: 'rca-clean', label: 'RCA Clean / Wafer Prep' }],
};

export const TOOL_CATEGORIES = [
  'CVD & Thermal',
  'PVD & Plating',
  'Lithography',
  'Dry Etch & Ash',
  'Wet Bench & Vapor',
  'CMP & Planarization',
  'Bonding & Packaging',
  'Custom',
] as const;

export function getMechanismLabel(mechanism: ProcessStepType, short = false): string {
  const found = PROCESS_MECHANISM_OPTIONS.find((m) => m.value === mechanism);
  if (!found) return mechanism;
  return short ? found.shortLabel : found.label;
}

export function getSubMechanismLabel(mechanism: ProcessStepType, subValue: string): string {
  const found = SUB_MECHANISM_OPTIONS[mechanism]?.find((s) => s.value === subValue);
  return found ? found.label : subValue;
}

export const DEFAULT_CLEANROOM_TOOLS: CleanroomTool[] = [
  {
    id: 'tool_oxford_pecvd',
    name: 'Oxford Plasmalab 100 PECVD',
    vendor: 'Oxford Instruments',
    category: 'CVD & Thermal',
    bayLocation: 'Bay 1 · Thin Films',
    waferSize: 'Up to 200 mm / pieces',
    capabilities: [{ mechanism: 'deposition', subMechanisms: ['PECVD'] }],
    defaultRecipe: {
      toolName: 'Oxford Plasmalab 100 PECVD',
      gases: 'SiH₄: 10 sccm, N₂O: 710 sccm, N₂: 162 sccm',
      power: '20 W RF (13.56 MHz)',
      pressure: '1000 mTorr',
      temperature: '300 °C',
      targetRate: '60 nm/min',
      inspectionNotes: 'Verify thickness and refractive index (n ≈ 1.46) via spectroscopic ellipsometry.',
    },
    notes: 'Low-temperature plasma-enhanced CVD dielectric system for SiO₂, SiNx, and a-Si.',
  },
  {
    id: 'tool_tystar_lpcvd',
    name: 'Tystar Titan LPCVD Furnace',
    vendor: 'Tystar Corp.',
    category: 'CVD & Thermal',
    bayLocation: 'Bay 1 · Furnace Stack',
    waferSize: '100 / 150 mm (25-wafer boat)',
    capabilities: [
      { mechanism: 'deposition', subMechanisms: ['LPCVD'] },
      { mechanism: 'anneal', subMechanisms: ['furnace'] },
    ],
    defaultRecipe: {
      toolName: 'Tystar Titan LPCVD Furnace',
      gases: 'DCS: 100 sccm, NH₃: 20 sccm (or SiH₄: 80 sccm)',
      power: '3-Zone Resistive',
      pressure: '250 mTorr',
      temperature: '800 °C',
      targetRate: '4.5 nm/min',
      inspectionNotes: 'Measure film uniformity across wafer boat and residual stress via wafer bow.',
    },
    notes: 'Batch horizontal tube furnace for low-stress Si₃N₄, TEOS SiO₂, polysilicon, and dopant anneals.',
  },
  {
    id: 'tool_tystar_ox',
    name: 'Tystar Dry/Wet Oxidation Furnace',
    vendor: 'Tystar Corp.',
    category: 'CVD & Thermal',
    bayLocation: 'Bay 1 · Furnace Stack',
    waferSize: '100 / 150 mm',
    capabilities: [
      { mechanism: 'deposition', subMechanisms: ['Thermal Oxidation'] },
      { mechanism: 'anneal', subMechanisms: ['furnace'] },
    ],
    defaultRecipe: {
      toolName: 'Tystar Dry/Wet Oxidation Furnace',
      gases: 'O₂: 4 slm (Dry) or H₂O/O₂ Pyrogenic (Wet)',
      power: '3-Zone Resistive',
      pressure: '760 Torr (Atm)',
      temperature: '1000 °C',
      targetRate: '1.2 nm/min (Dry) / 8 nm/min (Wet)',
      inspectionNotes: 'Pre-furnace RCA clean mandatory. Check oxide thickness on monitor wafer.',
    },
    notes: 'Ultra-clean MOS-grade gate and field thermal oxidation tube.',
  },
  {
    id: 'tool_beneq_ald',
    name: 'Beneq TFS 200 Thermal/PEALD',
    vendor: 'Beneq',
    category: 'CVD & Thermal',
    bayLocation: 'Bay 1 · Thin Films',
    waferSize: 'Up to 200 mm / 3D MEMS',
    capabilities: [{ mechanism: 'deposition', subMechanisms: ['ALD'] }],
    defaultRecipe: {
      toolName: 'Beneq TFS 200 ALD',
      gases: 'TMA / H₂O (Al₂O₃) or TDMAH / H₂O (HfO₂)',
      power: 'Thermal / 100 W Remote ICP',
      pressure: '1.5 Torr (N₂ Carrier)',
      temperature: '200 °C',
      targetRate: '0.11 nm/cycle',
      inspectionNotes: 'Confirm conformal coating inside high-aspect-ratio trenches by ellipsometry/XRR.',
    },
    notes: 'Monolayer-precision atomic layer deposition with ~100% step coverage in deep trenches.',
  },
  {
    id: 'tool_allwin_rta',
    name: 'Allwin21 AccuThermo RTA',
    vendor: 'Allwin21 Corp.',
    category: 'CVD & Thermal',
    bayLocation: 'Bay 1 · Thermal',
    waferSize: '100 / 150 / 200 mm',
    capabilities: [{ mechanism: 'anneal', subMechanisms: ['rta'] }],
    defaultRecipe: {
      toolName: 'Allwin21 AccuThermo RTA',
      gases: 'N₂: 5 slm (or Forming Gas 5% H₂/N₂)',
      power: 'Halogen IR Lamp Array (50 °C/s ramp)',
      pressure: '760 Torr',
      temperature: '1050 °C',
      duration: '15 s',
      inspectionNotes: 'Verify sheet resistance on 4-point probe after dopant activation or silicide anneal.',
    },
    notes: 'Fast-ramp lamp-heated rapid thermal processor for junction activation and contact alloying.',
  },
  {
    id: 'tool_aja_sputter',
    name: 'AJA Orion RF/DC Magnetron Sputterer',
    vendor: 'AJA International',
    category: 'PVD & Plating',
    bayLocation: 'Bay 2 · Metallization',
    waferSize: 'Up to 150 mm (Confocal 4-gun)',
    capabilities: [{ mechanism: 'deposition', subMechanisms: ['Sputter'] }],
    defaultRecipe: {
      toolName: 'AJA Orion Magnetron Sputterer',
      gases: 'Ar: 25 sccm',
      power: '250 W DC',
      pressure: '3.0 mTorr',
      temperature: '22 °C',
      targetRate: '18 nm/min',
      inspectionNotes: 'In-situ Ar sputter pre-clean optional. Verify sheet resistance and film adhesion.',
    },
    notes: 'Multi-target UHV magnetron sputter tool for Al, Ti, Cr, Cu, Pt, TiN, and dielectric PVD.',
  },
  {
    id: 'tool_temescal_ebeam',
    name: 'Temescal FC-1800 E-Beam Evaporator',
    vendor: 'Ferrotec / Temescal',
    category: 'PVD & Plating',
    bayLocation: 'Bay 2 · Metallization',
    waferSize: 'Up to 150 mm (Planetary / Normal)',
    capabilities: [{ mechanism: 'deposition', subMechanisms: ['E-Beam Evaporation'] }],
    defaultRecipe: {
      toolName: 'Temescal FC-1800 E-Beam',
      gases: 'High Vacuum (< 2×10⁻⁶ Torr)',
      power: '10 kV E-Beam (40–120 mA)',
      pressure: '1.5×10⁻⁶ Torr',
      temperature: '25 °C (Water-cooled stage)',
      targetRate: '12 nm/min (2 Å/s)',
      inspectionNotes: 'Monitor QCM crystal rate; maintain vertical line-of-sight for clean lift-off.',
    },
    notes: 'Directional physical vapor deposition ideal for Au/Ti/Cr electrodes and bilayer lift-off.',
  },
  {
    id: 'tool_ecd_plater',
    name: 'ClassOne Solstice Electroplater (ECD)',
    vendor: 'ClassOne Technology',
    category: 'PVD & Plating',
    bayLocation: 'Bay 2 · Plating Wet Deck',
    waferSize: '100 / 150 / 200 mm',
    capabilities: [
      {
        mechanism: 'deposition',
        subMechanisms: ['Electroplating', 'Electroless Plating'],
      },
    ],
    defaultRecipe: {
      toolName: 'ClassOne Solstice ECD Plater',
      gases: 'CuSO₄ / H₂SO₄ / Additives (or Au Sulfite Bath)',
      power: '10–25 mA/cm² Pulsed DC',
      pressure: '760 Torr (Liquid Bath)',
      temperature: '25 °C',
      targetRate: '400 nm/min',
      inspectionNotes: 'Verify seed continuity before plating; measure bump/TSV step height by profilometry.',
    },
    notes: 'Through-mask and damascene bottom-up copper/gold/nickel electrochemical deposition.',
  },
  {
    id: 'tool_laurell_spin',
    name: 'CEE 200X / Laurell Spin Coater & Hotplate',
    vendor: 'Brewer Science / Laurell',
    category: 'Lithography',
    bayLocation: 'Bay 3 · Yellow Room',
    waferSize: 'Up to 200 mm',
    capabilities: [
      { mechanism: 'deposition', subMechanisms: ['Spin Coat'] },
      { mechanism: 'lithography', subMechanisms: ['spin-coat', 'lor-bilayer'] },
    ],
    defaultRecipe: {
      toolName: 'CEE 200X Spin Coater & Bake Track',
      gases: 'N₂ Purge / Vacuum Chuck',
      power: '3000 RPM (500 RPM/s ramp, 45 s)',
      pressure: '760 Torr',
      temperature: '115 °C Soft Bake (60 s)',
      inspectionNotes: 'Inspect center-to-edge thickness uniformity and edge-bead removal.',
    },
    notes: 'Precision programmable spin coater for photoresists, LOR lift-off bilayers, SOG, and polymers.',
  },
  {
    id: 'tool_dfr_laminator',
    name: 'Dynachem / Takatori Dry Film Laminator',
    vendor: 'Takatori Corp.',
    category: 'Lithography',
    bayLocation: 'Bay 3 · Yellow Room',
    waferSize: '100 / 150 / 200 mm',
    capabilities: [
      { mechanism: 'deposition', subMechanisms: ['Dry Film Lamination'] },
      { mechanism: 'lithography', subMechanisms: ['dry-film'] },
    ],
    defaultRecipe: {
      toolName: 'Takatori Dry Film Vacuum Laminator',
      gases: 'Vacuum Assist + Heated Nip Roller',
      power: '0.35 MPa Roller Pressure · 0.5 m/min',
      pressure: '1.5 Torr (Vacuum Chamber)',
      temperature: '85 °C Roller Temp',
      inspectionNotes: 'Check bubble-free tenting across microfluidic cavities and etched trenches.',
    },
    notes: 'Heated vacuum laminator for tenting dry-film photoresists and permanent polyimide capping sheets.',
  },
  {
    id: 'tool_suss_ma6',
    name: 'SUSS MA6 / BA6 Mask Aligner',
    vendor: 'SUSS MicroTec',
    category: 'Lithography',
    bayLocation: 'Bay 3 · Yellow Room',
    waferSize: 'Up to 150 mm (Front/Backside)',
    capabilities: [{ mechanism: 'lithography', subMechanisms: ['UV Contact (365nm)'] }],
    defaultRecipe: {
      toolName: 'SUSS MA6 Mask Aligner',
      gases: '350 W Hg Arc Lamp (i-line 365 nm)',
      power: '18 mW/cm² (140 mJ/cm² dose)',
      pressure: 'Hard / Vacuum Contact (50 µm gap)',
      temperature: '21 °C',
      duration: '8 s',
      inspectionNotes: 'Verify front/backside alignment verniers (< 1.0 µm) and CD under optical microscope.',
    },
    notes: 'Broadband / i-line UV contact and proximity aligner with dual-side IR/BSA microscope.',
  },
  {
    id: 'tool_asml_pas5500',
    name: 'ASML PAS 5500 DUV Stepper',
    vendor: 'ASML',
    category: 'Lithography',
    bayLocation: 'Bay 3 · Litho Track',
    waferSize: '150 / 200 mm',
    capabilities: [{ mechanism: 'lithography', subMechanisms: ['DUV Stepper (248nm)'] }],
    defaultRecipe: {
      toolName: 'ASML PAS 5500/300 DUV Stepper',
      gases: 'KrF Excimer Laser (248 nm, NA 0.63)',
      power: '32 mJ/cm² Dose · 4× Reduction',
      pressure: 'Clean Dry Air Purge',
      temperature: '22.0 °C ± 0.1 °C',
      duration: '0.25 s/die',
      inspectionNotes: 'Run PEB (110 °C, 60 s) before TMAH develop; inspect CD-SEM on gate/via test dies.',
    },
    notes: 'Deep-UV 248 nm projection reduction stepper for sub-250 nm critical-dimension patterning.',
  },
  {
    id: 'tool_raith_ebpg',
    name: 'Raith EBPG5200 E-Beam Writer',
    vendor: 'Raith Nanofabrication',
    category: 'Lithography',
    bayLocation: 'Bay 3 · Nanopatterning',
    waferSize: 'Pieces up to 200 mm',
    capabilities: [{ mechanism: 'lithography', subMechanisms: ['E-Beam Litho'] }],
    defaultRecipe: {
      toolName: 'Raith EBPG5200 EBL (100 kV)',
      gases: 'Thermal Field Emission Electron Gun',
      power: '100 kV · 2 nA Beam · 650 µC/cm²',
      pressure: '5×10⁻⁷ Torr',
      temperature: '21 °C',
      inspectionNotes: 'Check proximity-effect correction and alignment marks; develop in MIBK:IPA 1:3.',
    },
    notes: 'Maskless 100 kV Gaussian electron-beam lithography down to < 15 nm feature resolution.',
  },
  {
    id: 'tool_heidelberg_mla150',
    name: 'Heidelberg MLA150 Direct-Write Laser',
    vendor: 'Heidelberg Instruments',
    category: 'Lithography',
    bayLocation: 'Bay 3 · Yellow Room',
    waferSize: 'Up to 150 mm',
    capabilities: [{ mechanism: 'lithography', subMechanisms: ['Direct Write Laser'] }],
    defaultRecipe: {
      toolName: 'Heidelberg MLA150 Maskless Aligner',
      gases: '375 nm / 405 nm Diode Laser',
      power: '220 mJ/cm² Dose (Autofocus Optical)',
      pressure: '760 Torr',
      temperature: '21 °C',
      inspectionNotes: 'Verify GDS alignment and minimum 0.8 µm line/space resolution after development.',
    },
    notes: 'Rapid-prototyping maskless optical laser writer directly from GDSII layouts.',
  },
  {
    id: 'tool_plasmatherm_rie',
    name: 'Plasma-Therm 790 / Oxford ICP-RIE',
    vendor: 'Plasma-Therm / Oxford',
    category: 'Dry Etch & Ash',
    bayLocation: 'Bay 4 · Dry Etch',
    waferSize: 'Up to 200 mm / Carrier wafer',
    capabilities: [{ mechanism: 'etch', subMechanisms: ['rie'] }],
    defaultRecipe: {
      toolName: 'Plasma-Therm 790 / Oxford ICP-RIE',
      gases: 'CHF₃: 35 sccm, SF₆: 10 sccm, Ar: 10 sccm',
      power: '180 W RIE / 600 W ICP',
      pressure: '20 mTorr',
      temperature: '20 °C',
      targetRate: '50 nm/min',
      inspectionNotes: 'Check optical emission endpoint trace and measure step height via profilometry.',
    },
    notes: 'Anisotropic reactive ion etching for SiO₂, Si₃N₄, polysilicon, and compound semiconductors.',
  },
  {
    id: 'tool_spts_pegasus',
    name: 'SPTS Pegasus Bosch DRIE',
    vendor: 'SPTS / KLA',
    category: 'Dry Etch & Ash',
    bayLocation: 'Bay 4 · Dry Etch',
    waferSize: '100 / 150 / 200 mm',
    capabilities: [
      { mechanism: 'etch', subMechanisms: ['drie-bosch'] },
      { mechanism: 'dicing', subMechanisms: ['plasma'] },
    ],
    defaultRecipe: {
      toolName: 'SPTS Pegasus Bosch DRIE',
      gases: 'Etch: SF₆ 250 sccm / Passiv: C₄F₈ 150 sccm',
      power: '2200 W ICP / 45 W Platen',
      pressure: '25 mTorr',
      temperature: '15 °C (He Backside)',
      targetRate: '3000 nm/min',
      inspectionNotes: 'Verify trench depth, ARDE lag, and sidewall verticality/scallops via cross-section SEM.',
    },
    notes: 'Time-multiplexed Bosch deep silicon etching for high-aspect-ratio MEMS, TSVs, and plasma dicing.',
  },
  {
    id: 'tool_tepla_asher',
    name: 'PVA TePla 300 O₂ Plasma Asher',
    vendor: 'PVA TePla',
    category: 'Dry Etch & Ash',
    bayLocation: 'Bay 4 · Dry Etch / Strip',
    waferSize: 'Up to 200 mm (Barrel / Downstream)',
    capabilities: [
      { mechanism: 'etch', subMechanisms: ['ashing'] },
      { mechanism: 'strip', subMechanisms: ['resist-strip'] },
    ],
    defaultRecipe: {
      toolName: 'PVA TePla O₂ Plasma Asher',
      gases: 'O₂: 200 sccm (optional CF₄: 10 sccm for descum)',
      power: '250 W RF / Microwave',
      pressure: '500 mTorr',
      temperature: '80 °C',
      targetRate: '260 nm/min',
      inspectionNotes: 'Confirm residue-free resist removal under darkfield optical microscope.',
    },
    notes: 'Dry oxygen plasma photoresist stripping, descum, and polymer/polyimide thinning.',
  },
  {
    id: 'tool_veeco_ionmill',
    name: 'Veeco Nexus Ion Beam Mill (IBE)',
    vendor: 'Veeco Instruments',
    category: 'Dry Etch & Ash',
    bayLocation: 'Bay 4 · Physical Etch',
    waferSize: 'Up to 150 mm (Tilting / Rotating Stage)',
    capabilities: [{ mechanism: 'etch', subMechanisms: ['ion-beam'] }],
    defaultRecipe: {
      toolName: 'Veeco Ion Beam Mill',
      gases: 'Ar: 15 sccm',
      power: '500 V Beam / 250 mA (SIMS Endpoint)',
      pressure: '0.2 mTorr',
      temperature: '15 °C (Chilled Stage)',
      targetRate: '45 nm/min',
      inspectionNotes: 'Use secondary ion mass spectrometry (SIMS) endpoint to prevent over-milling.',
    },
    notes: 'Physical Ar⁺ ion beam etching for noble metals (Au, Pt) and non-volatile magnetic/oxide stacks.',
  },
  {
    id: 'tool_acid_wet_bench',
    name: 'Class-100 Acid & Solvent Wet Bench',
    vendor: 'RENA / JST Wet Process',
    category: 'Wet Bench & Vapor',
    bayLocation: 'Bay 5 · Wet Chemistry',
    waferSize: 'Up to 200 mm (Cassette & Piece Dip)',
    capabilities: [
      { mechanism: 'etch', subMechanisms: ['wet-isotropic', 'wet-koh'] },
      {
        mechanism: 'strip',
        subMechanisms: ['resist-strip', 'metal-liftoff', 'sacrificial-release'],
      },
      { mechanism: 'liftoff', subMechanisms: ['metal-liftoff'] },
      { mechanism: 'substrate', subMechanisms: ['rca-clean'] },
    ],
    defaultRecipe: {
      toolName: 'Class-100 Wet Bench (Acid / Solvent)',
      gases: 'BOE / HF / KOH / NMP / Acetone / Piranha',
      power: 'Ultrasonic / Heated Bath + DI QDR',
      pressure: '760 Torr',
      temperature: '22 °C (or 80 °C for KOH/NMP)',
      inspectionNotes: 'Triple DI dump-rinse & spin-rinse-dry (SRD) or critical-point dry for MEMS.',
    },
    notes: 'Temperature-controlled wet chemical etching, RCA cleaning, solvent lift-off, and sacrificial release.',
  },
  {
    id: 'tool_xactix_xef2',
    name: 'Xactix e2 XeF₂ / HF Vapor Etcher',
    vendor: 'SPTS / Xactix',
    category: 'Wet Bench & Vapor',
    bayLocation: 'Bay 5 · MEMS Release',
    waferSize: 'Up to 150 mm',
    capabilities: [
      { mechanism: 'etch', subMechanisms: ['wet-isotropic'] },
      { mechanism: 'strip', subMechanisms: ['sacrificial-release'] },
    ],
    defaultRecipe: {
      toolName: 'Xactix XeF₂ / HF Vapor Release',
      gases: 'XeF₂ Vapor (or Anhydrous HF + EtOH Vapor)',
      power: 'Pulsed Expansion Chamber',
      pressure: '3.0 Torr',
      temperature: '22 °C',
      targetRate: '2000 nm/min',
      inspectionNotes: 'Inspect released cantilevers/membranes via white-light interferometry for zero stiction.',
    },
    notes: 'Stiction-free dry vapor-phase isotropic release of sacrificial Si or SiO₂ MEMS structures.',
  },
  {
    id: 'tool_strasbaugh_cmp',
    name: 'Strasbaugh 6EC CMP & Wafer Grinder',
    vendor: 'Strasbaugh / DISCO',
    category: 'CMP & Planarization',
    bayLocation: 'Bay 6 · Planarization',
    waferSize: '100 / 150 / 200 mm',
    capabilities: [{ mechanism: 'cmp', subMechanisms: ['cmp', 'grind', 'polish'] }],
    defaultRecipe: {
      toolName: 'Strasbaugh 6EC CMP / Backgrinder',
      gases: 'Colloidal Silica / Alumina Slurry (150 mL/min)',
      power: '3.5 psi Downforce · 60 RPM Platen/Carrier',
      pressure: '760 Torr',
      temperature: '25 °C',
      targetRate: '180 nm/min',
      inspectionNotes: 'Post-CMP PVA brush scrub; check dishing, erosion, and step height via profilometer.',
    },
    notes: 'Single-wafer CMP polisher and mechanical backgrinding/lapping system with optical endpoint.',
  },
  {
    id: 'tool_evg_520',
    name: 'EVG 520IS Wafer Bonder',
    vendor: 'EV Group',
    category: 'Bonding & Packaging',
    bayLocation: 'Bay 6 · Bonding & Packaging',
    waferSize: 'Up to 200 mm',
    capabilities: [
      {
        mechanism: 'bonding',
        subMechanisms: ['fusion', 'anodic', 'adhesive', 'eutectic', 'hybrid'],
      },
    ],
    defaultRecipe: {
      toolName: 'EVG 520IS Automated Bonder',
      gases: 'N₂ / Vacuum Chamber + Optional O₂ Plasma Activation',
      power: '5–15 kN Piston Force (0–1000 V Anodic)',
      pressure: '1×10⁻⁴ mbar Vacuum',
      temperature: '350 °C',
      duration: '30 min',
      inspectionNotes: 'Inspect bond interface for voids via IR transmission microscope or C-SAM.',
    },
    notes: 'Precision aligned wafer bonder supporting fusion, anodic, polymer adhesive, eutectic, and Cu–Cu hybrid.',
  },
  {
    id: 'tool_disco_dad3220',
    name: 'DISCO DAD3220 / DFL7161 Dicing System',
    vendor: 'DISCO Corp.',
    category: 'Bonding & Packaging',
    bayLocation: 'Bay 6 · Back-End Singulation',
    waferSize: 'Up to 200 mm (Ring Frame)',
    capabilities: [
      { mechanism: 'dicing', subMechanisms: ['blade', 'laser-ablation', 'stealth'] },
    ],
    defaultRecipe: {
      toolName: 'DISCO DAD3220 Saw / Laser Dicer',
      gases: 'DI Water Cooling Spindle + Surfactant (Blade)',
      power: '30,000 RPM Spindle · 25 mm/s Feed',
      pressure: '760 Torr',
      temperature: '20 °C',
      inspectionNotes: 'Check kerf width, backside chipping (< 15 µm), and tape overcut penetration.',
    },
    notes: 'Precision mechanical diamond blade saw, UV laser groover, and subsurface stealth dicer.',
  },
  {
    id: 'tool_lintec_mounter',
    name: 'Lintec RAD-2500 Tape Mounter & UV Irradiator',
    vendor: 'Lintec Corp.',
    category: 'Bonding & Packaging',
    bayLocation: 'Bay 6 · Back-End Singulation',
    waferSize: '100 / 150 / 200 mm Ring Frames',
    capabilities: [{ mechanism: 'tape-frame', subMechanisms: ['mount', 'demount'] }],
    defaultRecipe: {
      toolName: 'Lintec RAD-2500 Tape Mounter / UV',
      gases: '365 nm UV Release Lamp (Demount)',
      power: '400 mJ/cm² UV Dose (Demount)',
      pressure: 'Uniform Heated Roller Press',
      temperature: '25 °C (40 °C Heated Mount)',
      inspectionNotes: 'Verify bubble-free adhesion to carrier tape and proper ring frame seating.',
    },
    notes: 'Automated wafer-to-ring-frame tape lamination and UV-release demount station.',
  },
];

export function getCleanroomTools(flowTools?: CleanroomTool[]): CleanroomTool[] {
  if (!flowTools || flowTools.length === 0) {
    return DEFAULT_CLEANROOM_TOOLS;
  }
  const byId = new Map<string, CleanroomTool>();
  for (const t of DEFAULT_CLEANROOM_TOOLS) {
    byId.set(t.id, t);
  }
  for (const t of flowTools) {
    byId.set(t.id, t);
  }
  return Array.from(byId.values());
}

export function getCleanroomToolById(
  flowTools: CleanroomTool[] | undefined,
  toolId?: string
): CleanroomTool | undefined {
  if (!toolId) return undefined;
  return getCleanroomTools(flowTools).find((t) => t.id === toolId);
}

export interface StepMechanismContext {
  mechanism: ProcessStepType;
  subMechanisms: string[];
  primarySubLabel?: string;
}

export function getStepMechanismContext(step: ProcessStep): StepMechanismContext {
  const mechanism = step.type;
  const subMechanisms: string[] = [];

  switch (mechanism) {
    case 'deposition':
      if (step.deposition?.method) {
        subMechanisms.push(step.deposition.method);
      }
      break;
    case 'lithography':
      if (step.lithography?.exposureMethod) {
        subMechanisms.push(step.lithography.exposureMethod);
      }
      if (step.lithography?.coatMethod) {
        subMechanisms.push(step.lithography.coatMethod);
      }
      break;
    case 'etch':
      if (step.etch?.etchType) {
        subMechanisms.push(step.etch.etchType);
      }
      break;
    case 'strip':
      if (step.strip?.stripType) {
        subMechanisms.push(step.strip.stripType);
      }
      break;
    case 'liftoff':
      subMechanisms.push('metal-liftoff');
      break;
    case 'cmp':
      subMechanisms.push(step.cmp?.operation || 'cmp');
      break;
    case 'bonding':
      if (step.bonding?.bondingMethod) {
        subMechanisms.push(step.bonding.bondingMethod);
      }
      break;
    case 'dicing':
      if (step.dicing?.method) {
        subMechanisms.push(step.dicing.method);
      }
      break;
    case 'tape-frame':
      subMechanisms.push(step.tapeFrame?.action || 'mount');
      break;
    case 'anneal':
      break;
    case 'substrate':
      subMechanisms.push('rca-clean');
      break;
  }

  return {
    mechanism,
    subMechanisms,
    primarySubLabel:
      subMechanisms.length > 0
        ? getSubMechanismLabel(mechanism, subMechanisms[0])
        : undefined,
  };
}

export type ToolMatchLevel = 'exact' | 'mechanism' | null;

export function getToolMatchLevel(
  tool: CleanroomTool,
  mechanism: ProcessStepType,
  subMechanisms: string[] = []
): ToolMatchLevel {
  let matchedMechanismOnly = false;
  for (const cap of tool.capabilities) {
    if (cap.mechanism !== mechanism) continue;
    if (!cap.subMechanisms || cap.subMechanisms.length === 0) {
      matchedMechanismOnly = true;
      continue;
    }
    if (subMechanisms.length === 0) {
      matchedMechanismOnly = true;
      continue;
    }
    if (subMechanisms.some((s) => cap.subMechanisms!.includes(s))) {
      return 'exact';
    }
  }
  return matchedMechanismOnly ? 'mechanism' : null;
}

export function getToolsForStep(
  tools: CleanroomTool[],
  step: ProcessStep
): {
  exactMatches: CleanroomTool[];
  mechanismMatches: CleanroomTool[];
  otherTools: CleanroomTool[];
} {
  const ctx = getStepMechanismContext(step);
  const exactMatches: CleanroomTool[] = [];
  const mechanismMatches: CleanroomTool[] = [];
  const otherTools: CleanroomTool[] = [];

  for (const tool of tools) {
    const level = getToolMatchLevel(tool, ctx.mechanism, ctx.subMechanisms);
    if (level === 'exact') {
      exactMatches.push(tool);
    } else if (level === 'mechanism') {
      mechanismMatches.push(tool);
    } else {
      otherTools.push(tool);
    }
  }

  return { exactMatches, mechanismMatches, otherTools };
}

export function buildToolRecipeFromTool(
  tool: CleanroomTool,
  existing?: Partial<ToolRecipe>
): ToolRecipe {
  const def = tool.defaultRecipe || {};
  return {
    toolId: tool.id,
    toolName: def.toolName || tool.name,
    gases: def.gases ?? existing?.gases ?? '',
    power: def.power ?? existing?.power ?? '',
    pressure: def.pressure ?? existing?.pressure ?? '',
    temperature: def.temperature ?? existing?.temperature ?? '',
    duration: def.duration ?? existing?.duration ?? '',
    targetRate: def.targetRate ?? existing?.targetRate ?? '',
    inspectionNotes: def.inspectionNotes ?? existing?.inspectionNotes ?? '',
  };
}
