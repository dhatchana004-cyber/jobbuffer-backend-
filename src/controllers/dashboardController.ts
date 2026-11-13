import { Request, Response } from 'express';
import { prisma } from '../server';

export const getAdminDashboardStats = async (req: Request, res: Response) => {
  try {
    const totalCandidates = await prisma.user.count({ where: { role: 'CANDIDATE' } });
    const totalRecruiters = await prisma.user.count({ where: { role: 'RECRUITER' } });
    const totalCompanies = await prisma.company.count();
    const activeJobs = await prisma.job.count({ where: { status: 'PUBLISHED' } });
    const totalApplications = await prisma.application.count();

    const yearParam = req.query.year;
    const targetYear = yearParam ? parseInt(yearParam as string, 10) : new Date().getFullYear();

    const startOfYear = new Date(targetYear, 0, 1);
    const endOfYear = new Date(targetYear, 11, 31, 23, 59, 59, 999);

    const yearUsers = await prisma.user.findMany({
      where: {
        createdAt: { gte: startOfYear, lte: endOfYear },
        role: { in: ['CANDIDATE', 'RECRUITER'] }
      },
      select: { role: true, createdAt: true }
    });

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const growthDataMap = new Map();
    
    // Initialize 12 months for the target year
    for (let i = 0; i < 12; i++) {
      const m = monthNames[i];
      growthDataMap.set(m, { name: m, candidates: 0, recruiters: 0 });
    }

    yearUsers.forEach(user => {
      const m = monthNames[user.createdAt.getMonth()];
      const data = growthDataMap.get(m);
      if (data) {
        if (user.role === 'CANDIDATE') data.candidates++;
        if (user.role === 'RECRUITER') data.recruiters++;
      }
    });

    const growthData = Array.from(growthDataMap.values());

    const categoriesWithCount = await prisma.jobCategory.findMany({
      include: {
        _count: {
          select: { jobs: true }
        }
      }
    });

    const categoryData = categoriesWithCount
      .map(c => ({ name: c.name, value: c._count.jobs }))
      .filter(c => c.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
    
    if (categoryData.length === 0) {
      categoryData.push({ name: 'Uncategorized', value: 0 });
    }

    return res.status(200).json({
      kpis: {
        totalCandidates,
        totalRecruiters,
        totalCompanies,
        activeJobs,
        totalApplications,
      },
      charts: {
        growthData,
        categoryData,
      }
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

export const getRecruiterDashboardStats = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const profile = await prisma.recruiterProfile.findUnique({
      where: { userId }
    });

    if (!profile) {
      return res.status(200).json({
        kpis: {
          activeJobs: 0,
          totalApplications: 0,
          shortlisted: 0,
          interviews: 0,
          hired: 0
        },
        charts: {
          applicationData: [
            { name: 'Mon', applicants: 0 },
            { name: 'Tue', applicants: 0 },
            { name: 'Wed', applicants: 0 },
            { name: 'Thu', applicants: 0 },
            { name: 'Fri', applicants: 0 }
          ],
          funnelData: [
            { name: 'Applied', count: 0 },
            { name: 'Screening', count: 0 },
            { name: 'Interview', count: 0 },
            { name: 'Offered', count: 0 },
            { name: 'Hired', count: 0 }
          ]
        }
      });
    }

    // Multi-tenant isolation: Strictly isolate recruiter's jobs and applications
    const whereJob = { recruiterId: profile.id };

    const activeJobs = await prisma.job.count({ where: { ...whereJob, status: 'PUBLISHED' } });
    const totalApplications = await prisma.application.count({
      where: { job: whereJob }
    });
    const pendingReview = await prisma.application.count({
      where: { job: whereJob, status: 'APPLIED' }
    });
    const shortlisted = await prisma.application.count({
      where: { job: whereJob, status: 'SHORTLISTED' }
    });
    const rejected = await prisma.application.count({
      where: { job: whereJob, status: 'REJECTED' }
    });

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const recentApplications = await prisma.application.findMany({
      where: {
        job: whereJob,
        createdAt: {
          gte: sevenDaysAgo
        }
      },
      select: {
        createdAt: true
      }
    });

    const interviews = await (prisma as any).interview.count({
      where: { recruiterId: profile.id }
    });
    const hired = await prisma.application.count({
      where: { job: whereJob, status: { in: ['HIRED', 'SELECTED'] } }
    });

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const applicationData: { name: string; dateKey: string; applicants: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const name = dayNames[d.getDay()];
      const dateKey = d.toISOString().slice(0, 10);
      applicationData.push({ name, dateKey, applicants: 0 });
    }

    recentApplications.forEach(app => {
      const appKey = app.createdAt.toISOString().slice(0, 10);
      const dayData = applicationData.find(d => d.dateKey === appKey);
      if (dayData) {
        dayData.applicants++;
      }
    });

    const funnelData = [
      { name: 'Total Applied', count: totalApplications },
      { name: 'Under Review', count: pendingReview },
      { name: 'Shortlisted', count: shortlisted },
      { name: 'Rejected', count: rejected },
    ];

    return res.status(200).json({
      kpis: {
        activeJobs,
        totalApplications,
        pendingReview,
        shortlisted,
        rejected,
        interviews,
        hired
      },
      charts: {
        applicationData: applicationData.map(({ name, applicants }) => ({ name, applicants })),
        funnelData
      }
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};
