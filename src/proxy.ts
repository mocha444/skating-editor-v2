import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Clerk middleware + access restriction
// Reads GITHUB_USERNAMES_ALLOWED / GOOGLE_EMAILS_ALLOWED env vars
// If both empty → allows everyone (dev mode)

function parseAllowed(str: string | undefined): Set<string> {
  if (!str || str.trim() === "") return new Set();
  return new Set(
    str
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export default clerkMiddleware(async (auth, req: NextRequest) => {
  const allowedGitHub = parseAllowed(process.env.GITHUB_USERNAMES_ALLOWED);
  const allowedGoogle = parseAllowed(process.env.GOOGLE_EMAILS_ALLOWED);
  const hasRestriction = allowedGitHub.size > 0 || allowedGoogle.size > 0;

  // No allowed list configured → allow everyone (dev mode)
  if (!hasRestriction) {
    return NextResponse.next();
  }

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.redirect(new URL("/sign-in", req.url));
  }

  try {
    const { createClerkClient } = await import("@clerk/backend");
    const client = createClerkClient({
      secretKey: process.env.CLERK_SECRET_KEY!,
    });
    const user = await client.users.getUser(userId);

    let allowed = false;

    // Check GitHub usernames
    if (allowedGitHub.size > 0) {
      const githubAccounts = user.externalAccounts.filter(
        (a) => a.provider === "oauth_github",
      );
      for (const acct of githubAccounts) {
        const username = (acct.username ?? "").toLowerCase();
        if (username && allowedGitHub.has(username)) {
          allowed = true;
          break;
        }
      }
    }

    // Check Google emails
    if (!allowed && allowedGoogle.size > 0) {
      const googleAccounts = user.externalAccounts.filter(
        (a) => a.provider === "oauth_google",
      );
      for (const acct of googleAccounts) {
        const email = (acct.emailAddress ?? "").toLowerCase();
        if (email && allowedGoogle.has(email)) {
          allowed = true;
          break;
        }
      }
    }

    if (!allowed) {
      return NextResponse.redirect(new URL("/access-denied", req.url));
    }
  } catch {
    return NextResponse.redirect(new URL("/sign-in", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)|access-denied|sign-in|sign-up|sso-callback).*)",
    "/(api|trpc)(.*)",
  ],
};
