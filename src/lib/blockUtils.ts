/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ProcessFlow, ProcessStep, ProcessBlock } from '../types/microfab';

export const BLOCK_PALETTE = [
  '#0ea5e9', // Sky
  '#f59e0b', // Amber
  '#10b981', // Emerald
  '#a855f7', // Purple
  '#ec4899', // Pink
  '#3b82f6', // Blue
  '#14b8a6', // Teal
  '#f97316', // Orange
];

/**
 * Creates a new fabrication block in the process flow.
 */
export function createBlock(
  flow: ProcessFlow,
  name?: string,
  color?: string
): { flow: ProcessFlow; block: ProcessBlock } {
  const currentBlocks = flow.blocks ? [...flow.blocks] : [];
  const blockNum = currentBlocks.length + 1;
  const blockId = `block_${Date.now()}`;

  const newBlock: ProcessBlock = {
    id: blockId,
    name: name || `Module ${blockNum}: Fabrication Block`,
    description: 'Process operations regrouped into a fabrication module',
    color: color || BLOCK_PALETTE[(blockNum - 1) % BLOCK_PALETTE.length],
    collapsed: false,
  };

  return {
    flow: {
      ...flow,
      blocks: [...currentBlocks, newBlock],
    },
    block: newBlock,
  };
}

/**
 * Updates properties of a fabrication block.
 */
export function updateBlock(
  flow: ProcessFlow,
  updatedBlock: ProcessBlock
): ProcessFlow {
  const currentBlocks = flow.blocks ? [...flow.blocks] : [];
  const idx = currentBlocks.findIndex((b) => b.id === updatedBlock.id);
  if (idx >= 0) {
    currentBlocks[idx] = updatedBlock;
  } else {
    currentBlocks.push(updatedBlock);
  }

  return {
    ...flow,
    blocks: currentBlocks,
  };
}

/**
 * Deletes a fabrication block, unassigning any steps that belonged to it.
 */
export function deleteBlock(flow: ProcessFlow, blockId: string): ProcessFlow {
  const currentBlocks = (flow.blocks || []).filter((b) => b.id !== blockId);
  const updatedSteps = flow.steps.map((step) => {
    if (step.blockId === blockId) {
      return { ...step, blockId: undefined };
    }
    return step;
  });

  return {
    ...flow,
    blocks: currentBlocks,
    steps: updatedSteps,
  };
}

/**
 * Assigns or unassigns a step to/from a fabrication block.
 */
export function assignStepToBlock(
  flow: ProcessFlow,
  stepId: string,
  blockId: string | null
): ProcessFlow {
  const updatedSteps = flow.steps.map((step) => {
    if (step.id === stepId) {
      return {
        ...step,
        blockId: blockId || undefined,
      };
    }
    return step;
  });

  return {
    ...flow,
    steps: updatedSteps,
  };
}

/**
 * Toggles collapsed state of a fabrication block.
 */
export function toggleBlockCollapsed(
  flow: ProcessFlow,
  blockId: string
): ProcessFlow {
  const currentBlocks = (flow.blocks || []).map((b) => {
    if (b.id === blockId) {
      return { ...b, collapsed: !b.collapsed };
    }
    return b;
  });

  return {
    ...flow,
    blocks: currentBlocks,
  };
}

/**
 * Ensures that if flow.blocks is undefined, we return an array.
 * If preset flows don't have blocks yet, assigns standard cleanroom blocks.
 */
export function ensureFlowBlocks(flow: ProcessFlow): ProcessFlow {
  if (flow.blocks && flow.blocks.length > 0) {
    return flow;
  }

  // Auto-generate logical cleanroom blocks if the flow has steps but no blocks
  if (flow.steps && flow.steps.length > 0) {
    const steps = flow.steps;
    
    // Group into logical pairs/trios based on standard microfab patterns
    // e.g. Deposition + Litho + Etch -> Module
    const blocks: ProcessBlock[] = [];
    const updatedSteps = [...steps];

    if (flow.id === 'preset_cmos_gate') {
      const b1: ProcessBlock = {
        id: 'blk_cmos_gate_stack',
        name: 'Module 1: Gate Dielectric & Poly Stack',
        description: 'Thermal gate oxide growth and LPCVD polysilicon deposition',
        color: '#0ea5e9',
        collapsed: false,
      };
      const b2: ProcessBlock = {
        id: 'blk_cmos_gate_pattern',
        name: 'Module 2: Gate Photolithography & Plasma Etch',
        description: 'Submicron gate electrode patterning and anisotropic RIE etch',
        color: '#f59e0b',
        collapsed: false,
      };
      const b3: ProcessBlock = {
        id: 'blk_cmos_strip_clean',
        name: 'Module 3: Resist Strip & Ashing',
        description: 'Post-etch polymer removal and oxygen plasma strip',
        color: '#10b981',
        collapsed: false,
      };
      blocks.push(b1, b2, b3);

      if (updatedSteps[0]) updatedSteps[0] = { ...updatedSteps[0], blockId: b1.id };
      if (updatedSteps[1]) updatedSteps[1] = { ...updatedSteps[1], blockId: b1.id };
      if (updatedSteps[2]) updatedSteps[2] = { ...updatedSteps[2], blockId: b2.id };
      if (updatedSteps[3]) updatedSteps[3] = { ...updatedSteps[3], blockId: b2.id };
      if (updatedSteps[4]) updatedSteps[4] = { ...updatedSteps[4], blockId: b3.id };

      return { ...flow, blocks, steps: updatedSteps };
    }

    if (flow.id === 'preset_metal_liftoff') {
      const b1: ProcessBlock = {
        id: 'blk_liftoff_litho',
        name: 'Module 1: Negative Resist Lithography',
        description: 'Spin coat & retrograde profile exposure for lift-off',
        color: '#f59e0b',
        collapsed: false,
      };
      const b2: ProcessBlock = {
        id: 'blk_liftoff_metal',
        name: 'Module 2: Metallization & Solvent Dissolution',
        description: 'Directional E-beam evaporation and solvent lift-off release',
        color: '#a855f7',
        collapsed: false,
      };
      blocks.push(b1, b2);
      if (updatedSteps[0]) updatedSteps[0] = { ...updatedSteps[0], blockId: b1.id };
      if (updatedSteps[1]) updatedSteps[1] = { ...updatedSteps[1], blockId: b1.id };
      if (updatedSteps[2]) updatedSteps[2] = { ...updatedSteps[2], blockId: b2.id };
      if (updatedSteps[3]) updatedSteps[3] = { ...updatedSteps[3], blockId: b2.id };

      return { ...flow, blocks, steps: updatedSteps };
    }
  }

  return {
    ...flow,
    blocks: flow.blocks || [],
  };
}
