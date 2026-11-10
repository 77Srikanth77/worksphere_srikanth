/**
 * Explainable keyword/skill matching between a job posting and employee profiles.
 *
 * Employee profile text = bio + every job title, project and job duties they have had + trainings.
 * Score (0-100):
 *   - with required skills:  70% = share of required skills found in the profile
 *                            30% = share of the posting's keywords found in the profile
 *   - without skills:        100% keyword share
 * The response lists which skills matched and which are missing, so the agent can see why.
 */
const STOP = new Set(`a an and are as at be by for from has have in into is it its of on or our that the their this to with will
 you your we they them who what when where which while about above after all also any across both can could each etc
 experience experienced years year strong good excellent ability able work working team teams using use used including include
 knowledge understanding skills skill required requirement requirements responsibilities responsible role roles job duties duty
 must should plus preferred nice candidate candidates position client project projects within per new other such well level
 senior junior lead mid develop developing development developer developers engineer engineers engineering build building
 maintain support design implement implementing provide ensure participate perform`.split(/\s+/));

// Common spellings → one form, so "ReactJS", "React.js" and "react" all match
const SYNONYMS = [
  [/\breact\.?js\b|\breactjs\b/g, 'react'], [/\bnode\.?js\b|\bnodejs\b/g, 'node'], [/\bvue\.?js\b/g, 'vue'],
  [/\bangular\.?js\b/g, 'angular'], [/\bnext\.?js\b/g, 'nextjs'], [/\bexpress\.?js\b/g, 'express'],
  [/\bjs\b/g, 'javascript'], [/\bts\b/g, 'typescript'], [/\bk8s\b/g, 'kubernetes'], [/\bgolang\b/g, 'go'],
  [/\bamazon web services\b/g, 'aws'], [/\bgoogle cloud( platform)?\b|\bgcp\b/g, 'gcp'], [/\bms azure\b/g, 'azure'],
  [/\bpostgres(ql)?\b/g, 'postgresql'], [/\bmongo(db)?\b/g, 'mongodb'], [/\bspring ?boot\b/g, 'springboot'],
  [/\bci\s*\/\s*cd\b/g, 'cicd'], [/\bc#|\bc sharp\b/g, 'csharp'], [/\.net\b|\bdotnet\b/g, 'dotnet'],
  [/\bml\b/g, 'machinelearning'], [/\bmachine learning\b/g, 'machinelearning'], [/\bqa\b/g, 'qa testing'],
  [/\bsdet\b/g, 'sdet testing automation'], [/\bselenium webdriver\b/g, 'selenium'], [/\brest(ful)? apis?\b/g, 'restapi'],
  [/\bmicro-?services?\b/g, 'microservices'], [/\bpyspark\b/g, 'spark python'], [/\bdata ?lake\b/g, 'datalake'],
];

function normalize(text) {
  let t = ` ${String(text || '').toLowerCase()} `;
  for (const [re, rep] of SYNONYMS) t = t.replace(re, ` ${rep} `);
  // Treat plurals as the singular: "dashboards" = "dashboard", "apis" = "api"
  return t.replace(/[^a-z0-9+#\s]/g, ' ').replace(/\s+/g, ' ').trim()
    .split(' ').map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)).join(' ');
}
function keywords(text) {
  return [...new Set(normalize(text).split(' ').filter((w) => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w)))];
}
const splitSkills = (skills) => String(skills || '').split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);

/** Score one employee profile against a posting */
function score(posting, profileText) {
  const prof = ` ${normalize(profileText)} `;
  const has = (phrase) => {
    const n = normalize(phrase);
    return n && prof.includes(` ${n} `);
  };
  const skills = splitSkills(posting.skills);
  const matchedSkills = skills.filter(has);
  const missingSkills = skills.filter((s) => !has(s));
  const kw = keywords(`${posting.title || ''} ${posting.description || ''}`).slice(0, 40);
  const matchedKw = kw.filter((k) => prof.includes(` ${k} `));
  const kwShare = kw.length ? matchedKw.length / kw.length : 0;
  const skillShare = skills.length ? matchedSkills.length / skills.length : null;
  const value = skillShare == null ? kwShare : 0.7 * skillShare + 0.3 * kwShare;
  return {
    score: Math.round(value * 100),
    matched_skills: matchedSkills,
    missing_skills: missingSkills,
    matched_keywords: matchedKw.filter((k) => !matchedSkills.some((s) => normalize(s) === k)).slice(0, 12),
  };
}

module.exports = { score, splitSkills, normalize };
