import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/forbidden")({
  head: () => ({ meta: [{ title: "Forbidden — bgp console" }] }),
  component: ForbiddenPage,
});

function ForbiddenPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm text-center">
        <ShieldAlert className="h-8 w-8 text-destructive mx-auto" />
        <h1 className="text-2xl font-display font-semibold tracking-tight mt-4">
          Access denied
        </h1>
        <p className="text-sm text-muted-foreground mt-2">
          Your account is not authorized for this console.
        </p>
        <Button asChild variant="outline" className="mt-6">
          <Link to="/login">Back to sign in</Link>
        </Button>
      </div>
    </div>
  );
}
