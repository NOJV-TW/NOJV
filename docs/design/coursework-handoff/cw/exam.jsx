// Exam list + detail + take views
const { useState: useStateE, useEffect: useEffectE, useMemo: useMemoE, useRef: useRefE } = React;

function ExamList({ goTo }) {
  const data = window.CW_DATA;
  // Order: in_progress > scheduled (sorted by date) > graded
  const sorted = [...data.exams].sort((a, b) => new Date(a.startAt) - new Date(b.startAt));

  return (
    <div className="space-y-6 fade-up">
      <PageHero
        kind="exam"
        eyebrow={`${data.course.code} · Examinations`}
        title="考試"
        titleEn="Examinations"
        description="正式評量。請於開考前閱讀規則。一旦開始即啟動全螢幕監考。"
        meta={[
          { k: '授課教師', v: data.course.instructor || '王老師' },
          { k: '監考方式', v: '全螢幕 + IP 鎖定' },
          { k: '下一場', v: '期中考 · 3/25 13:00' },
        ]}
      />

      {/* Schedule-style list */}
      <div className="grid gap-4">
        {sorted.map((e, i) => <ExamRow key={e.id} e={e} onClick={() => goTo(`#/exam/${e.id}`)} delay={i*80} />)}
      </div>
    </div>
  );
}

function ExamRow({ e, onClick, delay = 0 }) {
  const startDate = new Date(e.startAt);
  const past = e.status === 'graded' || e.status === 'submitted';
  return (
    <a href="#" onClick={(ev) => { ev.preventDefault(); onClick(); }}
      className="group glass hover-lift rounded-2xl shadow-rest fade-up block overflow-hidden"
      style={{ animationDelay: `${delay}ms` }}>
      <div className="grid grid-cols-[120px_1fr_auto] items-stretch">
        {/* Date gutter */}
        <div className="relative flex flex-col items-center justify-center p-5 border-r border-subtle" style={{
          background: past ? 'var(--muted)' : 'color-mix(in oklab, var(--primary) 8%, transparent)',
        }}>
          <div className="font-mono text-micro uppercase tracking-wider text-muted-foreground">
            {['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][startDate.getMonth()]}
          </div>
          <div className="font-display text-headline font-bold leading-none mt-1">{startDate.getDate()}</div>
          <div className="font-mono text-micro uppercase tracking-wider text-muted-foreground mt-1">週{cwFmt.fmtWeekday(e.startAt)} · {String(startDate.getHours()).padStart(2,'0')}:{String(startDate.getMinutes()).padStart(2,'0')}</div>
        </div>

        {/* Body */}
        <div className="p-5 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-micro uppercase tracking-[0.18em] text-muted-foreground border border-subtle rounded px-1.5 py-0.5">{e.code}</span>
            <StatusPill status={e.status} type="exam" />
            {e.proctored && <span className="inline-flex items-center gap-1 text-micro font-mono uppercase tracking-wider text-muted-foreground">
              <ProctorIcon /> Proctored
            </span>}
          </div>
          <h3 className="mt-2 font-display text-title-lg font-semibold leading-tight">{e.title}</h3>
          <p className="text-caption text-muted-foreground">{e.subtitle}</p>
          <p className="mt-2 text-body-sm text-muted-foreground line-clamp-1">{e.summary}</p>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-caption">
            <Stat k="時長" v={`${e.durationMin} 分鐘`} />
            <Stat k="題數" v={`${e.problems} 題`} />
            <Stat k="滿分" v={e.maxScore} />
            <Stat k="嘗試" v={`${e.attemptsAllowed}`} />
            {past && e.score != null && <Stat k="得分" v={`${e.score} / ${e.maxScore}`} accent />}
          </div>
        </div>

        {/* CTA */}
        <div className="hidden md:flex flex-col items-end justify-between p-5 border-l border-subtle min-w-[200px]">
          {!past && (
            <>
              <div>
                <div className="font-mono text-micro uppercase tracking-wider text-muted-foreground text-right">距離開考</div>
                <div className="mt-1"><Countdown iso={e.startAt} compact /></div>
              </div>
              <div className="text-caption text-muted-foreground">點擊查看規則 →</div>
            </>
          )}
          {past && (
            <>
              <div className="text-right">
                <div className="font-mono text-micro uppercase tracking-wider text-muted-foreground">分數</div>
                <div className="font-display text-headline font-bold mt-0.5">{e.score}</div>
              </div>
              <div className="text-caption text-muted-foreground">查看詳細 →</div>
            </>
          )}
        </div>
      </div>
    </a>
  );
}

function Stat({ k, v, accent }) {
  return <div className="inline-flex items-baseline gap-1.5">
    <span className="font-mono text-micro uppercase tracking-wider text-muted-foreground">{k}</span>
    <span className={`font-mono ${accent ? 'font-semibold' : ''}`} style={accent ? { color: 'var(--primary)' } : {}}>{v}</span>
  </div>;
}
function ProctorIcon() { return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/></svg>; }

// ============ DETAIL ============
function ExamDetail({ id, goTo }) {
  const data = window.CW_DATA;
  const e = data.exams.find(x => x.id === id);
  const [showStartModal, setShowStartModal] = useStateE(false);
  if (!e) return <NotFound goTo={goTo} />;

  const past = e.status === 'graded' || e.status === 'submitted';

  return (
    <div className="space-y-6 fade-up">
      <Crumbs items={[{ label: 'exam', href: '#/exam' }, { label: e.code }]} onNavigate={goTo} />

      {/* Hero — bordered "official" block */}
      <div className="relative overflow-hidden rounded-2xl border-2 shadow-rest" style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}>
        {/* Corner crosshairs */}
        <CornerMark pos="tl" /><CornerMark pos="tr" /><CornerMark pos="bl" /><CornerMark pos="br" />

        <DotGrid opacity={0.12} />

        <div className="relative p-7 lg:p-10">
          <div className="flex flex-wrap items-start gap-6 justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-micro font-mono uppercase tracking-[0.2em] text-muted-foreground">
                <TypeIcon kind="exam" size={14} />
                <span>Examination · {data.course.code}</span>
                <span className="opacity-60">|</span>
                <span>{e.code}</span>
              </div>
              <div className="mt-3"><StatusPill status={e.status} type="exam" /></div>
              <h1 className="mt-3 font-display text-headline lg:text-display font-semibold tracking-tight">{e.title}</h1>
              <p className="text-body text-muted-foreground">{e.subtitle}</p>
              <p className="mt-4 max-w-2xl text-body text-muted-foreground">{e.summary}</p>
            </div>

            {/* Big-clock side */}
            <div className="rounded-xl border border-dashed p-5 min-w-[260px]" style={{ borderColor: 'var(--border-strong)' }}>
              <div className="text-micro font-mono uppercase tracking-[0.18em] text-muted-foreground">{past ? '已舉行' : '距離開考'}</div>
              <div className="mt-2">
                {past ? <div className="font-mono text-title">{cwFmt.fmtDate(e.startAt)}</div> : <Countdown iso={e.startAt} />}
              </div>
              <div className="mt-3 pt-3 border-t border-subtle space-y-1 text-caption font-mono">
                <div className="flex justify-between"><span className="text-muted-foreground">開考</span><span>{cwFmt.fmtDate(e.startAt)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">結束</span><span>{cwFmt.fmtDate(e.endAt)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">時長</span><span>{e.durationMin} 分鐘</span></div>
              </div>
            </div>
          </div>

          {/* Stats strip */}
          <div className="mt-7 grid grid-cols-2 sm:grid-cols-4 gap-3 border-t border-subtle pt-5">
            <BigStat k="題目數量" v={e.problems} />
            <BigStat k="滿分" v={e.maxScore} />
            <BigStat k="嘗試上限" v={e.attemptsAllowed === 'unlimited' ? '不限' : e.attemptsAllowed} />
            <BigStat k={past ? '得分' : '允許語言'} v={past ? `${e.score} / ${e.maxScore}` : e.allowedLangs.length} suffix={past ? '' : ' 種'} />
          </div>
        </div>
      </div>

      {/* Past state: simple problem list (like assignments). Future: rules + action panel */}
      {past ? (
        <React.Fragment>
          {/* Compact rules note (editable for teacher/TA) */}
          <GlassPanel className="p-5">
            <div className="flex items-center justify-between mb-2">
              <div className="font-mono text-micro uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-primary"></span>
                <span>應考規則備註</span>
              </div>
              <RulesEditAction />
            </div>
            <p className="text-body-sm text-muted-foreground">本次考試共 {e.problems} 題、{e.durationMin} 分鐘、滿分 {e.maxScore}。允許語言：{e.allowedLangs.join(' / ')}。</p>
          </GlassPanel>

          {/* Problem list — assignment-style */}
          <PastExamProblems e={e} />
        </React.Fragment>
      ) : (
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Rules */}
        <GlassPanel className="p-7">
          <div className="flex items-start justify-between gap-3">
            <h2 className="font-display text-title font-semibold flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-primary"></span> 應考規則
            </h2>
            <RulesEditAction />
          </div>
          <ul className="mt-4 space-y-2.5">
            {e.rules.map((r, i) => (
              <li key={i} className="flex items-start gap-3 text-body-sm">
                <span className="mt-0.5 font-mono text-micro uppercase tracking-wider text-muted-foreground tabular-nums">{String(i+1).padStart(2,'0')}</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>

          <div className="mt-6 pt-5 border-t border-subtle">
            <div className="font-mono text-micro uppercase tracking-wider text-muted-foreground mb-2">允許語言</div>
            <div className="flex flex-wrap gap-2">
              {e.allowedLangs.map(l => <span key={l} className="rounded-full px-2.5 py-1 text-caption font-mono bg-muted text-muted-foreground">{l}</span>)}
            </div>
          </div>
        </GlassPanel>

        {/* Action panel (upcoming/live only) */}
        <GlassPanel className="p-6 flex flex-col gap-4" style={{ borderColor: 'color-mix(in oklab, var(--primary) 35%, transparent)', borderWidth: 2 }}>
          <div>
            <div className="font-mono text-micro uppercase tracking-wider text-muted-foreground">考試準備</div>
            <h3 className="font-display text-title font-semibold mt-1">確認以下事項</h3>
          </div>
          <ul className="space-y-2 text-body-sm">
            <CheckLine>網路穩定、設備電源充足</CheckLine>
            <CheckLine>已關閉所有無關視窗</CheckLine>
            <CheckLine>已閱讀左側應考規則</CheckLine>
          </ul>
          <button type="button" onClick={() => setShowStartModal(true)}
            className="mt-auto w-full rounded-lg px-4 py-3 text-body font-semibold text-primary-foreground bg-primary hover:opacity-95 transition-opacity">
            開始考試 →
          </button>
          <p className="text-caption text-muted-foreground text-center">點擊後將進入全螢幕模式</p>
        </GlassPanel>
      </div>
      )}

      {showStartModal && <StartExamModal e={e} onClose={() => setShowStartModal(false)} onStart={() => { setShowStartModal(false); goTo(`#/exam/${e.id}/take`); }} />}
    </div>
  );
}

function CornerMark({ pos }) {
  const m = { tl: 'top-3 left-3', tr: 'top-3 right-3', bl: 'bottom-3 left-3', br: 'bottom-3 right-3' }[pos];
  const rot = { tl: 0, tr: 90, bl: -90, br: 180 }[pos];
  return (
    <div className={`absolute ${m} text-muted-foreground/40`} style={{ transform: `rotate(${rot}deg)` }}>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M0 5V0h5"/></svg>
    </div>
  );
}
function RulesEditAction() {
  const ctx = React.useContext(window.CWRoleCtx);
  if (!ctx || ctx.role === 'student') return null;
  return (
    <button type="button" className="text-caption font-medium px-2.5 py-1 rounded-md border border-subtle hover:border-default transition-colors inline-flex items-center gap-1.5">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      編輯
    </button>
  );
}

function PastExamProblems({ e }) {
  const data = window.CW_DATA;
  const review = data.examReview?.[e.id];
  const probs = data.examProblems?.[e.id] || data.examProblems?.midterm || [];
  // Merge: walk probs in display order, find verdict from review
  const rows = probs.map(p => {
    const rv = review?.problems?.find(r => r.id === p.id);
    return {
      id: p.id,
      title: p.title,
      difficulty: p.difficulty,
      tries: rv?.tries ?? 0,
      score: rv?.score ?? 0,
      max: rv?.max ?? p.points ?? 0,
      verdict: rv?.verdict || '—',
      solved: rv?.verdict === 'AC',
    };
  });
  const acCount = rows.filter(r => r.solved).length;

  return (
    <GlassPanel className="overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-subtle">
        <h2 className="font-display text-title font-semibold">題目列表</h2>
        <div className="text-caption text-muted-foreground inline-flex items-center gap-3">
          <span>{acCount}/{rows.length} 已通過</span>
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full font-mono text-micro uppercase tracking-wider" style={{ background: 'var(--muted)', color: 'var(--muted-foreground)' }}>
            <span className="size-1.5 rounded-full" style={{ background: 'var(--muted-foreground)' }}></span>
            考試已結束
          </span>
        </div>
      </div>
      <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
        {rows.map(p => (
          <div key={p.id} className="grid grid-cols-[60px_1fr_auto_auto_auto] items-center gap-4 px-6 py-3.5">
            <div className="font-mono text-body font-semibold text-muted-foreground">{p.id}</div>
            <div>
              <div className="font-medium">{p.title}</div>
              <div className="mt-1 flex items-center gap-3">
                {p.difficulty && <DifficultyTick level={p.difficulty} />}
                <span className="text-micro font-mono uppercase tracking-wider text-muted-foreground">嘗試 {p.tries}</span>
              </div>
            </div>
            <div className="hidden sm:block">
              {p.solved
                ? <span className="inline-flex items-center gap-1.5 text-caption verdict-ac rounded-full px-2.5 py-1 font-mono uppercase tracking-wider"><Check14 /> AC</span>
                : p.verdict === 'PAC'
                  ? <span className="inline-flex items-center gap-1.5 text-caption rounded-full px-2.5 py-1 font-mono uppercase tracking-wider" style={{ background: 'color-mix(in oklab,var(--chart-4) 22%,transparent)', color: 'oklch(0.55 0.13 70)' }}>Partial</span>
                  : <span className="text-caption font-mono uppercase tracking-wider text-muted-foreground">{p.verdict}</span>}
            </div>
            <div className="font-mono text-body-sm tabular-nums w-20 text-right">
              <span className={p.solved ? 'font-semibold' : 'text-muted-foreground'}>{p.score}</span>
              <span className="text-muted-foreground"> / {p.max}</span>
            </div>
            <span className="text-caption font-mono uppercase tracking-wider px-3 py-1.5 rounded-md text-muted-foreground" style={{ background: 'var(--muted)', cursor: 'not-allowed', opacity: 0.7 }} title="考試已結束">
              已結束
            </span>
          </div>
        ))}
      </div>
    </GlassPanel>
  );
}

function BigStat({ k, v, suffix = '' }) {
  return <div>
    <div className="font-mono text-micro uppercase tracking-wider text-muted-foreground">{k}</div>
    <div className="mt-1 font-display text-title font-semibold tabular-nums">{v}{suffix && <span className="text-body text-muted-foreground">{suffix}</span>}</div>
  </div>;
}
function CheckLine({ children }) {
  return <li className="flex items-start gap-2">
    <span className="mt-0.5 inline-flex size-4 items-center justify-center rounded-full" style={{ background: 'color-mix(in oklab, var(--success) 18%, transparent)', color: 'oklch(0.45 0.13 160)' }}>
      <Check14 />
    </span>
    <span>{children}</span>
  </li>;
}

function StartExamModal({ e, onClose, onStart }) {
  const [agreed, setAgreed] = useStateE(false);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 fade-up" style={{ background: 'rgba(31,25,22,0.45)', backdropFilter: 'blur(4px)' }}>
      <div className="glass rounded-2xl shadow-hover max-w-lg w-full p-7 relative" style={{ borderColor: 'color-mix(in oklab, var(--destructive) 30%, var(--border))' }}>
        <div className="flex items-start gap-4">
          <div className="rounded-xl p-2.5" style={{ background: 'color-mix(in oklab, var(--destructive) 14%, transparent)' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="oklch(0.55 0.2 27)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4M12 17h.01"/><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>
          </div>
          <div className="flex-1">
            <h3 className="font-display text-title font-semibold">即將進入考試</h3>
            <p className="mt-1 text-body-sm text-muted-foreground">{e.title} · 共 {e.problems} 題 · {e.durationMin} 分鐘</p>
          </div>
        </div>

        <div className="mt-5 rounded-xl bg-muted p-4">
          <div className="font-mono text-micro uppercase tracking-wider text-muted-foreground mb-2">請確認以下事項</div>
          <ul className="space-y-1.5 text-body-sm">
            <li className="flex gap-2"><span className="text-muted-foreground">·</span>進入後將切換為全螢幕</li>
            <li className="flex gap-2"><span className="text-muted-foreground">·</span>切換視窗、複製貼上會被記錄</li>
            <li className="flex gap-2"><span className="text-muted-foreground">·</span>系統每 30 秒自動儲存草稿</li>
            <li className="flex gap-2"><span className="text-muted-foreground">·</span>倒數結束自動交卷</li>
          </ul>
        </div>

        <label className="mt-5 flex items-center gap-2.5 text-body-sm cursor-pointer select-none">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)}
            className="size-4 rounded accent-orange-700" style={{ accentColor: 'var(--primary)' }} />
          <span>我已閱讀並同意應考規則</span>
        </label>

        <div className="mt-5 flex gap-3 justify-end">
          <button type="button" onClick={onClose}
            className="rounded-lg px-4 py-2 text-body-sm font-medium border border-default hover:bg-muted transition-colors">取消</button>
          <button type="button" disabled={!agreed} onClick={onStart}
            className="rounded-lg px-5 py-2 text-body-sm font-semibold text-primary-foreground bg-primary disabled:opacity-40 disabled:cursor-not-allowed transition-opacity">
            開始作答 →
          </button>
        </div>
      </div>
    </div>
  );
}

// ============ TAKE VIEW ============
function ExamTake({ id, goTo }) {
  const data = window.CW_DATA;
  const e = data.exams.find(x => x.id === id);
  const probs = (data.examProblems[id] || data.examProblems.midterm);
  const [active, setActive] = useStateE(probs[0].id);
  const [statusMap, setStatusMap] = useStateE({}); // id -> 'done' | 'flagged' | 'attempted'
  const [confirmSubmit, setConfirmSubmit] = useStateE(false);
  const [code, setCode] = useStateE(`#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios_base::sync_with_stdio(false);\n    int n; cin >> n;\n    vector<int> a(n);\n    for (auto& x : a) cin >> x;\n    \n    // TODO: implement\n    \n    return 0;\n}\n`);
  const [collapsed, setCollapsed] = useStateE(false);
  cwUseTick(1000);

  if (!e) return <NotFound goTo={goTo} />;

  // Faux remaining: 1h32m
  const remainSec = 92 * 60 - (Math.floor(Date.now() / 1000) % 30);
  const hh = Math.floor(remainSec / 3600);
  const mm = Math.floor((remainSec % 3600) / 60);
  const ss = remainSec % 60;
  const urgent = remainSec < 600;

  const activeProb = probs.find(p => p.id === active);

  const toggleFlag = (pid) => setStatusMap(s => ({ ...s, [pid]: s[pid] === 'flagged' ? 'attempted' : 'flagged' }));
  const markDone = (pid) => setStatusMap(s => ({ ...s, [pid]: 'done' }));

  return (
    <div className="fixed inset-0 z-30 flex flex-col" style={{ background: 'var(--background)' }}>
      {/* Top bar */}
      <div className="flex items-center gap-4 px-5 py-3 border-b border-subtle flex-shrink-0" style={{ background: 'var(--panel-strong)' }}>
        <div className="flex items-center gap-2">
          <TypeIcon kind="exam" size={16} />
          <span className="font-mono text-micro uppercase tracking-[0.18em] text-muted-foreground">{e.code}</span>
          <span className="opacity-50">·</span>
          <span className="font-display text-body font-semibold">{e.title}</span>
        </div>

        <div className="ml-auto flex items-center gap-4">
          <div className="flex items-center gap-3 px-4 py-1.5 rounded-full" style={{
            background: urgent ? 'color-mix(in oklab, var(--destructive) 16%, transparent)' : 'var(--muted)',
            border: urgent ? '1px solid color-mix(in oklab, var(--destructive) 40%, transparent)' : '1px solid var(--border-subtle)',
          }}>
            <span className="size-1.5 rounded-full" style={{ background: urgent ? 'oklch(0.55 0.2 27)' : 'var(--primary)' }}></span>
            <span className="font-mono text-micro uppercase tracking-wider text-muted-foreground">剩餘</span>
            <span className="font-mono text-title font-bold tabular-nums" style={urgent ? { color: 'oklch(0.55 0.2 27)' } : {}}>
              {String(hh).padStart(2,'0')}:{String(mm).padStart(2,'0')}:{String(ss).padStart(2,'0')}
            </span>
          </div>
          <span className="text-caption text-muted-foreground hidden sm:flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-primary"></span> 已自動儲存 · 14:23
          </span>
          <button type="button" onClick={() => setConfirmSubmit(true)}
            className="rounded-lg px-4 py-2 text-caption font-semibold text-primary-foreground bg-primary hover:opacity-95 transition-opacity">
            交卷
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 grid" style={{ gridTemplateColumns: collapsed ? '48px 1fr' : '260px 1fr' }}>
        {/* Problem list */}
        <aside className="border-r border-subtle overflow-y-auto" style={{ background: 'color-mix(in oklab, var(--muted) 50%, transparent)' }}>
          <div className="px-3 py-3 border-b border-subtle flex items-center justify-between gap-2">
            {!collapsed && <div className="font-mono text-micro uppercase tracking-wider text-muted-foreground">題目 ({probs.length})</div>}
            <button type="button" onClick={() => setCollapsed(c => !c)}
              className="size-7 grid place-items-center rounded-md border border-subtle hover:border-default text-muted-foreground hover:text-foreground transition-colors ml-auto"
              title={collapsed ? '展開題目列表' : '收合題目列表'}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: collapsed ? 'rotate(180deg)' : 'none' }}><path d="M15 6l-6 6 6 6"/></svg>
            </button>
          </div>
          <ul className="p-2 space-y-1">
            {probs.map(p => {
              const st = statusMap[p.id];
              const isActive = active === p.id;
              if (collapsed) {
                return (
                  <li key={p.id}>
                    <button type="button" onClick={() => setActive(p.id)}
                      title={`${p.id}. ${p.title}`}
                      className={`w-full grid place-items-center rounded-md py-2 transition-colors ${isActive ? '' : 'hover:bg-muted'}`}
                      style={isActive ? { background: 'var(--panel)', border: '1px solid var(--border)' } : { border: '1px solid transparent' }}>
                      <span className="font-mono text-caption font-semibold tabular-nums">{p.id}</span>
                      <span className="mt-1"><ProbStatusDot st={st} /></span>
                    </button>
                  </li>
                );
              }
              return (
                <li key={p.id}>
                  <button type="button" onClick={() => setActive(p.id)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg flex items-center gap-3 transition-colors ${isActive ? '' : 'hover:bg-muted'}`}
                    style={isActive ? { background: 'var(--panel)', border: '1px solid var(--border)' } : {}}>
                    <span className="font-mono text-caption font-semibold w-8 text-muted-foreground">{p.id}.</span>
                    <span className="flex-1 truncate text-body-sm">{p.title}</span>
                    <ProbStatusDot st={st} />
                  </button>
                </li>
              );
            })}
          </ul>

          {!collapsed && (
            <div className="mt-4 mx-3 p-3 rounded-lg border border-subtle text-micro space-y-1.5" style={{ background: 'var(--panel)' }}>
              <div className="font-mono uppercase tracking-wider text-muted-foreground mb-1.5">圖示說明</div>
              <Legend st="done" label="已完成" />
              <Legend st="attempted" label="嘗試中" />
              <Legend st="flagged" label="標記" />
              <Legend st={undefined} label="未作答" />
            </div>
          )}
        </aside>

        {/* Workspace: problem + editor + console */}
        <main className="grid min-h-0" style={{ gridTemplateColumns: '1fr 1.2fr', gridTemplateRows: '1fr' }}>
          {/* Problem panel */}
          <section className="overflow-y-auto border-r border-subtle p-7">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-3">
                <span className="font-mono text-title text-muted-foreground">{activeProb.id}.</span>
                <h2 className="font-display text-title-lg font-semibold">{activeProb.title}</h2>
              </div>
              <button type="button" onClick={() => toggleFlag(activeProb.id)}
                className="inline-flex items-center gap-1.5 text-caption font-mono uppercase tracking-wider px-2.5 py-1.5 rounded-md border border-subtle hover:border-default transition-colors"
                style={statusMap[activeProb.id] === 'flagged' ? { color: 'var(--primary)', borderColor: 'var(--primary)' } : {}}>
                <FlagIcon /> 標記
              </button>
            </div>
            <div className="flex items-center gap-4 text-caption text-muted-foreground">
              <DifficultyTick level={activeProb.difficulty} />
              <span>滿分 <span className="font-mono">{activeProb.points}</span></span>
            </div>

            <div className="prose-like mt-6 space-y-4 text-body">
              <h3 className="font-display text-title font-semibold">題目敘述</h3>
              <p className="text-muted-foreground">給定一個長度為 <span className="font-mono">n</span> 的整數序列 <span className="font-mono">a</span>，請計算所有相鄰元素差的絕對值之和。</p>

              <h3 className="font-display text-title font-semibold pt-2">輸入格式</h3>
              <p className="text-muted-foreground">第一行包含整數 <span className="font-mono">n</span> (<span className="font-mono">1 ≤ n ≤ 10⁵</span>)，第二行有 <span className="font-mono">n</span> 個整數。</p>

              <h3 className="font-display text-title font-semibold pt-2">範例</h3>
              <div className="grid sm:grid-cols-2 gap-3">
                <CodeBlock label="輸入" lines={['5', '3 1 4 1 5']} />
                <CodeBlock label="輸出" lines={['10']} />
              </div>

              <h3 className="font-display text-title font-semibold pt-2">限制</h3>
              <ul className="list-disc pl-5 text-muted-foreground space-y-1">
                <li>時間限制：<span className="font-mono">1 秒</span></li>
                <li>記憶體：<span className="font-mono">256 MB</span></li>
                <li>子任務 1 (40%)：<span className="font-mono">n ≤ 100</span></li>
                <li>子任務 2 (60%)：無額外限制</li>
              </ul>
            </div>
          </section>

          {/* Editor + Console */}
          <section className="flex flex-col min-h-0">
            <div className="flex items-center justify-between px-4 py-2 border-b border-subtle flex-shrink-0" style={{ background: 'var(--panel-strong)' }}>
              <div className="flex items-center gap-2">
                <select className="text-caption font-mono bg-transparent border border-subtle rounded-md px-2 py-1">
                  <option>C++17</option><option>Python 3.11</option><option>Java 17</option>
                </select>
                <span className="text-micro font-mono uppercase tracking-wider text-muted-foreground">main.cpp · {code.split('\n').length} 行</span>
              </div>
              <div className="flex gap-2">
                <button type="button" className="rounded-md border border-subtle px-3 py-1 text-caption hover:bg-muted transition-colors">編譯</button>
                <button type="button" className="rounded-md border border-subtle px-3 py-1 text-caption hover:bg-muted transition-colors">執行範例</button>
                <button type="button" onClick={() => markDone(activeProb.id)} className="rounded-md bg-primary text-primary-foreground px-3 py-1 text-caption font-medium hover:opacity-95 transition-opacity">提交</button>
              </div>
            </div>

            <div className="flex-1 min-h-0 grid" style={{ gridTemplateRows: '1.4fr 1fr' }}>
              <CodeEditor code={code} onChange={setCode} />
              <ConsoleArea />
            </div>
          </section>
        </main>
      </div>

      {confirmSubmit && (
        <div className="fixed inset-0 z-40 grid place-items-center p-4" style={{ background: 'rgba(31,25,22,0.55)', backdropFilter: 'blur(4px)' }}>
          <div className="glass rounded-2xl shadow-hover max-w-md w-full p-6">
            <h3 className="font-display text-title font-semibold">確認交卷？</h3>
            <p className="mt-2 text-body-sm text-muted-foreground">交卷後無法再修改答案。已完成 <span className="font-semibold text-foreground">{Object.values(statusMap).filter(s => s === 'done').length}</span> / {probs.length} 題。</p>
            <div className="mt-5 flex gap-3 justify-end">
              <button type="button" onClick={() => setConfirmSubmit(false)} className="rounded-lg px-4 py-2 text-body-sm font-medium border border-default hover:bg-muted transition-colors">返回繼續</button>
              <button type="button" onClick={() => goTo(`#/exam/${e.id}`)} className="rounded-lg px-5 py-2 text-body-sm font-semibold text-primary-foreground bg-primary hover:opacity-95 transition-opacity">確認交卷</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============ REVIEW (student replay after exam) ============
function ExamReview({ id, goTo }) {
  const data = window.CW_DATA;
  const e = data.exams.find(x => x.id === id);
  const review = data.examReview?.[id];
  if (!e || !review) return <NotFound goTo={goTo} />;
  const probs = data.examProblems[id] || data.examProblems.midterm;
  const [active, setActive] = useStateE(review.problems[0].id);
  const [collapsed, setCollapsed] = useStateE(false);
  const activeReview = review.problems.find(p => p.id === active);
  const activeProb = probs.find(p => p.id === active) || probs[0];
  const pct = Math.round((review.total / review.max) * 100);

  return (
    <div className="space-y-5 fade-up">
      <Crumbs items={[{label:'exam',href:'#/exam'},{label:e.code,href:`#/exam/${e.id}`},{label:'回顧作答'}]} onNavigate={goTo} />

      {/* Header band */}
      <div className="glass rounded-2xl shadow-rest p-6 lg:p-7 flex flex-wrap items-center gap-6">
        <div className="flex items-center gap-3 min-w-0">
          <div className="rounded-xl p-2.5" style={{ background:'color-mix(in oklab, var(--primary) 12%, transparent)' }}>
            <TypeIcon kind="exam" size={20} />
          </div>
          <div className="min-w-0">
            <div className="font-mono text-micro uppercase tracking-[0.2em] text-muted-foreground">回顧作答 · {e.code}</div>
            <h1 className="font-display text-headline font-semibold tracking-tight truncate">{e.title}</h1>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-6">
          <div><div className="font-mono text-micro uppercase tracking-wider text-muted-foreground">最終分數</div><div className="font-display text-display font-bold leading-none mt-0.5 tabular-nums">{review.total}<span className="text-title text-muted-foreground"> / {review.max}</span></div></div>
          <div><div className="font-mono text-micro uppercase tracking-wider text-muted-foreground">通過率</div><div className="font-display text-display font-bold leading-none mt-0.5 tabular-nums">{pct}<span className="text-title text-muted-foreground">%</span></div></div>
        </div>
      </div>

      <div className="grid gap-5" style={{ gridTemplateColumns: collapsed ? '64px 1fr' : '280px 1fr' }}>
        {/* Problem list */}
        <aside className="glass rounded-2xl shadow-rest overflow-hidden self-start">
          <div className="px-3 py-3 border-b border-subtle flex items-center justify-between gap-2">
            {!collapsed && <div className="font-mono text-micro uppercase tracking-wider text-muted-foreground">題目 ({review.problems.length})</div>}
            <button type="button" onClick={()=>setCollapsed(c=>!c)} className="size-7 grid place-items-center rounded-md border border-subtle hover:border-default text-muted-foreground hover:text-foreground transition-colors ml-auto" title={collapsed?'展開':'收合'}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{transform:collapsed?'rotate(180deg)':'none'}}><path d="M15 6l-6 6 6 6"/></svg>
            </button>
          </div>
          <ul className="p-2 space-y-1">
            {review.problems.map(p => {
              const isActive = active === p.id;
              const dot = p.verdict === 'AC' ? 'var(--success)' : p.verdict === 'PAC' ? 'var(--chart-4)' : 'oklch(0.55 0.2 27)';
              if (collapsed) return (
                <li key={p.id}>
                  <button type="button" onClick={()=>setActive(p.id)} title={`${p.id}. ${p.title}`}
                    className={`w-full grid place-items-center py-2 rounded-md transition-colors ${isActive?'':'hover:bg-muted'}`}
                    style={isActive?{background:'var(--panel)',border:'1px solid var(--border)'}:{border:'1px solid transparent'}}>
                    <span className="font-mono text-caption font-semibold">{p.id}</span>
                    <span className="size-1.5 mt-1 rounded-full" style={{background:dot}}></span>
                  </button>
                </li>
              );
              return (
                <li key={p.id}>
                  <button type="button" onClick={()=>setActive(p.id)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors ${isActive?'':'hover:bg-muted'}`}
                    style={isActive?{background:'var(--panel)',border:'1px solid var(--border)'}:{}}>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-caption font-semibold text-muted-foreground">{p.id}.</span>
                      <span className="flex-1 truncate text-body-sm">{p.title}</span>
                      <span className="size-2 rounded-full" style={{background:dot}}></span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-micro font-mono">
                      <span className="text-muted-foreground">{p.verdict}</span>
                      <span className="tabular-nums">{p.score}/{p.max}</span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* Problem detail */}
        <section className="glass rounded-2xl shadow-rest p-7">
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="font-mono text-title text-muted-foreground">{activeReview.id}.</span>
            <h2 className="font-display text-title-lg font-semibold">{activeReview.title}</h2>
            <span className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-mono text-caption uppercase tracking-wider"
              style={{
                background: activeReview.verdict==='AC'?'color-mix(in oklab,var(--success) 18%,transparent)':activeReview.verdict==='PAC'?'color-mix(in oklab,var(--chart-4) 22%,transparent)':'color-mix(in oklab,var(--destructive) 16%,transparent)',
                color: activeReview.verdict==='AC'?'oklch(0.45 0.13 160)':activeReview.verdict==='PAC'?'oklch(0.55 0.13 70)':'oklch(0.55 0.2 27)'
              }}>
              {activeReview.verdict === 'PAC' ? 'Partial' : activeReview.verdict}
            </span>
          </div>

          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 border-t border-b border-subtle py-4">
            <BigStat k="得分" v={`${activeReview.score} / ${activeReview.max}`} />
            <BigStat k="提交次數" v={activeReview.tries} />
            <BigStat k="語言" v={activeReview.language} />
            <BigStat k="占比" v={`${Math.round(activeReview.score/activeReview.max*100)}%`} />
          </div>

          {/* Subtask grid */}
          <div className="mt-5">
            <div className="font-mono text-micro uppercase tracking-wider text-muted-foreground mb-2">子任務結果</div>
            <div className="flex gap-2 flex-wrap">
              {activeReview.subtasks.map((s,i)=>(
                <div key={i} className="rounded-lg border px-3 py-2 min-w-[120px]" style={{
                  borderColor: s.pass?'color-mix(in oklab,var(--success) 35%,transparent)':'color-mix(in oklab,var(--destructive) 35%,transparent)',
                  background: s.pass?'color-mix(in oklab,var(--success) 6%,transparent)':'color-mix(in oklab,var(--destructive) 5%,transparent)',
                }}>
                  <div className="font-mono text-micro uppercase tracking-wider text-muted-foreground">subtask {i+1}</div>
                  <div className="font-mono mt-0.5 flex items-center gap-2">
                    <span className="font-semibold">{s.w}%</span>
                    <span className="text-caption" style={{color:s.pass?'oklch(0.45 0.13 160)':'oklch(0.55 0.2 27)'}}>{s.pass?'PASS':'FAIL'}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-5 rounded-lg p-3 text-body-sm" style={{background:'var(--muted)'}}>
            <div className="font-mono text-micro uppercase tracking-wider text-muted-foreground mb-1">老師備註</div>
            {activeReview.note}
          </div>

          {/* Sample source */}
          <div className="mt-5">
            <div className="font-mono text-micro uppercase tracking-wider text-muted-foreground mb-2">提交內容</div>
            <pre className="rounded-lg border border-subtle p-3 font-mono text-caption overflow-x-auto" style={{background:'var(--panel-strong)'}}>{`// ${activeReview.language} · 最後一次提交\n#include <bits/stdc++.h>\nusing namespace std;\nint main() {\n  int n; cin >> n;\n  vector<int> a(n);\n  for (auto& x : a) cin >> x;\n  long long ans = 0;\n  for (int i = 1; i < n; ++i) ans += abs(a[i] - a[i-1]);\n  cout << ans << '\\n';\n}`}</pre>
          </div>
        </section>
      </div>
    </div>
  );
}

// ============ CLASS RESULTS (teacher / TA only) ============
function ExamClassResults({ id, goTo }) {
  const data = window.CW_DATA;
  const ctx = React.useContext(window.CWRoleCtx);
  const e = data.exams.find(x => x.id === id);
  const r = data.examClassResults?.[id];
  if (!e || !r) return <NotFound goTo={goTo} />;

  if (ctx.role === 'student') {
    return (
      <div className="space-y-5 fade-up max-w-2xl">
        <Crumbs items={[{label:'exam',href:'#/exam'},{label:e.code,href:`#/exam/${e.id}`},{label:'班級結果'}]} onNavigate={goTo} />
        <div className="glass rounded-2xl p-8 text-center">
          <div className="font-display text-title font-semibold">此頁僅限老師 / 助教查看</div>
          <p className="mt-2 text-body-sm text-muted-foreground">請從右上角切換為「老師」或「助教」角色。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 fade-up">
      <Crumbs items={[{label:'exam',href:'#/exam'},{label:e.code,href:`#/exam/${e.id}`},{label:'班級結果'}]} onNavigate={goTo} />

      <div className="glass rounded-2xl shadow-rest p-6 lg:p-7">
        <div className="flex flex-wrap items-center gap-5">
          <div className="flex items-center gap-3">
            <div className="rounded-xl p-2.5" style={{background:'color-mix(in oklab,var(--primary) 12%,transparent)'}}><TypeIcon kind="exam" size={20} /></div>
            <div>
              <div className="font-mono text-micro uppercase tracking-[0.2em] text-muted-foreground">班級結果 · {e.code} · {ctx.role==='teacher'?'教師':'助教'}視圖</div>
              <h1 className="font-display text-headline font-semibold tracking-tight">{e.title}</h1>
            </div>
          </div>
          <div className="ml-auto flex gap-6 flex-wrap">
            <BigStat k="繳交" v={`${r.submitted}/${r.total}`} />
            <BigStat k="平均" v={r.classAvg} />
            <BigStat k="中位數" v={r.median} />
            <BigStat k="最高 / 最低" v={`${r.max} / ${r.min}`} />
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        {/* ICPC-style class table */}
        <GlassPanel className="overflow-hidden">
          <div className="px-5 py-3.5 border-b border-subtle flex items-center justify-between">
            <h2 className="font-display text-title font-semibold">學生成績</h2>
            <div className="text-caption text-muted-foreground">{r.rows.length} 名學生</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-caption">
              <thead style={{background:'color-mix(in oklab,var(--muted) 60%,transparent)'}}>
                <tr className="font-mono text-micro uppercase tracking-wider text-muted-foreground">
                  <th className="text-left px-4 py-2.5 w-12">#</th>
                  <th className="text-left px-3 py-2.5">學生</th>
                  <th className="text-left px-3 py-2.5">學號</th>
                  {r.problems.map(p => <th key={p.id} className="text-center px-2 py-2.5 w-14">{p.id}<br/><span className="opacity-60 normal-case text-[10px]">/{p.max}</span></th>)}
                  <th className="text-right px-4 py-2.5 w-16">總分</th>
                </tr>
              </thead>
              <tbody>
                {r.rows.map(row => (
                  <tr key={row.user} className="border-t border-subtle" style={row.me?{background:'color-mix(in oklab,var(--primary) 8%,transparent)'}:{}}>
                    <td className="px-4 py-2 font-mono tabular-nums">{row.rank}</td>
                    <td className="px-3 py-2 font-medium">{row.user}{row.me && <span className="ml-1.5 text-micro font-mono uppercase tracking-wider text-primary">你</span>}</td>
                    <td className="px-3 py-2 font-mono text-muted-foreground">{row.sid}</td>
                    {row.scores.map((s,i)=>{
                      const max = r.problems[i].max;
                      const ratio = s/max;
                      const color = ratio>=1?'oklch(0.45 0.13 160)':ratio>=0.5?'var(--foreground)':ratio>0?'oklch(0.55 0.13 70)':'var(--muted-foreground)';
                      return <td key={i} className="px-2 py-2 text-center font-mono tabular-nums" style={{color}}>{s}</td>;
                    })}
                    <td className="px-4 py-2 text-right font-mono tabular-nums font-semibold">{row.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassPanel>

        {/* Right column */}
        <div className="space-y-4">
          <GlassPanel className="p-5">
            <div className="font-mono text-micro uppercase tracking-wider text-muted-foreground">分數分布</div>
            <div className="mt-3 space-y-1.5">
              {[{l:'90-100',c:3,clr:'var(--success)'},{l:'80-89',c:4,clr:'var(--chart-1)'},{l:'70-79',c:2,clr:'var(--chart-2)'},{l:'60-69',c:2,clr:'var(--chart-4)'},{l:'<60',c:4,clr:'var(--destructive)'}].map(b=>(
                <div key={b.l} className="flex items-center gap-2 text-caption">
                  <div className="w-14 font-mono text-muted-foreground">{b.l}</div>
                  <div className="flex-1 h-4 rounded-sm overflow-hidden" style={{background:'var(--muted)'}}>
                    <div className="h-full" style={{width:`${b.c/r.submitted*100}%`,background:b.clr,opacity:0.55}}></div>
                  </div>
                  <div className="w-6 font-mono text-right tabular-nums">{b.c}</div>
                </div>
              ))}
            </div>
          </GlassPanel>
          <GlassPanel className="p-5">
            <div className="font-mono text-micro uppercase tracking-wider text-muted-foreground">最新繳交</div>
            <ul className="mt-3 space-y-2 text-caption">
              {r.submissions.map((s,i)=>(
                <li key={i} className="flex items-center gap-2">
                  <span className="font-mono tabular-nums text-muted-foreground w-12">{s.time}</span>
                  <span className="flex-1 truncate">{s.user} · 題 {s.problem}</span>
                  <span className="font-mono text-micro uppercase tracking-wider" style={{color:s.verdict==='AC'?'oklch(0.45 0.13 160)':'oklch(0.55 0.2 27)'}}>{s.verdict}</span>
                </li>
              ))}
            </ul>
          </GlassPanel>
        </div>
      </div>
    </div>
  );
}

function ProbStatusDot({ st }) {
  if (st === 'done') return <span className="inline-flex size-5 items-center justify-center rounded-full" style={{ background: 'color-mix(in oklab, var(--success) 22%, transparent)', color: 'oklch(0.45 0.13 160)' }}><Check14 /></span>;
  if (st === 'flagged') return <FlagIcon color="var(--primary)" />;
  if (st === 'attempted') return <span className="size-2 rounded-full" style={{ background: 'var(--chart-4)' }}></span>;
  return <span className="size-2 rounded-full" style={{ background: 'var(--border-strong)', opacity: 0.6 }}></span>;
}
function Legend({ st, label }) {
  return <div className="flex items-center gap-2 text-muted-foreground"><ProbStatusDot st={st} /><span>{label}</span></div>;
}
function FlagIcon({ color = 'currentColor' }) {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 22V4l8 4 8-4v12l-8 4-8-4z"/></svg>;
}

function CodeBlock({ label, lines }) {
  return (
    <div className="rounded-lg border border-subtle overflow-hidden">
      <div className="px-3 py-1.5 border-b border-subtle font-mono text-micro uppercase tracking-wider text-muted-foreground" style={{ background: 'var(--muted)' }}>{label}</div>
      <pre className="px-3 py-2 font-mono text-caption" style={{ background: 'var(--panel)' }}>{lines.join('\n')}</pre>
    </div>
  );
}

function CodeEditor({ code, onChange }) {
  const lines = code.split('\n');
  const tokenize = (line) => {
    // very simple syntax sketch
    const parts = [];
    const re = /(\/\/.*$|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\b(?:int|return|void|if|else|for|while|using|namespace|vector|auto|const|std|cout|cin|main|include|bits|stdc|sync_with_stdio|ios_base)\b|\b\d+\b|[{}();,<>])/g;
    let last = 0;
    let m;
    while ((m = re.exec(line))) {
      if (m.index > last) parts.push([line.slice(last, m.index), null]);
      const tok = m[0];
      let cls = null;
      if (tok.startsWith('//')) cls = 'comment';
      else if (tok.startsWith('"') || tok.startsWith("'")) cls = 'string';
      else if (/^\d+$/.test(tok)) cls = 'num';
      else if ('{}();,<>'.includes(tok)) cls = 'punct';
      else cls = 'kw';
      parts.push([tok, cls]);
      last = re.lastIndex;
    }
    if (last < line.length) parts.push([line.slice(last), null]);
    return parts;
  };
  const colors = { comment: 'var(--muted-foreground)', string: 'var(--chart-5)', num: 'var(--chart-4)', kw: 'var(--primary)', punct: 'var(--muted-foreground)' };

  return (
    <div className="relative min-h-0 overflow-auto font-mono text-caption" style={{ background: 'var(--background)' }}>
      <div className="flex">
        <div className="select-none px-3 py-3 text-right text-muted-foreground/70 border-r border-subtle" style={{ background: 'color-mix(in oklab, var(--muted) 45%, transparent)' }}>
          {lines.map((_, i) => <div key={i} className="leading-6 tabular-nums">{i+1}</div>)}
        </div>
        <pre className="px-4 py-3 flex-1 leading-6 whitespace-pre">
          {lines.map((line, i) => (
            <div key={i}>
              {tokenize(line).map(([txt, cls], j) => (
                <span key={j} style={cls ? { color: colors[cls] } : {}}>{txt}</span>
              ))}
              {line === '' && '\u00A0'}
            </div>
          ))}
        </pre>
      </div>
      <div className="absolute bottom-3 right-3 text-micro font-mono uppercase tracking-wider px-2 py-1 rounded-md text-muted-foreground" style={{ background: 'var(--panel-strong)', border: '1px solid var(--border-subtle)' }}>
        Read-only preview
      </div>
    </div>
  );
}

function ConsoleArea() {
  return (
    <div className="border-t border-subtle flex flex-col min-h-0" style={{ background: 'color-mix(in oklab, var(--muted) 60%, transparent)' }}>
      <div className="flex items-center gap-1 px-3 pt-2 text-caption">
        <button type="button" className="px-3 py-1 rounded-t-md font-mono text-micro uppercase tracking-wider" style={{ background: 'var(--panel)', borderTop: '1px solid var(--border-subtle)', borderLeft: '1px solid var(--border-subtle)', borderRight: '1px solid var(--border-subtle)' }}>Sample 1</button>
          <button type="button" className="px-3 py-1 font-mono text-micro uppercase tracking-wider text-muted-foreground">Sample 2</button>
          <button type="button" className="px-3 py-1 font-mono text-micro uppercase tracking-wider text-muted-foreground">Custom</button>
        <span className="ml-auto inline-flex items-center gap-1.5 text-caption verdict-ac rounded-full px-2.5 py-0.5 font-mono uppercase tracking-wider"><Check14 /> Passed · 14ms</span>
      </div>
      <div className="flex-1 grid grid-cols-2 gap-px overflow-hidden" style={{ background: 'var(--border-subtle)' }}>
        <div className="p-3 overflow-auto" style={{ background: 'var(--panel)' }}>
          <div className="font-mono text-micro uppercase tracking-wider text-muted-foreground mb-1">stdin</div>
          <pre className="font-mono text-caption">5{'\n'}3 1 4 1 5</pre>
        </div>
        <div className="p-3 overflow-auto" style={{ background: 'var(--panel)' }}>
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-micro uppercase tracking-wider text-muted-foreground">stdout</span>
            <span className="font-mono text-micro uppercase tracking-wider" style={{ color: 'oklch(0.45 0.13 160)' }}>= expected</span>
          </div>
          <pre className="font-mono text-caption">10</pre>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { ExamList, ExamDetail, ExamTake, ExamReview, ExamClassResults });
