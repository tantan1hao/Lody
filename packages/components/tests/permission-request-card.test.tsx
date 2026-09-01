// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getPrimaryPermissionOptionId,
  PermissionRequestCard,
  type PermissionOption,
} from '../src/components/sessions/floating-permission-request';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string): string => (typeof fallback === 'string' ? fallback : key),
    i18n: { language: 'en' },
  }),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const OPTIONS: PermissionOption[] = [
  { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
  { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
];

describe('getPrimaryPermissionOptionId', () => {
  it('prefers the first allow-kind option', () => {
    expect(
      getPrimaryPermissionOptionId([
        { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
        { optionId: 'allow_always', name: 'Always allow', kind: 'allow_always' },
      ])
    ).toBe('allow_always');
  });

  it('falls back to the first published option', () => {
    expect(
      getPrimaryPermissionOptionId([{ optionId: 'custom', name: 'Continue', kind: 'other' }])
    ).toBe('custom');
  });
});

describe('PermissionRequestCard Enter confirm', () => {
  let root: Root;
  let container: HTMLDivElement;
  let onSelect: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    onSelect = vi.fn();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  const renderCard = async (
    props: Partial<Parameters<typeof PermissionRequestCard>[0]> = {}
  ): Promise<void> => {
    await act(async () => {
      root.render(
        createElement(PermissionRequestCard, {
          options: OPTIONS,
          onSelect,
          confirmOnEnter: true,
          ...props,
        })
      );
    });
  };

  it('confirms the primary allow option on Enter when nothing else owns the key', async () => {
    await renderCard();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('allow_once');
    expect(container.querySelector('kbd')?.textContent).toBe('Enter');
  });

  it('leaves Enter on a focused option button so that button keeps its own action', async () => {
    await renderCard();
    const deny = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Deny')
    );
    expect(deny).toBeTruthy();

    await act(async () => {
      deny?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      );
    });

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('does not confirm while IME is composing', async () => {
    await renderCard();

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true })
      );
    });

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('does not install the shortcut unless confirmOnEnter is set', async () => {
    await renderCard({ confirmOnEnter: false });

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    expect(onSelect).not.toHaveBeenCalled();
    expect(container.querySelector('kbd')).toBeNull();
  });
});
