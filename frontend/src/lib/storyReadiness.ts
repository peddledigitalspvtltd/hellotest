import type { Requirement } from '../types';

export type StoryReadinessCheck = {
  key:string; label:string; status:'met'|'not_met'|'unverified'; evidence:string;
  source:'record'|'review'|'unverified'; verified_by?:string; verified_at?:string; attachment_id?:string;
};
export type StoryReadiness = {
  mode:'backlog'|'release'; label:string; score:number|null; met:number; known:number; total:number; checks:StoryReadinessCheck[];
};
const definitions = {
  backlog:[['persona_value','Persona and Business Value'],['acceptance_criteria','Defined Acceptance Criteria'],['wireframe','Attached Wireframe'],['dependencies','Resolved Dependencies'],['story_points','Team Agreed Story Points']],
  release:[['acceptance_tests','All Acceptance Criteria Tested and Passed'],['code_review','Code Review Approved and Merged'],['automated_tests','Automated Unit and Integration Tests Passing'],['critical_defects','No Open Blocker or High Defects'],['product_owner','Product Owner Sign-off']]
};

export function deriveStoryReadiness(story?:Requirement|null, { forceRelease = false } = {}):StoryReadiness {
  const evidence = story?.catalog_metrics?.readiness;
  if (evidence && (!forceRelease || evidence.mode === 'release')) return evidence;
  const mode = forceRelease || story?.catalog_metrics?.assigned || story?.catalog_metrics?.release_scoped || story?.iteration_id || story?.sprint?.trim() || story?.release?.trim() || story?.fix_version?.trim() ? 'release' : 'backlog';
  return { mode, label:mode === 'backlog' ? 'Story Readiness' : 'Story Release Readiness', score:null, met:0, known:0, total:5,
    checks:definitions[mode].map(([key,label]) => ({ key,label,status:'unverified',source:'unverified',evidence:'Readiness evidence is unavailable. Refresh the Story to verify.' })) };
}

export const storyReadinessMethodology = 'Five equally weighted checks, 20% each. Unverified evidence earns no credit; reviewed checks include the reviewer and time. Content changes require a new review.';
