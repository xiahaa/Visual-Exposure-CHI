import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventStudyRunner } from './EventStudyRunner';

vi.mock('./EventMediaScene', () => ({
  EventMediaScene: ({ mode, profile, reveal }: { mode: string; profile: { id: string }; reveal: boolean }) => (
    <div data-testid={`scene-${mode}`} data-profile={profile.id} data-reveal={String(reveal)} />
  ),
}));

describe('EventStudyRunner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
    window.history.pushState({}, '', '/runner?role=facilitator&profile=C&disclosure=V&lang=en&participant_id=P011&session_id=S011');
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('locks the initial dual view and then reveals synchronized triple-view evidence', async () => {
    render(<EventStudyRunner />);
    expect(screen.getByText('Study material ready')).toBeInTheDocument();
    expect(screen.getByText('P011')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /I am ready/ }));
    expect(screen.getByText('Please pay attention')).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTime(3100));

    expect(screen.getByText('One-time presentation · playback locked')).toBeInTheDocument();
    expect(screen.getByTestId('scene-external')).toBeInTheDocument();
    expect(screen.getByTestId('scene-resident')).toBeInTheDocument();
    expect(screen.queryByTestId('scene-camera')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Synchronized event timeline')).not.toBeInTheDocument();

    await act(async () => vi.advanceTimersByTime(24_200));
    expect(screen.getByText('Evidence disclosure')).toBeInTheDocument();
    expect(screen.getByTestId('scene-camera')).toHaveAttribute('data-profile', 'C');
    expect(screen.getByLabelText('Synchronized event timeline')).toBeInTheDocument();
    expect(screen.getByText('Audited in-view interval')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Synchronized event timeline'), { target: { value: '12' } });
    expect(screen.getByText('Resident in effective view')).toBeInTheDocument();
  });

  it('shows only a notice after the one-time media for condition M', async () => {
    window.history.pushState({}, '', '/runner?role=facilitator&profile=B&disclosure=M&lang=zh');
    render(<EventStudyRunner />);
    fireEvent.click(screen.getByRole('button', { name: '我已准备好' }));
    await act(async () => vi.advanceTimersByTime(3100));
    await act(async () => vi.advanceTimersByTime(24_200));

    expect(screen.getByText('飞行通知')).toBeInTheDocument();
    expect(screen.queryByLabelText('同步事件时间轴')).not.toBeInTheDocument();
    expect(screen.queryByTestId('scene-camera')).not.toBeInTheDocument();
  });

  it('gives only V disclosure the interactive evidence controls', async () => {
    window.history.pushState({}, '', '/runner?role=facilitator&profile=C&disclosure=V&lang=en&preview=disclosure');
    const { unmount } = render(<EventStudyRunner />);

    expect(screen.getByRole('button', { name: 'Follow UAV' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Explore scene' })).toBeInTheDocument();
    expect(screen.getByLabelText('Camera frustum')).toBeChecked();
    expect(screen.getByLabelText('Physical clarity')).toBeChecked();
    expect(screen.getByLabelText('Synchronized event timeline')).toBeInTheDocument();
    expect(screen.getByText('Not a privacy score')).toBeInTheDocument();
    unmount();

    window.history.pushState({}, '', '/runner?role=facilitator&profile=C&disclosure=S&lang=en&preview=disclosure');
    render(<EventStudyRunner />);
    expect(screen.queryByRole('button', { name: 'Explore scene' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Camera frustum')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Physical clarity')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Synchronized event timeline')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Standard animation progress')).toBeInTheDocument();
    expect(screen.queryByText('Audited in-view interval')).not.toBeInTheDocument();
  });

  it('updates V evidence controls without changing the study condition', async () => {
    window.history.pushState({}, '', '/runner?role=facilitator&profile=A&disclosure=V&lang=zh&preview=disclosure');
    render(<EventStudyRunner />);

    fireEvent.click(screen.getByRole('button', { name: '自由观察' }));
    expect(screen.getByRole('button', { name: '自由观察' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByLabelText('相机视锥'));
    fireEvent.click(screen.getByLabelText('物理清晰度'));
    expect(screen.getByLabelText('相机视锥')).not.toBeChecked();
    expect(screen.getByLabelText('物理清晰度')).not.toBeChecked();
    expect(screen.getByText('交互式 VEP')).toBeInTheDocument();
  });

  it('uses the server-assigned cell and issues a questionnaire completion code', async () => {
    window.history.pushState({}, '', '/runner?profile=A&disclosure=M&lang=en&entry_token=survey-entry-77');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/study/launch')) {
        return jsonResponse({
          session_id: 'server-session-77',
          session_token: 'signed-session-token',
          profile: 'D',
          disclosure_condition: 'S',
          status: 'active',
          phase: 'assignment_locked',
          question_config_version: 'main-study-draft-v1',
          completion_code: null,
        });
      }
      if (url.endsWith('/api/study/complete')) {
        return jsonResponse({
          session_id: 'server-session-77',
          completion_code: 'VEP-ABCD2345',
          profile: 'D',
          disclosure_condition: 'S',
          completed_at: '2026-08-25T00:00:00Z',
        });
      }
      if (url.endsWith('/api/study/events')) {
        return jsonResponse({ accepted: 3, duplicates: 0, last_seq: 3 });
      }
      return jsonResponse({
        session_id: 'server-session-77',
        profile: 'D',
        disclosure_condition: 'S',
        status: 'active',
        phase: 'attention_prompt_3s',
        question_config_version: 'main-study-draft-v1',
      });
    });

    render(<EventStudyRunner />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByText('server-session-77')).toBeInTheDocument();
    expect(screen.getByText('Anonymous')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /I am ready/ }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => vi.advanceTimersByTime(3100));
    await act(async () => vi.advanceTimersByTime(24_200));
    expect(screen.getByText('Structured facts')).toBeInTheDocument();
    expect(screen.getByTestId('scene-camera')).toHaveAttribute('data-profile', 'D');

    fireEvent.click(screen.getByRole('button', { name: /Finish review/ }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByText('VEP-ABCD2345')).toBeInTheDocument();
  });
});

function jsonResponse(data: unknown): Response {
  return { ok: true, status: 200, statusText: 'OK', json: async () => data } as Response;
}
