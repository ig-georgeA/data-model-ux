import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '../../lib/utils';

const Root = DialogPrimitive.Root;
const Trigger = DialogPrimitive.Trigger;
const Portal = DialogPrimitive.Portal;
const Close = DialogPrimitive.Close;
const Title = DialogPrimitive.Title;
const Description = DialogPrimitive.Description;

const Backdrop = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn('fixed inset-0 z-50 bg-black/30 backdrop-blur-[1px]', className)}
    {...props}
  />
));
Backdrop.displayName = DialogPrimitive.Overlay.displayName;

const Viewport = ({ className, ...props }) => (
  <div className={cn('fixed inset-0 z-50 flex items-center justify-center p-4', className)} {...props} />
);

const Popup = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Content
    ref={ref}
    className={cn('w-full max-w-lg rounded-2xl border border-stone-200 bg-white shadow-2xl', className)}
    {...props}
  />
));
Popup.displayName = DialogPrimitive.Content.displayName;

export const Dialog = {
  Root,
  Trigger,
  Portal,
  Backdrop,
  Viewport,
  Popup,
  Title,
  Description,
  Close,
};
