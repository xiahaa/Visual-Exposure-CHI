import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StudySetup } from './StudySetup';
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

  it('builds a main-study runner URL for the selected event and disclosure cell', async () => {
    render(<StudySetup />);
    await screen.findByText('Balanced Inspection');

    await userEvent.click(screen.getByRole('button', { name: 'Profile D H-R' }));
    await userEvent.click(screen.getByRole('button', { name: /S\s*Structured facts/ }));
    await userEvent.selectOptions(screen.getByLabelText('Session language'), 'zh');

    const runner = screen.getByRole('link', { name: /Open event runner/ });
    expect(runner).toHaveAttribute('href', expect.stringContaining('/runner?profile=D'));
    expect(runner).toHaveAttribute('href', expect.stringContaining('disclosure=S'));
    expect(runner).toHaveAttribute('href', expect.stringContaining('lang=zh'));
  });
});

function jsonResponse(data: unknown): Response {
  return { ok: true, status: 200, statusText: 'OK', json: async () => data } as Response;
}
