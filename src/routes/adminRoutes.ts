import { Router } from 'express';
import { getAdminDashboardStats } from '../controllers/dashboardController';
import {
  getUsers,
  getCandidates,
  getRecruiters,
  adminResetRecruiterPassword,
  getCompanies,
  getAdminJobs,
  getNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  getReports,
  getCategories,
  createCategory,
  getSkills,
  getInterviews,
  getAdminApplications,
  updateApplicationStatus,
  deleteApplication,
  deleteCandidate,
  deleteRecruiter,
  getModerationItems,
  handleModerationAction,
  updateUserStatus,
  updateUserPassword,
  deleteUser,
  updateAdminJobStatus,
  sendBroadcastNotification,
  getEmailTemplates,
  getEmailTemplateByCode,
  updateEmailTemplate,
  testSendEmailTemplate,
  getEmailDeliveryLogs,
  deleteEmailDeliveryLog,
  dispatchEmailAnnouncement,
  remindInterview,
  getAdminSubscriptionConfig,
  updateAdminSubscriptionConfig,
  getAdminSubscriptionPayments
} from '../controllers/adminController';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.use(authenticate, authorize('ADMIN'));

router.get('/dashboard', getAdminDashboardStats);
router.get('/users', getUsers);
router.patch('/users/:id/status', updateUserStatus);
router.patch('/users/:id/password', updateUserPassword);
router.delete('/users/:id', deleteUser);
router.get('/candidates', getCandidates);
router.delete('/candidates/:id', deleteCandidate);
router.get('/recruiters', getRecruiters);
router.post('/recruiters/:id/reset-password', adminResetRecruiterPassword);
router.delete('/recruiters/:id', deleteRecruiter);
router.get('/companies', getCompanies);
router.get('/jobs', getAdminJobs);
router.patch('/jobs/:id/status', updateAdminJobStatus);
router.get('/applications', getAdminApplications);
router.patch('/applications/:id/status', updateApplicationStatus);
router.delete('/applications/:id', deleteApplication);
router.get('/interviews', getInterviews);
router.post('/interviews/:id/remind', remindInterview);
router.get('/moderation', getModerationItems);
router.post('/moderation/action', handleModerationAction);
router.get('/notifications', getNotifications);
router.post('/notifications/broadcast', sendBroadcastNotification);
router.patch('/notifications/:id/read', markNotificationAsRead);
router.post('/notifications/mark-all-read', markAllNotificationsAsRead);

// Email Templates & Automation Endpoints
router.get('/email-templates', getEmailTemplates);
router.get('/email-templates/:code', getEmailTemplateByCode);
router.put('/email-templates/:code', updateEmailTemplate);
router.post('/email-templates/test-send', testSendEmailTemplate);
router.get('/email-delivery-logs', getEmailDeliveryLogs);
router.delete('/email-delivery-logs/:id', deleteEmailDeliveryLog);
router.post('/email-announcements/dispatch', dispatchEmailAnnouncement);

router.get('/reports', getReports);
router.get('/categories', getCategories);
router.post('/categories', createCategory);
router.get('/skills', getSkills);

// Recruiter PRO Plan Pricing & Monetization Config
router.get('/subscription-config', getAdminSubscriptionConfig);
router.put('/subscription-config', updateAdminSubscriptionConfig);
router.get('/subscription-payments', getAdminSubscriptionPayments);

export default router;

