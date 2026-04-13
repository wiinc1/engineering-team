import React from 'react';
import styles from './Button.module.css';
import type { ButtonProps } from './types';
export type { ButtonProps } from './types';

/**
 * A reusable, accessible button component with multiple variants and states.
 *
 * @example
 * // Primary button
 * <Button variant="primary" onClick={handleClick}>Click me</Button>
 *
 * @example
 * // Loading state
 * <Button variant="primary" loading>Saving...</Button>
 */
export function Button({
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  onClick,
  children,
  className = '',
  type = 'button',
}: ButtonProps) {
  const classNames = [
    styles.button,
    styles[variant],
    styles[size],
    loading ? styles.loading : '',
    disabled ? styles.disabled : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type={type}
      className={classNames}
      disabled={disabled || loading}
      onClick={onClick}
      aria-disabled={disabled || loading}
      aria-busy={loading}
    >
      {loading && (
        <span className={styles.spinner} aria-hidden="true">
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <circle
              cx="8"
              cy="8"
              r="6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray="32"
              strokeDashoffset="12"
            />
          </svg>
        </span>
      )}
      <span className={loading ? styles.textHidden : ''}>{children}</span>
    </button>
  );
}

export default Button;
