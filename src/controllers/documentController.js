import { Document } from '../models/Document.js';
import { Project } from '../models/Project.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { validateDocumentData } from '../utils/validators.js';
import { sanitizeString, sanitizeHtml, parsePagination, buildPaginationMeta } from '../utils/sanitize.js';
import { auditLog } from '../utils/auditLog.js';
import { cacheGet, cacheSet, cacheDeletePattern, cacheKey } from '../utils/cache.js';

async function getProjectContext(projectId) {
  const project = await Project.findById(projectId);
  if (!project) throw new AppError('Project not found', 404);
  return project;
}

async function ensureDocumentAccess(req, documentId, permission = 'read') {
  const hasAccess = await Document.hasAccess(documentId, req.user.id, permission);
  if (!hasAccess && req.user.role !== 'admin') {
    throw new AppError('You do not have access to this document', 403);
  }
}

export const createDocument = asyncHandler(async (req, res) => {
  const data = {
    ...req.body,
    title: sanitizeString(req.body.title, 300),
    content: req.body.contentFormat === 'html'
      ? sanitizeHtml(req.body.content || '')
      : sanitizeString(req.body.content, 500000),
    createdBy: req.user.id,
  };

  const validation = validateDocumentData(data);
  if (!validation.valid) throw new AppError(validation.message, 400);

  const project = await getProjectContext(data.projectId);
  data.workspaceId = project.workspaceId;

  const document = await Document.create(data);

  await auditLog(req, {
    action: 'document.created',
    entityType: 'document',
    entityId: document._id,
    workspaceId: project.workspaceId,
    projectId: project._id,
    metadata: { title: document.title },
  });

  cacheDeletePattern(`documents:${data.projectId}`);

  res.status(201).json({
    success: true,
    data: { document, preview: Document.generatePreview(document) },
  });
});

export const getDocuments = asyncHandler(async (req, res) => {
  const { projectId, type, search } = req.query;
  if (!projectId) throw new AppError('projectId query parameter is required', 400);

  await getProjectContext(projectId);

  const { page, limit, skip } = parsePagination(req.query);
  const { documents, total } = await Document.findByProject(projectId, { skip, limit, type, search });

  const previews = documents.map((doc) => ({
    ...doc,
    content: undefined,
    versions: undefined,
    preview: Document.generatePreview(doc),
  }));

  res.json({
    success: true,
    data: {
      documents: previews,
      pagination: buildPaginationMeta(total, page, limit),
    },
  });
});

export const getDocumentById = asyncHandler(async (req, res) => {
  const document = await Document.findById(req.params.documentId);
  if (!document) throw new AppError('Document not found', 404);

  await ensureDocumentAccess(req, req.params.documentId);

  const versions = await Document.getVersions(req.params.documentId);

  res.json({
    success: true,
    data: {
      document,
      versions: versions.slice(0, 10),
      preview: Document.generatePreview(document),
    },
  });
});

export const updateDocument = asyncHandler(async (req, res) => {
  const document = await Document.findById(req.params.documentId);
  if (!document) throw new AppError('Document not found', 404);

  await ensureDocumentAccess(req, req.params.documentId, 'write');

  const updates = {};
  if (req.body.title) updates.title = sanitizeString(req.body.title, 300);
  if (req.body.content !== undefined) {
    updates.content = document.contentFormat === 'html'
      ? sanitizeHtml(req.body.content)
      : sanitizeString(req.body.content, 500000);
  }
  if (req.body.contentFormat) updates.contentFormat = req.body.contentFormat;

  const createVersion = req.body.createVersion === true || req.body.createVersion === 'true';

  const updated = await Document.update(req.params.documentId, updates, {
    createVersion,
    editedBy: req.user.id,
    changeNote: req.body.changeNote,
    expectedVersion: req.body.expectedVersion,
  });

  await auditLog(req, {
    action: createVersion ? 'document.version.created' : 'document.updated',
    entityType: 'document',
    entityId: document._id,
    workspaceId: document.workspaceId,
    projectId: document.projectId,
    changes: { title: updates.title, contentChanged: updates.content !== undefined },
  });

  cacheDeletePattern(`documents:${document.projectId}`);

  res.json({
    success: true,
    data: { document: updated, preview: Document.generatePreview(updated) },
  });
});

export const deleteDocument = asyncHandler(async (req, res) => {
  const document = await Document.findById(req.params.documentId);
  if (!document) throw new AppError('Document not found', 404);

  await ensureDocumentAccess(req, req.params.documentId, 'owner');

  await Document.softDelete(req.params.documentId);

  await auditLog(req, {
    action: 'document.deleted',
    entityType: 'document',
    entityId: document._id,
    workspaceId: document.workspaceId,
    projectId: document.projectId,
  });

  cacheDeletePattern(`documents:${document.projectId}`);

  res.json({ success: true, message: 'Document deleted successfully' });
});

export const addCollaborator = asyncHandler(async (req, res) => {
  const { userId, permission = 'read' } = req.body;
  if (!userId) throw new AppError('userId is required', 400);

  const validPermissions = ['read', 'write', 'owner'];
  if (!validPermissions.includes(permission)) {
    throw new AppError(`Permission must be one of: ${validPermissions.join(', ')}`, 400);
  }

  await ensureDocumentAccess(req, req.params.documentId, 'owner');

  const updated = await Document.addCollaborator(req.params.documentId, userId, permission);

  await auditLog(req, {
    action: 'document.collaborator.added',
    entityType: 'document',
    entityId: req.params.documentId,
    metadata: { userId, permission },
  });

  res.json({ success: true, data: { document: updated } });
});

export const removeCollaborator = asyncHandler(async (req, res) => {
  const { userId } = req.params;

  await ensureDocumentAccess(req, req.params.documentId, 'owner');

  const updated = await Document.removeCollaborator(req.params.documentId, userId);

  await auditLog(req, {
    action: 'document.collaborator.removed',
    entityType: 'document',
    entityId: req.params.documentId,
    metadata: { userId },
  });

  res.json({ success: true, data: { document: updated } });
});

export const getDocumentVersions = asyncHandler(async (req, res) => {
  const document = await Document.findById(req.params.documentId);
  if (!document) throw new AppError('Document not found', 404);

  await ensureDocumentAccess(req, req.params.documentId);

  const versions = await Document.getVersions(req.params.documentId);
  res.json({ success: true, data: { versions, currentVersion: document.currentVersion } });
});

export const restoreVersion = asyncHandler(async (req, res) => {
  const { versionId } = req.params;

  await ensureDocumentAccess(req, req.params.documentId, 'write');

  const result = await Document.restoreVersion(req.params.documentId, versionId, req.user.id);
  if (!result) throw new AppError('Version not found', 404);

  await auditLog(req, {
    action: 'document.version.restored',
    entityType: 'document',
    entityId: req.params.documentId,
    metadata: { versionId },
  });

  res.json({ success: true, data: result });
});

export const exportDocument = asyncHandler(async (req, res) => {
  const { format = 'html' } = req.query;
  const document = await Document.findById(req.params.documentId);
  if (!document) throw new AppError('Document not found', 404);

  await ensureDocumentAccess(req, req.params.documentId);

  if (format === 'html') {
    const html = Document.exportAsHtml(document);
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Content-Disposition', `attachment; filename="${document.title}.html"`);
    return res.send(html);
  }

  if (format === 'json') {
    return res.json({
      success: true,
      data: {
        title: document.title,
        content: document.content,
        contentFormat: document.contentFormat,
        exportedAt: new Date(),
      },
    });
  }

  throw new AppError('Unsupported export format. Use html or json.', 400);
});

export const shareDocument = asyncHandler(async (req, res) => {
  const { permission = 'view', expiresInHours = 72 } = req.body;

  await ensureDocumentAccess(req, req.params.documentId, 'write');

  const { shareLink } = await Document.createShareLink(req.params.documentId, {
    permission,
    expiresInHours,
    createdBy: req.user.id,
  });

  await auditLog(req, {
    action: 'document.shared',
    entityType: 'document',
    entityId: req.params.documentId,
    metadata: { permission, expiresInHours },
  });

  res.json({
    success: true,
    data: {
      shareUrl: `/api/documents/shared/${shareLink.token}`,
      token: shareLink.token,
      expiresAt: shareLink.expiresAt,
      permission: shareLink.permission,
    },
  });
});

export const searchDocuments = asyncHandler(async (req, res) => {
  const { q, workspaceId, projectId } = req.query;
  if (!q) throw new AppError('Search query (q) is required', 400);

  const results = await Document.search(sanitizeString(q, 200), {
    workspaceId,
    projectId,
    limit: parseInt(req.query.limit, 10) || 20,
  });

  res.json({
    success: true,
    data: {
      results: results.map((doc) => ({
        ...doc,
        preview: Document.generatePreview(doc),
      })),
    },
  });
});

export const acquireEditLock = asyncHandler(async (req, res) => {
  await ensureDocumentAccess(req, req.params.documentId, 'write');

  const document = await Document.acquireEditLock(req.params.documentId, req.user.id);
  res.json({ success: true, data: { editLock: document.editLock } });
});

export const releaseEditLock = asyncHandler(async (req, res) => {
  await Document.releaseEditLock(req.params.documentId, req.user.id);
  res.json({ success: true, message: 'Edit lock released' });
});

export const autoSaveDocument = asyncHandler(async (req, res) => {
  const document = await Document.findById(req.params.documentId);
  if (!document) throw new AppError('Document not found', 404);

  await ensureDocumentAccess(req, req.params.documentId, 'write');

  const content = document.contentFormat === 'html'
    ? sanitizeHtml(req.body.content || '')
    : sanitizeString(req.body.content, 500000);

  const updated = await Document.update(req.params.documentId, { content }, {
    expectedVersion: req.body.expectedVersion,
  });

  res.json({
    success: true,
    data: {
      lastAutoSavedAt: updated.lastAutoSavedAt,
      currentVersion: updated.currentVersion,
    },
  });
});

export const getSharedDocument = asyncHandler(async (req, res) => {
  const document = await Document.findByShareToken(req.params.token);
  if (!document) throw new AppError('Share link not found or expired', 404);

  const shareLink = document.shareLinks.find((l) => l.token === req.params.token);

  res.json({
    success: true,
    data: {
      document: {
        _id: document._id,
        title: document.title,
        content: shareLink.permission !== 'view' ? document.content : document.content,
        contentFormat: document.contentFormat,
        permission: shareLink.permission,
      },
      preview: Document.generatePreview(document),
    },
  });
});
