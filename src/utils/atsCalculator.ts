/**
 * ATS Match Score Calculator
 * Evaluates compatibility between candidate profile/skills and job requirements/skills.
 */

export function calculateAtsScore(
  candidateSkills: string[] = [],
  jobSkills: string[] = [],
  jobTitle: string = '',
  jobRequirements?: string | null,
  jobDescription?: string | null
): number {
  if (!candidateSkills || candidateSkills.length === 0) {
    return 0; // Unscored
  }

  const normCand = candidateSkills.map(s => s.trim().toLowerCase());
  const jobText = `${jobTitle || ''} ${jobRequirements || ''} ${jobDescription || ''}`.toLowerCase();
  const titleLower = (jobTitle || '').toLowerCase();

  // 1. Direct Job Skill matches if job has explicit required skills
  if (jobSkills && jobSkills.length > 0) {
    const normJob = jobSkills.map(s => s.trim().toLowerCase());
    let directMatches = 0;
    normJob.forEach(js => {
      if (normCand.some(cs => cs === js || cs.includes(js) || js.includes(cs))) {
        directMatches++;
      }
    });
    const directRatio = directMatches / normJob.length;
    return Math.min(96, Math.max(45, Math.round(52 + directRatio * 44)));
  }

  // 2. Keyword relevance matching against job title & requirements text
  let keywordHits = 0;
  normCand.forEach(cs => {
    if (cs.length > 1 && jobText.includes(cs)) {
      keywordHits++;
    }
  });

  let roleRelevance = 0;
  if (titleLower.includes('ai') || titleLower.includes('ml') || titleLower.includes('machine learning') || titleLower.includes('generative')) {
    if (normCand.some(s => ['python', 'aws', 'docker', 'tensorflow', 'pytorch', 'sql'].includes(s))) {
      roleRelevance = 16;
    }
  } else if (titleLower.includes('data') || titleLower.includes('analyst') || titleLower.includes('analytics')) {
    if (normCand.some(s => ['python', 'sql', 'tableau', 'powerbi', 'r', 'excel', 'aws', 'docker'].includes(s))) {
      roleRelevance = 12;
    }
  } else if (titleLower.includes('test') || titleLower.includes('qa') || titleLower.includes('quality')) {
    if (normCand.some(s => ['selenium', 'java', 'javascript', 'testing', 'cypress', 'sql', 'html'].includes(s))) {
      roleRelevance = 14;
    }
  } else if (titleLower.includes('developer') || titleLower.includes('engineer') || titleLower.includes('frontend') || titleLower.includes('backend') || titleLower.includes('software')) {
    if (normCand.some(s => ['react', 'node', 'javascript', 'typescript', 'python', 'java', 'sql', 'html'].includes(s))) {
      roleRelevance = 15;
    }
  }

  const matchedRatio = keywordHits / Math.max(1, normCand.length);
  const baseScore = 55 + Math.round(matchedRatio * 22) + roleRelevance;

  // Consistent deterministic offset per applicant skills & job title
  const seed = (candidateSkills.join('').length * 7 + jobTitle.length * 3) % 5;
  const finalScore = Math.min(95, Math.max(45, baseScore + seed));

  return finalScore;
}
