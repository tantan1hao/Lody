import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Archive, Minus, PanelLeft, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { getMachineRoomId, getSessionRoomId, type SessionMeta, type WfCardMeta } from '@lody/shared';
import { activeWorkspaceRuntimeAtom } from '@/atoms/runtime';
import { machineMetaCacheAtom } from '@/atoms/doc-meta';
import { cn } from '@/lib/utils';
import { currentWorkspaceSlugAtom } from '@/atoms';
import { sidebarCollapsedAtom } from '@/atoms/sidebar-state';
import { isMacOSElectronRenderer, useElectronFullscreen } from '@/lib/electron';
import { isNativeAppShell } from '@/lib/native-platform';
import { useVisibleArchivedSessionMetas, useVisibleSessionMetas } from '@/hooks/use-visible-session-metas';
import { Button } from '@/ui/button';

/**
 * 监工：wf 一线会话总览。结构仿 mirasim —— 左边发起人（项目经理），右边它派出的卡。
 * 数据只读 Lody 自己的会话：wf-lody 同步程序把卡片信息写在会话 meta.wf 上。
 * 两种用法：整页（左下角雷达图标）和会话页右侧栏里的窄版（看会话时并排看全局）。
 */

type WfSession = { session: SessionMeta; wf: WfCardMeta };

export type CardItem = {
  card: string;
  owner: string;
  /** 挂在哪张卡下面（验收的那张、接着做的那张、唯一要等的那张） */
  parent?: string;
  /** 和上级卡的关系 */
  rel?: string;
  /** 还要等的其他卡 */
  waitsFor: string[];
  children: CardItem[];
  /** 这张卡和它下面所有卡里最要紧的状态，用来排序 */
  familyTone: Tone;
  main: WfSession;
  others: WfSession[];
  tone: Tone;
  running: boolean;
  updatedAt: number;
  sessionIds: string[];
  /** 这张卡的会话一个都没打开过（和侧栏小蓝点同一规则） */
  unread: boolean;
  /** 在 Lody 里没有会话（排队、还没开工、wf 自己合并的、开工前就停了的）：来自机器信息上的卡清单 */
  noSession?: boolean;
};

export type OwnerGroup = {
  owner: string;
  cards: CardItem[];
  running: number;
  waiting: number;
  bad: number;
  warn: number;
  cbFail: number;
};

export type Tone = 'run' | 'wait' | 'warn' | 'bad' | 'ok' | 'off';

const ROLE_ORDER = ['执行', '分块', '验收', '写手', '写卡', '工程师'];
const OWNER_ORDER = ['心里项目经理', 'PDRS项目经理', '投顾项目助手', '总助'];
const FRESH_MS = 30 * 60 * 1000;
/** 整页卡片宽度（和下面 max-w-[540px] 一致）；下级卡保持同宽、往右缩进 */
const CARD_W = 540;
/** 同一个发起人下面，卡按这个顺序排：等你 → 在跑 → 没过 → 通过 → 已停 */
const TONE_ORDER: Tone[] = ['wait', 'warn', 'run', 'bad', 'ok', 'off'];

export const TONE_STYLE: Record<Tone, { bar: string; card: string; badge: string; dot: string }> = {
  run: {
    bar: 'bg-blue-500',
    card: 'border-blue-300 bg-blue-50/40 dark:bg-blue-950/20 shadow-[0_0_0_1px_rgba(59,130,246,0.15)]',
    badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-200',
    dot: 'bg-blue-500 animate-pulse',
  },
  wait: {
    bar: 'bg-amber-500',
    card: 'border-amber-300 bg-amber-50 dark:bg-amber-950/25',
    badge: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200',
    dot: 'bg-amber-500',
  },
  warn: {
    bar: 'bg-orange-500',
    card: 'border-orange-300 bg-orange-50/70 dark:bg-orange-950/25',
    badge: 'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-200',
    dot: 'bg-orange-500',
  },
  bad: {
    bar: 'bg-red-500',
    card: 'border-red-200 bg-red-50/70 dark:bg-red-950/25',
    badge: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-200',
    dot: 'bg-red-500',
  },
  ok: {
    bar: 'bg-emerald-500',
    card: 'border-border bg-background',
    badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-200',
    dot: 'bg-emerald-500',
  },
  off: {
    bar: 'bg-muted-foreground/30',
    card: 'border-border bg-background opacity-75',
    badge: 'bg-muted text-muted-foreground',
    dot: 'bg-muted-foreground/40',
  },
};

const KIND_STYLE: Record<string, string> = {
  实施: 'border-indigo-200 text-indigo-700 dark:border-indigo-800 dark:text-indigo-300',
  验收: 'border-violet-200 text-violet-700 dark:border-violet-800 dark:text-violet-300',
  集成: 'border-teal-200 text-teal-700 dark:border-teal-800 dark:text-teal-300',
};

export const HARNESS_STYLE: Record<string, string> = {
  Codex: 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900',
  Grok: 'bg-zinc-600 text-white',
  Antigravity: 'bg-sky-600 text-white',
  Cursor: 'bg-stone-500 text-white',
};

function isSessionUnread(session: SessionMeta): boolean {
  const lm = session.lastMessageAt;
  const lr = session.lastReadAt;
  return typeof lm === 'number' && (typeof lr !== 'number' || lm > lr);
}

function toneOf(wf: WfCardMeta): Tone {
  const t = wf.tone;
  return t === 'run' || t === 'wait' || t === 'warn' || t === 'bad' || t === 'ok' ? t : 'off';
}

export function roleRank(role: string | undefined): number {
  // wf 2.17 分块会话的角色是「分块 <块名>」
  const i = ROLE_ORDER.findIndex((r) => (role ?? '').startsWith(r));
  return i < 0 ? ROLE_ORDER.length : i;
}

function isWriterRole(role: string | undefined): boolean {
  return role === '写手' || role === '写卡';
}

export function roleLabel(role: string | undefined): string {
  if (role === '写手' || role === '写卡') return '✍写手';
  if (role === '工程师') return '🛠工程师';
  return role ?? '会话';
}

function readWf(session: SessionMeta): WfCardMeta | null {
  const wf = session.wf;
  if (!wf || typeof wf !== 'object' || typeof wf.card !== 'string') return null;
  return wf;
}

export function hm(sec: number | undefined, now: Date): string {
  if (!sec) return '';
  const d = new Date(sec * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return d.toDateString() === now.toDateString() ? time : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}`;
}

/** 卡片级字段（状态、轮数、用量、标题）取同一张卡里最新那条会话的。 */
function pickCardFields(wf: WfCardMeta): Partial<WfCardMeta> {
  const { status, label, tone, rounds, parts, model, effort, usage, updatedAt, startedAt, goal, harness, kind, title } = wf;
  const { unverified, unverifiedWhy, autoFix, reviewFixes, cbFail, callback } = wf;
  return {
    status, label, tone, rounds, parts, model, effort, usage, updatedAt, startedAt, goal, harness, kind, title,
    unverified, unverifiedWhy, autoFix, reviewFixes, cbFail, callback,
  };
}

function buildGroups(sessions: SessionMeta[], board: WfCardMeta[] = [], archived: SessionMeta[] = []): OwnerGroup[] {
  const byCard = new Map<string, WfSession[]>();
  const boardOnly = new Set<string>();
  for (const session of sessions) {
    if (session.isArchived) continue;
    const wf = readWf(session);
    if (!wf) continue;
    const list = byCard.get(wf.card) ?? [];
    list.push({ session, wf });
    byCard.set(wf.card, list);
  }
  // 没有会话的卡：同步程序挂在机器信息上；已经有会话的卡以会话为准
  for (const wf of board) {
    if (!wf || typeof wf.card !== 'string' || byCard.has(wf.card)) continue;
    const fake = { id: `wf-card-${wf.card}`, isArchived: false } as unknown as SessionMeta;
    byCard.set(wf.card, [{ session: fake, wf }]);
    boardOnly.add(wf.card);
  }
  // 已归档的会话（比如自动收起的写手）：卡还在看板上时一起挂上，好看清整条路
  const extra = new Map<string, WfSession[]>();
  for (const session of archived) {
    const wf = readWf(session);
    if (!wf || !byCard.has(wf.card) || boardOnly.has(wf.card)) continue;
    if (byCard.get(wf.card)!.some((x) => x.session.id === session.id)) continue;
    const l = extra.get(wf.card) ?? [];
    l.push({ session, wf });
    extra.set(wf.card, l);
  }
  const byOwner = new Map<string, CardItem[]>();
  for (const [card, list] of byCard) {
    list.sort((a, b) => roleRank(a.wf.role) - roleRank(b.wf.role));
    const main = list[0];
    const latest = list.reduce((m, x) => ((x.wf.updatedAt ?? 0) > (m.wf.updatedAt ?? 0) ? x : m), main);
    const wf = { ...main.wf, ...pickCardFields(latest.wf) };
    const item: CardItem = {
      card,
      owner: latest.wf.owner || latest.wf.project || '其他',
      main: { session: main.session, wf },
      others: [...list.slice(1), ...(extra.get(card) ?? [])],
      tone: toneOf(wf),
      running: wf.status === 'running',
      updatedAt: latest.wf.updatedAt ?? 0,
      sessionIds: [...list, ...(extra.get(card) ?? [])].map((x) => x.session.id),
      unread: !boardOnly.has(card) && list.every((x) => isSessionUnread(x.session)),
      noSession: boardOnly.has(card),
      waitsFor: [],
      children: [],
      familyTone: toneOf(wf),
    };
    const cards = byOwner.get(item.owner) ?? [];
    cards.push(item);
    byOwner.set(item.owner, cards);
  }
  const groups: OwnerGroup[] = [];
  for (const [owner, all] of byOwner) {
    const cards = linkCards(all);
    groups.push({
      owner,
      cards,
      running: all.filter((c) => c.tone === 'run').length,
      waiting: all.filter((c) => c.tone === 'wait').length,
      bad: all.filter((c) => c.tone === 'bad').length,
      warn: all.filter((c) => c.tone === 'warn').length,
      cbFail: all.filter((c) => c.main.wf.cbFail).length,
    });
  }
  const rank = (o: string) => (OWNER_ORDER.includes(o) ? OWNER_ORDER.indexOf(o) : OWNER_ORDER.length);
  groups.sort((a, b) => rank(a.owner) - rank(b.owner) || a.owner.localeCompare(b.owner));
  return groups;
}

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 1.6;

function clampZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 10) / 10));
}

/** 缩放比例，整页和右侧栏各记各的（存在本机）。 */
function useZoom(key: string, initial: number) {
  const storageKey = `lody:jiangong-zoom:${key}`;
  const [zoom, setZoomState] = useState<number>(() => {
    try {
      const v = Number(window.localStorage.getItem(storageKey));
      return v ? clampZoom(v) : initial;
    } catch {
      return initial;
    }
  });
  const setZoom = useCallback(
    (next: number | ((z: number) => number)) => {
      setZoomState((cur) => {
        const z = clampZoom(typeof next === 'function' ? next(cur) : next);
        try {
          window.localStorage.setItem(storageKey, String(z));
        } catch {
          /* 存不了就只在这次有效 */
        }
        return z;
      });
    },
    [storageKey]
  );
  return [zoom, setZoom] as const;
}

/** 按住 ⌘ 或 Ctrl 滚滚轮缩放。 */
function useWheelZoom(ref: RefObject<HTMLElement | null>, setZoom: (fn: (z: number) => number) => void) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((z) => z + (e.deltaY < 0 ? 0.1 : -0.1));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [ref, setZoom]);
}

function ZoomControls({ zoom, setZoom }: { zoom: number; setZoom: (fn: number | ((z: number) => number)) => void }) {
  return (
    <span className="flex shrink-0 items-center rounded-md border bg-background text-[11px] text-muted-foreground">
      <button
        type="button"
        className="flex h-6 w-6 items-center justify-center hover:text-foreground disabled:opacity-40"
        onClick={() => setZoom((z) => z - 0.1)}
        disabled={zoom <= ZOOM_MIN}
        aria-label="缩小"
        title="缩小（⌘/Ctrl + 滚轮也可以）"
      >
        <Minus className="h-3 w-3" />
      </button>
      <button
        type="button"
        className="w-10 text-center tabular-nums hover:text-foreground"
        onClick={() => setZoom(1)}
        title="点一下回到 100%"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        type="button"
        className="flex h-6 w-6 items-center justify-center hover:text-foreground disabled:opacity-40"
        onClick={() => setZoom((z) => z + 0.1)}
        disabled={zoom >= ZOOM_MAX}
        aria-label="放大"
        title="放大（⌘/Ctrl + 滚轮也可以）"
      >
        <Plus className="h-3 w-3" />
      </button>
    </span>
  );
}

/**
 * 把同一个发起人下的卡按关系挂成树：验收卡挂在它验的卡下面，续做的卡挂在原卡下面，
 * 只等一张卡的挂在那张下面；要等好几张的留在原位，标「等 A、B」。
 * 关系只取 wf 自己记的字段（of / from / after），不靠模型写的总结。
 */
function linkCards(all: CardItem[]): CardItem[] {
  const byId = new Map(all.map((c) => [c.card, c]));
  for (const c of all) {
    const w = c.main.wf;
    const after = Array.isArray(w.after) ? w.after : [];
    const candidates: [string | undefined, string][] = [
      [w.of, '验收'],
      [w.from, '续做'],
      [after.length === 1 ? after[0] : undefined, '接在后面'],
    ];
    for (const [id, rel] of candidates) {
      if (id && id !== c.card && byId.has(id)) {
        c.parent = id;
        c.rel = rel;
        break;
      }
    }
    c.waitsFor = after.filter((a) => a !== c.parent);
  }
  // 防环：顺着上级往上走，绕回自己就断开
  for (const c of all) {
    const seen = new Set<string>([c.card]);
    let p = c.parent;
    while (p) {
      if (seen.has(p)) {
        c.parent = undefined;
        c.rel = undefined;
        break;
      }
      seen.add(p);
      p = byId.get(p)?.parent;
    }
  }
  for (const c of all) {
    if (c.parent) byId.get(c.parent)?.children.push(c);
  }
  const rankTone = (t: Tone) => TONE_ORDER.indexOf(t);
  const family = (c: CardItem): Tone => {
    let best = c.tone;
    for (const ch of c.children) {
      const t = family(ch);
      if (rankTone(t) < rankTone(best)) best = t;
    }
    c.familyTone = best;
    return best;
  };
  const roots = all.filter((c) => !c.parent);
  roots.forEach(family);
  const sortTree = (list: CardItem[], byTone: boolean) => {
    list.sort((a, b) =>
      byTone
        ? rankTone(a.familyTone) - rankTone(b.familyTone) || b.updatedAt - a.updatedAt
        : a.updatedAt - b.updatedAt
    );
    for (const c of list) sortTree(c.children, false);
  };
  sortTree(roots, true);
  return roots;
}

/** 归档（或撤回）几张卡：这张卡的所有会话一起动；归档时同时算作看过，免得同步程序当成没看过又拿回来。
 * 没有会话的卡写进那台机器信息上的隐藏列表（wfBoardHidden）。 */
export function useArchiveCards() {
  const runtime = useAtomValue(activeWorkspaceRuntimeAtom);
  return useCallback(
    async (items: CardItem[], archived = true) => {
      if (!runtime) throw new Error('Lody 还没连上');
      const now = Date.now();
      for (const c of items) {
        if (!c.noSession) continue;
        const mid = (c.main.wf as WfCardMeta & { boardMachine?: string }).boardMachine;
        if (!mid) continue;
        await runtime.writer.upsertDocMeta(getMachineRoomId(mid as never), {
          [`wfHidden:${c.card}`]: archived ? 'yes' : 'no',
        } as never);
      }
      for (const c of items) {
        if (c.noSession) continue;
        for (const x of [c.main, ...c.others]) {
          const lm = typeof x.session.lastMessageAt === 'number' ? x.session.lastMessageAt : 0;
          const patch = archived ? { isArchived: true, lastReadAt: Math.max(lm, now) } : { isArchived: false };
          await runtime.writer.upsertDocMeta(getSessionRoomId(x.session.id), patch as Partial<SessionMeta>);
        }
      }
    },
    [runtime]
  );
}

/** 单张卡的归档：不弹确认，toast 里给撤销。 */
function useArchiveOne() {
  const archive = useArchiveCards();
  return useCallback(
    async (item: CardItem) => {
      try {
        await archive([item]);
        toast.success(`已归档 ${item.main.wf.title || item.card}`, {
          duration: 10000,
          action: { label: '撤销', onClick: () => void archive([item], false) },
        });
      } catch (e) {
        toast.error(`归档没成功：${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [archive]
  );
}

export function flattenCards(list: CardItem[]): CardItem[] {
  return list.flatMap((c) => [c, ...flattenCards(c.children)]);
}

function countCards(list: CardItem[]): number {
  return list.reduce((n, c) => n + 1 + countCards(c.children), 0);
}

/** 看容器有多宽，算出最多能缩进几层：每张卡至少留 minCard 像素，每层缩进占 step 像素。 */
function useAdaptiveIndent(ref: RefObject<HTMLElement | null>, minCard: number, step: number) {
  const [maxIndent, setMaxIndent] = useState(2);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      setMaxIndent(Math.max(0, Math.min(8, Math.floor((w - minCard) / step))));
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, minCard, step]);
  return maxIndent;
}

export function useJiangong() {
  const router = useRouter();
  const workspaceSlug = useAtomValue(currentWorkspaceSlugAtom);
  const { sessions } = useVisibleSessionMetas();
  const { archivedSessions } = useVisibleArchivedSessionMetas();
  const machines = useAtomValue(machineMetaCacheAtom);
  const board = useMemo(
    () =>
      Object.values(machines).flatMap((m) => {
        const meta = m as unknown as { id: string; wfBoard?: { cards?: WfCardMeta[] } } & Record<string, unknown>;
        // 隐藏的卡：机器信息上一张卡一个字段 wfHidden:<卡号> = 'yes'（撤销时写 'no'）
        const hidden = new Set(
          Object.keys(meta)
            .filter((k) => k.startsWith('wfHidden:') && meta[k] === 'yes')
            .map((k) => k.slice('wfHidden:'.length))
        );
        const cards = Array.isArray(meta.wfBoard?.cards) ? meta.wfBoard.cards : [];
        // boardMachine：这张卡挂在哪台机器的清单上，归档时往那台机器的隐藏列表里写
        return cards.filter((c) => !hidden.has(c.card)).map((c) => ({ ...c, boardMachine: meta.id }));
      }),
    [machines]
  );
  const groups = useMemo(
    () => buildGroups(sessions, board, archivedSessions as unknown as SessionMeta[]),
    [sessions, board, archivedSessions]
  );
  const total = groups.reduce((n, g) => n + countCards(g.cards), 0);
  const openSession = useCallback(
    (sessionId: string) => {
      if (sessionId.startsWith('wf-card-')) {
        toast.message('这张卡在 Lody 里没有会话', {
          description: '可能还在排队、还没开工，或者是 wf 自己合并完的集成卡、开工前就停了的卡。',
        });
        return;
      }
      if (!workspaceSlug) return;
      void router.navigate({
        to: '/$workspaceName/sessions/$sessionId',
        params: { workspaceName: workspaceSlug, sessionId },
      });
    },
    [router, workspaceSlug]
  );
  return { groups, total, openSession };
}

function OwnerBadge({ group, compact }: { group: OwnerGroup; compact?: boolean }) {
  const { t } = useTranslation();
  return (
    <div
      data-jg-owner
      className={cn(
        'flex shrink-0 items-center gap-2.5 rounded-xl border bg-background',
        compact ? 'w-full px-2.5 py-2' : 'w-full px-3 py-2.5 md:w-[200px]'
      )}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-purple-100 text-sm font-semibold text-purple-700 dark:bg-purple-900/40 dark:text-purple-200">
        {group.owner.slice(0, 1)}
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">{group.owner}</div>
        <div className="text-[11px] text-muted-foreground">
          {t('jiangong.ownerCount', '{{count}} 张卡', { count: countCards(group.cards) })}
          {group.waiting ? (
            <span className="font-medium text-amber-600"> · {t('jiangong.ownerWaiting', '{{count}} 个等你', { count: group.waiting })}</span>
          ) : null}
          {group.running ? (
            <span className="text-blue-600"> · {t('jiangong.ownerRunning', '{{count}} 个在跑', { count: group.running })}</span>
          ) : null}
          {group.cbFail ? (
            <span className="font-semibold text-red-600"> · {group.cbFail} 个回传没送到</span>
          ) : null}
          {group.warn ? <span className="text-orange-600"> · {group.warn} 个没验全</span> : null}
          {group.bad ? (
            <span className="text-red-600"> · {t('jiangong.ownerBad', '{{count}} 个没过', { count: group.bad })}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function JiangongCard({
  item,
  now,
  onOpen,
  compact,
  current,
  onArchive,
}: {
  item: CardItem;
  now: Date;
  onOpen: (sessionId: string) => void;
  compact?: boolean;
  current?: boolean;
  onArchive?: (item: CardItem) => void;
}) {
  const { t } = useTranslation();
  const wf = item.main.wf;
  const style = TONE_STYLE[item.tone];
  const fresh = !item.running && item.updatedAt > 0 && Date.now() - item.updatedAt * 1000 < FRESH_MS;
  const goal = wf.goal ?? '';
  const title = wf.title || (goal.length > 20 ? `${goal.slice(0, 20)}…` : goal);
  const bits = [
    wf.model,
    wf.effort,
    wf.rounds ? t('jiangong.rounds', '{{count}} 轮', { count: wf.rounds }) : '',
    wf.parts ? t('jiangong.parts', '{{count}} 块并行', { count: wf.parts }) : '',
    wf.startedAt ? t('jiangong.started', '{{time}} 开始', { time: hm(wf.startedAt, now) }) : '',
    wf.updatedAt ? t('jiangong.latest', '最近 {{time}}', { time: hm(wf.updatedAt, now) }) : '',
  ].filter(Boolean);
  // 卡上只放最要紧的几项，全部信息在悬停提示里
  const shortBits = [
    wf.model,
    wf.rounds ? t('jiangong.rounds', '{{count}} 轮', { count: wf.rounds }) : '',
    wf.parts ? t('jiangong.parts', '{{count}} 块并行', { count: wf.parts }) : '',
    wf.updatedAt ? t('jiangong.latest', '最近 {{time}}', { time: hm(wf.updatedAt, now) }) : '',
  ].filter(Boolean);
  const fullTip = [goal, item.card, bits.join(' · '), wf.usage ?? '', item.waitsFor.length ? '等 ' + item.waitsFor.join('、') : '']
    .filter(Boolean)
    .join('\n');
  if (compact) {
    // 侧栏里的简略版：一行，色条 + 状态 + 大白话标题 + 未看点；其余信息放在悬停提示里
    const tip = [
      title,
      `${item.card} · ${wf.harness ?? ''}${wf.kind ? ' · ' + wf.kind : ''}${item.rel ? ' · ↳' + item.rel : ''}`,
      item.waitsFor.length ? '等 ' + item.waitsFor.join('、') : '',
      bits.join(' · '),
      goal,
    ]
      .filter(Boolean)
      .join('\n');
    return (
      <div
        data-jg-card
        data-jg-id={item.card}
        data-jg-parent={item.parent ?? ''}
        data-jg-rel={item.rel ?? ''}
        data-jg-running={item.running ? '1' : '0'}
        role="button"
        tabIndex={0}
        title={tip}
        onClick={() => onOpen(item.main.session.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onOpen(item.main.session.id);
        }}
        className={cn(
          'group/jgcard relative flex cursor-pointer items-center gap-1.5 overflow-hidden rounded-md border py-1 pl-2.5 pr-1.5 text-[12px] transition-colors hover:border-blue-400',
          style.card,
          current && 'ring-2 ring-blue-500 ring-offset-1 ring-offset-background'
        )}
      >
        <span className={cn('absolute inset-y-0 left-0 w-1', style.bar)} aria-hidden />
        <span className={cn('shrink-0 rounded px-1 text-[10px] font-semibold', style.badge)}>
          {wf.label ?? wf.status}
        </span>
        {item.rel ? <span className="shrink-0 text-[10px] text-muted-foreground">↳</span> : null}
        {item.noSession ? (
          <span className="shrink-0 rounded border border-dashed px-1 text-[10px] text-muted-foreground">无会话</span>
        ) : null}
        {isWriterRole(item.main.wf.role) ? (
          <span className="shrink-0 rounded bg-fuchsia-600 px-1 text-[10px] font-semibold text-white">✍</span>
        ) : null}
        <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
        {wf.cbFail ? (
          <span className="shrink-0 rounded bg-red-600 px-1 text-[10px] font-semibold text-white" title="回传没送到项目经理">
            回传
          </span>
        ) : null}
        {item.unread && !item.running ? (
          <span className="h-2 w-2 shrink-0 rounded-full bg-blue-600" title="还没打开看过" />
        ) : null}
        {onArchive && !item.running ? (
          <button
            type="button"
            className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus:opacity-100 group-hover/jgcard:opacity-100"
            title="归档这张卡（算作看过；卡再跑起来会自动回来）"
            aria-label="归档这张卡"
            onClick={(e) => {
              e.stopPropagation();
              onArchive(item);
            }}
          >
            <Archive className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <div
      data-jg-card
      data-jg-id={item.card}
      data-jg-parent={item.parent ?? ''}
      data-jg-rel={item.rel ?? ''}
      data-jg-waits={item.waitsFor.join(',')}
      data-jg-running={item.running ? '1' : '0'}
      role="button"
      tabIndex={0}
      title={fullTip}
      onClick={() => onOpen(item.main.session.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen(item.main.session.id);
      }}
      className={cn(
        'group/jgcard relative cursor-pointer overflow-hidden border transition-colors hover:border-blue-400',
        compact ? 'rounded-lg py-1.5 pl-3 pr-2' : 'w-full max-w-[540px] rounded-xl py-2.5 pl-4 pr-3',
        style.card,
        current && 'ring-2 ring-blue-500 ring-offset-1 ring-offset-background'
      )}
    >
      <span className={cn('absolute inset-y-0 left-0', compact ? 'w-1' : 'w-1.5', style.bar)} aria-hidden />
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-1 rounded-md font-semibold',
            compact ? 'px-1 py-px text-[10px]' : 'px-1.5 py-0.5 text-[11px]',
            style.badge
          )}
        >
          <span className={cn('h-1.5 w-1.5 rounded-full', style.dot)} />
          <span title={wf.unverified && wf.unverifiedWhy ? '没验全：' + wf.unverifiedWhy : undefined}>
            {wf.label ?? wf.status}
          </span>
        </span>
        {item.rel ? (
          <span
            className={cn(
              'shrink-0 rounded-md bg-muted text-muted-foreground',
              compact ? 'px-1 text-[10px]' : 'px-1.5 py-0.5 text-[11px]'
            )}
          >
            ↳ {item.rel}
          </span>
        ) : null}
        {item.noSession ? (
          <span
            className="shrink-0 rounded-md border border-dashed px-1.5 py-0.5 text-[11px] text-muted-foreground"
            title="这张卡在 Lody 里没有会话：还在排队、还没开工，或 wf 自己做完的"
          >
            无会话
          </span>
        ) : null}
        {isWriterRole(item.main.wf.role) ? (
          item.running ? (
            <span
              className="shrink-0 rounded-md bg-fuchsia-600 px-1.5 py-0.5 text-[11px] font-semibold text-white"
              title="还在写手阶段：写手在写这张卡的指令，执行会话还没开始"
            >
              ✍写手中
            </span>
          ) : (
            <span
              className="shrink-0 rounded-md border border-fuchsia-300 bg-fuchsia-50 px-1.5 py-0.5 text-[11px] font-semibold text-fuchsia-700 dark:border-fuchsia-800 dark:bg-fuchsia-950/40 dark:text-fuchsia-300"
              title="这张卡在 Lody 里只有写手会话（执行在 Grok、Antigravity 等，没同步进来），点开看的是写手"
            >
              ✍写手
            </span>
          )
        ) : null}
        {wf.kind ? (
          <span
            className={cn(
              'shrink-0 rounded-md border font-medium',
              compact ? 'px-1 text-[10px]' : 'px-1.5 py-0.5 text-[11px]',
              KIND_STYLE[wf.kind] ?? 'border-border text-muted-foreground'
            )}
          >
            {wf.kind}
          </span>
        ) : null}
        <span className={cn('min-w-0 flex-1 truncate font-semibold', compact ? 'text-[12px]' : 'text-[13.5px]')}>
          {title}
        </span>
        {item.unread && !item.running ? (
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-blue-600 px-1.5 py-px text-[10px] font-semibold text-white"
            title="还没打开看过，看过以后跑完两小时才收起"
          >
            未看
          </span>
        ) : fresh ? (
          <span className="shrink-0 text-[11px] font-medium text-blue-600">{t('jiangong.fresh', '新结果')}</span>
        ) : null}
        {onArchive && !item.running ? (
          <button
            type="button"
            className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus:opacity-100 group-hover/jgcard:opacity-100"
            title="归档这张卡（算作看过；卡再跑起来会自动回来）"
            aria-label="归档这张卡"
            onClick={(e) => {
              e.stopPropagation();
              onArchive(item);
            }}
          >
            <Archive className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      <div
        className={cn(
          'flex flex-wrap items-center text-muted-foreground',
          compact ? 'mt-1 gap-x-1.5 gap-y-0.5 text-[10.5px]' : 'mt-1.5 gap-x-2 gap-y-1 text-[11px]'
        )}
      >
        {wf.harness ? (
          <span
            className={cn(
              'shrink-0 rounded px-1.5 py-px text-[10.5px] font-semibold',
              HARNESS_STYLE[wf.harness] ?? 'bg-muted text-foreground'
            )}
          >
            {wf.harness}
          </span>
        ) : null}
        <span className="shrink-0 rounded bg-muted px-1.5 py-px font-mono text-[10.5px]">{item.card}</span>
        {wf.cbFail ? (
          <span
            className="shrink-0 rounded-md bg-red-600 px-1.5 py-px text-[10.5px] font-semibold text-white"
            title={'回传没送到项目经理：' + (wf.callback ?? '')}
          >
            回传没送到
          </span>
        ) : null}
        {wf.reviewFixes ? (
          <span
            className="shrink-0 rounded-md border border-slate-300 px-1.5 py-px text-[10.5px] font-medium text-slate-700 dark:border-slate-600 dark:text-slate-300"
            title="验收意见被自动交回这张卡返修的次数"
          >
            返修 {wf.reviewFixes} 次
          </span>
        ) : null}
        {item.waitsFor.length ? (
          <span
            className="shrink-0 rounded border border-dashed px-1.5 py-px text-[10.5px]"
            title={'要等这几张卡：' + item.waitsFor.join('、')}
          >
            {`等 ${item.waitsFor.length} 张`}
          </span>
        ) : null}
        {compact ? (
          <span className="min-w-0 flex-1" />
        ) : (
          <span className="min-w-0 flex-1 truncate">{shortBits.join(' · ')}</span>
        )}

      </div>
      {!item.noSession ? <CardSteps item={item} onOpen={onOpen} /> : null}
    </div>
  );
}

/** 一张卡里的几步：写手先写指令，再执行（返修都在同一个执行会话里接着跑），分块各自一个会话。点哪步开哪个会话。 */
function CardSteps({ item, onOpen }: { item: CardItem; onOpen: (sessionId: string) => void }) {
  const all = [item.main, ...item.others];
  const writer = all.find((x) => isWriterRole(x.wf.role));
  const rest = all
    .filter((x) => x !== writer)
    .sort((a, b) => roleRank(a.wf.role) - roleRank(b.wf.role));
  const wf = item.main.wf;
  const stepCls =
    'inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-px text-[10.5px] font-semibold transition-colors';
  const open = (id: string) => (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    onOpen(id);
  };
  const execLabel = (role: string | undefined) => {
    if (!role || role.startsWith('执行')) return wf.rounds ? `执行 · 第 ${wf.rounds} 轮` : '执行';
    return roleLabel(role);
  };
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[10.5px] text-muted-foreground">
      {writer ? (
        <button
          type="button"
          className={cn(
            stepCls,
            'border-fuchsia-300 bg-fuchsia-50 text-fuchsia-700 hover:bg-fuchsia-100 dark:border-fuchsia-800 dark:bg-fuchsia-950/40 dark:text-fuchsia-300'
          )}
          title="第一步：写手读仓库，把项目经理的卡写成施工指令"
          onClick={open(writer.session.id)}
        >
          ✍写手{rest.length ? ' ✓' : item.running ? '…' : ''}
        </button>
      ) : null}
      {writer && rest.length ? <span aria-hidden>→</span> : null}
      {rest.map((x, i) => (
        <span key={x.session.id} className="inline-flex items-center gap-1">
          {i > 0 ? <span aria-hidden>·</span> : null}
          <button
            type="button"
            className={cn(
              stepCls,
              'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300'
            )}
            title="执行会话：照指令干活；没过时返修也在这个会话里接着跑"
            onClick={open(x.session.id)}
          >
            {execLabel(x.wf.role)}
          </button>
        </span>
      ))}
      {!writer && !rest.length ? <span>没有会话</span> : null}
    </div>
  );
}

type Line = { d: string; cls: string; dash?: boolean; arrow?: boolean; ends: string[] };

type Rect = { left: number; right: number; top: number; bottom: number; mid: number };

const REL_CLS: Record<string, string> = {
  验收: 'stroke-violet-500',
  续做: 'stroke-slate-500',
  接在后面: 'stroke-teal-500',
};

/** 以 root 为坐标原点量元素位置；root 带 CSS zoom 时换算回缩放前的坐标。 */
function makeMeasure(root: HTMLElement) {
  const box = root.getBoundingClientRect();
  const k = box.width && root.offsetWidth ? box.width / root.offsetWidth : 1;
  return (el: Element): Rect => {
    const r = el.getBoundingClientRect();
    const top = (r.top - box.top) / k;
    return {
      left: (r.left - box.left) / k,
      right: (r.right - box.left) / k,
      top,
      bottom: (r.bottom - box.top) / k,
      mid: top + Math.min(r.height / k / 2, 22),
    };
  };
}

/** 上级卡 → 下级卡：下级卡有缩进时，从上级卡底边往下、直角拐进下级卡；没缩进时在左边绕下来。 */
function parentChildLines(cards: Map<string, HTMLElement>, measure: (el: Element) => Rect): Line[] {
  const out: Line[] = [];
  for (const el of cards.values()) {
    const parent = el.dataset.jgParent ? cards.get(el.dataset.jgParent) : undefined;
    if (!parent) continue;
    const p = measure(parent);
    const c = measure(el);
    const shift = c.left - p.left;
    let d: string;
    if (shift >= 8) {
      const xp = p.left + Math.min(14, Math.round(shift / 2));
      const r = Math.min(6, (c.left - xp) / 2);
      d = `M${xp} ${p.bottom}V${c.mid - r}Q${xp} ${c.mid} ${xp + r} ${c.mid}H${c.left}`;
    } else {
      const xp = Math.min(p.left, c.left) - 8;
      d =
        `M${p.left} ${p.mid}H${xp + 4}Q${xp} ${p.mid} ${xp} ${p.mid + 4}` +
        `V${c.mid - 4}Q${xp} ${c.mid} ${xp + 4} ${c.mid}H${c.left}`;
    }
    out.push({
      d,
      cls: REL_CLS[el.dataset.jgRel ?? ''] ?? 'stroke-slate-500',
      ends: [el.dataset.jgParent ?? '', el.dataset.jgId ?? ''],
    });
  }
  return out;
}

function cardMap(scope: Element): Map<string, HTMLElement> {
  const cards = new Map<string, HTMLElement>();
  for (const el of scope.querySelectorAll<HTMLElement>('[data-jg-card]')) {
    if (el.dataset.jgId) cards.set(el.dataset.jgId, el);
  }
  return cards;
}

/** 一张卡和挂在它下面的卡（验收、续做…），下面的卡缩进、用竖线连着。 */
function CardTree({
  item,
  now,
  onOpen,
  compact,
  currentSessionId,
  top,
  depth = 0,
  maxIndent = 4,
  onArchive,
}: {
  item: CardItem;
  now: Date;
  onOpen: (sessionId: string) => void;
  compact?: boolean;
  currentSessionId?: string | null;
  top?: boolean;
  depth?: number;
  /** 最多缩进几层：按栏宽自动算，宽就多缩、窄就少缩，保证卡片留够宽度 */
  maxIndent?: number;
  onArchive?: (item: CardItem) => void;
}) {
  const indent = depth < maxIndent;
  return (
    <div className={cn('flex flex-col', compact ? 'gap-1' : 'gap-2')} data-jg-top={top ? '1' : undefined}>
      <JiangongCard
        item={item}
        now={now}
        onOpen={onOpen}
        compact={compact}
        current={currentSessionId ? item.sessionIds.includes(currentSessionId) : false}
        onArchive={onArchive}
      />
      {item.children.length ? (
        <div
          className={cn(
            'flex flex-col',
            compact ? 'gap-1' : 'gap-2',
            indent && (compact ? 'ml-2.5' : 'ml-5 pl-4')
          )}
        >
          {item.children.map((ch) => (
            <CardTree
              key={ch.card}
              item={ch}
              now={now}
              onOpen={onOpen}
              compact={compact}
              currentSessionId={currentSessionId}
              depth={depth + 1}
              maxIndent={maxIndent}
              onArchive={onArchive}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** 整页监工：左边发起人，右边卡片，连线连起来。 */
/** 旧版：按卡画树（11-18 起整页换成按项目的 project-board.tsx，这个先留着不挂路由） */
export function JiangongCardsView() {
  const { t } = useTranslation();
  const { groups, total, openSession } = useJiangong();
  const [isLeftSidebarCollapsed, setLeftSidebarCollapsed] = useAtom(sidebarCollapsedAtom);
  const isElectronFullscreen = useElectronFullscreen();
  const hasMacOSTitlebarInset = !isNativeAppShell() && isMacOSElectronRenderer() && !isElectronFullscreen;

  const canvasRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useZoom('page', 1);
  useWheelZoom(scrollRef, setZoom);
  const listRef = useRef<HTMLDivElement>(null);
  const pageIndent = useAdaptiveIndent(listRef, CARD_W, 36);
  const runtime = useAtomValue(activeWorkspaceRuntimeAtom);
  const archiveCards = useArchiveCards();
  const archiveOne = useArchiveOne();
  const [clearing, setClearing] = useState(false);
  const oldCards = useMemo(
    () => groups.flatMap((g) => flattenCards(g.cards)).filter((c) => !c.running),
    [groups]
  );
  const clearOld = useCallback(async () => {
    if (!runtime || oldCards.length === 0) return;
    const count = (tone: Tone) => oldCards.filter((c) => c.tone === tone).length;
    const notes = [
      count('wait') ? `${count('wait')} 张等你` : '',
      count('warn') ? `${count('warn')} 张没验全` : '',
      count('bad') ? `${count('bad')} 张没过` : '',
      oldCards.filter((c) => c.unread).length ? `${oldCards.filter((c) => c.unread).length} 张没看过` : '',
    ].filter(Boolean);
    const ok = window.confirm(
      `清空 ${oldCards.length} 张不在跑的卡？` +
        (notes.length ? `\n其中有 ${notes.join('、')}。` : '') +
        '\n在跑的卡保留。清掉的卡算作看过；卡再跑起来会自动回来，也能在归档里找回。'
    );
    if (!ok) return;
    setClearing(true);
    let done = 0;
    try {
      for (const c of oldCards) {
        await archiveCards([c]);
        done += 1;
      }
      toast.success(`已清空 ${done} 张旧卡片`);
    } catch (e) {
      toast.error(`清空到第 ${done + 1} 张时出错：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setClearing(false);
    }
  }, [archiveCards, oldCards, runtime]);
  const [paths, setPaths] = useState<Line[]>([]);
  const [hovered, setHovered] = useState<string | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const drawLines = useCallback(() => {
    const root = canvasRef.current;
    if (!root) return;
    const box = root.getBoundingClientRect();
    // CSS zoom 下量到的是缩放后的尺寸，画线用的是缩放前的坐标
    const k = box.width && root.offsetWidth ? box.width / root.offsetWidth : 1;
    const next: Line[] = [];
    const rel = (el: Element) => {
      const r = el.getBoundingClientRect();
      return {
        left: (r.left - box.left) / k,
        right: (r.right - box.left) / k,
        top: (r.top - box.top) / k,
        bottom: (r.bottom - box.top) / k,
        mid: (r.top - box.top) / k + Math.min(r.height / k / 2, 22),
      };
    };
    for (const group of root.querySelectorAll<HTMLElement>('[data-jg-group]')) {
      const who = group.querySelector<HTMLElement>('[data-jg-owner]')?.getBoundingClientRect();
      if (!who) continue;
      const x0 = (who.right - box.left) / k;
      const y0 = (who.top + who.height / 2 - box.top) / k;
      const xm = x0 + 24;
      const tops = Array.from(group.querySelectorAll<HTMLElement>('[data-jg-top]')).map(
        (el) => el.querySelector<HTMLElement>('[data-jg-card]')
      );
      for (const card of tops) {
        if (!card) continue;
        const r = card.getBoundingClientRect();
        const x1 = (r.left - box.left) / k;
        const y1 = (r.top - box.top) / k + Math.min(r.height / k / 2, 22);
        const bend = y1 > y0 ? 6 : -6;
        const d =
          Math.abs(y1 - y0) < 14
            ? `M${x0} ${y0}H${xm}V${y1}H${x1}`
            : `M${x0} ${y0}H${xm - 6}Q${xm} ${y0} ${xm} ${y0 + bend}V${y1 - bend}Q${xm} ${y1} ${xm + 6} ${y1}H${x1}`;
        next.push({
          d,
          cls: card.dataset.jgRunning === '1' ? 'stroke-blue-500' : 'stroke-slate-400 dark:stroke-slate-500',
          ends: [card.dataset.jgId ?? ''],
        });
      }
      // 上级卡 → 下级卡
      const cards = cardMap(group);
      let rightEdge = 0;
      for (const el of cards.values()) rightEdge = Math.max(rightEdge, rel(el).right);
      next.push(...parentChildLines(cards, rel));
      // 要等别的卡：从被等的卡右边引出，绕到右侧，箭头指向在等的卡
      let lane = 0;
      for (const el of cards.values()) {
        const waits = (el.dataset.jgWaits ?? '').split(',').filter(Boolean);
        const c = rel(el);
        for (const id of waits) {
          const dep = cards.get(id);
          if (!dep) continue;
          const s0 = rel(dep);
          const lx = rightEdge + 10 + (lane % 5) * 7;
          lane += 1;
          const down = c.mid > s0.mid ? 1 : -1;
          const d =
            `M${s0.right} ${s0.mid}H${lx - 6}Q${lx} ${s0.mid} ${lx} ${s0.mid + 6 * down}` +
            `V${c.mid - 6 * down}Q${lx} ${c.mid} ${lx - 6} ${c.mid}H${c.right + 4}`;
          next.push({ d, cls: 'stroke-amber-500', dash: true, arrow: true, ends: [id, el.dataset.jgId ?? ''] });
        }
      }
    }
    setPaths(next);
    setSize({ w: root.scrollWidth, h: root.scrollHeight });
  }, []);

  useLayoutEffect(() => {
    drawLines();
    const root = canvasRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => drawLines());
    observer.observe(root);
    return () => observer.disconnect();
  }, [drawLines, groups, zoom]);

  const now = new Date();

  return (
    <div className="flex h-full w-full min-w-0 flex-col overflow-hidden bg-background">
      <div
        className={cn(
          'flex h-12 shrink-0 items-center gap-3 border-b px-4 text-xs text-muted-foreground',
          hasMacOSTitlebarInset && isLeftSidebarCollapsed && 'pl-20'
        )}
      >
        {isLeftSidebarCollapsed ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setLeftSidebarCollapsed(false)}
            aria-label={t('jiangong.openSidebar', 'Open sidebar')}
          >
            <PanelLeft className="h-4 w-4" />
          </Button>
        ) : null}
        <span className="w-[200px] shrink-0 font-medium text-foreground">{t('jiangong.initiator', '发起人')}</span>
        <span className="ml-14">{t('jiangong.sessions', '会话 · {{count}}', { count: total })}</span>
        <Legend />
        <Button
          variant="outline"
          size="sm"
          className="h-7 shrink-0 gap-1 px-2 text-xs"
          disabled={clearing || oldCards.length === 0 || !runtime}
          onClick={() => void clearOld()}
          title="把不在跑的卡都收起来（归档），在跑的保留"
        >
          <Trash2 className="h-3.5 w-3.5" />
          {clearing ? '清空中…' : `清空旧卡片${oldCards.length ? ` (${oldCards.length})` : ''}`}
        </Button>
        <ZoomControls zoom={zoom} setZoom={setZoom} />
      </div>
      <div
        ref={scrollRef}
        className="relative min-h-0 flex-1 overflow-auto"
        style={{
          backgroundImage: 'radial-gradient(hsl(var(--border)) 1px, transparent 1px)',
          backgroundSize: '16px 16px',
        }}
      >
        <div
          ref={canvasRef}
          className="relative px-4 py-5"
          style={{ zoom }}
          onMouseOver={(e) => {
            const id = (e.target as HTMLElement).closest<HTMLElement>('[data-jg-card]')?.dataset.jgId ?? null;
            if (id !== hovered) setHovered(id);
          }}
          onMouseLeave={() => setHovered(null)}
        >
          <svg
            className="pointer-events-none absolute left-0 top-0 overflow-visible"
            width={size.w}
            height={size.h}
            aria-hidden
          >
            <defs>
              <marker id="jg-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto">
                <path d="M0,0 L8,4 L0,8 z" className="fill-amber-500" />
              </marker>
            </defs>
            {paths.map((p, i) => {
              const on = hovered ? p.ends.includes(hovered) : null;
              return (
                <path
                  key={i}
                  d={p.d}
                  fill="none"
                  strokeWidth={on ? 3 : 2}
                  strokeDasharray={p.dash ? '5 3' : undefined}
                  markerEnd={p.arrow ? 'url(#jg-arrow)' : undefined}
                  className={cn(p.cls, 'transition-opacity', on === false && 'opacity-15')}
                />
              );
            })}
          </svg>
          {groups.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              {t('jiangong.empty', '现在没有在跑或刚跑完的卡。')}
            </div>
          ) : null}
          {groups.map((group) => (
            <div key={group.owner} data-jg-group className="mb-6 flex flex-col gap-3 md:flex-row md:items-start md:gap-14">
              <OwnerBadge group={group} />
              <div
                ref={group === groups[0] ? listRef : undefined}
                className="flex min-w-0 flex-1 flex-col gap-2.5 md:mr-16"
              >
                {group.cards.map((item) => (
                  <CardTree
                    key={item.card}
                    item={item}
                    now={now}
                    onOpen={openSession}
                    top
                    maxIndent={pageIndent}
                    onArchive={archiveOne}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Legend() {
  const items: { tone: Tone; label: string }[] = [
    { tone: 'wait', label: '等你' },
    { tone: 'warn', label: '没验全' },
    { tone: 'run', label: '在跑' },
    { tone: 'bad', label: '没过' },
    { tone: 'ok', label: '通过' },
    { tone: 'off', label: '已停' },
  ];
  return (
    <span className="ml-auto flex items-center gap-2.5">
      {items.map((it) => (
        <span key={it.tone} className="flex items-center gap-1">
          <span className={cn('h-2.5 w-1.5 rounded-sm', TONE_STYLE[it.tone].bar)} />
          {it.label}
        </span>
      ))}
      <span className="text-muted-foreground/70">· 显示在跑的、没看过的、看过但跑完不到两小时的卡</span>
    </span>
  );
}

/** 会话页右侧栏里的窄版：看会话时并排看全局，当前会话所在的卡高亮。 */
export function JiangongPanel({ currentSessionId }: { currentSessionId?: string | null }) {
  const { t } = useTranslation();
  const { groups, openSession } = useJiangong();
  const archiveOne = useArchiveOne();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useZoom('panel-mini', 1);
  useWheelZoom(scrollRef, setZoom);
  const bodyRef = useRef<HTMLDivElement>(null);
  const panelIndent = useAdaptiveIndent(bodyRef, 200, 10);
  const [lines, setLines] = useState<Line[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const draw = useCallback(() => {
    const root = bodyRef.current;
    if (!root) return;
    setLines(parentChildLines(cardMap(root), makeMeasure(root)));
    setSize({ w: root.scrollWidth, h: root.scrollHeight });
  }, []);
  useLayoutEffect(() => {
    draw();
    const root = bodyRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => draw());
    observer.observe(root);
    return () => observer.disconnect();
  }, [draw, groups, zoom, panelIndent]);
  const now = new Date();
  return (
    <div ref={scrollRef} className="relative h-full overflow-auto bg-background">
      <div className="sticky top-0 z-10 flex items-center justify-end border-b bg-background/95 px-3 py-1.5 backdrop-blur">
        <ZoomControls zoom={zoom} setZoom={setZoom} />
      </div>
      <div ref={bodyRef} className="relative px-3 py-3" style={{ zoom }}>
        <svg
          className="pointer-events-none absolute left-0 top-0 overflow-visible"
          width={size.w}
          height={size.h}
          aria-hidden
        >
          {lines.map((l, i) => (
            <path key={i} d={l.d} fill="none" strokeWidth={1.5} className={l.cls} />
          ))}
        </svg>
      {groups.length === 0 ? (
        <div className="py-10 text-center text-xs text-muted-foreground">
          {t('jiangong.empty', '现在没有在跑或刚跑完的卡。')}
        </div>
      ) : null}
      {groups.map((group) => (
        <div key={group.owner} className="mb-4 flex flex-col gap-2">
          <OwnerBadge group={group} compact />
          <div className="ml-3 flex flex-col gap-1 border-l-2 border-border pl-2.5">
            {group.cards.map((item) => (
              <CardTree
                key={item.card}
                item={item}
                now={now}
                onOpen={openSession}
                compact
                currentSessionId={currentSessionId}
                maxIndent={panelIndent}
                onArchive={archiveOne}
              />
            ))}
          </div>
        </div>
      ))}
      </div>
    </div>
  );
}
