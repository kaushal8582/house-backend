import { Notification } from '../models/Notification.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';

export const getNotifications = asyncHandler(async (req, res) => {
  const { limit = 50, skip = 0, unreadOnly } = req.query;

  const notifications = await Notification.findByUser(req.user.id, {
    limit: parseInt(limit, 10),
    skip: parseInt(skip, 10),
    unreadOnly: unreadOnly === 'true',
  });

  const unreadCount = await Notification.getUnreadCount(req.user.id);

  res.json({
    success: true,
    data: { notifications, unreadCount },
  });
});

export const markAsRead = asyncHandler(async (req, res) => {
  const notification = await Notification.markAsRead(req.params.notificationId);
  if (!notification) throw new AppError('Notification not found', 404);

  const unreadCount = await Notification.getUnreadCount(req.user.id);

  res.json({
    success: true,
    data: { notification, unreadCount },
  });
});

export const markAllAsRead = asyncHandler(async (req, res) => {
  const modifiedCount = await Notification.markAllAsRead(req.user.id);

  res.json({
    success: true,
    data: { modifiedCount, unreadCount: 0 },
  });
});

export const deleteNotification = asyncHandler(async (req, res) => {
  const deleted = await Notification.delete(req.params.notificationId);
  if (!deleted) throw new AppError('Notification not found', 404);

  const unreadCount = await Notification.getUnreadCount(req.user.id);

  res.json({
    success: true,
    data: { unreadCount },
  });
});

export const getUnreadCount = asyncHandler(async (req, res) => {
  const unreadCount = await Notification.getUnreadCount(req.user.id);
  res.json({ success: true, data: { unreadCount } });
});
