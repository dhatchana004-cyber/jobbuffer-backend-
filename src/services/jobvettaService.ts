import fs from 'fs';
import path from 'path';
import { 
  ALL_INDIAN_TECH_JOBS_SEED, 
  getCompanyLogo, 
  getVerifiedCareerUrl, 
  COMPANY_LOGO_MAP, 
  OFFICIAL_COMPANY_CAREER_URLS, 
  isDummyUrl, 
  SeedJobDef 
} from './indiaJobsData';

export { getCompanyLogo, getVerifiedCareerUrl, COMPANY_LOGO_MAP, OFFICIAL_COMPANY_CAREER_URLS, isDummyUrl };

export interface JobvettaRawJob {
  job_id?: string;
  id?: string;
  title: string;
  company: string;
  location?: string;
  url: string;
  description?: string;
  days_ago?: number;
  date_posted?: string;
  salary?: string;
  work_mode?: string;
}

export interface UnifiedJob {
  id: string;
  title: string;
  description: string;
  responsibilities: string;
  requirements: string;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
  experienceMin?: number | null;
  experienceMax?: number | null;
  jobType?: string | null;
  employmentType?: string | null;
  type?: string | null;
  salaryRange?: string | null;
  experience?: string | null;
  department?: string | null;
  postedAt?: string | null;
  workMode?: string | null;
  location?: string | null;
  openings?: number;
  status: 'PUBLISHED';
  logo?: string | null;
  company: {
    id: string;
    name: string;
    logo: string | null;
    headquarters: string | null;
  };
  category?: {
    id: string;
    name: string;
  } | null;
  isExternal: true;
  source: 'Jobvetta';
  externalUrl: string;
  applyUrl: string;
  daysAgo: number;
  freshness: 'FRESH' | 'RECENT' | 'ARCHIVED';
  createdAt: string;
  updatedAt: string;
}

export interface CacheEntry {
  key: string;
  params: {
    q?: string;
    location?: string;
    days?: number;
    limit?: number;
  };
  data: UnifiedJob[];
  cachedAt: number;
  expiresAt: number;
  hitCount: number;
}

export interface CacheStats {
  totalCachedQueries: number;
  cacheHits: number;
  cacheMisses: number;
  rateLimitUsedToday: number;
  rateLimitRemaining: number;
  dailyQuota: number;
  lastCleanedAt: string;
  isLiveApiConfigured: boolean;
  ttlMinutes: number;
}

const CACHE_FILE = path.join(process.cwd(), '.jobvetta-cache.json');
const CLICKS_FILE = path.join(process.cwd(), '.jobvetta-clicks.json');
const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes cache expiration
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // Automatic check every 10 mins
const MAX_FRESHNESS_DAYS = 30; // Drop jobs older than 30 days
const DAILY_QUOTA_LIMIT = 50; // Jobvetta free-tier rate limit

// Complete verified Indian tech datasets, career links, and company logos are maintained in ./indiaJobsData.ts

class JobvettaService {
  private cache: Map<string, CacheEntry> = new Map();
  private inFlightRequests: Map<string, Promise<UnifiedJob[]>> = new Map();
  private cacheHitsCount: number = 0;
  private cacheMissCount: number = 0;
  private requestsUsedToday: number = 0;
  private currentUtcDay: string = '';
  private lastCleanedAt: string = new Date().toISOString();
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.updateUtcDay();
    this.loadCacheFromDisk();
    this.startAutomaticCleanup();
  }

  /**
   * Normalize search parameters to generate a unique deterministic cache key
   */
  private makeCacheKey(q?: string, location?: string, days?: number, limit?: number): string {
    const normQ = (q || '').trim().toLowerCase();
    const normLoc = (location || '').trim().toLowerCase();
    const normDays = Number(days) || 14;
    const normLimit = Number(limit) || 20;
    return `q:${normQ}|loc:${normLoc}|days:${normDays}|lim:${normLimit}`;
  }

  /**
   * Reset daily rate limit counter on UTC midnight rollover
   */
  private updateUtcDay(): void {
    const today = new Date().toISOString().slice(0, 10);
    if (this.currentUtcDay !== today) {
      this.currentUtcDay = today;
      this.requestsUsedToday = 0;
      console.log(`[JOBVETTA] Daily rate limit counter reset for UTC Day: ${today}`);
    }
  }

  /**
   * Load cache from disk to preserve rate-limit quota across server restarts
   */
  private loadCacheFromDisk(): void {
    try {
      if (fs.existsSync(CACHE_FILE)) {
        const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const now = Date.now();
          let loaded = 0;
          for (const item of parsed) {
            // Only restore entries that have not expired
            if (item.expiresAt && item.expiresAt > now) {
              this.cache.set(item.key, item);
              loaded++;
            }
          }
          console.log(`[JOBVETTA CACHE] Loaded ${loaded} active cached searches from disk.`);
        }
      }
    } catch (err: any) {
      console.warn('[JOBVETTA CACHE] Failed to load cache from disk:', err?.message);
    }
  }

  /**
   * Persist active cache entries to disk
   */
  private saveCacheToDisk(): void {
    try {
      const activeEntries = Array.from(this.cache.values());
      fs.writeFileSync(CACHE_FILE, JSON.stringify(activeEntries, null, 2), 'utf-8');
    } catch (err: any) {
      console.warn('[JOBVETTA CACHE] Failed to persist cache to disk:', err?.message);
    }
  }

  /**
   * Automatic Background Cleanup Engine
   * Evicts expired cache items and ensures freshness without manual intervention
   */
  private startAutomaticCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.runAutomaticCleanup();
    }, CLEANUP_INTERVAL_MS);
    // Unref to allow clean Node process exit during tests
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  public runAutomaticCleanup(): { removedCount: number; activeCount: number } {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.cache.entries()) {
      // 1. Evict entries where 30-minute expiration has passed
      if (entry.expiresAt <= now) {
        this.cache.delete(key);
        removed++;
        continue;
      }

      // 2. Filter out individual jobs inside cache that have exceeded max freshness
      const freshJobs = entry.data.filter(j => j.daysAgo <= MAX_FRESHNESS_DAYS);
      if (freshJobs.length !== entry.data.length) {
        entry.data = freshJobs;
      }
    }

    if (removed > 0) {
      this.saveCacheToDisk();
      console.log(`[JOBVETTA CLEANUP] Auto-evicted ${removed} expired cache entries. Active entries: ${this.cache.size}`);
    }

    this.lastCleanedAt = new Date().toISOString();
    return { removedCount: removed, activeCount: this.cache.size };
  }

  /**
   * Transform raw Jobvetta API or seed record into unified Jobbuffer Job schema
   */
  private formatToUnifiedJob(raw: any, index: number): UnifiedJob {
    const rawCompany = typeof raw.company === 'string' ? raw.company : (raw.company?.name || raw.companyName || 'Top_Employer');
    const compSlug = rawCompany.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 20);
    const titleSlug = (raw.title || 'software_engineer').toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 25);
    const stableSuffix = `jv_seed_${index}_${compSlug}_${titleSlug}`;
    const jobId = raw.job_id || raw.id || stableSuffix;
    const title = raw.title || 'Software Engineer';
    const company = rawCompany;
    const location = raw.location || raw.locationName || 'Bengaluru, Karnataka, India';
    const verifiedUrl = getVerifiedCareerUrl(company, raw.url || raw.externalUrl);
    const daysAgo = Number(raw.days_ago !== undefined ? raw.days_ago : (raw.daysAgo !== undefined ? raw.daysAgo : 1));
    const description = raw.description || `Exciting career opportunity at ${company} in ${location}.`;
    const responsibilities = raw.responsibilities || 'Collaborate with engineering teams to build scalable, reliable software.';
    const requirements = raw.requirements || 'Relevant experience in modern software engineering principles and collaborative tools.';

    const freshness: 'FRESH' | 'RECENT' | 'ARCHIVED' = 
      daysAgo <= 2 ? 'FRESH' : (daysAgo <= 10 ? 'RECENT' : 'ARCHIVED');

    return {
      id: jobId.startsWith('jobvetta_') ? jobId : `jobvetta_${jobId}`,
      title,
      description,
      responsibilities,
      requirements,
      salaryMin: raw.salaryMin || 800000,
      salaryMax: raw.salaryMax || 2000000,
      salaryRange: raw.salaryMin && raw.salaryMax 
        ? `₹${(raw.salaryMin / 100000).toFixed(1)}L - ₹${(raw.salaryMax / 100000).toFixed(1)}L PA` 
        : 'Competitive Industry CTC',
      salaryCurrency: 'INR',
      experienceMin: raw.experienceMin || 1,
      experienceMax: raw.experienceMax || 5,
      experience: raw.experienceMin !== undefined ? `${raw.experienceMin}-${raw.experienceMax || raw.experienceMin + 3} yrs` : '1-4 yrs',
      jobType: raw.jobType || 'Full-time',
      employmentType: raw.jobType || 'Full-time',
      type: raw.jobType || 'Full-time',
      workMode: raw.workMode || (location.toLowerCase().includes('remote') ? 'Remote' : 'Hybrid'),
      location,
      openings: 1,
      status: 'PUBLISHED',
      logo: getCompanyLogo(company, raw.logo || raw.company?.logo),
      company: {
        id: `comp_jv_${company.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
        name: company,
        logo: getCompanyLogo(company, raw.logo || raw.company?.logo),
        headquarters: location
      },
      department: company,
      category: {
        id: 'cat_engineering',
        name: 'Technology & Software'
      },
      isExternal: true,
      source: 'Jobvetta',
      externalUrl: verifiedUrl,
      applyUrl: verifiedUrl,
      daysAgo,
      freshness,
      postedAt: daysAgo === 0 ? 'Today' : daysAgo === 1 ? '1d ago' : `${daysAgo}d ago`,
      createdAt: raw.date_posted || new Date(Date.now() - daysAgo * 86400000).toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  /**
   * Filter Seed Jobs based on candidate query and location
   */
  private filterSeedJobs(q?: string, location?: string, days?: number, limit?: number): UnifiedJob[] {
    let list = ALL_INDIAN_TECH_JOBS_SEED.map((seed, idx) => this.formatToUnifiedJob(seed, idx));

    if (q && q.trim()) {
      const qTokens = q.toLowerCase().split(/\s+/).filter(Boolean);
      list = list.filter(j => {
        const hay = `${j.title} ${j.company.name} ${j.description} ${j.requirements}`.toLowerCase();
        return qTokens.some(tok => hay.includes(tok));
      });
    }

    if (location && location.trim() && location.toLowerCase() !== 'all' && location.toLowerCase() !== 'india') {
      const locTok = location.toLowerCase().trim();
      list = list.filter(j => (j.location || '').toLowerCase().includes(locTok));
    }

    const maxDays = Number(days) || 30;
    list = list.filter(j => j.daysAgo <= maxDays);

    const lim = Number(limit) || 250;
    return list.slice(0, lim);
  }

  /**
   * Main Search Method with 30-Minute Caching, In-flight Request Coalescing,
   * Rate Limit Protection, and Automatic Fallback.
   */
  public async searchJobs(params: {
    q?: string;
    location?: string;
    days?: number;
    limit?: number;
    forceRefresh?: boolean;
  }): Promise<{ jobs: UnifiedJob[]; fromCache: boolean; rateLimitRemaining: number; totalCount: number }> {
    this.updateUtcDay();

    const { q, location, days = 30, limit = 250, forceRefresh = false } = params;
    const cacheKey = this.makeCacheKey(q, location, days, limit);
    const now = Date.now();

    // 1. Check Cache (if not explicitly forced or cooling down)
    if (!forceRefresh) {
      const cached = this.cache.get(cacheKey);
      if (cached && cached.expiresAt > now) {
        cached.hitCount = (cached.hitCount || 0) + 1;
        this.cacheHitsCount++;
        return {
          jobs: cached.data,
          fromCache: true,
          rateLimitRemaining: Math.max(0, DAILY_QUOTA_LIMIT - this.requestsUsedToday),
          totalCount: cached.data.length
        };
      }
    }

    // 2. Prevent Thundering Herd / In-Flight Request Coalescing
    if (this.inFlightRequests.has(cacheKey)) {
      const coalesced = await this.inFlightRequests.get(cacheKey)!;
      return {
        jobs: coalesced,
        fromCache: true,
        rateLimitRemaining: Math.max(0, DAILY_QUOTA_LIMIT - this.requestsUsedToday),
        totalCount: coalesced.length
      };
    }

    // 3. Initiate Fetch (live API or fallback)
    const fetchPromise = (async (): Promise<UnifiedJob[]> => {
      this.cacheMissCount++;
      const apiKey = process.env.JOBVETTA_API_KEY || '';
      const baseUrl = process.env.JOBVETTA_BASE_URL || 'https://api.jobvetta.com/v1';

      // Check Rate Limit Budget
      if (this.requestsUsedToday >= DAILY_QUOTA_LIMIT) {
        console.warn(`[JOBVETTA] Daily rate limit (${DAILY_QUOTA_LIMIT} reqs) reached for today. Serving cached/seed jobs.`);
        return this.filterSeedJobs(q, location, days, limit);
      }

      // If API key is configured, call Jobvetta API
      if (apiKey && apiKey.trim()) {
        try {
          const url = new URL(`${baseUrl}/jobs`);
          if (q) url.searchParams.set('q', q);
          if (location && location.toLowerCase() !== 'all') url.searchParams.set('location', location);
          url.searchParams.set('days', String(days || 14));
          url.searchParams.set('limit', String(limit || 20));

          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 9000); // 9 second timeout

          const response = await fetch(url.toString(), {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${apiKey.trim()}`,
              'Accept': 'application/json',
              'User-Agent': 'JoBuffer-Recruitment-Portal/2.0'
            },
            signal: controller.signal
          });

          clearTimeout(timeout);
          this.requestsUsedToday++;

          if (response.ok) {
            const json: any = await response.json();
            const rawJobs: any[] = Array.isArray(json) ? json : (json?.jobs || []);
            
            // Format & validate freshness
            const unified = rawJobs
              .map((r, i) => this.formatToUnifiedJob(r, i))
              .filter(j => j.daysAgo <= MAX_FRESHNESS_DAYS);

            console.log(`[JOBVETTA API] Fetched ${unified.length} live jobs from Jobvetta API.`);
            return unified.length > 0 ? unified : this.filterSeedJobs(q, location, days, limit);
          } else {
            console.warn(`[JOBVETTA API] Error ${response.status}: ${response.statusText}. Using fallback.`);
            return this.filterSeedJobs(q, location, days, limit);
          }
        } catch (fetchErr: any) {
          console.warn('[JOBVETTA API] Connection issue or timeout:', fetchErr?.message);
          return this.filterSeedJobs(q, location, days, limit);
        }
      } else {
        // No API key configured yet -> Serve rich India Tech dataset
        return this.filterSeedJobs(q, location, days, limit);
      }
    })();

    this.inFlightRequests.set(cacheKey, fetchPromise);

    try {
      const results = await fetchPromise;

      // 4. Store in Cache with 30-Minute Expiration
      const cacheEntry: CacheEntry = {
        key: cacheKey,
        params: { q, location, days, limit },
        data: results,
        cachedAt: now,
        expiresAt: now + DEFAULT_TTL_MS, // Exactly 30 minutes
        hitCount: 1
      };

      this.cache.set(cacheKey, cacheEntry);
      this.saveCacheToDisk();

      return {
        jobs: results,
        fromCache: false,
        rateLimitRemaining: Math.max(0, DAILY_QUOTA_LIMIT - this.requestsUsedToday),
        totalCount: results.length
      };
    } finally {
      this.inFlightRequests.delete(cacheKey);
    }
  }

  /**
   * Fetch a single Jobvetta job by its ID
   */
  public async getJobById(jobId: string): Promise<UnifiedJob | null> {
    if (!jobId) return null;
    const cleanId = jobId.startsWith('jobvetta_') ? jobId : `jobvetta_${jobId}`;
    
    // 1. Search in current cache entries first
    for (const entry of this.cache.values()) {
      const found = entry.data.find(j => j.id === cleanId || j.id === jobId || (j as any)._id === jobId);
      if (found) {
        found.externalUrl = getVerifiedCareerUrl(found.company?.name, found.externalUrl);
        found.applyUrl = found.externalUrl;
        return found;
      }
    }

    // 2. Search in deterministic seed jobs
    const allSeeds = ALL_INDIAN_TECH_JOBS_SEED.map((s, idx) => this.formatToUnifiedJob(s, idx));
    const seedFound = allSeeds.find(j => 
      j.id === cleanId || 
      j.id === jobId || 
      j.id.toLowerCase() === cleanId.toLowerCase()
    );
    if (seedFound) {
      seedFound.externalUrl = getVerifiedCareerUrl(seedFound.company?.name, seedFound.externalUrl);
      seedFound.applyUrl = seedFound.externalUrl;
      return seedFound;
    }

    // 3. Backward-compatible timestamp index matching (e.g. jv_1793604647662_2 or jv_seed_2)
    const matchIndex = jobId.match(/_(\d+)$/);
    if (matchIndex && matchIndex[1]) {
      const idx = parseInt(matchIndex[1], 10);
      if (idx >= 0 && idx < allSeeds.length) {
        const indexedJob = allSeeds[idx];
        return indexedJob;
      }
    }

    // 4. Fuzzy / Title & Company fallback match across all seeds
    const cleanKeyword = jobId.replace(/^(jobvetta_|jv_|click_)/i, '').replace(/[_-]/g, ' ').toLowerCase();
    const fuzzyMatch = allSeeds.find(j => {
      const comp = (j.company?.name || '').toLowerCase();
      const tit = (j.title || '').toLowerCase();
      return (comp && cleanKeyword.includes(comp)) || (tit && cleanKeyword.includes(tit));
    });
    if (fuzzyMatch) return fuzzyMatch;

    return null;
  }

  /**
   * Record external application redirect click
   */
  public logApplyRedirect(jobId: string, candidateUserId?: string): void {
    try {
      let clicks: any[] = [];
      if (fs.existsSync(CLICKS_FILE)) {
        clicks = JSON.parse(fs.readFileSync(CLICKS_FILE, 'utf-8'));
      }
      clicks.unshift({
        id: `click_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        jobId,
        candidateUserId: candidateUserId || 'anonymous',
        timestamp: new Date().toISOString()
      });
      fs.writeFileSync(CLICKS_FILE, JSON.stringify(clicks.slice(0, 500), null, 2), 'utf-8');
      console.log(`[JOBVETTA APPLY] Candidate clicked Apply Now for job ${jobId}`);
    } catch (e) {}
  }

  /**
   * Telemetry and Status for Monitoring
   */
  public getStats(): CacheStats {
    this.updateUtcDay();
    return {
      totalCachedQueries: this.cache.size,
      cacheHits: this.cacheHitsCount,
      cacheMisses: this.cacheMissCount,
      rateLimitUsedToday: this.requestsUsedToday,
      rateLimitRemaining: Math.max(0, DAILY_QUOTA_LIMIT - this.requestsUsedToday),
      dailyQuota: DAILY_QUOTA_LIMIT,
      lastCleanedAt: this.lastCleanedAt,
      isLiveApiConfigured: Boolean(process.env.JOBVETTA_API_KEY && process.env.JOBVETTA_API_KEY.trim()),
      ttlMinutes: 30
    };
  }
}

export const jobvettaService = new JobvettaService();
