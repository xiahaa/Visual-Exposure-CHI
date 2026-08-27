import { Pause, Play, ScanLine } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { PoseEvidence, StudyLanguage } from './types';

export function ExposureTimeline({
  profile,
  selectedIndex,
  playing,
  language,
  onSelect,
  onTogglePlay,
}: {
  profile: PoseEvidence[];
  selectedIndex: number;
  playing: boolean;
  language: StudyLanguage;
  onSelect: (index: number) => void;
  onTogglePlay: () => void;
}) {
  if (!profile.length) return null;
  const maxExposure = Math.max(1, ...profile.map((pose) => pose.total_exposure));
  const width = 760;
  const height = 86;
  const totalPath = chartPath(profile.map((pose) => pose.total_exposure), maxExposure, width, height);
  const sensitivePath = chartPath(profile.map((pose) => pose.sensitive_exposure), maxExposure, width, height);
  const markerX = profile.length === 1 ? 0 : (selectedIndex / (profile.length - 1)) * width;
  const selected = profile[selectedIndex] ?? profile[0];
  const scrubProgress = profile.length === 1 ? 0 : (selectedIndex / (profile.length - 1)) * 100;
  const scrubberStyle = { '--scrub-progress': `${scrubProgress}%` } as CSSProperties;

  return (
    <section className="exposure-timeline" aria-label={language === 'zh' ? '航线暴露剖面' : 'Route exposure profile'}>
      <div className="timeline-heading">
        <div><ScanLine size={17} /><span><strong>{language === 'zh' ? '航线暴露剖面' : 'Route exposure profile'}</strong><small>{language === 'zh' ? '拖动以检查不同飞行位置' : 'Scrub to inspect each flight position'}</small></span></div>
        <div className="timeline-readout"><strong>{Math.round(selected.distance_along_route_m)} m</strong><span>{formatValue(selected.total_exposure)} {language === 'zh' ? '暴露' : 'exposure'}</span></div>
      </div>
      <div className="timeline-chart">
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
          <path className="profile-area" d={`${totalPath} L ${width} ${height} L 0 ${height} Z`} />
          <path className="profile-total" d={totalPath} />
          <path className="profile-sensitive" d={sensitivePath} />
          <line className="profile-marker" x1={markerX} x2={markerX} y1="0" y2={height} />
        </svg>
        <input
          className="timeline-scrubber"
          aria-label={language === 'zh' ? '选中航线位置' : 'Selected route pose'}
          aria-valuetext={`${Math.round(selected.distance_along_route_m)} m, ${selected.visible_surface_count} ${language === 'zh' ? '个可见表面' : 'visible surfaces'}`}
          type="range"
          min="0"
          max={profile.length - 1}
          step="1"
          value={selectedIndex}
          style={scrubberStyle}
          onChange={(event) => onSelect(Number(event.target.value))}
        />
      </div>
      <div className="timeline-controls">
        <button className="timeline-play" type="button" onClick={onTogglePlay} aria-label={language === 'zh' ? (playing ? '暂停航线播放' : '播放航线') : (playing ? 'Pause route playback' : 'Play route playback')}>
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <div className="timeline-legend"><span><i className="total" />{language === 'zh' ? '总暴露' : 'Total exposure'}</span><span><i className="sensitive" />{language === 'zh' ? '敏感暴露' : 'Sensitive exposure'}</span></div>
        <span className="timeline-position">
          <strong>{selected.visible_surface_count}</strong>
          <small>{language === 'zh' ? 'first-hit 表面' : 'first-hit surfaces'}</small>
          <em>{selectedIndex + 1} / {profile.length}</em>
        </span>
      </div>
    </section>
  );
}

function chartPath(values: number[], maxValue: number, width: number, height: number): string {
  return values.map((value, index) => {
    const x = values.length === 1 ? 0 : (index / (values.length - 1)) * width;
    const y = height - (value / maxValue) * (height - 8) - 4;
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ');
}

function formatValue(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}
