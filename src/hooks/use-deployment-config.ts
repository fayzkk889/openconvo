'use client';

import { useEffect, useState } from 'react';
import { DeploymentConfig } from '@/types/deployment';

const DEFAULT_CONFIG: DeploymentConfig = {
  hostedFreeModeAvailable: false,
  hostedFreeDailyLimit: 20,
  hostedSearchAvailable: false,
  hostedSearchDailyLimit: 5,
};

export function useDeploymentConfig() {
  const [config, setConfig] = useState<DeploymentConfig>(DEFAULT_CONFIG);

  useEffect(() => {
    let mounted = true;

    fetch('/api/config')
      .then((response) => response.ok ? response.json() : DEFAULT_CONFIG)
      .then((data: DeploymentConfig) => {
        if (mounted) setConfig({ ...DEFAULT_CONFIG, ...data });
      })
      .catch(() => {
        if (mounted) setConfig(DEFAULT_CONFIG);
      });

    return () => {
      mounted = false;
    };
  }, []);

  return config;
}
