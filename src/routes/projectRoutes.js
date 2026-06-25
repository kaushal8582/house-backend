import { Router } from 'express';
import { verifyToken, checkProjectAccess } from '../middleware/auth.js';
import {
  createProject,
  getProjects,
  getProjectById,
  updateProject,
  deleteProject,
  archiveProject,
  getProjectStats,
  getProjectActivity,
  addTeamMember,
  removeTeamMember,
  changeMemberRole,
  getAvailableMembers,
} from '../controllers/projectController.js';
import {
  validate,
  validateObjectIdParam,
  schemas,
} from '../middleware/validation.js';

const router = Router();

router.use(verifyToken);

router.post('/', validate(schemas.createProject), createProject);
router.get('/', validate(schemas.projectQuery, 'query'), getProjects);
router.get('/:projectId', validateObjectIdParam('projectId'), checkProjectAccess('projectId'), getProjectById);
router.put('/:projectId', validateObjectIdParam('projectId'), validate(schemas.updateProject), checkProjectAccess('projectId'), updateProject);
router.delete('/:projectId', validateObjectIdParam('projectId'), checkProjectAccess('projectId'), deleteProject);
router.patch('/:projectId/archive', validateObjectIdParam('projectId'), checkProjectAccess('projectId'), archiveProject);
router.get('/:projectId/stats', validateObjectIdParam('projectId'), checkProjectAccess('projectId'), getProjectStats);
router.get('/:projectId/activity', validateObjectIdParam('projectId'), checkProjectAccess('projectId'), getProjectActivity);
router.get('/:projectId/available-members', validateObjectIdParam('projectId'), checkProjectAccess('projectId'), getAvailableMembers);
router.post('/:projectId/members', validateObjectIdParam('projectId'), validate(schemas.addTeamMember), checkProjectAccess('projectId'), addTeamMember);
router.delete('/:projectId/members/:userId', validateObjectIdParam('projectId', 'userId'), checkProjectAccess('projectId'), removeTeamMember);
router.patch('/:projectId/members/:userId/role', validateObjectIdParam('projectId', 'userId'), validate(schemas.changeMemberRole), checkProjectAccess('projectId'), changeMemberRole);

export default router;
