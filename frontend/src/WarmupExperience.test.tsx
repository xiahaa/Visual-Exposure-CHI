import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WarmupExperience, WARMUP_RESULT_STORAGE_KEY } from './WarmupExperience';

vi.mock('./EventMediaScene', () => ({
  EventMediaScene: ({ mode, flightConfig }: { mode: string; flightConfig: { trajectory: { start_enu_m: [number, number, number] } } }) => (
    <div data-testid={`warmup-gs-${mode}`} data-start-east={flightConfig.trajectory.start_enu_m[0]} />
  ),
}));

describe('WarmupExperience', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.history.pushState({}, '', '/warmup?condition=c3&lang=en&participant_id=P001&session_id=warmup-test');
  });

  it('collects a prediction before revealing the simulated camera view', async () => {
    const user = userEvent.setup();
    render(<WarmupExperience />);

    expect(screen.getByText('When a drone passes nearby, what can its camera actually see?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Sound on/ }));
    await user.click(screen.getByRole('button', { name: /Begin experience/ }));

    expect(screen.getByText('Listen first. Where do you think exposure peaks?')).toBeInTheDocument();
    expect(screen.getByTestId('warmup-gs-external')).toHaveAttribute('data-start-east', '70');
    expect(screen.getByText('Runner-matched aerial oblique view')).toBeInTheDocument();
  });

  it('stores the calibration response when the reveal begins', async () => {
    const user = userEvent.setup();
    render(<WarmupExperience />);

    await user.click(screen.getByRole('button', { name: /Sound on/ }));
    await user.click(screen.getByRole('button', { name: /Begin experience/ }));
    await user.click(screen.getByRole('button', { name: /Make estimate/ }));
    expect(screen.getByText('When was visual privacy exposure likely to be highest?')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Confidence 4/ }));
    await user.click(screen.getByRole('button', { name: /Reveal the camera view/ }));

    const stored = JSON.parse(window.sessionStorage.getItem(WARMUP_RESULT_STORAGE_KEY) ?? '{}');
    expect(stored.confidence).toBe(4);
    expect(stored.actual_exposure_peak_s).toBe(25.5);
    expect(stored.participant_id).toBe('P001');
    expect(stored.session_id).toBe('warmup-test');
    expect(stored.language).toBe('en');
    expect(screen.getByText('What you hear is not the same as what the camera sees.')).toBeInTheDocument();
    expect(screen.getByTestId('warmup-gs-camera')).toBeInTheDocument();
  });

  it('shows only the facilitator-selected session language', async () => {
    window.history.pushState({}, '', '/warmup?condition=c2&lang=zh&participant_id=P022&session_id=zh-warmup');
    const user = userEvent.setup();
    render(<WarmupExperience />);

    expect(screen.getByRole('heading', { name: '当无人机从附近飞过时，它的相机究竟能看到什么？' })).toBeInTheDocument();
    expect(screen.queryByText('When a drone passes nearby, what can its camera actually see?')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '声音开启' }));
    await user.click(screen.getByRole('button', { name: '开始体验' }));
    expect(screen.getByText('请先聆听。你认为暴露峰值在哪里？')).toBeInTheDocument();
  });
});
