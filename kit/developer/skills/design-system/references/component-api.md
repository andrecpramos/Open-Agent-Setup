# Component API design

## Principles

1. **Props describe intent.** `variant`, `size`, `tone`, `density` — not colours or pixel
   values.
2. **One way to do one thing.** If `Button` has `variant="link"`, there is no separate
   `LinkButton`.
3. **Enumerations over booleans.** `variant: 'primary' | 'secondary' | 'ghost' | 'danger'`
   cannot be in two states at once; `isPrimary` + `isGhost` can.
4. **Composition over configuration.** Once a component grows props like `headerText`,
   `headerIcon`, `showHeaderDivider`, it wants a slot: `<Card><Card.Header>…</Card.Header></Card>`.
5. **Accessible by construction.** Required accessible names are required props for
   icon-only buttons; form fields render their own label and error wiring.
6. **Controlled and uncontrolled** where it makes sense (`value`/`onChange` and
   `defaultValue`), consistently across inputs.
7. **Pass-through** of refs and native attributes (`...rest`) so consumers can integrate with
   forms, tests and analytics — but not `className`/`style` overrides of the component's
   material unless the system explicitly allows layout-only overrides.

## Example (React + cva)

```tsx
const button = cva('inline-flex items-center justify-center gap-2 rounded-md font-medium focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50', {
  variants: {
    variant: {
      primary: 'bg-accent text-on-accent hover:bg-accent-hover',
      secondary: 'bg-surface-raised text-default border border-default hover:bg-hover',
      ghost: 'text-default hover:bg-hover',
      danger: 'bg-danger text-on-accent hover:bg-danger-hover',
    },
    size: { sm: 'h-8 px-3 text-sm', md: 'h-10 px-4 text-sm', lg: 'h-12 px-5 text-base' },
  },
  defaultVariants: { variant: 'primary', size: 'md' },
});

type ButtonProps = React.ComponentPropsWithRef<'button'> &
  VariantProps<typeof button> & { loading?: boolean };

export function Button({ variant, size, loading, disabled, children, ref, ...rest }: ButtonProps) {
  return (
    <button ref={ref} className={button({ variant, size })} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <Spinner aria-hidden /> : null}
      {children}
    </button>
  );
}
```

## States to document for every interactive component

Default · hover · active/pressed · focus-visible · disabled · loading · invalid/error ·
selected/checked · read-only — each in every theme, with long content, empty content and
(if supported) RTL. Storybook stories per state double as visual-regression baselines.

## Changing a shared component safely

1. Find every usage (`rg "<Button\b"` or the import path).
2. Additive changes (new variant, new optional prop) first; breaking changes get a codemod or
   a deprecation period.
3. Update stories, docs and visual baselines in the same PR; review the screenshot diffs
   rather than accepting them wholesale.
4. For wide-reaching changes, list the screens affected in the PR description.

## When to make a new component

When at least two places need the same structure and behaviour, and the existing components
cannot express it by composition or a new variant. One usage is a local component in the
feature; promote it when the second arrives.
