/**
 * Cleanly resolves a candidate's real display name.
 * Prevents generic or test artifact names like 'Tester', 'Test Candidate Suite', etc.
 * from ever being presented to Recruiters or Admins.
 */
export function resolveCandidateName(
  user: { name?: string | null; email?: string | null },
  resumes?: Array<{ fileName?: string | null; fileUrl?: string | null }>
): string {
  const rawName = (user?.name || '').trim();
  const isDummy = !rawName || /^(tester|test candidate|test candidate suite|approutes candidate|test|candidate|admin|error test)$/i.test(rawName);

  if (isDummy) {
    // 1. Try to extract clean real name from uploaded resume filename
    if (resumes && resumes.length > 0) {
      for (const r of resumes) {
        const source = r.fileName || r.fileUrl;
        if (source) {
          const decoded = decodeURIComponent(source)
            .split('/')
            .pop()!
            .replace(/\.(pdf|docx?|txt)$/gi, '')
            .replace(/[_-]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

          const stripped = decoded
            .replace(/\b(resume|cv|biodata|profile)\b/gi, '')
            .replace(/[0-9]+/g, '')
            .trim();

          if (stripped.length >= 3 && !/^(test|dummy|untitled|document)$/i.test(stripped)) {
            return stripped
              .split(' ')
              .filter(Boolean)
              .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
              .join(' ');
          }
        }
      }
    }

    // 2. Try to derive from user's email prefix if realistic
    const email = (user?.email || '').toLowerCase().trim();
    const emailPrefix = email.split('@')[0];
    const cleanedPrefix = emailPrefix
      .replace(/[0-9]+/g, ' ')
      .replace(/[._-]+/g, ' ')
      .trim();

    if (cleanedPrefix.length >= 3 && !/^(test|err|admin|candidate)/i.test(cleanedPrefix)) {
      return cleanedPrefix
        .split(' ')
        .filter(Boolean)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
    }
  }

  return rawName || 'Candidate';
}

