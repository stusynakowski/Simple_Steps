import { render, screen } from '@testing-library/react';
import App from './App';
import { describe, it, expect } from 'vitest';

describe('App', () => {
  it('renders main layout and topbar controls', () => {
    render(<App />);
    expect(screen.getByTestId('main-layout')).toBeInTheDocument();
    expect(screen.getByTestId('btn-load')).toBeInTheDocument();
  });
});
