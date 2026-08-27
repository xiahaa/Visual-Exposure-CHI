import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { compareFixture, exposureFixture, planningFixture, scenarioFixture } from './test/fixtures';

const mapCoordinates = [
  [113.9302, 22.5402],
  [113.9305, 22.5402],
  [113.9305, 22.5405],
];
let mapIndex = 0;

vi.mock('@deck.gl/react', () => ({
  default: ({ children, onClick, layers }: { children?: React.ReactNode; onClick?: (info: unknown) => void; layers?: Array<{ props?: { id?: string } }> }) => (
    <div data-testid="deckgl" data-layer-ids={layers?.map((layer) => layer.props?.id).filter(Boolean).join(',')} onClick={() => onClick?.({ coordinate: mapCoordinates[mapIndex++ % mapCoordinates.length] })}>{children}</div>
  ),
}));

vi.mock('deck.gl', () => ({
  GeoJsonLayer: class MockLayer { constructor(public props: unknown) {} },
  PathLayer: class MockLayer { constructor(public props: unknown) {} },
  PolygonLayer: class MockLayer { constructor(public props: unknown) {} },
  ScatterplotLayer: class MockLayer { constructor(public props: unknown) {} },
  TextLayer: class MockLayer { constructor(public props: unknown) {} },
}));

vi.mock('@deck.gl/geo-layers', () => ({
  TileLayer: class MockLayer { constructor(public props: unknown) {} },
}));

vi.mock('@deck.gl/layers', () => ({
  BitmapLayer: class MockLayer { constructor(public props: unknown) {} },
}));

vi.mock('./EvidenceViewport', () => ({
  EvidenceViewport: ({ pose }: { pose: { pose_index: number } }) => <div data-testid="evidence-viewport">Synthetic pose {pose.pose_index}</div>,
}));

describe('Guided App V2', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.sessionStorage.clear();
    mapIndex = 0;
    window.history.pushState({}, '', '/?condition=c3&session_id=v2-test&participant_id=P009');
  });

  it('shows one participant task at a time and locks camera controls', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(scenarioFixture));
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Review the flight' })).toBeInTheDocument();
    expect(screen.getByText('P009')).toBeInTheDocument();
    expect(screen.queryByLabelText('Route file')).not.toBeInTheDocument();
    expect(screen.queryByText('Advanced Camera')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Inspect exposure evidence' })).not.toBeInTheDocument();
  });

  it('keeps C1 and C2 evidence boundaries isolated', async () => {
    window.history.pushState({}, '', '/?condition=c1&session_id=c1-test');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(scenarioFixture));
    const { unmount } = render(<App />);
    await screen.findByRole('heading', { name: 'Review the flight' });
    expect(screen.queryByRole('button', { name: /Inspect exposure evidence/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('heading', { name: 'Make your decision' })).toBeInTheDocument();
    unmount();

    window.sessionStorage.clear();
    window.history.pushState({}, '', '/?condition=c2&session_id=c2-test');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(scenarioFixture));
    render(<App />);
    await screen.findByRole('heading', { name: 'Review the flight' });
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('heading', { name: 'Inspect camera coverage' })).toBeInTheDocument();
    expect(screen.getByText('Not an exposure score')).toBeInTheDocument();
    expect(screen.queryByText('Estimated exposure')).not.toBeInTheDocument();
  });

  it('auto-computes C3 exposure and synchronizes route evidence', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(scenarioFixture))
      .mockResolvedValueOnce(jsonResponse(exposureFixture));
    render(<App />);
    await screen.findByRole('heading', { name: 'Review the flight' });
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Route exposure profile')).toBeInTheDocument();
    expect(screen.getByTestId('evidence-viewport')).toBeInTheDocument();
    const slider = screen.getByLabelText('Selected route pose');
    expect(slider).toBeInTheDocument();
    expect(slider).toHaveAttribute('aria-valuetext', expect.stringContaining('visible surfaces'));
    expect(screen.getByTestId('deckgl')).toHaveAttribute('data-layer-ids', expect.stringContaining('selected-pose-first-hit-surfaces'));
    expect(screen.getByTestId('deckgl')).toHaveAttribute('data-layer-ids', expect.stringContaining('selected-pose-frustum-rays'));
    expect(screen.getByText('Inspect the evidence, not only the score')).toBeInTheDocument();

    fireEvent.change(slider, { target: { value: '0' } });
    expect(screen.getByTestId('evidence-viewport')).toHaveTextContent('Synthetic pose 0');
  });

  it('supports an explicit no-area-concerns path', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(scenarioFixture))
      .mockResolvedValueOnce(jsonResponse(exposureFixture));
    render(<App />);
    await screen.findByRole('heading', { name: 'Review the flight' });
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('Route exposure profile');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.click(screen.getByRole('button', { name: /No area concerns/ }));
    await userEvent.click(screen.getByRole('button', { name: /Confirm concerns/ }));

    expect(await screen.findByText('No spatial response requested')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Continue to decision/ }));
    expect(screen.getByRole('heading', { name: 'Make your decision' })).toBeInTheDocument();
  });

  it('draws concerns and generates preference-aware suggestions', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(scenarioFixture))
      .mockResolvedValueOnce(jsonResponse(exposureFixture))
      .mockResolvedValueOnce(jsonResponse(compareFixture))
      .mockResolvedValueOnce(jsonResponse(planningFixture))
      .mockResolvedValueOnce(jsonResponse(exposureFixture));
    render(<App />);
    await screen.findByRole('heading', { name: 'Review the flight' });
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('Route exposure profile');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.click(screen.getByRole('button', { name: /Sensitive/ }));
    await userEvent.click(screen.getByTestId('deckgl'));
    await userEvent.click(screen.getByTestId('deckgl'));
    await userEvent.click(screen.getByTestId('deckgl'));
    await userEvent.click(screen.getByRole('button', { name: 'Close polygon' }));
    await userEvent.click(screen.getByRole('button', { name: /Confirm concerns/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(await screen.findByText(/raycast-evaluated suggestions/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Suggested alternative comparison' })).toBeInTheDocument();
    const compareRequest = JSON.parse(String(fetchMock.mock.calls[2][1]?.body));
    expect(compareRequest.after.user_preferences.sensitive_areas.features).toHaveLength(1);

    await userEvent.click(screen.getAllByRole('button', { name: /Apply/ })[0]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    const verificationRequest = JSON.parse(String(fetchMock.mock.calls[4][1]?.body));
    expect(verificationRequest.camera.ray_width).toBe(planningFixture.options[0].modified_camera.ray_width);
    expect(verificationRequest.camera.ray_height).toBe(planningFixture.options[0].modified_camera.ray_height);
    expect(await screen.findByText(/Applied and verified: Privacy-first/)).toBeInTheDocument();
  });

  it('uses one locked language per participant session', async () => {
    window.history.pushState({}, '', '/?condition=c3&lang=zh&session_id=zh-test');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(scenarioFixture));
    render(<App />);

    expect(await screen.findByRole('heading', { name: '查看飞行任务' })).toBeInTheDocument();
    expect(screen.getByText('住宅街区屋顶巡检')).toBeInTheDocument();
    expect(screen.queryByText('Review the flight')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '继续' })).toBeInTheDocument();
  });

  it('keeps facilitator controls in a separate drawer', async () => {
    window.history.pushState({}, '', '/?role=facilitator&condition=c3&session_id=fac-test');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(scenarioFixture));
    render(<App />);
    await screen.findByRole('heading', { name: 'Review the flight' });
    expect(screen.queryByLabelText('Route file')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Researcher controls' }));
    expect(screen.getByLabelText('Route file')).toBeInTheDocument();
    expect(screen.getByText('Download study log (0)')).toBeInTheDocument();
  });

  it('persists session-scoped study events across a refresh', async () => {
    window.history.pushState({}, '', '/?role=facilitator&condition=c3&lang=zh&participant_id=P018&session_id=persist-test');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(scenarioFixture));
    const firstRender = render(<App />);
    await screen.findByRole('heading', { name: '查看飞行任务' });
    await userEvent.click(screen.getByRole('button', { name: 'Researcher controls' }));
    await userEvent.click(screen.getByRole('button', { name: /C2 Route \+ Footprint/ }));

    await waitFor(() => {
      const stored = JSON.parse(window.sessionStorage.getItem('chi-study-log-v2:persist-test') ?? '[]');
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({
        event: 'condition_switch',
        participant_id: 'P018',
        session_id: 'persist-test',
        language: 'zh',
        active_step: 'briefing',
      });
      expect(stored[0].step_elapsed_ms).toEqual(expect.any(Number));
    });

    firstRender.unmount();
    window.history.pushState({}, '', '/?role=facilitator&condition=c3&lang=zh&participant_id=P018&session_id=persist-test');
    render(<App />);
    await screen.findByRole('heading', { name: '查看飞行任务' });
    await userEvent.click(screen.getByRole('button', { name: 'Researcher controls' }));
    expect(screen.getByText('Download study log (1)')).toBeInTheDocument();
  });
});

function jsonResponse(data: unknown): Response {
  return { ok: true, status: 200, statusText: 'OK', json: async () => data } as Response;
}
