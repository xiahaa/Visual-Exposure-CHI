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
    window.history.pushState({}, '', '/runner?profile=C&disclosure=V&lang=en&participant_id=P011&session_id=S011');
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
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
    window.history.pushState({}, '', '/runner?profile=B&disclosure=M&lang=zh');
    render(<EventStudyRunner />);
    fireEvent.click(screen.getByRole('button', { name: '我已准备好' }));
    await act(async () => vi.advanceTimersByTime(3100));
    await act(async () => vi.advanceTimersByTime(24_200));

    expect(screen.getByText('飞行通知')).toBeInTheDocument();
    expect(screen.queryByLabelText('同步事件时间轴')).not.toBeInTheDocument();
    expect(screen.queryByTestId('scene-camera')).not.toBeInTheDocument();
  });
});
