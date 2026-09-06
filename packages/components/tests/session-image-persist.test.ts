import { describe, expect, it } from 'vitest';
import {
  resolveSessionImageMimeType,
  resolveSessionImagePersistPath,
  validateSessionImageFile,
} from '../src/lib/session-image-upload';

describe('resolveSessionImagePersistPath', () => {
  it('uses official upload when that service exists and the client is signed in', () => {
    expect(
      resolveSessionImagePersistPath({
        useOfficialUpload: true,
        hasAuthToken: true,
        hasRuntime: true,
        hasMachineId: true,
        machineSupportsSend: true,
      })
    ).toBe('official');
  });

  it('sends to the session machine when official upload is absent', () => {
    expect(
      resolveSessionImagePersistPath({
        useOfficialUpload: false,
        hasAuthToken: false,
        hasRuntime: true,
        hasMachineId: true,
        machineSupportsSend: true,
      })
    ).toBe('machine');
  });

  it('names the missing machine instead of inventing a cloud upload', () => {
    expect(
      resolveSessionImagePersistPath({
        useOfficialUpload: false,
        hasAuthToken: false,
        hasRuntime: true,
        hasMachineId: false,
        machineSupportsSend: false,
      })
    ).toBe('missing_machine');
  });

  it('names an old machine that does not advertise session image send', () => {
    expect(
      resolveSessionImagePersistPath({
        useOfficialUpload: false,
        hasAuthToken: false,
        hasRuntime: true,
        hasMachineId: true,
        machineSupportsSend: false,
      })
    ).toBe('unsupported_machine');
  });
});

describe('resolveSessionImageMimeType', () => {
  it('fills an empty Finder MIME from a composer image extension', () => {
    expect(resolveSessionImageMimeType(new File(['png'], 'shot.png'))).toBe('image/png');
    expect(validateSessionImageFile(new File(['png'], 'shot.png'))).toBeNull();
  });

  it('keeps an explicit non-image MIME as rejected', () => {
    expect(
      resolveSessionImageMimeType(new File(['pdf'], 'shot.png', { type: 'application/pdf' }))
    ).toBeNull();
  });
});
