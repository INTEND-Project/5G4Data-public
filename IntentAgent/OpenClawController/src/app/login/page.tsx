import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { withAppBasePath } from "@/lib/app-paths";
import { getAuthenticatedUserFromCookies } from "@/lib/auth/guards";

export default async function LoginPage() {
  const user = await getAuthenticatedUserFromCookies(await cookies());

  if (user) {
    redirect("/workspace");
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <span className="eyebrow">INTEND Controller</span>
        <h1>Sign in to OpenClaw Controller</h1>
        <p className="lead">
          Create a local account or sign in to start building two-stage controller
          scripts.
        </p>

        <div className="auth-grid">
          <form action={withAppBasePath("/api/auth/login")} className="auth-form" method="post">
            <h2>Sign in</h2>
            <label className="workspace-label" htmlFor="login-username">
              Username
            </label>
            <input className="workspace-input" id="login-username" name="username" />
            <label className="workspace-label" htmlFor="login-password">
              Password
            </label>
            <input
              className="workspace-input"
              id="login-password"
              name="password"
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
            <input className="workspace-input" id="register-username" name="username" />
            <label className="workspace-label" htmlFor="register-password">
              Password
            </label>
            <input
              className="workspace-input"
              id="register-password"
              name="password"
              type="password"
            />
            <button className="workspace-button workspace-button-secondary" type="submit">
              Create user
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
