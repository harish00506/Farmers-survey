import express from 'express';
import multer from 'multer';
import {
    webhookVerify,
    handleIncomingMessage,
    sendSurveyInvite,
    sendSurveyInviteUpload,
    getInviteJobStatus,
    triggerFollowupSurvey,
    whatsappHealth,
} from '../controllers/whatsappController.js';

const webhookRouter = express.Router();
const apiRouter = express.Router();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024 },
});

/**
 * WhatsApp webhook callback that Meta can reach directly.
 * Mounted at whatever path is configured via WHATSAPP_WEBHOOK_URL.
 */
webhookRouter.get('/', webhookVerify);
webhookRouter.post('/', handleIncomingMessage);

/**
 * Internal WhatsApp-related APIs for the admin console or tooling.
 * These stay under the existing /api/whatsapp namespace.
 */
apiRouter.post('/invite', sendSurveyInvite);
apiRouter.post('/invite/upload', upload.single('file'), sendSurveyInviteUpload);
apiRouter.get('/invite/jobs/:jobId', getInviteJobStatus);
apiRouter.post('/trigger-followup', triggerFollowupSurvey);
// Health-check endpoint for WhatsApp credentials and phone configuration
apiRouter.get('/health', whatsappHealth);

export default apiRouter;
export { webhookRouter as whatsappWebhookRouter };