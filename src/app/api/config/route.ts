import { DeploymentConfig } from '@/types/deployment';

export function GET() {
  const config: DeploymentConfig = {
    hostedFreeModeAvailable: Boolean(process.env.OPENROUTER_API_KEY),
    hostedFreeDailyLimit: getHostedFreeDailyLimit(),
  };

  return Response.json(config);
}

function getHostedFreeDailyLimit(): number {
  const value = Number(process.env.OPENCONVO_HOSTED_FREE_DAILY_LIMIT || 20);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 20;
}
