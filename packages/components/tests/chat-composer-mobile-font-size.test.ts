import { describe, expect, it } from 'vitest';

import { getChatComposerTextareaClassName } from '../src/components/chat/chat-composer';

describe('chat composer mobile font size', () => {
  it('uses 16px text on mobile without changing desktop text', () => {
    const mobile = getChatComposerTextareaClassName({
      tone: 'light',
      variant: 'landing',
      isMobile: true,
    });
    const desktop = getChatComposerTextareaClassName({
      tone: 'light',
      variant: 'landing',
      isMobile: false,
    });

    expect(mobile).toContain('text-base');
    expect(mobile).not.toContain('text-sm');
    expect(desktop).toContain('text-sm');
  });
});
