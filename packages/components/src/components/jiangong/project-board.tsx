import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { Archive, ChevronDown, ChevronRight, PanelLeft, Send, Square } from 'lucide-react';
import { toast } from 'sonner';
import { getMachineRoomId, type WfCardMeta } from '@lody/shared';
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
  TONE_STYLE,
  useArchiveCards,
  useJiangong,
  type CardItem,
  type OwnerGroup,
  type Tone,
} from './jiangong-view';

/**
 * 监工（11-18 版）：按项目看。长官要的是「按项目看进度、在看板上直接下令、少而准」。
 * 一个项目一块：现在在做的、要你看的、已完成（收起）。一件事（实施卡和它的验收、返修、续做）只占一行。
 * 下令：写到 macpro 机器信息的 wfCmd:<编号>，macpro 上的同步程序用 wf 执行，结果写回 wfCmdDone:<编号>。
 */

const PM_BOTS: Record<string, string> = {
  心里项目经理: '497471fd-400c-4d16-b536-a07955d6f286',
  PDRS项目经理: 'dd1498c8-8b1f-4f5b-b7c4-18402d16beee',
  投顾项目助手: '73067299-37ba-451c-9901-94a511c2bb22',
};

const PROJECT_NAME: Record<string, string> = {
  心里项目经理: '心里',
  PDRS项目经理: 'PDRS',
  投顾项目助手: '投顾',
  总助: '总助',
};

type Job = {
  top: CardItem;
  cards: CardItem[];
  latest: CardItem;
  running?: CardItem;
  state: 'run' | 'look' | 'done';
  tone: Tone;
  updatedAt: number;
  machineId?: string;
};

type Action = 'stop' | 'resume' | 'redirect' | 'pm';

const KIND_SHORT: Record<string, string> = { 实施: '做', 验收: '验', 集成: '合' };

function wfOf(c: CardItem): WfCardMeta {
  return c.main.wf;
}

function machineOf(cards: CardItem[]): string | undefined {
  for (const c of cards) {
    const sid = (c.main.session as { machineId?: string }).machineId;
    if (typeof sid === 'string' && sid) return sid;
    const bm = (c.main.wf as WfCardMeta & { boardMachine?: string }).boardMachine;
    if (bm) return bm;
  }
  return undefined;
}

function buildJobs(group: OwnerGroup): Job[] {
  return group.cards.map((top) => {
    const cards = flattenCards([top]).sort((a, b) => (wfOf(a).startedAt ?? 0) - (wfOf(b).startedAt ?? 0));
    const latest = cards.reduce((m, c) => (c.updatedAt > m.updatedAt ? c : m), cards[0]);
    const running = cards.find((c) => c.running);
    const lw = wfOf(latest);
    const look =
      !running &&
      (latest.tone === 'wait' || latest.tone === 'warn' || latest.tone === 'bad' || Boolean(lw.cbFail));
    return {
      top,
      cards,
      latest,
      running,
      state: running ? 'run' : look ? 'look' : 'done',
      tone: running ? 'run' : latest.tone,
      updatedAt: Math.max(...cards.map((c) => c.updatedAt)),
      machineId: machineOf(cards),
    };
  });
}

function jobTitle(job: Job): string {
  const w = wfOf(job.top);
  return w.title || w.goal || job.top.card;
}

function jobStatus(job: Job): string {
  const c = job.running ?? job.latest;
  const w = wfOf(c);
  const kind = w.kind === '验收' ? '验收' : w.kind === '集成' ? '合并' : '';
  if (job.running) {
    const round = w.rounds && w.rounds > 1 ? ` · 第 ${w.rounds} 轮` : '';
    return `${kind ? `${kind}中` : '在做'}${round}`;
  }
  if (w.cbFail) return '回传没送到';
  return `${kind}${w.label || w.status || ''}`;
}

function jobWhy(job: Job): string {
  const w = wfOf(job.latest);
  if (w.unverifiedWhy) return w.unverifiedWhy;
  if (w.cbFail && w.callback) return `回传：${w.callback}`;
  return '';
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
        const toastId = toast.loading(`${label}：已发出，macpro 半分钟内执行`);
        setPending((prev) => ({ ...prev, [id]: { label, toastId } }));
      } catch (e) {
        toast.error(`${label}：没发出去（${e instanceof Error ? e.message : String(e)}）`);
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
        className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2.5 text-[13px] outline-none focus:border-foreground/40"
      />
      <Button size="sm" className="h-8 gap-1 px-2.5 text-xs" disabled={!text.trim()} onClick={send}>
        <Send className="h-3.5 w-3.5" />
        发
      </Button>
    </div>
  );
}

function StepDots({ job }: { job: Job }) {
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      {job.cards.length > 8 ? <span className="text-[10px] text-muted-foreground">…</span> : null}
      {job.cards.slice(-8).map((c) => {
        const w = wfOf(c);
        const t: Tone = c.running ? 'run' : c.tone;
        return (
          <span
            key={c.card}
            title={`${c.card}｜${w.kind || '实施'}｜${w.label || w.status || ''}`}
            className={cn('rounded px-1 text-[10px] font-semibold leading-4', TONE_STYLE[t].badge)}
          >
            {KIND_SHORT[w.kind || '实施'] ?? '做'}
          </span>
        );
      })}
    </span>
  );
}

const ROLE_PATH_ORDER = ['写手', '写卡', '执行', '分块', '验收', '工程师'];

function pathRank(role: string | undefined): number {
  const i = ROLE_PATH_ORDER.findIndex((r) => (role ?? '').startsWith(r));
  return i < 0 ? ROLE_PATH_ORDER.length : i;
}

function sessionLabel(role: string | undefined): string {
  if (role === '写手' || role === '写卡') return '✍ 写手';
  if (role?.startsWith('分块')) return `▦ ${role}`;
  if (role === '验收') return '⚖ 验收';
  if (role === '工程师') return '🛠 工程师';
  return '▶ 执行';
}

const NUM = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮';

function SessionNode({
  s,
  now,
  onOpen,
  last,
}: {
  s: { session: { id: string; isArchived?: boolean }; wf: WfCardMeta };
  now: Date;
  onOpen: (sessionId: string) => void;
  last: boolean;
}) {
  const steps = s.wf.steps ?? [];
  const noSession = s.session.id.startsWith('wf-card-');
  return (
    <div className="relative pl-5">
      <span className={cn('absolute left-1.5 top-0 w-px bg-border', last ? 'h-3' : 'h-full')} aria-hidden />
      <span className="absolute left-1.5 top-3 h-px w-3 bg-border" aria-hidden />
      <div className="flex items-center gap-2 py-0.5">
        <span className="shrink-0 text-[12px] font-semibold text-foreground">{sessionLabel(s.wf.role)}</span>
        <span className="truncate text-[11px] text-muted-foreground">
          {[s.wf.harness, s.wf.model].filter(Boolean).join(' ')}
        </span>
        {!noSession ? (
          <button
            type="button"
            className="ml-auto shrink-0 rounded border px-1.5 text-[11px] text-muted-foreground hover:border-foreground/40 hover:text-foreground"
            title="打开这个会话；可以直接在里面接着聊"
            onClick={() => onOpen(s.session.id)}
          >
            打开 · 接着聊
          </button>
        ) : null}
      </div>
      {steps.length ? (
        <ol className="mb-1 flex flex-col gap-0.5 pl-1">
          {steps.map((st, i) => (
            <li key={i} className="text-[12px] leading-[1.45] text-muted-foreground">
              <span className="mr-1 text-foreground/70">{st.n > 0 ? NUM[st.n - 1] ?? `${st.n}.` : '·'}</span>
              {st.ask ? <span className="text-foreground/80">{st.ask}</span> : null}
              {st.did ? (
                <>
                  <span className="mx-1 text-muted-foreground/60">→</span>
                  <span>{st.did}</span>
                </>
              ) : null}
              {st.at ? <span className="ml-1.5 text-[10.5px] tabular-nums text-muted-foreground/60">{hm(st.at, now)}</span> : null}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function CardNode({
  card,
  now,
  onOpen,
  last,
}: {
  card: CardItem;
  now: Date;
  onOpen: (sessionId: string) => void;
  last: boolean;
}) {
  const w = wfOf(card);
  const tone: Tone = card.running ? 'run' : card.tone;
  const sessions = [card.main, ...card.others].sort((a, b) => pathRank(a.wf.role) - pathRank(b.wf.role));
  const rel = card.rel ? `${card.rel}${card.parent ? ` ${card.parent}` : ''}` : '';
  return (
    <div className="relative pl-5">
      <span className={cn('absolute left-1.5 top-0 w-px bg-border', last ? 'h-3.5' : 'h-full')} aria-hidden />
      <span className="absolute left-1.5 top-3.5 h-px w-3 bg-border" aria-hidden />
      <div className="flex min-w-0 items-center gap-2 py-1">
        <span className={cn('shrink-0 rounded px-1.5 py-px text-[11px] font-semibold', TONE_STYLE[tone].badge)}>
          {w.kind || '实施'} · {card.running ? '在做' : w.label || w.status}
        </span>
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{card.card}</span>
        <span className="min-w-0 truncate text-[12.5px] text-foreground" title={w.goal}>
          {w.title || w.goal}
        </span>
        {rel ? <span className="shrink-0 text-[11px] text-muted-foreground">（{rel}）</span> : null}
        <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">{hm(card.updatedAt, now)}</span>
      </div>
      {w.unverifiedWhy ? <div className="mb-1 pl-1 text-[11.5px] text-orange-700">没验到：{w.unverifiedWhy}</div> : null}
      <div>
        {sessions.map((s, i) => (
          <SessionNode key={s.session.id} s={s} now={now} onOpen={onOpen} last={i === sessions.length - 1} />
        ))}
      </div>
    </div>
  );
}

function JobTree({ job, now, onOpen }: { job: Job; now: Date; onOpen: (sessionId: string) => void }) {
  return (
    <div className="mt-2 border-t pt-2">
      {job.cards.map((c, i) => (
        <CardNode key={c.card} card={c} now={now} onOpen={onOpen} last={i === job.cards.length - 1} />
      ))}
    </div>
  );
}

function JobRow({
  job,
  now,
  onOpen,
  send,
  archive,
}: {
  job: Job;
  now: Date;
  onOpen: (sessionId: string) => void;
  send: ReturnType<typeof useSendCommand>;
  archive: (job: Job) => void;
}) {
  const [saying, setSaying] = useState(false);
  const [open, setOpen] = useState(job.state !== 'done');
  const c = job.running ?? job.latest;
  const w = wfOf(c);
  const why = jobWhy(job);
  const title = jobTitle(job);
  const label = `「${title.slice(0, 14)}」`;
  return (
    <div
      className={cn(
        'group rounded-lg border bg-background px-3 py-2 transition-colors hover:border-foreground/25',
        job.state === 'look' && TONE_STYLE[job.tone].card
      )}
    >
      <div className="flex min-w-0 cursor-pointer items-center gap-2" onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        <span className={cn('h-2 w-2 shrink-0 rounded-full', TONE_STYLE[job.tone].dot)} />
        <span className="min-w-[180px] flex-1 truncate text-[13.5px] font-medium text-foreground" title={w.goal}>
          {title}
        </span>
        <span className={cn('shrink-0 rounded px-1.5 py-px text-[11px] font-semibold', TONE_STYLE[job.tone].badge)}>
          {jobStatus(job)}
        </span>
        <StepDots job={job} />
        <span className="w-[86px] shrink-0 truncate text-right text-[11px] text-muted-foreground" title={w.modelId}>
          {[w.harness, w.model].filter(Boolean).join(' ')}
        </span>
        <span className="w-[72px] shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
          {hm(job.updatedAt, now)}
        </span>
        <span className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {job.running ? (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                title="停下这件事（wf stop）"
                onClick={() => {
                  if (window.confirm(`停下${label}？`)) void send(job.machineId, `停 ${label}`, { action: 'stop', card: c.card });
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
                {job.state === 'look' ? '续跑' : '接着做'}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground"
                title="收起这件事（归档，可在归档里找回）"
                onClick={() => archive(job)}
              >
                <Archive className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
        </span>
      </div>
      {why ? <div className="mt-1 truncate pl-4 text-[12px] text-muted-foreground" title={why}>{why}</div> : null}
      {open ? <JobTree job={job} now={now} onOpen={onOpen} /> : null}
      {saying ? (
        <div className="mt-2 pl-4">
          <SayBox
            autoFocus
            placeholder={
              job.running
                ? '说新的方向：先停下，再带着这句话在原会话里接着做'
                : '说一句要怎么接着做（可以只写「继续」）'
            }
            onCancel={() => setSaying(false)}
            onSend={(text) => {
              setSaying(false);
              void send(job.machineId, `${job.running ? '改方向' : '续跑'} ${label}`, {
                action: job.running ? 'redirect' : 'resume',
                card: c.card,
                text,
              });
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

function ProjectBlock({
  group,
  now,
  onOpen,
  send,
  archive,
  fallbackMachine,
}: {
  group: OwnerGroup;
  now: Date;
  onOpen: (sessionId: string) => void;
  send: ReturnType<typeof useSendCommand>;
  archive: (job: Job) => void;
  fallbackMachine?: string;
}) {
  const jobs = useMemo(() => buildJobs(group), [group]);
  const [showDone, setShowDone] = useState(false);
  const byTime = (a: Job, b: Job) => b.updatedAt - a.updatedAt;
  const run = jobs.filter((j) => j.state === 'run').sort(byTime);
  // 「要你看」只放一天内的；更早没处理的收进一行，免得旧事把要紧的挤下去
  const fresh = Date.now() / 1000 - 24 * 3600;
  const look = jobs.filter((j) => j.state === 'look' && j.updatedAt >= fresh).sort(byTime);
  const stale = jobs.filter((j) => j.state === 'look' && j.updatedAt < fresh).sort(byTime);
  const [showStale, setShowStale] = useState(false);
  const done = jobs.filter((j) => j.state === 'done').sort(byTime);
  const name = PROJECT_NAME[group.owner] ?? group.owner;
  const pm = PM_BOTS[group.owner];
  const machineId = jobs.map((j) => j.machineId).find(Boolean) ?? fallbackMachine;
  const row = (j: Job) => <JobRow key={j.top.card} job={j} now={now} onOpen={onOpen} send={send} archive={archive} />;
  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-base font-semibold text-foreground">{name}</h2>
        <span className="text-xs text-muted-foreground">
          {run.length ? <b className="font-semibold text-blue-600">{run.length} 件在做</b> : '没有在做的'}
          {look.length ? <> · <b className="font-semibold text-red-600">{look.length} 件要你看</b></> : null}
          {stale.length ? ` · ${stale.length} 件更早没处理` : ''}
          {done.length ? ` · ${done.length} 件做完` : ''}
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        {look.length ? <div className="mt-1 text-[11px] font-semibold text-red-600">要你看</div> : null}
        {look.map(row)}
        {run.length ? <div className="mt-1 text-[11px] font-semibold text-blue-600">在做</div> : null}
        {run.map(row)}
        {stale.length ? (
          <button
            type="button"
            className="mt-1 flex items-center gap-1 self-start text-[11px] font-semibold text-muted-foreground hover:text-foreground"
            onClick={() => setShowStale((v) => !v)}
          >
            {showStale ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            一天前没处理的 {stale.length} 件（不要了就收起）
          </button>
        ) : null}
        {showStale ? stale.map(row) : null}
        {done.length ? (
          <button
            type="button"
            className="mt-1 flex items-center gap-1 self-start text-[11px] font-semibold text-muted-foreground hover:text-foreground"
            onClick={() => setShowDone((v) => !v)}
          >
            {showDone ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            做完的 {done.length} 件
          </button>
        ) : null}
        {showDone ? done.map(row) : null}
      </div>
      {pm ? (
        <div className="mt-3 border-t pt-3">
          <SayBox
            placeholder={`跟${group.owner}说（派新活、改优先级、问进度都行）`}
            onSend={(text) => void send(machineId, `发给${group.owner}`, { action: 'pm', ownerBot: pm, text })}
          />
        </div>
      ) : null}
    </section>
  );
}

export function JiangongView() {
  const { groups, openSession } = useJiangong();
  const [isLeftSidebarCollapsed, setLeftSidebarCollapsed] = useAtom(sidebarCollapsedAtom);
  const isElectronFullscreen = useElectronFullscreen();
  const hasMacOSTitlebarInset = !isNativeAppShell() && isMacOSElectronRenderer() && !isElectronFullscreen;
  const send = useSendCommand();
  const archiveCards = useArchiveCards();
  const archive = useCallback(
    async (job: Job) => {
      try {
        await archiveCards(job.cards);
        toast.success(`已收起「${jobTitle(job).slice(0, 16)}」`, {
          duration: 10000,
          action: { label: '撤销', onClick: () => void archiveCards(job.cards, false) },
        });
      } catch (e) {
        toast.error(`收起没成功：${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [archiveCards]
  );
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);
  const now = useMemo(() => new Date(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const machines = useAtomValue(machineMetaCacheAtom);
  // 没有卡的项目也要有一块，好跟项目经理说话
  const allGroups = useMemo(() => {
    const have = new Set(groups.map((g) => g.owner));
    const extra = Object.keys(PM_BOTS)
      .filter((o) => !have.has(o))
      .map((owner) => ({ owner, cards: [], running: 0, waiting: 0, bad: 0, warn: 0, cbFail: 0 }) as OwnerGroup);
    return [...groups, ...extra];
  }, [groups]);
  const fallbackMachine = useMemo(() => {
    for (const g of groups) for (const j of buildJobs(g)) if (j.machineId) return j.machineId;
    const m = (Object.values(machines) as unknown as Array<{ id: string; wfBoard?: unknown }>).find((x) => x.wfBoard);
    return m?.id;
  }, [groups, machines]);
  const counts = useMemo(() => {
    const jobs = groups.flatMap((g) => buildJobs(g));
    const fresh = Date.now() / 1000 - 24 * 3600;
    return {
      run: jobs.filter((j) => j.state === 'run').length,
      look: jobs.filter((j) => j.state === 'look' && j.updatedAt >= fresh).length,
    };
  }, [groups]);
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
            aria-label="打开侧栏"
          >
            <PanelLeft className="h-4 w-4" />
          </Button>
        ) : null}
        <span className="text-sm font-semibold text-foreground">监工</span>
        <span>
          {counts.run} 件在做 · {counts.look} 件要你看
        </span>
        <span className="ml-auto text-muted-foreground/70">点一行展开它的任务树 · 每个会话都能「打开 · 接着聊」 · 下的令由 macpro 执行，半分钟内有回音</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto flex max-w-[980px] flex-col gap-4 px-4 py-5">
          {allGroups.map((g) => (
            <ProjectBlock
              key={g.owner}
              group={g}
              now={now}
              onOpen={openSession}
              send={send}
              archive={archive}
              fallbackMachine={fallbackMachine}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
