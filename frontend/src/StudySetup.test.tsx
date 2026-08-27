import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StudySetup } from './StudySetup';
import { decodeMatrixCityFlightConfig } from './matrixCityFlightConfig';
import { scenarioFixture } from './test/fixtures';

describe('StudySetup', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(scenarioFixture));
  });

  it('builds locked warm-up and study URLs from facilitator choices', async () => {
    render(<StudySetup />);
    await screen.findByText('Balanced Inspection');

    await userEvent.clear(screen.getByLabelText('Participant ID'));
    await userEvent.type(screen.getByLabelText('Participant ID'), 'P042');
    await userEvent.click(screen.getByRole('button', { name: /C2/ }));
    await userEvent.selectOptions(screen.getByLabelText('Session language'), 'zh');

    const warmup = screen.getByRole('link', { name: /Open participant warm-up/ });
    const study = screen.getByRole('link', { name: /Open study directly/ });
    expect(warmup).toHaveAttribute('href', expect.stringContaining('/warmup?condition=c2'));
    expect(warmup).toHaveAttribute('href', expect.stringContaining('lang=zh'));
    expect(warmup).toHaveAttribute('href', expect.stringContaining('participant_id=P042'));
    expect(study).toHaveAttribute('href', expect.stringContaining('/?condition=c2'));
  });

  it('keeps participant assignment server-side and builds a separate cell preview URL', async () => {
    render(<StudySetup />);
    await screen.findByText('Balanced Inspection');

    await userEvent.click(screen.getByRole('button', { name: 'Profile D H-R' }));
    await userEvent.click(screen.getByRole('button', { name: /S\s*Structured facts/ }));
    await userEvent.selectOptions(screen.getByLabelText('Session language'), 'zh');

    const runner = screen.getByRole('link', { name: /Open assigned study/ });
    expect(runner).toHaveAttribute('href', expect.stringContaining('/runner?lang=zh'));
    expect(runner).not.toHaveAttribute('href', expect.stringContaining('profile='));
    expect(runner).not.toHaveAttribute('href', expect.stringContaining('disclosure='));
    const preview = screen.getByRole('link', { name: /Preview selected cell/ });
    expect(preview).toHaveAttribute('href', expect.stringContaining('role=facilitator'));
    expect(preview).toHaveAttribute('href', expect.stringContaining('profile=D'));
    expect(preview).toHaveAttribute('href', expect.stringContaining('disclosure=S'));
    expect(runner).toHaveAttribute('href', expect.stringContaining('lang=zh'));
  });

  it('guides and serializes a validated facilitator flight configuration', async () => {
    render(<StudySetup />);
    await screen.findByText('Balanced Inspection');

    expect(screen.queryByText('How to configure this flight')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Custom preview/ }));

    expect(screen.getByText('How to configure this flight')).toBeInTheDocument();
    expect(screen.getByText(/Start to End over the fixed 24-second study clip/)).toBeInTheDocument();
    const eastInput = screen.getByLabelText('UAV start East');
    expect(eastInput).toHaveAttribute('min', '60');
    expect(eastInput).toHaveAttribute('max', '340');
    await userEvent.clear(eastInput);
    await userEvent.type(eastInput, '88');

    const preview = screen.getByRole('link', { name: /Preview selected cell/ });
    const encoded = new URL(preview.getAttribute('href')!).searchParams.get('flight');
    expect(encoded).not.toBeNull();
    expect(decodeMatrixCityFlightConfig(encoded!).trajectory.start_enu_m[0]).toBe(88);
  });

  it('blocks preview when a custom camera depth range is invalid', async () => {
    render(<StudySetup />);
    await screen.findByText('Balanced Inspection');
    await userEvent.click(screen.getByRole('button', { name: /Custom preview/ }));

    const minimumDepth = screen.getByLabelText('Minimum depth');
    await userEvent.clear(minimumDepth);
    await userEvent.type(minimumDepth, '25');
    const maximumDepth = screen.getByLabelText('Maximum depth');
    await userEvent.clear(maximumDepth);
    await userEvent.type(maximumDepth, '20');

    expect(screen.getByText('Maximum depth must be greater than minimum depth.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Fix flight configuration to preview/ })).toBeDisabled();
  });
});

function jsonResponse(data: unknown): Response {
  return { ok: true, status: 200, statusText: 'OK', json: async () => data } as Response;
}
