import { prisma } from "@portfolio/db";
import { getAppEnv } from "./env";

export async function listLinkedAccounts() {
  const { defaultUserEmail } = getAppEnv();

  const user = await prisma.user.findUnique({
    where: {
      email: defaultUserEmail
    },
    select: {
      id: true,
      email: true,
      accounts: {
        where: {
          isActive: true
        },
        orderBy: [
          {
            plaidItem: {
              institutionName: "asc"
            }
          },
          {
            name: "asc"
          }
        ],
        select: {
          id: true,
          plaidAccountId: true,
          name: true,
          officialName: true,
          mask: true,
          subtype: true,
          type: true,
          currentBalance: true,
          availableBalance: true,
          isoCurrencyCode: true,
          plaidItem: {
            select: {
              id: true,
              institutionId: true,
              institutionName: true,
              status: true,
              errorCode: true,
              plaidEnvironment: true,
              lastWebhookAt: true,
              lastSyncedAt: true,
              updatedAt: true
            }
          }
        }
      }
    }
  });

  return {
    userEmail: user?.email ?? defaultUserEmail,
    accounts: user?.accounts ?? []
  };
}
