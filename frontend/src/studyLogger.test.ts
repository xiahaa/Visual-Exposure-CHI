import { describe, expect, it } from 'vitest';
import { createStudyLogEvent, studyLogToJsonl } from './studyLogger';

describe('studyLogger', () => {
  it('records the active study role in JSONL events', () => {
    const event = createStudyLogEvent({
      event: 'condition_switch',
      scenario_id: 'residential_block_01',
      condition: 'visual_exposure',
      role: 'facilitator',
      payload: { next_condition: 'camera_footprint' },
    });

    const [line] = studyLogToJsonl([event]).split('\n');
    expect(JSON.parse(line)).toMatchObject({
      event: 'condition_switch',
      scenario_id: 'residential_block_01',
      condition: 'visual_exposure',
      role: 'facilitator',
    });
  });
});
