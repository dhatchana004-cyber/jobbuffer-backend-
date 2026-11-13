import fs from 'fs';
import path from 'path';

export interface EducationRecord {
  degree: string;
  institution: string;
  year: string;
  grade?: string;
  field?: string;
  description?: string;
}

export interface ExperienceRecord {
  role: string;
  company: string;
  duration: string;
  location?: string;
  description?: string;
  skillsUsed?: string[];
}

export interface CandidateExtendedProfile {
  headline?: string;
  bio?: string;
  education: EducationRecord[];
  experienceList: ExperienceRecord[];
  certifications?: string[];
  projects?: Array<{ title: string; description: string; tech: string; link?: string }>;
  languages?: string[];
  links?: { github?: string; linkedin?: string; portfolio?: string };
  isPro?: boolean;
  subscriptionPlan?: string;
  proExpiresAt?: string;
}

const STORE_PATH = path.join(__dirname, '../../.candidate-profiles.json');

// Empty default profiles - candidates start completely clean with no mock data
const DEFAULT_PROFILES: Record<string, CandidateExtendedProfile> = {};

export const loadCandidateStore = (): Record<string, CandidateExtendedProfile> => {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const data = JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'));
      return { ...DEFAULT_PROFILES, ...data };
    }
  } catch (e) {
    console.warn('Error reading candidate store:', e);
  }
  return { ...DEFAULT_PROFILES };
};

export const saveCandidateProfile = (key: string, profile: CandidateExtendedProfile) => {
  try {
    const store = loadCandidateStore();
    store[key.toLowerCase().trim()] = profile;
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error saving candidate profile:', e);
  }
};

export const isCandidatePro = (emailOrId?: string | null): boolean => {
  if (!emailOrId) return false;
  const store = loadCandidateStore();
  const key = emailOrId.toLowerCase().trim();
  const profile = store[key];
  if (!profile || !profile.isPro) return false;
  if (profile.proExpiresAt) {
    return new Date(profile.proExpiresAt).getTime() > Date.now();
  }
  return true;
};

export const setCandidatePro = (emailOrId: string, isPro: boolean, plan: string = 'PRO_MONTHLY', durationDays: number = 30) => {
  if (!emailOrId) return;
  const key = emailOrId.toLowerCase().trim();
  const store = loadCandidateStore();
  const existing = store[key] || { education: [], experienceList: [] };
  const expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();
  store[key] = {
    ...existing,
    isPro,
    subscriptionPlan: isPro ? plan : 'FREE',
    proExpiresAt: isPro ? expiresAt : undefined
  };
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error writing Pro status to candidate store:', e);
  }
};

export const getCandidateExtendedDetails = (user: any, skills: string[] = [], notice?: string) => {
  const store = loadCandidateStore();
  const emailKey = (user?.email || '').toLowerCase().trim();
  const idKey = (user?.id || '').toLowerCase().trim();
  
  if (store[emailKey]) {
    return store[emailKey];
  }
  if (store[idKey]) {
    return store[idKey];
  }

  // Pure clean profile for newly registered candidates - NO mock data
  return {
    headline: user?.headline || '',
    bio: user?.bio || '',
    education: [],
    experienceList: [],
    certifications: [],
    projects: [],
    languages: ['English', 'Tamil'],
    links: {},
    isPro: isCandidatePro(emailKey) || isCandidatePro(idKey),
    subscriptionPlan: 'FREE',
    proExpiresAt: undefined
  };
};
