import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildStudyUrl, readStudySession } from './studySession';
import type { StudyLanguage } from './types';
import { WarmupMeshScene } from './WarmupMeshScene';
import { WARMUP_RESULT_STORAGE_KEY } from './warmupStorage';

export { WARMUP_RESULT_STORAGE_KEY } from './warmupStorage';

type WarmupPhase = 'intro' | 'observe' | 'estimate' | 'reveal' | 'complete';

type TimelineSample = {
  time: number;
  x: number;
  y: number;
  distance: number;
  audibility: number;
  exposure: number;
  gimbal: number;
};

const DURATION_SECONDS = 36;
const TICK_MS = 50;

export function WarmupExperience() {
  const session = useMemo(() => readStudySession(), []);
  const language = session.language;
  const [phase, setPhase] = useState<WarmupPhase>('intro');
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [prediction, setPrediction] = useState(18);
  const [confidence, setConfidence] = useState(3);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const audioRef = useRef<DroneAudio | null>(null);

  const sample = useMemo(() => sampleTimeline(time), [time]);
  const predictionError = Math.abs(prediction - EXPOSURE_PEAK_TIME);
  const studyHref = useMemo(() => buildStudyUrl(window.location.origin, {
    condition: session.condition,
    language: session.language,
    participantId: session.participantId,
    sessionId: session.sessionId,
    scenarioId: session.scenarioId,
    cameraProfileId: session.cameraProfileId,
  }), [session]);

  useEffect(() => {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  }, [language]);

  useEffect(() => {
    if (!playing) return;
    const startedAt = performance.now() - time * 1000;
    const timer = window.setInterval(() => {
      const nextTime = Math.min(DURATION_SECONDS, (performance.now() - startedAt) / 1000);
      setTime(nextTime);
      if (nextTime >= DURATION_SECONDS) {
        setPlaying(false);
        if (phase === 'observe') setPhase('estimate');
        if (phase === 'reveal') setPhase('complete');
      }
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [phase, playing, time]);

  useEffect(() => {
    if (!soundEnabled || !playing) {
      audioRef.current?.setLevel(0);
      return;
    }
    audioRef.current?.setLevel(sample.audibility);
  }, [playing, sample.audibility, soundEnabled]);

  useEffect(() => () => audioRef.current?.dispose(), []);

  const beginObservation = useCallback(async () => {
    if (soundEnabled && typeof AudioContext !== 'undefined') {
      if (!audioRef.current) audioRef.current = new DroneAudio();
      await audioRef.current.resume();
    }
    setPhase('observe');
    setTime(0);
    setPlaying(true);
  }, [soundEnabled]);

  const beginReveal = useCallback(async () => {
    if (soundEnabled && typeof AudioContext !== 'undefined') {
      if (!audioRef.current) audioRef.current = new DroneAudio();
      await audioRef.current.resume();
    }
    window.sessionStorage.setItem(WARMUP_RESULT_STORAGE_KEY, JSON.stringify({
      completed_at: new Date().toISOString(),
      participant_id: session.participantId,
      session_id: session.sessionId,
      language,
      condition: session.condition,
      predicted_exposure_peak_s: prediction,
      actual_exposure_peak_s: EXPOSURE_PEAK_TIME,
      prediction_error_s: Math.abs(prediction - EXPOSURE_PEAK_TIME),
      confidence,
      sound_enabled: soundEnabled,
    }));
    setPhase('reveal');
    setTime(0);
    setPlaying(true);
  }, [confidence, language, prediction, session, soundEnabled]);

  const togglePlayback = useCallback(async () => {
    if (soundEnabled && typeof AudioContext !== 'undefined') {
      if (!audioRef.current) audioRef.current = new DroneAudio();
      await audioRef.current.resume();
    }
    if (time >= DURATION_SECONDS) setTime(0);
    setPlaying((current) => !current);
  }, [soundEnabled, time]);

  if (phase === 'intro') {
    return (
      <main className="warmup-shell warmup-intro">
        <div className="warmup-intro-copy">
          <p className="warmup-kicker">{copy(language, 'Perception calibration', '感知校准')}</p>
          <h1>{copy(language, 'When a drone passes nearby, what can its camera actually see?', '当无人机从附近飞过时，它的相机究竟能看到什么？')}</h1>
          <p className="warmup-lead">
            {copy(
              language,
              "First, watch and listen from a resident's viewpoint. Estimate when visual exposure is highest before seeing the simulated camera view.",
              '请先从居民视角观察和聆听，并在看到模拟相机画面之前，判断视觉暴露最高的时刻。',
            )}
          </p>
          <div className="warmup-consent-row">
            <button className="warmup-sound-toggle" type="button" onClick={() => setSoundEnabled((value) => !value)}>
              <SoundIcon muted={!soundEnabled} />
              {soundEnabled ? copy(language, 'Sound on', '声音开启') : copy(language, 'Muted', '静音')}
            </button>
            <span>{copy(language, 'Headphones recommended', '建议佩戴耳机')}</span>
          </div>
          <button className="warmup-start" type="button" onClick={() => void beginObservation()}>
            {copy(language, 'Begin experience', '开始体验')}
          </button>
          <p className="warmup-disclaimer">
            {copy(
              language,
              'The live views are rendered from Hong Kong OSM building meshes. No real residents or private imagery are shown.',
              '实时画面由香港 OSM 建筑网格渲染，不包含真实居民或私人影像。',
            )}
          </p>
        </div>
      </main>
    );
  }

  if (phase === 'estimate') {
    return (
      <main className="warmup-shell warmup-estimate">
        <section className="estimate-card">
          <p className="warmup-kicker">{copy(language, 'Your estimate', '你的判断')}</p>
          <h1>{copy(language, 'When was visual privacy exposure likely to be highest?', '你认为视觉隐私暴露最可能在哪一时刻达到最高？')}</h1>
          <div className="prediction-readout">
            <span>{copy(language, 'Selected moment', '已选时刻')}</span>
            <strong>{formatTime(prediction)}</strong>
          </div>
          <input
            aria-label={copy(language, 'Predicted exposure peak', '预测暴露峰值')}
            className="prediction-slider"
            type="range"
            min="0"
            max={DURATION_SECONDS}
            step="0.5"
            value={prediction}
            onChange={(event) => setPrediction(Number(event.target.value))}
          />
          <div className="prediction-scale">
            <span>{copy(language, 'Approaching', '接近')}</span>
            <span>{copy(language, 'Passing', '经过')}</span>
            <span>{copy(language, 'Leaving', '离开')}</span>
          </div>
          <fieldset className="confidence-field">
            <legend>{copy(language, 'How confident are you?', '你有多确定？')}</legend>
            <div>
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  className={confidence === value ? 'active' : ''}
                  type="button"
                  onClick={() => setConfidence(value)}
                  aria-label={`${copy(language, 'Confidence', '信心')} ${value}`}
                >
                  {value}
                </button>
              ))}
            </div>
            <p><span>{copy(language, 'Guess', '猜测')}</span><span>{copy(language, 'Very certain', '非常确定')}</span></p>
          </fieldset>
          <button className="warmup-start" type="button" onClick={() => void beginReveal()}>
            {copy(language, 'Reveal the camera view', '揭示相机画面')}
          </button>
        </section>
      </main>
    );
  }

  const revealVisible = phase === 'reveal' || phase === 'complete';

  return (
    <main className="warmup-shell warmup-player">
      <header className="warmup-player-header">
        <div>
          <p className="warmup-kicker">
            {revealVisible ? copy(language, 'Synchronized reveal', '同步揭示') : copy(language, 'Resident viewpoint', '居民视角')}
          </p>
          <h1>
            {revealVisible
              ? copy(language, 'What you hear is not the same as what the camera sees.', '你听到的，并不等同于相机看到的。')
              : copy(language, 'Listen first. Where do you think exposure peaks?', '请先聆听。你认为暴露峰值在哪里？')}
          </h1>
        </div>
        <button className="warmup-sound-toggle compact" type="button" onClick={() => setSoundEnabled((value) => !value)}>
          <SoundIcon muted={!soundEnabled} />
          {soundEnabled ? copy(language, 'Sound', '声音') : copy(language, 'Muted', '静音')}
        </button>
      </header>

      <section className={revealVisible ? 'warmup-views reveal' : 'warmup-views'}>
        <ObserverView sample={sample} reveal={revealVisible} language={language} />
        {revealVisible && <CameraView sample={sample} language={language} />}
      </section>

      <section className="warmup-console">
        <div className="timeline-labels">
          <span>{formatTime(time)}</span>
          <span>{playing ? copy(language, 'Playing', '播放中') : copy(language, 'Paused', '已暂停')}</span>
          <span>{formatTime(DURATION_SECONDS)}</span>
        </div>
        <input
          aria-label={copy(language, 'Warm-up timeline', '预热时间轴')}
          className="warmup-timeline"
          type="range"
          min="0"
          max={DURATION_SECONDS}
          step="0.1"
          value={time}
          onChange={(event) => {
            setTime(Number(event.target.value));
            setPlaying(false);
          }}
        />
        {revealVisible && <ExposurePlot time={time} prediction={prediction} language={language} />}
        <div className="warmup-transport">
          <button type="button" onClick={() => setTime(0)} aria-label={copy(language, 'Restart', '重新开始')}>↺</button>
          <button className="play" type="button" onClick={() => void togglePlayback()}>
            {playing ? copy(language, 'Pause', '暂停') : copy(language, 'Play', '播放')}
          </button>
          {phase === 'observe' && (
            <button
              type="button"
              onClick={() => {
                setPlaying(false);
                setPhase('estimate');
              }}
            >
              {copy(language, 'Make estimate', '开始判断')}
            </button>
          )}
          {phase === 'complete' && (
            <a className="continue-study" href={studyHref}>{copy(language, 'Continue to study', '进入正式研究')}</a>
          )}
        </div>
      </section>

      {phase === 'complete' && (
        <section className="warmup-takeaway">
          <div>
            <span>{copy(language, 'Your estimate', '你的判断')}</span>
            <strong>{formatTime(prediction)}</strong>
          </div>
          <div>
            <span>{copy(language, 'Exposure peak', '暴露峰值')}</span>
            <strong>{formatTime(EXPOSURE_PEAK_TIME)}</strong>
          </div>
          <div>
            <span>{copy(language, 'Difference', '判断误差')}</span>
            <strong>{predictionError.toFixed(1)} s</strong>
          </div>
          <p>
            {copy(
              language,
              'Audible or visible presence does not directly determine visual exposure. Camera orientation, occlusion, distance, and image detail change what may be captured.',
              '听见或看见无人机，并不能直接判断视觉暴露。相机朝向、遮挡、距离和成像细节共同决定可能拍到什么。',
            )}
          </p>
        </section>
      )}
    </main>
  );
}

function ObserverView({ sample, reveal, language }: { sample: TimelineSample; reveal: boolean; language: StudyLanguage }) {
  return (
    <article className="observer-view" aria-label={copy(language, 'Resident viewpoint', '居民视角')}>
      <WarmupMeshScene mode="observer" time={sample.time} exposure={sample.exposure} reveal={reveal} />
      <div className="view-label">
        <span>01</span>
        <strong>{copy(language, 'Resident viewpoint', '居民视角')}</strong>
        <small>{copy(language, 'Geospatial city mesh', '地理空间城市网格')}</small>
      </div>
      <div className="observer-readout">
        <MetricBar label={copy(language, 'Sound', '声音')} value={sample.audibility} color="#f0b44d" />
        {reveal && <MetricBar label={copy(language, 'Exposure', '暴露')} value={sample.exposure} color="#ef5b45" />}
      </div>
    </article>
  );
}

function CameraView({ sample, language }: { sample: TimelineSample; language: StudyLanguage }) {
  const targetVisible = sample.exposure > 0.2;
  return (
    <article className="camera-view" aria-label={copy(language, 'Simulated UAV camera view', '模拟无人机相机视角')}>
      <WarmupMeshScene mode="camera" time={sample.time} exposure={sample.exposure} reveal />
      <div className="view-label dark">
        <span>02</span>
        <strong>{copy(language, 'Live UAV camera render', '实时无人机相机渲染')}</strong>
        <small>{copy(language, 'Pose-synchronized mesh camera', '姿态同步网格相机')}</small>
      </div>
      <div className="camera-reticle"><span /><i /></div>
      {targetVisible && (
        <div className="privacy-signal" style={{ opacity: Math.min(1, sample.exposure * 1.3) }}>
          <span>{copy(language, 'Potentially recognizable', '可能可识别')}</span>
        </div>
      )}
      <div className="camera-hud">
        <span>{copy(language, 'GIMBAL', '云台')} {sample.gimbal.toFixed(0)}°</span>
        <span>{copy(language, 'EST.', '估计')} {Math.round(sample.distance)} m</span>
        <span>{copy(language, 'SIMULATION', '模拟')}</span>
      </div>
    </article>
  );
}

function ExposurePlot({ time, prediction, language }: { time: number; prediction: number; language: StudyLanguage }) {
  const points = Array.from({ length: 73 }, (_, index) => sampleTimeline(index / 2));
  const path = (key: 'audibility' | 'exposure') => points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${(point.time / DURATION_SECONDS) * 100} ${34 - point[key] * 28}`)
    .join(' ');
  return (
    <div className="exposure-plot" aria-label={copy(language, 'Sound and exposure timeline', '声音与暴露时间轴')}>
      <svg viewBox="0 0 100 38" preserveAspectRatio="none" role="img">
        <path className="sound-line" d={path('audibility')} />
        <path className="exposure-line" d={path('exposure')} />
        <line className="plot-cursor" x1={(time / DURATION_SECONDS) * 100} x2={(time / DURATION_SECONDS) * 100} y1="2" y2="36" />
        <line className="prediction-line" x1={(prediction / DURATION_SECONDS) * 100} x2={(prediction / DURATION_SECONDS) * 100} y1="2" y2="36" />
      </svg>
      <div className="plot-legend">
        <span className="sound">{copy(language, 'Sound', '声音')}</span>
        <span className="exposure">{copy(language, 'Estimated visual exposure', '估计视觉暴露')}</span>
        <span className="prediction">{copy(language, 'Your estimate', '你的判断')}</span>
      </div>
    </div>
  );
}

function MetricBar({ label, value, color }: { label: string; value: number; color: string }) {
  return <div className="metric-bar"><span>{label}</span><i><b style={{ width: `${value * 100}%`, background: color }} /></i><strong>{Math.round(value * 100)}</strong></div>;
}

function SoundIcon({ muted }: { muted: boolean }) {
  return <span aria-hidden="true" className="sound-icon">{muted ? '×' : '∿'}</span>;
}

function copy(language: StudyLanguage, english: string, chinese: string) {
  return language === 'zh' ? chinese : english;
}

function sampleTimeline(time: number): TimelineSample {
  const progress = Math.max(0, Math.min(1, time / DURATION_SECONDS));
  const distance = 32 + Math.abs(progress - 0.47) * 180;
  const audibility = clamp(0.08 + gaussian(time, 16.8, 5.5) * 0.92);
  const exposure = clamp(gaussian(time, EXPOSURE_PEAK_TIME, 3.6) * 0.96 + gaussian(time, 11.5, 2.8) * 0.12);
  return {
    time,
    x: 9 + progress * 82,
    y: 29 - Math.sin(progress * Math.PI) * 9,
    distance,
    audibility,
    exposure,
    gimbal: -18 - exposure * 44,
  };
}

function gaussian(value: number, center: number, spread: number) {
  return Math.exp(-0.5 * ((value - center) / spread) ** 2);
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

function formatTime(seconds: number) {
  return `00:${Math.round(seconds).toString().padStart(2, '0')}`;
}

const EXPOSURE_PEAK_TIME = 25.5;

class DroneAudio {
  private context: AudioContext;
  private gain: GainNode;
  private oscillators: OscillatorNode[];

  constructor() {
    this.context = new AudioContext();
    this.gain = this.context.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(this.context.destination);
    this.oscillators = [72, 144, 216].map((frequency, index) => {
      const oscillator = this.context.createOscillator();
      const partialGain = this.context.createGain();
      oscillator.type = index === 0 ? 'sawtooth' : 'triangle';
      oscillator.frequency.value = frequency;
      partialGain.gain.value = [0.65, 0.2, 0.1][index];
      oscillator.connect(partialGain).connect(this.gain);
      oscillator.start();
      return oscillator;
    });
  }

  async resume() {
    if (this.context.state === 'suspended') await this.context.resume();
  }

  setLevel(level: number) {
    const safeLevel = Math.max(0, Math.min(0.055, level * 0.055));
    this.gain.gain.setTargetAtTime(safeLevel, this.context.currentTime, 0.08);
  }

  dispose() {
    this.oscillators.forEach((oscillator) => oscillator.stop());
    void this.context.close();
  }
}
