import {
  ArrowRight,
  Check,
  Clapperboard,
  Clipboard,
  Download,
  FlaskConical,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  Upload,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { loadScenario } from './api';
import type { DisclosureCondition, EventProfileId } from './eventProfiles';
import { EVENT_PROFILES } from './eventProfiles';
import {
  MATRIX_CITY_CONFIG_LIMITS,
  createDefaultMatrixCityFlightConfig,
  encodeMatrixCityFlightConfig,
  matrixCityFlightConfigSchema,
  type MatrixCityFlightConfig,
} from './matrixCityFlightConfig';
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
  const [customFlightEnabled, setCustomFlightEnabled] = useState(false);
  const [flightConfig, setFlightConfig] = useState<MatrixCityFlightConfig>(
    () => createDefaultMatrixCityFlightConfig(EVENT_PROFILES.A.trajectoryId),
  );
  const [flightImportError, setFlightImportError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<CameraProfile[]>([]);
  const [copied, setCopied] = useState<'warmup' | 'study' | null>(null);

  useEffect(() => {
    loadScenario().then((scenario) => {
      setProfiles(scenario.camera_profiles);
      setCameraProfileId(scenario.default_camera_profile_id);
    }).catch(() => setProfiles([]));
  }, []);

  useEffect(() => {
    setFlightConfig(createDefaultMatrixCityFlightConfig(EVENT_PROFILES[eventProfileId].trajectoryId));
    setFlightImportError(null);
  }, [eventProfileId]);

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
  const runnerUrl = buildAssignedRunnerUrl(window.location.origin, {
    entryToken: sessionId,
    language,
  });
  const flightValidation = useMemo(
    () => matrixCityFlightConfigSchema.safeParse(flightConfig),
    [flightConfig],
  );
  const flightValidationError = flightValidation.success
    ? null
    : flightValidation.error.issues[0]?.message ?? 'Invalid MatrixCity flight configuration.';
  const runnerPreviewUrl = buildRunnerPreviewUrl(window.location.origin, {
    profile: eventProfileId,
    disclosure: disclosureCondition,
    language,
    flightConfig: customFlightEnabled && flightValidation.success
      ? flightValidation.data
      : undefined,
  });

  const copy = async (kind: 'warmup' | 'study', value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1400);
  };

  const updateFlightPoint = (
    key: keyof MatrixCityFlightConfig['trajectory'],
    axis: 0 | 1 | 2,
    value: number,
  ) => {
    setFlightConfig((current) => {
      const point = [...current.trajectory[key]] as [number, number, number];
      point[axis] = value;
      return {
        ...current,
        trajectory: { ...current.trajectory, [key]: point },
      };
    });
  };

  const updateCamera = (
    key: keyof MatrixCityFlightConfig['camera'],
    value: number,
  ) => {
    setFlightConfig((current) => ({
      ...current,
      camera: { ...current.camera, [key]: value },
    }));
  };

  const resetFlightConfig = () => {
    setFlightConfig(createDefaultMatrixCityFlightConfig(EVENT_PROFILES[eventProfileId].trajectoryId));
    setFlightImportError(null);
  };

  const importFlightConfig = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = matrixCityFlightConfigSchema.parse(JSON.parse(await file.text()));
      setFlightConfig(parsed);
      setCustomFlightEnabled(true);
      setFlightImportError(null);
    } catch (reason) {
      setFlightImportError(reason instanceof Error ? reason.message : 'The JSON configuration is invalid.');
    }
  };

  const downloadFlightConfig = () => {
    if (!flightValidation.success) return;
    const blob = new Blob([`${JSON.stringify(flightValidation.data, null, 2)}\n`], {
      type: 'application/json',
    });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `matrixcity-flight-${eventProfileId.toLowerCase()}.json`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
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

          <div className="setup-section-title flight-config-title"><span>05</span><div><strong>MatrixCity flight configuration</strong><small>Optional, validated configuration for the facilitator preview.</small></div></div>
          <section className="flight-configurator">
            <div className="flight-mode-segment" aria-label="Flight configuration mode">
              <button
                type="button"
                className={!customFlightEnabled ? 'selected' : ''}
                onClick={() => setCustomFlightEnabled(false)}
              >
                <Check size={15} /><span><strong>Study default</strong><small>Matched A/B or C/D geometry</small></span>
              </button>
              <button
                type="button"
                className={customFlightEnabled ? 'selected' : ''}
                onClick={() => setCustomFlightEnabled(true)}
              >
                <SlidersHorizontal size={15} /><span><strong>Custom preview</strong><small>Facilitator testing only</small></span>
              </button>
            </div>

            <p className="flight-control-warning">
              Custom values are embedded in the facilitator preview URL. Server-assigned participant sessions remain locked to the controlled study geometry.
            </p>

            {customFlightEnabled && (
              <>
                <details className="flight-config-guide" open>
                  <summary>How to configure this flight</summary>
                  <ol>
                    <li><strong>Place the UAV.</strong> East and North move it across the MatrixCity map; Up is altitude in metres.</li>
                    <li><strong>Set its path.</strong> The UAV interpolates from Start to End over the fixed 24-second study clip.</li>
                    <li><strong>Aim the camera.</strong> Each look-at point is a world location. Use the same start/end target to track one place, or different targets to pan the camera.</li>
                    <li><strong>Set imaging limits.</strong> HFOV controls width; resolution and distance control the physical-clarity estimate.</li>
                  </ol>
                  <p>Stay inside the hard limits shown under each field. Recommended ranges preserve the strongest part of the current 3DGS reconstruction.</p>
                </details>

                <div className="flight-config-actions">
                  <label className="flight-config-file">
                    <Upload size={15} /> Import JSON
                    <input
                      type="file"
                      accept="application/json,.json"
                      onChange={(event) => void importFlightConfig(event.target.files?.[0])}
                    />
                  </label>
                  <button type="button" onClick={downloadFlightConfig} disabled={!flightValidation.success}>
                    <Download size={15} /> Export JSON
                  </button>
                  <button type="button" onClick={resetFlightConfig}>
                    <RotateCcw size={15} /> Reset profile
                  </button>
                </div>

                <div className="flight-config-group">
                  <header><strong>UAV trajectory</strong><small>MatrixCity ENU coordinates, metres</small></header>
                  <div className="flight-point-grid">
                    <EnuPointEditor
                      label="UAV start"
                      value={flightConfig.trajectory.start_enu_m}
                      kind="drone"
                      onChange={(axis, value) => updateFlightPoint('start_enu_m', axis, value)}
                    />
                    <EnuPointEditor
                      label="UAV end"
                      value={flightConfig.trajectory.end_enu_m}
                      kind="drone"
                      onChange={(axis, value) => updateFlightPoint('end_enu_m', axis, value)}
                    />
                  </div>
                </div>

                <div className="flight-config-group">
                  <header><strong>Camera orientation</strong><small>World points that the gimbal looks toward</small></header>
                  <div className="flight-point-grid">
                    <EnuPointEditor
                      label="Look-at start"
                      value={flightConfig.trajectory.camera_target_start_enu_m}
                      kind="target"
                      onChange={(axis, value) => updateFlightPoint('camera_target_start_enu_m', axis, value)}
                    />
                    <EnuPointEditor
                      label="Look-at end"
                      value={flightConfig.trajectory.camera_target_end_enu_m}
                      kind="target"
                      onChange={(axis, value) => updateFlightPoint('camera_target_end_enu_m', axis, value)}
                    />
                  </div>
                </div>

                <div className="flight-config-group">
                  <header><strong>Camera model</strong><small>Used by the live view, frustum and clarity overlay</small></header>
                  <div className="camera-config-grid">
                    <CameraNumberField label="Horizontal FOV" unit="deg" value={flightConfig.camera.hfov_deg} limits={MATRIX_CITY_CONFIG_LIMITS.camera.hfov_deg} onChange={(value) => updateCamera('hfov_deg', value)} />
                    <CameraNumberField label="Image width" unit="px" value={flightConfig.camera.image_width_px} limits={MATRIX_CITY_CONFIG_LIMITS.camera.image_width_px} integer onChange={(value) => updateCamera('image_width_px', value)} />
                    <CameraNumberField label="Image height" unit="px" value={flightConfig.camera.image_height_px} limits={MATRIX_CITY_CONFIG_LIMITS.camera.image_height_px} integer onChange={(value) => updateCamera('image_height_px', value)} />
                    <CameraNumberField label="Minimum depth" unit="m" value={flightConfig.camera.min_depth_m} limits={MATRIX_CITY_CONFIG_LIMITS.camera.min_depth_m} onChange={(value) => updateCamera('min_depth_m', value)} />
                    <CameraNumberField label="Maximum depth" unit="m" value={flightConfig.camera.max_depth_m} limits={MATRIX_CITY_CONFIG_LIMITS.camera.max_depth_m} onChange={(value) => updateCamera('max_depth_m', value)} />
                  </div>
                </div>

                <div className={`flight-config-validation ${flightValidationError || flightImportError ? 'error' : 'valid'}`}>
                  {flightImportError || flightValidationError || 'Configuration valid. The preview URL is ready.'}
                </div>
              </>
            )}
          </section>
        </div>

        <aside className="setup-launch">
          <p className="setup-kicker">Ready to launch</p>
          <h2>{participantId || 'Participant'}</h2>
          <div className="runner-launch-summary">
            <div><Clapperboard size={18} /><span>Server-assigned main study</span></div>
            <strong>Balanced anonymous allocation</strong>
            <p>The backend assigns one available profile and disclosure cell, then issues a completion code.</p>
            <span>{language === 'zh' ? '中文' : 'English'} · Entry token {sessionId}</span>
          </div>
          <a className="setup-primary runner-launch" href={runnerUrl}>Open assigned study <ArrowRight size={17} /></a>

          <div className="runner-launch-summary preview-summary">
            <div><Clapperboard size={18} /><span>Facilitator preview</span></div>
            <strong>Profile {eventProfileId} · {EVENT_PROFILES[eventProfileId].code}</strong>
            <p>{EVENT_PROFILES[eventProfileId].title.en}</p>
            <span>{disclosureCondition === 'M' ? 'M Notice' : disclosureCondition === 'S' ? 'S Structured Facts' : 'V Interactive VEP'} · no study record</span>
          </div>
          {customFlightEnabled && !flightValidation.success ? (
            <button className="setup-secondary disabled" type="button" disabled>Fix flight configuration to preview</button>
          ) : (
            <a className="setup-secondary" href={runnerPreviewUrl}>Preview selected cell</a>
          )}
          {customFlightEnabled && flightValidation.success && <div className="setup-pair-proof"><SlidersHorizontal size={14} /><span>Validated custom MatrixCity flight embedded in this preview</span></div>}
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

function EnuPointEditor({
  label,
  value,
  kind,
  onChange,
}: {
  label: string;
  value: [number, number, number];
  kind: 'drone' | 'target';
  onChange: (axis: 0 | 1 | 2, value: number) => void;
}) {
  const limits = MATRIX_CITY_CONFIG_LIMITS[kind];
  const fields = [
    { axis: 0 as const, code: 'E', name: 'East', limits: limits.east_m },
    { axis: 1 as const, code: 'N', name: 'North', limits: limits.north_m },
    { axis: 2 as const, code: 'U', name: 'Up', limits: limits.altitude_m },
  ];
  return (
    <fieldset className="enu-point-editor">
      <legend>{label}</legend>
      <div>
        {fields.map((field) => (
          <label key={field.code}>
            <span><b>{field.code}</b>{field.name}</span>
            <div className="flight-number-input">
              <input
                aria-label={`${label} ${field.name}`}
                type="number"
                min={field.limits.min}
                max={field.limits.max}
                step="0.5"
                value={value[field.axis]}
                onChange={(event) => {
                  onChange(
                    field.axis,
                    Number.isFinite(event.currentTarget.valueAsNumber)
                      ? event.currentTarget.valueAsNumber
                      : 0,
                  );
                }}
              />
              <span>m</span>
            </div>
            <small>
              Hard {field.limits.min}-{field.limits.max} · Recommended {field.limits.recommended}
            </small>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function CameraNumberField({
  label,
  unit,
  value,
  limits,
  integer = false,
  onChange,
}: {
  label: string;
  unit: string;
  value: number;
  limits: { min: number; max: number; recommended: string };
  integer?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="camera-number-field">
      <span>{label}</span>
      <div className="flight-number-input">
        <input
          aria-label={label}
          type="number"
          min={limits.min}
          max={limits.max}
          step={integer ? 1 : 0.5}
          value={value}
          onChange={(event) => {
            const next = Number.isFinite(event.currentTarget.valueAsNumber)
              ? event.currentTarget.valueAsNumber
              : 0;
            onChange(integer ? Math.round(next) : next);
          }}
        />
        <span>{unit}</span>
      </div>
      <small>Hard {limits.min}-{limits.max} · Recommended {limits.recommended}</small>
    </label>
  );
}

function createSessionId(): string {
  return `S-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
}

function buildAssignedRunnerUrl(origin: string, options: {
  entryToken: string;
  language: StudyLanguage;
}) {
  const url = new URL('/runner', origin);
  url.searchParams.set('lang', options.language);
  url.searchParams.set('entry_token', options.entryToken);
  return url.toString();
}

function buildRunnerPreviewUrl(origin: string, options: {
  profile: EventProfileId;
  disclosure: DisclosureCondition;
  language: StudyLanguage;
  flightConfig?: MatrixCityFlightConfig;
}) {
  const url = new URL('/runner', origin);
  url.searchParams.set('role', 'facilitator');
  url.searchParams.set('preview', 'disclosure');
  url.searchParams.set('profile', options.profile);
  url.searchParams.set('disclosure', options.disclosure);
  url.searchParams.set('lang', options.language);
  if (options.flightConfig) {
    url.searchParams.set('flight', encodeMatrixCityFlightConfig(options.flightConfig));
  }
  return url.toString();
}
