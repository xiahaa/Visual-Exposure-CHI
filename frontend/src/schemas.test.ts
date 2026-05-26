import { describe, expect, it } from 'vitest';
import { exposureResponseSchema, scenarioSchema } from './schemas';
import { exposureFixture, scenarioFixture } from './test/fixtures';

describe('runtime schemas', () => {
  it('accepts the current scenario response shape', () => {
    expect(() => scenarioSchema.parse(scenarioFixture)).not.toThrow();
  });

  it('accepts the current exposure response shape', () => {
    expect(() => exposureResponseSchema.parse(exposureFixture)).not.toThrow();
  });
});

