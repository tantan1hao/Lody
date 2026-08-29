import { fuzzyMatch } from '@/components/commands/fuzzy-match';
import type { FuzzyOptionText } from '@/lib/fuzzy-option-filter';

/**
 * Fields a sidebar row can be found by. Title is primary; project, repo,
 * branch, machine, and imported-agent labels sit behind it so typing a
 * visible chat name never loses to a provider id.
 *
 * `externalHistoryProvider` is the ACP `{ cliType, agentType }` object (or a
 * preformatted `cliType:agentType` key). Never treat the object as a string —
 * calling `.trim()` on it is `TypeError: i.trim is not a function`.
 */
export type SidebarSearchableItem = {
  title?: string | null;
  subtitle?: string | null;
  sectionLabel?: string | null;
  repoFullName?: string | null;
  branchName?: string | null;
  machineName?: string | null;
  externalHistoryProvider?:
    | string
    | { cliType?: string | null; agentType?: string | null }
    | null;
  kind?: string | null;
};

function asSearchText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function historyProviderSearchTexts(
  provider: SidebarSearchableItem['externalHistoryProvider']
): string[] {
  if (!provider) return [];
  if (typeof provider === 'string') {
    const text = asSearchText(provider);
    return text ? [text] : [];
  }
  const cliType = asSearchText(provider.cliType);
  const agentType = asSearchText(provider.agentType);
  const parts = [cliType, agentType, cliType && agentType ? `${cliType}:${agentType}` : ''];
  return parts.filter(Boolean);
}

export function sidebarQueryIsActive(query: string): boolean {
  return asSearchText(query).length > 0;
}

export function getSidebarSearchableText(item: SidebarSearchableItem): FuzzyOptionText {
  return {
    primary: asSearchText(item.title),
    secondary: [
      asSearchText(item.subtitle),
      asSearchText(item.sectionLabel),
      asSearchText(item.repoFullName),
      asSearchText(item.branchName),
      asSearchText(item.machineName),
      asSearchText(item.kind),
      ...historyProviderSearchTexts(item.externalHistoryProvider),
    ],
  };
}

export function textMatchesSidebarQuery(text: FuzzyOptionText, query: string): boolean {
  const terms = asSearchText(query).toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const fields = [text.primary, ...(text.secondary ?? [])].map(asSearchText).filter(Boolean);
  return terms.every((term) => fields.some((field) => fuzzyMatch(term, field) !== null));
}

/**
 * Filter a recency-sorted sidebar list without re-ranking. The command palette
 * re-scores because it is a jump list; the sidebar is a view of the same
 * timeline with rows hidden.
 */
export function filterSidebarItems<T>(
  items: readonly T[],
  query: string,
  getText: (item: T) => FuzzyOptionText
): readonly T[] {
  if (!sidebarQueryIsActive(query)) return items;
  return items.filter((item) => textMatchesSidebarQuery(getText(item), query));
}

export function filterSidebarSearchableItems<T extends SidebarSearchableItem>(
  items: readonly T[],
  query: string
): readonly T[] {
  return filterSidebarItems(items, query, getSidebarSearchableText);
}

export function projectNameMatchesSidebarQuery(name: string, query: string): boolean {
  return textMatchesSidebarQuery({ primary: name }, query);
}
