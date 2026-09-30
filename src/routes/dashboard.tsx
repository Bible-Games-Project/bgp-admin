import { createFileRoute, redirect } from "@tanstack/react-router";

// Deploying moved into each app's Deploy tab, and the console now opens on Home. The
// old address still works for bookmarks and for console builds that link here.
export const Route = createFileRoute("/dashboard")({
  beforeLoad: () => {
    throw redirect({ to: "/" });
  },
});
