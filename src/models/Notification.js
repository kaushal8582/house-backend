import { ObjectId } from 'mongodb';
import { getDb } from '../config/database.js';

const COLLECTION = 'notifications';

function getCollection() {
  return getDb().collection(COLLECTION);
}

function toObjectId(id) {
  if (id instanceof ObjectId) return id;
  if (!ObjectId.isValid(id)) throw new Error('Invalid notification ID');
  return new ObjectId(id);
}

export const Notification = {
  async create(notificationData) {
    const {
      userId,
      type,
      title,
      message,
      link,
      metadata = {},
    } = notificationData;

    const notification = {
      userId: toObjectId(userId),
      type,
      title,
      message,
      link: link || null,
      metadata,
      read: false,
      createdAt: new Date(),
    };

    const result = await getCollection().insertOne(notification);
    return { ...notification, _id: result.insertedId };
  },

  async findByUser(userId, { limit = 50, skip = 0, unreadOnly = false } = {}) {
    const filter = { userId: toObjectId(userId) };
    if (unreadOnly) filter.read = false;

    return getCollection()
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();
  },

  async markAsRead(notificationId) {
    const result = await getCollection().findOneAndUpdate(
      { _id: toObjectId(notificationId) },
      { $set: { read: true, readAt: new Date() } },
      { returnDocument: 'after' }
    );

    return result;
  },

  async markAllAsRead(userId) {
    const result = await getCollection().updateMany(
      { userId: toObjectId(userId), read: false },
      { $set: { read: true, readAt: new Date() } }
    );

    return result.modifiedCount;
  },

  async delete(notificationId) {
    const result = await getCollection().deleteOne({
      _id: toObjectId(notificationId),
    });
    return result.deletedCount > 0;
  },

  async getUnreadCount(userId) {
    return getCollection().countDocuments({
      userId: toObjectId(userId),
      read: false,
    });
  },
};
