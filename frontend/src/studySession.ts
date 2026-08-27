import type { StudyCondition, StudyLanguage, StudyRole } from './types';

export type StudySession = {
  role: StudyRole;
  condition: StudyCondition;
  language: StudyLanguage;
  participantId: string;
  sessionId: string;
  scenarioId: string;
  cameraProfileId: string;
};

const CONDITION_ALIASES: Record<string, StudyCondition> = {
  c1: 'basic_notice',
  basic_notice: 'basic_notice',
  c2: 'camera_footprint',
  camera_footprint: 'camera_footprint',
  c3: 'visual_exposure',
  visual_exposure: 'visual_exposure',
};

export function readStudySession(search = window.location.search): StudySession {
  const params = new URLSearchParams(search);
  const rawCondition = params.get('condition')?.toLowerCase() ?? 'c3';
  return {
    role: params.get('role') === 'facilitator' ? 'facilitator' : 'participant',
    condition: CONDITION_ALIASES[rawCondition] ?? 'visual_exposure',
    language: params.get('lang') === 'zh' ? 'zh' : 'en',
    participantId: cleanIdentifier(params.get('participant_id')) || 'pilot',
    sessionId: cleanIdentifier(params.get('session_id')) || `local-${Date.now()}`,
    scenarioId: cleanIdentifier(params.get('scenario')) || 'hong_kong_mong_kok_01',
    cameraProfileId: cleanIdentifier(params.get('camera')) || 'inspection_balanced',
  };
}

export function buildStudyUrl(
  origin: string,
  session: Omit<StudySession, 'role'>,
  path = '/',
): string {
  const url = new URL(path, origin);
  url.searchParams.set('condition', conditionAlias(session.condition));
  url.searchParams.set('lang', session.language);
  url.searchParams.set('participant_id', session.participantId);
  url.searchParams.set('session_id', session.sessionId);
  url.searchParams.set('scenario', session.scenarioId);
  url.searchParams.set('camera', session.cameraProfileId);
  return url.toString();
}

export function logStorageKey(session: Pick<StudySession, 'sessionId'>): string {
  return `chi-study-log-v2:${session.sessionId}`;
}

export function conditionAlias(condition: StudyCondition): 'c1' | 'c2' | 'c3' {
  if (condition === 'basic_notice') return 'c1';
  if (condition === 'camera_footprint') return 'c2';
  return 'c3';
}

function cleanIdentifier(value: string | null): string {
  return value?.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) ?? '';
}
