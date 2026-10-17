/**
 * Boot-time registration of the school host: the account auth method and the
 * library hook. Called once from `instrumentation.ts` when server persistence
 * is configured; without a database there are no accounts to resolve.
 */
import { configureOwnerAuthentication, sharedTeamAuthMethod } from '@/lib/server/identity';
import { schoolSessionAuthMethod } from '@/lib/server/identity/host/school-session';
import { configurePersistenceHooks } from '@/lib/server/persistence-hooks';

import { schoolPersistenceHooks } from './hooks';

export function registerSchoolHost(): void {
  // A deployment that still wants one shared team owner keeps it last, as the
  // identity seam requires; the variable without the method fails the boot.
  const methods = process.env.PERSISTENCE_SHARED_OWNER_ID?.trim()
    ? [schoolSessionAuthMethod, sharedTeamAuthMethod()]
    : [schoolSessionAuthMethod];
  configureOwnerAuthentication({ methods });
  configurePersistenceHooks(schoolPersistenceHooks);
}
