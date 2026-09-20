import type { RequirementRelease } from "../types";

type Version = { id: string | number; name: string; released?: boolean; archived?: boolean };
type ReleaseStamp = { release?: string | null; fix_version?: string | null };
export type StoryReleaseOption = {
  value: string;
  label: string;
  releaseId: string;
  release: string;
  fixVersion: string;
  completed: boolean;
};

export const isRequirementReleaseClosed = (release: RequirementRelease) =>
  (release.persisted_state || release.state) === "released";

export function getStoryReleaseOptions(releases: RequirementRelease[], versions: Version[], current: ReleaseStamp = {}) {
  const options: StoryReleaseOption[] = releases.map(release => ({
    value: `release:${release.id}`, label: release.name,
    releaseId: release.id, release: release.name, fixVersion: release.fix_version,
    completed: isRequirementReleaseClosed(release)
  }));
  for (const version of versions) {
    if (version.archived) continue;
    // The project release is the canonical choice when a connected version has
    // the same name; selecting it must retain the persisted release membership.
    if (options.some(option => option.fixVersion === version.name)) continue;
    options.push({ value: `jira:${version.id}`, label: version.name, releaseId: "", release: version.name,
      fixVersion: version.name, completed: Boolean(version.released) });
  }
  const currentValue = current.fix_version || current.release || "";
  let selected = options.find(option => option.release === current.release && option.fixVersion === current.fix_version)
    || options.find(option => option.fixVersion === currentValue);
  if (!selected && currentValue) {
    selected = { value: `saved:${encodeURIComponent(currentValue)}`, label: currentValue, releaseId: "",
      release: current.release || "", fixVersion: current.fix_version || "", completed: false };
    options.push(selected);
  }
  return { options: options.filter(option => !option.completed || option === selected), value: selected?.value || "" };
}
