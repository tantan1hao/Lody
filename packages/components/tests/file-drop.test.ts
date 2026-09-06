// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { splitImageAndFileAttachments } from '../src/lib/file-drop';

describe('splitImageAndFileAttachments', () => {
  it('routes picker selections by MIME type rather than filename', () => {
    const imageWithTextExtension = new File(['image'], 'preview.txt', { type: 'image/png' });
    const fileWithImageExtension = new File(['document'], 'report.png', {
      type: 'application/pdf',
    });
    const fileWithoutMime = new File(['data'], 'archive.bin');
    const finderPngWithoutMime = new File(['png'], 'shot.png');

    expect(
      splitImageAndFileAttachments([
        imageWithTextExtension,
        fileWithImageExtension,
        fileWithoutMime,
        finderPngWithoutMime,
      ])
    ).toEqual({
      images: [imageWithTextExtension, finderPngWithoutMime],
      attachments: [fileWithImageExtension, fileWithoutMime],
    });
  });
});
