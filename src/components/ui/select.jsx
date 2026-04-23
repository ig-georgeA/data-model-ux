import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';

const Root = SelectPrimitive.Root;
const Value = SelectPrimitive.Value;
const Portal = SelectPrimitive.Portal;
const ItemText = SelectPrimitive.ItemText;

const Trigger = React.forwardRef(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      'flex h-9 w-full items-center justify-between rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 shadow-sm outline-none ring-offset-white placeholder:text-stone-400 focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-50',
      className
    )}
    {...props}
  >
    {children}
  </SelectPrimitive.Trigger>
));
Trigger.displayName = SelectPrimitive.Trigger.displayName;

const Icon = ({ className, children, ...props }) => (
  <SelectPrimitive.Icon className={cn('ml-2 shrink-0 opacity-60', className)} {...props}>
    {children ?? <ChevronDown className="h-4 w-4" />}
  </SelectPrimitive.Icon>
);

const Positioner = ({ children }) => children;

const Popup = React.forwardRef(({ className, children, position = 'popper', sideOffset = 4, ...props }, ref) => (
  <SelectPrimitive.Content
    ref={ref}
    position={position}
    sideOffset={sideOffset}
    className={cn('z-50 min-w-[8rem] overflow-hidden rounded-md border border-stone-200 bg-white text-stone-950 shadow-md', className)}
    {...props}
  >
    {children}
  </SelectPrimitive.Content>
));
Popup.displayName = SelectPrimitive.Content.displayName;

const List = React.forwardRef(({ className, ...props }, ref) => (
  <SelectPrimitive.Viewport ref={ref} className={cn('p-1', className)} {...props} />
));
List.displayName = SelectPrimitive.Viewport.displayName;

const Item = React.forwardRef(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-slate-100 data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>
    {children}
  </SelectPrimitive.Item>
));
Item.displayName = SelectPrimitive.Item.displayName;

export const Select = {
  Root,
  Trigger,
  Value,
  Icon,
  Portal,
  Positioner,
  Popup,
  List,
  Item,
  ItemText,
};
