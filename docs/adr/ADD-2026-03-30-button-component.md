# Architecture Decision Record: Button Component System

**Date:** 2026-03-30  
**Status:** Proposed  
**Deciders:** Architect (Arch)

## Context

The engineering team needs a reusable, accessible, and well-tested Button component to serve as the foundation of our UI component library. This component will be used across all features and must be consistent, maintainable, and production-ready.

## Decision

### Component API

```typescript
interface ButtonProps {
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
  children: React.ReactNode;
  /** Additional CSS class */
  className?: string;
  /** HTML button type */
  type?: 'button' | 'submit' | 'reset';
}
```

### Styling Approach: CSS Modules + CSS Custom Properties

- **Decision:** Use CSS Modules for component-scoped styles, with CSS Custom Properties (variables) for theming
- **Rationale:** 
  - Zero runtime overhead (vs styled-components)
  - Scoped by default — no class name collisions
  - Easy to override in consuming apps
  - CSS variables enable runtime theme switching
  - Standard React pattern, well-understood

### File Structure

```
src/components/Button/
├── Button.tsx           # Component implementation
├── Button.module.css    # Component styles
├── Button.stories.tsx   # Storybook story (docs/demo)
├── Button.test.tsx      # Unit tests
├── index.ts             # Public export
└── types.ts             # TypeScript interfaces
```

### Design Tokens

Colors and sizing via CSS variables for consistency:

```css
/* Sizes */
--button-height-sm: 32px;
--button-height-md: 40px;
--button-height-lg: 48px;

/* Colors */
--button-bg-primary: var(--color-primary);
--button-bg-secondary: var(--color-secondary);
--button-bg-outline: transparent;
--button-bg-ghost: transparent;
--button-bg-destructive: var(--color-danger);

/* Borders */
--button-border-radius: 6px;
```

## Rationale

- **CSS Modules over Tailwind:** Tailwind is great but adds build complexity and requires team familiarity. CSS Modules with variables gives us 80% of the benefit with standard React patterns.
- **Variants as props:** Standard pattern (Radix, shadcn/ui use this). Easy to extend, predictable API.
- **Loading state:** Shows spinner via CSS animation, doesn't require state machine library.
- **Destructive variant:** Separating destructive actions visually reduces accidents.

## Consequences

### Positive
- Foundation for all UI components (Card, Input, Modal inherit patterns)
- Consistent look and feel across the app
- Easy to test — pure presentational component
- Accessible by default with semantic `<button>` element

### Negative
- CSS Modules requires build config (standard in Vite/Create React App)
- Need to establish design tokens/colors separately
- Spinner animation needs to be added to global styles or component

### Neutral
- Team needs to follow file structure convention for all components
- Tests can mock CSS Modules with `jest-styled-components` or similar

## Alternatives Considered

### Alternative 1: styled-components
**Decision:** Rejected  
**Rationale:** Adds runtime overhead, requires Babel plugin, harder to debug in DevTools  
**Trade-offs:** More powerful theming, but overkill for buttons

### Alternative 2: Tailwind CSS utility classes
**Decision:** Rejected for component internals  
**Rationale:** Great for page-level styling, but creates inconsistency in components  
**Trade-offs:** Would need strict conventions to avoid divergence

### Alternative 3: No variants (single button with props)
**Decision:** Rejected  
**Rationale:** Too limiting — destructive actions need visual distinction  
**Trade-offs:** Simple API but forces consumers to add custom styles

## Related Decisions

- ADD-2026-03-30-team-setup (foundational team structure)

## Notes

- The spinner/loading animation should use CSS `@keyframes`, not SVG animation
- Focus ring must be visible for accessibility (`:focus-visible`)
- Consider adding `aria-disabled` when disabled, not just `disabled` attribute
