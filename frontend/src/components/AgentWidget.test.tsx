import { render, screen } from '@testing-library/react';
import AgentWidget from './AgentWidget';
import { describe, it, expect } from 'vitest';

describe('AgentWidget', () => {
  it('renders a mock agent widget', () => {
    render(<AgentWidget />);
    expect(screen.getByText('Agent')).toBeInTheDocument();
    expect(screen.getByText(/mock/i)).toBeInTheDocument();
  });
});
