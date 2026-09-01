import type { AgentConfigCliType } from '../ai';

export const DEFAULT_PROJECT_SKILL_DIR = '.agents/skills';
export const DEFAULT_AGENTS_GLOBAL_SKILL_DIR = '~/.agents/skills';
export const DEFAULT_GLOBAL_SKILL_DIR = '~/.config/agents/skills';
const CLAUDE_PROJECT_SKILL_DIR = '.claude/skills';
const CLAUDE_GLOBAL_SKILL_DIR = '~/.claude/skills';
/**
 * Claude Code 插件带的技能。市场名、插件名、cache 版本是安装时才知道的，所以
 * 用通配段，由 `expandHomeSkillDirGlobs` 在扫描前落成真实目录。
 *
 * 市场目录（实测本机技能几乎都在这两种里）：
 *   ~/.claude/plugins/marketplaces/<市场>/skills/<技能>/SKILL.md
 *   ~/.claude/plugins/marketplaces/<市场>/<plugins|external_plugins>/<插件>/skills/<技能>/SKILL.md
 * 已安装副本（`installed_plugins.json` 的 installPath）：
 *   ~/.claude/plugins/cache/<市场>/<插件>/<版本>/skills/<技能>/SKILL.md
 * 本地仓库检出：
 *   ~/.claude/plugins/repos/<仓库>/skills/<技能>/SKILL.md
 *
 * 不加进来的话，`~/.claude/skills` 里那几个手写的之外，插件装的一个都不出现。
 * 不把插件根目录本身登记成 skill dir，避免把 hooks/commands 当 SKILL.md 扫进去。
 */
const CLAUDE_PLUGIN_SKILL_DIRS = [
  '~/.claude/plugins/marketplaces/*/skills',
  '~/.claude/plugins/marketplaces/*/*/*/skills',
  '~/.claude/plugins/cache/*/*/skills',
  '~/.claude/plugins/cache/*/*/*/skills',
  '~/.claude/plugins/repos/*/skills',
];
/**
 * Claude 用户 settings、项目 settings、以及插件 `hooks/hooks.json`。
 * 扫的是文件，不是 `.git/hooks`，也不是随便一个叫 hooks 的源码目录。
 */
export const ALL_KNOWN_GLOBAL_HOOK_FILES = [
  '~/.claude/settings.json',
  '~/.claude/settings.local.json',
  '~/.claude/hooks/hooks.json',
  '~/.claude/plugins/marketplaces/*/*/hooks/hooks.json',
  '~/.claude/plugins/marketplaces/*/*/*/hooks/hooks.json',
  '~/.claude/plugins/cache/*/*/hooks/hooks.json',
  '~/.claude/plugins/cache/*/*/*/hooks/hooks.json',
];
export const ALL_KNOWN_PROJECT_HOOK_FILES = [
  '.claude/settings.json',
  '.claude/settings.local.json',
  '.claude/hooks/hooks.json',
];
const FACTORY_COMPAT_PROJECT_SKILL_DIR = '.agent/skills';
/** Codex ships its own built-in ("system") skills under this home-relative
   catalog dir, separate from the user-authored skills in the agent's global
   dir. Surfaced under the dedicated `'system'` scope. */
const CODEX_SYSTEM_SKILL_DIR = '~/.codex/skills/.system';

type SkillDirsByAgentType = {
  projectDirs: string[];
  globalDirs: string[];
  /** Home-relative dirs holding the agent's built-in/system skills. Scanned like
     global dirs but surfaced under the `'system'` scope. Most agents have none. */
  systemDirs: string[];
};

function skillDirs(
  projectDirs: string[],
  globalDirs: string[],
  systemDirs: string[] = []
): SkillDirsByAgentType {
  return { projectDirs, globalDirs, systemDirs };
}

/** Shared by `claude` and its ACP/CLI aliases so a key never travels without
 *  the plugin / agents locations the unsuffixed provider already has. */
const CLAUDE_FAMILY_SKILL_DIRS = skillDirs(
  [CLAUDE_PROJECT_SKILL_DIR],
  [CLAUDE_GLOBAL_SKILL_DIR, DEFAULT_AGENTS_GLOBAL_SKILL_DIR, ...CLAUDE_PLUGIN_SKILL_DIRS]
);

export const ACP_SKILL_DIRS_BY_AGENT_TYPE: Record<string, SkillDirsByAgentType> = {
  adal: skillDirs(['.adal/skills'], ['~/.adal/skills']),
  'aider-desk': skillDirs(['.aider-desk/skills'], ['~/.aider-desk/skills']),
  'amp-acp': skillDirs(
    [DEFAULT_PROJECT_SKILL_DIR, CLAUDE_PROJECT_SKILL_DIR],
    [DEFAULT_GLOBAL_SKILL_DIR, CLAUDE_GLOBAL_SKILL_DIR]
  ),
  amp: skillDirs(
    [DEFAULT_PROJECT_SKILL_DIR, CLAUDE_PROJECT_SKILL_DIR],
    [DEFAULT_GLOBAL_SKILL_DIR, CLAUDE_GLOBAL_SKILL_DIR]
  ),
  antigravity: skillDirs([DEFAULT_PROJECT_SKILL_DIR], ['~/.gemini/antigravity/skills']),
  'antigravity-cli': skillDirs([DEFAULT_PROJECT_SKILL_DIR], ['~/.gemini/antigravity-cli/skills']),
  astrbot: skillDirs(['data/skills'], ['~/.astrbot/data/skills']),
  auggie: skillDirs(
    [DEFAULT_PROJECT_SKILL_DIR, '.augment/skills', CLAUDE_PROJECT_SKILL_DIR],
    ['~/.augment/skills', DEFAULT_AGENTS_GLOBAL_SKILL_DIR]
  ),
  augment: skillDirs(['.augment/skills'], ['~/.augment/skills']),
  autohand: skillDirs([DEFAULT_PROJECT_SKILL_DIR, '.autohand/skills'], ['~/.autohand/skills']),
  'autohand-code': skillDirs(
    [DEFAULT_PROJECT_SKILL_DIR, '.autohand/skills'],
    ['~/.autohand/skills']
  ),
  bob: skillDirs(['.bob/skills'], ['~/.bob/skills']),
  claude: CLAUDE_FAMILY_SKILL_DIRS,
  'claude-acp': CLAUDE_FAMILY_SKILL_DIRS,
  'claude-code': CLAUDE_FAMILY_SKILL_DIRS,
  'claude-p': CLAUDE_FAMILY_SKILL_DIRS,
  cline: skillDirs(
    ['.cline/skills', '.clinerules/skills', CLAUDE_PROJECT_SKILL_DIR],
    ['~/.cline/skills']
  ),
  'codearts-agent': skillDirs(['.codeartsdoer/skills'], ['~/.codeartsdoer/skills']),
  codebuddy: skillDirs(['.codebuddy/skills'], ['~/.codebuddy/skills']),
  'codebuddy-code': skillDirs(['.codebuddy/skills'], ['~/.codebuddy/skills']),
  codemaker: skillDirs(['.codemaker/skills'], ['~/.codemaker/skills']),
  codestudio: skillDirs(['.codestudio/skills'], ['~/.codestudio/skills']),
  codex: skillDirs(
    [DEFAULT_PROJECT_SKILL_DIR],
    [DEFAULT_AGENTS_GLOBAL_SKILL_DIR],
    [CODEX_SYSTEM_SKILL_DIR]
  ),
  'codex-acp': skillDirs(
    [DEFAULT_PROJECT_SKILL_DIR],
    [DEFAULT_AGENTS_GLOBAL_SKILL_DIR],
    [CODEX_SYSTEM_SKILL_DIR]
  ),
  'command-code': skillDirs(['.commandcode/skills'], ['~/.commandcode/skills']),
  continue: skillDirs(['.continue/skills'], ['~/.continue/skills']),
  cortex: skillDirs([DEFAULT_PROJECT_SKILL_DIR, '.cortex/skills'], ['~/.snowflake/cortex/skills']),
  'cortex-code': skillDirs(
    [DEFAULT_PROJECT_SKILL_DIR, '.cortex/skills'],
    ['~/.snowflake/cortex/skills']
  ),
  crush: skillDirs(['.crush/skills'], ['~/.config/crush/skills']),
  cursor: skillDirs(
    [DEFAULT_PROJECT_SKILL_DIR, '.cursor/skills'],
    [DEFAULT_AGENTS_GLOBAL_SKILL_DIR, '~/.cursor/skills']
  ),
  deepagents: skillDirs([], []),
  devin: skillDirs(
    ['.devin/skills', '.windsurf/skills'],
    [DEFAULT_AGENTS_GLOBAL_SKILL_DIR, '~/.config/devin/skills']
  ),
  dexto: skillDirs([DEFAULT_PROJECT_SKILL_DIR], ['~/.agents/skills']),
  droid: skillDirs(['.factory/skills', FACTORY_COMPAT_PROJECT_SKILL_DIR], ['~/.factory/skills']),
  eve: skillDirs(['agent/skills'], []),
  factory: skillDirs(['.factory/skills', FACTORY_COMPAT_PROJECT_SKILL_DIR], ['~/.factory/skills']),
  'factory-droid': skillDirs(
    ['.factory/skills', FACTORY_COMPAT_PROJECT_SKILL_DIR],
    ['~/.factory/skills']
  ),
  'fast-agent': skillDirs([DEFAULT_PROJECT_SKILL_DIR], []),
  firebender: skillDirs([DEFAULT_PROJECT_SKILL_DIR], ['~/.firebender/skills']),
  forgecode: skillDirs(['.forge/skills'], ['~/.forge/skills']),
  gemini: skillDirs(
    [DEFAULT_PROJECT_SKILL_DIR, '.gemini/skills'],
    ['~/.gemini/skills', DEFAULT_AGENTS_GLOBAL_SKILL_DIR]
  ),
  'gemini-cli': skillDirs(
    [DEFAULT_PROJECT_SKILL_DIR, '.gemini/skills'],
    ['~/.gemini/skills', DEFAULT_AGENTS_GLOBAL_SKILL_DIR]
  ),
  'github-copilot': skillDirs(
    [DEFAULT_PROJECT_SKILL_DIR, '.github/skills', CLAUDE_PROJECT_SKILL_DIR],
    ['~/.copilot/skills', DEFAULT_AGENTS_GLOBAL_SKILL_DIR]
  ),
  'github-copilot-cli': skillDirs(
    [DEFAULT_PROJECT_SKILL_DIR, '.github/skills', CLAUDE_PROJECT_SKILL_DIR],
    ['~/.copilot/skills', DEFAULT_AGENTS_GLOBAL_SKILL_DIR]
  ),
  goose: skillDirs(
    [DEFAULT_PROJECT_SKILL_DIR, '.goose/skills'],
    ['~/.config/goose/skills', DEFAULT_AGENTS_GLOBAL_SKILL_DIR]
  ),
  grok: skillDirs([DEFAULT_PROJECT_SKILL_DIR], [DEFAULT_AGENTS_GLOBAL_SKILL_DIR]),
  'grok-build': skillDirs([DEFAULT_PROJECT_SKILL_DIR], [DEFAULT_AGENTS_GLOBAL_SKILL_DIR]),
  'hermes-agent': skillDirs(['.hermes/skills'], ['~/.hermes/skills']),
  iflow: skillDirs(['.iflow/skills'], ['~/.iflow/skills']),
  'iflow-cli': skillDirs(['.iflow/skills'], ['~/.iflow/skills']),
  'inference-sh': skillDirs(['.inferencesh/skills'], ['~/.inferencesh/skills']),
  jazz: skillDirs(['.jazz/skills'], ['~/.jazz/skills']),
  junie: skillDirs(['.junie/skills'], ['~/.junie/skills']),
  kilo: skillDirs(
    [DEFAULT_PROJECT_SKILL_DIR, '.kilo/skills', '.kilocode/skills'],
    ['~/.kilo/skills', '~/.kilocode/skills']
  ),
  'kilo-code': skillDirs(
    [DEFAULT_PROJECT_SKILL_DIR, '.kilo/skills', '.kilocode/skills'],
    ['~/.kilo/skills', '~/.kilocode/skills']
  ),
  kiro: skillDirs(['.kiro/skills'], ['~/.kiro/skills']),
  'kiro-cli': skillDirs(['.kiro/skills'], ['~/.kiro/skills']),
  kimi: skillDirs([DEFAULT_PROJECT_SKILL_DIR, '.kimi/skills'], []),
  'kimi-code': skillDirs([DEFAULT_PROJECT_SKILL_DIR, '.kimi/skills'], []),
  'kimi-code-cli': skillDirs([DEFAULT_PROJECT_SKILL_DIR, '.kimi/skills'], []),
  kode: skillDirs(['.kode/skills'], ['~/.kode/skills']),
  lingma: skillDirs(['.lingma/skills'], ['~/.lingma/skills']),
  loaf: skillDirs([DEFAULT_PROJECT_SKILL_DIR], [DEFAULT_AGENTS_GLOBAL_SKILL_DIR]),
  mcpjam: skillDirs(['.mcpjam/skills'], ['~/.mcpjam/skills']),
  'mistral-vibe': skillDirs(['.vibe/skills'], ['~/.vibe/skills', DEFAULT_AGENTS_GLOBAL_SKILL_DIR]),
  moxby: skillDirs(['.moxby/skills'], ['~/.moxby/skills']),
  mux: skillDirs(['.mux/skills'], ['~/.mux/skills']),
  neovate: skillDirs(['.neovate/skills'], ['~/.neovate/skills']),
  ona: skillDirs(['.ona/skills'], ['~/.ona/skills']),
  openclaw: skillDirs(['skills'], ['~/.openclaw/skills']),
  opencode: skillDirs(
    [DEFAULT_PROJECT_SKILL_DIR, '.opencode/skills', CLAUDE_PROJECT_SKILL_DIR],
    ['~/.config/opencode/skills', CLAUDE_GLOBAL_SKILL_DIR, DEFAULT_AGENTS_GLOBAL_SKILL_DIR]
  ),
  openhands: skillDirs(['.openhands/skills'], ['~/.openhands/skills']),
  pi: skillDirs([DEFAULT_PROJECT_SKILL_DIR, '.pi/skills'], ['~/.pi/agent/skills']),
  'pi-acp': skillDirs([DEFAULT_PROJECT_SKILL_DIR, '.pi/skills'], ['~/.pi/agent/skills']),
  pochi: skillDirs(['.pochi/skills'], ['~/.pochi/skills']),
  promptscript: skillDirs([DEFAULT_PROJECT_SKILL_DIR], []),
  qoder: skillDirs(['.qoder/skills'], ['~/.qoder/skills']),
  'qoder-cn': skillDirs(['.qoder/skills'], ['~/.qoder-cn/skills']),
  qwen: skillDirs(['.qwen/skills'], ['~/.qwen/skills']),
  'qwen-code': skillDirs(['.qwen/skills'], ['~/.qwen/skills']),
  reasonix: skillDirs(['.reasonix/skills'], ['~/.reasonix/skills']),
  replit: skillDirs([DEFAULT_PROJECT_SKILL_DIR], [DEFAULT_GLOBAL_SKILL_DIR]),
  roo: skillDirs(['.roo/skills'], ['~/.roo/skills']),
  rovodev: skillDirs(['.rovodev/skills'], ['~/.rovodev/skills']),
  tabnine: skillDirs(['.tabnine/agent/skills'], ['~/.tabnine/agent/skills']),
  'tabnine-cli': skillDirs(['.tabnine/agent/skills'], ['~/.tabnine/agent/skills']),
  terramind: skillDirs(['.terramind/skills'], ['~/.terramind/skills']),
  tinycloud: skillDirs(['.tinycloud/skills'], ['~/.tinycloud/skills']),
  trae: skillDirs(['.trae/skills'], ['~/.trae/skills']),
  'trae-cn': skillDirs(['.trae/skills'], ['~/.trae-cn/skills']),
  universal: skillDirs([DEFAULT_PROJECT_SKILL_DIR], [DEFAULT_GLOBAL_SKILL_DIR]),
  warp: skillDirs([DEFAULT_PROJECT_SKILL_DIR], [DEFAULT_AGENTS_GLOBAL_SKILL_DIR]),
  windsurf: skillDirs(['.windsurf/skills'], ['~/.codeium/windsurf/skills']),
  zed: skillDirs([DEFAULT_PROJECT_SKILL_DIR], [DEFAULT_AGENTS_GLOBAL_SKILL_DIR]),
  zencoder: skillDirs(['.zencoder/skills'], ['~/.zencoder/skills']),
  zenflow: skillDirs(['.zencoder/skills'], ['~/.zencoder/skills']),
};

/* Cache-invalidation version for the SWR skills cache. Bump when the skill dir
   mapping OR the cached `ProjectSkill` shape changes, so stale entries are
   discarded and re-fetched. v4: cache keys are user-scoped and skill content is
   budgeted/capped before storage to avoid carrying pre-budget oversized entries.
   v5: scanner includes one extra catalog-layout level under skill container dirs.
   v6: provider global dirs align with verified ~/.agents/skills aliases.
   v7: project `.agents/skills` is provider-specific, not a universal ACP fallback.
   v8: local/global scans include absolute SKILL.md paths for prompt expansion.
   v9: home scan also surfaces agent built-in `system` skills (codex
   `~/.codex/skills/.system`) under the new `'system'` scope.
   v10: grok/grok-build get `.agents/skills`; registry `*-acp`/`*-cli` ids
   inherit the unsuffixed provider mapping (e.g. antigravity-acp).
   v11: Claude family shares plugin cache/repos + `~/.agents/skills`; home and
   project scans also surface Claude `hook` files; registered globs match
   expanded dirs. */
export const KNOWN_SKILL_DIRS_VERSION = 11;

export const DEFAULT_PROJECT_SKILLS_CONTENT_BUDGET_BYTES = 2 * 1024 * 1024;
export const DEFAULT_PROJECT_SKILLS_RESULT_MAX_SKILLS = 5_000;

export const ALL_KNOWN_PROJECT_SKILL_DIRS: string[] = [
  ...new Set([
    'skills',
    'skills/.curated',
    'skills/.experimental',
    'skills/.system',
    DEFAULT_PROJECT_SKILL_DIR,
    ...Object.values(ACP_SKILL_DIRS_BY_AGENT_TYPE).flatMap((value) => value.projectDirs),
  ]),
].sort((left, right) => left.localeCompare(right));

export const ALL_KNOWN_GLOBAL_SKILL_DIRS: string[] = [
  ...new Set([
    DEFAULT_GLOBAL_SKILL_DIR,
    ...Object.values(ACP_SKILL_DIRS_BY_AGENT_TYPE).flatMap((value) => value.globalDirs),
  ]),
].sort((left, right) => left.localeCompare(right));

/** Home-relative dirs holding agents' built-in (system) skills. Scanned during
   the machine home scan and surfaced under the `'system'` scope, distinct from
   the user-authored `'global'` skills. */
export const ALL_KNOWN_SYSTEM_SKILL_DIRS: string[] = [
  ...new Set(Object.values(ACP_SKILL_DIRS_BY_AGENT_TYPE).flatMap((value) => value.systemDirs)),
].sort((left, right) => left.localeCompare(right));

export type ProjectSkillScope = 'project' | 'global' | 'system' | 'hook';

const PROJECT_SKILL_SCOPE_ORDER: Record<ProjectSkillScope, number> = {
  project: 0,
  global: 1,
  system: 2,
  hook: 3,
};

/** Stable display order: project, then global, then system, then hook. */
export function compareProjectSkillScope(
  left: ProjectSkillScope,
  right: ProjectSkillScope
): number {
  return PROJECT_SKILL_SCOPE_ORDER[left] - PROJECT_SKILL_SCOPE_ORDER[right];
}

/**
 * Whether `dir` is the registered pattern, a child of it, or an expansion of
 * a star-segment glob (star = one path segment). Mention filters and the
 * Settings "registered" badge both use this so a marketplace star pattern
 * matches the scanned `open-code-review/skills` dir instead of dropping it.
 */
export function skillDirMatchesPattern(dir: string, pattern: string): boolean {
  if (dir === pattern) {
    return true;
  }
  const dirParts = dir.split('/');
  const patternParts = pattern.split('/');
  if (dirParts.length < patternParts.length) {
    return false;
  }
  for (let i = 0; i < patternParts.length; i++) {
    const expected = patternParts[i];
    if (expected !== '*' && expected !== dirParts[i]) {
      return false;
    }
  }
  return true;
}

export function skillDirMatchesAny(dir: string, patterns: Iterable<string>): boolean {
  for (const pattern of patterns) {
    if (skillDirMatchesPattern(dir, pattern)) {
      return true;
    }
  }
  return false;
}

export type ProjectSkill = {
  id: string;
  name: string;
  description?: string;
  version?: string;
  author?: string;
  relativePath: string;
  /** Absolute SKILL.md path when known. Local/global scanners provide this for
     prompt expansion; GitHub scans intentionally omit it. */
  absolutePath?: string;
  isSymlink: boolean;
  /** When `isSymlink`, the project-relative directory the symlink resolves to
     (the canonical location of the real SKILL.md). Surfaced as the "original
     path" tooltip on the symlink badge. */
  symlinkTarget?: string;
  /** The SKILL.md Markdown body (frontmatter stripped). Read during scanning
     and surfaced in the skill detail view. Omitted when the body is empty or
     when the aggregate list response budget is exhausted. */
  content?: string;
};

export type ProjectSkillGroup = {
  scope: ProjectSkillScope;
  dir: string;
  skills: ProjectSkill[];
  truncated: boolean;
  skippedExternalSymlinks?: number;
  error?: string;
};

export type ProjectSkillsResult = {
  groups: ProjectSkillGroup[];
  contentFingerprint?: string;
};

const textEncoder = new TextEncoder();

function utf8ByteLength(value: string): number {
  return textEncoder.encode(value).byteLength;
}

function assertNonNegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid project skills ${label}: ${value}`);
  }
}

export function applyProjectSkillsResultBudget(
  groups: readonly ProjectSkillGroup[],
  options: {
    maxContentBytes?: number;
    maxSkills?: number;
  } = {}
): ProjectSkillGroup[] {
  const maxContentBytes = options.maxContentBytes ?? DEFAULT_PROJECT_SKILLS_CONTENT_BUDGET_BYTES;
  const maxSkills = options.maxSkills ?? DEFAULT_PROJECT_SKILLS_RESULT_MAX_SKILLS;
  assertNonNegativeSafeInteger(maxContentBytes, 'content budget');
  assertNonNegativeSafeInteger(maxSkills, 'skill count budget');

  let remainingContentBytes = maxContentBytes;
  let remainingSkills = maxSkills;
  return groups.map((group) => {
    let groupChanged = false;
    let skillsTruncated = false;
    const skills: ProjectSkill[] = [];
    for (const skill of group.skills) {
      if (remainingSkills === 0) {
        groupChanged = true;
        skillsTruncated = true;
        continue;
      }
      remainingSkills -= 1;
      if (skill.content === undefined) {
        skills.push(skill);
        continue;
      }
      const contentBytes = utf8ByteLength(skill.content);
      if (contentBytes > remainingContentBytes) {
        groupChanged = true;
        const { content: _content, ...metadataOnlySkill } = skill;
        skills.push(metadataOnlySkill);
        continue;
      }
      remainingContentBytes -= contentBytes;
      skills.push(skill);
    }
    return groupChanged
      ? { ...group, skills, truncated: group.truncated || skillsTruncated }
      : group;
  });
}

export type ProjectSkillFrontmatter = {
  name?: string;
  description?: string;
  version?: string;
  author?: string;
  metadata?: {
    version?: string;
    author?: string;
  };
};

export function getSkillScanCandidateDirs(): string[] {
  return ALL_KNOWN_PROJECT_SKILL_DIRS;
}

const SKILL_DIR_ALIAS_SUFFIXES = ['-acp', '-cli'] as const;

export function resolveSkillDirMapping(agentType: string): SkillDirsByAgentType | undefined {
  const direct = ACP_SKILL_DIRS_BY_AGENT_TYPE[agentType];
  if (direct) return direct;
  for (const suffix of SKILL_DIR_ALIAS_SUFFIXES) {
    if (!agentType.endsWith(suffix)) continue;
    const base = agentType.slice(0, -suffix.length);
    if (base && ACP_SKILL_DIRS_BY_AGENT_TYPE[base]) {
      return ACP_SKILL_DIRS_BY_AGENT_TYPE[base];
    }
  }
  return undefined;
}

export function getRegisteredSkillDirs(
  agents: ReadonlyArray<{ cliType: AgentConfigCliType; agentType: string }>
): Set<string> {
  const projectDirs = new Set<string>();
  for (const agent of agents) {
    const mapping = resolveSkillDirMapping(agent.agentType);
    if (!mapping) {
      continue;
    }
    for (const dir of mapping.projectDirs) {
      projectDirs.add(dir);
    }
  }
  return projectDirs;
}

export function getRegisteredGlobalSkillDirs(
  agents: ReadonlyArray<{ cliType: AgentConfigCliType; agentType: string }>
): Set<string> {
  const globalDirs = new Set<string>();
  for (const agent of agents) {
    const mapping = resolveSkillDirMapping(agent.agentType);
    if (!mapping) {
      continue;
    }
    for (const dir of mapping.globalDirs) {
      globalDirs.add(dir);
    }
  }
  return globalDirs;
}

export function getRegisteredSystemSkillDirs(
  agents: ReadonlyArray<{ cliType: AgentConfigCliType; agentType: string }>
): Set<string> {
  const systemDirs = new Set<string>();
  for (const agent of agents) {
    const mapping = resolveSkillDirMapping(agent.agentType);
    if (!mapping) {
      continue;
    }
    for (const dir of mapping.systemDirs) {
      systemDirs.add(dir);
    }
  }
  return systemDirs;
}

function agentUsesClaudeHooks(agentType: string): boolean {
  return resolveSkillDirMapping(agentType) === CLAUDE_FAMILY_SKILL_DIRS;
}

export function getRegisteredHookDirs(
  agents: ReadonlyArray<{ cliType: AgentConfigCliType; agentType: string }>
): Set<string> {
  const hookDirs = new Set<string>();
  for (const agent of agents) {
    if (!agentUsesClaudeHooks(agent.agentType)) {
      continue;
    }
    for (const file of ALL_KNOWN_GLOBAL_HOOK_FILES) {
      hookDirs.add(file);
    }
    for (const file of ALL_KNOWN_PROJECT_HOOK_FILES) {
      hookDirs.add(file);
    }
  }
  return hookDirs;
}

const MAX_HOOKS_PER_DOCUMENT = 256;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeHookSkillName(raw: string): string {
  const sanitized = raw
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return sanitized || 'hook';
}

function uniqueHookSkillName(base: string, used: Set<string>): string {
  let name = base;
  let index = 2;
  while (used.has(name)) {
    name = `${base}-${index}`;
    index += 1;
  }
  used.add(name);
  return name;
}

function previewHookCommand(command: string): string {
  return command.replace(/\s+/g, ' ').trim().slice(0, 160);
}

function extractClaudeHooksTable(parsed: unknown): Record<string, unknown[]> | null {
  if (!isRecord(parsed)) {
    return null;
  }

  const source = isRecord(parsed.hooks) ? parsed.hooks : parsed;
  const events: Record<string, unknown[]> = {};
  for (const [event, value] of Object.entries(source)) {
    if (event === 'description' || !Array.isArray(value)) {
      continue;
    }
    events[event] = value;
  }
  const hasMatcher = Object.values(events).some((matchers) =>
    matchers.some((matcher) => isRecord(matcher) && Array.isArray(matcher.hooks))
  );
  return hasMatcher ? events : null;
}

export function parseClaudeHooksDocument(raw: string): Array<{
  name: string;
  description?: string;
  content: string;
}> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Hook file is not valid JSON.');
  }

  const table = extractClaudeHooksTable(parsed);
  if (!table) {
    return [];
  }

  const usedNames = new Set<string>();
  const entries: Array<{ name: string; description?: string; content: string }> = [];
  for (const [event, matchers] of Object.entries(table)) {
    for (const matcher of matchers) {
      if (!isRecord(matcher) || !Array.isArray(matcher.hooks)) {
        continue;
      }
      const matcherLabel = typeof matcher.matcher === 'string' ? matcher.matcher.trim() : '';
      for (const handler of matcher.hooks) {
        if (entries.length >= MAX_HOOKS_PER_DOCUMENT) {
          return entries;
        }
        if (!isRecord(handler)) {
          continue;
        }
        const command = typeof handler.command === 'string' ? handler.command : '';
        const name = uniqueHookSkillName(
          sanitizeHookSkillName(matcherLabel ? `${event}-${matcherLabel}` : event),
          usedNames
        );
        const description = previewHookCommand(command);
        entries.push({
          name,
          ...(description ? { description } : {}),
          content: JSON.stringify(
            {
              event,
              ...(matcherLabel ? { matcher: matcherLabel } : {}),
              ...handler,
            },
            null,
            2
          ),
        });
      }
    }
  }
  return entries;
}

export function buildHookProjectSkills(args: {
  groupDir: string;
  relativePath: string;
  absolutePath?: string;
  raw: string;
}): ProjectSkill[] {
  return parseClaudeHooksDocument(args.raw).map((entry) => ({
    id: `${args.groupDir}#${entry.name}`,
    name: entry.name,
    ...(entry.description ? { description: entry.description } : {}),
    relativePath: args.relativePath,
    ...(args.absolutePath ? { absolutePath: args.absolutePath } : {}),
    isSymlink: false,
    content: entry.content,
  }));
}

function normalizeFrontmatterValue(rawValue: string): string {
  const value = rawValue.trim();
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1).trim();
    }
  }
  return value;
}

function setFrontmatterValue(target: ProjectSkillFrontmatter, key: string, value: string): void {
  const normalizedValue = normalizeFrontmatterValue(value);
  if (normalizedValue.length === 0) {
    return;
  }

  if (key === 'name') {
    target.name = normalizedValue;
    return;
  }
  if (key === 'description') {
    target.description = normalizedValue;
    return;
  }
  if (key === 'version') {
    target.version = normalizedValue;
    return;
  }
  if (key === 'author') {
    target.author = normalizedValue;
    return;
  }
  if (key === 'metadata.version') {
    target.metadata = { ...target.metadata, version: normalizedValue };
    return;
  }
  if (key === 'metadata.author') {
    target.metadata = { ...target.metadata, author: normalizedValue };
  }
}

export function parseSkillFrontmatter(markdown: string): ProjectSkillFrontmatter {
  const normalized = markdown.replace(/^\uFEFF/, '');
  if (!normalized.startsWith('---\n') && !normalized.startsWith('---\r\n')) {
    return {};
  }

  const newline = normalized.startsWith('---\r\n') ? '\r\n' : '\n';
  const startLength = 3 + newline.length;
  const endMarker = `${newline}---`;
  const endIndex = normalized.indexOf(endMarker, startLength);
  if (endIndex === -1) {
    throw new Error('SKILL.md frontmatter is missing a closing marker.');
  }

  const frontmatter = normalized.slice(startLength, endIndex);
  const result: ProjectSkillFrontmatter = {};
  let currentParent: string | null = null;

  for (const rawLine of frontmatter.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    if (/^\s/.test(rawLine)) {
      if (currentParent !== 'metadata') {
        continue;
      }
      const nestedMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (!nestedMatch) {
        if (line.startsWith('- ')) {
          continue;
        }
        throw new Error(`Invalid metadata frontmatter line: ${line}`);
      }
      const nestedKey = nestedMatch[1];
      if (nestedKey === undefined) {
        throw new Error(`Invalid metadata frontmatter line: ${line}`);
      }
      const nestedValue = nestedMatch[2] ?? '';
      setFrontmatterValue(result, `metadata.${nestedKey}`, nestedValue);
      continue;
    }

    const match = line.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (!match) {
      throw new Error(`Invalid SKILL.md frontmatter line: ${line}`);
    }

    const key = match[1];
    if (key === undefined) {
      throw new Error(`Invalid SKILL.md frontmatter line: ${line}`);
    }
    const value = match[2] ?? '';
    currentParent = value.trim() === '' ? key : null;
    setFrontmatterValue(result, key, value);
  }

  return result;
}

export function extractProjectSkillMetadata(
  markdown: string,
  fallbackName: string
): Pick<ProjectSkill, 'name' | 'description' | 'version' | 'author'> {
  const frontmatter = parseSkillFrontmatter(markdown);
  const name = frontmatter.name?.trim() || fallbackName;
  const description = frontmatter.description?.trim();
  const version = frontmatter.version?.trim() || frontmatter.metadata?.version?.trim();
  const author = frontmatter.author?.trim() || frontmatter.metadata?.author?.trim();

  return {
    name,
    ...(description ? { description } : {}),
    ...(version ? { version } : {}),
    ...(author ? { author } : {}),
  };
}

/** Basename of a `/`-separated project-relative skill dir (no trailing slash). */
function skillDirBasename(dir: string): string {
  const index = dir.lastIndexOf('/');
  return index === -1 ? dir : dir.slice(index + 1);
}

/**
 * Assemble a {@link ProjectSkill} from a resolved SKILL.md. Centralizes the
 * `id` / `idSegment` rule and metadata extraction so the three scanners (local
 * fs, GitHub tree, GitHub contents) produce byte-identical skill records — the
 * stable `id` is what the SWR cache keys and mention tokens agree on, so it must
 * not drift between sources. Callers supply only the I/O-derived inputs
 * (`relativePath` / `symlinkTarget` are computed per transport).
 */
export function buildProjectSkill(args: {
  groupDir: string;
  displaySkillDir: string;
  markdown: string;
  relativePath: string;
  absolutePath?: string;
  isSymlink: boolean;
  symlinkTarget?: string;
}): ProjectSkill {
  const fallbackName =
    skillDirBasename(args.displaySkillDir) || skillDirBasename(args.groupDir) || args.groupDir;
  const idSegment = args.displaySkillDir === args.groupDir ? 'SKILL.md' : fallbackName;
  const content = getSkillMarkdownBody(args.markdown);
  return {
    id: `${args.groupDir}/${idSegment}`,
    relativePath: args.relativePath,
    ...(args.absolutePath ? { absolutePath: args.absolutePath } : {}),
    isSymlink: args.isSymlink,
    ...(args.symlinkTarget ? { symlinkTarget: args.symlinkTarget } : {}),
    ...(content ? { content } : {}),
    ...extractProjectSkillMetadata(args.markdown, fallbackName),
  };
}

/** The Markdown body after the leading `---` frontmatter block (if present). */
export function getSkillMarkdownBody(markdown: string): string {
  const normalized = markdown.replace(/^\uFEFF/, '');
  if (!normalized.startsWith('---\n') && !normalized.startsWith('---\r\n')) {
    return normalized.trim();
  }
  const newline = normalized.startsWith('---\r\n') ? '\r\n' : '\n';
  const startLength = 3 + newline.length;
  const endIndex = normalized.indexOf(`${newline}---`, startLength);
  if (endIndex === -1) {
    return normalized.trim();
  }
  const lineEnd = normalized.indexOf('\n', endIndex + newline.length + 3);
  return lineEnd === -1 ? '' : normalized.slice(lineEnd + 1).trim();
}
