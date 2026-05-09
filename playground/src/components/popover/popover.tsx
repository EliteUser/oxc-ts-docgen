import type { Placement } from "@floating-ui/react";
import type { ButtonHTMLAttributes, ComponentPropsWithoutRef, MouseEvent, ReactNode } from "react";

import {
  autoUpdate,
  flip,
  FloatingNode,
  FloatingFocusManager,
  FloatingPortal,
  FloatingTree,
  offset,
  shift,
  size,
  useDismiss,
  useFloating,
  useFloatingNodeId,
  useFloatingParentNodeId,
  useInteractions,
  useMergeRefs,
  useRole,
} from "@floating-ui/react";
import { createContext, forwardRef, useCallback, useContext, useMemo, useState } from "react";

type PopoverRootProps = {
  /**
   * Compound popover children.
   */
  children: ReactNode;
  /**
   * Controlled open state.
   */
  open?: boolean;
  /**
   * Initial open state for uncontrolled usage.
   */
  defaultOpen?: boolean;
  /**
   * Receives open state changes from trigger and dismissal interactions.
   */
  onOpenChange?: (open: boolean) => void;
  /**
   * Floating placement relative to the active trigger.
   */
  placement?: Placement;
  /**
   * Whether focus is trapped inside the popover content.
   */
  modal?: boolean;
};

type PopoverContextValue = {
  /**
   * Current open state.
   */
  open: boolean;
  /**
   * Updates the current open state.
   */
  setOpen: (open: boolean) => void;
  /**
   * Whether content focus is modal.
   */
  modal: boolean;
  /**
   * Floating UI controller result.
   */
  floating: ReturnType<typeof useFloating>;
  /**
   * Floating tree node id for nested portal communication.
   */
  nodeId: string | undefined;
  /**
   * Props getter for trigger elements.
   */
  getReferenceProps: ReturnType<typeof useInteractions>["getReferenceProps"];
  /**
   * Props getter for content elements.
   */
  getFloatingProps: ReturnType<typeof useInteractions>["getFloatingProps"];
};

const PopoverContext = createContext<PopoverContextValue | null>(null);

const usePopoverContext = () => {
  const context = useContext(PopoverContext);

  if (!context) {
    throw new Error("Popover components must be rendered inside Popover.Root.");
  }

  return context;
};

const Root = (props: PopoverRootProps) => {
  const parentId = useFloatingParentNodeId();

  if (parentId === null) {
    return (
      <FloatingTree>
        <RootContent {...props} />
      </FloatingTree>
    );
  }

  return <RootContent {...props} />;
};

const RootContent = (props: PopoverRootProps) => {
  const {
    children,
    defaultOpen = false,
    modal = true,
    onOpenChange,
    open: controlledOpen,
    placement = "bottom-start",
  } = props;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const nodeId = useFloatingNodeId();
  const open = controlledOpen ?? uncontrolledOpen;

  const setOpen = useCallback(
    (nextOpen: boolean) => {
      if (controlledOpen === undefined) {
        setUncontrolledOpen(nextOpen);
      }

      onOpenChange?.(nextOpen);
    },
    [controlledOpen, onOpenChange],
  );

  const floating = useFloating({
    middleware: [
      offset(6),
      flip({
        padding: 8,
      }),
      shift({
        padding: 8,
      }),
      size({
        padding: 8,
        apply(options) {
          const maxWidth = Math.max(280, Math.min(560, options.availableWidth));
          const maxHeight = Math.max(160, Math.min(520, options.availableHeight));
          Object.assign(options.elements.floating.style, {
            maxHeight: `${maxHeight}px`,
            maxWidth: `${maxWidth}px`,
          });
        },
      }),
    ],
    nodeId,
    onOpenChange: setOpen,
    open,
    placement,
    strategy: "fixed",
    whileElementsMounted: autoUpdate,
  });
  const dismiss = useDismiss(floating.context, {
    bubbles: {
      escapeKey: false,
      outsidePress: false,
    },
    outsidePressEvent: "mousedown",
  });
  const role = useRole(floating.context, {
    role: "dialog",
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([dismiss, role]);
  const value = useMemo<PopoverContextValue>(() => {
    return {
      open,
      setOpen,
      modal,
      floating,
      nodeId,
      getReferenceProps,
      getFloatingProps,
    };
  }, [floating, getFloatingProps, getReferenceProps, modal, nodeId, open, setOpen]);

  return <PopoverContext.Provider value={value}>{children}</PopoverContext.Provider>;
};

type PopoverTriggerProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /**
   * Whether pressing an open trigger closes the popover.
   */
  toggleOnClick?: boolean;
};

const Trigger = forwardRef<HTMLButtonElement, PopoverTriggerProps>((props, forwardedRef) => {
  const { onClick, toggleOnClick = true, ...buttonProps } = props;
  const context = usePopoverContext();
  const ref = useMergeRefs([context.floating.refs.setReference, forwardedRef]);

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    context.floating.refs.setReference(event.currentTarget);
    onClick?.(event);

    if (event.defaultPrevented) {
      return;
    }

    context.setOpen(toggleOnClick ? !context.open : true);
  };

  return (
    <button
      ref={ref}
      type="button"
      data-state={context.open ? "open" : "closed"}
      {...context.getReferenceProps({
        ...buttonProps,
        onClick: handleClick,
      })}
    />
  );
});

type PopoverContentProps = ComponentPropsWithoutRef<"div">;

const Content = forwardRef<HTMLDivElement, PopoverContentProps>((props, forwardedRef) => {
  const { children, style, ...contentProps } = props;
  const context = usePopoverContext();
  const ref = useMergeRefs([context.floating.refs.setFloating, forwardedRef]);

  if (!context.open) {
    return null;
  }

  return (
    <FloatingNode id={context.nodeId}>
      <FloatingPortal>
        <FloatingFocusManager context={context.floating.context} modal={context.modal}>
          <div
            ref={ref}
            data-state="open"
            style={{
              ...context.floating.floatingStyles,
              ...style,
            }}
            {...context.getFloatingProps(contentProps)}
          >
            {children}
          </div>
        </FloatingFocusManager>
      </FloatingPortal>
    </FloatingNode>
  );
});

type PopoverCloseProps = ButtonHTMLAttributes<HTMLButtonElement>;

const Close = forwardRef<HTMLButtonElement, PopoverCloseProps>((props, forwardedRef) => {
  const { onClick, ...buttonProps } = props;
  const context = usePopoverContext();

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    onClick?.(event);

    if (event.defaultPrevented) {
      return;
    }

    context.setOpen(false);
  };

  return <button ref={forwardedRef} type="button" {...buttonProps} onClick={handleClick} />;
});

Trigger.displayName = "Popover.Trigger";
Content.displayName = "Popover.Content";
Close.displayName = "Popover.Close";

export const Popover = {
  Root,
  Trigger,
  Content,
  Close,
};
