import { describe, it, expect } from 'vitest';
import { runStep } from './api';
import { mockCells } from '../mocks/initialData';

describe('services/api', () => {
  it('runStep resolves with completed status and a sample output', async () => {
    const res = await runStep('s-1', {});
    expect(res.status).toBe('completed');
    expect(res.output_preview).toEqual(mockCells);
  });
});
