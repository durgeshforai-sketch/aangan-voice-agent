import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { COOKIE, passwordMatches, sessionToken } from "@/lib/auth";

async function login(formData: FormData) {
  "use server";
  const next = String(formData.get("next") || "/");
  if (!passwordMatches(String(formData.get("password") ?? ""))) redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
  (await cookies()).set(COOKIE, sessionToken(), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 60 * 60 * 24 * 30, path: "/" });
  redirect(next.startsWith("/") ? next : "/");
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  return (
    <main className="login">
      <form action={login} className="card login-card">
        <h1>Aangan Studio</h1>
        <p className="muted">Enquiry dashboard</p>
        <input type="hidden" name="next" value={sp.next ?? "/"} />
        <label>
          Password
          <input type="password" name="password" autoFocus required />
        </label>
        {sp.error && <p className="error">That password didn&apos;t match.</p>}
        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}
