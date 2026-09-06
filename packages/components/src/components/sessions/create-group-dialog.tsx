import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useAtomValue } from 'jotai';
import { Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  GROUP_MAX_MEMBERS,
  findRoomByMemberSet,
  isRoomSession,
  machineSupportsSessionGroupChatProtocol,
  normalizeMemberRoleIds,
  type AgentRoleId,
  type SessionId,
  type SessionToCreate,
} from '@lody/shared';
import { userAtom } from '@/atoms';
import { localMachineIdAtom } from '@/atoms/local-probe';
import { sessionListAtom } from '@/atoms/doc-meta';
import { currentWorkspaceSlugAtom } from '@/atoms/workspace-context';
import { getMachineMetaByIdAtomFamily } from '@/atoms/machines';
import { useSessionActions } from '@/hooks/use-session-actions';
import {
  useAgentRoleAvailability,
  useWorkspaceAgentRoles,
} from '@/hooks/use-workspace-agent-roles';
import { Button } from '@/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import { Input } from '@/ui/input';
import { Checkbox } from '@/ui/checkbox';

export function CreateGroupChatButton() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <Users className="h-4 w-4" />
        {t('sessions.newGroup', 'New group')}
      </Button>
      <CreateGroupDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

export function CreateGroupDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { createSession } = useSessionActions();
  const workspaceSlug = useAtomValue(currentWorkspaceSlugAtom);
  const user = useAtomValue(userAtom);
  const localMachineId = useAtomValue(localMachineIdAtom);
  const localMachine = useAtomValue(getMachineMetaByIdAtomFamily(localMachineId ?? undefined));
  const sessions = useAtomValue(sessionListAtom);
  const { roles } = useWorkspaceAgentRoles();
  const availability = useAgentRoleAvailability(roles);
  const canHost = machineCanHostGroupChat(localMachine);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const availableRoles = useMemo(
    () => roles.filter((role) => role.visibility !== undefined),
    [roles]
  );

  const goToRoom = useCallback(
    (sessionId: SessionId) => {
      if (!workspaceSlug) return;
      void navigate({
        to: '/$workspaceName/sessions/$sessionId',
        params: { workspaceName: workspaceSlug, sessionId },
      });
    },
    [navigate, workspaceSlug]
  );

  const submit = useCallback(async () => {
    setError(null);
    const memberRoleIds = normalizeMemberRoleIds(selected);
    if (memberRoleIds.length === 0) {
      setError(t('sessions.groupNeedsMembers', 'Pick at least one Agent Role.'));
      return;
    }
    if (!user?.id || !localMachineId) {
      setError(t('sessions.groupNeedsMachine', 'A local machine is required to host the room.'));
      return;
    }
    if (!canHost) {
      setError(t('sessions.groupNeedsProtocol', 'This machine does not support group chat yet.'));
      return;
    }
    const existing = findRoomByMemberSet(
      sessions.filter((session) => isRoomSession(session) && !session.isArchived),
      memberRoleIds
    );
    if (existing) {
      onOpenChange(false);
      goToRoom(existing.id);
      return;
    }
    setBusy(true);
    try {
      const payload: SessionToCreate = {
        machineId: localMachineId,
        userId: user.id,
        cliType: 'builtin',
        agentType: 'codex',
        title: name.trim() || t('sessions.groupDefaultTitle', 'Group'),
        titleSource: 'user',
        sessionKind: 'room',
        memberRoleIds,
      };
      const { sessionId } = await createSession(payload);
      onOpenChange(false);
      setSelected([]);
      setName('');
      goToRoom(sessionId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [
    createSession,
    goToRoom,
    canHost,
    localMachineId,
    name,
    onOpenChange,
    selected,
    sessions,
    t,
    user?.id,
  ]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('sessions.newGroup', 'New group')}</DialogTitle>
          <DialogDescription>
            {t(
              'sessions.newGroupDescription',
              'Members are Agent Roles. The same set of Roles reopens the existing room.'
            )}
          </DialogDescription>
        </DialogHeader>
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t('sessions.groupNamePlaceholder', 'Group name')}
        />
        <div className="flex max-h-64 flex-col gap-2 overflow-y-auto">
          {availableRoles.map((role) => {
            const checked = selected.includes(role.id);
            const roleState = availability.resolve(role);
            const unavailable = roleState.kind === 'unavailable';
            const disabled = unavailable || (!checked && selected.length >= GROUP_MAX_MEMBERS);
            return (
              <label key={role.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={checked}
                  disabled={disabled}
                  onCheckedChange={(value) => {
                    setSelected((current) =>
                      value === true
                        ? [...current, role.id]
                        : current.filter((id) => id !== role.id)
                    );
                  }}
                />
                <span>
                  {role.emoji ? `${role.emoji} ` : ''}
                  {role.name}
                  {unavailable ? (
                    <span className="ml-1 text-xs text-muted-foreground">
                      ({t('sessions.roleUnavailable', 'unavailable')})
                    </span>
                  ) : null}
                </span>
              </label>
            );
          })}
        </div>
        {!canHost ? (
          <p className="text-sm text-muted-foreground">
            {t('sessions.groupNeedsProtocol', 'This machine does not support group chat yet.')}
          </p>
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={busy}>
            {t('sessions.createGroup', 'Create group')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function machineCanHostGroupChat(machine: { protocolCapabilities?: Record<string, number> } | null) {
  return machineSupportsSessionGroupChatProtocol(machine);
}

export function asAgentRoleIds(ids: readonly string[]): AgentRoleId[] {
  return normalizeMemberRoleIds(ids);
}
