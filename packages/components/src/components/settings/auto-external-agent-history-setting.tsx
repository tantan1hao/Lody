import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { autoSyncExternalAgentHistoryAtom } from '@/atoms';
import { Switch } from '@/ui/switch';
import { CompactRow, CompactSection } from './compact-layout';

export function AutoExternalAgentHistorySection() {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useAtom(autoSyncExternalAgentHistoryAtom);

  return (
    <CompactSection
      title={t('settings.autoExternalHistory.title', 'Other agent sessions')}
      description={t(
        'settings.autoExternalHistory.description',
        'Bring conversations that Claude Code, Codex, and other ACP agents created in a local project into Lody. Conflicts still need a manual import.'
      )}
    >
      <CompactRow
        label={t('settings.autoExternalHistory.label', 'Auto-sync sessions from other agents')}
        helper={t(
          'settings.autoExternalHistory.helper',
          'When this device can reach the project, Lody lists those agents and imports new sessions in the background.'
        )}
      >
        <Switch
          checked={enabled}
          onCheckedChange={setEnabled}
          aria-label={t(
            'settings.autoExternalHistory.label',
            'Auto-sync sessions from other agents'
          )}
        />
      </CompactRow>
    </CompactSection>
  );
}
