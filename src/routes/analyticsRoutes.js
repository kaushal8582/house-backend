import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import {
  getDashboardStats,
  getProjectAnalytics,
  getUserPerformance,
  getActivityTimeline,
  getTaskTrends,
  getTeamVelocity,
  getWorkDistribution,
  getProductivityMetrics,
  exportAnalytics,
  getUpcomingDeadlines,
} from '../controllers/analyticsController.js';
import { validate, validateObjectIdParam, schemas } from '../middleware/validation.js';

const router = Router();

router.use(verifyToken);

router.get('/dashboard', validate(schemas.analyticsQuery, 'query'), getDashboardStats);
router.get('/projects/:projectId', validateObjectIdParam('projectId'), validate(schemas.analyticsQuery, 'query'), getProjectAnalytics);
router.get('/users/performance', validate(schemas.analyticsQuery, 'query'), getUserPerformance);
router.get('/activity', validate(schemas.analyticsQuery, 'query'), getActivityTimeline);
router.get('/tasks/trends', validate(schemas.analyticsQuery, 'query'), getTaskTrends);
router.get('/tasks/deadlines', validate(schemas.analyticsQuery, 'query'), getUpcomingDeadlines);
router.get('/team/velocity', validate(schemas.analyticsQuery, 'query'), getTeamVelocity);
router.get('/work/distribution', validate(schemas.analyticsQuery, 'query'), getWorkDistribution);
router.get('/productivity', validate(schemas.analyticsQuery, 'query'), getProductivityMetrics);
router.get('/export', validate(schemas.analyticsQuery, 'query'), exportAnalytics);

export default router;
