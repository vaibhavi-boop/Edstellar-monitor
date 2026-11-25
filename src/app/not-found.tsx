import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-sm text-muted-foreground">404</p>
      <h1 className="text-xl font-semibold">This page does not exist</h1>
      <p className="text-sm text-muted-foreground">Check the address, or go back to the overview.</p>
      <Button asChild className="mt-2">
        <Link href="/">Go to overview</Link>
      </Button>
    </main>
  );
}
