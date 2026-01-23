import { render, screen, fireEvent } from '@testing-library/react';
import TopBar from './TopBar';
import { describe, it, expect, vi } from 'vitest';

describe('TopBar', () => {
  it('renders control buttons', () => {
    const onLoad = vi.fn();
    const onSave = vi.fn();
    const onSettings = vi.fn();
    const onAddStep = vi.fn();

    render(
      <TopBar 
        onLoad={onLoad} 
        onSave={onSave} 
        onSettings={onSettings} 
        onAddStep={onAddStep} 
      />
    );

    expect(screen.getByTestId('btn-load')).toBeInTheDocument();
    expect(screen.getByTestId('btn-save')).toBeInTheDocument();
    expect(screen.getByTestId('btn-settings')).toBeInTheDocument();
    expect(screen.getByTestId('btn-add-step')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('btn-load'));
    expect(onLoad).toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('btn-add-step'));
    expect(onAddStep).toHaveBeenCalled();
  });
});
