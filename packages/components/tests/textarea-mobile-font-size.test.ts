import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { Textarea } from '../src/ui/textarea';

describe('textarea mobile font size', () => {
  it('uses 16px text on phone and 14px from md, matching Input', () => {
    const markup = renderToStaticMarkup(createElement(Textarea));
    expect(markup).toContain('text-base');
    expect(markup).toContain('md:text-sm');
  });
});
