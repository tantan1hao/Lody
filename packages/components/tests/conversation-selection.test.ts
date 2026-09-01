// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readConversationQuoteSelection } from '../src/components/ai-gui/conversation-selection';

function selectText(element: HTMLElement): Selection {
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  if (!selection) {
    throw new Error('jsdom selection is unavailable');
  }
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

describe('readConversationQuoteSelection', () => {
  it('reads selected conversation text as a session_text payload', () => {
    const root = document.createElement('div');
    const bubble = document.createElement('div');
    bubble.setAttribute('data-native-selection-allow', '');
    bubble.setAttribute('data-session-turn-id', 'msg-1');
    bubble.setAttribute('data-session-turn-role', 'user');
    bubble.setAttribute('data-session-turn-author', 'zhang');
    bubble.textContent = '把本机最新截屏发我';
    root.appendChild(bubble);
    document.body.appendChild(root);

    const selection = selectText(bubble);
    const range = selection.getRangeAt(0);
    range.getBoundingClientRect = () =>
      ({
        top: 8,
        left: 8,
        bottom: 24,
        right: 80,
        width: 72,
        height: 16,
        x: 8,
        y: 8,
        toJSON: () => ({}),
      }) as DOMRect;

    const quote = readConversationQuoteSelection(selection, root);
    expect(quote?.payload).toEqual({
      source: 'session_text',
      commentBody: '把本机最新截屏发我',
      authorName: 'zhang',
      turnId: 'msg-1',
      role: 'user',
    });

    root.remove();
  });

  it('ignores a composer selection', () => {
    const root = document.createElement('div');
    const composer = document.createElement('textarea');
    composer.setAttribute('data-keyboard-nav', 'composer');
    composer.value = 'draft';
    root.appendChild(composer);
    document.body.appendChild(root);
    composer.focus();
    composer.select();

    expect(readConversationQuoteSelection(window.getSelection(), root)).toBeNull();
    root.remove();
  });
});
