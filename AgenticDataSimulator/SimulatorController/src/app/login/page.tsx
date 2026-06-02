import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { withAppBasePath } from "@/lib/app-paths";
import { getAuthenticatedUserFromCookies } from "@/lib/auth/guards";

type LoginPageProps = {
  searchParams?: Promise<{
    error?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const user = await getAuthenticatedUserFromCookies(await cookies());

  if (user) {
    redirect("/workspace");
  }

  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const errorMessage = resolvedSearchParams?.error?.trim();

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <span className="eyebrow">INTEND Controller</span>
        <h1>Sign in to Controller Studio</h1>
        <p className="lead">
          Create a local account or sign in to start building two-stage controller
          scripts.
        </p>

        {errorMessage ? (
          <p className="auth-error" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <div className="auth-grid">
          <form action={withAppBasePath("/api/auth/login")} className="auth-form" method="post">
            <h2>Sign in</h2>
            <label className="workspace-label" htmlFor="login-username">
              Username
            </label>
            <input
              className="workspace-input"
              id="login-username"
              name="username"
              required
            />
            <label className="workspace-label" htmlFor="login-password">
              Password
            </label>
            <input
              className="workspace-input"
              id="login-password"
              name="password"
              required
              type="password"
            />
            <button className="workspace-button" type="submit">
              Sign in
            </button>
          </form>

          <form
            action={withAppBasePath("/api/auth/register")}
            className="auth-form"
            method="post"
          >
            <h2>Create user</h2>
            <label className="workspace-label" htmlFor="register-username">
              Username
            </label>
            <input
              className="workspace-input"
              id="register-username"
              minLength={3}
              name="username"
              required
            />
            <label className="workspace-label" htmlFor="register-password">
              Password
            </label>
            <input
              className="workspace-input"
              id="register-password"
              minLength={8}
              name="password"
              required
              type="password"
            />
            <p className="auth-form-hint">Use at least 3 characters for username and 8 for password.</p>
            <button className="workspace-button workspace-button-secondary" type="submit">
              Create user
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
