import SignedOutRedirect from "./SignedOutRedirect";

// eslint-disable-next-line @clerk/next/require-auth-protection -- Client-only route; gated by <SignedOutRedirect>, data access is protected in the API handlers.
export default function EditorLayout({ children }: { children: React.ReactNode }) {
  return <SignedOutRedirect>{children}</SignedOutRedirect>;
}