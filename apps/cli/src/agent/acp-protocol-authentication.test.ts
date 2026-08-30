import { describe, expect, it, vi } from 'vitest';

import type { Logger } from '@/utils/logger';
import {
  authenticateAcpProtocol,
  findTrustedProtocolAuthorizationUrl,
  selectAcpProtocolAuthMethodId,
} from './acp-protocol-authentication';

const createSilentLogger = (): Logger => ({
  info: () => {},
  warn: () => {},
  error: () => {},
  success: () => {},
  debug: () => {},
  setLevel: () => {},
  child: () => createSilentLogger(),
  close: async () => {},
});

describe('selectAcpProtocolAuthMethodId', () => {
  it('prefers Google personal OAuth when advertised', () => {
    expect(
      selectAcpProtocolAuthMethodId([
        { id: 'gemini-api-key', name: 'API key' },
        { id: 'oauth-personal', name: 'Google' },
        { id: 'oauth-business', name: 'Workspace' },
      ])
    ).toBe('oauth-personal');
  });

  it('reads v2 methodId fields and skips terminal methods', () => {
    expect(
      selectAcpProtocolAuthMethodId([
        { methodId: 'terminal-login', type: 'terminal', name: 'Terminal' },
        { methodId: 'agent-login', name: 'Agent login' },
      ])
    ).toBe('agent-login');
  });

  it('falls back to oauth-personal for Antigravity when initialize omitted methods', () => {
    expect(selectAcpProtocolAuthMethodId([], 'antigravity-acp')).toBe('oauth-personal');
    expect(selectAcpProtocolAuthMethodId([], 'auggie')).toBeUndefined();
  });
});

describe('findTrustedProtocolAuthorizationUrl', () => {
  it('accepts Google account authorization URLs', () => {
    expect(
      findTrustedProtocolAuthorizationUrl(
        'Open https://accounts.google.com/o/oauth2/v2/auth?client_id=test'
      )
    ).toBe('https://accounts.google.com/o/oauth2/v2/auth?client_id=test');
  });

  it('rejects untrusted hosts', () => {
    expect(findTrustedProtocolAuthorizationUrl('Open https://evil.example/oauth')).toBeUndefined();
  });
});

describe('authenticateAcpProtocol', () => {
  it('calls authenticate with the preferred advertised method', async () => {
    const authenticate = vi.fn(async () => ({}));
    const initialize = vi.fn(async () => ({
      protocolVersion: 1,
      authMethods: [
        { id: 'oauth-business', name: 'Workspace' },
        { id: 'oauth-personal', name: 'Google' },
      ],
    }));

    await expect(
      authenticateAcpProtocol({
        cliType: 'registry',
        agentType: 'antigravity-acp',
        logger: createSilentLogger(),
        connect: async () => ({
          connection: { initialize, authenticate },
        }),
      })
    ).resolves.toEqual({ success: true, disposition: 'authenticated' });
    expect(authenticate).toHaveBeenCalledWith({ methodId: 'oauth-personal' });
  });

  it('returns cancelled when the abort signal fires', async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(
      authenticateAcpProtocol({
        cliType: 'registry',
        agentType: 'antigravity-acp',
        logger: createSilentLogger(),
        signal: abort.signal,
        connect: async () => {
          throw new Error('should not connect');
        },
      })
    ).resolves.toEqual({ success: true, disposition: 'cancelled' });
  });
});
