import { Router } from 'express';
import {
  verifyToken,
  checkWorkspaceAccess,
  requireWorkspaceRole,
} from '../middleware/auth.js';
import {
  getWorkspaceMembers,
  inviteWorkspaceMember,
  removeWorkspaceMember,
  changeWorkspaceMemberRole,
} from '../controllers/workspaceController.js';
import {
  validate,
  validateObjectIdParam,
  schemas,
} from '../middleware/validation.js';

const router = Router();

router.use(verifyToken);

router.get(
  '/:workspaceId/members',
  validateObjectIdParam('workspaceId'),
  checkWorkspaceAccess('workspaceId'),
  getWorkspaceMembers
);

router.post(
  '/:workspaceId/members',
  validateObjectIdParam('workspaceId'),
  checkWorkspaceAccess('workspaceId'),
  requireWorkspaceRole('owner', 'admin'),
  validate(schemas.inviteWorkspaceMember),
  inviteWorkspaceMember
);

router.delete(
  '/:workspaceId/members/:userId',
  validateObjectIdParam('workspaceId', 'userId'),
  checkWorkspaceAccess('workspaceId'),
  requireWorkspaceRole('owner', 'admin'),
  removeWorkspaceMember
);

router.patch(
  '/:workspaceId/members/:userId/role',
  validateObjectIdParam('workspaceId', 'userId'),
  checkWorkspaceAccess('workspaceId'),
  requireWorkspaceRole('owner', 'admin'),
  validate(schemas.changeWorkspaceMemberRole),
  changeWorkspaceMemberRole
);

export default router;
