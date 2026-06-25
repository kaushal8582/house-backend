import { Router } from 'express';
import { verifyToken, checkProjectAccess } from '../middleware/auth.js';
import {
  createTask,
  getTasks,
  getTaskById,
  updateTask,
  deleteTask,
  assignTask,
  updateTaskStatus,
  addSubtask,
  completeSubtask,
  addComment,
  getComments,
  getTaskHistory,
  getTasksByPriority,
  getTaskMetrics,
} from '../controllers/taskController.js';
import {
  validate,
  validateObjectIdParam,
  schemas,
} from '../middleware/validation.js';

const router = Router();

router.use(verifyToken);

router.get('/metrics', validate(schemas.taskQuery, 'query'), checkProjectAccess(), getTaskMetrics);
router.get('/by-priority', validate(schemas.taskQuery, 'query'), checkProjectAccess(), getTasksByPriority);
router.post('/', validate(schemas.createTask), checkProjectAccess(), createTask);
router.get('/', validate(schemas.taskQuery, 'query'), checkProjectAccess(), getTasks);
router.get('/:taskId', validateObjectIdParam('taskId'), checkProjectAccess(), getTaskById);
router.put('/:taskId', validateObjectIdParam('taskId'), checkProjectAccess(), validate(schemas.updateTask), updateTask);
router.delete('/:taskId', validateObjectIdParam('taskId'), checkProjectAccess(), deleteTask);
router.patch('/:taskId/assign', validateObjectIdParam('taskId'), checkProjectAccess(), validate(schemas.assignTask), assignTask);
router.patch('/:taskId/status', validateObjectIdParam('taskId'), checkProjectAccess(), validate(schemas.updateTaskStatus), updateTaskStatus);
router.post('/:taskId/subtasks', validateObjectIdParam('taskId'), checkProjectAccess(), validate(schemas.addSubtask), addSubtask);
router.patch('/:taskId/subtasks/:subtaskId/complete', validateObjectIdParam('taskId', 'subtaskId'), checkProjectAccess(), completeSubtask);
router.post('/:taskId/comments', validateObjectIdParam('taskId'), checkProjectAccess(), validate(schemas.addComment), addComment);
router.get('/:taskId/comments', validateObjectIdParam('taskId'), checkProjectAccess(), getComments);
router.get('/:taskId/history', validateObjectIdParam('taskId'), checkProjectAccess(), getTaskHistory);

export default router;
