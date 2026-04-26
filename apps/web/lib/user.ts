import { prisma } from "@portfolio/db";
import { getAppEnv } from "./env";

export async function getOrCreateDefaultUser() {
  const { defaultUserEmail } = getAppEnv();

  return prisma.user.upsert({
    where: {
      email: defaultUserEmail
    },
    update: {},
    create: {
      email: defaultUserEmail,
      displayName: "Primary User"
    }
  });
}
