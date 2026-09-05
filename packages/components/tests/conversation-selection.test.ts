// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import {
  readConversationQuoteSelection,
  resolveConversationQuotePayload,
} from '../src/components/ai-gui/conversation-selection';

function selectIn(element: HTMLElement): Selection {
  const selection = window.getSelection();
  if (!selection) {
    throw new Error('jsdom selection is unavailable');
  }
  const range = document.createRange();
  range.selectNodeContents(element);
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
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

describe('readConversationQuoteSelection', () => {
  it('reads a quote from selectable conversation text', () => {
    const container = document.createElement('div');
    const bubble = document.createElement('div');
    bubble.setAttribute('data-native-selection-allow', '');
    bubble.setAttribute('data-session-turn-id', 'turn-1');
    bubble.setAttribute('data-session-turn-role', 'assistant');
    bubble.setAttribute('data-session-turn-author', 'Ada');
    bubble.textContent = 'Keep the original turn id.';
    container.appendChild(bubble);
    document.body.appendChild(container);

    const quote = readConversationQuoteSelection(selectIn(bubble), container);
    expect(quote?.payload).toEqual({
      source: 'session_text',
      commentBody: 'Keep the original turn id.',
      authorName: 'Ada',
      turnId: 'turn-1',
      role: 'assistant',
    });

    container.remove();
  });

  it('ignores whitespace-only selections and composer text', () => {
    const container = document.createElement('div');
    const bubble = document.createElement('div');
    bubble.setAttribute('data-native-selection-allow', '');
    bubble.textContent = '   ';
    const composer = document.createElement('textarea');
    composer.setAttribute('data-keyboard-nav', 'composer');
    composer.value = 'draft prompt';
    container.appendChild(bubble);
    container.appendChild(composer);
    document.body.appendChild(container);

    expect(readConversationQuoteSelection(selectIn(bubble), container)).toBeNull();

    composer.focus();
    composer.select();
    expect(readConversationQuoteSelection(window.getSelection(), container)).toBeNull();

    container.remove();
  });

  it('reads a quote without a scroll container when the conversation ancestor exists', () => {
    const conversation = document.createElement('div');
    conversation.setAttribute('data-session-conversation', '');
    const bubble = document.createElement('div');
    bubble.setAttribute('data-native-selection-allow', '');
    bubble.setAttribute('data-session-turn-id', 'turn-2');
    bubble.setAttribute('data-session-turn-role', 'user');
    bubble.textContent = 'Quote me.';
    conversation.appendChild(bubble);
    document.body.appendChild(conversation);

    const quote = readConversationQuoteSelection(selectIn(bubble), null);
    expect(quote?.payload).toEqual({
      source: 'session_text',
      commentBody: 'Quote me.',
      turnId: 'turn-2',
      role: 'user',
    });

    conversation.remove();
  });

  it('quotes the fallback text when the live selection is empty', () => {
    const payload = resolveConversationQuotePayload({
      selection: null,
      fallbackText: 'Whole reply.',
      turnId: 'turn-3',
      role: 'assistant',
    });
    expect(payload).toEqual({
      source: 'session_text',
      commentBody: 'Whole reply.',
      turnId: 'turn-3',
      role: 'assistant',
    });
  });
});
