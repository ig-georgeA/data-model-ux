import * as React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from '../../lib/utils';

const Root = React.forwardRef(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      'peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent bg-stone-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:ring-offset-2 focus-visible:ring-offset-white data-[state=checked]:bg-blue-600 data-[state=unchecked]:bg-stone-300 disabled:cursor-not-allowed disabled:opacity-50',
      className
    )}
    {...props}
  />
));
Root.displayName = SwitchPrimitive.Root.displayName;

const Thumb = React.forwardRef(({ className, ...props }, ref) => (
  <SwitchPrimitive.Thumb
    ref={ref}
    className={cn(
      'pointer-events-none block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0',
      className
    )}
    {...props}
  />
));
Thumb.displayName = SwitchPrimitive.Thumb.displayName;

export const Switch = {
  Root,
  Thumb,
};
