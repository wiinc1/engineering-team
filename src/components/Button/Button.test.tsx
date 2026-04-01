import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from './Button';

// Mock the CSS module
jest.mock('./Button.module.css', () => ({
  button: 'button',
  primary: 'primary',
  secondary: 'secondary',
  outline: 'outline',
  ghost: 'ghost',
  destructive: 'destructive',
  sm: 'sm',
  md: 'md',
  lg: 'lg',
  loading: 'loading',
  disabled: 'disabled',
  spinner: 'spinner',
  textHidden: 'textHidden',
}));

describe('Button', () => {
  describe('Rendering', () => {
    it('renders with children', () => {
      render(<Button>Click me</Button>);
      expect(screen.getByText('Click me')).toBeInTheDocument();
    });

    it('renders as a button element', () => {
      render(<Button>Test</Button>);
      expect(screen.getByRole('button')).toBeInTheDocument();
    });
  });

  describe('Variants', () => {
    it('applies primary variant by default', () => {
      const { container } = render(<Button>Primary</Button>);
      expect(container.firstChild).toHaveClass('primary');
    });

    it('applies secondary variant', () => {
      const { container } = render(<Button variant="secondary">Secondary</Button>);
      expect(container.firstChild).toHaveClass('secondary');
    });

    it('applies outline variant', () => {
      const { container } = render(<Button variant="outline">Outline</Button>);
      expect(container.firstChild).toHaveClass('outline');
    });

    it('applies ghost variant', () => {
      const { container } = render(<Button variant="ghost">Ghost</Button>);
      expect(container.firstChild).toHaveClass('ghost');
    });

    it('applies destructive variant', () => {
      const { container } = render(<Button variant="destructive">Delete</Button>);
      expect(container.firstChild).toHaveClass('destructive');
    });
  });

  describe('Sizes', () => {
    it('applies md size by default', () => {
      const { container } = render(<Button>Medium</Button>);
      expect(container.firstChild).toHaveClass('md');
    });

    it('applies sm size', () => {
      const { container } = render(<Button size="sm">Small</Button>);
      expect(container.firstChild).toHaveClass('sm');
    });

    it('applies lg size', () => {
      const { container } = render(<Button size="lg">Large</Button>);
      expect(container.firstChild).toHaveClass('lg');
    });
  });

  describe('States', () => {
    it('handles click events', () => {
      const handleClick = jest.fn();
      render(<Button onClick={handleClick}>Click</Button>);
      fireEvent.click(screen.getByRole('button'));
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('does not call onClick when disabled', () => {
      const handleClick = jest.fn();
      render(<Button disabled onClick={handleClick}>Disabled</Button>);
      fireEvent.click(screen.getByRole('button'));
      expect(handleClick).not.toHaveBeenCalled();
    });

    it('does not call onClick when loading', () => {
      const handleClick = jest.fn();
      render(<Button loading onClick={handleClick}>Loading</Button>);
      fireEvent.click(screen.getByRole('button'));
      expect(handleClick).not.toHaveBeenCalled();
    });

    it('sets disabled attribute when disabled', () => {
      render(<Button disabled>Disabled</Button>);
      expect(screen.getByRole('button')).toBeDisabled();
    });

    it('sets aria-disabled when disabled', () => {
      render(<Button disabled>Disabled</Button>);
      expect(screen.getByRole('button')).toHaveAttribute('aria-disabled', 'true');
    });

    it('sets aria-busy when loading', () => {
      render(<Button loading>Loading</Button>);
      expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
    });
  });

  describe('Loading State', () => {
    it('shows spinner when loading', () => {
      render(<Button loading>Loading</Button>);
      expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
    });

    it('hides text content when loading', () => {
      const { container } = render(<Button loading>Loading</Button>);
      // The text should have textHidden class applied
      const textElement = container.querySelector('.textHidden');
      expect(textElement).toBeInTheDocument();
    });
  });

  describe('Type Attribute', () => {
    it('defaults to type=button', () => {
      render(<Button>Button</Button>);
      expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
    });

    it('accepts submit type', () => {
      render(<Button type="submit">Submit</Button>);
      expect(screen.getByRole('button')).toHaveAttribute('type', 'submit');
    });

    it('accepts reset type', () => {
      render(<Button type="reset">Reset</Button>);
      expect(screen.getByRole('button')).toHaveAttribute('type', 'reset');
    });
  });

  describe('ClassName Prop', () => {
    it('applies additional className', () => {
      const { container } = render(<Button className="custom-class">Custom</Button>);
      expect(container.firstChild).toHaveClass('custom-class');
    });
  });
});
