import type { AcpConfigOptionValue } from '@lody/shared';
import { orderAcpConfigOptionSelectors } from '@/lib/acp-selector-order';
import {
  CODEX_COLLABORATION_MODE_PLAN_VALUE,
  resolvePlanModeSelectorEnabled,
  type AcpConfigOptionSelector,
} from '@/components/shared/acp-selector-options';

export const COMPOSER_SESSION_SKILLS = ['plan', 'debug', 'multitask', 'ask'] as const;

export type ComposerSessionSkill = (typeof COMPOSER_SESSION_SKILLS)[number];

export type ComposerSessionSkillApply = {
  modeId?: string;
  configOption?: { configId: string; value: AcpConfigOptionValue };
  promptHint?: string;
  navigateMultitask?: boolean;
};

const MODE_CANDIDATES: Record<Exclude<ComposerSessionSkill, 'multitask'>, readonly string[]> = {
  plan: ['plan'],
  ask: ['ask', 'plan'],
  debug: ['debug', 'plan'],
};

function firstMatchingMode(
  candidates: readonly string[],
  modeOptions: ReadonlyArray<{ value: string }>
): string | undefined {
  const values = new Set(modeOptions.map((option) => option.value));
  return candidates.find((id) => values.has(id));
}

function planConfigOption(
  selectors: readonly AcpConfigOptionSelector[] | undefined,
  values: Record<string, AcpConfigOptionValue> | undefined
): ComposerSessionSkillApply['configOption'] {
  const planSelector = orderAcpConfigOptionSelectors(selectors ?? []).planModeSelectors[0];
  if (!planSelector) return undefined;
  if (resolvePlanModeSelectorEnabled(planSelector, values?.[planSelector.configId])) {
    return undefined;
  }
  return { configId: planSelector.configId, value: CODEX_COLLABORATION_MODE_PLAN_VALUE };
}

/** Turns a composer skill into mode / prompt / navigation actions. */
export function planComposerSessionSkillApply({
  skill,
  modeOptions,
  configOptionSelectors,
  configOptionValues,
  prompt,
  debugPromptHint,
}: {
  skill: ComposerSessionSkill;
  modeOptions: ReadonlyArray<{ value: string }>;
  configOptionSelectors?: readonly AcpConfigOptionSelector[];
  configOptionValues?: Record<string, AcpConfigOptionValue>;
  prompt: string;
  debugPromptHint: string;
}): ComposerSessionSkillApply {
  if (skill === 'multitask') {
    return { navigateMultitask: true };
  }

  const modeId = firstMatchingMode(MODE_CANDIDATES[skill], modeOptions);
  const configOption = skill === 'ask' ? undefined : planConfigOption(configOptionSelectors, configOptionValues);
  const promptHint =
    skill === 'debug' && prompt.trim().length === 0 ? debugPromptHint : undefined;

  return {
    ...(modeId ? { modeId } : {}),
    ...(configOption && !modeId ? { configOption } : {}),
    ...(promptHint ? { promptHint } : {}),
  };
}
