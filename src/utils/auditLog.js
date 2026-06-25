import { ObjectId } from 'mongodb';
import { getDb } from '../config/database.js';

const COLLECTION = 'audit_logs';

function getCollection() {
  return getDb().collection(COLLECTION);
}

function toObjectId(id) {
  if (!id) return null;
  if (id instanceof ObjectId) return id;
  if (!ObjectId.isValid(id)) return null;
  return new ObjectId(id);
}

export const AuditLog = {
  async log({
    action,
    entityType,
    entityId,
    userId,
    workspaceId,
    projectId,
    metadata = {},
    changes = null,
  }) {
    const entry = {
      action,
      entityType,
      entityId: entityId ? toObjectId(entityId) : null,
      userId: toObjectId(userId),
      workspaceId: workspaceId ? toObjectId(workspaceId) : null,
      projectId: projectId ? toObjectId(projectId) : null,
      metadata,
      changes,
      createdAt: new Date(),
    };

    const result = await getCollection().insertOne(entry);
    return { ...entry, _id: result.insertedId };
  },

  async getByEntity(entityType, entityId, { limit = 50, skip = 0 } = {}) {
    const pipeline = [
      {
        $match: {
          entityType,
          entityId: toObjectId(entityId),
        },
      },
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'user',
        },
      },
      { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          action: 1,
          entityType: 1,
          metadata: 1,
          changes: 1,
          createdAt: 1,
          user: {
            _id: '$user._id',
            name: '$user.name',
            email: '$user.email',
          },
        },
      },
    ];

    return getCollection().aggregate(pipeline).toArray();
  },

  async getProjectActivity(projectId, { limit = 20, skip = 0 } = {}) {
    return this.getByEntity('project', projectId, { limit, skip });
  },

  async getTaskHistory(projectId, taskId, { limit = 50 } = {}) {
    return getCollection()
      .find({
        entityType: 'task',
        entityId: toObjectId(taskId),
        projectId: toObjectId(projectId),
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
  },

  async getActivityTimeline(workspaceId, { startDate, endDate, limit = 50 } = {}) {
    const match = { workspaceId: toObjectId(workspaceId) };
    if (startDate || endDate) {
      match.createdAt = {};
      if (startDate) match.createdAt.$gte = new Date(startDate);
      if (endDate) match.createdAt.$lte = new Date(endDate);
    }

    const pipeline = [
      { $match: match },
      { $sort: { createdAt: -1 } },
      { $limit: limit },
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'user',
        },
      },
      { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          action: 1,
          entityType: 1,
          entityId: 1,
          metadata: 1,
          createdAt: 1,
          user: { _id: '$user._id', name: '$user.name' },
        },
      },
    ];

    return getCollection().aggregate(pipeline).toArray();
  },
};

export async function auditLog(req, data) {
  return AuditLog.log({
    ...data,
    userId: req.user?.id,
  });
}
