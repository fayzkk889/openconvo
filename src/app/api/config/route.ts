import { DeploymentConfig } from '@/types/deployment';
import { hostedOpenRouterKey, isHostedFreeEnabled } from '@/lib/hosted-mode';

export function GET() {
  const config: DeploymentConfig = {
    hostedFreeModeAvailable: Boolean(hostedOpenRouterKey()),
    hostedFreeDailyLimit: getHostedFreeDailyLimit(),
    hostedSearchAvailable: isHostedFreeEnabled(),
    hostedSearchDailyLimit: getHostedSearchDailyLimit(),
  };

  return Response.json(config);
}

function getHostedFreeDailyLimit(): number {
  const value = Number(process.env.OPENCONVO_HOSTED_FREE_DAILY_LIMIT || 20);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 20;
}

function getHostedSearchDailyLimit(): number {
  const value = Number(process.env.OPENCONVO_HOSTED_SEARCH_DAILY_LIMIT || 5);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 5;
}
