import Link from "next/link";

/** Privacy / Terms links shown under the auth card (login, signup, forgot-password). */
export function AuthLegalFooter() {
  return (
    <p className="mt-6 text-center text-xs text-slate-500">
      By continuing you agree to our{" "}
      <Link href="/terms" className="text-slate-400 hover:text-slate-300">
        Terms
      </Link>{" "}
      and{" "}
      <Link href="/privacy" className="text-slate-400 hover:text-slate-300">
        Privacy Policy
      </Link>
      .
    </p>
  );
}
