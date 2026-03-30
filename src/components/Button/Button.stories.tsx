import type { Meta, StoryObj } from '@storybook/react';
import { Button } from './Button';

/**
 * A reusable, accessible button component with multiple variants and states.
 * 
 * ## Variants
 * - **primary** — Filled primary color, main actions
 * - **secondary** — Muted color, secondary actions
 * - **outline** — Bordered, transparent background
 * - **ghost** — No border, transparent background, subtle hover
 * - **destructive** — Red, danger/delete actions
 * 
 * ## Sizes
 * - **sm** — Small (32px height)
 * - **md** — Medium (40px height, default)
 * - **lg** — Large (48px height)
 * 
 * ## States
 * - **default** — Normal interactive state
 * - **hover** — Visual feedback on mouse over
 * - **active** — Pressed/clicked state
 * - **disabled** — Not interactive, visually muted
 * - **loading** — Shows spinner, disabled interaction
 */
const meta: Meta<typeof Button> = {
  title: 'UI/Button',
  component: Button,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: 'A reusable, accessible button component with multiple variants and states.',
      },
    },
  },
  argTypes: {
    variant: {
      control: 'select',
      options: ['primary', 'secondary', 'outline', 'ghost', 'destructive'],
      description: 'Visual style variant',
      table: {
        defaultValue: { summary: 'primary' },
      },
    },
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg'],
      description: 'Button size',
      table: {
        defaultValue: { summary: 'md' },
      },
    },
    disabled: {
      control: 'boolean',
      description: 'Disables the button',
    },
    loading: {
      control: 'boolean',
      description: 'Shows loading spinner',
    },
    type: {
      control: 'select',
      options: ['button', 'submit', 'reset'],
      description: 'HTML button type',
    },
  },
};

export default meta;
type Story = StoryObj<typeof Button>;

// Stories

export const Primary: Story = {
  args: {
    variant: 'primary',
    children: 'Primary Button',
    onClick: () => console.log('clicked'),
  },
};

export const Secondary: Story = {
  args: {
    variant: 'secondary',
    children: 'Secondary Button',
    onClick: () => console.log('clicked'),
  },
};

export const Outline: Story = {
  args: {
    variant: 'outline',
    children: 'Outline Button',
    onClick: () => console.log('clicked'),
  },
};

export const Ghost: Story = {
  args: {
    variant: 'ghost',
    children: 'Ghost Button',
    onClick: () => console.log('clicked'),
  },
};

export const Destructive: Story = {
  args: {
    variant: 'destructive',
    children: 'Delete',
    onClick: () => console.log('clicked'),
  },
};

export const Small: Story = {
  args: {
    variant: 'primary',
    size: 'sm',
    children: 'Small Button',
    onClick: () => console.log('clicked'),
  },
};

export const Large: Story = {
  args: {
    variant: 'primary',
    size: 'lg',
    children: 'Large Button',
    onClick: () => console.log('clicked'),
  },
};

export const Disabled: Story = {
  args: {
    variant: 'primary',
    disabled: true,
    children: 'Disabled Button',
    onClick: () => console.log('clicked'),
  },
};

export const Loading: Story = {
  args: {
    variant: 'primary',
    loading: true,
    children: 'Loading...',
    onClick: () => console.log('clicked'),
  },
};

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
      <Button variant="primary">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="destructive">Destructive</Button>
    </div>
  ),
};

export const AllSizes: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
      <Button variant="primary" size="sm">Small</Button>
      <Button variant="primary" size="md">Medium</Button>
      <Button variant="primary" size="lg">Large</Button>
    </div>
  ),
};
