import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import {
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getUnreadCount,
} from '../controllers/notificationController.js';
import { validateObjectIdParam } from '../middleware/validation.js';

const router = Router();

router.use(verifyToken);

router.get('/', getNotifications);
router.get('/unread-count', getUnreadCount);
router.patch('/read-all', markAllAsRead);
router.patch('/:notificationId/read', validateObjectIdParam('notificationId'), markAsRead);
router.delete('/:notificationId', validateObjectIdParam('notificationId'), deleteNotification);

export default router;
