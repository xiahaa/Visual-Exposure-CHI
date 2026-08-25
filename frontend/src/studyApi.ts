import type { DisclosureCondition, EventProfileId } from './eventProfiles';
import type { StudyLanguage } from './types';
import { z } from 'zod';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL
  ?? (import.meta.env.DEV ? 'http://127.0.0.1:8011' : '');

export type AssignedStudySession = {
  session_id: string;
  session_token?: string | null;
  profile: EventProfileId;
  disclosure_condition: DisclosureCondition;
  status: 'active' | 'completed' | 'abandoned' | 'invalid';
  phase: string;
  question_config_version: string;
  completion_code?: string | null;
};

export type StudyCompletion = {
  session_id: string;
  completion_code: string;
  profile: EventProfileId;
  disclosure_condition: DisclosureCondition;
  completed_at: string;
};

export type StudyEvent = {
  event_id: string;
  seq: number;
  event_type: string;
  phase: string;
  payload: Record<string, unknown>;
  client_timestamp: string;
};

const studySessionSchema = z.object({
  session_id: z.string().min(1),
  session_token: z.string().min(1).nullable().optional(),
  profile: z.enum(['A', 'B', 'C', 'D']),
  disclosure_condition: z.enum(['M', 'S', 'V']),
  status: z.enum(['active', 'completed', 'abandoned', 'invalid']),
  phase: z.string().min(1),
  question_config_version: z.string().min(1),
  completion_code: z.string().min(1).nullable().optional(),
});

const studyCompletionSchema = z.object({
  session_id: z.string().min(1),
  completion_code: z.string().min(1),
  profile: z.enum(['A', 'B', 'C', 'D']),
  disclosure_condition: z.enum(['M', 'S', 'V']),
  completed_at: z.string().min(1),
});

const eventBatchResponseSchema = z.object({
  accepted: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
  last_seq: z.number().int(),
});

export async function launchStudy(options: {
  clientNonce: string;
  entryToken?: string;
  language: StudyLanguage;
}): Promise<AssignedStudySession> {
  return studySessionSchema.parse(await requestJson('/api/study/launch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_nonce: options.clientNonce,
      entry_token: options.entryToken || undefined,
      language: options.language,
    }),
  })) as AssignedStudySession;
}

export async function confirmStudyStart(sessionToken: string): Promise<AssignedStudySession> {
  return studySessionSchema.parse(
    await requestJson('/api/study/confirm-start', studyTokenRequest(sessionToken, 'POST')),
  ) as AssignedStudySession;
}

export async function updateStudyPhase(
  sessionToken: string,
  phase: string,
): Promise<AssignedStudySession> {
  return studySessionSchema.parse(await requestJson('/api/study/state', {
    method: 'POST',
    headers: studyHeaders(sessionToken, true),
    body: JSON.stringify({ phase }),
  })) as AssignedStudySession;
}

export async function appendStudyEvents(
  sessionToken: string,
  events: StudyEvent[],
): Promise<{ accepted: number; duplicates: number; last_seq: number }> {
  return eventBatchResponseSchema.parse(await requestJson('/api/study/events', {
    method: 'POST',
    headers: studyHeaders(sessionToken, true),
    body: JSON.stringify({ events }),
  }));
}

export async function completeStudy(sessionToken: string): Promise<StudyCompletion> {
  return studyCompletionSchema.parse(
    await requestJson('/api/study/complete', studyTokenRequest(sessionToken, 'POST')),
  ) as StudyCompletion;
}

export function createStudyEvent(
  seq: number,
  eventType: string,
  phase: string,
  payload: Record<string, unknown> = {},
): StudyEvent {
  return {
    event_id: crypto.randomUUID(),
    seq,
    event_type: eventType,
    phase,
    payload,
    client_timestamp: new Date().toISOString(),
  };
}

export function getOrCreateClientNonce(): string {
  const storageKey = 'vep-study-client-nonce-v1';
  try {
    const existing = window.localStorage.getItem(storageKey);
    if (existing) return existing;
    const nonce = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
    window.localStorage.setItem(storageKey, nonce);
    return nonce;
  } catch {
    return `${crypto.randomUUID()}-${crypto.randomUUID()}`;
  }
}

function studyHeaders(sessionToken: string, json = false): HeadersInit {
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    'X-Study-Token': sessionToken,
  };
}

function studyTokenRequest(sessionToken: string, method: string): RequestInit {
  return { method, headers: studyHeaders(sessionToken) };
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, init);
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { detail?: string } | null;
    throw new Error(payload?.detail || `Study service request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}
