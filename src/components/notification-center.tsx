import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { listNotifications, markNotificationRead } from "@/lib/operating-depth.functions";
import { usePreferences } from "@/lib/preferences";
import type { Tables } from "@/integrations/supabase/types";

type NotificationRow = Tables<"notifications">;

export function NotificationCenter() {
  const qc = useQueryClient();
  const { t, tx, fmt } = usePreferences();
  const markFn = useServerFn(markNotificationRead);
  const query = useQuery({
    queryKey: ["notifications"],
    queryFn: () => listNotifications(),
    refetchInterval: 60_000,
  });
  const mark = useMutation({
    mutationFn: (id: string) => markFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const items = query.data ?? [];
  const unread = items.filter((item: NotificationRow) => !item.read_at).length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative size-8"
          aria-label={
            unread > 0
              ? `${t("notifications.title")}, ${tx("notifications.unread", { count: unread })}`
              : t("notifications.title")
          }
        >
          <Bell className="size-4" />
          {unread > 0 && (
            <span
              aria-hidden="true"
              className="absolute -right-0.5 -top-0.5 min-w-4 h-4 rounded-full bg-primary text-primary-foreground text-[11px] tabular-nums flex items-center justify-center px-1"
            >
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between">
          {t("notifications.title")}
          <span className="text-[11px] text-muted-foreground font-normal">
            {tx("notifications.unread", { count: unread })}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="max-h-96 overflow-y-auto">
          {items.length ? (
            items.slice(0, 12).map((item: NotificationRow) => (
              <Link
                key={item.id}
                to={(item.action_url || "/dashboard") as string}
                onClick={() => !item.read_at && mark.mutate(item.id)}
                className={`block px-3 py-2.5 border-b border-border last:border-0 hover:bg-accent/50 ${
                  item.read_at ? "opacity-65" : ""
                }`}
              >
                <div className="flex items-start gap-2">
                  {!item.read_at ? (
                    <span className="size-2 mt-1.5 rounded-full bg-primary shrink-0" />
                  ) : (
                    <CheckCheck className="size-3.5 mt-0.5 text-muted-foreground shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="text-xs font-medium">{item.title}</div>
                    {item.body && (
                      <div className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
                        {item.body}
                      </div>
                    )}
                    <div className="text-[11px] text-muted-foreground mt-1">
                      {fmt.date(item.created_at, { dateStyle: "medium", timeStyle: "short" })}
                    </div>
                  </div>
                </div>
              </Link>
            ))
          ) : (
            <div className="p-8 text-center text-xs text-muted-foreground">
              {t("notifications.caughtUp")}
            </div>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
