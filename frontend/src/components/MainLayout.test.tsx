import { render, screen } from '@testing-library/react';
import MainLayout from './MainLayout';
import { describe, it, expect } from 'vitest';

describe('MainLayout', () => {
  it('renders header and placeholders', () => {
    render(<MainLayout />);
    expect(screen.getByTestId('main-layout')).toBeInTheDocument();
    expect(screen.getByTestId('workflow-area')).toBeInTheDocument();
    expect(screen.getByTestId('step-detail')).toBeInTheDocument();
  });
});
