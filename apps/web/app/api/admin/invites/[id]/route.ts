import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@portfolio/db";
import { auth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";

/**
 * DELETE /api/admin/invites/[id]
 *   Revoke an unused invite by setting expiresAt to the past. We do NOT
 *   hard-delete so the audit trail (who created it, when) is preserved.
 *
 * If the invite is already used, returns 409 — we never want to yank an
 * account that's been claimed.
 */
export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isAdmin: true }
  });
  if (!me?.isAdmin) {
    return NextResponse.json({ error: "Admin required." }, { status: 403 });
  }

  try {
    const existing = await prisma.signupInvite.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: "Invite not found." },
        { status: 404 }
      );
    }
    if (existing.usedAt) {
      return NextResponse.json(
        { error: "Invite already used; cannot revoke." },
        { status: 409 }
      );
    }
    await prisma.signupInvite.update({
      where: { id },
      data: { expiresAt: new Date(0) }
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Unable to revoke invite.") },
      { status: 500 }
    );
  }
}
