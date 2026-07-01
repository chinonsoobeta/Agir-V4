import * as React from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type RenderProps = {
  /** Put this on the control (Input/Textarea) or on a SelectTrigger/Switch. */
  id: string;
  /** Feed to `aria-describedby` on the control. Undefined when nothing to describe. */
  "aria-describedby": string | undefined;
  /** Feed to `aria-invalid` on the control. */
  "aria-invalid": true | undefined;
  /** Feed to `aria-required` on the control. */
  "aria-required": true | undefined;
};

export interface FieldProps {
  label: React.ReactNode;
  /** Optional helper text rendered under the control and wired via aria-describedby. */
  description?: React.ReactNode;
  /** Inline validation error. When set, the control is marked invalid + described by it. */
  error?: React.ReactNode;
  required?: boolean;
  className?: string;
  /** Row layout (label beside control) instead of stacked. Used for switch/checkbox rows. */
  orientation?: "vertical" | "horizontal";
  /**
   * Either a single control element (cloned to receive `id`/`aria-*`), or a
   * render function receiving the wiring props – use the function form for
   * composite controls where the id belongs on an inner element (e.g. a
   * shadcn `SelectTrigger` or `Switch`).
   */
  children: React.ReactElement | ((props: RenderProps) => React.ReactNode);
}

/**
 * Associates a label with its control and wires description + error text through
 * `aria-describedby` / `aria-invalid` / `aria-required`. This is the single
 * source of truth for accessible form fields across the app – no bare
 * `<Label>` + `<Input>` pairs, which never associate.
 */
export function Field({
  label,
  description,
  error,
  required,
  className,
  orientation = "vertical",
  children,
}: FieldProps) {
  const uid = React.useId();
  const descId = description ? `${uid}-desc` : undefined;
  const errId = error ? `${uid}-err` : undefined;
  const describedBy = [descId, errId].filter(Boolean).join(" ") || undefined;

  const wiring: RenderProps = {
    id: uid,
    "aria-describedby": describedBy,
    "aria-invalid": error ? true : undefined,
    "aria-required": required ? true : undefined,
  };

  let control: React.ReactNode;
  let controlId = uid;

  if (typeof children === "function") {
    control = children(wiring);
  } else {
    const childProps = children.props as {
      id?: string;
      "aria-invalid"?: boolean;
      "aria-required"?: boolean;
      "aria-describedby"?: string;
    };
    controlId = childProps.id ?? uid;
    control = React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
      id: controlId,
      "aria-invalid": error ? true : childProps["aria-invalid"],
      "aria-required": required ? true : childProps["aria-required"],
      "aria-describedby":
        [childProps["aria-describedby"], describedBy].filter(Boolean).join(" ") || undefined,
    });
  }

  const labelNode = (
    <Label htmlFor={controlId}>
      {label}
      {required && (
        <span className="text-destructive" aria-hidden="true">
          {" "}
          *
        </span>
      )}
    </Label>
  );

  if (orientation === "horizontal") {
    return (
      <div className={cn("flex items-start gap-3", className)}>
        {control}
        <div className="min-w-0 flex-1">
          {labelNode}
          {description && (
            <p id={descId} className="text-xs text-muted-foreground">
              {description}
            </p>
          )}
          {error && (
            <p id={errId} role="alert" className="text-xs text-destructive mt-1">
              {error}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      {labelNode}
      {control}
      {description && (
        <p id={descId} className="text-xs text-muted-foreground">
          {description}
        </p>
      )}
      {error && (
        <p id={errId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
