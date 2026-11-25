"use client";
import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Brand } from "./brand";
import { SidebarNav } from "./sidebar-nav";

export function MobileNav() {
  const [open, setOpen] = useState(false);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
          <Menu />
        </Button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/50 lg:hidden" />
        <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 w-72 overflow-y-auto bg-rail lg:hidden">
          <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
          <div className="flex h-14 items-center justify-between border-b border-white/10 px-5">
            <Brand />
            <DialogPrimitive.Close className="rounded p-1 text-rail-foreground hover:bg-rail-active" aria-label="Close navigation">
              <X className="size-4" />
            </DialogPrimitive.Close>
          </div>
          <SidebarNav onNavigate={() => setOpen(false)} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
