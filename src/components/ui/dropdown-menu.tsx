"use client";
import * as React from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils";

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;

export function DropdownMenuContent({ className, sideOffset = 6, ...props }: React.ComponentProps<typeof Menu.Content>) {
  return (
    <Menu.Portal>
      <Menu.Content
        sideOffset={sideOffset}
        className={cn("z-50 min-w-48 rounded-md border bg-surface p-1 text-sm shadow-lg", className)}
        {...props}
      />
    </Menu.Portal>
  );
}
export function DropdownMenuItem({ className, ...props }: React.ComponentProps<typeof Menu.Item>) {
  return (
    <Menu.Item
      className={cn(
        "flex cursor-default select-none items-center gap-2 rounded px-2 py-1.5 outline-none data-[highlighted]:bg-surface-muted [&_svg]:size-4 [&_svg]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
export function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof Menu.Label>) {
  return <Menu.Label className={cn("px-2 py-1.5", className)} {...props} />;
}
export function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof Menu.Separator>) {
  return <Menu.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />;
}
