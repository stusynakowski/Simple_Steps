import type { Cell, StepConfiguration, StepStatus } from '../types/models';
import { mockCells } from '../mocks/initialData';

/**
 * Mock API service that simulates running a step in the Python backend.
 * Returns a promise that resolves with a final status and optional output preview.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function runStep(_stepId: string, _configuration: StepConfiguration): Promise<{ status: StepStatus; output_preview?: Cell[] }> {
  return new Promise((resolve) => {
    // Simulate asynchronous work by resolving after a short delay.
    setTimeout(() => {
      resolve({ status: 'completed', output_preview: mockCells });
    }, 200);
  });
}
