import bcrypt from 'bcryptjs';
import { ObjectId } from 'mongodb';
import { getDb } from '../config/database.js';

const COLLECTION = 'users';

function getCollection() {
  return getDb().collection(COLLECTION);
}

function toObjectId(id) {
  if (id instanceof ObjectId) return id;
  if (!ObjectId.isValid(id)) throw new Error('Invalid user ID');
  return new ObjectId(id);
}

export const User = {
  async create(userData) {
    const { email, password, name, avatar } = userData;
    const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS, 10) || 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const user = {
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      name: name.trim(),
      avatar: avatar || null,
      role: 'user',
      workspaces: [],
      refreshToken: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await getCollection().insertOne(user);
    return { ...user, _id: result.insertedId };
  },

  async findByEmail(email) {
    return getCollection().findOne({ email: email.toLowerCase().trim() });
  },

  async findById(id) {
    return getCollection().findOne({ _id: toObjectId(id) });
  },

  async update(id, data) {
    const { password, email, _id, ...updateData } = data;
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

  async addToWorkspace(userId, workspaceId, role = 'member') {
    const wsId = toObjectId(workspaceId);
    const user = await this.findById(userId);

    const existing = user?.workspaces?.find(
      (w) => w.workspaceId.toString() === wsId.toString()
    );

    if (existing) {
      return getCollection().findOneAndUpdate(
        {
          _id: toObjectId(userId),
          'workspaces.workspaceId': wsId,
        },
        {
          $set: {
            'workspaces.$.role': role,
            updatedAt: new Date(),
          },
        },
        { returnDocument: 'after' }
      );
    }

    return getCollection().findOneAndUpdate(
      { _id: toObjectId(userId) },
      {
        $push: {
          workspaces: {
            workspaceId: wsId,
            role,
            joinedAt: new Date(),
          },
        },
        $set: { updatedAt: new Date() },
      },
      { returnDocument: 'after' }
    );
  },

  async removeFromWorkspace(userId, workspaceId) {
    return getCollection().findOneAndUpdate(
      { _id: toObjectId(userId) },
      {
        $pull: { workspaces: { workspaceId: toObjectId(workspaceId) } },
        $set: { updatedAt: new Date() },
      },
      { returnDocument: 'after' }
    );
  },

  async getWorkspaces(userId) {
    const pipeline = [
      { $match: { _id: toObjectId(userId) } },
      { $unwind: { path: '$workspaces', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'workspaces',
          localField: 'workspaces.workspaceId',
          foreignField: '_id',
          as: 'workspaceDetails',
        },
      },
      { $unwind: { path: '$workspaceDetails', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: '$workspaceDetails._id',
          name: '$workspaceDetails.name',
          slug: '$workspaceDetails.slug',
          description: '$workspaceDetails.description',
          role: '$workspaces.role',
          joinedAt: '$workspaces.joinedAt',
        },
      },
    ];

    const results = await getCollection().aggregate(pipeline).toArray();
    return results.filter((w) => w._id);
  },

  async comparePassword(plainPassword, hashedPassword) {
    return bcrypt.compare(plainPassword, hashedPassword);
  },

  async updatePassword(id, newPassword) {
    const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS, 10) || 12;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    return getCollection().findOneAndUpdate(
      { _id: toObjectId(id) },
      {
        $set: {
          password: hashedPassword,
          refreshToken: null,
          updatedAt: new Date(),
        },
      },
      { returnDocument: 'after' }
    );
  },

  async setRefreshToken(id, token) {
    return getCollection().updateOne(
      { _id: toObjectId(id) },
      { $set: { refreshToken: token, updatedAt: new Date() } }
    );
  },

  async clearRefreshToken(id) {
    return getCollection().updateOne(
      { _id: toObjectId(id) },
      { $set: { refreshToken: null, updatedAt: new Date() } }
    );
  },
};
