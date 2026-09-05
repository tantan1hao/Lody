import type { ReactNode } from 'react';
import { Bug, GitFork, Layers, MessageCircleQuestion } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { ComposerSessionSkill } from '@/lib/composer-session-skill';

const SKILLS: ReadonlyArray<{
  id: ComposerSessionSkill;
  icon: ReactNode;
  labelKey: string;
  labelFallback: string;
  descriptionKey: string;
  descriptionFallback: string;
}> = [
  {
    id: 'plan',
    icon: <GitFork className="h-3.5 w-3.5 text-orange-500" />,
    labelKey: 'chat.sessionSkill.plan',
    labelFallback: 'Plan',
    descriptionKey: 'chat.sessionSkill.planDescription',
    descriptionFallback: 'Generate an implementation plan',
  },
  {
    id: 'debug',
    icon: <Bug className="h-3.5 w-3.5 text-red-500" />,
    labelKey: 'chat.sessionSkill.debug',
    labelFallback: 'Debug',
    descriptionKey: 'chat.sessionSkill.debugDescription',
    descriptionFallback: 'Pinpoint the root cause of an issue',
  },
  {
    id: 'multitask',
    icon: <Layers className="h-3.5 w-3.5 text-violet-500" />,
    labelKey: 'chat.sessionSkill.multitask',
    labelFallback: 'Multitask',
    descriptionKey: 'chat.sessionSkill.multitaskDescription',
    descriptionFallback: 'Split work across parallel sessions',
  },
  {
    id: 'ask',
    icon: <MessageCircleQuestion className="h-3.5 w-3.5 text-emerald-500" />,
    labelKey: 'chat.sessionSkill.ask',
    labelFallback: 'Ask',
    descriptionKey: 'chat.sessionSkill.askDescription',
    descriptionFallback: 'Answer without making edits',
  },
];

export function ComposerSessionSkills({
  availableSkills,
  activeSkill,
  disabled = false,
  onSelect,
}: {
  /** When set, only these skills render. Empty/undefined hides the row. */
  availableSkills?: readonly ComposerSessionSkill[];
  activeSkill?: ComposerSessionSkill | null;
  disabled?: boolean;
  onSelect: (skill: ComposerSessionSkill) => void;
}) {
  const { t } = useTranslation();
  const skills =
    availableSkills === undefined
      ? SKILLS
      : SKILLS.filter((skill) => availableSkills.includes(skill.id));

  if (skills.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-1 pt-0.5 pb-2" data-composer-session-skills="">
      {skills.map((skill) => {
        const label = t(skill.labelKey, skill.labelFallback);
        const description = t(skill.descriptionKey, skill.descriptionFallback);
        const active = activeSkill === skill.id;
        return (
          <button
            key={skill.id}
            type="button"
            disabled={disabled}
            title={description}
            aria-pressed={active}
            aria-label={label}
            onClick={() => onSelect(skill.id)}
            className={cn(
              'inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium',
              'text-muted-foreground transition-colors',
              'hover:bg-muted/70 hover:text-foreground',
              'disabled:cursor-not-allowed disabled:opacity-50',
              active && 'bg-muted text-foreground'
            )}
          >
            {skill.icon}
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
