/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ProcessFlow,
  ProcessStep,
  ProcessStepVariant,
  ProcessSide,
  PhotomaskLevel,
  MaskWindow,
  MaskFieldPolarity,
  LithographyConfig,
  GlobalAlignmentMark,
} from '../types/microfab';
import { resolveResistMaterialId } from './materials';
import { syncActiveVariantSnapshot, getActiveStepVariant } from './variantUtils';

export interface MaskVariantLink {
  step: ProcessStep;
  stepIndex: number;
  variant: ProcessStepVariant | null;
  isActiveVariant: boolean;
}

function buildDefaultLithoConfig(): LithographyConfig {
  return {
    resistMaterialId: 'mat_pr_pos',
    resistThickness: 1000,
    polarity: 'positive',
    windows: [],
    sidewallAngle: 90,
    exposureMethod: 'UV Contact (365nm)',
  };
}

/**
 * Resolves all (step, variant) links in the process flow that reference a given photomask level.
 */
export function getMaskVariantLinks(
  flow: ProcessFlow,
  mask: PhotomaskLevel
): MaskVariantLink[] {
  const links: MaskVariantLink[] = [];
  flow.steps.forEach((step, stepIndex) => {
    if (step.type !== 'lithography') return;
    if (step.variants && step.variants.length > 1) {
      const activeVar = getActiveStepVariant(step);
      step.variants.forEach((v) => {
        if (v.type !== 'lithography') return;
        const isActive = Boolean(activeVar && v.id === activeVar.id);
        const explicitVarMatch =
          mask.assignedStepId === step.id && mask.assignedVariantId === v.id;
        const lithoIdMatch = v.lithography?.maskId === mask.id;
        const fallbackActiveMatch =
          mask.assignedStepId === step.id &&
          !mask.assignedVariantId &&
          !v.lithography?.maskId &&
          isActive;
        if (explicitVarMatch || lithoIdMatch || fallbackActiveMatch) {
          links.push({
            step,
            stepIndex,
            variant: v,
            isActiveVariant: isActive,
          });
        }
      });
    } else {
      if (mask.assignedStepId === step.id || step.lithography?.maskId === mask.id) {
        links.push({
          step,
          stepIndex,
          variant: null,
          isActiveVariant: true,
        });
      }
    }
  });
  return links;
}

/**
 * Returns true if the mask is actively assigned to any lithography step or any of its variants.
 */
export function isMaskAssignedInFlow(
  flow: ProcessFlow,
  mask: PhotomaskLevel
): boolean {
  return getMaskVariantLinks(flow, mask).length > 0;
}

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

export function getNextMaskLevelNumber(masks: PhotomaskLevel[]): number {
  const maxExisting = masks.reduce((max, m) => Math.max(max, m.levelNumber || 0), 0);
  return Math.max(masks.length, maxExisting) + 1;
}

export function formatMaskLevelTag(levelNum: number): string {
  return String(levelNum).padStart(2, '0');
}

function buildDefaultMaskName(
  stepTitle: string,
  levelNum: number,
  explicitName?: string
): string {
  if (explicitName && explicitName.trim()) {
    return explicitName.trim();
  }
  const tag = formatMaskLevelTag(levelNum);
  const cleaned = stepTitle
    .replace(/photolithography/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
  return `MASK ${tag}: ${cleaned || 'LAYER'}`;
}

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

    const maskId = litho.maskId;
    let matchingMask = maskId ? existingMasks.find((m) => m.id === maskId) : null;

    if (!matchingMask && litho.maskName) {
      matchingMask =
        existingMasks.find(
          (m) =>
            m.name.toLowerCase() === litho.maskName?.toLowerCase() &&
            (!m.assignedStepId || m.assignedStepId === step.id)
        ) || null;
    }

    if (!matchingMask) {
      // Create a new mask level for this step
      const levelNum = getNextMaskLevelNumber(existingMasks);
      const tag = formatMaskLevelTag(levelNum);
      const newMaskId = `mask_lvl_${Date.now()}_${levelNum}`;
      matchingMask = {
        id: newMaskId,
        levelNumber: levelNum,
        name: buildDefaultMaskName(step.title, levelNum, litho.maskName),
        layerCode: `LVL-${tag}`,
        description: `Patterning reticle for ${step.title}`,
        polarity: litho.polarity || 'positive',
        maskField: litho.maskField || 'dark-field',
        color: RETICLE_PALETTE[(levelNum - 1) % RETICLE_PALETTE.length],
        windows: litho.windows ? litho.windows.map((w) => ({ ...w })) : [],
        assignedStepId: step.id,
        ...(litho.definesAlignmentMarks ? { definesAlignmentMarks: true } : {}),
      };
      existingMasks.push(matchingMask);
      stepsUpdated = true;
      return {
        ...step,
        lithography: {
          ...litho,
          maskId: newMaskId,
          maskName: matchingMask.name,
          maskColor: matchingMask.color,
          maskField: matchingMask.maskField || 'dark-field',
          ...(matchingMask.definesAlignmentMarks ? { definesAlignmentMarks: true } : {}),
        },
      };
    } else {
      // Ensure matching mask points to this step if not already assigned
      if (!matchingMask.assignedStepId) {
        matchingMask.assignedStepId = step.id;
      }
      if (!matchingMask.maskField) {
        matchingMask.maskField = litho.maskField || 'dark-field';
      }
      if (litho.definesAlignmentMarks && matchingMask.definesAlignmentMarks === undefined) {
        matchingMask.definesAlignmentMarks = true;
      }
      if (
        litho.maskId !== matchingMask.id ||
        litho.maskColor !== matchingMask.color ||
        litho.maskField !== matchingMask.maskField ||
        Boolean(litho.definesAlignmentMarks) !== Boolean(matchingMask.definesAlignmentMarks)
      ) {
        stepsUpdated = true;
        return {
          ...step,
          lithography: {
            ...litho,
            maskId: matchingMask.id,
            maskName: matchingMask.name,
            maskColor: matchingMask.color,
            maskField: matchingMask.maskField,
            definesAlignmentMarks: matchingMask.definesAlignmentMarks,
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
 * Creates a brand-new PhotomaskLevel in the Reticle Manager for a newly added,
 * duplicated, or converted photolithography step and links them 1-to-1.
 */
export function attachNewMaskToLithoStep(
  flow: ProcessFlow,
  stepId: string,
  partial?: Partial<PhotomaskLevel>
): ProcessFlow {
  const targetStep = flow.steps.find((s) => s.id === stepId && s.type === 'lithography');
  if (!targetStep) return flow;

  const existingMasks = flow.masks ? flow.masks.map((m) => ({ ...m })) : [];
  const levelNum = getNextMaskLevelNumber(existingMasks);
  const tag = formatMaskLevelTag(levelNum);
  const newMaskId = `mask_lvl_${Date.now()}_${levelNum}`;

  const litho = targetStep.lithography || {
    resistMaterialId: 'mat_pr_pos',
    resistThickness: 1000,
    polarity: 'positive',
    windows: [],
    sidewallAngle: 90,
    exposureMethod: 'UV Contact (365nm)',
  };

  const newMask: PhotomaskLevel = {
    id: newMaskId,
    levelNumber: levelNum,
    name: buildDefaultMaskName(targetStep.title, levelNum, partial?.name ?? litho.maskName),
    layerCode: partial?.layerCode || `LVL-${tag}`,
    description: partial?.description || `Patterning reticle for ${targetStep.title}`,
    polarity: partial?.polarity || litho.polarity || 'positive',
    maskField: partial?.maskField || litho.maskField || 'dark-field',
    color: partial?.color || RETICLE_PALETTE[(levelNum - 1) % RETICLE_PALETTE.length],
    windows:
      partial?.windows && partial.windows.length > 0
        ? partial.windows.map((w) => ({ ...w }))
        : (litho.windows || []).map((w) => ({ ...w })),
    assignedStepId: targetStep.id,
    definesAlignmentMarks: partial?.definesAlignmentMarks ?? litho.definesAlignmentMarks,
  };

  // Enforce 1-to-1 slot assignment (preserving reticles bound to other variants of the same step)
  const activeVar = targetStep.variants && targetStep.variants.length > 1
    ? getActiveStepVariant(targetStep)
    : null;
  if (activeVar) {
    newMask.assignedVariantId = activeVar.id;
  }

  const cleanedMasks = existingMasks.map((m) => {
    if (m.assignedStepId !== targetStep.id) return m;
    if (activeVar && m.assignedVariantId && m.assignedVariantId !== activeVar.id) {
      return m;
    }
    return { ...m, assignedStepId: undefined, assignedVariantId: undefined };
  });
  cleanedMasks.push(newMask);

  const updatedSteps = flow.steps.map((s) => {
    if (s.id !== targetStep.id) return s;
    return syncActiveVariantSnapshot({
      ...s,
      lithography: {
        ...litho,
        maskId: newMask.id,
        maskName: newMask.name,
        maskColor: newMask.color,
        polarity: newMask.polarity,
        maskField: newMask.maskField || 'dark-field',
        resistMaterialId: resolveResistMaterialId(newMask.polarity, litho.resistMaterialId),
        windows: newMask.windows.map((w) => ({ ...w })),
        definesAlignmentMarks: newMask.definesAlignmentMarks,
      },
    });
  });

  return {
    ...flow,
    masks: cleanedMasks,
    steps: updatedSteps,
  };
}

function applyMaskFieldsToLitho(
  litho: LithographyConfig,
  mask: PhotomaskLevel
): LithographyConfig {
  return {
    ...litho,
    windows: mask.windows.map((w) => ({ ...w })),
    polarity: mask.polarity,
    maskField: mask.maskField || litho.maskField || 'dark-field',
    resistMaterialId: resolveResistMaterialId(mask.polarity, litho.resistMaterialId),
    maskName: mask.name,
    maskId: mask.id,
    maskColor: mask.color,
    definesAlignmentMarks: mask.definesAlignmentMarks,
  };
}

/**
 * Updates a mask level and propagates changes to any assigned photolithography step
 * and matching step variants (active or inactive).
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

  const updatedSteps = flow.steps.map((step) => {
    if (step.type !== 'lithography') return step;

    if (step.variants && step.variants.length > 1) {
      const activeVar = getActiveStepVariant(step);
      let anyVariantMatched = false;
      let activeMatched = false;

      const nextVariants = step.variants.map((v) => {
        if (v.type !== 'lithography') return v;
        const explicitMatch =
          updatedMask.assignedStepId === step.id && updatedMask.assignedVariantId === v.id;
        const maskIdMatch = v.lithography?.maskId === updatedMask.id;
        const fallbackActiveMatch =
          updatedMask.assignedStepId === step.id &&
          !updatedMask.assignedVariantId &&
          !v.lithography?.maskId &&
          activeVar?.id === v.id;

        if (!explicitMatch && !maskIdMatch && !fallbackActiveMatch) {
          return v;
        }
        anyVariantMatched = true;
        if (activeVar && v.id === activeVar.id) {
          activeMatched = true;
        }
        return {
          ...v,
          lithography: applyMaskFieldsToLitho(v.lithography || buildDefaultLithoConfig(), updatedMask),
        };
      });

      if (!anyVariantMatched) return step;
      return {
        ...step,
        variants: nextVariants,
        ...(activeMatched
          ? {
              lithography: applyMaskFieldsToLitho(
                step.lithography || buildDefaultLithoConfig(),
                updatedMask
              ),
            }
          : {}),
      };
    }

    const isDirectMatch =
      updatedMask.assignedStepId === step.id || step.lithography?.maskId === updatedMask.id;
    if (!isDirectMatch || !step.lithography) return step;

    return {
      ...step,
      lithography: applyMaskFieldsToLitho(step.lithography, updatedMask),
    };
  });

  return {
    ...flow,
    masks: currentMasks,
    steps: updatedSteps,
  };
}

/**
 * Assigns or unassigns a mask level to/from a photolithography step (and optionally a specific variant).
 */
export function assignMaskToStep(
  flow: ProcessFlow,
  maskId: string,
  targetStepId: string | null,
  targetVariantId?: string | null
): ProcessFlow {
  const currentMasks = flow.masks ? flow.masks.map((m) => ({ ...m })) : [];
  const mask = currentMasks.find((m) => m.id === maskId);
  if (!mask) return flow;

  const targetStep = targetStepId
    ? flow.steps.find((s) => s.id === targetStepId && s.type === 'lithography')
    : undefined;
  const resolvedTargetVariantId =
    targetStep && targetStep.variants && targetStep.variants.length > 1
      ? targetVariantId || getActiveStepVariant(targetStep)?.id || undefined
      : undefined;

  const prevAssignedStepId = mask.assignedStepId;
  const prevAssignedVariantId = mask.assignedVariantId;
  mask.assignedStepId = targetStepId || undefined;
  mask.assignedVariantId = resolvedTargetVariantId;

  // Enforce strict 1-to-1 rule per (stepId, variantId) slot
  if (targetStepId) {
    currentMasks.forEach((other) => {
      if (other.id === maskId || other.assignedStepId !== targetStepId) return;
      if (resolvedTargetVariantId) {
        if (!other.assignedVariantId || other.assignedVariantId === resolvedTargetVariantId) {
          other.assignedStepId = undefined;
          other.assignedVariantId = undefined;
        }
      } else {
        other.assignedStepId = undefined;
        other.assignedVariantId = undefined;
      }
    });
  }

  const updatedSteps = flow.steps.map((step) => {
    if (step.type !== 'lithography') return step;

    let nextStep = step;

    // Detach maskId from previous step/variant if moved away
    if (prevAssignedStepId && nextStep.id === prevAssignedStepId) {
      const sameSlot =
        targetStepId === prevAssignedStepId &&
        (!resolvedTargetVariantId || resolvedTargetVariantId === prevAssignedVariantId);
      if (!sameSlot) {
        if (nextStep.variants && nextStep.variants.length > 1) {
          const activeVar = getActiveStepVariant(nextStep);
          let activeCleared = false;
          const nextVariants = nextStep.variants.map((v) => {
            if (v.type !== 'lithography' || !v.lithography) return v;
            const matchPrev = prevAssignedVariantId
              ? v.id === prevAssignedVariantId
              : v.lithography.maskId === maskId;
            if (!matchPrev) return v;
            if (activeVar && v.id === activeVar.id) activeCleared = true;
            return {
              ...v,
              lithography: { ...v.lithography, maskId: undefined },
            };
          });
          nextStep = {
            ...nextStep,
            variants: nextVariants,
            ...(activeCleared && nextStep.lithography
              ? { lithography: { ...nextStep.lithography, maskId: undefined } }
              : {}),
          };
        } else if (nextStep.lithography?.maskId === maskId) {
          nextStep = {
            ...nextStep,
            lithography: {
              ...nextStep.lithography,
              maskId: undefined,
            },
          };
        }
      }
    }

    // Apply mask onto newly assigned step/variant
    if (targetStepId && nextStep.id === targetStepId) {
      if (nextStep.variants && nextStep.variants.length > 1 && resolvedTargetVariantId) {
        const activeVar = getActiveStepVariant(nextStep);
        let activeUpdated = false;
        const nextVariants = nextStep.variants.map((v) => {
          if (v.id !== resolvedTargetVariantId) return v;
          if (activeVar && v.id === activeVar.id) activeUpdated = true;
          const baseLitho = v.lithography || nextStep.lithography || buildDefaultLithoConfig();
          return {
            ...v,
            type: 'lithography' as const,
            lithography: applyMaskFieldsToLitho(baseLitho, mask),
          };
        });
        nextStep = {
          ...nextStep,
          variants: nextVariants,
          ...(activeUpdated
            ? {
                lithography: applyMaskFieldsToLitho(
                  nextStep.lithography || buildDefaultLithoConfig(),
                  mask
                ),
              }
            : {}),
        };
      } else {
        const litho = nextStep.lithography || buildDefaultLithoConfig();
        nextStep = syncActiveVariantSnapshot({
          ...nextStep,
          lithography: applyMaskFieldsToLitho(litho, mask),
        });
      }
    }

    return nextStep;
  });

  return {
    ...flow,
    masks: currentMasks,
    steps: updatedSteps,
  };
}

/**
 * Swaps photomask assignments when a mask is assigned to a step (or variant slot) that already has a mask.
 */
export function swapMaskAssignments(
  flow: ProcessFlow,
  maskAId: string,
  targetStepId: string,
  targetVariantId?: string | null
): ProcessFlow {
  const currentMasks = flow.masks ? flow.masks.map((m) => ({ ...m })) : [];
  const maskA = currentMasks.find((m) => m.id === maskAId);
  if (!maskA) return flow;

  const targetStep = flow.steps.find((s) => s.id === targetStepId && s.type === 'lithography');
  const resolvedTargetVariantId =
    targetStep && targetStep.variants && targetStep.variants.length > 1
      ? targetVariantId || getActiveStepVariant(targetStep)?.id || undefined
      : undefined;

  const maskB = currentMasks.find((m) => {
    if (m.id === maskAId || m.assignedStepId !== targetStepId) return false;
    if (!resolvedTargetVariantId) return true;
    return !m.assignedVariantId || m.assignedVariantId === resolvedTargetVariantId;
  });

  if (!maskB) {
    return assignMaskToStep(flow, maskAId, targetStepId, resolvedTargetVariantId);
  }

  const prevStepAId = maskA.assignedStepId;
  const prevVariantAId = maskA.assignedVariantId;

  maskA.assignedStepId = targetStepId;
  maskA.assignedVariantId = resolvedTargetVariantId;
  maskB.assignedStepId = prevStepAId || undefined;
  maskB.assignedVariantId = prevStepAId ? prevVariantAId : undefined;

  const applyMaskToStepSlot = (
    step: ProcessStep,
    m: PhotomaskLevel,
    variantId?: string
  ): ProcessStep => {
    if (step.variants && step.variants.length > 1 && variantId) {
      const activeVar = getActiveStepVariant(step);
      let activeMatched = false;
      const nextVariants = step.variants.map((v) => {
        if (v.id !== variantId) return v;
        if (activeVar && v.id === activeVar.id) activeMatched = true;
        return {
          ...v,
          type: 'lithography' as const,
          lithography: applyMaskFieldsToLitho(
            v.lithography || step.lithography || buildDefaultLithoConfig(),
            m
          ),
        };
      });
      return {
        ...step,
        variants: nextVariants,
        ...(activeMatched
          ? {
              lithography: applyMaskFieldsToLitho(
                step.lithography || buildDefaultLithoConfig(),
                m
              ),
            }
          : {}),
      };
    }

    return syncActiveVariantSnapshot({
      ...step,
      lithography: applyMaskFieldsToLitho(step.lithography || buildDefaultLithoConfig(), m),
    });
  };

  const updatedSteps = flow.steps.map((step) => {
    if (step.type !== 'lithography') return step;
    let nextStep = step;
    if (nextStep.id === targetStepId) {
      nextStep = applyMaskToStepSlot(nextStep, maskA, resolvedTargetVariantId);
    }
    if (prevStepAId && nextStep.id === prevStepAId) {
      nextStep = applyMaskToStepSlot(nextStep, maskB, prevVariantAId);
    }
    return nextStep;
  });

  return {
    ...flow,
    masks: currentMasks,
    steps: updatedSteps,
  };
}

function buildVariantMaskName(
  sourceMaskName: string,
  variantName: string,
  variants?: ProcessStepVariant[]
): string {
  let baseName = sourceMaskName.trim();
  if (variants && variants.length > 0) {
    for (const v of variants) {
      const suffix = ` (${v.name})`;
      if (baseName.endsWith(suffix)) {
        baseName = baseName.slice(0, -suffix.length).trim();
        break;
      }
    }
  }
  return `${baseName || sourceMaskName} (${variantName})`;
}

function areMaskWindowsEqual(
  a: MaskWindow[] = [],
  b: MaskWindow[] = []
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const wa = a[i];
    const wb = b[i];
    if (Math.round(wa.xStart) !== Math.round(wb.xStart)) return false;
    if (Math.round(wa.xEnd) !== Math.round(wb.xEnd)) return false;
    const bindA = wa.paramBindings ? JSON.stringify(wa.paramBindings) : '';
    const bindB = wb.paramBindings ? JSON.stringify(wb.paramBindings) : '';
    if (bindA !== bindB) return false;
  }
  return true;
}

function doesLithoMaskPatternDiffer(
  litho: LithographyConfig,
  mask: PhotomaskLevel
): boolean {
  if (!areMaskWindowsEqual(litho.windows || [], mask.windows || [])) {
    return true;
  }
  const lithoField = litho.maskField || 'dark-field';
  const maskField = mask.maskField || 'dark-field';
  if (lithoField !== maskField) {
    return true;
  }
  return false;
}

/**
 * Forks a dedicated copy of a shared reticle for a specific variant of a branched lithography step,
 * keeping existing variants attached to their original reticle.
 */
export function forkMaskForStepVariant(
  flow: ProcessFlow,
  sourceMaskId: string,
  stepId: string,
  variantId: string
): { flow: ProcessFlow; newMask: PhotomaskLevel | null } {
  const step = flow.steps.find((s) => s.id === stepId && s.type === 'lithography');
  const sourceMask = (flow.masks || []).find((m) => m.id === sourceMaskId);
  const variant = step?.variants?.find((v) => v.id === variantId);
  if (!step || !sourceMask || !variant || !step.variants || step.variants.length <= 1) {
    return { flow, newMask: null };
  }

  const currentMasks = (flow.masks || []).map((m) => ({ ...m }));
  const levelNum = getNextMaskLevelNumber(currentMasks);
  const tag = formatMaskLevelTag(levelNum);
  const newMaskId = `mask_${Date.now()}_${levelNum}`;

  const newMask: PhotomaskLevel = {
    ...sourceMask,
    id: newMaskId,
    levelNumber: levelNum,
    name: buildVariantMaskName(sourceMask.name, variant.name, step.variants),
    layerCode: sourceMask.layerCode ? `${sourceMask.layerCode}-V${levelNum}` : `LVL-${tag}`,
    description: `Dedicated reticle for ${step.title} — ${variant.name}`,
    color: RETICLE_PALETTE[(levelNum - 1) % RETICLE_PALETTE.length],
    windows: (variant.lithography?.windows || sourceMask.windows).map((w, idx) => ({
      ...w,
      id: `w_fork_${Date.now()}_${idx}`,
    })),
    polarity: variant.lithography?.polarity || sourceMask.polarity,
    maskField: variant.lithography?.maskField || sourceMask.maskField || 'dark-field',
    assignedStepId: step.id,
    assignedVariantId: variant.id,
    definesAlignmentMarks:
      variant.lithography?.definesAlignmentMarks ?? sourceMask.definesAlignmentMarks,
  };

  // Pin sourceMask to another variant still referencing it if it wasn't pinned yet
  const otherVariantsUsingSource = step.variants.filter(
    (v) =>
      v.id !== variant.id &&
      v.type === 'lithography' &&
      (v.lithography?.maskId === sourceMask.id || !v.lithography?.maskId)
  );
  const updatedMasks = currentMasks.map((m) => {
    if (m.id === sourceMask.id && otherVariantsUsingSource.length === 1) {
      return {
        ...m,
        assignedStepId: step.id,
        assignedVariantId: otherVariantsUsingSource[0].id,
      };
    }
    return m;
  });
  updatedMasks.push(newMask);

  const flowWithMask: ProcessFlow = {
    ...flow,
    masks: updatedMasks,
  };
  const assignedFlow = assignMaskToStep(flowWithMask, newMask.id, step.id, variant.id);
  return { flow: assignedFlow, newMask };
}

/**
 * When a lithography step's apertures or properties are edited directly in the step editor
 * or MaskEditor track, sync back to the linked PhotomaskLevel while preserving reticles owned by other variants.
 * If the step is branched and the active variant modifies a reticle currently shared with another variant,
 * automatically fork a new mask branch in flow.masks and re-bind the active variant to it.
 */
export function syncStepWindowsToMask(
  flow: ProcessFlow,
  step: ProcessStep
): ProcessFlow {
  if (step.type !== 'lithography' || !step.lithography) return flow;

  const litho = step.lithography;
  const currentMasks = flow.masks ? flow.masks.map((m) => ({ ...m })) : [];
  const hasVariants = Boolean(step.variants && step.variants.length > 1);
  const activeVar = hasVariants ? getActiveStepVariant(step) : null;

  const referencedMaskIds = new Set<string>();
  if (litho.maskId) referencedMaskIds.add(litho.maskId);
  if (hasVariants && step.variants) {
    step.variants.forEach((v) => {
      if (v.type === 'lithography' && v.lithography?.maskId) {
        referencedMaskIds.add(v.lithography.maskId);
      }
    });
  }

  if (litho.maskId) {
    const mask = currentMasks.find((m) => m.id === litho.maskId);
    if (mask) {
      const otherVariantsOnSameMask =
        hasVariants && step.variants && activeVar
          ? step.variants.filter(
              (v) =>
                v.id !== activeVar.id &&
                v.type === 'lithography' &&
                v.lithography?.maskId === mask.id
            )
          : [];

      const isSharedEditMode = step.variantMaskEditMode === 'shared';

      // Auto-detect a new mask branch when in 'branch' mode (default) and a variant
      // modifies the aperture track / mask field on a reticle shared with sibling variants.
      if (
        !isSharedEditMode &&
        activeVar &&
        otherVariantsOnSameMask.length > 0 &&
        doesLithoMaskPatternDiffer(litho, mask)
      ) {
        const levelNum = getNextMaskLevelNumber(currentMasks);
        const tag = formatMaskLevelTag(levelNum);
        const newMaskId = `mask_${Date.now()}_${levelNum}`;
        const branchedMaskName = buildVariantMaskName(
          mask.name,
          activeVar.name,
          step.variants
        );
        const newMaskColor = RETICLE_PALETTE[(levelNum - 1) % RETICLE_PALETTE.length];
        const newMaskField = litho.maskField || mask.maskField || 'dark-field';

        // Preserve existing window IDs on the active variant so live drags/selections stay intact
        const newMask: PhotomaskLevel = {
          ...mask,
          id: newMaskId,
          levelNumber: levelNum,
          name: branchedMaskName,
          layerCode: mask.layerCode ? `${mask.layerCode}-V${levelNum}` : `LVL-${tag}`,
          description: `Branched reticle for ${step.title} — ${activeVar.name}`,
          polarity: litho.polarity,
          maskField: newMaskField,
          color: newMaskColor,
          windows: litho.windows.map((w) => ({ ...w })),
          assignedStepId: step.id,
          assignedVariantId: activeVar.id,
          definesAlignmentMarks: litho.definesAlignmentMarks,
        };

        // Keep the original shared mask untouched for the sibling variant(s)
        mask.assignedStepId = step.id;
        mask.assignedVariantId =
          otherVariantsOnSameMask.length === 1
            ? otherVariantsOnSameMask[0].id
            : undefined;

        currentMasks.push(newMask);
        referencedMaskIds.add(newMask.id);

        // Preserve any other variant masks on the same step; unassign obsolete ones
        currentMasks.forEach((other) => {
          if (other.id === newMask.id || other.id === mask.id || other.assignedStepId !== step.id) {
            return;
          }
          if (step.variants && referencedMaskIds.has(other.id)) {
            if (!other.assignedVariantId) {
              const ownerVar = step.variants.find(
                (v) =>
                  v.id !== activeVar.id &&
                  v.type === 'lithography' &&
                  v.lithography?.maskId === other.id
              );
              if (ownerVar) other.assignedVariantId = ownerVar.id;
            }
            return;
          }
          other.assignedStepId = undefined;
          other.assignedVariantId = undefined;
        });

        const nextLitho: LithographyConfig = {
          ...litho,
          maskId: newMask.id,
          maskName: newMask.name,
          maskColor: newMask.color,
          maskField: newMask.maskField,
        };

        const updatedSteps = flow.steps.map((s) => {
          if (s.id !== step.id) return s;
          const nextVariants = (s.variants || []).map((v) =>
            v.id === activeVar.id
              ? {
                  ...v,
                  lithography: {
                    ...nextLitho,
                    windows: nextLitho.windows.map((w) => ({ ...w })),
                  },
                }
              : v
          );
          return {
            ...s,
            lithography: nextLitho,
            variants: nextVariants,
          };
        });

        return {
          ...flow,
          masks: currentMasks,
          steps: updatedSteps,
        };
      }

      mask.windows = litho.windows.map((w) => ({ ...w }));
      mask.polarity = litho.polarity;
      mask.maskField = litho.maskField || mask.maskField || 'dark-field';
      mask.definesAlignmentMarks = litho.definesAlignmentMarks;
      if (litho.maskName) mask.name = litho.maskName;
      mask.assignedStepId = step.id;

      if (hasVariants && step.variants && activeVar) {
        const sharedByAnotherVariant = otherVariantsOnSameMask.length > 0;
        mask.assignedVariantId = sharedByAnotherVariant ? undefined : activeVar.id;
      } else {
        mask.assignedVariantId = undefined;
      }

      // Preserve other masks still referenced by inactive variants on the same step; unassign obsolete ones
      currentMasks.forEach((other) => {
        if (other.id === mask.id || other.assignedStepId !== step.id) return;
        if (hasVariants && step.variants && referencedMaskIds.has(other.id)) {
          if (!other.assignedVariantId) {
            const ownerVar = step.variants.find(
              (v) => v.id !== activeVar?.id && v.type === 'lithography' && v.lithography?.maskId === other.id
            );
            if (ownerVar) other.assignedVariantId = ownerVar.id;
          }
          return;
        }
        other.assignedStepId = undefined;
        other.assignedVariantId = undefined;
      });

      // In 'shared' edit mode, carry aperture/maskField/maskName edits over to all sibling variants sharing this reticle
      if (isSharedEditMode && hasVariants && step.variants && otherVariantsOnSameMask.length > 0) {
        const updatedSteps = flow.steps.map((s) => {
          if (s.id !== step.id || !s.variants) return s;
          const nextVariants = s.variants.map((v) => {
            if (v.id === activeVar?.id || v.type !== 'lithography' || v.lithography?.maskId !== mask.id) {
              return v;
            }
            return {
              ...v,
              lithography: {
                ...v.lithography,
                maskId: mask.id,
                maskName: mask.name,
                maskColor: mask.color,
                maskField: mask.maskField || 'dark-field',
                definesAlignmentMarks: mask.definesAlignmentMarks,
                windows: mask.windows.map((w) => ({ ...w })),
              },
            };
          });
          return {
            ...s,
            variants: nextVariants,
          };
        });

        return {
          ...flow,
          masks: currentMasks,
          steps: updatedSteps,
        };
      }

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
  const levelNum = getNextMaskLevelNumber(currentMasks);
  const tag = formatMaskLevelTag(levelNum);
  const id = `mask_${Date.now()}`;

  // Default aperture in center
  const wStart = Math.round((flow.substrateWidth || 10000) * 0.35);
  const wEnd = Math.round((flow.substrateWidth || 10000) * 0.65);

  const newMask: PhotomaskLevel = {
    id,
    levelNumber: levelNum,
    name: partial?.name || `MASK ${tag}: CUSTOM LEVEL`,
    layerCode: partial?.layerCode || `LVL-${tag}`,
    description: partial?.description || 'Photolithographic pattern level',
    polarity: partial?.polarity || 'positive',
    maskField: partial?.maskField || 'dark-field',
    color: partial?.color || RETICLE_PALETTE[(levelNum - 1) % RETICLE_PALETTE.length],
    windows: partial?.windows && partial.windows.length > 0
      ? partial.windows.map((w) => ({ ...w }))
      : [{ id: `w_${Date.now()}`, xStart: wStart, xEnd: wEnd }],
    assignedStepId: partial?.assignedStepId,
    assignedVariantId: partial?.assignedVariantId,
    definesAlignmentMarks: partial?.definesAlignmentMarks,
  };

  const updatedFlow = {
    ...flow,
    masks: [...currentMasks, newMask],
  };

  return {
    flow: newMask.assignedStepId
      ? assignMaskToStep(updatedFlow, newMask.id, newMask.assignedStepId, newMask.assignedVariantId)
      : updatedFlow,
    newMask,
  };
}

/**
 * Deletes an unassigned mask level. Assigned mask levels (including inactive variant reticles) are preserved.
 */
export function deleteMaskFromFlow(
  flow: ProcessFlow,
  maskId: string
): ProcessFlow {
  const targetMask = (flow.masks || []).find((m) => m.id === maskId);
  if (targetMask && isMaskAssignedInFlow(flow, targetMask)) {
    return flow;
  }

  const currentMasks = (flow.masks || []).filter((m) => m.id !== maskId);
  const updatedGdsLayout = flow.gdsLayout
    ? {
        ...flow.gdsLayout,
        layers: flow.gdsLayout.layers.map((l) =>
          l.assignedMaskId === maskId ? { ...l, assignedMaskId: undefined } : l
        ),
      }
    : flow.gdsLayout;

  return {
    ...flow,
    masks: currentMasks,
    gdsLayout: updatedGdsLayout,
  };
}

/**
 * Calculates authentic cleanroom lithography metrics for a mask level,
 * accounting for both Dark-Field (blocks = apertures) and Light-Field (blocks = chrome blockers).
 */
export function calculateMaskMetrics(
  mask: PhotomaskLevel,
  waferWidth: number
) {
  const windows = mask.windows || [];
  const apertureCount = windows.length;
  const maskField: MaskFieldPolarity = mask.maskField || 'dark-field';
  const isLightField = maskField === 'light-field';

  let minFeatureSizeNm = Infinity;

  // Sort windows by xStart and clamp to [0, waferWidth]
  const sorted = [...windows]
    .map((w) => ({
      xStart: Math.max(0, Math.min(waferWidth, w.xStart)),
      xEnd: Math.max(0, Math.min(waferWidth, w.xEnd)),
    }))
    .filter((w) => w.xEnd > w.xStart)
    .sort((a, b) => a.xStart - b.xStart);

  for (const w of sorted) {
    const width = w.xEnd - w.xStart;
    if (width < minFeatureSizeNm && width > 0) {
      minFeatureSizeNm = width;
    }
  }

  // Merge overlapping blocks so clear/blocked coverage never exceeds 100%
  const merged: Array<{ xStart: number; xEnd: number }> = [];
  for (const w of sorted) {
    const last = merged[merged.length - 1];
    if (last && w.xStart <= last.xEnd) {
      last.xEnd = Math.max(last.xEnd, w.xEnd);
    } else {
      merged.push({ ...w });
    }
  }

  const coveredWidthNm = merged.reduce((sum, w) => sum + (w.xEnd - w.xStart), 0);

  let minSpaceNm = Infinity;
  for (let i = 0; i < merged.length - 1; i++) {
    const space = merged[i + 1].xStart - merged[i].xEnd;
    if (space >= 0 && space < minSpaceNm) {
      minSpaceNm = space;
    }
  }

  const totalClearWidthNm = isLightField
    ? Math.max(0, waferWidth - coveredWidthNm)
    : coveredWidthNm;
  const totalBlockedWidthNm = isLightField
    ? coveredWidthNm
    : Math.max(0, waferWidth - coveredWidthNm);
  const clearPercentage = waferWidth > 0 ? (totalClearWidthNm / waferWidth) * 100 : 0;

  return {
    apertureCount,
    isLightField,
    maskField,
    totalClearWidthNm,
    totalClearWidthUm: (totalClearWidthNm / 1000).toFixed(2),
    totalBlockedWidthNm,
    totalBlockedWidthUm: (totalBlockedWidthNm / 1000).toFixed(2),
    clearPercentage: Math.min(100, Math.max(0, clearPercentage)).toFixed(1),
    minFeatureSizeNm: minFeatureSizeNm === Infinity ? 0 : Math.round(minFeatureSizeNm),
    minFeatureSizeUm: minFeatureSizeNm === Infinity ? '0.00' : (minFeatureSizeNm / 1000).toFixed(2),
    minSpaceNm: minSpaceNm === Infinity ? 0 : Math.round(minSpaceNm),
  };
}

export type MaskWindowArrayDirection = 'right' | 'left' | 'center';

export interface MaskWindowArrayOptions {
  count: number;
  pitchNm: number;
  direction: MaskWindowArrayDirection;
}

/**
 * Returns keyboard arrow nudge distances in nm for the photomask track editor.
 * Normal arrow keys apply a fine nudge (50 nm on >=4 µm wafers), while Shift+Arrow
 * scales proportionally with waferWidth (2.5% of wafer width, e.g. 250 nm at 10 µm,
 * 2.5 µm at 100 µm, 25 µm at 1 mm).
 */
export function getMaskArrowStepSizes(waferWidth: number): {
  fineNm: number;
  coarseNm: number;
} {
  const safeWidth = Math.max(100, waferWidth || 10000);
  const fineNm =
    safeWidth < 4000
      ? Math.max(10, Math.round((safeWidth * 0.005) / 10) * 10)
      : 50;
  const snap = safeWidth >= 10000 ? 50 : 10;
  const scaledShift = Math.round((safeWidth * 0.025) / snap) * snap;
  const coarseNm = Math.max(fineNm * 3, scaledShift);
  return { fineNm, coarseNm };
}

/**
 * Duplicates a mask window shifted adjacent to the source so it remains visible and editable.
 */
export function duplicateMaskWindow(
  source: MaskWindow,
  waferWidth: number
): MaskWindow {
  const width = Math.max(10, Math.min(waferWidth, Math.round(source.xEnd - source.xStart)));
  const defaultPitch = Math.max(width + 100, Math.round(width * 2));

  let nextStart: number;
  if (source.xStart + defaultPitch + width <= waferWidth) {
    nextStart = source.xStart + defaultPitch;
  } else if (source.xStart - defaultPitch >= 0) {
    nextStart = source.xStart - defaultPitch;
  } else if (source.xEnd + 50 <= waferWidth) {
    nextStart = Math.min(waferWidth - width, source.xStart + Math.max(50, Math.round((waferWidth - source.xEnd) / 2)));
  } else if (source.xStart - 50 >= 0) {
    nextStart = Math.max(0, source.xStart - Math.max(50, Math.round(source.xStart / 2)));
  } else {
    nextStart = Math.max(0, Math.min(waferWidth - width, source.xStart + (source.xStart + width + 50 <= waferWidth ? 50 : -50)));
  }

  const nextEnd = Math.min(waferWidth, Math.round(nextStart) + width);
  const clampedStart = Math.max(0, nextEnd - width);

  const inheritedBindings = source.paramBindings?.width
    ? { width: source.paramBindings.width }
    : undefined;

  return {
    id: `w_dup_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    xStart: clampedStart,
    xEnd: nextEnd,
    ...(source.fixedWidth ? { fixedWidth: true } : {}),
    ...(source.isAlignKey ? { isAlignKey: true } : {}),
    ...(inheritedBindings ? { paramBindings: inheritedBindings } : {}),
  };
}

/**
 * Builds a 1D periodic array of apertures/blockers starting from or centered around `sourceId`.
 */
export function createMaskWindowArray(
  windows: MaskWindow[],
  sourceId: string,
  options: MaskWindowArrayOptions,
  waferWidth: number
): {
  windows: MaskWindow[];
  addedIds: string[];
  totalPlaced: number;
  skippedOutOfBounds: number;
} {
  const sourceIdx = windows.findIndex((w) => w.id === sourceId);
  if (sourceIdx < 0) {
    return { windows, addedIds: [], totalPlaced: 0, skippedOutOfBounds: 0 };
  }

  const source = windows[sourceIdx];
  const count = Math.max(2, Math.min(100, Math.round(options.count)));
  const pitchNm = Math.max(10, Math.round(options.pitchNm));
  const width = Math.max(10, Math.min(waferWidth, Math.round(source.xEnd - source.xStart)));
  const inheritedBindings = source.paramBindings?.width
    ? { width: source.paramBindings.width }
    : undefined;
  const stamp = Date.now();

  if (options.direction === 'center') {
    const sourceCenter = (source.xStart + source.xEnd) / 2;
    const halfSpan = ((count - 1) * pitchNm) / 2;
    const generated: MaskWindow[] = [];
    let skipped = 0;

    for (let i = 0; i < count; i++) {
      const cx = sourceCenter - halfSpan + i * pitchNm;
      const rawStart = Math.round(cx - width / 2);
      const rawEnd = rawStart + width;
      if (rawEnd <= 0 || rawStart >= waferWidth) {
        skipped++;
        continue;
      }
      const cStart = Math.max(0, rawStart);
      const cEnd = Math.min(waferWidth, rawEnd);
      if (cEnd - cStart < 10) {
        skipped++;
        continue;
      }
      generated.push({
        id:
          generated.length === 0
            ? source.id
            : `w_arr_${stamp}_${i}_${Math.random().toString(36).slice(2, 5)}`,
        xStart: cStart,
        xEnd: cEnd,
        ...(source.fixedWidth ? { fixedWidth: true } : {}),
        ...(source.isAlignKey ? { isAlignKey: true } : {}),
        ...(inheritedBindings ? { paramBindings: inheritedBindings } : {}),
      });
    }

    if (generated.length === 0) {
      return { windows, addedIds: [], totalPlaced: 1, skippedOutOfBounds: skipped };
    }

    const nextWindows = [
      ...windows.slice(0, sourceIdx),
      ...generated,
      ...windows.slice(sourceIdx + 1),
    ];
    return {
      windows: nextWindows,
      addedIds: generated.slice(1).map((g) => g.id),
      totalPlaced: generated.length,
      skippedOutOfBounds: skipped,
    };
  }

  // 'right' or 'left': preserve source window untouched, append valid shifted copies
  const copies: MaskWindow[] = [];
  let skipped = 0;

  for (let i = 1; i < count; i++) {
    const delta = options.direction === 'right' ? i * pitchNm : -i * pitchNm;
    const rawStart = Math.round(source.xStart + delta);
    const rawEnd = rawStart + width;
    if (rawEnd <= 0 || rawStart >= waferWidth) {
      skipped++;
      continue;
    }
    const cStart = Math.max(0, rawStart);
    const cEnd = Math.min(waferWidth, rawEnd);
    if (cEnd - cStart < 10) {
      skipped++;
      continue;
    }
    copies.push({
      id: `w_arr_${stamp}_${i}_${Math.random().toString(36).slice(2, 5)}`,
      xStart: cStart,
      xEnd: cEnd,
      ...(source.fixedWidth ? { fixedWidth: true } : {}),
      ...(source.isAlignKey ? { isAlignKey: true } : {}),
      ...(inheritedBindings ? { paramBindings: inheritedBindings } : {}),
    });
  }

  const nextWindows = [
    ...windows.slice(0, sourceIdx + 1),
    ...copies,
    ...windows.slice(sourceIdx + 1),
  ];

  return {
    windows: nextWindows,
    addedIds: copies.map((c) => c.id),
    totalPlaced: 1 + copies.length,
    skippedOutOfBounds: skipped,
  };
}

const DEFAULT_ALIGN_MARK_COLORS = ['#22d3ee', '#34d399', '#f472b6', '#a78bfa', '#fbbf24'];

/**
 * Derives global substrate alignment mark(s) from mask windows:
 * - When `selectedWindows.length > 0`, places a SINGLE mark centered within the bounding box
 *   of all selected shapes (`(min(xStart) + max(xEnd)) / 2`).
 * - When no shapes are selected, derives marks from windows flagged `isAlignKey` (if any),
 *   or from all windows on the mask otherwise.
 */
export function deriveGlobalAlignmentMarkFromSelection(params: {
  existingMarks: GlobalAlignmentMark[];
  selectedWindows: MaskWindow[];
  allWindows: MaskWindow[];
  waferWidth: number;
  side?: ProcessSide;
  definedByStepId?: string;
  palette?: string[];
}): {
  marks: GlobalAlignmentMark[];
  addedCount: number;
  derivedCenterXNm?: number;
} {
  const {
    existingMarks,
    selectedWindows,
    allWindows,
    waferWidth,
    side = 'front',
    definedByStepId,
    palette = DEFAULT_ALIGN_MARK_COLORS,
  } = params;

  const markSide: ProcessSide =
    side === 'back' ? 'back' : side === 'both' ? 'both' : 'front';

  if (selectedWindows.length > 0) {
    const minStart = Math.min(...selectedWindows.map((w) => w.xStart));
    const maxEnd = Math.max(...selectedWindows.map((w) => w.xEnd));
    const centerX = Math.max(
      0,
      Math.min(waferWidth, Math.round((minStart + maxEnd) / 2))
    );

    const alreadyExists = existingMarks.some(
      (m) =>
        Math.abs(m.xNm - centerX) <= 1 &&
        (definedByStepId === undefined || m.definedByStepId === definedByStepId)
    );
    if (alreadyExists) {
      return { marks: existingMarks, addedCount: 0, derivedCenterXNm: centerX };
    }

    const usedLabels = new Set(existingMarks.map((m) => m.label.toLowerCase()));
    let nextIdx = existingMarks.length + 1;
    let label = `AM-${nextIdx}`;
    while (usedLabels.has(label.toLowerCase())) {
      nextIdx += 1;
      label = `AM-${nextIdx}`;
    }

    const newMark: GlobalAlignmentMark = {
      id: `am_${definedByStepId || 'mask'}_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 5)}`,
      label,
      xNm: centerX,
      side: markSide,
      color: palette[existingMarks.length % palette.length],
      ...(definedByStepId ? { definedByStepId } : {}),
    };

    return {
      marks: [...existingMarks, newMark],
      addedCount: 1,
      derivedCenterXNm: centerX,
    };
  }

  const alignKeyWindows = allWindows.filter((w) => w.isAlignKey);
  const sourceWindows = alignKeyWindows.length > 0 ? alignKeyWindows : allWindows;
  if (sourceWindows.length === 0) {
    return { marks: existingMarks, addedCount: 0 };
  }

  const baseMarks = definedByStepId
    ? existingMarks.filter((m) => m.definedByStepId !== definedByStepId)
    : existingMarks;
  const usedLabels = new Set(baseMarks.map((m) => m.label.toLowerCase()));
  let nextIdx = 1;

  const derivedMarks: GlobalAlignmentMark[] = [];
  sourceWindows.forEach((win, idx) => {
    const centerX = Math.max(
      0,
      Math.min(waferWidth, Math.round((win.xStart + win.xEnd) / 2))
    );
    if (
      !definedByStepId &&
      [...baseMarks, ...derivedMarks].some((m) => Math.abs(m.xNm - centerX) <= 1)
    ) {
      return;
    }
    let label = `AM-${nextIdx}`;
    while (usedLabels.has(label.toLowerCase())) {
      nextIdx += 1;
      label = `AM-${nextIdx}`;
    }
    usedLabels.add(label.toLowerCase());
    nextIdx += 1;

    derivedMarks.push({
      id: `am_${definedByStepId || 'mask'}_${win.id}_${Date.now()}_${idx}`,
      label,
      xNm: centerX,
      side: markSide,
      color: palette[(baseMarks.length + derivedMarks.length) % palette.length],
      ...(definedByStepId ? { definedByStepId } : {}),
    });
  });

  return {
    marks: [...baseMarks, ...derivedMarks],
    addedCount: derivedMarks.length,
    derivedCenterXNm: derivedMarks.length === 1 ? derivedMarks[0].xNm : undefined,
  };
}

