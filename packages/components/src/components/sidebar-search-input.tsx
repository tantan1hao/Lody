import { type Ref } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SidebarSearchInputProps = {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  ariaLabel: string;
  clearAriaLabel: string;
  inputRef?: Ref<HTMLInputElement>;
  className?: string;
};

export function SidebarSearchInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  clearAriaLabel,
  inputRef,
  className,
}: SidebarSearchInputProps) {
  return (
    <label
      className={cn(
        'flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md border border-sidebar-border/70 bg-sidebar-hover/35 px-2',
        'text-sidebar-foreground transition-colors',
        'focus-within:border-sidebar-border focus-within:bg-sidebar-hover/70',
        className
      )}
    >
      <Search
        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
        strokeWidth={1.8}
        aria-hidden="true"
      />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.stopPropagation();
          if (value) {
            event.preventDefault();
            onChange('');
            return;
          }
          event.currentTarget.blur();
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoComplete="off"
        spellCheck={false}
        className="min-w-0 flex-1 border-none bg-transparent text-[0.8rem] leading-tight outline-none placeholder:text-muted-foreground focus:outline-none focus:ring-0 [appearance:textfield] [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label={clearAriaLabel}
          className="-mr-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-sidebar-hover hover:text-sidebar-hover-foreground"
        >
          <X className="h-3 w-3" strokeWidth={1.8} aria-hidden="true" />
        </button>
      ) : null}
    </label>
  );
}
