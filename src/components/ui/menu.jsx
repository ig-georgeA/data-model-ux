import * as React from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { cn } from '../../lib/utils';

const Root = DropdownMenuPrimitive.Root;
const Portal = DropdownMenuPrimitive.Portal;
const Separator = DropdownMenuPrimitive.Separator;

const Trigger = React.forwardRef(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Trigger ref={ref} className={cn(className)} {...props} />
));
Trigger.displayName = DropdownMenuPrimitive.Trigger.displayName;

const Positioner = ({ children }) => children;

const Popup = React.forwardRef(({ className, sideOffset = 6, ...props }, ref) => (
  <DropdownMenuPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    align="start"
    className={cn('z-50 min-w-[12rem] overflow-hidden rounded-xl border border-stone-200 bg-white p-1 shadow-xl', className)}
    {...props}
  />
));
Popup.displayName = DropdownMenuPrimitive.Content.displayName;

const Item = React.forwardRef(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex cursor-default select-none items-center rounded-md px-2.5 py-1.5 text-sm outline-none transition-colors focus:bg-slate-100 data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      inset && 'pl-8',
      className
    )}
    {...props}
  />
));
Item.displayName = DropdownMenuPrimitive.Item.displayName;

export const Menu = {
  Root,
  Trigger,
  Portal,
  Positioner,
  Popup,
  Item,
  Separator,
};
