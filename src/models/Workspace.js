import { ObjectId } from 'mongodb';
import { getDb } from '../config/database.js';
import { generateSlug } from '../utils/helpers.js';

const COLLECTION = 'workspaces';

function getCollection() {
  return getDb().collection(COLLECTION);
}

function toObjectId(id) {
  if (id instanceof ObjectId) return id;
  if (!ObjectId.isValid(id)) throw new Error('Invalid workspace ID');
  return new ObjectId(id);
}

export const Workspace = {
  async create(workspaceData) {
    const { name, description, ownerId } = workspaceData;
    let slug = workspaceData.slug || generateSlug(name);

    const existing = await this.findBySlug(slug);
    if (existing) {
      slug = `${slug}-${Date.now()}`;
    }

    const workspace = {
      name: name.trim(),
      slug,
      description: description || '',
      ownerId: toObjectId(ownerId),
      members: [
        {
          userId: toObjectId(ownerId),
          role: 'owner',
          joinedAt: new Date(),
        },
      ],
      settings: {
        isPublic: false,
        allowGuestAccess: false,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await getCollection().insertOne(workspace);
    return { ...workspace, _id: result.insertedId };
  },

  async findById(id) {
    return getCollection().findOne({ _id: toObjectId(id) });
  },

  async findBySlug(slug) {
    return getCollection().findOne({ slug: slug.toLowerCase().trim() });
  },

  async update(id, data) {
    const { _id, ownerId, members, ...updateData } = data;
    const update = {
      ...updateData,
      updatedAt: new Date(),
    };

    const result = await getCollection().findOneAndUpdate(
      { _id: toObjectId(id) },
      { $set: update },
      { returnDocument: 'after' }
    );

    return result;
  },

  async delete(id) {
    const result = await getCollection().deleteOne({ _id: toObjectId(id) });
    return result.deletedCount > 0;
  },

  async addMember(workspaceId, userId, role = 'member') {
    const wsId = toObjectId(workspaceId);
    const uId = toObjectId(userId);
    const workspace = await this.findById(wsId);

    const existing = workspace?.members?.find(
      (m) => m.userId.toString() === uId.toString()
    );

    if (existing) {
      return getCollection().findOneAndUpdate(
        {
          _id: wsId,
          'members.userId': uId,
        },
        {
          $set: {
            'members.$.role': role,
            updatedAt: new Date(),
          },
        },
        { returnDocument: 'after' }
      );
    }

    return getCollection().findOneAndUpdate(
      { _id: wsId },
      {
        $push: {
          members: {
            userId: uId,
            role,
            joinedAt: new Date(),
          },
        },
        $set: { updatedAt: new Date() },
      },
      { returnDocument: 'after' }
    );
  },

  async removeMember(workspaceId, userId) {
    return getCollection().findOneAndUpdate(
      { _id: toObjectId(workspaceId) },
      {
        $pull: { members: { userId: toObjectId(userId) } },
        $set: { updatedAt: new Date() },
      },
      { returnDocument: 'after' }
    );
  },

  async getProjects(workspaceId) {
    const pipeline = [
      { $match: { _id: toObjectId(workspaceId) } },
      {
        $lookup: {
          from: 'projects',
          localField: '_id',
          foreignField: 'workspaceId',
          as: 'projects',
        },
      },
      { $unwind: { path: '$projects', preserveNullAndEmptyArrays: true } },
      {
        $replaceRoot: { newRoot: { $ifNull: ['$projects', {}] } },
      },
      { $match: { _id: { $exists: true } } },
      { $sort: { updatedAt: -1 } },
    ];

    return getDb().collection('workspaces').aggregate(pipeline).toArray();
  },

  async getMemberRole(workspaceId, userId) {
    const workspace = await this.findById(workspaceId);
    if (!workspace) return null;

    const member = workspace.members.find(
      (m) => m.userId.toString() === userId.toString()
    );
    return member?.role || null;
  },

  async isMember(workspaceId, userId) {
    const role = await this.getMemberRole(workspaceId, userId);
    return role !== null;
  },

  async getMembersWithDetails(workspaceId) {
    const workspace = await this.findById(workspaceId);
    if (!workspace) return [];

    const members = workspace.members || [];
    if (members.length === 0) return [];

    const userIds = members.map((m) => m.userId);
    const users = await getDb()
      .collection('users')
      .find({ _id: { $in: userIds } })
      .project({ name: 1, email: 1, avatar: 1 })
      .toArray();

    const userMap = Object.fromEntries(users.map((u) => [u._id.toString(), u]));

    return members.map((m) => {
      const user = userMap[m.userId.toString()];
      return {
        _id: m.userId.toString(),
        userId: m.userId.toString(),
        name: user?.name || 'Unknown',
        email: user?.email || '',
        avatar: user?.avatar || null,
        role: m.role,
        joinedAt: m.joinedAt,
      };
    });
  },
};
