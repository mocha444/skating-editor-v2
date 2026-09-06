"use client";
import { UserButton, useUser } from "@clerk/nextjs";
import { useClerk } from "@clerk/nextjs";

import { useState } from "react";
import { Mail } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

export default function AccessDeniedPage() {
  const [sentHint, setSentHint] = useState(false);
  const { isLoaded, isSignedIn, user } = useUser();
  const { client } = useClerk();

  let usernameOrEmail: string | null = null;

  if (isLoaded && isSignedIn && user) {
    const lastStrategy = client?.lastAuthenticationStrategy;

    if (lastStrategy === "oauth_github") {
      usernameOrEmail =
        user.externalAccounts.find((a) => a.provider === "github")?.username ??
        user.username;
    } else if (lastStrategy === "oauth_google") {
      usernameOrEmail =
        user.primaryEmailAddress?.emailAddress ??
        user.emailAddresses[0]?.emailAddress ??
        null;
    } else {
      // Fallback
      usernameOrEmail =
        user.externalAccounts.find((a) => a.provider === "github")?.username ??
        user.primaryEmailAddress?.emailAddress ??
        user.emailAddresses[0]?.emailAddress ??
        null;
    }
  }

  const openGmailInvite = () => {
    if (!usernameOrEmail) return;

    const to = "invites@skating.swerv.online";
    const subject = encodeURIComponent("Invite request — skating.swerv.online");

    let details = "Hello,\n\nI would like access to skating.swerv.online.\n\n";

    if (usernameOrEmail.includes("@")) {
      details += `My email: ${usernameOrEmail}\n`;
    } else {
      details += `My GitHub username: ${usernameOrEmail}\n`;
    }

    details += "\nThanks!";

    const body = encodeURIComponent(details);

    window.open(
      `https://mail.google.com/mail/?view=cm&fs=1&to=${to}&su=${subject}&body=${body}`,
      "_blank",
      "noopener,noreferrer",
    );

    setSentHint(true);
    setTimeout(() => setSentHint(false), 4000);
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center px-4 py-8">
      <div className="w-full rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-6"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="m4.93 4.93 14.14 14.14" />
          </svg>
        </div>

        <h1 className="mb-2 text-2xl font-semibold tracking-tight">
          Access denied
        </h1>

        <div className="mb-5 min-h-[44px] flex items-center justify-center">
          {usernameOrEmail ? (
            <div className="flex items-center text-sm text-muted-foreground">
              <UserButton showName />
              <span className="font-semibold ml-2">
                is not on the allow list
              </span>
            </div>
          ) : (
            <Skeleton className="h-[44px] w-full max-w-xs rounded-lg" />
          )}
        </div>

        <p className="mb-5 text-sm text-muted-foreground">
          This site is invite-only. Open Gmail to request access from the site
          owner.
        </p>

        <div className="min-h-[44px] flex items-center justify-center">
          {usernameOrEmail ? (
            <Button
              size="lg"
              onClick={openGmailInvite}
              className="gap-2 px-5 font-semibold"
            >
              <Mail className="size-4" />
              Open Gmail to request access
            </Button>
          ) : (
            <Skeleton className="h-[44px] w-[220px] rounded-md" />
          )}
        </div>

        {sentHint && (
          <p className="mt-4 text-xs font-medium text-muted-foreground animate-pulse">
            Gmail should have opened in a new tab. Fill in your details, then
            send.
          </p>
        )}
      </div>
    </main>
  );
}
