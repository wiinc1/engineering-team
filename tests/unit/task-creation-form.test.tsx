import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { TaskCreationForm } from '../../src/features/task-creation/TaskCreationForm';

afterEach(cleanup);

describe('TaskCreationForm', () => {
  const defaultProps = {
    onSubmit: vi.fn(),
    loading: false,
  };

  it('renders intake form fields', () => {
    render(<TaskCreationForm {...defaultProps} />);

    expect(screen.getByLabelText(/raw requirements/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/business context/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/acceptance criteria/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/definition of done/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/priority/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/task type/i)).not.toBeInTheDocument();
  });

  it('calls onSubmit with raw requirements and optional title', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<TaskCreationForm {...defaultProps} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Test task' } });
    fireEvent.change(screen.getByLabelText(/raw requirements/i), { target: { value: 'Raw operator request' } });

    fireEvent.click(screen.getByRole('button', { name: /create intake draft/i }));

    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        raw_requirements: 'Raw operator request',
        title: 'Test task',
      });
    });
  });

  it('allows title to be omitted', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<TaskCreationForm {...defaultProps} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText(/raw requirements/i), { target: { value: 'Raw operator request' } });

    fireEvent.click(screen.getByRole('button', { name: /create intake draft/i }));

    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        raw_requirements: 'Raw operator request',
        title: '',
      });
    });
  });

  it('shows validation errors when raw requirements are empty', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<TaskCreationForm {...defaultProps} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText(/raw requirements/i), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: /create intake draft/i }));

    await vi.waitFor(() => {
      expect(screen.getByText(/raw_requirements is required/i)).toBeInTheDocument();
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  it('shows error prop when provided', () => {
    render(<TaskCreationForm {...defaultProps} error="API error occurred" />);

    expect(screen.getByText(/API error occurred/i)).toBeInTheDocument();
  });

  it('shows loading state on button', () => {
    render(<TaskCreationForm {...defaultProps} loading={true} />);

    const button = screen.getByRole('button', { name: /create intake draft/i });
    expect(button).toHaveAttribute('disabled');
  });

  it('has required attributes on raw requirements only', () => {
    render(<TaskCreationForm {...defaultProps} />);

    expect(screen.getByLabelText(/raw requirements/i)).toBeRequired();
    expect(screen.getByLabelText(/title/i)).not.toBeRequired();
    expect(screen.getByLabelText(/title/i)).toHaveAttribute('maxlength', '120');
  });

  it('shows validation errors when title is too long', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<TaskCreationForm {...defaultProps} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'x'.repeat(121) } });
    fireEvent.change(screen.getByLabelText(/raw requirements/i), { target: { value: 'Raw operator request' } });
    fireEvent.click(screen.getByRole('button', { name: /create intake draft/i }));

    await vi.waitFor(() => {
      expect(screen.getByText(/title must be 120 characters or fewer/i)).toBeInTheDocument();
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });
});
