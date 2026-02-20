import express from 'express';
import {
  listSurveysHandler,
  createSurveyHandler,
  updateSurveyHandler,
  deleteSurveyHandler,
  listQuestionsHandler,
  getQuestionHandler,
  createQuestionHandler,
  updateQuestionHandler,
  deleteQuestionHandler,
  translateQuestionHandler,
  createTransitionHandler,
  listTransitionsHandler,
  deleteTransitionHandler,
} from '../controllers/surveyController.js';
import { requireAdminApiKey } from '../middleware/adminAuth.js';

const router = express.Router();

router.get('/surveys', listSurveysHandler);
router.post('/surveys', requireAdminApiKey, createSurveyHandler);
router.put('/surveys/:id', requireAdminApiKey, updateSurveyHandler);
router.delete('/surveys/:id', requireAdminApiKey, deleteSurveyHandler);

// Public read endpoints
router.get('/questions', listQuestionsHandler);
router.get('/questions/:id', getQuestionHandler);

// Admin-protected endpoints
router.post('/questions', requireAdminApiKey, createQuestionHandler);
router.put('/questions/:id', requireAdminApiKey, updateQuestionHandler);
router.delete('/questions/:id', requireAdminApiKey, deleteQuestionHandler);
router.post('/questions/:id/translate', requireAdminApiKey, translateQuestionHandler);

// Transitions
router.post('/transitions', requireAdminApiKey, createTransitionHandler);
router.get('/transitions', requireAdminApiKey, listTransitionsHandler);
router.delete('/transitions/:id', requireAdminApiKey, deleteTransitionHandler);

// Resequence questions
router.post('/questions/resequence', requireAdminApiKey, (req, res) => {
  // forward to controller
  return import('../controllers/surveyController.js').then((m) => m.resequenceHandler(req, res));
});

export default router;
