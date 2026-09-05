import { describe, expect, it } from 'vitest';
import {
  listApplicableComposerSessionSkills,
  planComposerSessionSkillApply,
} from '../src/lib/composer-session-skill';
import type { AcpConfigOptionSelector } from '../src/components/shared/acp-selector-options';
import { CODEX_COLLABORATION_MODE_PLAN_VALUE } from '../src/components/shared/acp-selector-options';

describe('planComposerSessionSkillApply', () => {
  it('turns Plan into the plan permission mode when the agent exposes it', () => {
    expect(
      planComposerSessionSkillApply({
        skill: 'plan',
        modeOptions: [{ value: 'default' }, { value: 'plan' }],
        prompt: '',
        debugPromptHint: 'debug',
      })
    ).toEqual({ modeId: 'plan' });
  });

  it('turns Ask into ask, then plan', () => {
    expect(
      planComposerSessionSkillApply({
        skill: 'ask',
        modeOptions: [{ value: 'plan' }],
        prompt: 'hello',
        debugPromptHint: 'debug',
      })
    ).toEqual({ modeId: 'plan' });
    expect(
      planComposerSessionSkillApply({
        skill: 'ask',
        modeOptions: [{ value: 'ask' }, { value: 'plan' }],
        prompt: 'hello',
        debugPromptHint: 'debug',
      })
    ).toEqual({ modeId: 'ask' });
  });

  it('fills a Debug hint only when the prompt is empty', () => {
    expect(
      planComposerSessionSkillApply({
        skill: 'debug',
        modeOptions: [{ value: 'debug' }],
        prompt: '',
        debugPromptHint: 'Find the root cause first.',
      })
    ).toEqual({ modeId: 'debug', promptHint: 'Find the root cause first.' });
    expect(
      planComposerSessionSkillApply({
        skill: 'debug',
        modeOptions: [{ value: 'debug' }],
        prompt: 'already typed',
        debugPromptHint: 'Find the root cause first.',
      })
    ).toEqual({ modeId: 'debug' });
  });

  it('enables Codex collaboration plan when no mode id exists', () => {
    const selectors = [
      {
        type: 'select',
        configId: 'collaboration_mode',
        category: 'plan_mode',
        label: 'Plan',
        currentValue: 'default',
        options: [
          { value: 'default', label: 'Default' },
          { value: CODEX_COLLABORATION_MODE_PLAN_VALUE, label: 'Plan' },
        ],
      },
    ] as AcpConfigOptionSelector[];

    expect(
      planComposerSessionSkillApply({
        skill: 'plan',
        modeOptions: [],
        configOptionSelectors: selectors,
        prompt: '',
        debugPromptHint: 'debug',
      })
    ).toEqual({
      configOption: {
        configId: 'collaboration_mode',
        value: CODEX_COLLABORATION_MODE_PLAN_VALUE,
      },
    });
  });

  it('enables Grok interaction_mode plan when no ACP mode id exists', () => {
    const selectors = [
      {
        type: 'select',
        configId: 'interaction_mode',
        category: 'mode',
        label: 'Interaction Mode',
        currentValue: 'agent',
        options: [
          { value: 'agent', label: 'Agent' },
          { value: 'plan', label: 'Plan' },
        ],
      },
    ] as AcpConfigOptionSelector[];

    expect(
      planComposerSessionSkillApply({
        skill: 'plan',
        modeOptions: [{ value: 'default' }],
        configOptionSelectors: selectors,
        configOptionValues: { interaction_mode: 'agent' },
        prompt: '',
        debugPromptHint: 'debug',
      })
    ).toEqual({
      configOption: {
        configId: 'interaction_mode',
        value: 'plan',
      },
    });
  });

  it('fills plan/ask/debug prompt hints when the agent has no matching mode', () => {
    expect(
      planComposerSessionSkillApply({
        skill: 'plan',
        modeOptions: [{ value: 'default' }],
        prompt: '',
        debugPromptHint: 'debug',
        planPromptHint: 'Write an implementation plan first.',
      })
    ).toEqual({ promptHint: 'Write an implementation plan first.' });
    expect(
      planComposerSessionSkillApply({
        skill: 'ask',
        modeOptions: [{ value: 'default' }],
        prompt: '',
        debugPromptHint: 'debug',
        askPromptHint: 'Answer without making edits.',
      })
    ).toEqual({ promptHint: 'Answer without making edits.' });
    expect(
      planComposerSessionSkillApply({
        skill: 'debug',
        modeOptions: [{ value: 'default' }],
        prompt: '',
        debugPromptHint: 'Find the root cause first.',
      })
    ).toEqual({ promptHint: 'Find the root cause first.' });
  });

  it('sends Multitask to the tasks board', () => {
    expect(
      planComposerSessionSkillApply({
        skill: 'multitask',
        modeOptions: [{ value: 'plan' }],
        prompt: '',
        debugPromptHint: 'debug',
      })
    ).toEqual({ navigateMultitask: true });
  });
});

describe('listApplicableComposerSessionSkills', () => {
  it('always lists Plan / Debug / Multitask / Ask', () => {
    expect(
      listApplicableComposerSessionSkills({
        modeOptions: [{ value: 'default' }],
        multitaskEnabled: false,
      })
    ).toEqual(['plan', 'debug', 'multitask', 'ask']);
  });
});
