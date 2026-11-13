import { Router } from 'express';
import { getRecruiterDashboardStats } from '../controllers/dashboardController';
import { 
  getJobs, 
  createJob, 
  updateJobStatus, 
  deleteJob, 
  getApplications, 
  updateApplicationStatus,
  bulkUpdateApplicationStatus,
  getCompanyProfile, 
  updateCompanyProfile,
  getCandidates,
  inviteCandidate,
  getInterviews,
  createInterview,
  updateInterviewStatus,
  deleteInterview,
  remindInterview,
  getConversations,
  getMessagesByConversation,
  sendMessage,
  startConversation,
  getNotifications,
  markNotificationAsRead,
  markAllNotificationsRead,
  deleteNotification,
  getRecruiterEmailTemplates,
  getRecruiterEmailTemplateByCode,
  updateRecruiterEmailTemplate,
  testSendRecruiterEmailTemplate,
  getRecruiterEmailDeliveryLogs,
  deleteRecruiterApplication,
  deleteRecruiterCandidate,
  getRecruiterSubscription,
  activateRecruiterSubscription,
  trackCandidateProfileView,
  getPublicSubscriptionPlanConfig,
  getRecruiterSubscriptionPayments
} from '../controllers/recruiterController';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.get('/dashboard', authenticate, authorize('RECRUITER'), getRecruiterDashboardStats);

// Subscription & Plan Management (FREE vs PRO)
router.get('/subscription-plan', getPublicSubscriptionPlanConfig);
router.get('/subscription', authenticate, authorize('RECRUITER'), getRecruiterSubscription);
router.get('/subscription/payments', authenticate, authorize('RECRUITER'), getRecruiterSubscriptionPayments);
router.post('/subscription/activate', authenticate, authorize('RECRUITER'), activateRecruiterSubscription);
router.post('/subscription/view-candidate', authenticate, authorize('RECRUITER'), trackCandidateProfileView);
router.get('/jobs', authenticate, authorize('RECRUITER'), getJobs);
router.post('/jobs', authenticate, authorize('RECRUITER'), createJob);
router.patch('/jobs/:id/status', authenticate, authorize('RECRUITER'), updateJobStatus);
router.delete('/jobs/:id', authenticate, authorize('RECRUITER'), deleteJob);
router.get('/applications', authenticate, authorize('RECRUITER'), getApplications);
router.patch('/applications/:id/status', authenticate, authorize('RECRUITER'), updateApplicationStatus);
router.post('/applications/bulk-status', authenticate, authorize('RECRUITER'), bulkUpdateApplicationStatus);
router.delete('/applications/:id', authenticate, authorize('RECRUITER'), deleteRecruiterApplication);
router.get('/candidates', authenticate, authorize('RECRUITER'), getCandidates);
router.post('/candidates/invite', authenticate, authorize('RECRUITER'), inviteCandidate);
router.delete('/candidates/:id', authenticate, authorize('RECRUITER'), deleteRecruiterCandidate);
router.get('/interviews', authenticate, authorize('RECRUITER'), getInterviews);
router.post('/interviews', authenticate, authorize('RECRUITER'), createInterview);
router.patch('/interviews/:id/status', authenticate, authorize('RECRUITER'), updateInterviewStatus);
router.post('/interviews/:id/remind', authenticate, authorize('RECRUITER'), remindInterview);
router.delete('/interviews/:id', authenticate, authorize('RECRUITER'), deleteInterview);

// Messages
router.get('/messages/conversations', authenticate, authorize('RECRUITER'), getConversations);
router.get('/messages/conversations/:conversationId', authenticate, authorize('RECRUITER'), getMessagesByConversation);
router.post('/messages/conversations/:conversationId/messages', authenticate, authorize('RECRUITER'), sendMessage);
router.post('/messages/start', authenticate, authorize('RECRUITER'), startConversation);

// Notifications
router.get('/notifications', authenticate, authorize('RECRUITER'), getNotifications);
router.patch('/notifications/:id/read', authenticate, authorize('RECRUITER'), markNotificationAsRead);
router.post('/notifications/mark-all-read', authenticate, authorize('RECRUITER'), markAllNotificationsRead);
router.delete('/notifications/:id', authenticate, authorize('RECRUITER'), deleteNotification);

router.get('/company', authenticate, authorize('RECRUITER'), getCompanyProfile);
router.put('/company', authenticate, authorize('RECRUITER'), updateCompanyProfile);

// Recruiter Company-Specific Email Templates & Delivery Logs
router.get('/email-templates', authenticate, authorize('RECRUITER'), getRecruiterEmailTemplates);
router.get('/email-templates/:code', authenticate, authorize('RECRUITER'), getRecruiterEmailTemplateByCode);
router.put('/email-templates/:code', authenticate, authorize('RECRUITER'), updateRecruiterEmailTemplate);
router.post('/email-templates/test-send', authenticate, authorize('RECRUITER'), testSendRecruiterEmailTemplate);
router.get('/email-delivery-logs', authenticate, authorize('RECRUITER'), getRecruiterEmailDeliveryLogs);

export default router;
