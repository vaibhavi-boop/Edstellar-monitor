"use client";
import Link from "next/link";
import { LogOut, UserRound, Users } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { logout } from "@/server/auth/actions";

export function UserMenu({ name, email, roleLabel, isAdmin }: { name: string; email: string; roleLabel: string; isAdmin: boolean }) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex size-9 items-center justify-center rounded-full bg-primary-soft text-[13px] font-semibold text-primary"
        aria-label={`Account menu for ${name}`}
      >
        {initials}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>
          <p className="font-medium">{name}</p>
          <p className="truncate text-[13px] font-normal text-muted-foreground">{email}</p>
          <p className="mt-1 text-xs font-normal text-muted-foreground">{roleLabel}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <UserRound /> Account settings
          </Link>
        </DropdownMenuItem>
        {isAdmin && (
          <DropdownMenuItem asChild>
            <Link href="/settings/users">
              <Users /> Team access
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void logout()}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
