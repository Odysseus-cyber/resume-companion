// Adapted from shadcn/ui's MIT Button composition (Slot + cva); project-specific CSS.
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './utils';
const variants = cva('button', {
  variants: {
    variant: {
      default: 'button-primary',
      secondary: 'button-secondary',
      ghost: 'button-ghost',
      danger: 'button-danger',
    },
  },
  defaultVariants: { variant: 'default' },
});
type Props = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof variants> & { asChild?: boolean };
export function Button({ asChild = false, variant, className, ...props }: Props) {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(variants({ variant }), className)} {...props} />;
}
