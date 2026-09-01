import { useMemo, useRef } from 'react';
import { useAtomValue } from 'jotai';
import { collectLiveSessionStatuses, type SessionStatus } from '@lody/shared';
import { lodyPresenceNowMsAtom, lodyPresenceStatesAtom } from '@/atoms/presence';

const EMPTY_LIVE_SESSION_STATUSES: ReadonlyMap<string, SessionStatus> = new Map();

/**
 * Presence-backed working/waiting statuses for a session list.
 * The returned Map keeps identity when only the 30s presence clock advanced.
 */
export const useLiveSessionStatuses = (
  sessions: ReadonlyArray<{ id: string }>
): ReadonlyMap<string, SessionStatus> => {
  const presenceStates = useAtomValue(lodyPresenceStatesAtom);
  const presenceNowMs = useAtomValue(lodyPresenceNowMsAtom);
  const previousRef = useRef<ReadonlyMap<string, SessionStatus>>(EMPTY_LIVE_SESSION_STATUSES);

  return useMemo(() => {
    const next = collectLiveSessionStatuses(
      sessions.map((session) => session.id),
      presenceStates,
      presenceNowMs,
      previousRef.current
    );
    previousRef.current = next;
    return next;
  }, [presenceNowMs, presenceStates, sessions]);
};
