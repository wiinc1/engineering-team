import type { ReactNode } from 'react';

export interface ButtonProps {
  /** Visual style variant */
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive';
  /** Size of the button */
  size?: 'sm' | 'md' | 'lg';
  /** Disables the button */
  disabled?: boolean;
  /** Shows loading state */
  loading?: boolean;
  /** Click handler */
  onClick?: () => void;
  /** Button content */
  children: ReactNode;
  /** Additional CSS class */
  className?: string;
  /** HTML button type */
  type?: 'button' | 'submit' | 'reset';
}
