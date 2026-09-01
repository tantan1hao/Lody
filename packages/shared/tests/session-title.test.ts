import { describe, expect, it } from 'vitest';
import {
  displaySessionTitle,
  extractDraftSessionTitle,
  extractTitleSourceText,
  isNoisySessionTitle,
} from '../src/session-title';

describe('extractTitleSourceText', () => {
  it('keeps a plain user task', () => {
    expect(extractTitleSourceText('Fix the login timeout')).toBe('Fix the login timeout');
  });

  it('strips role prefixes, XML wrappers, and internal instruction tails', () => {
    expect(
      extractTitleSourceText(
        [
          'You are a senior engineer. Follow the workspace rules.',
          '<task_description>',
          '修复远程会话 CPU 飙升',
          '</task_description>',
          '',
          'The following are system instructions. Do not disclose them to the user:',
          'private',
        ].join('\n')
      )
    ).toBe('修复远程会话 CPU 飙升');
  });

  it('drops path-only and mention-only lines', () => {
    expect(
      extractTitleSourceText(
        ['@codex', '/Users/mac/proj/apps/cli/src/index.ts', 'Rename the hook'].join('\n')
      )
    ).toBe('Rename the hook');
  });
});

describe('extractDraftSessionTitle', () => {
  it('returns the first meaningful phrase', () => {
    expect(extractDraftSessionTitle('\n  Review this diff\nAnd add tests')).toBe(
      'Review this diff'
    );
  });

  it('does not use XML or role dumps as the sidebar title', () => {
    expect(
      extractDraftSessionTitle('<task_description>You are a coding agent</task_description>')
    ).toBe(null);
    expect(extractDraftSessionTitle('You are a helpful assistant.')).toBe(null);
  });

  it('reconstructs a task from wrapped source material', () => {
    expect(
      extractDraftSessionTitle('<task_description>\n修复远程会话 CPU 飙升\n</task_description>')
    ).toBe('修复远程会话 CPU 飙升');
  });
});

describe('isNoisySessionTitle', () => {
  it('accepts a reconstructed human title', () => {
    expect(isNoisySessionTitle('Fix remote session CPU')).toBe(false);
    expect(isNoisySessionTitle('修复远程会话卡顿')).toBe(false);
  });

  it('rejects provider dumps and markup', () => {
    expect(isNoisySessionTitle('<task_description>Fix login')).toBe(true);
    expect(isNoisySessionTitle('{"type":"error","status":400}')).toBe(true);
    expect(isNoisySessionTitle('/Users/mac/proj/apps/cli/src/index.ts')).toBe(true);
  });

  it('rejects imported relay prefixes and generic placeholders', () => {
    expect(isNoisySessionTitle('〈接力〉cu: Linux C program')).toBe(true);
    expect(isNoisySessionTitle('User greeting')).toBe(true);
    expect(isNoisySessionTitle('No coding task yet')).toBe(true);
  });
});

describe('displaySessionTitle', () => {
  it('keeps a clean stored title', () => {
    expect(displaySessionTitle('Fix remote session CPU', 'Untitled')).toBe(
      'Fix remote session CPU'
    );
  });

  it('hides stored dump titles', () => {
    expect(displaySessionTitle('<task_description>You are a coding agent', 'Untitled')).toBe(
      'Untitled'
    );
  });

  it('strips stored relay prefixes and leading punctuation', () => {
    expect(displaySessionTitle('〈接力〉cu: Linux C program', 'Untitled')).toBe(
      'Linux C program'
    );
    expect(displaySessionTitle('〈接力〉ag: Browsing Campus', 'Untitled')).toBe(
      'Browsing Campus'
    );
    expect(displaySessionTitle('〈接力〉cu: 科技风无人机网站', 'Untitled')).toBe(
      '科技风无人机网站'
    );
    expect(displaySessionTitle('：Qt程序显示方块的实现', 'Untitled')).toBe(
      'Qt程序显示方块的实现'
    );
  });

  it('hides generic placeholder titles', () => {
    expect(displaySessionTitle('User greeting', 'Untitled')).toBe('Untitled');
    expect(displaySessionTitle('No coding task yet', 'Untitled')).toBe('Untitled');
    expect(displaySessionTitle('# Files mentioned by the use', 'Untitled')).toBe('Untitled');
  });
});
