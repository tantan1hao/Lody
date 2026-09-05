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

/**
 * Prefer Codex collaboration plan, then Grok `interaction_mode=plan`. Skip when
 * that control is already in a plan-like state.
 */
function planConfigOption(
  selectors: readonly AcpConfigOptionSelector[] | undefined,
  values: Record<string, AcpConfigOptionValue> | undefined
): ComposerSessionSkillApply['configOption'] {
  const ordered = orderAcpConfigOptionSelectors(selectors ?? []);
  const planSelector = ordered.planModeSelectors[0];
  if (planSelector) {
    if (resolvePlanModeSelectorEnabled(planSelector, values?.[planSelector.configId])) {
      return undefined;
    }
    return { configId: planSelector.configId, value: CODEX_COLLABORATION_MODE_PLAN_VALUE };
  }

  const interaction = ordered.interactionModeSelectors[0];
  if (interaction?.type === 'select') {
    const hasPlan = interaction.options.some((option) => option.value === 'plan');
    if (!hasPlan) return undefined;
    if (values?.[interaction.configId] === 'plan') return undefined;
    return { configId: interaction.configId, value: 'plan' };
  }

  return undefined;
}

/** Turns a composer skill into mode / prompt / navigation actions. */
export function planComposerSessionSkillApply({
  skill,
  modeOptions,
  configOptionSelectors,
  configOptionValues,
  prompt,
  debugPromptHint,
  planPromptHint,
  askPromptHint,
}: {
  skill: ComposerSessionSkill;
  modeOptions: ReadonlyArray<{ value: string }>;
  configOptionSelectors?: readonly AcpConfigOptionSelector[];
  configOptionValues?: Record<string, AcpConfigOptionValue>;
  prompt: string;
  debugPromptHint: string;
  planPromptHint?: string;
  askPromptHint?: string;
}): ComposerSessionSkillApply {
  if (skill === 'multitask') {
    return { navigateMultitask: true };
  }

  const modeId = firstMatchingMode(MODE_CANDIDATES[skill], modeOptions);
  const configOption =
    skill === 'ask' ? undefined : planConfigOption(configOptionSelectors, configOptionValues);

  const promptEmpty = prompt.trim().length === 0;
  let promptHint: string | undefined =
    skill === 'debug' && promptEmpty ? debugPromptHint : undefined;

  // Agents without plan/ask/debug modes (e.g. Gemini) still get a useful chip:
  // fill an empty prompt with the skill's guidance instead of a silent no-op.
  if (!modeId && !configOption && promptEmpty) {
    if (skill === 'plan' && planPromptHint) promptHint = planPromptHint;
    if (skill === 'ask' && askPromptHint) promptHint = askPromptHint;
    if (skill === 'debug') promptHint = debugPromptHint;
  }

  return {
    ...(modeId ? { modeId } : {}),
    ...(configOption && !modeId ? { configOption } : {}),
    ...(promptHint ? { promptHint } : {}),
  };
}

/**
 * Skills the composer may show. Always Plan / Debug / Multitask / Ask. Mode /
 * config / prompt-hint apply still decide what each click does; Multitask
 * navigation may no-op when Tasks is off.
 */
export function listApplicableComposerSessionSkills(_args?: {
  modeOptions?: ReadonlyArray<{ value: string }>;
  configOptionSelectors?: readonly AcpConfigOptionSelector[];
  configOptionValues?: Record<string, AcpConfigOptionValue>;
  multitaskEnabled?: boolean;
}): ComposerSessionSkill[] {
  return [...COMPOSER_SESSION_SKILLS];
}
