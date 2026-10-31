import fs from 'fs';
import path from 'path';
import { prisma } from '../server';

const DELETED_USERS_FILE = path.join(__dirname, '../../.deleted-users-cache.json');

export interface DeletedUserInfo {
  role: 'CANDIDATE' | 'RECRUITER' | 'ADMIN';
  name?: string;
  email: string;
  deletedAt: string;
}

const loadDeletedStore = (): Record<string, DeletedUserInfo> => {
  try {
    if (fs.existsSync(DELETED_USERS_FILE)) {
      return JSON.parse(fs.readFileSync(DELETED_USERS_FILE, 'utf-8'));
    }
  } catch (err) {
    // Ignore cache load errors
  }
  return {};
};

const saveDeletedStore = (data: Record<string, DeletedUserInfo>) => {
  try {
    fs.writeFileSync(DELETED_USERS_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    // Ignore cache save errors
  }
};

export const rememberDeletedUser = (email: string, role: any, name?: string) => {
  const norm = (email || '').toLowerCase().trim();
  if (!norm) return;
  const store = loadDeletedStore();
  store[norm] = {
    email: norm,
    role: role || 'CANDIDATE',
    name: name || norm.split('@')[0],
    deletedAt: new Date().toISOString()
  };
  saveDeletedStore(store);
};

export const getDeletedUserInfo = (email: string): DeletedUserInfo | null => {
  const norm = (email || '').toLowerCase().trim();
  if (!norm) return null;
  const store = loadDeletedStore();
  return store[norm] || null;
};

export const removeDeletedUserInfo = (email: string) => {
  const norm = (email || '').toLowerCase().trim();
  if (!norm) return;
  const store = loadDeletedStore();
  if (store[norm]) {
    delete store[norm];
    saveDeletedStore(store);
  }
};

/**
 * Permanently deletes any user (Candidate, Recruiter, or Admin) and completely wipes out
 * all their associated data across all tables with full foreign-key safety.
 */
export async function permanentlyDeleteUser(targetId: string): Promise<{ success: boolean; message: string; deletedUser?: any }> {
  const cleanId = String(targetId).trim();
  if (!cleanId) {
    return { success: false, message: 'Invalid user or profile ID' };
  }

  // 1. Resolve user by ID, candidateProfile ID, or recruiterProfile ID
  let user = await prisma.user.findUnique({
    where: { id: cleanId },
    include: {
      candidateProfile: {
        include: {
          resumes: true,
          applications: true
        }
      },
      recruiterProfile: {
        include: {
          jobs: true
        }
      }
    }
  });

  if (!user) {
    const cand = await prisma.candidateProfile.findUnique({
      where: { id: cleanId },
      include: {
        user: {
          include: {
            candidateProfile: {
              include: {
                resumes: true,
                applications: true
              }
            },
            recruiterProfile: {
              include: {
                jobs: true
              }
            }
          }
        }
      }
    });
    if (cand) user = cand.user;
  }

  if (!user) {
    const rec = await prisma.recruiterProfile.findUnique({
      where: { id: cleanId },
      include: {
        user: {
          include: {
            candidateProfile: {
              include: {
                resumes: true,
                applications: true
              }
            },
            recruiterProfile: {
              include: {
                jobs: true
              }
            }
          }
        }
      }
    });
    if (rec) user = rec.user;
  }

  if (!user) {
    return { success: false, message: 'User account or profile not found in database' };
  }

  const userId = user.id;
  const userRole = user.role;
  const userEmail = (user.email || '').toLowerCase().trim();
  const userName = user.name;

  // Track the deleted user's role so next time they log in or sign up,
  // we know exactly what profile to spin up as a fresh person!
  rememberDeletedUser(userEmail, userRole, userName);

  console.log(`[USER_DELETION] Starting full cascade deletion for ${userRole} ${userEmail} (${userId})`);

  // ==========================================
  // A. IF USER IS A CANDIDATE OR HAS CANDIDATE PROFILE:
  // ==========================================
  if (user.candidateProfile) {
    const candidateProfileId = user.candidateProfile.id;

    // A1. Delete ApplicationStatusHistory for applications submitted by this candidate
    await prisma.applicationStatusHistory.deleteMany({
      where: {
        OR: [
          { application: { candidateId: candidateProfileId } },
          { changedById: userId }
        ]
      }
    });

    // A2. Delete Applications submitted by candidate
    await prisma.application.deleteMany({
      where: { candidateId: candidateProfileId }
    });

    // A3. Delete Interviews for candidate
    await prisma.interview.deleteMany({
      where: { candidateId: candidateProfileId }
    });

    // A4. Delete SavedJobs by candidate
    await prisma.savedJob.deleteMany({
      where: { candidateId: candidateProfileId }
    });

    // A5. Delete Resumes
    await prisma.resume.deleteMany({
      where: { candidateId: candidateProfileId }
    });

    // A6. Clear candidate skills associations
    try {
      await prisma.candidateProfile.update({
        where: { id: candidateProfileId },
        data: { skills: { set: [] } }
      });
    } catch (err) {
      // Ignore if already empty
    }

    // A7. Delete CandidateProfile record
    await prisma.candidateProfile.delete({
      where: { id: candidateProfileId }
    });
    console.log(`[USER_DELETION] Deleted CandidateProfile ${candidateProfileId}`);
  }

  // ==========================================
  // B. IF USER IS A RECRUITER OR HAS RECRUITER PROFILE:
  // ==========================================
  if (user.recruiterProfile) {
    const recruiterProfileId = user.recruiterProfile.id;
    const companyId = user.recruiterProfile.companyId;

    // Fetch all jobs created by this recruiter
    const recruiterJobs = await prisma.job.findMany({
      where: { recruiterId: recruiterProfileId },
      select: { id: true }
    });
    const jobIds = recruiterJobs.map((j) => j.id);

    if (jobIds.length > 0) {
      // B1. Delete ApplicationStatusHistory for all applications on recruiter's jobs
      await prisma.applicationStatusHistory.deleteMany({
        where: { application: { jobId: { in: jobIds } } }
      });

      // B2. Delete all applications submitted to recruiter's jobs
      await prisma.application.deleteMany({
        where: { jobId: { in: jobIds } }
      });

      // B3. Delete saved job entries for recruiter's jobs
      await prisma.savedJob.deleteMany({
        where: { jobId: { in: jobIds } }
      });

      // B4. Delete job skills
      await prisma.jobSkill.deleteMany({
        where: { jobId: { in: jobIds } }
      });

      // B5. Delete interviews tied to these jobs
      await prisma.interview.deleteMany({
        where: { jobId: { in: jobIds } }
      });

      // B6. Delete recruiter's jobs
      await prisma.job.deleteMany({
        where: { id: { in: jobIds } }
      });
      console.log(`[USER_DELETION] Deleted ${jobIds.length} job(s) and their applicant pipelines for recruiter`);
    }

    // B7. Delete any interviews where recruiter was host
    await prisma.interview.deleteMany({
      where: { recruiterId: recruiterProfileId }
    });

    // B8. Delete RecruiterProfile
    await prisma.recruiterProfile.delete({
      where: { id: recruiterProfileId }
    });
    console.log(`[USER_DELETION] Deleted RecruiterProfile ${recruiterProfileId}`);

    // B9. If company has no remaining recruiters and no jobs, safely clean it up
    if (companyId) {
      const remainingRecruiters = await prisma.recruiterProfile.count({ where: { companyId } });
      const remainingJobs = await prisma.job.count({ where: { companyId } });
      if (remainingRecruiters === 0 && remainingJobs === 0) {
        try {
          await prisma.company.delete({ where: { id: companyId } });
          console.log(`[USER_DELETION] Cleaned up empty company ${companyId}`);
        } catch (err) {
          // Ignore if referenced elsewhere
        }
      }
    }
  }

  // ==========================================
  // C. COMMON USER-LEVEL CLEANUP:
  // ==========================================
  // C1. Delete Notifications
  await prisma.notification.deleteMany({
    where: { userId }
  });

  // C2. Delete Messages & Conversations
  try {
    const userConversations = await prisma.conversation.findMany({
      where: { participants: { some: { id: userId } } },
      select: { id: true }
    });
    for (const conv of userConversations) {
      await prisma.message.deleteMany({ where: { conversationId: conv.id } });
      await prisma.conversation.delete({ where: { id: conv.id } });
    }
    await prisma.message.deleteMany({ where: { senderId: userId } });
  } catch (err) {
    console.error('[USER_DELETION] Non-fatal error cleaning messages:', err);
  }

  // C3. Delete AdminAuditLog
  try {
    await prisma.adminAuditLog.deleteMany({
      where: {
        OR: [
          { userId },
          { entityId: userId }
        ]
      }
    });
  } catch (err) {
    console.error('[USER_DELETION] Non-fatal error cleaning audit logs:', err);
  }

  // C4. Delete the User record itself!
  await prisma.user.delete({
    where: { id: userId }
  });

  console.log(`[USER_DELETION] Successfully purged User ${userEmail} (${userId})`);

  return {
    success: true,
    message: `${userRole} account and all associated data permanently deleted.`,
    deletedUser: { id: userId, email: userEmail, role: userRole, name: userName }
  };
}

