import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { TaskCreationForm } from '../../src/features/task-creation/TaskCreationForm';

afterEach(cleanup);

describe('TaskCreationForm', () => {
  const defaultProps = {
    onSubmit: vi.fn(),
    loading: false,
  };

  it('renders all form fields', () => {
    render(<TaskCreationForm {...defaultProps} />);

    expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/business context/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/acceptance criteria/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/definition of done/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/priority/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/task type/i)).toBeInTheDocument();
  });

  it('calls onSubmit with form data when submitted', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<TaskCreationForm {...defaultProps} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Test task' } });
    fireEvent.change(screen.getByLabelText(/business context/i), { target: { value: 'Test context' } });
    fireEvent.change(screen.getByLabelText(/acceptance criteria/i), { target: { value: 'Test criteria' } });
    fireEvent.change(screen.getByLabelText(/definition of done/i), { target: { value: 'Test done' } });
    fireEvent.change(screen.getByLabelText(/priority/i), { target: { value: 'High' } });
    fireEvent.change(screen.getByLabelText(/task type/i), { target: { value: 'Feature' } });

    fireEvent.click(screen.getByRole('button', { name: /create task/i }));

    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        title: 'Test task',
        business_context: 'Test context',
        acceptance_criteria: 'Test criteria',
        definition_of_done: 'Test done',
        priority: 'High',
        task_type: 'Feature',
      });
    });
  });

  it('shows validation errors for invalid data', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<TaskCreationForm {...defaultProps} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: '   ' } });
    fireEvent.change(screen.getByLabelText(/business context/i), { target: { value: 'Valid context' } });
    fireEvent.change(screen.getByLabelText(/acceptance criteria/i), { target: { value: 'Valid criteria' } });
    fireEvent.change(screen.getByLabelText(/definition of done/i), { target: { value: 'Valid done' } });
    fireEvent.change(screen.getByLabelText(/priority/i), { target: { value: 'High' } });
    fireEvent.change(screen.getByLabelText(/task type/i), { target: { value: 'Feature' } });

    fireEvent.click(screen.getByRole('button', { name: /create task/i }));

    await vi.waitFor(() => {
      expect(screen.getByText(/title is required/i)).toBeInTheDocument();
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  it('shows error prop when provided', () => {
    render(<TaskCreationForm {...defaultProps} error="API error occurred" />);

    expect(screen.getByText(/API error occurred/i)).toBeInTheDocument();
  });

  it('shows loading state on button', () => {
    render(<TaskCreationForm {...defaultProps} loading={true} />);

    const button = screen.getByRole('button', { name: /create task/i });
    expect(button).toHaveAttribute('disabled');
  });

  it('has required attributes on required fields', () => {
    render(<TaskCreationForm {...defaultProps} />);

    expect(screen.getByLabelText(/title/i)).toBeRequired();
    expect(screen.getByLabelText(/business context/i)).toBeRequired();
    expect(screen.getByLabelText(/acceptance criteria/i)).toBeRequired();
    expect(screen.getByLabelText(/definition of done/i)).toBeRequired();
  });

  it('includes all priority options', () => {
    render(<TaskCreationForm {...defaultProps} />);

    const select = screen.getByLabelText(/priority/i);
    expect(select).toContainElement(screen.getByText('Low'));
    expect(select).toContainElement(screen.getByText('Medium'));
    expect(select).toContainElement(screen.getByText('High'));
    expect(select).toContainElement(screen.getByText('Critical'));
  });

  it('includes all task type options', () => {
    render(<TaskCreationForm {...defaultProps} />);

    const select = screen.getByLabelText(/task type/i);
    expect(select).toContainElement(screen.getByText('Feature'));
    expect(select).toContainElement(screen.getByText('Bug'));
    expect(select).toContainElement(screen.getByText('Refactor'));
    expect(select).toContainElement(screen.getByText('Technical Debt'));
    expect(select).toContainElement(screen.getByText('Documentation'));
  });
});
