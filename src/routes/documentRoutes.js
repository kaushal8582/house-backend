import { Router } from 'express';
import { verifyToken, optionalAuth } from '../middleware/auth.js';
import {
  createDocument,
  getDocuments,
  getDocumentById,
  updateDocument,
  deleteDocument,
  addCollaborator,
  removeCollaborator,
  getDocumentVersions,
  restoreVersion,
  exportDocument,
  shareDocument,
  searchDocuments,
  acquireEditLock,
  releaseEditLock,
  autoSaveDocument,
  getSharedDocument,
} from '../controllers/documentController.js';
import {
  validate,
  validateObjectIdParam,
  schemas,
} from '../middleware/validation.js';

const router = Router();

router.get('/shared/:token', optionalAuth, getSharedDocument);
router.get('/search', verifyToken, validate(schemas.documentSearch, 'query'), searchDocuments);

router.use(verifyToken);

router.post('/', validate(schemas.createDocument), createDocument);
router.get('/', validate(schemas.documentQuery, 'query'), getDocuments);
router.get('/:documentId', validateObjectIdParam('documentId'), getDocumentById);
router.put('/:documentId', validateObjectIdParam('documentId'), validate(schemas.updateDocument), updateDocument);
router.patch('/:documentId/autosave', validateObjectIdParam('documentId'), validate(schemas.autoSaveDocument), autoSaveDocument);
router.delete('/:documentId', validateObjectIdParam('documentId'), deleteDocument);
router.post('/:documentId/collaborators', validateObjectIdParam('documentId'), validate(schemas.addCollaborator), addCollaborator);
router.delete('/:documentId/collaborators/:userId', validateObjectIdParam('documentId', 'userId'), removeCollaborator);
router.get('/:documentId/versions', validateObjectIdParam('documentId'), getDocumentVersions);
router.post('/:documentId/versions/:versionId/restore', validateObjectIdParam('documentId', 'versionId'), restoreVersion);
router.get('/:documentId/export', validateObjectIdParam('documentId'), validate(schemas.exportDocument, 'query'), exportDocument);
router.post('/:documentId/share', validateObjectIdParam('documentId'), validate(schemas.shareDocument), shareDocument);
router.post('/:documentId/lock', validateObjectIdParam('documentId'), acquireEditLock);
router.delete('/:documentId/lock', validateObjectIdParam('documentId'), releaseEditLock);

export default router;
