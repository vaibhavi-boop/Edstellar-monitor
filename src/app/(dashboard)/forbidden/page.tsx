import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/layout/empty-state";

export const metadata = { title: "No access" };

export default function Forbidden() {
  return (
    <EmptyState
      icon={ShieldAlert}
      title="Your role does not include this page"
      action={
        <Button asChild variant="outline">
          <Link href="/">Back to overview</Link>
        </Button>
      }
      className="py-24"
    >
      Ask an administrator to change your role if you need access.
    </EmptyState>
  );
}
