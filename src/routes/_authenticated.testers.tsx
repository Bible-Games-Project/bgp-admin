import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Apple,
  Copy,
  ExternalLink,
  Link2,
  Loader2,
  Play,
  Send,
  Trash2,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { appStoreIds } from "@/lib/app-kind";
import { listApps } from "@/lib/apps.functions";
import { isCurrentUserAdmin } from "@/lib/deploy.functions";
import {
  type BetaGroup,
  type PlayTesting,
  type TestBuild,
  getPlayTesting,
  getTestFlight,
  inviteBetaTester,
  removeBetaTester,
  sendBuildToBetaTesters,
  setBetaPublicLink,
} from "@/lib/testers.functions";

export const Route = createFileRoute("/_authenticated/testers")({
  // ?app= picks the game, e.g. from the Testers button on a game's page.
  validateSearch: (search: Record<string, unknown>): { app?: string } =>
    typeof search.app === "string" ? { app: search.app } : {},
  component: TestersPage,
});

const TESTER_STATES: Record<string, string> = {
  NOT_INVITED: "invitation waits for a build",
  INVITED: "invited",
  ACCEPTED: "accepted",
  INSTALLED: "installed",
  REVOKED: "removed",
};

const TRACK_LABELS: Record<string, string> = {
  internal: "Internal testing",
  alpha: "Closed testing",
  beta: "Open testing",
};

function copy(text: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success("Copied"),
    () => toast.error("Couldn't copy. Select the link and copy it by hand."),
  );
}

function TestersPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const adminFn = useServerFn(isCurrentUserAdmin);
  const adminQ = useQuery({ queryKey: ["isAdmin"], queryFn: () => adminFn() });
  const listAppsFn = useServerFn(listApps);
  const appsQ = useQuery({
    queryKey: ["apps"],
    queryFn: () => listAppsFn(),
    enabled: !!adminQ.data?.isAdmin,
  });

  if (adminQ.isLoading || appsQ.isLoading) {
    return (
      <div className="p-8 text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (!adminQ.data?.isAdmin) {
    return (
      <div className="p-8 max-w-md">
        <h1 className="text-xl font-display font-semibold">Access denied</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Your account is not authorized to manage testers.
        </p>
      </div>
    );
  }

  const games = (appsQ.data?.apps ?? [])
    .filter((a) => a.is_active)
    .map((a) => ({ id: a.id, name: a.name.trim(), ids: appStoreIds(a) }))
    .filter((a) => a.ids.ios || a.ids.android)
    .sort((a, b) => a.name.localeCompare(b.name));
  const game = games.find((g) => g.id === search.app) ?? games[0];

  return (
    <div className="p-6 md:p-8 max-w-4xl mx-auto w-full space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <span className="label-mono">players</span>
          <h1 className="text-2xl font-display font-semibold tracking-tight mt-1">Testers</h1>
          <p className="text-sm text-muted-foreground mt-1">
            People who try a game before it's published: TestFlight on iPhone and iPad, testing
            tracks on Google Play.
          </p>
        </div>
        {game && (
          <Select
            value={game.id}
            onValueChange={(id) => navigate({ search: { app: id }, replace: true })}
          >
            <SelectTrigger className="w-[260px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {games.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {!game && <p className="text-sm text-muted-foreground">No game is on a store yet.</p>}
      {game?.ids.ios && <TestFlightCard key={`ios-${game.id}`} appId={game.id} />}
      {game?.ids.android && <PlayCard key={`play-${game.id}`} appId={game.id} />}
    </div>
  );
}

/* ------------------------------------------------------------------------------------ */
/* TestFlight                                                                            */
/* ------------------------------------------------------------------------------------ */

function TestFlightCard({ appId }: { appId: string }) {
  const queryClient = useQueryClient();
  const getFn = useServerFn(getTestFlight);
  const q = useQuery({
    queryKey: ["testflight", appId],
    queryFn: () => getFn({ data: { appId } }),
  });
  const reload = () => queryClient.invalidateQueries({ queryKey: ["testflight", appId] });

  const inviteFn = useServerFn(inviteBetaTester);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const invite = useMutation({
    mutationFn: (ascId: string) => {
      const [firstName, ...rest] = name.trim().split(/\s+/);
      return inviteFn({
        data: {
          appId,
          ascId,
          email,
          firstName: firstName || undefined,
          lastName: rest.join(" ") || undefined,
        },
      });
    },
    onSuccess: () => {
      toast.success(`${email} added`, {
        description: "Apple emails the invitation once a build is approved for testing.",
      });
      setEmail("");
      setName("");
      reload();
    },
    onError: (e: Error) => toast.error(e.message, { duration: 15000 }),
  });

  const removeFn = useServerFn(removeBetaTester);
  const remove = useMutation({
    mutationFn: (v: { groupId: string; testerId: string }) => removeFn({ data: v }),
    onSuccess: () => reload(),
    onError: (e: Error) => toast.error(e.message, { duration: 15000 }),
  });

  const linkFn = useServerFn(setBetaPublicLink);
  const link = useMutation({
    mutationFn: (v: { ascId: string; enabled: boolean }) => linkFn({ data: v }),
    onSuccess: () => reload(),
    onError: (e: Error) => toast.error(e.message, { duration: 15000 }),
  });

  const sendFn = useServerFn(sendBuildToBetaTesters);
  const send = useMutation({
    mutationFn: (v: { ascId: string; buildId: string }) => sendFn({ data: { appId, ...v } }),
    onSuccess: ({ submitted }) => {
      toast.success(submitted ? "Sent to Apple for testing" : "Given to the testers", {
        description: submitted
          ? "Apple usually checks it within a day. Then testers get an email and can install it."
          : "Apple had already approved this version for testing, so testers can install it now.",
        duration: 10000,
      });
      reload();
    },
    onError: (e: Error) => toast.error(e.message, { duration: 20000 }),
  });

  const tf = q.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Apple className="h-4 w-4" /> TestFlight
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {q.isLoading && (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Reading TestFlight…
          </p>
        )}
        {q.error && <p className="text-sm text-destructive">{q.error.message}</p>}
        {tf && !tf.found && (
          <p className="text-sm text-muted-foreground">
            {tf.problem ?? "This game isn't on App Store Connect yet, so it has no TestFlight."}
          </p>
        )}
        {tf?.found && (
          <>
            <section className="space-y-1">
              <h3 className="text-sm font-medium">The team</h3>
              <p className="text-sm text-muted-foreground">
                {teamLine(tf.team)} Team members get every build as soon as it's uploaded.
              </p>
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-medium">Build for outside testers</h3>
              <BuildStatus
                build={tf.build}
                ascId={tf.ascId}
                sending={send.isPending}
                onSend={(buildId) => send.mutate({ ascId: tf.ascId, buildId })}
              />
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-medium">Outside testers</h3>
              {tf.external?.testers.length ? (
                <div className="rounded-md border divide-y">
                  {tf.external.testers.map((t) => (
                    <div key={t.id} className="flex items-center gap-3 p-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{t.name || t.email}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {t.name ? `${t.email} · ` : ""}
                          {t.state ? (TESTER_STATES[t.state] ?? t.state.toLowerCase()) : "added"}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        disabled={remove.isPending}
                        onClick={() => {
                          if (confirm(`Remove ${t.email ?? t.name} from the testers?`)) {
                            remove.mutate({ groupId: tf.external!.id, testerId: t.id });
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Nobody outside the team yet.</p>
              )}
              <form
                className="flex flex-wrap gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  invite.mutate(tf.ascId);
                }}
              >
                <Input
                  type="email"
                  required
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full sm:w-64"
                />
                <Input
                  placeholder="Name (optional)"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full sm:w-48"
                />
                <Button type="submit" size="sm" className="h-9" disabled={invite.isPending}>
                  {invite.isPending ? <Loader2 className="animate-spin" /> : <UserPlus />}
                  Invite
                </Button>
              </form>
              <p className="text-xs text-muted-foreground">
                Apple emails each person an invitation to install TestFlight and the game, once a
                build has been approved for testing (see above).
              </p>
            </section>

            <section className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium">Public link</h3>
                  <p className="text-sm text-muted-foreground">
                    Anyone with the link can join, without an invitation. Handy for a class or a
                    group.
                  </p>
                </div>
                <Switch
                  checked={!!tf.external?.publicLinkEnabled}
                  disabled={link.isPending}
                  onCheckedChange={(enabled) => link.mutate({ ascId: tf.ascId, enabled })}
                />
              </div>
              {tf.external?.publicLinkEnabled && tf.external.publicLink && (
                <div className="flex items-center gap-2">
                  <code className="text-xs bg-muted/50 rounded px-2 py-1 truncate">
                    {tf.external.publicLink}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copy(tf.external!.publicLink!)}
                  >
                    <Copy /> Copy
                  </Button>
                </div>
              )}
            </section>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function teamLine(team: BetaGroup[]): string {
  const people = [...new Set(team.flatMap((g) => g.testers.map((t) => t.name || t.email || "")))];
  if (!people.length) return "Nobody on the team tests this game yet.";
  return `${people.join(", ")} ${people.length === 1 ? "tests" : "test"} every build.`;
}

function BuildStatus({
  build,
  ascId,
  sending,
  onSend,
}: {
  build: TestBuild | null;
  ascId: string;
  sending: boolean;
  onSend: (buildId: string) => void;
}) {
  if (!build) {
    return (
      <p className="text-sm text-muted-foreground">
        No build to test yet. Deploy the game to Testing from its Deploy tab first.
      </p>
    );
  }
  const label = `${build.version} (${build.build})`;
  const state = build.externalState ?? "";
  const testflightUrl = `https://appstoreconnect.apple.com/apps/${ascId}/testflight/ios`;
  const sendButton = (text: string) => (
    <Button size="sm" disabled={sending} onClick={() => onSend(build.id)}>
      {sending ? <Loader2 className="animate-spin" /> : <Send />}
      {text}
    </Button>
  );
  const line = (text: string, action?: React.ReactNode) => (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        <span className="text-foreground">Build {label}</span>: {text}
      </p>
      {action}
    </div>
  );
  if (["WAITING_FOR_BETA_REVIEW", "IN_BETA_REVIEW"].includes(state)) {
    return line("Apple is checking it for testing. That usually takes less than a day.");
  }
  if (["BETA_APPROVED", "IN_BETA_TESTING"].includes(state)) {
    return build.inExternalGroup
      ? line("outside testers can install it now.")
      : line(
          "Apple approved it for testing, but outside testers don't have it yet.",
          sendButton("Give it to the testers"),
        );
  }
  if (state === "BETA_REJECTED") {
    return line(
      "Apple refused it for testing. Its reasons are in App Store Connect → TestFlight.",
      <Button asChild size="sm" variant="outline">
        <a href={testflightUrl} target="_blank" rel="noreferrer">
          Open TestFlight <ExternalLink />
        </a>
      </Button>,
    );
  }
  if (state === "MISSING_EXPORT_COMPLIANCE") {
    return line(
      "Apple needs the export compliance answer (whether the game uses encryption) before anyone outside the team can have it. Answer it on the build in App Store Connect → TestFlight.",
      <Button asChild size="sm" variant="outline">
        <a href={testflightUrl} target="_blank" rel="noreferrer">
          Open TestFlight <ExternalLink />
        </a>
      </Button>,
    );
  }
  return line(
    "not sent to outside testers yet. Sending it asks Apple to check it for testing first; after that, testers get an email and can install it.",
    sendButton("Send it to testers"),
  );
}

/* ------------------------------------------------------------------------------------ */
/* Google Play                                                                           */
/* ------------------------------------------------------------------------------------ */

function PlayCard({ appId }: { appId: string }) {
  const getFn = useServerFn(getPlayTesting);
  const q = useQuery({
    queryKey: ["play-testing", appId],
    queryFn: () => getFn({ data: { appId } }),
  });
  const play: PlayTesting | undefined = q.data;
  const joinable = play?.found
    ? play.tracks.filter((t) => t.track !== "internal" && t.releases.length)
    : [];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Play className="h-4 w-4" /> Google Play testing
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {q.isLoading && (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Reading Google Play…
          </p>
        )}
        {q.error && <p className="text-sm text-destructive">{q.error.message}</p>}
        {play && !play.found && (
          <p className="text-sm text-muted-foreground">
            {play.problem ?? "This game isn't on Google Play yet."}
          </p>
        )}
        {play?.found && (
          <>
            <section className="space-y-2">
              <h3 className="text-sm font-medium">Versions being tested</h3>
              {play.tracks.some((t) => t.releases.length) ? (
                <ul className="text-sm text-muted-foreground space-y-1">
                  {play.tracks
                    .filter((t) => t.releases.length)
                    .map((t) => (
                      <li key={t.track}>
                        <span className="text-foreground">{TRACK_LABELS[t.track] ?? t.track}</span>:{" "}
                        {t.releases
                          .map((r) => `${r.name || r.versionCodes.join(", ")} (${r.status})`)
                          .join(", ")}
                        {t.googleGroups.length > 0 && ` · groups: ${t.googleGroups.join(", ")}`}
                      </li>
                    ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No version on a testing track. Deploy the game to Testing from its Deploy tab.
                </p>
              )}
            </section>
            <section className="space-y-2">
              <h3 className="text-sm font-medium">Adding testers</h3>
              <p className="text-sm text-muted-foreground">
                Google doesn't let other tools add testers by email, so this step is in Play
                Console: open the game → Test and release → Internal testing → Testers, add their
                Gmail addresses to the list, and send them the join link shown on that page.
              </p>
              <Button asChild size="sm" variant="outline">
                <a href="https://play.google.com/console" target="_blank" rel="noreferrer">
                  Open Play Console <ExternalLink />
                </a>
              </Button>
            </section>
            {joinable.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-sm font-medium flex items-center gap-2">
                  <Link2 className="h-4 w-4" /> Join link for{" "}
                  {joinable.map((t) => TRACK_LABELS[t.track]).join(" and ")}
                </h3>
                <div className="flex items-center gap-2">
                  <code className="text-xs bg-muted/50 rounded px-2 py-1 truncate">
                    {`https://play.google.com/apps/testing/${play.packageName}`}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copy(`https://play.google.com/apps/testing/${play.packageName}`)}
                  >
                    <Copy /> Copy
                  </Button>
                </div>
              </section>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
