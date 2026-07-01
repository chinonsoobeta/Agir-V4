import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          // Map toast intent to the reserved doctrine: approval=success (emerald),
          // conditions=warning (amber), risk/failure=destructive (crimson).
          success:
            "group-[.toaster]:!border-success/40 group-[.toaster]:![&_[data-icon]]:text-success",
          warning:
            "group-[.toaster]:!border-warning/40 group-[.toaster]:![&_[data-icon]]:text-warning",
          error:
            "group-[.toaster]:!border-destructive/40 group-[.toaster]:![&_[data-icon]]:text-destructive",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
