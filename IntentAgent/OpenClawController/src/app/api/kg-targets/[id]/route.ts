import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { deleteRepository } from "@/lib/graphdb/client";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function DELETE(request: Request, context: RouteContext) {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const target = await db.knowledgeGraphTarget.findFirst({
    where: {
      id,
      userId: user.id,
    },
  });

  if (!target) {
    return NextResponse.json({ error: "Knowledge graph target not found" }, { status: 404 });
  }

  await deleteRepository({
    repositoryId: target.repositoryId,
  });

  await db.knowledgeGraphTarget.delete({
    where: {
      id: target.id,
    },
  });

  return NextResponse.json({ deletedTargetId: target.id });
}
