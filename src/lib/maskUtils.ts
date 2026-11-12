/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ProcessFlow, ProcessStep, PhotomaskLevel, MaskWindow } from '../types/microfab';

export const RETICLE_PALETTE = [
  '#38bdf8', // Sky
  '#f59e0b', // Amber
  '#10b981', // Emerald
  '#a855f7', // Purple
  '#ec4899', // Pink
  '#ef4444', // Red
  '#6366f1', // Indigo
  '#14b8a6', // Teal
];

/**
 * Ensures that flow.masks exists and is synchronized with all lithography steps.
 */
export function ensureFlowMasks(flow: ProcessFlow): ProcessFlow {
  let existingMasks = flow.masks ? [...flow.masks] : [];
  let stepsUpdated = false;
  const updatedSteps = flow.steps.map((step) => {
    if (step.type !== 'lithography') return step;

    const litho = step.lithography || {
      resistMaterialId: 'mat_pr_pos',
      resistThickness: 1000,
      polarity: 'positive',
      windows: [],
      sidewallAngle: 90,
      exposureMethod: 'UV Contact (365nm)',
    };

    let maskId = litho.maskId;
    let matchingMask = maskId ? existingMasks.find((m) => m.id === maskId) : null;

    if (!matchingMask) {
      // Find by maskName if available
      if (litho.maskName) {
        matchingMask = existingMasks.find((m) => m.name.toLowerCase() === litho.maskName?.toLowerCase()) || null;
      }
    }

    if (!matchingMask) {
      // Create a new mask level for this step
      const levelNum = existingMasks.length + 1;
      const newMaskId = `mask_lvl_${Date.now()}_${levelNum}`;
      matchingMask = {
        id: newMaskId,
        levelNumber: levelNum,
        name: litho.maskName || `MASK 0${levelNum}: ${step.title.toUpperCase().replace('PHOTOLITHOGRAPHY', '').trim() || 'LAYER'}`,
        layerCode: `LVL-0${levelNum}`,
        description: `Patterning reticle for ${step.title}`,
        polarity: litho.polarity || 'positive',
        color: RETICLE_PALETTE[(levelNum - 1) % RETICLE_PALETTE.length],
        windows: litho.windows ? litho.windows.map((w) => ({ ...w })) : [],
        assignedStepId: step.id,
      };
      existingMasks.push(matchingMask);
      stepsUpdated = true;
      return {
        ...step,
        lithography: {
          ...litho,
          maskId: newMaskId,
          maskName: matchingMask.name,
        },
      };
    } else {
      // Ensure matching mask points to this step if not already assigned
      if (!matchingMask.assignedStepId) {
        matchingMask.assignedStepId = step.id;
      }
      if (litho.maskId !== matchingMask.id) {
        stepsUpdated = true;
        return {
          ...step,
          lithography: {
            ...litho,
            maskId: matchingMask.id,
            maskName: matchingMask.name,
          },
        };
      }
    }

    return step;
  });

  return {
    ...flow,
    masks: existingMasks,
    steps: stepsUpdated ? updatedSteps : flow.steps,
  };
}

/**
 * Updates a mask level and propagates changes to any assigned photolithography step.
 */
export function updateMaskAndSyncSteps(
  flow: ProcessFlow,
  updatedMask: PhotomaskLevel
): ProcessFlow {
  const currentMasks = flow.masks ? [...flow.masks] : [];
  const maskIdx = currentMasks.findIndex((m) => m.id === updatedMask.id);
  if (maskIdx >= 0) {
    currentMasks[maskIdx] = updatedMask;
  } else {
    currentMasks.push(updatedMask);
  }

  // Synchronize to assigned step if linked
  let updatedSteps = flow.steps;
  if (updatedMask.assignedStepId) {
    updatedSteps = flow.steps.map((step) => {
      if (step.id === updatedMask.assignedStepId && step.type === 'lithography' && step.lithography) {
        return {
          ...step,
          lithography: {
            ...step.lithography,
            windows: updatedMask.windows.map((w) => ({ ...w })),
            polarity: updatedMask.polarity,
            maskName: updatedMask.name,
            maskId: updatedMask.id,
          },
        };
      }
      return step;
    });
  }

  return {
    ...flow,
    masks: currentMasks,
    steps: updatedSteps,
  };
}

/**
 * Assigns or unassigns a mask level to/from a photolithography step.
 */
export function assignMaskToStep(
  flow: ProcessFlow,
  maskId: string,
  targetStepId: string | null
): ProcessFlow {
  const currentMasks = flow.masks ? flow.masks.map((m) => ({ ...m })) : [];
  const mask = currentMasks.find((m) => m.id === maskId);
  if (!mask) return flow;

  const prevAssignedStepId = mask.assignedStepId;
  mask.assignedStepId = targetStepId || undefined;

  // Enforce strict 1-to-1 rule: If targetStepId is assigned, remove it from any other reticle
  if (targetStepId) {
    currentMasks.forEach((other) => {
      if (other.id !== maskId && other.assignedStepId === targetStepId) {
        other.assignedStepId = undefined;
      }
    });
  }

  let updatedSteps = flow.steps.map((step) => {
    // If this step previously had this mask but is now unassigned
    if (prevAssignedStepId && step.id === prevAssignedStepId && step.id !== targetStepId) {
      if (step.type === 'lithography' && step.lithography?.maskId === maskId) {
        return {
          ...step,
          lithography: {
            ...step.lithography,
            maskId: undefined,
          },
        };
      }
    }

    // If this is the newly assigned step
    if (targetStepId && step.id === targetStepId && step.type === 'lithography') {
      const litho = step.lithography || {
        resistMaterialId: 'mat_pr_pos',
        resistThickness: 1000,
        polarity: 'positive',
        windows: [],
        sidewallAngle: 90,
        exposureMethod: 'UV Contact (365nm)',
      };
      return {
        ...step,
        lithography: {
          ...litho,
          maskId: mask.id,
          maskName: mask.name,
          polarity: mask.polarity,
          windows: mask.windows.map((w) => ({ ...w })),
        },
      };
    }

    return step;
  });

  return {
    ...flow,
    masks: currentMasks,
    steps: updatedSteps,
  };
}

/**
 * Swaps photomask assignments when a mask is assigned to a step that already has a mask.
 * - maskA is assigned to targetStepId (where maskB was assigned).
 * - If maskA previously had an assigned step (prevStepAId), maskB takes that step.
 * - If maskA was unassigned, maskB becomes unassigned.
 * - All affected steps have their lithography properties (maskId, maskName, polarity, windows) synchronized.
 */
export function swapMaskAssignments(
  flow: ProcessFlow,
  maskAId: string,
  targetStepId: string
): ProcessFlow {
  const currentMasks = flow.masks ? flow.masks.map((m) => ({ ...m })) : [];
  const maskA = currentMasks.find((m) => m.id === maskAId);
  const maskB = currentMasks.find((m) => m.assignedStepId === targetStepId && m.id !== maskAId);

  if (!maskA) return flow;
  if (!maskB) {
    return assignMaskToStep(flow, maskAId, targetStepId);
  }

  const prevStepAId = maskA.assignedStepId;
  const targetStepBId = targetStepId;

  // Swap assignedStepId references
  maskA.assignedStepId = targetStepBId;
  maskB.assignedStepId = prevStepAId || undefined;

  // Update steps
  const updatedSteps = flow.steps.map((step) => {
    // Step B receives Mask A
    if (step.id === targetStepBId && step.type === 'lithography') {
      const litho = step.lithography || {
        resistMaterialId: 'mat_pr_pos',
        resistThickness: 1000,
        polarity: 'positive',
        windows: [],
        sidewallAngle: 90,
        exposureMethod: 'UV Contact (365nm)',
      };
      return {
        ...step,
        lithography: {
          ...litho,
          maskId: maskA.id,
          maskName: maskA.name,
          polarity: maskA.polarity,
          windows: maskA.windows.map((w) => ({ ...w })),
        },
      };
    }

    // If Mask A had a prior step, that step now receives Mask B
    if (prevStepAId && step.id === prevStepAId && step.type === 'lithography') {
      const litho = step.lithography || {
        resistMaterialId: 'mat_pr_pos',
        resistThickness: 1000,
        polarity: 'positive',
        windows: [],
        sidewallAngle: 90,
        exposureMethod: 'UV Contact (365nm)',
      };
      return {
        ...step,
        lithography: {
          ...litho,
          maskId: maskB.id,
          maskName: maskB.name,
          polarity: maskB.polarity,
          windows: maskB.windows.map((w) => ({ ...w })),
        },
      };
    }

    return step;
  });

  return {
    ...flow,
    masks: currentMasks,
    steps: updatedSteps,
  };
}

/**
 * When a lithography step's apertures or properties are edited directly in the step editor
 * or MaskEditor track, sync back to the linked PhotomaskLevel.
 */
export function syncStepWindowsToMask(
  flow: ProcessFlow,
  step: ProcessStep
): ProcessFlow {
  if (step.type !== 'lithography' || !step.lithography) return flow;

  const litho = step.lithography;
  const currentMasks = flow.masks ? flow.masks.map((m) => ({ ...m })) : [];

  if (litho.maskId) {
    const mask = currentMasks.find((m) => m.id === litho.maskId);
    if (mask) {
      mask.windows = litho.windows.map((w) => ({ ...w }));
      mask.polarity = litho.polarity;
      if (litho.maskName) mask.name = litho.maskName;
      mask.assignedStepId = step.id;

      // Remove assignment from any other mask currently claiming this step
      currentMasks.forEach((other) => {
        if (other.id !== mask.id && other.assignedStepId === step.id) {
          other.assignedStepId = undefined;
        }
      });

      return {
        ...flow,
        masks: currentMasks,
      };
    }
  }

  return flow;
}

/**
 * Creates a brand new mask in the flow's mask library.
 */
export function createNewMaskInFlow(
  flow: ProcessFlow,
  partial?: Partial<PhotomaskLevel>
): { flow: ProcessFlow; newMask: PhotomaskLevel } {
  const currentMasks = flow.masks ? [...flow.masks] : [];
  const levelNum = currentMasks.length + 1;
  const id = `mask_${Date.now()}`;

  // Default aperture in center
  const wStart = Math.round((flow.substrateWidth || 10000) * 0.35);
  const wEnd = Math.round((flow.substrateWidth || 10000) * 0.65);

  const newMask: PhotomaskLevel = {
    id,
    levelNumber: levelNum,
    name: partial?.name || `MASK 0${levelNum}: CUSTOM LEVEL`,
    layerCode: partial?.layerCode || `LVL-0${levelNum}`,
    description: partial?.description || 'Photolithographic pattern level',
    polarity: partial?.polarity || 'positive',
    color: partial?.color || RETICLE_PALETTE[(levelNum - 1) % RETICLE_PALETTE.length],
    windows: partial?.windows && partial.windows.length > 0
      ? partial.windows.map((w) => ({ ...w }))
      : [{ id: `w_${Date.now()}`, xStart: wStart, xEnd: wEnd }],
    assignedStepId: partial?.assignedStepId,
  };

  const updatedFlow = {
    ...flow,
    masks: [...currentMasks, newMask],
  };

  return {
    flow: newMask.assignedStepId ? assignMaskToStep(updatedFlow, newMask.id, newMask.assignedStepId) : updatedFlow,
    newMask,
  };
}

/**
 * Deletes a mask level and unlinks any assigned step.
 */
export function deleteMaskFromFlow(
  flow: ProcessFlow,
  maskId: string
): ProcessFlow {
  const currentMasks = (flow.masks || []).filter((m) => m.id !== maskId);
  const updatedSteps = flow.steps.map((step) => {
    if (step.type === 'lithography' && step.lithography?.maskId === maskId) {
      return {
        ...step,
        lithography: {
          ...step.lithography,
          maskId: undefined,
        },
      };
    }
    return step;
  });

  return {
    ...flow,
    masks: currentMasks,
    steps: updatedSteps,
  };
}

/**
 * Calculates authentic cleanroom lithography metrics for a mask level.
 */
export function calculateMaskMetrics(
  mask: PhotomaskLevel,
  waferWidth: number
) {
  const windows = mask.windows || [];
  const apertureCount = windows.length;
  
  let totalClearWidthNm = 0;
  let minFeatureSizeNm = Infinity;

  // Sort windows by xStart
  const sorted = [...windows].sort((a, b) => a.xStart - b.xStart);

  for (const w of sorted) {
    const width = Math.max(0, w.xEnd - w.xStart);
    totalClearWidthNm += width;
    if (width < minFeatureSizeNm && width > 0) {
      minFeatureSizeNm = width;
    }
  }

  let minSpaceNm = Infinity;
  for (let i = 0; i < sorted.length - 1; i++) {
    const space = sorted[i + 1].xStart - sorted[i].xEnd;
    if (space >= 0 && space < minSpaceNm) {
      minSpaceNm = space;
    }
  }

  const clearPercentage = waferWidth > 0 ? (totalClearWidthNm / waferWidth) * 100 : 0;

  return {
    apertureCount,
    totalClearWidthNm,
    totalClearWidthUm: (totalClearWidthNm / 1000).toFixed(2),
    clearPercentage: Math.min(100, Math.max(0, clearPercentage)).toFixed(1),
    minFeatureSizeNm: minFeatureSizeNm === Infinity ? 0 : Math.round(minFeatureSizeNm),
    minFeatureSizeUm: minFeatureSizeNm === Infinity ? '0.00' : (minFeatureSizeNm / 1000).toFixed(2),
    minSpaceNm: minSpaceNm === Infinity ? 0 : Math.round(minSpaceNm),
  };
}
