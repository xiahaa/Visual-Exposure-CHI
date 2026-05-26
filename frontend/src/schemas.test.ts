import { describe, expect, it } from 'vitest';
import { exposureResponseSchema, planningResponseSchema, scenarioSchema } from './schemas';
import { exposureFixture, planningFixture, scenarioFixture } from './test/fixtures';

describe('runtime schemas', () => {
  it('accepts the current scenario response shape', () => {
    expect(() => scenarioSchema.parse(scenarioFixture)).not.toThrow();
  });

  it('accepts the current exposure response shape', () => {
    expect(() => exposureResponseSchema.parse(exposureFixture)).not.toThrow();
  });

  it('accepts the current planning response shape', () => {
    expect(() => planningResponseSchema.parse(planningFixture)).not.toThrow();
  });
});
