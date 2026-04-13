import { render, screen } from '@testing-library/react';
import MainLayout from './MainLayout';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the api module so useWorkflow doesn't try to fetch from a real server
vi.mock('../services/api', () => ({
  getOperations: vi.fn().mockResolvedValue([]),
  runStep: vi.fn().mockResolvedValue({ ref_id: 'mock-ref', metrics: {} }),
  fetchDataView: vi.fn().mockResolvedValue({ cells: [] }),
  checkBackendStatus: vi.fn().mockResolvedValue(true),
  saveWorkflow: vi.fn().mockResolvedValue({ id: 'mock-id' }),
  loadWorkflow: vi.fn().mockResolvedValue({ id: 'wf', name: 'Test', steps: [] }),
  listProjects: vi.fn().mockResolvedValue([]),
  createProject: vi.fn().mockResolvedValue({ project_id: 'p1' }),
  deleteProject: vi.fn().mockResolvedValue({}),
  listPipelines: vi.fn().mockResolvedValue([]),
  deletePipeline: vi.fn().mockResolvedValue({}),
}));

describe('MainLayout', () => {
  beforeEach(() => {
    // Suppress console.error from unhandled fetch calls in sub-components
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders header and dynamic columns', () => {
    render(<MainLayout />);
    expect(screen.getByTestId('main-layout')).toBeInTheDocument();

    // Check for the columns container
    expect(screen.getByTestId('columns-container')).toBeInTheDocument();

    // The initial workflow has a single step with id 'step-000'
    const first = screen.getByTestId('operation-column-step-000');
    expect(first).toBeInTheDocument();
  });
});
