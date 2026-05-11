import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getAuthenticatedUserFromCookies } from "@/lib/auth/guards";

export default async function Home() {
  const user = await getAuthenticatedUserFromCookies(await cookies());

  if (user) {
    redirect("/workspace");
  }

  redirect("/login");
}
