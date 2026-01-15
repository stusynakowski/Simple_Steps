import { render, screen, fireEvent } from '@testing-library/react';
import TopBar from './TopBar';
import { describe, it, expect, vi } from 'vitest';

describe('TopBar', () => {
  it('renders title and control buttons', () => {
    const onLoad = vi.fn();
    const onSave = vi.fn();
    const onSettings = vi.fn();

    render(
      <TopBar onLoad={onLoad} onSave={onSave} onSettings={onSettings} title="Test App" />
    );

    expect(screen.getByText('Test App')).toBeInTheDocument();
    expect(screen.getByTestId('btn-load')).toBeInTheDocument();
    expect(screen.getByTestId('btn-save')).toBeInTheDocument();
    expect(screen.getByTestId('btn-settings')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('btn-load'));
    expect(onLoad).toHaveBeenCalled();
  });
});
