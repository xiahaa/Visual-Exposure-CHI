import { ArrowRight, Check, Clapperboard, Clipboard, FlaskConical, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { loadScenario } from './api';
import type { DisclosureCondition, EventProfileId } from './eventProfiles';
import { EVENT_PROFILES } from './eventProfiles';
import { buildStudyUrl } from './studySession';
import type { CameraProfile, StudyCondition, StudyLanguage } from './types';

export function StudySetup() {
  const [participantId, setParticipantId] = useState('P001');
  const [sessionId, setSessionId] = useState(() => createSessionId());
  const [condition, setCondition] = useState<StudyCondition>('visual_exposure');
  const [language, setLanguage] = useState<StudyLanguage>('en');
  const [cameraProfileId, setCameraProfileId] = useState('inspection_balanced');
  const [eventProfileId, setEventProfileId] = useState<EventProfileId>('A');
  const [disclosureCondition, setDisclosureCondition] = useState<DisclosureCondition>('V');
  const [profiles, setProfiles] = useState<CameraProfile[]>([]);
  const [copied, setCopied] = useState<'warmup' | 'study' | null>(null);

  useEffect(() => {
    loadScenario().then((scenario) => {
      setProfiles(scenario.camera_profiles);
      setCameraProfileId(scenario.default_camera_profile_id);
    }).catch(() => setProfiles([]));
  }, []);

  const session = useMemo(() => ({
    condition,
    language,
    participantId,
    sessionId,
    scenarioId: 'hong_kong_mong_kok_01',
    cameraProfileId,
  }), [cameraProfileId, condition, language, participantId, sessionId]);
  const warmupUrl = buildStudyUrl(window.location.origin, session, '/warmup');
  const studyUrl = buildStudyUrl(window.location.origin, session, '/');
  const runnerUrl = buildRunnerUrl(window.location.origin, {
    participantId,
    sessionId,
    language,
    profile: eventProfileId,
    disclosure: disclosureCondition,
  });

  const copy = async (kind: 'warmup' | 'study', value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1400);
  };

  return (
    <main className="setup-shell">
      <header className="setup-header">
        <div className="setup-mark"><FlaskConical size={20} /></div>
        <div>
          <p>Facilitator workspace</p>
          <h1>Prepare a controlled study session</h1>
          <span>Configure once, then hand the participant a locked experience.</span>
        </div>
      </header>

      <section className="setup-grid">
        <div className="setup-form">
          <div className="setup-section-title"><span>01</span><div><strong>Session identity</strong><small>Used in every exported event.</small></div></div>
          <div className="setup-field-grid">
            <label><span>Participant ID</span><input value={participantId} onChange={(event) => setParticipantId(event.target.value)} /></label>
            <label><span>Session ID</span><div className="setup-input-action"><input value={sessionId} onChange={(event) => setSessionId(event.target.value)} /><button title="Generate new session ID" aria-label="Generate new session ID" onClick={() => setSessionId(createSessionId())}><RefreshCw size={15} /></button></div></label>
          </div>

          <div className="setup-section-title"><span>02</span><div><strong>Study condition</strong><small>The participant cannot switch this condition.</small></div></div>
          <div className="setup-choice-grid three">
            {([
              ['basic_notice', 'C1', 'Basic notice'],
              ['camera_footprint', 'C2', 'Route + footprint'],
              ['visual_exposure', 'C3', 'Visual exposure'],
            ] as const).map(([value, code, label]) => (
              <button key={value} className={condition === value ? 'selected' : ''} onClick={() => setCondition(value)}>
                <small>{code}</small><strong>{label}</strong>{condition === value && <Check size={15} />}
              </button>
            ))}
          </div>

          <div className="setup-section-title"><span>03</span><div><strong>Language and camera</strong><small>Both remain fixed for the participant.</small></div></div>
          <div className="setup-field-grid">
            <label><span>Session language</span><select value={language} onChange={(event) => setLanguage(event.target.value as StudyLanguage)}><option value="en">English</option><option value="zh">中文</option></select></label>
            <label><span>Camera profile</span><select value={cameraProfileId} onChange={(event) => setCameraProfileId(event.target.value)}>{profiles.length ? profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>) : <option value="inspection_balanced">Balanced Inspection</option>}</select></label>
          </div>

          <div className="setup-section-title main-study-title"><span>04</span><div><strong>Main-study media cell</strong><small>Choose one of four event profiles and one disclosure renderer.</small></div></div>
          <div className="event-profile-grid" aria-label="Event profile">
            {(Object.values(EVENT_PROFILES)).map((profile) => (
              <button
                key={profile.id}
                className={eventProfileId === profile.id ? 'selected' : ''}
                type="button"
                onClick={() => setEventProfileId(profile.id)}
                aria-label={`Profile ${profile.id} ${profile.code}`}
              >
                <span>{profile.id}</span>
                <div><strong>{profile.code}</strong><small>{profile.trajectoryId === 'slow_offset' ? 'Slow · camera offset' : 'Fast · target tracking'}</small></div>
                <i className={profile.uavAppearance}>{profile.uavAppearance === 'police' ? 'POLICE' : 'CIVIL'}</i>
                {eventProfileId === profile.id && <Check size={15} />}
              </button>
            ))}
          </div>
          <div className="disclosure-choice" aria-label="Disclosure condition">
            {([['M', 'Notice'], ['S', 'Structured facts'], ['V', 'Interactive VEP']] as const).map(([value, label]) => (
              <button key={value} type="button" className={disclosureCondition === value ? 'selected' : ''} onClick={() => setDisclosureCondition(value)}>
                <span>{value}</span><strong>{label}</strong>
              </button>
            ))}
          </div>
        </div>

        <aside className="setup-launch">
          <p className="setup-kicker">Ready to launch</p>
          <h2>{participantId || 'Participant'}</h2>
          <div className="runner-launch-summary">
            <div><Clapperboard size={18} /><span>Main-study runner</span></div>
            <strong>Profile {eventProfileId} · {EVENT_PROFILES[eventProfileId].code}</strong>
            <p>{EVENT_PROFILES[eventProfileId].title.en}</p>
            <span>{disclosureCondition === 'M' ? 'M Notice' : disclosureCondition === 'S' ? 'S Structured Facts' : 'V Interactive VEP'} · {language === 'zh' ? '中文' : 'English'}</span>
          </div>
          <a className="setup-primary runner-launch" href={runnerUrl}>Open event runner <ArrowRight size={17} /></a>
          <div className="setup-pair-proof"><Check size={14} /><span>{eventProfileId === 'A' || eventProfileId === 'B' ? 'A/B use identical flight geometry' : 'C/D use identical flight geometry'}</span></div>

          <div className="legacy-setup-divider"><span>Legacy calibration tools</span></div>
          <div className="setup-summary"><span>{condition === 'basic_notice' ? 'C1 Basic Notice' : condition === 'camera_footprint' ? 'C2 Route + Footprint' : 'C3 Visual Exposure'}</span><span>{language === 'zh' ? '中文' : 'English'}</span><span>{cameraProfileId.replaceAll('_', ' ')}</span></div>
          <div className="launch-link"><div><small>Start with calibration</small><strong>/warmup</strong></div><button title="Copy warm-up URL" aria-label="Copy warm-up URL" onClick={() => void copy('warmup', warmupUrl)}>{copied === 'warmup' ? <Check size={16} /> : <Clipboard size={16} />}</button></div>
          <a className="setup-primary" href={warmupUrl}>Open participant warm-up <ArrowRight size={17} /></a>
          <div className="launch-link"><div><small>Skip calibration</small><strong>Direct study link</strong></div><button title="Copy study URL" aria-label="Copy study URL" onClick={() => void copy('study', studyUrl)}>{copied === 'study' ? <Check size={16} /> : <Clipboard size={16} />}</button></div>
          <a className="setup-secondary" href={studyUrl}>Open study directly</a>
          <p className="setup-note">The facilitator setup is not included in the participant study log.</p>
        </aside>
      </section>
    </main>
  );
}

function createSessionId(): string {
  return `S-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
}

function buildRunnerUrl(origin: string, options: {
  participantId: string;
  sessionId: string;
  language: StudyLanguage;
  profile: EventProfileId;
  disclosure: DisclosureCondition;
}) {
  const url = new URL('/runner', origin);
  url.searchParams.set('profile', options.profile);
  url.searchParams.set('disclosure', options.disclosure);
  url.searchParams.set('lang', options.language);
  url.searchParams.set('participant_id', options.participantId);
  url.searchParams.set('session_id', options.sessionId);
  return url.toString();
}
