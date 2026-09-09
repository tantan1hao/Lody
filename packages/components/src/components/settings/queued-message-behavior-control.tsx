import { useTranslation } from 'react-i18next';
import type { QueuedMessageBehavior } from '@/atoms';
import { cn } from '@/lib/utils';

export type QueuedMessageBehaviorControlProps = {
  value: QueuedMessageBehavior;
  onChange: (value: QueuedMessageBehavior) => void;
  className?: string;
  /** Compact sits in the session composer footer next to send/stop. */
  size?: 'default' | 'compact';
  /** Hide native steer when this agent has not advertised `acknowledgedSteer`. */
  guideDisabled?: boolean;
};

export function QueuedMessageBehaviorControl({
  value,
  onChange,
  className,
  size = 'default',
  guideDisabled = false,
}: QueuedMessageBehaviorControlProps) {
  const { t } = useTranslation();
  const compact = size === 'compact';
  const options: Array<{ value: QueuedMessageBehavior; label: string; disabled?: boolean }> = [
    {
      value: 'queue',
      label: t('settings.general.sessions.queuedMessageBehavior.queue', 'Queue'),
    },
    {
      value: 'guide',
      label: t('settings.general.sessions.queuedMessageBehavior.guide', 'Steer'),
      disabled: guideDisabled,
    },
  ];

  return (
    <div
      role="radiogroup"
      aria-label={t(
        'settings.general.sessions.queuedMessageBehavior.label',
        'Queued message behavior'
      )}
      className={cn(
        'inline-grid grid-cols-2 rounded-full border border-border/70 bg-muted/60 p-0.5',
        compact ? 'h-7' : 'h-8',
        className
      )}
    >
      {options.map((option) => {
        const selected = value === option.value;
        const disabled = option.disabled === true;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-disabled={disabled}
            disabled={disabled}
            title={
              disabled
                ? t(
                    'settings.general.sessions.queuedMessageBehavior.guideUnavailable',
                    'This agent cannot steer an in-flight turn. Messages wait in the queue.'
                  )
                : undefined
            }
            onClick={() => {
              if (!disabled) onChange(option.value);
            }}
            className={cn(
              'rounded-full text-xs font-medium transition-colors',
              compact ? 'min-w-10 px-2' : 'min-w-16 px-3',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
              disabled && 'cursor-not-allowed opacity-50',
              selected
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
