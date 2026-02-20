import express from 'express';
import { deleteAccount, login, me, signup, updateSurveyName } from '../controllers/authController.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = express.Router();

router.post('/signup', signup);
router.post('/login', login);
router.get('/me', requireAuth, me);
router.put('/survey-name', requireAuth, updateSurveyName);
router.delete('/account', requireAuth, deleteAccount);

export default router;
