import {
  ArrowRight,
  Camera,
  CheckCircle2,
  Clipboard,
  Database,
  Eye,
  FileText,
  Maximize2,
  Minimize2,
  Move3d,
  Orbit,
  Pause,
  Play,
  RotateCcw,
  ScanLine,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  EventMediaScene,
  type EventSceneInteraction,
  type EventSceneMode,
  type GaussianAssetStatus,
} from './EventMediaScene';
import {
  EVENT_PROFILES,
  EVENT_DURATION_SECONDS,
  readDisclosureCondition,
  readEventProfile,
  sampleEventPose,
  type DisclosureCondition,
  type EventProfile,
} from './eventProfiles';
import {
  createDefaultMatrixCityFlightConfig,
  decodeMatrixCityFlightConfig,
  type MatrixCityFlightConfig,
} from './matrixCityFlightConfig';
import {
  appendStudyEvents,
  completeStudy,
  confirmStudyStart,
  createStudyEvent,
  getOrCreateClientNonce,
  launchStudy,
  updateStudyPhase,
  type AssignedStudySession,
} from './studyApi';
import type { StudyLanguage } from './types';

type RunnerPhase = 'ready' | 'attention' | 'initial_media' | 'disclosure' | 'complete';
type VepTab = 'overview' | 'visual' | 'data' | 'recourse';

const FRAME_INTERVAL_MS = 40;

export function EventStudyRunner() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const facilitatorMode = params.get('role') === 'facilitator';
  const manualProfile = useMemo(() => readEventProfile(params.get('profile')), [params]);
  const manualCondition = useMemo(() => readDisclosureCondition(params.get('disclosure')), [params]);
  const language: StudyLanguage = params.get('lang') === 'zh' ? 'zh' : 'en';
  const previewDisclosure = facilitatorMode && params.get('preview') === 'disclosure';
  const [assignment, setAssignment] = useState<AssignedStudySession | null>(null);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const [assignmentAttempt, setAssignmentAttempt] = useState(0);
  const [completionCode, setCompletionCode] = useState<string | null>(null);
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const profile = facilitatorMode ? manualProfile : assignment ? EVENT_PROFILES[assignment.profile] : manualProfile;
  const condition = facilitatorMode ? manualCondition : assignment?.disclosure_condition ?? manualCondition;
  const participantId = facilitatorMode
    ? params.get('participant_id') || 'Preview'
    : text(language, 'Anonymous', '匿名参与者');
  const sessionId = assignment?.session_id
    ?? (facilitatorMode ? params.get('session_id') || 'preview-session' : 'Assigning...');
  const flightConfiguration = useMemo(() => {
    const fallback = createDefaultMatrixCityFlightConfig(profile.trajectoryId);
    const encoded = facilitatorMode ? params.get('flight') : null;
    if (!encoded) return { config: fallback, custom: false, error: null as string | null };
    try {
      return {
        config: decodeMatrixCityFlightConfig(encoded),
        custom: true,
        error: null as string | null,
      };
    } catch (reason) {
      return {
        config: fallback,
        custom: false,
        error: reason instanceof Error ? reason.message : 'Invalid flight configuration',
      };
    }
  }, [facilitatorMode, params, profile.trajectoryId]);
  const [phase, setPhase] = useState<RunnerPhase>(previewDisclosure ? 'disclosure' : 'ready');
  const [countdown, setCountdown] = useState(3);
  const [time, setTime] = useState(previewDisclosure ? EVENT_DURATION_SECONDS / 2 : 0);
  const [playing, setPlaying] = useState(false);
  const [activeTab, setActiveTab] = useState<VepTab>('overview');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [vepFollowUav, setVepFollowUav] = useState(true);
  const [vepShowFrustum, setVepShowFrustum] = useState(true);
  const [vepShowClarity, setVepShowClarity] = useState(true);
  const [vepResetViewNonce, setVepResetViewNonce] = useState(0);
  const [gaussianStatus, setGaussianStatus] = useState<GaussianAssetStatus>('procedural');
  const mediaRef = useRef<HTMLElement | null>(null);
  const studyTokenRef = useRef<string | null>(null);
  const eventSequenceRef = useRef(Math.floor(Date.now() / 10));

  const pose = useMemo(
    () => sampleEventPose(profile, time, flightConfiguration.config),
    [flightConfiguration.config, profile, time],
  );
  const facts = useMemo(() => buildDisclosureFacts(profile, language), [language, profile]);
  const vepInteraction = useMemo<EventSceneInteraction>(() => ({
    enabled: true,
    followUav: vepFollowUav,
    showFrustum: vepShowFrustum,
    showClarity: vepShowClarity,
  }), [vepFollowUav, vepShowClarity, vepShowFrustum]);
  const gaussianAssetUrl = useMemo(() => {
    const configured = import.meta.env.VITE_MATRIXCITY_GS_MANIFEST_URL
      || import.meta.env.VITE_MATRIXCITY_GS_URL;
    return typeof configured === 'string' && configured.trim() ? configured.trim() : undefined;
  }, []);

  useEffect(() => {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  }, [language]);

  useEffect(() => {
    if (facilitatorMode) return;
    let cancelled = false;
    setAssignmentError(null);
    launchStudy({
      clientNonce: getOrCreateClientNonce(),
      entryToken: params.get('entry_token') || undefined,
      language,
    }).then((session) => {
      if (cancelled) return;
      if (!session.session_token) throw new Error('The study service did not issue a session token');
      studyTokenRef.current = session.session_token;
      setAssignment(session);
      if (session.completion_code) {
        setCompletionCode(session.completion_code);
        setPhase('complete');
      } else if (session.phase === 'disclosure' || session.phase === 'initial_media') {
        // Never replay the one-time stimulus after a refresh. If the browser
        // closed during playback, resume at disclosure instead.
        setTime(0);
        setPhase('disclosure');
      } else if (session.phase === 'attention' || session.phase === 'attention_prompt_3s') {
        setPhase('attention');
      }
    }).catch((reason: unknown) => {
      if (!cancelled) setAssignmentError(reason instanceof Error ? reason.message : 'Study assignment failed');
    });
    return () => { cancelled = true; };
  }, [assignmentAttempt, facilitatorMode, language, params]);

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

  const recordEvent = useCallback(async (
    eventType: string,
    eventPhase: string,
    payload: Record<string, unknown> = {},
  ) => {
    const token = studyTokenRef.current;
    if (!token || facilitatorMode) return;
    await appendStudyEvents(token, [
      createStudyEvent(eventSequenceRef.current++, eventType, eventPhase, payload),
    ]);
  }, [facilitatorMode]);

  useEffect(() => {
    const token = studyTokenRef.current;
    if (!token || facilitatorMode || phase === 'ready' || phase === 'complete') return;
    void updateStudyPhase(token, phase).catch(() => undefined);
    if (phase === 'initial_media') {
      void recordEvent('initial_media_started', phase).catch(() => undefined);
    }
    if (phase === 'disclosure') {
      void recordEvent('initial_media_completed', 'initial_media').catch(() => undefined);
      void recordEvent('disclosure_view_entered', phase, { condition }).catch(() => undefined);
    }
  }, [condition, facilitatorMode, phase, recordEvent]);

  const begin = async () => {
    if (!facilitatorMode) {
      const token = studyTokenRef.current;
      if (!token) return;
      setSubmitting(true);
      setAssignmentError(null);
      try {
        await confirmStudyStart(token);
        await recordEvent('study_start_confirmed', 'ready');
      } catch (reason) {
        setAssignmentError(reason instanceof Error ? reason.message : 'Unable to start the study');
        setSubmitting(false);
        return;
      }
      setSubmitting(false);
    }
    setPhase('attention');
  };

  const enterComplete = useCallback(async () => {
    if (facilitatorMode) {
      setPhase('complete');
      return;
    }
    const token = studyTokenRef.current;
    if (!token) return;
    setSubmitting(true);
    setCompletionError(null);
    try {
      // Repeat the milestone event names in one final batch. This closes any
      // transition race if a browser loses focus while media is advancing.
      await appendStudyEvents(token, [
        createStudyEvent(eventSequenceRef.current++, 'initial_media_completed', 'initial_media'),
        createStudyEvent(eventSequenceRef.current++, 'disclosure_view_entered', 'disclosure'),
        createStudyEvent(eventSequenceRef.current++, 'media_review_completed', 'disclosure', { condition }),
      ]);
      const completed = await completeStudy(token);
      setCompletionCode(completed.completion_code);
      setPhase('complete');
    } catch (reason) {
      setCompletionError(reason instanceof Error ? reason.message : 'Completion code could not be issued');
    } finally {
      setSubmitting(false);
    }
  }, [condition, facilitatorMode]);

  if (!facilitatorMode && !assignment) {
    return (
      <main className="runner-shell runner-ready">
        <section className="runner-ready-card runner-assignment-card">
          <div className="runner-status-mark"><ShieldCheck size={24} /></div>
          <p className="runner-eyebrow">{text(language, 'Secure study entry', '安全进入实验')}</p>
          <h1>{assignmentError
            ? text(language, 'The study session could not be assigned.', '暂时无法分配实验场次。')
            : text(language, 'Assigning your study session...', '正在分配你的实验场次……')}</h1>
          <p>{assignmentError || text(
            language,
            'Your study condition is assigned automatically. No personal identity is requested.',
            '实验条件由系统自动分配，不收集个人身份信息。',
          )}</p>
          {assignmentError ? (
            <button className="runner-primary" type="button" onClick={() => setAssignmentAttempt((value) => value + 1)}>
              {text(language, 'Retry', '重试')} <RotateCcw size={17} />
            </button>
          ) : <div className="runner-loading-bar" aria-label={text(language, 'Assigning session', '正在分配场次')}><i /></div>}
        </section>
      </main>
    );
  }

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
          <button className="runner-primary" type="button" onClick={() => void begin()} disabled={submitting}>
            {text(language, 'I am ready', '我已准备好')} <ArrowRight size={18} />
          </button>
          {assignmentError && <p className="runner-inline-error">{assignmentError}</p>}
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
            <ScenePanel index="01" mode="external" profile={profile} time={time} reveal={false} language={language} gaussianAssetUrl={gaussianAssetUrl} flightConfig={flightConfiguration.config} />
            <ScenePanel index="02" mode="resident" profile={profile} time={time} reveal={false} language={language} gaussianAssetUrl={gaussianAssetUrl} flightConfig={flightConfiguration.config} />
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
      return <NoticeDisclosure language={language} onContinue={() => void enterComplete()} disabled={submitting} error={completionError} />;
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
          {condition === 'V' ? (
            <VepEvidenceStage
              profile={profile}
              language={language}
              time={time}
              interaction={vepInteraction}
              resetViewNonce={vepResetViewNonce}
              gaussianAssetUrl={gaussianAssetUrl}
              gaussianStatus={gaussianStatus}
              flightConfig={flightConfiguration.config}
              customFlightConfig={flightConfiguration.custom}
              flightConfigError={flightConfiguration.error}
              onGaussianStatusChange={setGaussianStatus}
              onFollowChange={(followUav) => {
                setVepFollowUav(followUav);
                void recordEvent('vep_camera_mode_changed', 'disclosure', {
                  mode: followUav ? 'follow_uav' : 'free_explore',
                }).catch(() => undefined);
              }}
              onFrustumChange={(showFrustum) => {
                setVepShowFrustum(showFrustum);
                void recordEvent('vep_frustum_toggled', 'disclosure', { visible: showFrustum })
                  .catch(() => undefined);
              }}
              onClarityChange={(showClarity) => {
                setVepShowClarity(showClarity);
                void recordEvent('vep_clarity_toggled', 'disclosure', { visible: showClarity })
                  .catch(() => undefined);
              }}
              onResetView={() => {
                setVepResetViewNonce((value) => value + 1);
                void recordEvent('vep_view_reset', 'disclosure').catch(() => undefined);
              }}
            />
          ) : (
            <div className="reveal-triple-grid standard-disclosure-grid">
              <ScenePanel index="01" mode="external" profile={profile} time={time} reveal={false} language={language} compact gaussianAssetUrl={gaussianAssetUrl} flightConfig={flightConfiguration.config} />
              <ScenePanel index="02" mode="resident" profile={profile} time={time} reveal={false} language={language} compact gaussianAssetUrl={gaussianAssetUrl} flightConfig={flightConfiguration.config} />
              <ScenePanel index="03" mode="camera" profile={profile} time={time} reveal={false} language={language} compact gaussianAssetUrl={gaussianAssetUrl} flightConfig={flightConfiguration.config} />
            </div>
          )}
          <RevealTimeline
            profile={profile}
            language={language}
            time={time}
            playing={playing}
            onTimeChange={(next) => {
              setTime(next);
              setPlaying(false);
            }}
            scrubbable={condition === 'V'}
            onScrubCommitted={() => {
              if (condition === 'V') {
                void recordEvent('vep_timeline_scrubbed', 'disclosure', {
                  time_seconds: Number(time.toFixed(2)),
                }).catch(() => undefined);
              }
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
          <button className="runner-primary" type="button" onClick={() => void enterComplete()} disabled={submitting}>
            {submitting ? text(language, 'Issuing completion code...', '正在签发完成码……') : text(language, 'Finish review', '完成查看')} <ArrowRight size={18} />
          </button>
          {completionError && <p className="runner-inline-error">{completionError}</p>}
        </div>
      </main>
    );
  }

  return (
    <main className="runner-shell runner-complete">
      <section>
        <CheckCircle2 size={34} />
        <p className="runner-eyebrow">{text(language, 'Media review complete', '媒体查看完成')}</p>
        <h1>{completionCode
          ? text(language, 'Your completion code is ready.', '你的实验完成码已生成。')
          : text(language, 'Facilitator preview complete.', '主持人预览已完成。')}</h1>
        {completionCode ? (
          <>
            <p>{text(language, 'Enter this code in the questionnaire. It links your questionnaire submission to this completed VEP session.', '请将此代码填入问卷。它用于将问卷提交与本次已完成的 VEP 实验记录对应起来。')}</p>
            <div className="completion-code" aria-label={text(language, 'Completion code', '实验完成码')}>
              <span>{completionCode}</span>
              <button type="button" onClick={() => {
                void navigator.clipboard.writeText(completionCode);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1600);
              }}><Clipboard size={17} />{copied ? text(language, 'Copied', '已复制') : text(language, 'Copy code', '复制完成码')}</button>
            </div>
            <p className="completion-warning">{text(language, 'Keep this page open until you have entered the code.', '请在完成码填入问卷前保持此页面开启。')}</p>
          </>
        ) : (
          <p>{text(language, 'No study record or completion code is issued in facilitator preview mode.', '主持人预览模式不会写入实验记录，也不会签发完成码。')}</p>
        )}
        {facilitatorMode && <a className="runner-secondary" href="/setup">{text(language, 'Return to facilitator setup', '返回主持人设置')}</a>}
      </section>
    </main>
  );
}

function VepEvidenceStage({
  profile,
  language,
  time,
  interaction,
  resetViewNonce,
  gaussianAssetUrl,
  gaussianStatus,
  flightConfig,
  customFlightConfig,
  flightConfigError,
  onGaussianStatusChange,
  onFollowChange,
  onFrustumChange,
  onClarityChange,
  onResetView,
}: {
  profile: EventProfile;
  language: StudyLanguage;
  time: number;
  interaction: EventSceneInteraction;
  resetViewNonce: number;
  gaussianAssetUrl?: string;
  gaussianStatus: GaussianAssetStatus;
  flightConfig: MatrixCityFlightConfig;
  customFlightConfig: boolean;
  flightConfigError: string | null;
  onGaussianStatusChange: (status: GaussianAssetStatus) => void;
  onFollowChange: (follow: boolean) => void;
  onFrustumChange: (visible: boolean) => void;
  onClarityChange: (visible: boolean) => void;
  onResetView: () => void;
}) {
  const assetLabels: Record<GaussianAssetStatus, [string, string]> = {
    procedural: ['Procedural study scene', '程序化研究场景'],
    loading: ['Loading MatrixCity 3DGS', '正在加载 MatrixCity 3DGS'],
    streaming: ['Loading surrounding tiles', '正在加载周边场景块'],
    ready: ['MatrixCity 3DGS ready', 'MatrixCity 3DGS 已就绪'],
    partial: ['Partial 3DGS context', '部分 3DGS 场景已加载'],
    error: ['Procedural fallback', '已回退至程序化场景'],
  };
  return (
    <section className="vep-evidence-stage" aria-label={text(language, 'Interactive visual evidence', '交互式视觉证据')}>
      <div className="vep-scene-toolbar">
        <div className="vep-view-segment" aria-label={text(language, 'Scene camera mode', '场景相机模式')}>
          <button
            type="button"
            className={interaction.followUav ? 'active' : ''}
            aria-pressed={interaction.followUav}
            onClick={() => onFollowChange(true)}
            title={text(language, 'Keep the scene camera synchronized with the UAV', '保持场景相机与无人机同步')}
          >
            <Camera size={16} />{text(language, 'Follow UAV', '跟随无人机')}
          </button>
          <button
            type="button"
            className={!interaction.followUav ? 'active' : ''}
            aria-pressed={!interaction.followUav}
            onClick={() => onFollowChange(false)}
            title={text(language, 'Unlock orbit, pan and zoom controls', '解锁旋转、平移和缩放')}
          >
            <Orbit size={16} />{text(language, 'Explore scene', '自由观察')}
          </button>
        </div>
        <label className="vep-layer-toggle">
          <input
            type="checkbox"
            checked={interaction.showFrustum}
            onChange={(event) => onFrustumChange(event.target.checked)}
          />
          <ScanLine size={16} />
          <span>{text(language, 'Camera frustum', '相机视锥')}</span>
        </label>
        <label className="vep-layer-toggle">
          <input
            type="checkbox"
            checked={interaction.showClarity}
            onChange={(event) => onClarityChange(event.target.checked)}
          />
          <Move3d size={16} />
          <span>{text(language, 'Physical clarity', '物理清晰度')}</span>
        </label>
        <button
          className="vep-reset-view"
          type="button"
          onClick={onResetView}
          title={text(language, 'Reset scene camera', '重置场景相机')}
          aria-label={text(language, 'Reset scene camera', '重置场景相机')}
        >
          <RotateCcw size={16} />
        </button>
        <span className={`vep-asset-status ${gaussianStatus}`}>
          <i />{text(language, assetLabels[gaussianStatus][0], assetLabels[gaussianStatus][1])}
        </span>
        {(customFlightConfig || flightConfigError) && (
          <span
            className={`vep-flight-status ${flightConfigError ? 'error' : 'custom'}`}
            title={flightConfigError ?? text(language, 'Validated facilitator flight configuration', '已验证的主持人飞行配置')}
          >
            {flightConfigError
              ? text(language, 'Default flight restored', '已恢复默认飞行配置')
              : text(language, 'Custom flight', '自定义飞行配置')}
          </span>
        )}
      </div>

      <div className="vep-scene-grid">
        <ScenePanel
          index="01"
          mode="external"
          profile={profile}
          time={time}
          reveal
          language={language}
          compact
          interaction={interaction}
          resetViewNonce={resetViewNonce}
          gaussianAssetUrl={gaussianAssetUrl}
          onGaussianStatusChange={onGaussianStatusChange}
          flightConfig={flightConfig}
        />
        <ScenePanel
          index="02"
          mode="camera"
          profile={profile}
          time={time}
          reveal
          language={language}
          compact
          gaussianAssetUrl={gaussianAssetUrl}
          flightConfig={flightConfig}
        />
      </div>

      <div className="clarity-method-strip">
        <div>
          <strong>{text(language, 'Physical image clarity estimate', '物理成像清晰度估算')}</strong>
          <span>{text(
            language,
            'Camera distance, projected pixel density, viewing angle and field of view',
            '由相机距离、投影像素密度、观察角度与视场共同估算',
          )}</span>
        </div>
        <div className="clarity-scale" aria-label={text(language, 'Clarity scale', '清晰度图例')}>
          <span><i className="low" />{text(language, 'Lower', '较低')}</span>
          <span><i className="medium" />{text(language, 'Medium', '中等')}</span>
          <span><i className="high" />{text(language, 'Higher', '较高')}</span>
        </div>
        <small>{text(language, 'Not a privacy score', '不是隐私分数')}</small>
      </div>
    </section>
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
  interaction,
  resetViewNonce,
  gaussianAssetUrl,
  onGaussianStatusChange,
  flightConfig,
}: {
  index: string;
  mode: EventSceneMode;
  profile: EventProfile;
  time: number;
  reveal: boolean;
  language: StudyLanguage;
  compact?: boolean;
  interaction?: EventSceneInteraction;
  resetViewNonce?: number;
  gaussianAssetUrl?: string;
  onGaussianStatusChange?: (status: GaussianAssetStatus) => void;
  flightConfig: MatrixCityFlightConfig;
}) {
  const labels: Record<EventSceneMode, [string, string]> = {
    external: [text(language, 'External flight context', '外部飞行情境'), text(language, 'Route, distance and UAV appearance', '航线、距离与无人机外观')],
    resident: [text(language, 'Resident first-person view', '居民第一人称'), text(language, 'View from the target balcony', '目标阳台观察视角')],
    camera: [text(language, 'Actual UAV camera view', '无人机实际相机画面'), text(language, 'Pose-synchronized synthetic render', '姿态同步合成渲染')],
  };
  return (
    <article className={`event-view-panel ${mode}${compact ? ' compact' : ''}`}>
      <EventMediaScene
        mode={mode}
        profile={profile}
        time={time}
        reveal={reveal}
        interaction={interaction}
        resetViewNonce={resetViewNonce}
        gaussianAssetUrl={gaussianAssetUrl}
        onGaussianStatusChange={onGaussianStatusChange}
        flightConfig={flightConfig}
      />
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
  scrubbable = true,
  onScrubCommitted,
  onToggle,
  onRestart,
}: {
  profile: EventProfile;
  language: StudyLanguage;
  time: number;
  playing: boolean;
  onTimeChange: (value: number) => void;
  scrubbable?: boolean;
  onScrubCommitted?: () => void;
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
        {scrubbable ? (
          <input
            type="range"
            min="0"
            max={EVENT_DURATION_SECONDS}
            step="0.05"
            value={time}
            onChange={(event) => onTimeChange(Number(event.target.value))}
            onPointerUp={onScrubCommitted}
            onKeyUp={onScrubCommitted}
            aria-label={text(language, 'Synchronized event timeline', '同步事件时间轴')}
          />
        ) : (
          <span
            className="standard-playback-track"
            role="progressbar"
            aria-label={text(language, 'Standard animation progress', '标准动画进度')}
            aria-valuemin={0}
            aria-valuemax={EVENT_DURATION_SECONDS}
            aria-valuenow={time}
          />
        )}
        {highExposure && scrubbable && (
          <div className="in-view-window" style={{ left: '24%', width: '54%' }}>
            <span>{text(language, 'Audited in-view interval', '已审计入镜区段')}</span>
          </div>
        )}
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

function NoticeDisclosure({
  language,
  onContinue,
  disabled = false,
  error,
}: {
  language: StudyLanguage;
  onContinue: () => void;
  disabled?: boolean;
  error?: string | null;
}) {
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
        <button className="runner-primary" type="button" onClick={onContinue} disabled={disabled}>{disabled ? text(language, 'Issuing completion code...', '正在签发完成码……') : text(language, 'Finish review', '完成查看')} <ArrowRight size={18} /></button>
        {error && <p className="runner-inline-error">{error}</p>}
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
