import {
  ArrowRight,
  CheckCircle2,
  Database,
  Eye,
  FileText,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EventMediaScene, type EventSceneMode } from './EventMediaScene';
import {
  EVENT_DURATION_SECONDS,
  readDisclosureCondition,
  readEventProfile,
  sampleEventPose,
  type DisclosureCondition,
  type EventProfile,
} from './eventProfiles';
import type { StudyLanguage } from './types';

type RunnerPhase = 'ready' | 'attention' | 'initial_media' | 'disclosure' | 'complete';
type VepTab = 'overview' | 'visual' | 'data' | 'recourse';

const FRAME_INTERVAL_MS = 40;

export function EventStudyRunner() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const profile = useMemo(() => readEventProfile(params.get('profile')), [params]);
  const condition = useMemo(() => readDisclosureCondition(params.get('disclosure')), [params]);
  const language: StudyLanguage = params.get('lang') === 'zh' ? 'zh' : 'en';
  const participantId = params.get('participant_id') || 'P001';
  const sessionId = params.get('session_id') || 'preview-session';
  const previewDisclosure = params.get('role') === 'facilitator' && params.get('preview') === 'disclosure';
  const [phase, setPhase] = useState<RunnerPhase>(previewDisclosure ? 'disclosure' : 'ready');
  const [countdown, setCountdown] = useState(3);
  const [time, setTime] = useState(previewDisclosure ? EVENT_DURATION_SECONDS / 2 : 0);
  const [playing, setPlaying] = useState(false);
  const [activeTab, setActiveTab] = useState<VepTab>('overview');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const mediaRef = useRef<HTMLElement | null>(null);

  const pose = useMemo(() => sampleEventPose(profile, time), [profile, time]);
  const facts = useMemo(() => buildDisclosureFacts(profile, language), [language, profile]);

  useEffect(() => {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  }, [language]);

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  useEffect(() => {
    if (phase !== 'attention') return;
    setCountdown(3);
    const startedAt = performance.now();
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, 3 - Math.floor((performance.now() - startedAt) / 1000));
      setCountdown(remaining);
      if (performance.now() - startedAt >= 3000) {
        window.clearInterval(timer);
        setPhase('initial_media');
        setTime(0);
        setPlaying(true);
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (!playing || (phase !== 'initial_media' && phase !== 'disclosure')) return;
    const startedAt = performance.now() - time * 1000;
    const timer = window.setInterval(() => {
      const next = Math.min(EVENT_DURATION_SECONDS, (performance.now() - startedAt) / 1000);
      setTime(next);
      if (next >= EVENT_DURATION_SECONDS) {
        window.clearInterval(timer);
        setPlaying(false);
        if (phase === 'initial_media') {
          setPhase('disclosure');
          setTime(0);
        }
      }
    }, FRAME_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [phase, playing, time]);

  const toggleFullscreen = useCallback(async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await mediaRef.current?.requestFullscreen();
    }
  }, []);

  const begin = () => setPhase('attention');

  if (phase === 'ready') {
    return (
      <main className="runner-shell runner-ready">
        <section className="runner-ready-card">
          <div className="runner-status-mark"><CheckCircle2 size={24} /></div>
          <p className="runner-eyebrow">{text(language, 'Study material ready', '实验材料准备完毕')}</p>
          <h1>{text(language, 'Flight event review', '飞行事件查看')}</h1>
          <p>{text(
            language,
            'You will first watch a short synchronized scene. Please watch carefully: the first presentation is shown once and cannot be paused or replayed.',
            '你将先观看一段简短的同步场景。请仔细观看：首次材料只展示一次，不能暂停或重播。',
          )}</p>
          <div className="runner-session-strip">
            <span><small>{text(language, 'Participant', '参与者')}</small>{participantId}</span>
            <span><small>{text(language, 'Session', '场次')}</small>{sessionId}</span>
            <span><small>{text(language, 'Estimated time', '预计时长')}</small>3–5 min</span>
          </div>
          <button className="runner-primary" type="button" onClick={begin}>
            {text(language, 'I am ready', '我已准备好')} <ArrowRight size={18} />
          </button>
          <p className="runner-synthetic-note">
            {text(language, 'All scenes are synthetic. No real resident footage is used.', '全部场景均为合成画面，不包含真实居民影像。')}
          </p>
        </section>
      </main>
    );
  }

  if (phase === 'attention') {
    return (
      <main className="runner-shell runner-attention">
        <div className="attention-ring"><strong>{countdown}</strong></div>
        <p>{text(language, 'Please pay attention', '请注意观看')}</p>
        <h1>{text(language, 'The material will begin automatically', '材料即将自动开始')}</h1>
        <span>{text(language, 'It will only be shown once', '材料仅展示一次')}</span>
      </main>
    );
  }

  if (phase === 'initial_media') {
    return (
      <main className="runner-shell runner-media-shell">
        <header className="runner-session-bar">
          <div><span className="live-dot" />{text(language, 'Initial observation', '初始观察')}</div>
          <p>{text(language, 'Watch both synchronized views', '请同时观察两个同步视角')}</p>
          <span>{formatTime(time)} / {formatTime(EVENT_DURATION_SECONDS)}</span>
        </header>
        <section
          ref={mediaRef}
          className="runner-media-stage initial"
          onDoubleClick={() => void toggleFullscreen()}
        >
          <div className="runner-media-actions">
            <span>{text(language, 'One-time presentation · playback locked', '仅播放一次 · 播放控制已锁定')}</span>
            <button type="button" onClick={() => void toggleFullscreen()} aria-label={text(language, 'Toggle fullscreen', '切换全屏')}>
              {isFullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
              {isFullscreen ? text(language, 'Exit fullscreen', '退出全屏') : text(language, 'Fullscreen', '全屏播放')}
            </button>
          </div>
          <div className="initial-dual-grid">
            <ScenePanel index="01" mode="external" profile={profile} time={time} reveal={false} language={language} />
            <ScenePanel index="02" mode="resident" profile={profile} time={time} reveal={false} language={language} />
          </div>
          <div className="locked-progress" aria-label={text(language, 'Playback progress', '播放进度')}>
            <i style={{ width: `${(time / EVENT_DURATION_SECONDS) * 100}%` }} />
          </div>
        </section>
      </main>
    );
  }

  if (phase === 'disclosure') {
    if (condition === 'M') {
      return <NoticeDisclosure language={language} onContinue={() => setPhase('complete')} />;
    }
    return (
      <main className="runner-shell runner-disclosure-shell">
        <header className="runner-session-bar disclosure">
          <div><Eye size={17} />{text(language, 'Evidence disclosure', '证据披露')}</div>
          <p>{condition === 'S' ? text(language, 'Structured facts', '线性事实平铺') : text(language, 'Interactive VEP', '交互式 VEP')}</p>
          <span>{text(language, 'Up to 180 seconds', '最长 180 秒')}</span>
        </header>

        <section ref={mediaRef} className="runner-reveal-player" onDoubleClick={() => void toggleFullscreen()}>
          <div className="runner-media-actions reveal-actions">
            <div>
              <span className={pose.residentVisible ? 'evidence-state in-view' : 'evidence-state outside'}>
                {pose.residentVisible
                  ? text(language, 'Resident in effective view', '居民进入有效视场')
                  : text(language, 'Resident outside effective view', '居民未进入有效视场')}
              </span>
              <small>{text(language, 'Audited synthetic evidence', '经审计的合成证据')}</small>
            </div>
            <button type="button" onClick={() => void toggleFullscreen()} aria-label={text(language, 'Toggle fullscreen', '切换全屏')}>
              {isFullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
              {isFullscreen ? text(language, 'Exit fullscreen', '退出全屏') : text(language, 'Fullscreen', '全屏播放')}
            </button>
          </div>
          <div className="reveal-triple-grid">
            <ScenePanel index="01" mode="external" profile={profile} time={time} reveal language={language} compact />
            <ScenePanel index="02" mode="resident" profile={profile} time={time} reveal language={language} compact />
            <ScenePanel index="03" mode="camera" profile={profile} time={time} reveal language={language} compact />
          </div>
          <RevealTimeline
            profile={profile}
            language={language}
            time={time}
            playing={playing}
            onTimeChange={(next) => {
              setTime(next);
              setPlaying(false);
            }}
            onToggle={() => {
              if (time >= EVENT_DURATION_SECONDS) setTime(0);
              setPlaying((value) => !value);
            }}
            onRestart={() => {
              setTime(0);
              setPlaying(false);
            }}
          />
        </section>

        {condition === 'S' ? (
          <LinearFacts facts={facts} language={language} />
        ) : (
          <VepFacts facts={facts} language={language} activeTab={activeTab} onTabChange={setActiveTab} />
        )}

        <div className="runner-disclosure-next">
          <button className="runner-primary" type="button" onClick={() => setPhase('complete')}>
            {text(language, 'Continue', '继续')} <ArrowRight size={18} />
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="runner-shell runner-complete">
      <section>
        <CheckCircle2 size={34} />
        <p className="runner-eyebrow">{text(language, 'Media review complete', '媒体查看完成')}</p>
        <h1>{text(language, 'This prototype stops before the question sequence.', '当前原型在题目流程前结束。')}</h1>
        <p>{text(
          language,
          'Question fields are intentionally not connected yet. The synchronized media, condition-specific disclosure, and interface flow are ready for review.',
          '问题字段尚未接入。本版已完成同步动画、分条件披露与界面流程，供当前评审使用。',
        )}</p>
        <a className="runner-secondary" href="/setup">{text(language, 'Return to facilitator setup', '返回主持人设置')}</a>
      </section>
    </main>
  );
}

function ScenePanel({
  index,
  mode,
  profile,
  time,
  reveal,
  language,
  compact = false,
}: {
  index: string;
  mode: EventSceneMode;
  profile: EventProfile;
  time: number;
  reveal: boolean;
  language: StudyLanguage;
  compact?: boolean;
}) {
  const labels: Record<EventSceneMode, [string, string]> = {
    external: [text(language, 'External flight context', '外部飞行情境'), text(language, 'Route, distance and UAV appearance', '航线、距离与无人机外观')],
    resident: [text(language, 'Resident first-person view', '居民第一人称'), text(language, 'View from the target balcony', '目标阳台观察视角')],
    camera: [text(language, 'Actual UAV camera view', '无人机实际相机画面'), text(language, 'Pose-synchronized synthetic render', '姿态同步合成渲染')],
  };
  return (
    <article className={`event-view-panel ${mode}${compact ? ' compact' : ''}`}>
      <EventMediaScene mode={mode} profile={profile} time={time} reveal={reveal} />
      <div className="event-view-label"><span>{index}</span><div><strong>{labels[mode][0]}</strong><small>{labels[mode][1]}</small></div></div>
      {mode === 'camera' && <div className="camera-crosshair"><i /><b /></div>}
      <span className="synthetic-badge">{text(language, 'Synthetic', '合成画面')}</span>
    </article>
  );
}

function RevealTimeline({
  profile,
  language,
  time,
  playing,
  onTimeChange,
  onToggle,
  onRestart,
}: {
  profile: EventProfile;
  language: StudyLanguage;
  time: number;
  playing: boolean;
  onTimeChange: (value: number) => void;
  onToggle: () => void;
  onRestart: () => void;
}) {
  const highExposure = profile.exposureLevel === 'high';
  return (
    <div className="reveal-transport">
      <div className="reveal-transport-buttons">
        <button type="button" onClick={onRestart} aria-label={text(language, 'Restart', '重新开始')}><RotateCcw size={17} /></button>
        <button className="reveal-play" type="button" onClick={onToggle} aria-label={playing ? text(language, 'Pause', '暂停') : text(language, 'Play', '播放')}>
          {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
        </button>
      </div>
      <span className="reveal-time">{formatTime(time)}</span>
      <div className="reveal-track-wrap">
        <input
          type="range"
          min="0"
          max={EVENT_DURATION_SECONDS}
          step="0.05"
          value={time}
          onChange={(event) => onTimeChange(Number(event.target.value))}
          aria-label={text(language, 'Synchronized event timeline', '同步事件时间轴')}
        />
        {highExposure && <div className="in-view-window" style={{ left: '24%', width: '54%' }}><span>{text(language, 'Audited in-view interval', '已审计入镜区段')}</span></div>}
        <i className="reveal-track-progress" style={{ width: `${(time / EVENT_DURATION_SECONDS) * 100}%` }} />
      </div>
      <span className="reveal-time">{formatTime(EVENT_DURATION_SECONDS)}</span>
    </div>
  );
}

type DisclosureFact = {
  id: string;
  group: VepTab;
  label: string;
  value: string;
  status?: 'verified' | 'declared' | 'unknown';
};

function buildDisclosureFacts(profile: EventProfile, language: StudyLanguage): DisclosureFact[] {
  const extended = profile.dataPractice === 'extended';
  const high = profile.exposureLevel === 'high';
  return [
    { id: 'event-time', group: 'overview', label: text(language, 'Flight window', '飞行时段'), value: '2026-08-24 14:30–14:36', status: 'verified' },
    { id: 'purpose', group: 'overview', label: text(language, 'Declared purpose', '声明目的'), value: text(language, 'Residential facade condition survey', '住宅外立面状况巡检'), status: 'declared' },
    { id: 'operator', group: 'overview', label: text(language, 'Responsible operator', '责任运行方'), value: text(language, 'Kowloon Urban Safety Unit', '九龙城市安全事务组'), status: 'declared' },
    { id: 'a01', group: 'visual', label: text(language, 'Target resident in effective view', '目标居民进入有效视场'), value: high ? text(language, 'Yes, during the audited middle interval', '是，在已审计的中段区间') : text(language, 'No supported in-view interval', '没有可支持的入镜区段'), status: 'verified' },
    { id: 'i01', group: 'visual', label: text(language, 'Person/activity detection', '人员与活动检测'), value: high ? text(language, 'Supported at coarse level', '支持粗粒度判断') : text(language, 'Not supported for this event', '本次事件不支持'), status: 'verified' },
    { id: 'i03', group: 'visual', label: text(language, 'Identity recognition', '身份识别'), value: text(language, 'Not performed', '不执行'), status: 'verified' },
    { id: 'd01', group: 'data', label: text(language, 'Raw recording', '原始录像'), value: text(language, 'Saved', '保存'), status: 'declared' },
    { id: 'd02', group: 'data', label: text(language, 'Processing location', '处理位置'), value: extended ? text(language, 'Remote service', '远程服务') : text(language, 'Local device', '本地设备'), status: 'declared' },
    { id: 'd03', group: 'data', label: text(language, 'Retention', '保存期限'), value: extended ? text(language, '90 days', '90 天') : text(language, '7 days', '7 天'), status: 'declared' },
    { id: 'd04', group: 'data', label: text(language, 'External recipients', '外部接收者'), value: extended ? text(language, 'Named maintenance provider', '明示运维服务方') : text(language, 'No upload', '不上传'), status: 'declared' },
    { id: 'd06', group: 'data', label: text(language, 'Use beyond current task', '任务外用途'), value: extended ? text(language, 'Model quality improvement', '模型质量改进') : text(language, 'None', '无'), status: 'declared' },
    { id: 'd07', group: 'data', label: text(language, 'Additional inference', '额外推断'), value: text(language, 'Currently unknown · reason not supplied', '当前无法确认 · 未提供原因'), status: 'unknown' },
    { id: 'r01', group: 'recourse', label: text(language, 'Explanation contact', '说明责任人'), value: text(language, 'Duty privacy liaison', '值班隐私联络员'), status: 'declared' },
    { id: 'safeguard', group: 'recourse', label: text(language, 'Enabled safeguard', '已启用保护'), value: high ? text(language, 'Identity recognition disabled', '身份识别已禁用') : text(language, 'Camera axis offset from balcony', '相机光轴偏离阳台'), status: 'verified' },
  ];
}

function LinearFacts({ facts, language }: { facts: DisclosureFact[]; language: StudyLanguage }) {
  return (
    <section className="linear-facts">
      <header><FileText size={19} /><div><h2>{text(language, 'Complete event facts', '完整事件事实')}</h2><p>{text(language, 'All available facts are shown in one continuous document.', '所有可用事实均在同一线性文档中完整展示。')}</p></div></header>
      <div className="fact-grid">{facts.map((fact) => <FactRow key={fact.id} fact={fact} />)}</div>
    </section>
  );
}

function VepFacts({
  facts,
  language,
  activeTab,
  onTabChange,
}: {
  facts: DisclosureFact[];
  language: StudyLanguage;
  activeTab: VepTab;
  onTabChange: (tab: VepTab) => void;
}) {
  const tabs: Array<[VepTab, string, typeof Eye]> = [
    ['overview', text(language, 'Overview', '事件概览'), FileText],
    ['visual', text(language, 'Visual & tasks', '视觉与任务'), Eye],
    ['data', text(language, 'Data lifecycle', '数据生命周期'), Database],
    ['recourse', text(language, 'Responsibility & action', '责任与行动'), ShieldCheck],
  ];
  return (
    <section className="vep-facts">
      <div className="vep-tabs" role="tablist">
        {tabs.map(([id, label, Icon], index) => (
          <button key={id} role="tab" aria-selected={activeTab === id} className={activeTab === id ? 'active' : ''} onClick={() => onTabChange(id)}>
            <span>{index + 1}</span><Icon size={17} /><strong>{label}</strong>
          </button>
        ))}
      </div>
      <div className="vep-panel" role="tabpanel">
        <header>
          {activeTab === 'overview' && <FileText size={21} />}
          {activeTab === 'visual' && <Eye size={21} />}
          {activeTab === 'data' && <Database size={21} />}
          {activeTab === 'recourse' && <UserRound size={21} />}
          <div><h2>{tabs.find(([id]) => id === activeTab)?.[1]}</h2><p>{text(language, 'Evidence status is shown for every field.', '每个字段均显示证据状态。')}</p></div>
        </header>
        <div className="fact-grid">{facts.filter((fact) => fact.group === activeTab).map((fact) => <FactRow key={fact.id} fact={fact} />)}</div>
      </div>
    </section>
  );
}

function FactRow({ fact }: { fact: DisclosureFact }) {
  return (
    <article className={`fact-row ${fact.status ?? ''}`}>
      <div><span>{fact.id.toUpperCase()}</span><strong>{fact.label}</strong></div>
      <p>{fact.value}</p>
      {fact.status && <small>{fact.status}</small>}
    </article>
  );
}

function NoticeDisclosure({ language, onContinue }: { language: StudyLanguage; onContinue: () => void }) {
  return (
    <main className="runner-shell notice-shell">
      <section className="notice-card">
        <div className="notice-brand"><span>KS</span><div><strong>{text(language, 'Kowloon Urban Safety Unit', '九龙城市安全事务组')}</strong><small>{text(language, 'Flight notice', '飞行通知')}</small></div></div>
        <p className="notice-date">24 AUG 2026 · 14:30–14:36</p>
        <h1>{text(language, 'Residential facade inspection', '住宅外立面巡检')}</h1>
        <p>{text(language, 'A registered UAV will operate near the Mong Kok residential block for a facade condition survey.', '一架已备案无人机将在旺角住宅街区附近执行外立面状况巡检。')}</p>
        <dl>
          <div><dt>{text(language, 'Area', '区域')}</dt><dd>{text(language, 'Mong Kok study block', '旺角研究街区')}</dd></div>
          <div><dt>{text(language, 'Filing', '备案号')}</dt><dd>VEP-2026-081</dd></div>
          <div><dt>{text(language, 'Contact', '联系方式')}</dt><dd>privacy-liaison@example.org</dd></div>
        </dl>
        <button className="runner-primary" type="button" onClick={onContinue}>{text(language, 'Continue', '继续')} <ArrowRight size={18} /></button>
      </section>
    </main>
  );
}

function text(language: StudyLanguage, english: string, chinese: string) {
  return language === 'zh' ? chinese : english;
}

function formatTime(seconds: number) {
  const rounded = Math.max(0, Math.floor(seconds));
  return `${Math.floor(rounded / 60).toString().padStart(2, '0')}:${(rounded % 60).toString().padStart(2, '0')}`;
}
