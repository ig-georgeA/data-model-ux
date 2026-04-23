import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '../../lib/utils';

const Root = TabsPrimitive.Root;

const List = React.forwardRef(({ className, ...props }, ref) => (
  <TabsPrimitive.List ref={ref} className={cn('inline-flex items-center gap-1', className)} {...props} />
));
List.displayName = TabsPrimitive.List.displayName;

const Tab = React.forwardRef(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium text-stone-600 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-white data-[state=active]:text-stone-950 data-[state=active]:shadow-sm',
      className
    )}
    {...props}
  />
));
Tab.displayName = TabsPrimitive.Trigger.displayName;

const Indicator = ({ className, ...props }) => <span className={cn(className)} aria-hidden="true" {...props} />;

const Panel = React.forwardRef(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn('mt-0 outline-none ring-offset-white focus-visible:ring-2 focus-visible:ring-blue-300', className)}
    {...props}
  />
));
Panel.displayName = TabsPrimitive.Content.displayName;

export const Tabs = {
  Root,
  List,
  Tab,
  Indicator,
  Panel,
};
