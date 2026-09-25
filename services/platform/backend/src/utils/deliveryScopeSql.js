// Alias arguments are fixed source-code identifiers, never request values.
const releaseStoryMembershipSql = (story = 'r', release = 'rel') => `(
  EXISTS (SELECT 1 FROM requirement_release_items membership
    WHERE membership.release_id = ${release}.id AND membership.requirement_id = ${story}.id AND membership.source = 'manual')
  OR EXISTS (SELECT 1 FROM requirement_release_sprints scope
    WHERE scope.release_id = ${release}.id AND scope.iteration_id = ${story}.iteration_id)
  OR (${story}.iteration_id IS NULL AND NULLIF(TRIM(${story}.sprint), '') IS NOT NULL
    AND EXISTS (SELECT 1 FROM requirement_release_sprints scope JOIN requirement_iterations sprint ON sprint.id = scope.iteration_id
      WHERE scope.release_id = ${release}.id AND sprint.project_id = ${story}.project_id AND LOWER(TRIM(sprint.name)) = LOWER(TRIM(${story}.sprint))
      AND (SELECT COUNT(*) FROM requirement_iterations candidate WHERE candidate.project_id = sprint.project_id AND LOWER(TRIM(candidate.name)) = LOWER(TRIM(sprint.name))) = 1))
  OR (NOT EXISTS (SELECT 1 FROM requirement_release_items membership WHERE membership.requirement_id = ${story}.id)
    AND NOT EXISTS (SELECT 1 FROM requirement_release_sprints scope WHERE scope.iteration_id = ${story}.iteration_id)
    AND NULLIF(LOWER(TRIM(COALESCE(NULLIF(TRIM(${story}.fix_version), ''), ${story}.release))), '') IS NOT NULL
    AND (LOWER(TRIM(${release}.fix_version)) = LOWER(TRIM(COALESCE(NULLIF(TRIM(${story}.fix_version), ''), ${story}.release)))
      OR LOWER(TRIM(${release}.name)) = LOWER(TRIM(COALESCE(NULLIF(TRIM(${story}.fix_version), ''), ${story}.release))))
    AND (SELECT COUNT(*) FROM requirement_releases candidate WHERE candidate.project_id = ${story}.project_id
      AND (LOWER(TRIM(candidate.fix_version)) = LOWER(TRIM(COALESCE(NULLIF(TRIM(${story}.fix_version), ''), ${story}.release)))
        OR LOWER(TRIM(candidate.name)) = LOWER(TRIM(COALESCE(NULLIF(TRIM(${story}.fix_version), ''), ${story}.release))))) = 1)
)`;

const releaseExecutionMembershipSql = (execution = 'e', release = 'rel') => `(
  ${execution}.release_id = ${release}.id
  OR (${execution}.release_id IS NULL AND (
    (NULLIF(TRIM(${execution}.release), '') IS NULL AND EXISTS (
      SELECT 1 FROM requirement_release_sprints scope WHERE scope.release_id = ${release}.id AND scope.iteration_id = ${execution}.iteration_id))
    OR (NULLIF(TRIM(${execution}.release), '') IS NOT NULL
      AND (LOWER(TRIM(${execution}.release)) = LOWER(TRIM(${release}.fix_version)) OR LOWER(TRIM(${execution}.release)) = LOWER(TRIM(${release}.name)))
      AND (SELECT COUNT(*) FROM requirement_releases candidate WHERE candidate.project_id = ${execution}.project_id
        AND (LOWER(TRIM(candidate.fix_version)) = LOWER(TRIM(${execution}.release)) OR LOWER(TRIM(candidate.name)) = LOWER(TRIM(${execution}.release)))) = 1)
  ))
)`;

module.exports = { releaseStoryMembershipSql, releaseExecutionMembershipSql };
