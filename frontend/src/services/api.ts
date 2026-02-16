import type { StepConfiguration } from '../types/models';

const API_BASE = 'http://localhost:8000/api';

interface StepRunResponse {
  status: 'success' | 'failed';
  output_ref_id: string;
  metrics: {
    rows: number;
    columns: string[];
  };
  error?: string;
}

export interface OperationParam {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'list';
  description: string;
  default?: any;
}

export interface OperationDefinition {
  id: string;
  label: string;
  description: string;
  params: OperationParam[];
}

/**
 * Fetches the catalogue of available operations.
 */
export async function getOperations(): Promise<OperationDefinition[]> {
  const response = await fetch(`${API_BASE}/operations`);
  if (!response.ok) throw new Error("Failed to fetch operations");
  return response.json();
}

/**
 * Validates connection to the backend.
 */
export async function checkBackendStatus(): Promise<boolean> {
    try {
        await fetch(`${API_BASE}/operations`);
        return true;
    } catch {
        return false;
    }
}

/**
 * Executes a single step on the backend.
 * Returns the reference ID for the result, not the data itself.
 */
export async function runStep(
    stepId: string, 
    operationId: string,
    configuration: StepConfiguration,
    inputRefId: string | null
): Promise<StepRunResponse> {
  
  const payload = {
      step_id: stepId,
      operation_id: operationId,
      config: configuration,
      input_ref_id: inputRefId
  };

  const response = await fetch(`${API_BASE}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
  });

  if (!response.ok) {
      throw new Error(`Backend Error: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Fetches a slice of data for the grid view using a reference ID.
 */
export async function fetchDataView(
    refId: string, 
    offset: number = 0, 
    limit: number = 50
): Promise<any[]> {
    const response = await fetch(`${API_BASE}/data/${refId}?offset=${offset}&limit=${limit}`);
    if (!response.ok) {
        // If 404, maybe ref expired.
        throw new Error('Data not found');
    }
    return response.json();
}

