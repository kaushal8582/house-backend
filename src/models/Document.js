import crypto from 'crypto';
import { ObjectId } from 'mongodb';
import { getDb } from '../config/database.js';

const COLLECTION = 'documents';

function getCollection() {
  return getDb().collection(COLLECTION);
}

function toObjectId(id) {
  if (id instanceof ObjectId) return id;
  if (!ObjectId.isValid(id)) throw new Error('Invalid document ID');
  return new ObjectId(id);
}

function computeDiff(oldContent, newContent) {
  const oldLen = (oldContent || '').length;
  const newLen = (newContent || '').length;
  return {
    charsAdded: Math.max(0, newLen - oldLen),
    charsRemoved: Math.max(0, oldLen - newLen),
    lengthBefore: oldLen,
    lengthAfter: newLen,
  };
}

export const Document = {
  async create(documentData) {
    const {
      title,
      content,
      projectId,
      workspaceId,
      createdBy,
      type = 'document',
      contentFormat = 'html',
    } = documentData;

    const initialVersion = {
      _id: new ObjectId(),
      content: content || '',
      contentFormat,
      editedBy: toObjectId(createdBy),
      changeNote: 'Initial version',
      diff: null,
      createdAt: new Date(),
    };

    const document = {
      title: title.trim(),
      content: content || '',
      contentFormat,
      projectId: toObjectId(projectId),
      workspaceId: workspaceId ? toObjectId(workspaceId) : null,
      createdBy: toObjectId(createdBy),
      type,
      versions: [initialVersion],
      collaborators: [
        { userId: toObjectId(createdBy), permission: 'owner', addedAt: new Date() },
      ],
      shareLinks: [],
      editLock: null,
      currentVersion: 1,
      isDeleted: false,
      lastAutoSavedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await getCollection().insertOne(document);
    return { ...document, _id: result.insertedId };
  },

  async findById(id) {
    return getCollection().findOne({ _id: toObjectId(id), isDeleted: { $ne: true } });
  },

  async findWithFilters(filters = {}, { skip = 0, limit = 20 } = {}) {
    const query = { isDeleted: { $ne: true }, ...filters };
    const [documents, total] = await Promise.all([
      getCollection().find(query).sort({ updatedAt: -1 }).skip(skip).limit(limit).toArray(),
      getCollection().countDocuments(query),
    ]);
    return { documents, total };
  },

  async findByProject(projectId, options = {}) {
    const { skip = 0, limit = 20, type, search } = options;
    const filter = { projectId: toObjectId(projectId) };
    if (type) filter.type = type;
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { content: { $regex: search, $options: 'i' } },
      ];
    }
    return this.findWithFilters(filter, { skip, limit });
  },

  async update(id, data, { createVersion = false, editedBy, changeNote, expectedVersion } = {}) {
    const doc = await this.findById(id);
    if (!doc) return null;

    if (expectedVersion && doc.currentVersion !== expectedVersion) {
      const error = new Error('Document was modified by another user. Please refresh and try again.');
      error.statusCode = 409;
      error.code = 'VERSION_CONFLICT';
      throw error;
    }

    const update = { updatedAt: new Date(), lastAutoSavedAt: new Date() };
    const forbidden = ['_id', 'versions', 'collaborators', 'shareLinks', 'createdBy'];

    for (const [key, value] of Object.entries(data)) {
      if (!forbidden.includes(key) && value !== undefined) update[key] = value;
    }

    const operations = { $set: update };

    if (createVersion && data.content !== undefined && editedBy) {
      const version = {
        _id: new ObjectId(),
        content: data.content,
        contentFormat: data.contentFormat || doc.contentFormat,
        editedBy: toObjectId(editedBy),
        changeNote: changeNote || '',
        diff: computeDiff(doc.content, data.content),
        createdAt: new Date(),
      };
      operations.$push = { versions: version };
      operations.$inc = { currentVersion: 1 };
    }

    const result = await getCollection().findOneAndUpdate(
      { _id: toObjectId(id), isDeleted: { $ne: true } },
      operations,
      { returnDocument: 'after' }
    );

    return result;
  },

  async softDelete(id) {
    return getCollection().findOneAndUpdate(
      { _id: toObjectId(id) },
      { $set: { isDeleted: true, updatedAt: new Date() } },
      { returnDocument: 'after' }
    );
  },

  async addVersion(documentId, versionData) {
    const doc = await this.findById(documentId);
    if (!doc) return null;

    const version = {
      _id: new ObjectId(),
      content: versionData.content,
      contentFormat: versionData.contentFormat || doc.contentFormat,
      editedBy: toObjectId(versionData.editedBy),
      changeNote: versionData.changeNote || '',
      diff: computeDiff(doc.content, versionData.content),
      createdAt: new Date(),
    };

    const result = await getCollection().findOneAndUpdate(
      { _id: toObjectId(documentId) },
      {
        $push: { versions: version },
        $set: { content: versionData.content, updatedAt: new Date(), lastAutoSavedAt: new Date() },
        $inc: { currentVersion: 1 },
      },
      { returnDocument: 'after' }
    );

    return { document: result, version };
  },

  async getVersions(documentId) {
    const doc = await this.findById(documentId);
    if (!doc) return [];

    const versions = Array.isArray(doc.versions)
      ? doc.versions
      : doc.versions
        ? [doc.versions]
        : [];

    if (versions.length === 0) return [];

    const editorIds = [
      ...new Set(
        versions
          .map((v) => v.editedBy?.toString?.() || v.editedBy)
          .filter(Boolean)
      ),
    ];

    const editors = editorIds.length
      ? await getDb()
          .collection('users')
          .find({ _id: { $in: editorIds.map((id) => toObjectId(id)) } })
          .project({ name: 1, email: 1 })
          .toArray()
      : [];

    const editorMap = Object.fromEntries(
      editors.map((e) => [e._id.toString(), e])
    );

    return versions
      .map((version, index) => {
        const editorId = version.editedBy?.toString?.() || version.editedBy;
        const editor = editorId ? editorMap[editorId] : null;
        return {
          _id: version._id,
          versionNumber: index + 1,
          content: version.content,
          contentFormat: version.contentFormat,
          changeNote: version.changeNote,
          diff: version.diff,
          createdAt: version.createdAt,
          editor: editor
            ? { _id: editor._id, name: editor.name, email: editor.email }
            : null,
        };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  async restoreVersion(documentId, versionId, restoredBy) {
    const doc = await this.findById(documentId);
    if (!doc) return null;

    const versions = Array.isArray(doc.versions)
      ? doc.versions
      : doc.versions
        ? [doc.versions]
        : [];

    const version = versions.find((v) => v._id.toString() === versionId.toString());
    if (!version) return null;

    return this.addVersion(documentId, {
      content: version.content,
      contentFormat: version.contentFormat,
      editedBy: restoredBy,
      changeNote: `Restored from version ${versionId}`,
    });
  },

  async addCollaborator(documentId, userId, permission = 'read') {
    const docId = toObjectId(documentId);
    const uId = toObjectId(userId);
    const doc = await this.findById(docId);
    const collaborators = Array.isArray(doc?.collaborators)
      ? doc.collaborators
      : doc?.collaborators
        ? [doc.collaborators]
        : [];
    const existing = collaborators.find((c) => c.userId.toString() === uId.toString());

    if (existing) {
      return getCollection().findOneAndUpdate(
        { _id: docId, 'collaborators.userId': uId },
        { $set: { 'collaborators.$.permission': permission, updatedAt: new Date() } },
        { returnDocument: 'after' }
      );
    }

    return getCollection().findOneAndUpdate(
      { _id: docId },
      {
        $push: { collaborators: { userId: uId, permission, addedAt: new Date() } },
        $set: { updatedAt: new Date() },
      },
      { returnDocument: 'after' }
    );
  },

  async removeCollaborator(documentId, userId) {
    return getCollection().findOneAndUpdate(
      { _id: toObjectId(documentId) },
      {
        $pull: { collaborators: { userId: toObjectId(userId) } },
        $set: { updatedAt: new Date() },
      },
      { returnDocument: 'after' }
    );
  },

  async createShareLink(documentId, { permission = 'view', expiresInHours = 72, createdBy }) {
    const token = crypto.randomBytes(32).toString('hex');
    const shareLink = {
      _id: new ObjectId(),
      token,
      permission,
      expiresAt: new Date(Date.now() + expiresInHours * 60 * 60 * 1000),
      createdBy: toObjectId(createdBy),
      createdAt: new Date(),
    };

    const result = await getCollection().findOneAndUpdate(
      { _id: toObjectId(documentId) },
      { $push: { shareLinks: shareLink }, $set: { updatedAt: new Date() } },
      { returnDocument: 'after' }
    );

    return { document: result, shareLink };
  },

  async findByShareToken(token) {
    return getCollection().findOne({
      'shareLinks.token': token,
      'shareLinks.expiresAt': { $gt: new Date() },
      isDeleted: { $ne: true },
    });
  },

  async acquireEditLock(documentId, userId, ttlMinutes = 5) {
    const doc = await this.findById(documentId);
    if (!doc) return null;

    const now = new Date();
    if (doc.editLock && doc.editLock.expiresAt > now && doc.editLock.userId.toString() !== userId.toString()) {
      const error = new Error('Document is being edited by another user');
      error.statusCode = 423;
      throw error;
    }

    const editLock = {
      userId: toObjectId(userId),
      lockedAt: now,
      expiresAt: new Date(now.getTime() + ttlMinutes * 60 * 1000),
    };

    return getCollection().findOneAndUpdate(
      { _id: toObjectId(documentId) },
      { $set: { editLock, updatedAt: now } },
      { returnDocument: 'after' }
    );
  },

  async releaseEditLock(documentId, userId) {
    return getCollection().findOneAndUpdate(
      {
        _id: toObjectId(documentId),
        'editLock.userId': toObjectId(userId),
      },
      { $set: { editLock: null, updatedAt: new Date() } },
      { returnDocument: 'after' }
    );
  },

  async search(query, { workspaceId, projectId, limit = 20 } = {}) {
    const filter = { isDeleted: { $ne: true }, $text: { $search: query } };
    if (workspaceId) filter.workspaceId = toObjectId(workspaceId);
    if (projectId) filter.projectId = toObjectId(projectId);

    return getCollection()
      .find(filter, { score: { $meta: 'textScore' } })
      .sort({ score: { $meta: 'textScore' } })
      .limit(limit)
      .project({ content: 0, versions: 0 })
      .toArray();
  },

  async hasAccess(documentId, userId, requiredPermission = 'read') {
    const doc = await this.findById(documentId);
    if (!doc) return false;

    if (doc.createdBy?.toString() === userId.toString()) return true;

    const collaborators = Array.isArray(doc.collaborators)
      ? doc.collaborators
      : doc.collaborators
        ? [doc.collaborators]
        : [];

    const collaborator = collaborators.find(
      (c) => c.userId.toString() === userId.toString()
    );
    if (!collaborator) return false;

    const levels = { read: 1, write: 2, owner: 3, view: 1, edit: 2 };
    return levels[collaborator.permission] >= levels[requiredPermission];
  },

  generatePreview(document) {
    const content = document.content || '';
    const stripped = content.replace(/<[^>]*>/g, '').replace(/[#*`]/g, '');
    return {
      title: document.title,
      excerpt: stripped.slice(0, 200) + (stripped.length > 200 ? '...' : ''),
      contentFormat: document.contentFormat,
      wordCount: stripped.split(/\s+/).filter(Boolean).length,
      lastUpdated: document.updatedAt,
    };
  },

  exportAsHtml(document) {
    const content = document.content || '';
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${document.title}</title></head>
<body><h1>${document.title}</h1>${document.contentFormat === 'html' ? content : `<pre>${content}</pre>`}</body></html>`;
  },
};
