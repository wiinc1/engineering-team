import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TaskCreationForm } from '../../src/features/task-creation/TaskCreationForm';

const defaultProps = { onSubmit: vi.fn(), loading: false };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('renders title before requirements and omits pre-refinement fields', () => {
  render(<TaskCreationForm {...defaultProps} />);

  const title = screen.getByLabelText(/title/i);
  const requirements = screen.getByLabelText(/requirements/i);
  const position = title.compareDocumentPosition(requirements);

  expect(title).toBeInTheDocument();
  expect(requirements).toBeInTheDocument();
  expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
  fireEvent.change(screen.getByLabelText(/requirements/i), { target: { value: 'Raw operator request' } });
  fireEvent.click(screen.getByRole('button', { name: /create task draft/i }));

  await waitFor(() => {
    expect(onSubmit).toHaveBeenCalledWith({ raw_requirements: 'Raw operator request', title: 'Test task' });
  });
});

it('allows title to be omitted', async () => {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(<TaskCreationForm {...defaultProps} onSubmit={onSubmit} />);

  fireEvent.change(screen.getByLabelText(/requirements/i), { target: { value: 'Raw operator request' } });
  fireEvent.click(screen.getByRole('button', { name: /create task draft/i }));

  await waitFor(() => {
    expect(onSubmit).toHaveBeenCalledWith({ raw_requirements: 'Raw operator request', title: '' });
  });
});

it('focuses requirements and shows validation errors when raw requirements are empty', async () => {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(<TaskCreationForm {...defaultProps} onSubmit={onSubmit} />);

  fireEvent.change(screen.getByLabelText(/requirements/i), { target: { value: '   ' } });
  fireEvent.click(screen.getByRole('button', { name: /create task draft/i }));

  await waitFor(() => {
    expect(screen.getByText(/requirements are required/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/requirements/i)).toHaveFocus();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

it('shows error prop when provided', () => {
  render(<TaskCreationForm {...defaultProps} error="API error occurred" />);

  expect(screen.getByText(/API error occurred/i)).toBeInTheDocument();
});

it('shows loading state on button', () => {
  render(<TaskCreationForm {...defaultProps} loading />);

  expect(screen.getByRole('button', { name: /create task draft/i })).toHaveAttribute('disabled');
});

it('has required attributes on raw requirements only', () => {
  render(<TaskCreationForm {...defaultProps} />);

  expect(screen.getByLabelText(/requirements/i)).toBeRequired();
  expect(screen.getByLabelText(/title/i)).not.toBeRequired();
  expect(screen.getByLabelText(/title/i)).toHaveAttribute('maxlength', '120');
});

it('focuses title and shows validation errors when title is too long', async () => {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(<TaskCreationForm {...defaultProps} onSubmit={onSubmit} />);

  fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'x'.repeat(121) } });
  fireEvent.change(screen.getByLabelText(/requirements/i), { target: { value: 'Raw operator request' } });
  fireEvent.click(screen.getByRole('button', { name: /create task draft/i }));

  await waitFor(() => {
    expect(screen.getByText(/title must be 120 characters or fewer/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/title/i)).toHaveFocus();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
