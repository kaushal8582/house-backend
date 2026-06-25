import cron from 'node-cron';
import logger from '../utils/logger.js';

export function startHealthCheckCron(port) {
  const healthUrl = process.env.HEALTH_CHECK_URL || `http://localhost:${port}/api/health`;

  const checkHealth = async () => {
    try {
      const response = await fetch(healthUrl);
      const data = await response.json();

      if (response.ok && data.success) {
        logger.info({ healthUrl, status: response.status }, 'Health check passed');
        return;
      }

      logger.warn({ healthUrl, status: response.status, data }, 'Health check failed');
    } catch (error) {
      logger.error({ err: error, healthUrl }, 'Health check request failed');
    }
  };

  cron.schedule('*/3 * * * *', checkHealth);

  logger.info({ schedule: 'every 3 minutes', healthUrl }, 'Health check cron started');
}
