import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Maximize2,
  MessageSquare,
  Minus,
  PanelLeft,
  PauseCircle,
  Plus,
  Send,
  Square,
  User,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { getMachineRoomId, type WfCardMeta, type WfHoldInfo, type WfStepItem } from '@lody/shared';
import { activeWorkspaceRuntimeAtom } from '@/atoms/runtime';
import { machineMetaCacheAtom } from '@/atoms/doc-meta';
import { sidebarCollapsedAtom } from '@/atoms/sidebar-state';
import { isMacOSElectronRenderer, useElectronFullscreen } from '@/lib/electron';
import { isNativeAppShell } from '@/lib/native-platform';
import { cn } from '@/lib/utils';
import { Button } from '@/ui/button';
import {
  flattenCards,
  hm,
  useArchiveCards,
  useJiangong,
  type CardItem,
  type ProjectGroup,
} from './jiangong-view';

/**
 * 监工看板 v3 — 并行 DAG 拓扑画布 + 固定右侧详情栏：
 * - 横向（左→右）= 因果与时间阶段（实施 → 验收 → 返修 / 续做 / 汇合集成）
 * - 纵向（上→下）= 并行泳道（多条并行任务、分叉子卡、卡内并行分块）
 * - SVG 贝塞尔连线 + 关系标签，清晰呈现 1→N 分叉与 N→1 汇合
 * - 每个节点直接露出具体会话入口，点击直达会话；点节点主体在右侧固定栏看数据/成本/验收表
 * - 克制用色，仅关键阻断/未过结论使用暗红色（#991B1B / dark:#F87171）
 */

const PM_BOTS: Record<string, string> = {
  心里项目经理: '497471fd-400c-4d16-b536-a07955d6f286',
  PDRS项目经理: 'dd1498c8-8b1f-4f5b-b7c4-18402d16beee',
  投顾项目助手: '73067299-37ba-451c-9901-94a511c2bb22',
};

const DEFAULT_PROJECTS: Array<{ project: string; owner: string }> = [
  { project: '心里', owner: '心里项目经理' },
  { project: 'agentCPM', owner: 'PDRS项目经理' },
  { project: '投顾', owner: '投顾项目助手' },
  { project: 'PDRS', owner: 'PDRS项目经理' },
];

const RED_TEXT = 'text-[#991B1B] dark:text-[#F87171]';
const RED_STROKE = 'stroke-[#991B1B] dark:stroke-[#F87171]';

type Action = 'stop' | 'resume' | 'redirect' | 'pm';

type GraphNode = {
  id: string;
  card: CardItem;
  iterations: CardItem[];
  trackTitle: string;
  reviews: CardItem[];
  retries: CardItem[];
  col: number;
  x: number;
  y: number;
  w: number;
  h: number;
  lane: number;
  project: string;
  compact: boolean;
  hasDownstream: boolean;
  isHistorical: boolean;
};

type StepBand = {
  key: string;
  stepNum: number;
  stepTitle: string;
  dateLabel: string;
  parallelCount: number;
  hasRunning: boolean;
  isToday: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
};

type TaskGroupBox = {
  id: string;
  project: string;
  taskNum: number;
  title: string;
  stepCount: number;
  hasRunning: boolean;
  hasRed: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
};

type FoldNode = {
  id: string;
  foldKey: string;
  parentId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  hiddenCount: number;
  summary: string;
  expanded: boolean;
};

type GraphEdge = {
  id: string;
  fromId: string;
  toId: string;
  label: string;
  dashed: boolean;
  critical: boolean;
};

type PmNode = {
  id: string;
  project: string;
  owner: string;
  x: number;
  y: number;
  w: number;
  h: number;
  runCount: number;
  lookCount: number;
  totalCount: number;
};

type LayoutResult = {
  pmNodes: PmNode[];
  taskBoxes: TaskGroupBox[];
  nodes: GraphNode[];
  foldNodes: FoldNode[];
  stepBands: StepBand[];
  edges: GraphEdge[];
  width: number;
  height: number;
  parallelRunningCount: number;
};

const STEP_RAIL_W = 84;
const TASK_HEADER_H = 44;
const TASK_PAD = 12;
const TASK_GAP = 24;
const PM_H = 44;
const NODE_W = 248;
const COL_GAP = 14;
const STEP_GAP = 26;
const PROJ_GAP = 36;
const PAD_X = 16;
const PAD_Y = 14;

function wfOf(c: CardItem): WfCardMeta {
  return c.main.wf;
}

const ROLE_ORDER = ['执行', '分块', '验收', '工程师', '写手', '写卡'];
function roleRank(role: string | undefined): number {
  const i = ROLE_ORDER.findIndex((r) => (role ?? '').startsWith(r));
  return i < 0 ? ROLE_ORDER.length : i;
}

function isWriterRole(role: string | undefined): boolean {
  const r = role ?? '';
  return r === '写手' || r === '写卡' || r.startsWith('写手') || r.startsWith('写卡');
}

function roleShort(role: string | undefined): string {
  const r = role ?? '';
  if (isWriterRole(r)) return '写手';
  if (r.startsWith('分块')) return r.replace(/^分块\s*/, '块:');
  if (r.startsWith('验收')) return '验收';
  if (r.startsWith('工程师')) return '诊断';
  return '执行';
}

function realSessionsOf(c: CardItem) {
  return [c.main, ...c.others]
    .filter((s) => !s.session.id.startsWith('wf-card-'))
    .sort((a, b) => roleRank(a.wf.role) - roleRank(b.wf.role));
}

/** 卡片正面展示的会话：已交棒的写手不占正面（进右侧详情栏），仅保留真正需要盯的执行/分块/验收会话。 */
function faceSessionsOf(c: CardItem) {
  const all = realSessionsOf(c);
  if (all.length <= 1) return all;
  const kept = all.filter((s) => !(s.wf.writerDone || isWriterRole(s.wf.role)));
  return kept.length > 0 ? kept : all;
}

/** 每条会话的「它在干嘛」大白话：优先小模型总结（wf.doing），尚未生成时用步骤/分块/目标兜底。 */
function sessionDoingText(s: CardItem['main'], c: CardItem): string {
  const doing = (s.wf.doing ?? '').trim();
  if (doing) return doing;
  const steps = s.wf.steps ?? [];
  for (let i = steps.length - 1; i >= 0; i--) {
    const did = (steps[i]?.did ?? '').trim();
    if (did && did !== '还在做' && did !== '照施工指令开工') return did;
    const ask = (steps[i]?.ask ?? '').trim();
    if (ask && ask !== '照施工指令开工' && ask !== '接着做') return ask;
  }
  const role = s.wf.role ?? '';
  if (role.startsWith('分块')) {
    const name = role.replace(/^分块\s*/, '').trim();
    return c.running ? `正在并行处理「${name}」` : `分块「${name}」已结束`;
  }
  if (isWriterRole(role)) return c.running ? '正在读仓库并写施工指令' : '已写好施工指令';
  if (role.startsWith('验收')) return c.running ? '正在独立验收本轮改动' : (wfOf(c).label || '验收已完成');
  const title = (wfOf(c).title || wfOf(c).goal || '').trim();
  if (title) return c.running ? `正在推进：${title}` : title;
  return c.running ? '正在执行任务' : (wfOf(c).label || '已结束');
}

function fmtDur(sec: number | undefined): string {
  if (!sec || sec < 0) return '';
  const s = Math.floor(sec);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h${rm}m` : `${h}h`;
}

function fmtTok(n: number | undefined): string {
  if (!n || n <= 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(Math.round(n));
}

function cardDur(c: CardItem, nowSec: number): number | undefined {
  const w = wfOf(c);
  if (c.running && w.startedAt) return Math.max(0, nowSec - w.startedAt);
  if (typeof w.durationSec === 'number' && w.durationSec > 0) return w.durationSec;
  if (w.startedAt && c.updatedAt >= w.startedAt) return c.updatedAt - w.startedAt;
  return undefined;
}

function cardCritical(c: CardItem, nowSec: number): string {
  const w = wfOf(c);
  if (w.stub) return '';
  if (c.running) {
    const idle = w.lastOutputAt ? Math.max(0, nowSec - w.lastOutputAt) : 0;
    if (idle >= 20 * 60) return `已 ${fmtDur(idle)} 无新输出`;
    const dur = cardDur(c, nowSec) ?? 0;
    if (w.expectMin && dur > w.expectMin * 60) return `超预计 ${w.expectMin}m`;
    return '';
  }
  if (w.blocker) return w.blocker;
  if (w.unverified && w.unverifiedWhy) return `没验全：${w.unverifiedWhy}`;
  if (w.cbFail) return `回传失败：${w.callback || '通道异常'}`;
  if (c.tone === 'bad' || c.tone === 'wait' || c.tone === 'warn') {
    return w.detail || w.label || w.status || '异常';
  }
  return '';
}

function cardBadge(c: CardItem): { label: string; isRed: boolean; isRun: boolean; isOk: boolean } {
  const w = wfOf(c);
  if (c.running) {
    return { label: w.rounds && w.rounds > 1 ? `在跑·R${w.rounds}` : '在跑', isRed: false, isRun: true, isOk: false };
  }
  if (w.cbFail) return { label: '回传失败', isRed: true, isRun: false, isOk: false };
  if (w.unverified) return { label: '没验全', isRed: true, isRun: false, isOk: false };
  if (w.autoFix === 'done') return { label: '已返修', isRed: false, isRun: false, isOk: false };
  const label = w.label || w.status || '—';
  const isRed = c.tone === 'bad' || c.tone === 'wait' || c.tone === 'warn';
  return { label, isRed, isRun: false, isOk: c.tone === 'ok' };
}

function stageName(w: WfCardMeta): string {
  if (w.stub) return '前置';
  if (w.kind === '验收') return '验收';
  if (w.kind === '集成') return '集成';
  return '实施';
}

function machineOfCard(c: CardItem): string | undefined {
  const sid = (c.main.session as { machineId?: string }).machineId;
  if (typeof sid === 'string' && sid) return sid;
  return (c.main.wf as WfCardMeta & { boardMachine?: string }).boardMachine;
}

function isReviewCard(c: CardItem): boolean {
  const w = wfOf(c);
  return w.kind === '验收' || w.kind === 'review' || c.rel === '验收';
}

function reviewSummaryPill(reviews: CardItem[]): { text: string; isRun: boolean; isOk: boolean; isRed: boolean } | null {
  if (reviews.length === 0) return null;
  const running = reviews.find((r) => r.running);
  const countSuffix = reviews.length > 1 ? `×${reviews.length}` : '';
  if (running) {
    return { text: `验收中${countSuffix}`, isRun: true, isOk: false, isRed: false };
  }
  const latest = reviews[0]!;
  const sc = wfOf(latest).scenarioCounts;
  const b = cardBadge(latest);
  if (b.isOk) {
    return { text: `验过${countSuffix}`, isRun: false, isOk: true, isRed: false };
  }
  if (sc && sc.pass + sc.fail + sc.unverified > 0) {
    const total = sc.pass + sc.fail + sc.unverified;
    return { text: `验${sc.pass}/${total}${countSuffix}`, isRun: false, isOk: false, isRed: true };
  }
  return { text: `${b.label}${countSuffix}`, isRun: false, isOk: false, isRed: b.isRed };
}

function isCompactNode(c: CardItem, reviews: CardItem[], compactDone: boolean): boolean {
  if (!compactDone) return false;
  // 紧凑全览模式：正在跑的卡（含内嵌验收正在跑）保持常驻展开；其余已结束/历史卡统一收成 44px 紧凑卡，鼠标移上去原地浮层展开
  return !c.running && !reviews.some((r) => r.running);
}

function pickTrackTitle(iterations: CardItem[]): string {
  const latest = iterations[iterations.length - 1]!;
  const first = iterations[0]!;
  const latestTitle = (wfOf(latest).title || wfOf(latest).goal || latest.card).trim();
  if (iterations.length <= 1) return latestTitle;
  const firstTitle = (wfOf(first).title || wfOf(first).goal || first.card).trim();
  if (/^(补上验收|接替|换通道|修掉剩余)/.test(latestTitle) && firstTitle && firstTitle !== latestTitle) {
    return firstTitle;
  }
  return latestTitle;
}

/** 确定性节点高度（严格预留完整高度，杜绝上下步骤遮挡重叠） */
function estimateNodeHeight(
  c: CardItem,
  iterations: CardItem[],
  reviews: CardItem[],
  nowSec: number,
  compact: boolean,
  trackTitle: string
): number {
  if (compact) return 50;
  const w = wfOf(c);
  const curTitle = (trackTitle || w.title || w.goal || c.card).trim();
  const displayTitle = w.goal && curTitle.endsWith('…') ? w.goal : curTitle;
  const titleLines = Math.min(4, Math.max(2, Math.ceil(displayTitle.length / 15)));
  let h = 24 + titleLines * 17; // 顶行 + 最多 4 行标题

  const red = cardCritical(c, nowSec);
  if (red) {
    const redLines = Math.min(3, Math.max(1, Math.ceil(red.length / 17)));
    h += 8 + redLines * 16;
  }

  const faceSessions = faceSessionsOf(c);
  const shownSessions = faceSessions.slice(0, 4);
  h += 14; // border-t + pt-1.5
  if (shownSessions.length > 0) {
    for (const s of shownSessions) {
      const doing = sessionDoingText(s, c);
      const lines = Math.min(3, Math.max(1, Math.ceil(doing.length / 16)));
      h += 12 + lines * 16 + 4;
    }
    if (faceSessions.length > 4) h += 18;
  } else {
    h += 24;
  }

  if (reviews.length > 0) {
    const shownReviews = reviews.slice(0, 2);
    h += 28; // header + border-t
    for (const rv of shownReviews) {
      const rvSessions = faceSessionsOf(rv);
      const rvMain = rvSessions[0];
      const rvText = rvMain
        ? sessionDoingText(rvMain, rv)
        : cardCritical(rv, nowSec) || wfOf(rv).label || cardBadge(rv).label;
      const lines = Math.min(3, Math.max(1, Math.ceil(rvText.length / 16)));
      h += 10 + lines * 15 + 4;
    }
    if (reviews.length > 2) h += 18;
  }

  return h + 6;
}

function dayKeyOf(sec: number): string {
  const d = new Date((sec || Date.now() / 1000) * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dayLabelOf(key: string, nowSec: number): { label: string; isToday: boolean } {
  const today = dayKeyOf(nowSec);
  const yest = dayKeyOf(nowSec - 86400);
  const md = key.slice(5); // MM-DD
  if (key === today) return { label: `${md} 今天`, isToday: true };
  if (key === yest) return { label: `${md} 昨天`, isToday: false };
  return { label: md, isToday: false };
}

/** 正在执行的呼吸雷达指示灯（双层发光 + animate-ping 呼吸波纹） */
function BreathingDot({ size = 'md', className }: { size?: 'sm' | 'md'; className?: string }) {
  const cls = size === 'sm' ? 'h-2 w-2' : 'h-2.5 w-2.5';
  return (
    <span className={cn('relative inline-flex shrink-0 items-center justify-center', cls, className)}>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-85" />
      <span className={cn('relative inline-flex rounded-full bg-sky-500 shadow-[0_0_8px_rgba(14,165,233,0.95)]', cls)} />
    </span>
  );
}

/**
 * 两层「项目大步骤 → 模块框（收纳多轮迭代施工卡与验收）」布局引擎：
 * - 第一层（纵向从上到下）：4–6 个项目大步骤（第 1 步 → … → 最底部最新一步）
 * - 第二层（同一步内横向并排）：每个子模块框代表一条完整功能模块（自动收纳该模块下的 N 轮 from 迭代施工卡 + 独立验收卡）
 * - 自动过滤 > 4 天前无近期下游的孤立僵尸旧卡（如 11-12 残余卡），不让旧残余抢占「第 1 步」
 */
function layoutDAG(
  entries: Array<{ project: string; owner: string; cards: CardItem[] }>,
  nowSec: number,
  compactDone: boolean,
  selectedNodeId: string | null
): LayoutResult {
  const pmNodes: PmNode[] = [];
  const taskBoxes: TaskGroupBox[] = [];
  const nodes: GraphNode[] = [];
  const foldNodes: FoldNode[] = [];
  const stepBands: StepBand[] = [];
  const edges: GraphEdge[] = [];
  let cursorY = PAD_Y;
  let maxX = PAD_X + NODE_W * 2;
  let parallelRunningCount = 0;
  let laneIdx = 0;

  for (const entry of entries) {
    const rawAll: CardItem[] = [];
    const rawById = new Map<string, CardItem>();
    for (const c of flattenCards(entry.cards)) {
      if (rawById.has(c.card)) continue;
      rawById.set(c.card, c);
      rawAll.push(c);
    }
    if (rawAll.length === 0) continue;

    const cardTs = (c: CardItem) => wfOf(c).startedAt || c.updatedAt;
    const recentCutoff = nowSec - 4 * 86400;
    // 过滤超过 4 天且无近期活跃下游的陈旧孤立卡（如 11-12 的僵尸卡），避免抢占「第 1 步」
    const activeSet = new Set<string>();
    for (const c of rawAll) {
      if (c.running || c.updatedAt >= recentCutoff) activeSet.add(c.card);
    }
    // 只保留 4 天内的活跃卡及其直接 1 层近期父卡（不跨周拉 11-12 / 11-13 的古早卡）
    const allCards = rawAll.filter((c) => {
      if (!activeSet.has(c.card)) return false;
      if (/-(1112|1113|1114|1115|1116)-/.test(c.card) && !c.running) return false;
      return true;
    });
    const allById = new Map<string, CardItem>(allCards.map((c) => [c.card, c]));
    if (allCards.length === 0) continue;

    // 1. 独立验收卡收进对应实施卡
    const reviewHost = new Map<string, string>();
    const reviewsByHost = new Map<string, CardItem[]>();
    const resolveHost = (cid: string, depth = 0): string | null => {
      if (depth > 5) return null;
      const card = allById.get(cid);
      if (!card) return null;
      if (!isReviewCard(card)) return cid;
      const target = wfOf(card).of || card.parent;
      if (!target || target === cid || !allById.has(target)) return null;
      return resolveHost(target, depth + 1);
    };
    for (const c of allCards) {
      if (!isReviewCard(c)) continue;
      const hostId = resolveHost(c.card);
      if (hostId && hostId !== c.card) {
        reviewHost.set(c.card, hostId);
        reviewsByHost.set(hostId, [...(reviewsByHost.get(hostId) ?? []), c]);
      }
    }
    for (const [hostId, list] of reviewsByHost.entries()) {
      list.sort((a, b) => (b.running ? 1 : 0) - (a.running ? 1 : 0) || b.updatedAt - a.updatedAt);
      reviewsByHost.set(hostId, list);
    }

    // 2. 清理同一父节点下报错/停掉且无下游的废叶子分支（如 bad_accept / stopped 旁已有重开的成功同级卡）
    const nonReview = allCards.filter((c) => !reviewHost.has(c.card));
    const nonReviewById = new Map<string, CardItem>(nonReview.map((c) => [c.card, c]));
    const rawChildren = new Map<string, string[]>();
    for (const c of nonReview) {
      const p = c.parent ? (reviewHost.get(c.parent) ?? c.parent) : '';
      if (p && nonReviewById.has(p) && p !== c.card) {
        rawChildren.set(p, [...(rawChildren.get(p) ?? []), c.card]);
      }
    }
    const deadRemoved = new Set<string>();
    const retriesByHost = new Map<string, CardItem[]>();
    for (const [, kids] of rawChildren.entries()) {
      if (kids.length <= 1) continue;
      const alive = kids.filter((k) => {
        const kc = nonReviewById.get(k)!;
        return kc.running || kc.tone === 'ok' || (rawChildren.get(k)?.length ?? 0) > 0;
      });
      const dead = kids.filter((k) => !alive.includes(k));
      if (alive.length > 0 && dead.length > 0) {
        const host = alive[alive.length - 1]!;
        for (const d of dead) {
          deadRemoved.add(d);
          retriesByHost.set(host, [...(retriesByHost.get(host) ?? []), nonReviewById.get(d)!]);
        }
      }
    }
    const normGoal = (c: CardItem) => (wfOf(c).goal || wfOf(c).title || '').replace(/\s+/g, '').slice(0, 18);
    for (const c of nonReview) {
      if (deadRemoved.has(c.card)) continue;
      if (!c.running && c.tone !== 'ok' && (rawChildren.get(c.card)?.length ?? 0) === 0 && !c.parent) {
        const g = normGoal(c);
        const survivor = nonReview.find(
          (o) => o.card !== c.card && !deadRemoved.has(o.card) && normGoal(o) === g && (o.running || o.tone === 'ok')
        );
        if (survivor) {
          deadRemoved.add(c.card);
          retriesByHost.set(survivor.card, [...(retriesByHost.get(survivor.card) ?? []), c]);
        }
      }
    }

    const aliveImpls = nonReview.filter((c) => !deadRemoved.has(c.card));
    const aliveById = new Map<string, CardItem>(aliveImpls.map((c) => [c.card, c]));
    if (aliveImpls.length === 0) continue;

    // 3. 只把「同目标重试」或「纯 TLS 启动失败接替」压进同一个步骤节点，保留大任务内部每一个真实的步骤节点！
    const outKids = new Map<string, string[]>();
    for (const c of aliveImpls) {
      const p = c.parent ? (reviewHost.get(c.parent) ?? c.parent) : '';
      if (p && aliveById.has(p) && p !== c.card) {
        outKids.set(p, [...(outKids.get(p) ?? []), c.card]);
      }
    }
    const trackMembers = new Map<string, CardItem[]>(aliveImpls.map((c) => [c.card, [c]]));
    const mergedInto = new Map<string, string>();
    const findTrack = (id: string): string => {
      let cur = id;
      const seen = new Set<string>();
      while (mergedInto.has(cur) && !seen.has(cur)) {
        seen.add(cur);
        cur = mergedInto.get(cur)!;
      }
      return cur;
    };

    const sortedAlive = [...aliveImpls].sort((a, b) => cardTs(a) - cardTs(b));
    for (const u of sortedAlive) {
      const kids = outKids.get(u.card) ?? [];
      if (kids.length === 1) {
        const v = aliveById.get(kids[0]!)!;
        const sameGoal = normGoal(u) === normGoal(v);
        const tlsReplace = !u.running && u.tone !== 'ok' && /^接替/.test(wfOf(v).goal || '');
        if (sameGoal || tlsReplace) {
          const ru = findTrack(u.card);
          const rv = findTrack(v.card);
          if (ru !== rv && trackMembers.has(ru) && trackMembers.has(rv)) {
            trackMembers.set(rv, [...trackMembers.get(ru)!, ...trackMembers.get(rv)!]);
            trackMembers.delete(ru);
            mergedInto.set(ru, rv);
          }
        }
      }
    }

    // 汇总每个步骤节点的全部 reviews 和 retries
    const trackIds = [...trackMembers.keys()];
    const trackById = new Map<string, CardItem>();
    const trackReviews = new Map<string, CardItem[]>();
    const trackRetries = new Map<string, CardItem[]>();
    const headToTrack = new Map<string, string>();

    for (const tid of trackIds) {
      const members = trackMembers.get(tid)!;
      members.sort((a, b) => cardTs(a) - cardTs(b));
      const latest = members[members.length - 1]!;
      trackById.set(tid, latest);
      const rvs: CardItem[] = [];
      const rts: CardItem[] = [];
      for (const m of members) {
        for (const r of reviewsByHost.get(m.card) ?? []) rvs.push(r);
        for (const rt of retriesByHost.get(m.card) ?? []) rts.push(rt);
        const h = (wfOf(m).head || '').trim().toLowerCase();
        if (h.length >= 7) headToTrack.set(h.slice(0, 7), tid);
      }
      rvs.sort((a, b) => (b.running ? 1 : 0) - (a.running ? 1 : 0) || b.updatedAt - a.updatedAt);
      trackReviews.set(tid, rvs);
      trackRetries.set(tid, rts);
    }

    // 4. 构建步骤之间的有向因果边 + 合版边
    const outEdges = new Map<string, GraphEdge[]>();
    const inEdges = new Map<string, GraphEdge[]>();
    const edgeKeys = new Set<string>();
    const addTrackEdge = (rawFrom: string, rawTo: string, label: string, dashed: boolean) => {
      const u = findTrack(reviewHost.get(rawFrom) ?? rawFrom);
      const v = findTrack(reviewHost.get(rawTo) ?? rawTo);
      if (!trackById.has(u) || !trackById.has(v) || u === v) return;
      const k = `${u}->${v}`;
      if (edgeKeys.has(k)) return;
      edgeKeys.add(k);
      const edge: GraphEdge = { id: k, fromId: u, toId: v, label, dashed, critical: false };
      outEdges.set(u, [...(outEdges.get(u) ?? []), edge]);
      inEdges.set(v, [...(inEdges.get(v) ?? []), edge]);
    };

    const CARD_MENTION_RE = /\b([a-z][a-z0-9]*-\d{4}-\d+(?:-[a-z0-9]+)?)\b/gi;
    const SHA_MENTION_RE = /\b([0-9a-f]{7,10})\b/g;

    for (const tid of trackIds) {
      const members = trackMembers.get(tid)!;
      const endTs = cardTs(members[members.length - 1]!);
      for (const m of members) {
        if (m.parent && allById.has(m.parent)) {
          addTrackEdge(m.parent, tid, m.rel || '推进', false);
        }
        // 连接 card.base（git 起点分支 wf/<card_id> 或上游提交 SHA），还原跨任务的真实代码基座派生关系
        const baseStr = (wfOf(m).base || '').trim();
        if (baseStr.startsWith('wf/')) {
          const ref = baseStr.slice(3).trim();
          if (allById.has(ref) && cardTs(allById.get(ref)!) <= endTs) {
            addTrackEdge(ref, tid, '基于', false);
          }
        } else if (/^[0-9a-f]{7,12}$/i.test(baseStr)) {
          const refTrack = headToTrack.get(baseStr.slice(0, 7).toLowerCase());
          if (refTrack && refTrack !== tid) {
            addTrackEdge(refTrack, tid, '基于', false);
          }
        }
        for (const dep of m.waitsFor) {
          if (allById.has(dep)) addTrackEdge(dep, tid, '前置', true);
        }
        const goalTxt = wfOf(m).goal || '';
        for (const match of goalTxt.matchAll(CARD_MENTION_RE)) {
          const ref = match[1]!;
          if (allById.has(ref) && cardTs(allById.get(ref)!) <= endTs) {
            addTrackEdge(ref, tid, '合入', true);
          }
        }
        for (const match of goalTxt.matchAll(SHA_MENTION_RE)) {
          const sha = match[1]!.slice(0, 7).toLowerCase();
          const refTrack = headToTrack.get(sha);
          if (refTrack && refTrack !== tid) {
            addTrackEdge(refTrack, tid, '合入', true);
          }
        }
        // 合版卡提到的「关键词」自动匹配上游并行分支（如「超三句保留接纳句」或「已含危机判定和新界面」）
        if (/合进|合入|合到同一|三卡合版/.test(goalTxt)) {
          for (const qm of goalTxt.matchAll(/「([^」]{2,12})」/g)) {
            const kw = qm[1]!.slice(0, 4);
            for (const otherId of trackIds) {
              if (otherId === tid) continue;
              const otherMembers = trackMembers.get(otherId)!;
              const otherEnd = cardTs(otherMembers[otherMembers.length - 1]!);
              if (otherEnd <= endTs && otherMembers.some((om) => (wfOf(om).goal || '').includes(kw))) {
                addTrackEdge(otherId, tid, '合入', true);
              }
            }
          }
          if (goalTxt.includes('新界面') && goalTxt.includes('危机判定')) {
            for (const otherId of trackIds) {
              if (otherId === tid) continue;
              const otherMembers = trackMembers.get(otherId)!;
              const otherEnd = cardTs(otherMembers[otherMembers.length - 1]!);
              if (
                otherEnd <= endTs &&
                otherMembers.some((om) => {
                  const g = wfOf(om).goal || '';
                  return g.includes('合进') && g.includes('界面') && g.includes('危机');
                })
              ) {
                addTrackEdge(otherId, tid, '合入', true);
              }
            }
          }
        }
      }
    }

    // 补全漏填 from 的显式续查/第二轮/前两轮卡片（如 agentCPM 查 bug 线的第二轮细审与前两轮复核，绝不混入 Mint 工具包线）
    const SUBJECT_TOKENS = ['kernel', 'crate', 'review', '审查', 'Mint', 'minihub', '危机', '隔日', '口气', '陪伴'];
    const sortedTracksByTime = [...trackIds].sort(
      (a, b) => cardTs(trackMembers.get(a)![0]!) - cardTs(trackMembers.get(b)![0]!)
    );
    for (let i = 0; i < sortedTracksByTime.length; i++) {
      const tid = sortedTracksByTime[i]!;
      if ((inEdges.get(tid)?.length ?? 0) > 0) continue;
      const firstCard = trackMembers.get(tid)![0]!;
      const g = wfOf(firstCard).goal || '';
      if (!/上一轮|上轮|前两轮|第二轮|第三轮/.test(g)) continue;
      const myTokens = SUBJECT_TOKENS.filter((tk) => g.toLowerCase().includes(tk.toLowerCase()));
      let bestPrev: string | null = null;
      for (let j = i - 1; j >= 0; j--) {
        const cand = sortedTracksByTime[j]!;
        const cg = trackMembers
          .get(cand)!
          .map((m) => wfOf(m).goal || '')
          .join(' ')
          .toLowerCase();
        if (myTokens.length === 0 || myTokens.some((tk) => cg.includes(tk.toLowerCase()))) {
          bestPrev = cand;
          break;
        }
      }
      if (bestPrev) {
        addTrackEdge(bestPrev, tid, '续查', false);
      }
    }

    // 5. 按连通分量切分成独立「大任务（Big Task）」：一个项目有多个大任务横向并排，每个大任务内部从上到下走「第 1 步 → 第 K 步」！
    const visited = new Set<string>();
    const bigTasks: string[][] = [];
    for (const tid of trackIds) {
      if (visited.has(tid)) continue;
      const comp: string[] = [];
      const q = [tid];
      visited.add(tid);
      while (q.length) {
        const cur = q.shift()!;
        comp.push(cur);
        for (const e of outEdges.get(cur) ?? []) {
          if (!visited.has(e.toId)) {
            visited.add(e.toId);
            q.push(e.toId);
          }
        }
        for (const e of inEdges.get(cur) ?? []) {
          if (!visited.has(e.fromId)) {
            visited.add(e.fromId);
            q.push(e.fromId);
          }
        }
      }
      bigTasks.push(comp);
    }

    // 为每条大任务按「最早开干时间 + 卡号」分配永久固定编号（任务 1、任务 2…），不随在跑状态切换跳号
    const compEarliest = (comp: string[]) => {
      let minTs = Number.MAX_SAFE_INTEGER;
      let minId = '';
      for (const tid of comp) {
        for (const m of trackMembers.get(tid)!) {
          const ts = cardTs(m);
          if (ts < minTs || (ts === minTs && (!minId || m.card < minId))) {
            minTs = ts;
            minId = m.card;
          }
        }
      }
      return { minTs, minId };
    };
    const stableTaskNum = new Map<string[], number>();
    [...bigTasks]
      .sort((a, b) => {
        const ea = compEarliest(a);
        const eb = compEarliest(b);
        return ea.minTs - eb.minTs || ea.minId.localeCompare(eb.minId);
      })
      .forEach((comp, idx) => stableTaskNum.set(comp, idx + 1));

    // 大任务展示列排序：正在跑的大任务排最左方便盯梢，但保留各自的永久编号（任务 N）
    const taskScore = (comp: string[]) => {
      const hasRun = comp.some(
        (tid) =>
          trackMembers.get(tid)!.some((m) => m.running) ||
          (trackReviews.get(tid) ?? []).some((r) => r.running)
      );
      const maxUp = Math.max(...comp.map((tid) => trackById.get(tid)!.updatedAt));
      return { runRank: hasRun ? 0 : 1, stableNum: stableTaskNum.get(comp) ?? 999, maxUp };
    };
    bigTasks.sort((a, b) => {
      const sa = taskScore(a);
      const sb = taskScore(b);
      return sa.runRank - sb.runRank || sa.stableNum - sb.stableNum || sb.maxUp - sa.maxUp;
    });

    const pmId = `__pm__:${entry.project}`;
    const pmY = cursorY;
    cursorY += PM_H + 14;

    const tasksStartY = cursorY;
    let taskCursorX = PAD_X;
    let maxTaskH = 120;
    const histById = new Map<string, boolean>();

    bigTasks.forEach((comp, tIdx) => {
      const compSet = new Set(comp);
      // 计算该大任务内部每个节点的「步骤深度（0 = 第 1 步，向下递增）」
      const stepDepth = new Map<string, number>();
      const calcDepth = (id: string, stack: Set<string>): number => {
        if (stepDepth.has(id)) return stepDepth.get(id)!;
        if (stack.has(id)) return 0;
        stack.add(id);
        let d = 0;
        for (const e of inEdges.get(id) ?? []) {
          if (compSet.has(e.fromId)) {
            d = Math.max(d, calcDepth(e.fromId, stack) + 1);
          }
        }
        stack.delete(id);
        stepDepth.set(id, d);
        return d;
      };
      for (const id of comp) calcDepth(id, new Set());

      const byDepth = new Map<number, string[]>();
      for (const id of comp) {
        const d = stepDepth.get(id) ?? 0;
        byDepth.set(d, [...(byDepth.get(d) ?? []), id]);
      }
      const sortedDepths = [...byDepth.keys()].sort((a, b) => a - b);

      const xById = new Map<string, number>();
      const innerStartX = taskCursorX + TASK_PAD + STEP_RAIL_W;
      let innerY = tasksStartY + TASK_HEADER_H + TASK_PAD;
      let maxColsInTask = 1;
      let taskHasRun = false;
      let taskHasRed = false;

      sortedDepths.forEach((d, sIdx) => {
        const ids = byDepth.get(d)!;
        maxColsInTask = Math.max(maxColsInTask, ids.length);
        ids.sort((a, b) => {
          const pa = (inEdges.get(a) ?? []).map((e) => xById.get(e.fromId)).filter((v): v is number => v !== undefined);
          const pb = (inEdges.get(b) ?? []).map((e) => xById.get(e.fromId)).filter((v): v is number => v !== undefined);
          const xa = pa.length ? pa.reduce((s, v) => s + v, 0) / pa.length : Number.MAX_SAFE_INTEGER;
          const xb = pb.length ? pb.reduce((s, v) => s + v, 0) / pb.length : Number.MAX_SAFE_INTEGER;
          if (Math.abs(xa - xb) > 1) return xa - xb;
          return cardTs(trackMembers.get(a)![0]!) - cardTs(trackMembers.get(b)![0]!);
        });

        const stepY = innerY;
        let stepMaxH = 0;
        let stepHasRun = false;
        const latestTsInStep = Math.max(...ids.map((id) => cardTs(trackById.get(id)!)));
        const dInfo = dayLabelOf(dayKeyOf(latestTsInStep), nowSec);

        ids.forEach((id, colIdx) => {
          const c = trackById.get(id)!;
          const iterations = trackMembers.get(id)!;
          const trackTitle = pickTrackTitle(iterations);
          const reviews = trackReviews.get(id) ?? [];
          const retries = trackRetries.get(id) ?? [];
          const hasDownstream = (outEdges.get(id) ?? []).some((e) => compSet.has(e.toId));
          const isRunning = iterations.some((m) => m.running) || reviews.some((r) => r.running);
          if (isRunning) {
            stepHasRun = true;
            taskHasRun = true;
          }
          const isHistorical = !isRunning && (hasDownstream || nowSec - c.updatedAt > 6 * 3600);
          histById.set(id, isHistorical);
          if (!isHistorical && Boolean(cardCritical(c, nowSec))) taskHasRed = true;
          const compact = selectedNodeId !== id && isCompactNode(c, reviews, compactDone);
          const h = estimateNodeHeight(c, iterations, reviews, nowSec, compact, trackTitle);
          const x = innerStartX + colIdx * (NODE_W + COL_GAP);
          xById.set(id, x);
          nodes.push({
            id,
            card: c,
            iterations,
            trackTitle,
            reviews,
            retries,
            col: colIdx,
            x,
            y: stepY,
            w: NODE_W,
            h,
            lane: laneIdx,
            project: entry.project,
            compact,
            hasDownstream,
            isHistorical,
          });
          stepMaxH = Math.max(stepMaxH, h);
        });

        const taskW = TASK_PAD * 2 + STEP_RAIL_W + maxColsInTask * NODE_W + (maxColsInTask - 1) * COL_GAP;
        stepBands.push({
          key: `${entry.project}:task-${tIdx}:step-${sIdx}`,
          stepNum: sIdx + 1,
          stepTitle: '',
          dateLabel: dInfo.label,
          parallelCount: ids.length,
          hasRunning: stepHasRun,
          isToday: dInfo.isToday,
          x: taskCursorX + TASK_PAD,
          y: stepY,
          w: taskW - TASK_PAD * 2,
          h: Math.max(stepMaxH, 48),
        });

        innerY += Math.max(stepMaxH, 48) + STEP_GAP;
      });

      const taskW = TASK_PAD * 2 + STEP_RAIL_W + maxColsInTask * NODE_W + (maxColsInTask - 1) * COL_GAP;
      const taskH = innerY - STEP_GAP + TASK_PAD - tasksStartY;
      // 修正本大任务内所有 stepBand 的宽度为统一的 taskW - TASK_PAD * 2
      for (let i = stepBands.length - sortedDepths.length; i < stepBands.length; i++) {
        if (stepBands[i]) stepBands[i]!.w = taskW - TASK_PAD * 2;
      }

      // 大任务标题取该任务第 1 步（最早根卡）或最新主卡的短标题
      const rootIds = byDepth.get(sortedDepths[0]!) ?? comp;
      const rootCard = trackMembers.get(rootIds[0]!)![0]!;
      const tipIds = byDepth.get(sortedDepths[sortedDepths.length - 1]!) ?? comp;
      const tipCard = trackById.get(tipIds[0]!)!;
      const rootTitle = (wfOf(rootCard).title || wfOf(rootCard).goal || rootCard.card).trim();
      const tipTitle = (wfOf(tipCard).title || wfOf(tipCard).goal || tipCard.card).trim();
      const taskTitle = sortedDepths.length > 1 && rootTitle !== tipTitle ? `${rootTitle}` : tipTitle;

      const taskNum = stableTaskNum.get(comp) ?? tIdx + 1;
      taskBoxes.push({
        id: `__task__:${entry.project}:${taskNum}`,
        project: entry.project,
        taskNum,
        title: taskTitle,
        stepCount: sortedDepths.length,
        hasRunning: taskHasRun,
        hasRed: taskHasRed,
        x: taskCursorX,
        y: tasksStartY,
        w: taskW,
        h: taskH,
      });

      taskCursorX += taskW + TASK_GAP;
      maxTaskH = Math.max(maxTaskH, taskH);
      maxX = Math.max(maxX, taskCursorX - TASK_GAP);
      laneIdx += 1;
    });

    for (const tid of trackIds) {
      for (const e of outEdges.get(tid) ?? []) {
        const toCard = trackById.get(e.toId);
        if (!toCard) continue;
        const toHist = histById.get(e.toId) ?? true;
        edges.push({ ...e, critical: !toHist && Boolean(cardCritical(toCard, nowSec)) });
      }
    }

    const runCount = allCards.filter((c) => !wfOf(c).stub && c.running).length;
    const lookCount = trackIds.filter((tid) => {
      const c = trackById.get(tid)!;
      const hist = histById.get(tid) ?? true;
      return !hist && !c.running && Boolean(cardCritical(c, nowSec));
    }).length;
    parallelRunningCount += runCount;

    pmNodes.push({
      id: pmId,
      project: entry.project,
      owner: entry.owner,
      x: PAD_X,
      y: pmY,
      w: Math.max(taskCursorX - TASK_GAP - PAD_X, STEP_RAIL_W + NODE_W),
      h: PM_H,
      runCount,
      lookCount,
      totalCount: bigTasks.length,
    });
    cursorY = tasksStartY + maxTaskH + PROJ_GAP;
  }

  return {
    pmNodes,
    taskBoxes,
    nodes,
    foldNodes,
    stepBands,
    edges,
    width: Math.max(maxX + PAD_X, 640),
    height: Math.max(cursorY - PROJ_GAP + PAD_Y, 200),
    parallelRunningCount,
  };
}

function useSendCommand() {
  const runtime = useAtomValue(activeWorkspaceRuntimeAtom);
  const machines = useAtomValue(machineMetaCacheAtom);
  const [pending, setPending] = useState<Record<string, { label: string; toastId: string | number }>>({});
  useEffect(() => {
    if (Object.keys(pending).length === 0) return;
    const metas = Object.values(machines) as unknown as Array<Record<string, unknown>>;
    const done: string[] = [];
    for (const [id, p] of Object.entries(pending)) {
      const raw = metas.map((m) => m[`wfCmdDone:${id}`]).find((v) => typeof v === 'string') as string | undefined;
      if (!raw) continue;
      let res: { ok?: boolean; msg?: string } = {};
      try {
        res = JSON.parse(raw);
      } catch {
        res = { ok: false, msg: raw };
      }
      if (res.ok) toast.success(`${p.label}：${res.msg || '已执行'}`, { id: p.toastId, duration: 6000 });
      else toast.error(`${p.label}：${res.msg || '没成功'}`, { id: p.toastId, duration: 10000 });
      done.push(id);
    }
    if (done.length) {
      setPending((prev) => {
        const next = { ...prev };
        for (const id of done) delete next[id];
        return next;
      });
    }
  }, [machines, pending]);
  return useCallback(
    async (machineId: string | undefined, label: string, cmd: { action: Action; card?: string; text?: string; ownerBot?: string }) => {
      if (!runtime) {
        toast.error('Lody 还没连上');
        return;
      }
      if (!machineId) {
        toast.error('不知道这件事在哪台机器上');
        return;
      }
      const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      try {
        await runtime.writer.upsertDocMeta(getMachineRoomId(machineId as never), {
          [`wfCmd:${id}`]: JSON.stringify({ ...cmd, at: Date.now() }),
        } as never);
        const toastId = toast.loading(`${label}：已发出`);
        setPending((prev) => ({ ...prev, [id]: { label, toastId } }));
      } catch (e) {
        toast.error(`${label}：${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [runtime]
  );
}

function SayBox({
  placeholder,
  onSend,
  onCancel,
  autoFocus,
}: {
  placeholder: string;
  onSend: (text: string) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  const send = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText('');
  };
  return (
    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      <input
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) send();
          if (e.key === 'Escape') onCancel?.();
        }}
        placeholder={placeholder}
        className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 text-[12.5px] outline-none focus:border-foreground/50"
      />
      <Button size="sm" className="h-8 gap-1 px-2.5 text-xs" disabled={!text.trim()} onClick={send}>
        <Send className="h-3.5 w-3.5" />发
      </Button>
    </div>
  );
}

const NUM = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮';

function StepList({ steps, now }: { steps: WfStepItem[]; now: Date }) {
  if (!steps.length) return null;
  return (
    <ol className="mt-1 space-y-0.5 pl-2.5 text-[11.5px] leading-snug text-muted-foreground">
      {steps.map((st, i) => (
        <li key={i} title={`${st.ask} → ${st.did}`}>
          <span className="mr-1 font-mono text-[10px] text-foreground/60">
            {st.n > 0 ? (NUM[st.n - 1] ?? `${st.n}.`) : '·'}
          </span>
          <span className="text-foreground/80">{st.ask}</span>
          {st.did ? (
            <>
              <span className="mx-1 opacity-50">→</span>
              <span>{st.did}</span>
            </>
          ) : null}
          {st.at ? <span className="ml-1 tabular-nums opacity-60">{hm(st.at, now)}</span> : null}
        </li>
      ))}
    </ol>
  );
}

/** 右侧固定详情栏：选中任意 DAG 节点后展示，布局恒定不跳动 */
function NodeInspector({
  card,
  reviews,
  retries,
  project,
  now,
  nowSec,
  onOpen,
  onClose,
  send,
  archiveOne,
  fallbackMachine,
}: {
  card: CardItem;
  reviews: CardItem[];
  retries: CardItem[];
  project: string;
  now: Date;
  nowSec: number;
  onOpen: (sessionId: string) => void;
  onClose: () => void;
  send: ReturnType<typeof useSendCommand>;
  archiveOne: (card: CardItem) => void;
  fallbackMachine?: string;
}) {
  const [saying, setSaying] = useState(false);
  const w = wfOf(card);
  const badge = cardBadge(card);
  const red = cardCritical(card, nowSec);
  const sessions = realSessionsOf(card);
  const dur = fmtDur(cardDur(card, nowSec)) || '—';
  const cacheRate =
    w.inputTokens && w.inputTokens > 0 && typeof w.cachedTokens === 'number'
      ? Math.round((w.cachedTokens / w.inputTokens) * 100)
      : null;
  const scenarios = w.scenarios ?? [];
  const sc = w.scenarioCounts;
  const mid = machineOfCard(card) ?? fallbackMachine;
  const label = `「${(w.title || card.card).slice(0, 14)}」`;

  return (
    <aside className="flex h-full w-[350px] shrink-0 flex-col border-l border-border/80 bg-card/80">
      {/* 头部：大白话标题 + 关闭 */}
      <div className="flex items-start justify-between gap-2 border-b border-border/70 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span>{project}</span>
            <span>·</span>
            <span>{stageName(w)}</span>
            <span>·</span>
            <span className={cn('font-semibold', badge.isRed ? RED_TEXT : badge.isRun ? 'text-sky-700 dark:text-sky-400' : 'text-foreground')}>
              {badge.label}
            </span>
          </div>
          <h3 className="mt-1 text-[14px] font-semibold leading-snug text-foreground">{w.title || w.goal || card.card}</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="关闭详情"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* 主体滚动区 */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3 text-[12px]">
        {/* 暗红核心结论 */}
        {red ? <div className={cn('rounded-md border border-[#991B1B]/25 bg-[#991B1B]/[0.04] px-2.5 py-2 text-[12.5px] font-semibold leading-snug', RED_TEXT)}>{red}</div> : null}

        {/* 一键控制 */}
        {!w.stub ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {sessions[0] ? (
              <Button size="sm" className="h-7 gap-1 px-2.5 text-xs" onClick={() => onOpen(sessions[0].session.id)}>
                <MessageSquare className="h-3 w-3" />
                打开主会话
              </Button>
            ) : null}
            {card.running ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={() => {
                    if (window.confirm(`停下${label}？`)) void send(mid, `停 ${label}`, { action: 'stop', card: card.card });
                  }}
                >
                  <Square className="h-3 w-3" />停
                </Button>
                <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setSaying((v) => !v)}>
                  改方向
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setSaying((v) => !v)}>
                  续跑
                </Button>
                <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs text-muted-foreground" onClick={() => archiveOne(card)}>
                  <Archive className="h-3 w-3" />收起
                </Button>
              </>
            )}
          </div>
        ) : null}

        {saying ? (
          <SayBox
            autoFocus
            placeholder={card.running ? '停下并按新方向继续…' : '接着怎么改…'}
            onCancel={() => setSaying(false)}
            onSend={(text) => {
              setSaying(false);
              void send(mid, `${card.running ? '改方向' : '续跑'} ${label}`, {
                action: card.running ? 'redirect' : 'resume',
                card: card.card,
                text,
              });
            }}
          />
        ) : null}

        {/* 紧凑数据与成本（2x2 固定格） */}
        <div className="grid grid-cols-2 gap-2 text-[11.5px]">
          <div className="rounded-md border border-border/70 bg-background px-2.5 py-1.5">
            <div className="text-[10.5px] text-muted-foreground">耗时 / 轮次</div>
            <div className="mt-0.5 font-semibold tabular-nums text-foreground">
              {dur}
              {w.rounds ? ` · R${w.rounds}` : ''}
            </div>
          </div>
          <div className="rounded-md border border-border/70 bg-background px-2.5 py-1.5">
            <div className="text-[10.5px] text-muted-foreground">模型</div>
            <div className="mt-0.5 truncate font-semibold text-foreground" title={w.modelId || w.model}>
              {[w.harness, w.model].filter(Boolean).join(' ') || '—'}
            </div>
          </div>
          <div className="rounded-md border border-border/70 bg-background px-2.5 py-1.5">
            <div className="text-[10.5px] text-muted-foreground">Token 成本</div>
            <div className="mt-0.5 truncate font-semibold tabular-nums text-foreground">
              {w.inputTokens ? `${fmtTok(w.inputTokens)}入 / ${fmtTok(w.outputTokens)}出` : w.usage || '—'}
            </div>
            {cacheRate !== null ? <div className="text-[10px] text-muted-foreground">缓存 {cacheRate}%</div> : null}
          </div>
          <div className="rounded-md border border-border/70 bg-background px-2.5 py-1.5">
            <div className="text-[10.5px] text-muted-foreground">卡号 / 提交</div>
            <div className="mt-0.5 truncate font-mono text-[11px] font-semibold text-foreground">{card.card}</div>
            {w.head ? <div className="font-mono text-[10px] text-muted-foreground">{w.head}</div> : null}
          </div>
        </div>

        {/* 具体会话列表 */}
        <div>
          <div className="mb-1.5 text-[11px] font-semibold text-muted-foreground">具体会话（点击直达）</div>
          {sessions.length > 0 ? (
            <div className="space-y-1.5">
              {sessions.map((s) => {
                const doneWriter = Boolean(s.wf.writerDone || (isWriterRole(s.wf.role) && sessions.length > 1));
                return (
                  <div
                    key={s.session.id}
                    className={cn(
                      'rounded-md border border-border/70 bg-background px-2.5 py-1.5',
                      doneWriter && 'opacity-70'
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] font-semibold leading-snug text-foreground">
                          {sessionDoingText(s, card)}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                          <span>{roleShort(s.wf.role)}</span>
                          {s.wf.model || s.wf.harness ? <span>· {s.wf.model || s.wf.harness}</span> : null}
                          {s.wf.sessionAt ? <span className="tabular-nums">· {hm(s.wf.sessionAt, now)}</span> : null}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onOpen(s.session.id)}
                        className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[11px] font-medium hover:border-foreground/50"
                      >
                        打开
                      </button>
                    </div>
                    {s.wf.steps?.length ? <StepList steps={s.wf.steps} now={now} /> : null}
                  </div>
                );
              })}
            </div>
          ) : w.cardSteps?.length ? (
            <div className="rounded-md border border-border/70 bg-background px-2.5 py-1.5">
              <div className="text-[11px] font-semibold text-foreground">{w.harness || '执行器'} 轮次记录</div>
              <StepList steps={w.cardSteps} now={now} />
            </div>
          ) : (
            <div className="text-[11.5px] text-muted-foreground">无导入会话</div>
          )}
        </div>

        {/* 内嵌独立验收轮次（含直达会话与结论） */}
        {reviews.length > 0 ? (
          <div>
            <div className="mb-1.5 text-[11px] font-semibold text-muted-foreground">
              独立验收（{reviews.length} 轮）
            </div>
            <div className="space-y-1.5">
              {reviews.map((rv) => {
                const rb = cardBadge(rv);
                const rRed = cardCritical(rv, nowSec);
                const rSessions = faceSessionsOf(rv);
                const rMain = rSessions[0];
                const rDoing = rMain ? sessionDoingText(rMain, rv) : wfOf(rv).label || rb.label;
                return (
                  <div key={rv.card} className="rounded-md border border-border/70 bg-background px-2.5 py-1.5">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 text-[11px]">
                          <span
                            className={cn(
                              'font-semibold',
                              rb.isRed ? RED_TEXT : rb.isRun ? 'text-sky-700 dark:text-sky-400' : rb.isOk ? 'text-emerald-800 dark:text-emerald-400' : 'text-foreground'
                            )}
                          >
                            {rb.label}
                          </span>
                          <span className="font-mono text-[10px] text-muted-foreground">{rv.card}</span>
                          <span className="ml-auto tabular-nums text-[10px] text-muted-foreground">{hm(rv.updatedAt, now)}</span>
                        </div>
                        <div className="mt-0.5 text-[11.5px] leading-snug text-foreground/90">{rDoing}</div>
                        {rRed && rRed !== rDoing ? (
                          <div className={cn('mt-0.5 text-[11px] leading-snug', RED_TEXT)}>{rRed}</div>
                        ) : null}
                      </div>
                      {rMain ? (
                        <button
                          type="button"
                          onClick={() => onOpen(rMain.session.id)}
                          className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[11px] font-medium hover:border-foreground/50"
                        >
                          打开
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* 前期失败重试（已被续做替代，折叠收进此处备查） */}
        {retries.length > 0 ? (
          <div>
            <div className="mb-1 text-[11px] font-semibold text-muted-foreground">
              前期失败重试（已续做，{retries.length} 次）
            </div>
            <div className="space-y-1">
              {retries.map((rt) => {
                const rb = cardBadge(rt);
                const rRed = cardCritical(rt, nowSec);
                return (
                  <div key={rt.card} className="rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5 text-[11px]">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-muted-foreground">{rb.label}</span>
                      <span className="font-mono text-[10px] text-muted-foreground/80">{rt.card}</span>
                      <span className="ml-auto tabular-nums text-[10px] text-muted-foreground">{hm(rt.updatedAt, now)}</span>
                    </div>
                    {rRed ? <div className="mt-0.5 truncate text-[10.5px] text-muted-foreground">{rRed}</div> : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* 独立验收场景表 */}
        {scenarios.length > 0 ? (
          <div>
            <div className="mb-1 flex items-center justify-between text-[11px]">
              <span className="font-semibold text-muted-foreground">验收场景</span>
              {sc ? (
                <span className="tabular-nums text-muted-foreground">
                  过{sc.pass} · <span className={sc.fail ? cn('font-semibold', RED_TEXT) : undefined}>挂{sc.fail}</span> · 未验{sc.unverified}
                </span>
              ) : null}
            </div>
            <div className="divide-y divide-border/50 overflow-hidden rounded-md border border-border/70 bg-background">
              {scenarios.map((it, i) => {
                const bad = it.result === '没过' || it.result === 'fail';
                return (
                  <div key={i} className={cn('px-2.5 py-1.5 text-[11.5px]', bad && 'bg-[#991B1B]/[0.04]')}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-foreground">{it.name}</span>
                      <span className={cn('shrink-0 font-semibold', bad ? RED_TEXT : 'text-muted-foreground')}>{it.result}</span>
                    </div>
                    {it.actual ? <div className="mt-0.5 text-[11px] text-muted-foreground">{it.actual}</div> : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* 原始目标与详情 */}
        {w.goal ? (
          <div className="text-[11.5px] text-muted-foreground">
            <span className="font-medium text-foreground/80">目标：</span>
            {w.goal}
          </div>
        ) : null}
        {w.detail && w.detail !== red ? <div className="text-[11.5px] text-muted-foreground">{w.detail}</div> : null}
      </div>
    </aside>
  );
}

export function JiangongView() {
  const { projectGroups, holds, openSession } = useJiangong();
  const [isLeftSidebarCollapsed, setLeftSidebarCollapsed] = useAtom(sidebarCollapsedAtom);
  const isElectronFullscreen = useElectronFullscreen();
  const hasMacOSTitlebarInset = !isNativeAppShell() && isMacOSElectronRenderer() && !isElectronFullscreen;
  const send = useSendCommand();
  const archiveCards = useArchiveCards();

  const [selectedProject, setSelectedProject] = useState<string>('__all__');
  const [showDone, setShowDone] = useState(true);
  const [compactDone, setCompactDone] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [panning, setPanning] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(1);
  zoomRef.current = zoom;
  const panStateRef = useRef<{
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
    moved: boolean;
  } | null>(null);
  const suppressBgClickRef = useRef(false);

  const clampZoom = useCallback((z: number) => Math.max(0.25, Math.min(2, Math.round(z * 100) / 100)), []);
  const stepZoom = useCallback((delta: number) => {
    setZoom((z) => clampZoom(Math.round((z + delta) * 10) / 10));
  }, [clampZoom]);

  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);
  const now = useMemo(() => new Date(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const nowSec = Math.floor(now.getTime() / 1000);
  const machines = useAtomValue(machineMetaCacheAtom);

  const holdByProject = useMemo(() => {
    const map = new Map<string, WfHoldInfo>();
    for (const h of holds) map.set(h.project.trim().toLowerCase(), h);
    return map;
  }, [holds]);

  const allGroups = useMemo(() => {
    const have = new Set(projectGroups.map((g) => g.project.toLowerCase()));
    const extra: ProjectGroup[] = DEFAULT_PROJECTS.filter((d) => !have.has(d.project.toLowerCase())).map((d) => ({
      project: d.project,
      owner: d.owner,
      cards: [],
      running: 0,
      waiting: 0,
      bad: 0,
      warn: 0,
      cbFail: 0,
    }));
    return [...projectGroups, ...extra];
  }, [projectGroups]);

  const visibleGroups = useMemo(
    () => (selectedProject === '__all__' ? allGroups : allGroups.filter((g) => g.project === selectedProject)),
    [allGroups, selectedProject]
  );

  // 默认展示整个项目的完整节点树；可通过顶栏开关临时筛选「仅看在跑/异常」
  const { activeEntries, doneCount } = useMemo(() => {
    const fresh = nowSec - 24 * 3600;
    let doneTrees = 0;
    const entries: Array<{ project: string; owner: string; cards: CardItem[] }> = [];
    for (const g of visibleGroups) {
      const kept: CardItem[] = [];
      for (const root of g.cards) {
        const flat = flattenCards([root]).filter((c) => !wfOf(c).stub);
        const hasRun = flat.some((c) => c.running);
        const hasFreshLook = flat.some((c) => Boolean(cardCritical(c, nowSec)) && c.updatedAt >= fresh);
        if (hasRun || hasFreshLook) {
          kept.push(root);
        } else {
          doneTrees += 1;
          if (showDone) kept.push(root);
        }
      }
      if (kept.length) entries.push({ project: g.project, owner: g.owner, cards: kept });
    }
    return { activeEntries: entries, doneCount: doneTrees };
  }, [visibleGroups, nowSec, showDone]);

  const layout = useMemo(
    () => layoutDAG(activeEntries, nowSec, compactDone, selectedNodeId),
    [activeEntries, nowSec, compactDone, selectedNodeId]
  );
  const nodeMap = useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout.nodes]);
  const boxMap = useMemo(() => {
    const m = new Map<string, { x: number; y: number; w: number; h: number }>();
    for (const p of layout.pmNodes) m.set(p.id, p);
    for (const n of layout.nodes) m.set(n.id, n);
    for (const f of layout.foldNodes) m.set(f.id, f);
    return m;
  }, [layout.pmNodes, layout.nodes, layout.foldNodes]);

  const fitToView = useCallback(() => {
    const el = canvasRef.current;
    if (!el || layout.width <= 0 || layout.height <= 0) return;
    const availW = Math.max(200, el.clientWidth - 32);
    const availH = Math.max(200, el.clientHeight - 32);
    const next = clampZoom(Math.min(availW / layout.width, availH / layout.height, 1));
    setZoom(next);
    el.scrollTo({ left: 0, top: 0, behavior: 'smooth' });
  }, [clampZoom, layout.width, layout.height]);

  // 切换项目时回到左上角：最左侧第 1 列是当前正在跑的大任务，从第 1 步往下顺看
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    el.scrollTo({ left: 0, top: 0 });
  }, [selectedProject]);

  // 触控板双指捏合 / Ctrl+滚轮 / Cmd+滚轮以光标为中心缩放
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const prev = zoomRef.current;
      const factor = Math.exp(-e.deltaY * 0.008);
      const next = clampZoom(prev * factor);
      if (next === prev) return;
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const contentX = (el.scrollLeft + px) / prev;
      const contentY = (el.scrollTop + py) / prev;
      setZoom(next);
      requestAnimationFrame(() => {
        el.scrollLeft = contentX * next - px;
        el.scrollTop = contentY * next - py;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [clampZoom]);

  // 键盘缩放快捷键（Cmd/Ctrl + = / - / 0）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        stepZoom(0.1);
      } else if (e.key === '-') {
        e.preventDefault();
        stepZoom(-0.1);
      } else if (e.key === '0') {
        e.preventDefault();
        setZoom(1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [stepZoom]);

  const onCanvasMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('[data-dag-node="true"]') || target.closest('button, input, textarea, a')) return;
    const el = canvasRef.current;
    if (!el) return;
    panStateRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: el.scrollLeft,
      scrollTop: el.scrollTop,
      moved: false,
    };
    setPanning(true);
  }, []);

  useEffect(() => {
    if (!panning) return;
    const onMove = (e: MouseEvent) => {
      const st = panStateRef.current;
      const el = canvasRef.current;
      if (!st || !el) return;
      const dx = e.clientX - st.startX;
      const dy = e.clientY - st.startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) st.moved = true;
      el.scrollLeft = st.scrollLeft - dx;
      el.scrollTop = st.scrollTop - dy;
    };
    const onUp = () => {
      if (panStateRef.current?.moved) suppressBgClickRef.current = true;
      panStateRef.current = null;
      setPanning(false);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [panning]);

  // 高亮与 hover 节点相连的整条上下游路径（含项目经理根节点）
  const highlightedIds = useMemo(() => {
    const focus = hoveredId ?? selectedNodeId;
    if (!focus || !boxMap.has(focus)) return null;
    const set = new Set<string>([focus]);
    // 上游
    const up = [focus];
    while (up.length) {
      const cur = up.shift()!;
      for (const e of layout.edges) {
        if (e.toId === cur && !set.has(e.fromId)) {
          set.add(e.fromId);
          up.push(e.fromId);
        }
      }
    }
    // 下游
    const dn = [focus];
    while (dn.length) {
      const cur = dn.shift()!;
      for (const e of layout.edges) {
        if (e.fromId === cur && !set.has(e.toId)) {
          set.add(e.toId);
          dn.push(e.toId);
        }
      }
    }
    return set;
  }, [hoveredId, selectedNodeId, layout.edges, boxMap]);

  const selectedNode = selectedNodeId ? nodeMap.get(selectedNodeId) ?? null : null;

  const fallbackMachine = useMemo(() => {
    for (const n of layout.nodes) {
      const m = machineOfCard(n.card);
      if (m) return m;
    }
    const m = (Object.values(machines) as unknown as Array<{ id: string; wfBoard?: unknown }>).find((x) => x.wfBoard);
    return m?.id;
  }, [layout.nodes, machines]);

  const archiveOne = useCallback(
    async (card: CardItem) => {
      try {
        await archiveCards([card]);
        setSelectedNodeId(null);
        toast.success(`已收起 ${card.card}`, {
          duration: 10000,
          action: { label: '撤销', onClick: () => void archiveCards([card], false) },
        });
      } catch (e) {
        toast.error(`收起失败：${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [archiveCards]
  );

  // 统计各项目 Tab 角标
  const tabStats = useMemo(() => {
    const fresh = nowSec - 24 * 3600;
    const byProj = new Map<string, { run: number; look: number }>();
    let totalRun = 0;
    let totalLook = 0;
    for (const g of allGroups) {
      const flat = flattenCards(g.cards).filter((c) => !wfOf(c).stub);
      const r = flat.filter((c) => c.running).length;
      const l = flat.filter((c) => !c.running && Boolean(cardCritical(c, nowSec)) && c.updatedAt >= fresh).length;
      byProj.set(g.project, { run: r, look: l });
      totalRun += r;
      totalLook += l;
    }
    return { byProj, totalRun, totalLook };
  }, [allGroups, nowSec]);

  // 选中单个项目时，底部给对应项目经理发话
  const activeProjectGroup = selectedProject !== '__all__' ? allGroups.find((g) => g.project === selectedProject) : null;
  const activePmBot = activeProjectGroup ? PM_BOTS[activeProjectGroup.owner] : undefined;
  const activeHold = activeProjectGroup ? holdByProject.get(activeProjectGroup.project.toLowerCase()) : undefined;

  return (
    <div className="flex h-full w-full min-w-0 flex-col overflow-hidden bg-background">
      {/* 顶栏：项目 Tab + 并行数 + 缩放 + 含已完成开关 */}
      <div
        className={cn(
          'flex h-12 shrink-0 items-center gap-2.5 border-b border-border/80 px-4 text-xs text-muted-foreground',
          hasMacOSTitlebarInset && isLeftSidebarCollapsed && 'pl-20'
        )}
      >
        {isLeftSidebarCollapsed ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={() => setLeftSidebarCollapsed(false)}
            aria-label="打开侧栏"
          >
            <PanelLeft className="h-4 w-4" />
          </Button>
        ) : null}

        <span className="shrink-0 text-sm font-semibold text-foreground">监工</span>

        <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
          <button
            type="button"
            onClick={() => setSelectedProject('__all__')}
            className={cn(
              'shrink-0 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors',
              selectedProject === '__all__' ? 'bg-foreground text-background' : 'hover:bg-muted hover:text-foreground'
            )}
          >
            全部
          </button>
          {allGroups.map((g) => {
            const st = tabStats.byProj.get(g.project);
            const active = selectedProject === g.project;
            const held = holdByProject.has(g.project.toLowerCase());
            return (
              <button
                key={g.project}
                type="button"
                onClick={() => setSelectedProject(g.project)}
                className={cn(
                  'flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors',
                  active ? 'bg-foreground text-background' : 'hover:bg-muted hover:text-foreground'
                )}
              >
                <span>{g.project}</span>
                {held ? <span className="text-[10px] opacity-65">停</span> : null}
                {st && st.look > 0 ? (
                  <span className={cn('text-[11px] font-semibold tabular-nums', active ? 'text-red-200 dark:text-red-800' : RED_TEXT)}>
                    {st.look}
                  </span>
                ) : st && st.run > 0 ? (
                  <span className="text-[11px] tabular-nums opacity-75">{st.run}</span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2.5">
          <span className="hidden tabular-nums sm:inline">
            <b className="font-semibold text-foreground">{tabStats.totalRun}</b> 并行在跑
            {tabStats.totalLook > 0 ? (
              <>
                {' · '}
                <b className={cn('font-semibold', RED_TEXT)}>{tabStats.totalLook} 需看</b>
              </>
            ) : null}
          </span>

          <button
            type="button"
            onClick={() => setCompactDone((v) => !v)}
            className={cn(
              'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors',
              compactDone ? 'border-foreground/50 bg-muted text-foreground' : 'border-border hover:text-foreground'
            )}
            title="紧凑全览：已完成节点收成紧凑条，在跑/异常节点完整展开"
          >
            {compactDone ? '紧凑全览' : '全部展开'}
          </button>

          {doneCount > 0 ? (
            <button
              type="button"
              onClick={() => setShowDone((v) => !v)}
              className={cn(
                'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors',
                showDone ? 'border-foreground/50 bg-muted text-foreground' : 'border-border hover:text-foreground'
              )}
            >
              {showDone ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              已完成 ({doneCount})
            </button>
          ) : null}

          <span className="inline-flex items-center rounded-md border border-border bg-background text-[11px]">
            <button
              type="button"
              onClick={() => stepZoom(-0.1)}
              className="flex h-6 w-6 items-center justify-center hover:text-foreground"
              aria-label="缩小"
              title="缩小（⌘-）"
            >
              <Minus className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => setZoom(1)}
              className="w-10 text-center tabular-nums hover:text-foreground"
              title="重置 100%（⌘0）"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              onClick={() => stepZoom(0.1)}
              className="flex h-6 w-6 items-center justify-center hover:text-foreground"
              aria-label="放大"
              title="放大（⌘+）"
            >
              <Plus className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={fitToView}
              className="flex h-6 items-center gap-1 border-l border-border px-1.5 text-[10.5px] hover:text-foreground"
              aria-label="适配全图"
              title="一键缩放适配全图"
            >
              <Maximize2 className="h-3 w-3" />
            </button>
          </span>
        </div>
      </div>

      {/* 项目冻结提示条（仅冻结时出现一行） */}
      {activeHold ? (
        <div className={cn('flex shrink-0 items-center gap-1.5 border-b border-border/70 bg-muted/30 px-4 py-1.5 text-[12px] font-medium', RED_TEXT)}>
          <PauseCircle className="h-3.5 w-3.5" />
          {activeHold.project} 已暂停（{activeHold.why || '停项目'}）
        </div>
      ) : null}

      {/* 主区域：左 DAG 并行拓扑画布 + 右固定详情栏 */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          <div
            ref={canvasRef}
            onMouseDown={onCanvasMouseDown}
            className={cn(
              'relative min-h-0 flex-1 overflow-auto',
              panning ? 'cursor-grabbing select-none' : 'cursor-grab'
            )}
            style={{
              backgroundImage: 'radial-gradient(hsl(var(--border)) 1px, transparent 1px)',
              backgroundSize: `${Math.max(10, Math.round(18 * zoom))}px ${Math.max(10, Math.round(18 * zoom))}px`,
            }}
            onClick={() => {
              if (suppressBgClickRef.current) {
                suppressBgClickRef.current = false;
                return;
              }
              setSelectedNodeId(null);
            }}
          >
            {layout.nodes.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                暂无在跑或需处理的任务
              </div>
            ) : (
              <div
                className="relative"
                style={{
                  width: Math.ceil(layout.width * zoom),
                  height: Math.ceil(layout.height * zoom),
                }}
              >
                <div
                  className="relative origin-top-left"
                  style={{
                    width: layout.width,
                    height: layout.height,
                    transform: `scale(${zoom})`,
                    transformOrigin: '0 0',
                  }}
                >
                {/* 左侧步骤标尺 + 横向步骤底带（从上到下：第 1 步 → 最新一步；同行左右并排 = 并行任务） */}
                {layout.taskBoxes.map((tb) => (
                  <div
                    key={tb.id}
                    style={{
                      left: tb.x,
                      top: tb.y,
                      width: tb.w,
                      height: tb.h,
                    }}
                    className={cn(
                      'pointer-events-none absolute rounded-xl border bg-muted/[0.14] transition-all',
                      tb.hasRunning
                        ? 'border-sky-500/70 bg-sky-500/[0.035] ring-2 ring-sky-500/20 shadow-[0_0_24px_-4px_rgba(14,165,233,0.3)]'
                        : tb.hasRed
                          ? 'border-[#991B1B]/35 dark:border-[#F87171]/35'
                          : 'border-border/70'
                    )}
                  >
                    <div
                      style={{ height: TASK_HEADER_H }}
                      className={cn(
                        'flex items-center gap-2 rounded-t-xl border-b px-3.5',
                        tb.hasRunning
                          ? 'border-sky-500/40 bg-sky-500/[0.12]'
                          : 'border-border/60 bg-muted/35'
                      )}
                    >
                      {tb.hasRunning ? <BreathingDot size="md" /> : null}
                      <span
                        className={cn(
                          'shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-bold',
                          tb.hasRunning
                            ? 'bg-sky-600 text-white shadow-xs dark:bg-sky-500'
                            : 'bg-foreground/10 text-foreground/80'
                        )}
                      >
                        任务 {tb.taskNum}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-bold text-foreground" title={tb.title}>
                        {tb.title}
                      </span>
                      {tb.hasRunning ? (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-sky-500/40 bg-sky-500/15 px-2 py-0.5 text-[10px] font-bold text-sky-700 dark:text-sky-300">
                          正在干
                        </span>
                      ) : null}
                      <span className="shrink-0 text-[10.5px] tabular-nums text-muted-foreground">
                        共 {tb.stepCount} 步
                      </span>
                    </div>
                  </div>
                ))}

                {layout.stepBands.map((band) => (
                  <div
                    key={band.key}
                    style={{
                      left: band.x,
                      top: band.y - 4,
                      width: band.w,
                      height: band.h + 8,
                    }}
                    className={cn(
                      'pointer-events-none absolute rounded-lg border border-transparent',
                      band.hasRunning ? 'border-sky-500/35 bg-sky-500/[0.06]' : 'border-t-border/35'
                    )}
                  >
                    <div
                      style={{ width: STEP_RAIL_W - 6 }}
                      className="flex h-full flex-col justify-center px-1.5"
                    >
                      <div className="flex items-center gap-1.5">
                        {band.hasRunning ? <BreathingDot size="sm" /> : null}
                        <span
                          className={cn(
                            'text-[11px] font-bold',
                            band.hasRunning ? 'text-sky-700 dark:text-sky-400' : 'text-foreground/75'
                          )}
                        >
                          第 {band.stepNum} 步
                        </span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[9.5px] text-muted-foreground">
                        <span>{band.dateLabel}</span>
                        {band.parallelCount > 1 ? (
                          <span className="rounded bg-muted px-1 py-px text-[9px] font-medium text-foreground/75">
                            {band.parallelCount} 并行
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}

                {/* SVG 向下因果连线层（从上一步卡片底部连到下一步卡片顶部） */}
                <svg
                  className="pointer-events-none absolute inset-0 overflow-visible"
                  width={layout.width}
                  height={layout.height}
                  aria-hidden
                >
                  <defs>
                    <marker id="wf-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto">
                      <path d="M0,1 L7,4 L0,7 z" className="fill-muted-foreground/60" />
                    </marker>
                    <marker id="wf-arrow-red" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto">
                      <path d="M0,1 L7,4 L0,7 z" className="fill-[#991B1B] dark:fill-[#F87171]" />
                    </marker>
                  </defs>

                  {layout.edges.map((e) => {
                    const a = boxMap.get(e.fromId);
                    const b = boxMap.get(e.toId);
                    if (!a || !b) return null;
                    const x1 = a.x + a.w / 2;
                    const y1 = a.y + a.h;
                    const x2 = b.x + b.w / 2;
                    const y2 = b.y;
                    const dy = Math.max(18, Math.abs(y2 - y1) * 0.45);
                    const d = `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`;
                    const midX = (x1 + x2) / 2;
                    const midY = (y1 + y2) / 2;
                    const lit = !highlightedIds || (highlightedIds.has(e.fromId) && highlightedIds.has(e.toId));

                    return (
                      <g key={e.id} className={cn('transition-opacity', !lit && 'opacity-10')}>
                        <path
                          d={d}
                          fill="none"
                          strokeWidth={e.critical ? 2 : 1.4}
                          strokeDasharray={e.dashed ? '4 3' : undefined}
                          markerEnd={e.critical ? 'url(#wf-arrow-red)' : 'url(#wf-arrow)'}
                          className={e.critical ? RED_STROKE : 'stroke-muted-foreground/40'}
                        />
                        {e.label && e.label !== '续做' ? (
                          <g transform={`translate(${midX}, ${midY})`}>
                            <rect
                              x={-16}
                              y={-8}
                              width={32}
                              height={16}
                              rx={4}
                              className="fill-background stroke-border/70"
                              strokeWidth={0.8}
                            />
                            <text
                              textAnchor="middle"
                              dominantBaseline="central"
                              className="fill-muted-foreground text-[9.5px] font-medium"
                            >
                              {e.label}
                            </text>
                          </g>
                        ) : null}
                      </g>
                    );
                  })}
                </svg>

                {/* 每个项目顶部：项目经理总控横条 */}
                {layout.pmNodes.map((pm) => {
                  const held = holdByProject.get(pm.project.toLowerCase());
                  return (
                    <div
                      key={pm.id}
                      data-dag-node="true"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedProject(pm.project);
                        setSelectedNodeId(null);
                      }}
                      style={{
                        left: pm.x,
                        top: pm.y,
                        width: pm.w,
                        height: pm.h,
                      }}
                      title={`点击聚焦「${pm.project}」并直接给${pm.owner}发话`}
                      className={cn(
                        'absolute flex cursor-pointer items-center gap-3 rounded-xl border border-foreground/20 bg-card px-3.5 shadow-xs transition-all hover:border-foreground/55',
                        held && 'border-[#991B1B]/60 dark:border-[#F87171]/60'
                      )}
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
                        <User className="h-3.5 w-3.5" />
                      </span>
                      <span className="text-[13px] font-bold text-foreground">{pm.owner}</span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {pm.project}
                      </span>
                      <div className="ml-auto flex items-center gap-2.5 text-[11px] tabular-nums text-muted-foreground">
                        <span>{pm.totalCount} 条大任务线</span>
                        {pm.runCount > 0 ? (
                          <span className="font-semibold text-sky-700 dark:text-sky-400">{pm.runCount} 在跑</span>
                        ) : null}
                        {pm.lookCount > 0 ? (
                          <span className={cn('font-semibold', RED_TEXT)}>{pm.lookCount} 需看</span>
                        ) : null}
                        {held ? <span className={cn('font-semibold', RED_TEXT)}>已暂停</span> : null}
                      </div>
                    </div>
                  );
                })}

                {/* DAG 任务节点层 */}
                {layout.nodes.map((node) => {
                  const c = node.card;
                  const w = wfOf(c);
                  const badge = cardBadge(c);
                  const red = cardCritical(c, nowSec);
                  const dur = fmtDur(cardDur(c, nowSec));
                  const faceSessions = faceSessionsOf(c);
                  const selected = selectedNodeId === node.id;
                  const isHovered = hoveredId === node.id;
                  const showFull = !node.compact || isHovered;
                  const shownSessions = faceSessions.slice(0, isHovered ? 6 : 4);
                  const hiddenCount = Math.max(0, faceSessions.length - shownSessions.length);
                  const dimmed = highlightedIds && !highlightedIds.has(node.id);
                  const parentNode = c.parent ? nodeMap.get(c.parent) : undefined;
                  const curTitle = (node.trackTitle || w.title || w.goal || c.card).trim();
                  const parentTitle = parentNode ? (parentNode.trackTitle || wfOf(parentNode.card).title || wfOf(parentNode.card).goal || parentNode.card.card).trim() : '';
                  const sameAsParent = Boolean(parentTitle && curTitle === parentTitle);
                  const displayTitle = showFull && w.goal && curTitle.endsWith('…') ? w.goal : curTitle;
                  const rPill = reviewSummaryPill(node.reviews);
                  const shownReviews = node.reviews.slice(0, isHovered ? 4 : 2);
                  const isNodeRunning = c.running || node.reviews.some((r) => r.running);
                  const mutedHist = node.isHistorical && !selected && !isHovered && !isNodeRunning;

                  return (
                    <div
                      key={node.id}
                      data-dag-node="true"
                      onMouseEnter={() => setHoveredId(node.id)}
                      onMouseLeave={() => setHoveredId((cur) => (cur === node.id ? null : cur))}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedNodeId((cur) => (cur === node.id ? null : node.id));
                      }}
                      style={{
                        left: node.x,
                        top: node.y,
                        width: node.w,
                        height: node.h,
                      }}
                      className={cn('absolute', isHovered ? 'z-30' : isNodeRunning || selected ? 'z-10' : 'z-0')}
                    >
                      {/* 悬停触发面积严格等于真实面积（node.w × node.h）；展开浮层挂 pointer-events-none，鼠标一离开真实面积立刻收起，绝不扩大命中区挡住下方第 2 步 */}
                      <div
                        style={{
                          width: isHovered ? Math.max(node.w, 320) : node.w,
                          height: isHovered ? 'auto' : node.h,
                          minHeight: node.h,
                        }}
                        className={cn(
                          'flex cursor-pointer flex-col rounded-lg border bg-card transition-shadow',
                          isHovered && node.compact ? 'pointer-events-none' : '',
                          showFull ? 'px-2.5 py-2' : 'justify-center px-2 py-1',
                          isHovered
                            ? 'overflow-visible border-foreground/75 shadow-xl ring-1 ring-foreground/20'
                            : 'overflow-hidden shadow-xs',
                          isNodeRunning &&
                            !isHovered &&
                            'border-sky-500 bg-sky-500/[0.04] ring-2 ring-sky-500/30 shadow-[0_0_20px_-2px_rgba(14,165,233,0.42)]',
                          w.stub && !selected && !isHovered && 'border-dashed bg-muted/40 opacity-75',
                          mutedHist && !w.stub && 'bg-card/85 opacity-80',
                          selected && !isHovered
                            ? 'border-foreground ring-2 ring-foreground/25 shadow-md'
                            : !isHovered && !isNodeRunning && 'border-border/80',
                          red && !w.stub && !mutedHist && 'border-l-[3px] border-l-[#991B1B] dark:border-l-[#F87171]',
                          dimmed && 'opacity-20'
                        )}
                      >
                      {/* 顶行：状态点/呼吸灯 + 任务标题 + 耗时 */}
                      <div className="flex items-start gap-1.5">
                        {isNodeRunning ? (
                          <BreathingDot size="md" className="mt-[3px]" />
                        ) : (
                          <span
                            className={cn(
                              'mt-[4px] h-2 w-2 shrink-0 rounded-full',
                              mutedHist
                                ? badge.isOk
                                  ? 'bg-emerald-700/60 dark:bg-emerald-400/60'
                                  : 'bg-muted-foreground/45'
                                : badge.isRed
                                  ? 'bg-[#991B1B] dark:bg-[#F87171]'
                                  : badge.isOk
                                    ? 'bg-emerald-700 dark:bg-emerald-400'
                                    : 'bg-muted-foreground/40'
                            )}
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <div
                            className={cn(
                              'break-words text-[12px] font-semibold leading-[1.3]',
                              isHovered ? 'whitespace-normal' : showFull ? 'line-clamp-4' : 'line-clamp-2',
                              isNodeRunning
                                ? 'text-sky-950 dark:text-sky-100'
                                : mutedHist
                                  ? 'text-foreground/70'
                                  : !showFull
                                    ? 'text-foreground/85'
                                    : 'text-foreground'
                            )}
                          >
                            {sameAsParent ? (
                              <span className={cn('mr-1 inline-block rounded px-1 py-px text-[9.5px] font-medium align-middle', !mutedHist && badge.isRed ? 'bg-red-500/10 text-[#991B1B] dark:text-[#F87171]' : 'bg-muted text-muted-foreground')}>
                                {c.rel ? `${c.rel}·` : ''}{badge.label}
                              </span>
                            ) : null}
                            {displayTitle}
                          </div>
                        </div>
                        <div className="ml-1 flex shrink-0 flex-col items-end gap-0.5 pt-[1px]">
                          <div className="flex items-center gap-1">
                            {c.running ? (
                              <span className="rounded-full bg-sky-500 px-1.5 py-px text-[9.5px] font-bold leading-tight text-white shadow-xs">
                                正在干
                              </span>
                            ) : null}
                            <span
                              className={cn(
                                'text-[10px] tabular-nums',
                                isNodeRunning ? 'font-semibold text-sky-700 dark:text-sky-300' : 'text-muted-foreground'
                              )}
                            >
                              {dur || hm(c.updatedAt, now)}
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            {node.iterations.length > 1 ? (
                              <span className="rounded bg-muted px-1 py-px text-[9.5px] font-medium leading-tight text-muted-foreground">
                                迭代×{node.iterations.length}
                              </span>
                            ) : node.retries.length > 0 ? (
                              <span className="rounded bg-muted px-1 py-px text-[9.5px] font-medium leading-tight text-muted-foreground">
                                重试×{node.retries.length}
                              </span>
                            ) : null}
                            {rPill ? (
                              <span
                                className={cn(
                                  'rounded px-1 py-px text-[9.5px] font-semibold leading-tight',
                                  mutedHist
                                    ? rPill.isOk
                                      ? 'bg-emerald-500/10 text-emerald-800/75 dark:text-emerald-400/75'
                                      : 'bg-muted text-muted-foreground'
                                    : rPill.isRun
                                      ? 'bg-sky-500 text-white shadow-xs'
                                      : rPill.isOk
                                        ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-400'
                                        : rPill.isRed
                                          ? 'bg-red-500/10 text-[#991B1B] dark:text-[#F87171]'
                                          : 'bg-muted text-muted-foreground'
                                )}
                              >
                                {rPill.text}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      {showFull ? (
                        <>
                          {/* 暗红关键卡点 */}
                          {red ? (
                            <div
                              className={cn(
                                'mt-1 break-words text-[11px] font-semibold leading-[1.35]',
                                isHovered ? 'whitespace-normal' : 'line-clamp-3',
                                RED_TEXT
                              )}
                            >
                              {red}
                            </div>
                          ) : null}

                          {/* 会话「它在干嘛」直达列表 */}
                          <div className="mt-2 flex flex-col gap-1 border-t border-border/50 pt-1.5" onClick={(e) => e.stopPropagation()}>
                            {shownSessions.length > 0 ? (
                              <>
                                {shownSessions.map((s) => {
                                  const doing = sessionDoingText(s, c);
                                  const sessAt = s.wf.sessionAt;
                                  const sessActive = c.running && (!sessAt || nowSec - sessAt < 300 || shownSessions.length === 1);
                                  return (
                                    <button
                                      key={s.session.id}
                                      type="button"
                                      onClick={() => openSession(s.session.id)}
                                      title="点击直达该会话"
                                      className={cn(
                                        'group flex w-full items-start gap-1.5 rounded-md px-2 py-1 text-left text-[11px] transition-colors hover:bg-foreground hover:text-background',
                                        sessActive
                                          ? 'border border-sky-500/35 bg-sky-500/10 font-medium text-foreground'
                                          : 'bg-muted/45 text-foreground/90'
                                      )}
                                    >
                                      {sessActive ? (
                                        <BreathingDot size="sm" className="mt-[4px]" />
                                      ) : (
                                        <span
                                          className={cn(
                                            'mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full',
                                            badge.isRed
                                              ? 'bg-[#991B1B] dark:bg-[#F87171]'
                                              : badge.isOk
                                                ? 'bg-emerald-700 dark:bg-emerald-400'
                                                : 'bg-muted-foreground/50'
                                          )}
                                        />
                                      )}
                                      <span className={cn('min-w-0 flex-1 break-words leading-[1.35]', isHovered ? 'whitespace-normal' : 'line-clamp-3')}>{doing}</span>
                                      <MessageSquare className="mt-[3px] h-2.5 w-2.5 shrink-0 opacity-45 group-hover:opacity-100" />
                                    </button>
                                  );
                                })}
                                {hiddenCount > 0 ? (
                                  <button
                                    type="button"
                                    onClick={() => setSelectedNodeId(node.id)}
                                    className="px-1 text-left text-[10px] text-muted-foreground hover:text-foreground"
                                  >
                                    还有 {hiddenCount} 个会话，点此在右侧查看
                                  </button>
                                ) : null}
                              </>
                            ) : (
                              <div className="px-1 py-0.5 text-[11px] text-muted-foreground">
                                {w.stub ? '历史前置任务' : badge.label}
                              </div>
                            )}
                          </div>

                          {/* 内嵌独立验收区：不再在画布上另起节点，直接放在对应实施卡里 */}
                          {shownReviews.length > 0 ? (
                            <div className="mt-1.5 flex flex-col gap-1 border-t border-dashed border-border/60 pt-1.5" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-between text-[10px] font-semibold text-muted-foreground">
                                <span>独立验收（{node.reviews.length} 轮）</span>
                              </div>
                              {shownReviews.map((rv) => {
                                const rb = cardBadge(rv);
                                const rvSessions = faceSessionsOf(rv);
                                const rvMain = rvSessions[0];
                                const rvText = rvMain
                                  ? sessionDoingText(rvMain, rv)
                                  : cardCritical(rv, nowSec) || wfOf(rv).label || rb.label;
                                const canOpen = Boolean(rvMain);
                                return (
                                  <button
                                    key={rv.card}
                                    type="button"
                                    onClick={() => (rvMain ? openSession(rvMain.session.id) : setSelectedNodeId(node.id))}
                                    title={canOpen ? '点击直达该验收会话' : '点击在右侧查看验收详情'}
                                    className={cn(
                                      'group flex w-full items-start gap-1.5 rounded-md px-2 py-1 text-left text-[10.5px] transition-colors hover:bg-foreground hover:text-background',
                                      rb.isRun
                                        ? 'border border-sky-500/35 bg-sky-500/10 font-medium text-foreground'
                                        : 'bg-muted/35 text-foreground/90'
                                    )}
                                  >
                                    {rb.isRun ? (
                                      <BreathingDot size="sm" className="mt-[3px]" />
                                    ) : (
                                      <span
                                        className={cn(
                                          'mt-[4px] h-1.5 w-1.5 shrink-0 rounded-full',
                                          rb.isRed
                                            ? 'bg-[#991B1B] dark:bg-[#F87171]'
                                            : rb.isOk
                                              ? 'bg-emerald-700 dark:bg-emerald-400'
                                              : 'bg-muted-foreground/50'
                                        )}
                                      />
                                    )}
                                    <span className="min-w-0 flex-1 line-clamp-3 break-words leading-[1.35]">
                                      {rvText}
                                    </span>
                                    {canOpen ? (
                                      <MessageSquare className="mt-[2px] h-2.5 w-2.5 shrink-0 opacity-45 group-hover:opacity-100" />
                                    ) : null}
                                  </button>
                                );
                              })}
                              {node.reviews.length > shownReviews.length ? (
                                <button
                                  type="button"
                                  onClick={() => setSelectedNodeId(node.id)}
                                  className="px-1 text-left text-[10px] text-muted-foreground hover:text-foreground"
                                >
                                  还有 {node.reviews.length - shownReviews.length} 轮验收，点此在右侧查看
                                </button>
                              ) : null}
                            </div>
                          ) : null}

                        </>
                      ) : null}
                      </div>
                    </div>
                  );
                })}
                </div>
              </div>
            )}
          </div>

          {/* 画布右下角常驻悬浮缩放栏：触控板双指捏合 / ⌘滚轮 / 按钮 / 适配全图 */}
          {layout.nodes.length > 0 ? (
            <div
              className={cn(
                'pointer-events-auto absolute right-4 z-20 flex items-center rounded-lg border border-border bg-card/95 p-0.5 text-[11px] text-muted-foreground shadow-md backdrop-blur-xs',
                activeProjectGroup && activePmBot ? 'bottom-14' : 'bottom-4'
              )}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => stepZoom(-0.1)}
                className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted hover:text-foreground"
                aria-label="缩小"
                title="缩小（双指捏合 / ⌘-）"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setZoom(1)}
                className="h-7 min-w-[44px] rounded-md px-1.5 text-center font-medium tabular-nums text-foreground hover:bg-muted"
                title="点击复位 100%（⌘0）"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                onClick={() => stepZoom(0.1)}
                className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted hover:text-foreground"
                aria-label="放大"
                title="放大（双指捏合 / ⌘+）"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
              <span className="mx-0.5 h-4 w-px bg-border" />
              <button
                type="button"
                onClick={fitToView}
                className="flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium hover:bg-muted hover:text-foreground"
                title="一键缩放适配当前窗口"
              >
                <Maximize2 className="h-3 w-3" />
                <span>适配</span>
              </button>
            </div>
          ) : null}

          {/* 底部单行项目经理输入框（仅选中具体项目时出现，不占画布空间） */}
          {activeProjectGroup && activePmBot ? (
            <div className="shrink-0 border-t border-border/80 bg-card px-4 py-2">
              <SayBox
                placeholder={`跟${activeProjectGroup.owner}说（关于${activeProjectGroup.project}）…`}
                onSend={(text) =>
                  void send(fallbackMachine, `发给${activeProjectGroup.owner}`, {
                    action: 'pm',
                    ownerBot: activePmBot,
                    text,
                  })
                }
              />
            </div>
          ) : null}
        </div>

        {/* 右侧固定详情栏：点画布节点即展开 */}
        {selectedNode ? (
          <NodeInspector
            card={selectedNode.card}
            reviews={selectedNode.reviews}
            retries={selectedNode.retries}
            project={selectedNode.project}
            now={now}
            nowSec={nowSec}
            onOpen={openSession}
            onClose={() => setSelectedNodeId(null)}
            send={send}
            archiveOne={archiveOne}
            fallbackMachine={fallbackMachine}
          />
        ) : null}
      </div>
    </div>
  );
}
