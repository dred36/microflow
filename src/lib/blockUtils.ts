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

export type TimelineItem =
  | {
      kind: 'block';
      block: ProcessBlock;
      steps: { step: ProcessStep; idx: number }[];
    }
  | {
      kind: 'step';
      step: ProcessStep;
      idx: number;
    };

/**
 * Ensures all steps sharing a blockId are consecutive in `flow.steps`,
 * clears invalid/orphaned blockIds, and keeps `flow.blocks` ordered consistently.
 */
export function normalizeFlowBlocksOrder(flow: ProcessFlow): ProcessFlow {
  const blocks = flow.blocks ? flow.blocks.map((b) => ({ ...b })) : [];
  const blockMap = new Map(blocks.map((b) => [b.id, b]));
  const rawSteps = flow.steps || [];

  // Clean orphaned blockIds
  const cleanedSteps = rawSteps.map((s) =>
    s.blockId && !blockMap.has(s.blockId) ? { ...s, blockId: undefined } : s
  );

  // Group all steps belonging to each blockId consecutively at first occurrence
  const normalizedSteps: ProcessStep[] = [];
  const seenBlocks = new Set<string>();
  const populatedBlockOrder: string[] = [];

  for (let i = 0; i < cleanedSteps.length; i++) {
    const step = cleanedSteps[i];
    if (!step.blockId) {
      normalizedSteps.push(step);
    } else if (!seenBlocks.has(step.blockId)) {
      seenBlocks.add(step.blockId);
      populatedBlockOrder.push(step.blockId);
      for (let j = i; j < cleanedSteps.length; j++) {
        if (cleanedSteps[j].blockId === step.blockId) {
          normalizedSteps.push(cleanedSteps[j]);
        }
      }
    }
  }

  // Reorder populated blocks in `blocks` to match their chronological occurrence
  // while leaving empty blocks in their existing slots
  const popQueue = populatedBlockOrder
    .map((id) => blockMap.get(id))
    .filter((b): b is ProcessBlock => Boolean(b));
  let popCursor = 0;

  const normalizedBlocks = blocks.map((b) => {
    if (seenBlocks.has(b.id)) {
      const nextPop = popQueue[popCursor++];
      return { ...nextPop, placeholderStepIndex: undefined };
    }
    return b;
  });

  // Check if anything actually changed to avoid unnecessary object churn
  const stepsChanged =
    normalizedSteps.length !== rawSteps.length ||
    normalizedSteps.some((s, i) => s !== rawSteps[i]);
  const blocksChanged =
    normalizedBlocks.length !== blocks.length ||
    normalizedBlocks.some((b, i) => b.id !== blocks[i]?.id || b.placeholderStepIndex !== blocks[i]?.placeholderStepIndex);

  if (!stepsChanged && !blocksChanged && flow.blocks) {
    return flow;
  }

  return {
    ...flow,
    blocks: normalizedBlocks,
    steps: normalizedSteps,
  };
}

/**
 * Builds an ordered list of UI/logical timeline segments (contiguous blocks & ungrouped steps),
 * placing any empty blocks at their `placeholderStepIndex`.
 */
export function buildTimelineItems(flow: ProcessFlow): TimelineItem[] {
  const norm = normalizeFlowBlocksOrder(flow);
  const blocks = norm.blocks || [];
  const steps = norm.steps || [];
  const blockMap = new Map(blocks.map((b) => [b.id, b]));
  const items: TimelineItem[] = [];
  const populatedBlockIds = new Set<string>();

  let i = 0;
  while (i < steps.length) {
    const step = steps[i];
    if (step.blockId && blockMap.has(step.blockId)) {
      const bId = step.blockId;
      const blockObj = blockMap.get(bId)!;
      populatedBlockIds.add(bId);
      const groupSteps: { step: ProcessStep; idx: number }[] = [];
      while (i < steps.length && steps[i].blockId === bId) {
        groupSteps.push({ step: steps[i], idx: i });
        i++;
      }
      items.push({
        kind: 'block',
        block: blockObj,
        steps: groupSteps,
      });
    } else {
      items.push({
        kind: 'step',
        step,
        idx: i,
      });
      i++;
    }
  }

  // Insert empty blocks at their designated step positions
  const emptyBlocks = blocks.filter((b) => !populatedBlockIds.has(b.id));
  const blockOrderIndex = new Map(blocks.map((b, index) => [b.id, index]));

  for (const eb of emptyBlocks) {
    const targetStepPos =
      typeof eb.placeholderStepIndex === 'number'
        ? Math.max(0, Math.min(steps.length, eb.placeholderStepIndex))
        : steps.length;
    const ebOrderIdx = blockOrderIndex.get(eb.id) ?? Number.MAX_SAFE_INTEGER;

    const emptyItem: TimelineItem = {
      kind: 'block',
      block: eb,
      steps: [],
    };

    let passedSteps = 0;
    let insertAt = items.length;

    for (let k = 0; k < items.length; k++) {
      const curr = items[k];
      if (curr.kind === 'block' && curr.steps.length === 0) {
        const currOrderIdx = blockOrderIndex.get(curr.block.id) ?? 0;
        if (passedSteps >= targetStepPos && currOrderIdx > ebOrderIdx) {
          insertAt = k;
          break;
        }
      } else {
        if (passedSteps >= targetStepPos) {
          insertAt = k;
          break;
        }
        passedSteps += curr.kind === 'step' ? 1 : curr.steps.length;
      }
    }

    items.splice(insertAt, 0, emptyItem);
  }

  return items;
}

/**
 * Reconstructs `flow.steps` and `flow.blocks` sequentially from TimelineItems,
 * maintaining consecutive steps per block and accurate `placeholderStepIndex` values.
 */
export function rebuildFlowFromTimelineItems(
  flow: ProcessFlow,
  items: TimelineItem[]
): ProcessFlow {
  const newSteps: ProcessStep[] = [];
  const newBlocks: ProcessBlock[] = [];

  for (const item of items) {
    if (item.kind === 'step') {
      newSteps.push({ ...item.step, blockId: undefined });
    } else {
      if (item.steps.length === 0) {
        newBlocks.push({
          ...item.block,
          placeholderStepIndex: newSteps.length,
        });
      } else {
        newBlocks.push({
          ...item.block,
          placeholderStepIndex: undefined,
        });
        for (const s of item.steps) {
          newSteps.push({ ...s.step, blockId: item.block.id });
        }
      }
    }
  }

  return {
    ...flow,
    blocks: newBlocks,
    steps: newSteps,
  };
}

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
    placeholderStepIndex: flow.steps.length,
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
 * Assigns or unassigns a step to/from a fabrication block while strictly guaranteeing
 * all steps within any block remain consecutive in `flow.steps`.
 */
export function assignStepToBlock(
  flow: ProcessFlow,
  stepId: string,
  targetBlockId: string | null
): ProcessFlow {
  const norm = normalizeFlowBlocksOrder(flow);
  const steps = [...norm.steps];
  const stepIdx = steps.findIndex((s) => s.id === stepId);
  if (stepIdx < 0) return norm;

  const targetStep = steps[stepIdx];
  const oldBlockId = targetStep.blockId;
  const nextBlockId = targetBlockId || undefined;

  if (oldBlockId === nextBlockId) return norm;

  // If unassigning from a block
  if (!nextBlockId) {
    if (oldBlockId) {
      const oldBlockIndices = steps
        .map((s, idx) => (s.blockId === oldBlockId ? idx : -1))
        .filter((idx) => idx >= 0);

      // If this was the ONLY step in oldBlockId, keep empty block's position here
      if (oldBlockIndices.length === 1) {
        const updatedBlocks = (norm.blocks || []).map((b) =>
          b.id === oldBlockId ? { ...b, placeholderStepIndex: stepIdx } : b
        );
        steps[stepIdx] = { ...targetStep, blockId: undefined };
        return { ...norm, blocks: updatedBlocks, steps };
      }

      // If it was in the MIDDLE of oldBlockId, move it right after oldBlockId
      const firstIdx = oldBlockIndices[0];
      const lastIdx = oldBlockIndices[oldBlockIndices.length - 1];
      if (stepIdx > firstIdx && stepIdx < lastIdx) {
        steps.splice(stepIdx, 1);
        steps.splice(lastIdx, 0, { ...targetStep, blockId: undefined });
        return normalizeFlowBlocksOrder({ ...norm, steps });
      }
    }

    steps[stepIdx] = { ...targetStep, blockId: undefined };
    return normalizeFlowBlocksOrder({ ...norm, steps });
  }

  // Assigning to a target block `nextBlockId`
  const targetBlockIndices = steps
    .map((s, idx) => (s.blockId === nextBlockId ? idx : -1))
    .filter((idx) => idx >= 0);

  let updatedBlocks = norm.blocks ? [...norm.blocks] : [];

  // Preserve empty placeholder if targetStep was the sole member of oldBlockId
  if (oldBlockId) {
    const oldCount = steps.filter((s) => s.blockId === oldBlockId).length;
    if (oldCount === 1) {
      updatedBlocks = updatedBlocks.map((b) =>
        b.id === oldBlockId ? { ...b, placeholderStepIndex: stepIdx } : b
      );
    }
  }

  if (targetBlockIndices.length === 0) {
    // Target block is currently empty -> assign in place
    steps[stepIdx] = { ...targetStep, blockId: nextBlockId };
    return normalizeFlowBlocksOrder({ ...norm, blocks: updatedBlocks, steps });
  }

  const firstTargetIdx = targetBlockIndices[0];
  const lastTargetIdx = targetBlockIndices[targetBlockIndices.length - 1];

  // If already immediately adjacent to the target block, assign in place
  if (stepIdx === firstTargetIdx - 1 || stepIdx === lastTargetIdx + 1) {
    steps[stepIdx] = { ...targetStep, blockId: nextBlockId };
    return normalizeFlowBlocksOrder({ ...norm, blocks: updatedBlocks, steps });
  }

  // Otherwise move the step so it sits consecutively at the end of targetBlock
  steps.splice(stepIdx, 1);
  const insertPos = stepIdx < lastTargetIdx ? lastTargetIdx : lastTargetIdx + 1;
  steps.splice(insertPos, 0, { ...targetStep, blockId: nextBlockId });

  return normalizeFlowBlocksOrder({ ...norm, blocks: updatedBlocks, steps });
}

/**
 * Moves an entire fabrication block up or down in the process timeline.
 */
export function moveBlockInTimeline(
  flow: ProcessFlow,
  blockId: string,
  direction: 'up' | 'down'
): ProcessFlow {
  const items = buildTimelineItems(flow);
  const itemIdx = items.findIndex((it) => it.kind === 'block' && it.block.id === blockId);
  if (itemIdx < 0) return flow;

  const targetItemIdx = direction === 'up' ? itemIdx - 1 : itemIdx + 1;
  if (targetItemIdx < 0 || targetItemIdx >= items.length) return flow;

  const nextItems = [...items];
  const [moved] = nextItems.splice(itemIdx, 1);
  nextItems.splice(targetItemIdx, 0, moved);

  return rebuildFlowFromTimelineItems(flow, nextItems);
}

/**
 * Moves a single step up or down:
 * - If first in a block and moved up -> removed from block and placed just in front of it.
 * - If last in a block and moved down -> removed from block and placed just after it.
 * - If inside a block and moved internally -> swaps within the block.
 * - If ungrouped and adjacent to a block in the move direction -> enters the block cleanly.
 * - If ungrouped and adjacent to another ungrouped step -> swaps steps.
 */
export function moveStepInTimeline(
  flow: ProcessFlow,
  stepIdx: number,
  direction: 'up' | 'down'
): { flow: ProcessFlow; newActiveIndex: number } {
  const norm = normalizeFlowBlocksOrder(flow);
  const steps = [...norm.steps];
  if (stepIdx < 0 || stepIdx >= steps.length) {
    return { flow: norm, newActiveIndex: stepIdx };
  }

  const targetStep = steps[stepIdx];

  // Case A: Step currently belongs to a block
  if (targetStep.blockId) {
    const bId = targetStep.blockId;
    const isFirstInBlock = stepIdx === 0 || steps[stepIdx - 1].blockId !== bId;
    const isLastInBlock = stepIdx === steps.length - 1 || steps[stepIdx + 1].blockId !== bId;
    const isOnlyInBlock = isFirstInBlock && isLastInBlock;

    if (direction === 'up') {
      if (isFirstInBlock) {
        // Remove from block and place just in front of it
        const items = buildTimelineItems(norm);
        const blockItemIdx = items.findIndex(
          (it) => it.kind === 'block' && it.block.id === bId
        );
        if (blockItemIdx >= 0 && items[blockItemIdx].kind === 'block') {
          const blkItem = items[blockItemIdx];
          const remaining = blkItem.steps.slice(1);
          const ungroupedStepItem: TimelineItem = {
            kind: 'step',
            step: { ...targetStep, blockId: undefined },
            idx: stepIdx,
          };
          const updatedBlockItem: TimelineItem = {
            kind: 'block',
            block: {
              ...blkItem.block,
              placeholderStepIndex: isOnlyInBlock ? stepIdx + 1 : undefined,
            },
            steps: remaining,
          };
          const nextItems = [...items];
          nextItems.splice(blockItemIdx, 1, ungroupedStepItem, updatedBlockItem);
          const rebuilt = rebuildFlowFromTimelineItems(norm, nextItems);
          const newIdx = rebuilt.steps.findIndex((s) => s.id === targetStep.id);
          return { flow: rebuilt, newActiveIndex: newIdx >= 0 ? newIdx : stepIdx };
        }
      } else {
        // Move up within the same block
        const [moved] = steps.splice(stepIdx, 1);
        steps.splice(stepIdx - 1, 0, moved);
        return {
          flow: normalizeFlowBlocksOrder({ ...norm, steps }),
          newActiveIndex: stepIdx - 1,
        };
      }
    } else {
      // direction === 'down'
      if (isLastInBlock) {
        // Remove from block and place just after it
        const items = buildTimelineItems(norm);
        const blockItemIdx = items.findIndex(
          (it) => it.kind === 'block' && it.block.id === bId
        );
        if (blockItemIdx >= 0 && items[blockItemIdx].kind === 'block') {
          const blkItem = items[blockItemIdx];
          const remaining = blkItem.steps.slice(0, -1);
          const ungroupedStepItem: TimelineItem = {
            kind: 'step',
            step: { ...targetStep, blockId: undefined },
            idx: stepIdx,
          };
          const updatedBlockItem: TimelineItem = {
            kind: 'block',
            block: {
              ...blkItem.block,
              placeholderStepIndex: isOnlyInBlock ? stepIdx : undefined,
            },
            steps: remaining,
          };
          const nextItems = [...items];
          nextItems.splice(blockItemIdx, 1, updatedBlockItem, ungroupedStepItem);
          const rebuilt = rebuildFlowFromTimelineItems(norm, nextItems);
          const newIdx = rebuilt.steps.findIndex((s) => s.id === targetStep.id);
          return { flow: rebuilt, newActiveIndex: newIdx >= 0 ? newIdx : stepIdx };
        }
      } else {
        // Move down within the same block
        const [moved] = steps.splice(stepIdx, 1);
        steps.splice(stepIdx + 1, 0, moved);
        return {
          flow: normalizeFlowBlocksOrder({ ...norm, steps }),
          newActiveIndex: stepIdx + 1,
        };
      }
    }
  }

  // Case B: Step is ungrouped
  const items = buildTimelineItems(norm);
  const itemIdx = items.findIndex(
    (it) => it.kind === 'step' && it.step.id === targetStep.id
  );
  if (itemIdx < 0) return { flow: norm, newActiveIndex: stepIdx };

  if (direction === 'up') {
    if (itemIdx === 0) return { flow: norm, newActiveIndex: stepIdx };
    const prevItem = items[itemIdx - 1];
    if (prevItem.kind === 'block') {
      // Enter preceding block at its end
      const nextItems = [...items];
      const updatedBlockItem: TimelineItem = {
        kind: 'block',
        block: { ...prevItem.block, placeholderStepIndex: undefined },
        steps: [
          ...prevItem.steps,
          { step: { ...targetStep, blockId: prevItem.block.id }, idx: stepIdx },
        ],
      };
      nextItems.splice(itemIdx - 1, 2, updatedBlockItem);
      const rebuilt = rebuildFlowFromTimelineItems(norm, nextItems);
      const newIdx = rebuilt.steps.findIndex((s) => s.id === targetStep.id);
      return { flow: rebuilt, newActiveIndex: newIdx >= 0 ? newIdx : stepIdx };
    } else {
      // Swap two adjacent ungrouped steps
      const nextItems = [...items];
      const [moved] = nextItems.splice(itemIdx, 1);
      nextItems.splice(itemIdx - 1, 0, moved);
      const rebuilt = rebuildFlowFromTimelineItems(norm, nextItems);
      const newIdx = rebuilt.steps.findIndex((s) => s.id === targetStep.id);
      return { flow: rebuilt, newActiveIndex: newIdx >= 0 ? newIdx : stepIdx - 1 };
    }
  } else {
    if (itemIdx >= items.length - 1) return { flow: norm, newActiveIndex: stepIdx };
    const nextItem = items[itemIdx + 1];
    if (nextItem.kind === 'block') {
      // Enter following block at its beginning
      const nextItems = [...items];
      const updatedBlockItem: TimelineItem = {
        kind: 'block',
        block: { ...nextItem.block, placeholderStepIndex: undefined },
        steps: [
          { step: { ...targetStep, blockId: nextItem.block.id }, idx: stepIdx },
          ...nextItem.steps,
        ],
      };
      nextItems.splice(itemIdx, 2, updatedBlockItem);
      const rebuilt = rebuildFlowFromTimelineItems(norm, nextItems);
      const newIdx = rebuilt.steps.findIndex((s) => s.id === targetStep.id);
      return { flow: rebuilt, newActiveIndex: newIdx >= 0 ? newIdx : stepIdx };
    } else {
      // Swap two adjacent ungrouped steps
      const nextItems = [...items];
      const [moved] = nextItems.splice(itemIdx, 1);
      nextItems.splice(itemIdx + 1, 0, moved);
      const rebuilt = rebuildFlowFromTimelineItems(norm, nextItems);
      const newIdx = rebuilt.steps.findIndex((s) => s.id === targetStep.id);
      return { flow: rebuilt, newActiveIndex: newIdx >= 0 ? newIdx : stepIdx + 1 };
    }
  }
}

/**
 * Inserts a new step cleanly into a target block (at the end of that block's consecutive steps)
 * or at the end of the flow if ungrouped.
 */
export function insertStepIntoTimeline(
  flow: ProcessFlow,
  newStep: ProcessStep,
  blockId?: string | null
): { flow: ProcessFlow; insertedIndex: number } {
  if (!blockId) {
    const updatedSteps = [...flow.steps, { ...newStep, blockId: undefined }];
    return {
      flow: { ...flow, steps: updatedSteps },
      insertedIndex: updatedSteps.length - 1,
    };
  }

  const items = buildTimelineItems(flow);
  const blockItemIdx = items.findIndex(
    (it) => it.kind === 'block' && it.block.id === blockId
  );

  if (blockItemIdx < 0 || items[blockItemIdx].kind !== 'block') {
    const updatedSteps = [...flow.steps, { ...newStep, blockId: undefined }];
    return {
      flow: { ...flow, steps: updatedSteps },
      insertedIndex: updatedSteps.length - 1,
    };
  }

  const blkItem = items[blockItemIdx];
  const nextItems = [...items];
  nextItems[blockItemIdx] = {
    kind: 'block',
    block: { ...blkItem.block, placeholderStepIndex: undefined },
    steps: [
      ...blkItem.steps,
      { step: { ...newStep, blockId }, idx: -1 },
    ],
  };

  const rebuilt = rebuildFlowFromTimelineItems(flow, nextItems);
  const insertedIndex = rebuilt.steps.findIndex((s) => s.id === newStep.id);
  return {
    flow: rebuilt,
    insertedIndex: insertedIndex >= 0 ? insertedIndex : rebuilt.steps.length - 1,
  };
}

/**
 * Deletes a step while preserving an empty block's position if it was the last remaining step.
 */
export function deleteStepFromTimeline(
  flow: ProcessFlow,
  stepIdx: number
): ProcessFlow {
  if (flow.steps.length <= 1) return flow;
  const targetStep = flow.steps[stepIdx];
  if (!targetStep) return flow;

  let updatedBlocks = flow.blocks ? [...flow.blocks] : [];
  if (targetStep.blockId) {
    const remainingInBlock = flow.steps.filter(
      (s, i) => i !== stepIdx && s.blockId === targetStep.blockId
    ).length;
    if (remainingInBlock === 0) {
      updatedBlocks = updatedBlocks.map((b) =>
        b.id === targetStep.blockId ? { ...b, placeholderStepIndex: stepIdx } : b
      );
    }
  }

  const updatedSteps = flow.steps.filter((_, i) => i !== stepIdx);
  return {
    ...flow,
    blocks: updatedBlocks,
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
 * Ensures that if flow.blocks is undefined, we return an array,
 * and normalizes existing flows so all block steps are consecutive.
 * If preset flows don't have blocks yet, assigns standard cleanroom blocks.
 */
export function ensureFlowBlocks(flow: ProcessFlow): ProcessFlow {
  if (flow.blocks && flow.blocks.length > 0) {
    return normalizeFlowBlocksOrder(flow);
  }

  // Auto-generate logical cleanroom blocks if the flow has steps but no blocks
  if (flow.steps && flow.steps.length > 0) {
    const steps = flow.steps;
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

      return normalizeFlowBlocksOrder({ ...flow, blocks, steps: updatedSteps });
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

      return normalizeFlowBlocksOrder({ ...flow, blocks, steps: updatedSteps });
    }

    if (flow.id === 'preset_mems_backside_diaphragm') {
      const b1: ProcessBlock = {
        id: 'blk_diaph_front',
        name: 'Module 1: Dual-Side Passivation & Frontside Electrode',
        description: 'LPCVD silicon nitride diaphragm and frontside gold contact',
        color: '#0ea5e9',
        collapsed: false,
      };
      const b2: ProcessBlock = {
        id: 'blk_diaph_back',
        name: 'Module 2: Backside Cavity Litho & KOH Micromachining',
        description: 'Backside mask alignment, nitride hard-mask open, and KOH cavity etch',
        color: '#f59e0b',
        collapsed: false,
      };
      blocks.push(b1, b2);
      if (updatedSteps[0]) updatedSteps[0] = { ...updatedSteps[0], blockId: b1.id };
      if (updatedSteps[1]) updatedSteps[1] = { ...updatedSteps[1], blockId: b1.id };
      if (updatedSteps[2]) updatedSteps[2] = { ...updatedSteps[2], blockId: b2.id };
      if (updatedSteps[3]) updatedSteps[3] = { ...updatedSteps[3], blockId: b2.id };
      if (updatedSteps[4]) updatedSteps[4] = { ...updatedSteps[4], blockId: b2.id };
      if (updatedSteps[5]) updatedSteps[5] = { ...updatedSteps[5], blockId: b2.id };

      return normalizeFlowBlocksOrder({ ...flow, blocks, steps: updatedSteps });
    }
  }

  return normalizeFlowBlocksOrder({
    ...flow,
    blocks: flow.blocks || [],
  });
}
