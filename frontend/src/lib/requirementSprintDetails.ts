import type { Requirement, RequirementIteration } from "../types";

export type StoryDetailSprintOption = {
  value: string;
  iteration: RequirementIteration;
  name: string;
  state: string | null;
  start_date: string | null;
  end_date: string | null;
};

export const requirementSprintOptionValue = (iteration: RequirementIteration) =>
  String(iteration.jira_sprint_id || iteration.id);

export const requirementSprintSelectionValue = (requirement?: Requirement | null) =>
  String(requirement?.sprint_id || requirement?.iteration_id || requirement?.sprint || "");

export function getStoryDetailSprintOptions(
  iterations: RequirementIteration[],
  currentValue: string
): StoryDetailSprintOption[] {
  const options = new Map<string, StoryDetailSprintOption>();

  iterations.forEach((iteration) => {
    const value = requirementSprintOptionValue(iteration);
    const state = iteration.state || iteration.status || null;
    const isCurrentSprint = value === currentValue;

    // Completed Sprints cannot accept a Story, but a Story already assigned
    // to one must continue to show that Sprint as its selected value.
    if (String(state || "").toLowerCase() === "closed" && !isCurrentSprint) return;
    if (options.has(value)) return;

    options.set(value, {
      value,
      iteration,
      name: iteration.jira_sprint_name || iteration.name,
      state,
      start_date: iteration.start_date || null,
      end_date: iteration.end_date || null
    });
  });

  return [...options.values()];
}

export function resolveRequirementSprintAssignment(
  value: string,
  iterations: RequirementIteration[]
) {
  const iteration = value
    ? iterations.find((candidate) => requirementSprintOptionValue(candidate) === value) || null
    : null;

  if (!iteration) {
    return { iteration, input: { sprint: value, iteration_id: "" } };
  }

  return iteration.jira_sprint_id
    ? { iteration, input: { sprint: String(iteration.jira_sprint_id), iteration_id: "" } }
    : { iteration, input: { sprint: "", iteration_id: iteration.id } };
}
