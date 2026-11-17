import { useEffect, useMemo, useRef, useState } from "react";
import { IconFilter, IconInfoCircle } from "@tabler/icons-react";
import { AddIcon, ModuleIcon, SearchIcon, SelectionToggleIcon, StoryIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";
import { DialogCloseButton } from "@hellotest/platform/frontend/src/shared/components/DialogCloseButton";
import { FormField } from "@hellotest/platform/frontend/src/shared/components/FormField";
import { HierarchyAutoLoadSentinel } from "./HierarchyLoadMoreButton";
import { LoadingState } from "@hellotest/platform/frontend/src/shared/components/LoadingState";
import { RichTextEditor } from "@hellotest/platform/frontend/src/platform/components/RichTextEditor";
import { StatusBadge } from "@hellotest/platform/frontend/src/shared/components/StatusBadge";
import { TestCasePicker } from "./TestCasePicker";
import { useDialogFocus } from "@hellotest/platform/frontend/src/shared/hooks/useDialogFocus";
import type { Requirement, TestCase } from "@hellotest/platform/frontend/src/types";

export type CreateModuleDraft = {
  description: string;
  name: string;
  requirementIds: string[];
  testCaseIds: string[];
};

export const MAX_CREATE_MODULE_REQUIREMENTS = 100;

export function ModuleRequirementPicker({
  candidateRequirements,
  canSelectRequirements,
  hasMoreRequirements,
  isLoadingMoreRequirements,
  isLoadingRequirements,
  isLocked,
  isSaving,
  onLoadMoreRequirements,
  onSelectionChange,
  selectedIds
}: {
  candidateRequirements: Requirement[];
  canSelectRequirements: boolean;
  hasMoreRequirements: boolean;
  isLoadingMoreRequirements: boolean;
  isLoadingRequirements: boolean;
  isLocked: boolean;
  isSaving: boolean;
  onLoadMoreRequirements: () => void | Promise<unknown>;
  onSelectionChange: (ids: string[]) => void;
  selectedIds: string[];
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false);
  const filterMenuRef = useRef<HTMLDivElement | null>(null);
  const filterTriggerRef = useRef<HTMLButtonElement | null>(null);
  const selectAllVisibleRef = useRef<HTMLInputElement | null>(null);
  const isDisabled = !canSelectRequirements || isLocked || isSaving;
  const visibleOptions = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return candidateRequirements
      .filter((requirement) => {
        if (statusFilter && String(requirement.status || "").toLowerCase() !== statusFilter.toLowerCase()) return false;
        if (priorityFilter && String(requirement.priority ?? "") !== priorityFilter) return false;
        if (!normalizedSearch) return true;
        return [
          requirement.display_id || "",
          requirement.id,
          requirement.title,
          requirement.status || "",
          requirement.priority === null || requirement.priority === undefined ? "" : `P${requirement.priority}`
        ].some((value) => String(value).toLowerCase().includes(normalizedSearch));
      })
      .sort((left, right) => (
        left.title.localeCompare(right.title)
        || String(left.display_id || left.id).localeCompare(String(right.display_id || right.id))
      ));
  }, [candidateRequirements, priorityFilter, search, statusFilter]);
  const statusOptions = useMemo(
    () => [...new Set(candidateRequirements.map((requirement) => String(requirement.status || "").trim()).filter(Boolean))].sort(),
    [candidateRequirements]
  );
  const priorityOptions = useMemo(
    () => [...new Set(candidateRequirements
      .map((requirement) => requirement.priority)
      .filter((priority): priority is number => priority !== null && priority !== undefined))]
      .sort((left, right) => left - right),
    [candidateRequirements]
  );
  const visibleIds = visibleOptions.map((requirement) => requirement.id);
  const visibleSelectedCount = visibleIds.filter((requirementId) => selectedIds.includes(requirementId)).length;
  const areAllVisibleSelected = Boolean(visibleIds.length) && visibleSelectedCount === visibleIds.length;
  const areSomeVisibleSelected = visibleSelectedCount > 0 && !areAllVisibleSelected;

  useEffect(() => {
    if (selectAllVisibleRef.current) {
      selectAllVisibleRef.current.indeterminate = areSomeVisibleSelected;
    }
  }, [areSomeVisibleSelected]);

  useEffect(() => {
    if (!isFilterMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!filterMenuRef.current?.contains(event.target as Node)) {
        setIsFilterMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isFilterMenuOpen]);

  const setVisibleSelection = (checked: boolean) => {
    onSelectionChange(checked
      ? [...new Set([...selectedIds, ...visibleIds])]
      : selectedIds.filter((requirementId) => !visibleIds.includes(requirementId)));
  };

  return (
    <section
      className="test-case-create-module-requirements"
      aria-labelledby="module-requirements-heading"
      onKeyDownCapture={(event) => {
        if (event.key === "Escape" && isFilterMenuOpen) {
          event.preventDefault();
          event.stopPropagation();
          setIsFilterMenuOpen(false);
          window.requestAnimationFrame(() => filterTriggerRef.current?.focus());
        }
      }}
    >
      <div className="test-case-create-module-section-heading test-case-create-module-requirement-heading">
        <div>
          <h3 id="module-requirements-heading">Requirement Selection</h3>
          {isLocked ? <p>The selected Requirements were saved when this module was created.</p> : null}
          {!isLocked && !canSelectRequirements ? <p>Viewing Requirements requires Story access.</p> : null}
        </div>
        <span className="test-case-create-module-selection-count" aria-live="polite">
          {selectedIds.length} selected
        </span>
      </div>

      <div className="test-case-create-module-picker-panel test-case-create-module-requirement-panel">
        <div className="test-case-create-module-picker-toolbar test-case-create-module-requirement-toolbar">
          <label className="test-case-create-module-search">
            <SearchIcon size={16} />
            <span className="sr-only">Search Requirements</span>
            <input
              aria-label="Search Requirements by ID or title"
              disabled={isDisabled}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.preventDefault();
              }}
              placeholder="Search ID or title..."
              type="search"
              value={search}
            />
          </label>
          <div className="test-case-create-module-filter-wrap" ref={filterMenuRef}>
            <button
              aria-controls="create-module-requirement-filter-menu"
              aria-expanded={isFilterMenuOpen}
              aria-haspopup="dialog"
              aria-label="Filter Requirements"
              className={statusFilter || priorityFilter ? "ghost-button is-active" : "ghost-button"}
              disabled={isDisabled}
              onClick={() => setIsFilterMenuOpen((current) => !current)}
              ref={filterTriggerRef}
              type="button"
            >
              <IconFilter aria-hidden="true" size={15} stroke={1.8} />
              <span className="sr-only">Filters</span>
            </button>
            {isFilterMenuOpen ? (
              <div
                aria-label="Filter Requirements"
                className="test-case-create-module-filter-menu test-case-create-module-requirement-filter-menu"
                id="create-module-requirement-filter-menu"
                role="dialog"
              >
                <FormField label="Status">
                  <select disabled={isSaving} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                    <option value="">All statuses</option>
                    {statusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
                  </select>
                </FormField>
                <FormField label="Priority">
                  <select disabled={isSaving} value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}>
                    <option value="">All priorities</option>
                    {priorityOptions.map((priority) => <option key={priority} value={priority}>P{priority}</option>)}
                  </select>
                </FormField>
                <button
                  className="ghost-button test-case-create-module-clear-filters"
                  disabled={!statusFilter && !priorityFilter}
                  onClick={() => {
                    setStatusFilter("");
                    setPriorityFilter("");
                  }}
                  type="button"
                >
                  Clear filters
                </button>
              </div>
            ) : null}
          </div>
          <div className="test-case-create-module-selection-actions" aria-label="Requirement selection actions">
            <button
              aria-label="Select visible Requirements"
              className="ghost-button"
              disabled={isDisabled || !visibleIds.length || areAllVisibleSelected}
              onClick={() => setVisibleSelection(true)}
              title="Select visible Requirements"
              type="button"
            >
              <SelectionToggleIcon checked />
              Select all visible
            </button>
            <span aria-hidden="true" className="test-case-create-module-action-divider" />
            <button
              aria-label="Clear selected Requirements"
              className="ghost-button"
              disabled={isDisabled || !selectedIds.length}
              onClick={() => onSelectionChange([])}
              title="Clear selected Requirements"
              type="button"
            >
              <SelectionToggleIcon checked={false} />
              Clear
            </button>
          </div>
        </div>

        <div
          aria-busy={isLoadingRequirements || isLoadingMoreRequirements}
          aria-label="Requirements available for this module"
          className="test-case-create-module-options test-case-create-module-requirement-options"
          role="table"
        >
          <div className="test-case-create-module-table-head test-case-create-module-requirement-table-head" role="row">
            <span className="test-case-create-module-table-select" role="columnheader">
              <input
                aria-label="Select all visible Requirements"
                checked={areAllVisibleSelected}
                disabled={isDisabled || !visibleIds.length}
                onChange={(event) => setVisibleSelection(event.target.checked)}
                ref={selectAllVisibleRef}
                type="checkbox"
              />
            </span>
            <span role="columnheader">Requirement</span>
            <span role="columnheader">Priority</span>
            <span role="columnheader">Status</span>
          </div>
          {visibleOptions.map((requirement) => {
            const isChecked = selectedIds.includes(requirement.id);
            const requirementLabel = requirement.display_id || "Story";
            return (
              <div
                className={isChecked
                  ? "test-case-create-module-option test-case-create-module-requirement-option is-selected"
                  : "test-case-create-module-option test-case-create-module-requirement-option"}
                key={requirement.id}
                onClick={() => {
                  if (isDisabled) return;
                  onSelectionChange(isChecked
                    ? selectedIds.filter((requirementId) => requirementId !== requirement.id)
                    : [...new Set([...selectedIds, requirement.id])]);
                }}
                role="row"
              >
                <span className="test-case-create-module-option-select" role="cell">
                  <input
                    aria-label={`${isChecked ? "Remove" : "Add"} ${requirementLabel} ${isChecked ? "from" : "to"} the new module`}
                    checked={isChecked}
                    disabled={isDisabled}
                    onChange={(event) => onSelectionChange(event.target.checked
                      ? [...new Set([...selectedIds, requirement.id])]
                      : selectedIds.filter((requirementId) => requirementId !== requirement.id))}
                    onClick={(event) => event.stopPropagation()}
                    type="checkbox"
                  />
                </span>
                <span className="test-case-create-module-requirement-identity" role="cell">
                  <span className="test-case-create-module-option-id">
                    <StoryIcon size={15} />
                    <strong>{requirementLabel}</strong>
                  </span>
                  <span className="test-case-create-module-option-title" title={requirement.title}>{requirement.title}</span>
                </span>
                <span className="test-case-create-module-requirement-priority" role="cell">
                  {requirement.priority === null || requirement.priority === undefined ? "—" : `P${requirement.priority}`}
                </span>
                <span className="test-case-create-module-option-status" role="cell">
                  <StatusBadge value={requirement.status || "Unassigned"} />
                </span>
              </div>
            );
          })}
          {isLoadingRequirements && !visibleOptions.length ? <LoadingState label="Loading Requirements" /> : null}
          {!isLoadingRequirements && !visibleOptions.length ? (
            <div className="empty-state compact">
              {!canSelectRequirements
                ? "Requirement access is not available."
                : search.trim() || statusFilter || priorityFilter
                  ? hasMoreRequirements
                    ? "Searching additional Requirements…"
                    : "No Requirements match these filters."
                  : "No Requirements are available in this project."}
            </div>
          ) : null}
          {hasMoreRequirements ? (
            <div className="test-case-create-module-load-more" role="row">
              <span role="cell">
                <HierarchyAutoLoadSentinel
                  isLoading={isDisabled || isLoadingMoreRequirements}
                  onLoad={onLoadMoreRequirements}
                  progressKey={candidateRequirements.length}
                  scopeLabel="Requirements"
                />
              </span>
            </div>
          ) : null}
        </div>
      </div>
      {selectedIds.length > MAX_CREATE_MODULE_REQUIREMENTS ? (
        <p className="test-case-create-module-requirement-limit" role="alert">
          Select no more than {MAX_CREATE_MODULE_REQUIREMENTS} Requirements.
        </p>
      ) : null}
    </section>
  );
}

export function TestCaseCreateModuleModal({
  projectId,
  appTypeId,
  assignmentRetryName,
  canAssignCases,
  canSelectRequirements,
  candidateRequirements,
  candidateTestCases,
  hasMoreRequirements,
  isLoadingMoreRequirements,
  isLoadingRequirements,
  isSaving,
  moduleNameByCaseId,
  initialSelectedIds,
  onClose,
  onLoadMoreRequirements,
  onResolveRequirementCases,
  onSubmit
}: {
  projectId: string;
  appTypeId: string;
  assignmentRetryName?: string;
  canAssignCases: boolean;
  canSelectRequirements: boolean;
  candidateRequirements: Requirement[];
  candidateTestCases: TestCase[];
  hasMoreRequirements: boolean;
  isLoadingMoreRequirements: boolean;
  isLoadingRequirements: boolean;
  isSaving: boolean;
  moduleNameByCaseId: ReadonlyMap<string, string>;
  initialSelectedIds: string[];
  onClose: () => void;
  onLoadMoreRequirements: () => void | Promise<unknown>;
  onResolveRequirementCases: (requirementIds: string[]) => Promise<TestCase[]>;
  onSubmit: (draft: CreateModuleDraft) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedRequirementIds, setSelectedRequirementIds] = useState<string[]>([]);
  const selectedRequirementIdsRef = useRef<string[]>([]);
  const [manualSelectedCaseIds, setManualSelectedCaseIds] = useState<string[]>(() => (
    canAssignCases ? [...new Set(initialSelectedIds)] : []
  ));
  const [selectedCaseOrder, setSelectedCaseOrder] = useState<string[]>(() => (
    canAssignCases ? [...new Set(initialSelectedIds)] : []
  ));
  const [excludedAutoCaseIds, setExcludedAutoCaseIds] = useState<string[]>([]);
  const [linkedCasesByRequirement, setLinkedCasesByRequirement] = useState<Record<string, TestCase[]>>({});
  const [resolvingRequirementIds, setResolvingRequirementIds] = useState<string[]>([]);
  const [failedRequirementIds, setFailedRequirementIds] = useState<string[]>([]);
  const candidateCasesWithLinkedCases = useMemo(() => {
    const byId = new Map(candidateTestCases.map((testCase) => [testCase.id, testCase]));
    Object.values(linkedCasesByRequirement)
      .flat()
      .forEach((testCase) => byId.set(testCase.id, testCase));
    return [...byId.values()];
  }, [candidateTestCases, linkedCasesByRequirement]);
  const activeAutoLinkedCaseIds = useMemo(() => [...new Set(
    selectedRequirementIds.flatMap((requirementId) => (
      linkedCasesByRequirement[requirementId] || []
    ).map((testCase) => testCase.id))
  )], [linkedCasesByRequirement, selectedRequirementIds]);
  const excludedAutoCaseIdSet = useMemo(() => new Set(excludedAutoCaseIds), [excludedAutoCaseIds]);
  const selectedCaseMembership = useMemo(() => [...new Set([
    ...manualSelectedCaseIds,
    ...activeAutoLinkedCaseIds.filter((testCaseId) => !excludedAutoCaseIdSet.has(testCaseId))
  ])], [activeAutoLinkedCaseIds, excludedAutoCaseIdSet, manualSelectedCaseIds]);
  const selectedIds = useMemo(() => {
    const membership = new Set(selectedCaseMembership);
    return [...new Set([...selectedCaseOrder, ...selectedCaseMembership])].filter(id => membership.has(id));
  }, [selectedCaseMembership, selectedCaseOrder]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const activeResolvingRequirementIds = resolvingRequirementIds.filter((requirementId) => selectedRequirementIds.includes(requirementId));
  const activeFailedRequirementIds = failedRequirementIds.filter((requirementId) => selectedRequirementIds.includes(requirementId));
  const isResolvingRequirementCases = canAssignCases && activeResolvingRequirementIds.length > 0;
  const hasRequirementCaseResolutionError = canAssignCases && activeFailedRequirementIds.length > 0;
  const selectedAutoLinkedCaseCount = activeAutoLinkedCaseIds.filter((testCaseId) => selectedIdSet.has(testCaseId)).length;
  const closeModal = () => {
    if (!isSaving) onClose();
  };
  const dialogRef = useDialogFocus<HTMLFormElement>({
    active: true,
    closeDisabled: isSaving,
    onClose: closeModal
  });
  const selectedAssignedCaseCount = selectedIds.filter((testCaseId) => moduleNameByCaseId.has(testCaseId)).length;
  const isRequirementSelectionOverLimit = selectedRequirementIds.length > MAX_CREATE_MODULE_REQUIREMENTS;
  const resolveLinkedRequirementCases = async (requirementIds: string[]) => {
    const ids = [...new Set(requirementIds.filter(Boolean))];
    if (!canAssignCases || !ids.length) return;

    setResolvingRequirementIds((current) => [...new Set([...current, ...ids])]);
    setFailedRequirementIds((current) => current.filter((requirementId) => !ids.includes(requirementId)));

    try {
      const batches: string[][] = [];
      for (let offset = 0; offset < ids.length; offset += MAX_CREATE_MODULE_REQUIREMENTS) {
        batches.push(ids.slice(offset, offset + MAX_CREATE_MODULE_REQUIREMENTS));
      }
      const responses = await Promise.all(batches.map((batch) => onResolveRequirementCases(batch)));
      const linkedCases = [...new Map(
        responses.flat().map((testCase) => [testCase.id, testCase])
      ).values()];

      setLinkedCasesByRequirement((current) => {
        const next = { ...current };
        ids.forEach((requirementId) => {
          next[requirementId] = linkedCases.filter((testCase) => (
            testCase.requirement_ids || (testCase.requirement_id ? [testCase.requirement_id] : [])
          ).includes(requirementId));
        });
        return next;
      });
    } catch {
      const activeIds = ids.filter((requirementId) => selectedRequirementIdsRef.current.includes(requirementId));
      if (activeIds.length) {
        setFailedRequirementIds((current) => [...new Set([...current, ...activeIds])]);
      }
    } finally {
      setResolvingRequirementIds((current) => current.filter((requirementId) => !ids.includes(requirementId)));
    }
  };

  const handleRequirementSelectionChange = (nextRequirementIds: string[]) => {
    const nextIds = [...new Set(nextRequirementIds.filter(Boolean))];
    const currentIds = selectedRequirementIdsRef.current;
    const newlySelectedRequirementIds = nextIds.filter((requirementId) => !currentIds.includes(requirementId));
    selectedRequirementIdsRef.current = nextIds;
    setSelectedRequirementIds(nextIds);

    const unresolvedRequirementIds = newlySelectedRequirementIds.filter((requirementId) => (
      !Object.prototype.hasOwnProperty.call(linkedCasesByRequirement, requirementId)
    ));
    if (unresolvedRequirementIds.length) {
      void resolveLinkedRequirementCases(unresolvedRequirementIds);
    }
  };

  const updateCaseSelection = (nextIds: string[]) => {
    const nextIdSet = new Set(nextIds);
    // Keep the explicit order independent of automatic Requirement membership.
    // Moving an automatic case must not turn it into a permanent manual choice.
    setSelectedCaseOrder([...nextIdSet]);
    // Existing automatic selections stay tied to their Requirements. Only an
    // explicit addition becomes manual; exclusions survive search and paging.
    setManualSelectedCaseIds((current) => [...new Set([
      ...current.filter((id) => nextIdSet.has(id)),
      ...nextIds.filter((id) => !selectedIdSet.has(id))
    ])]);
    setExcludedAutoCaseIds((current) => [...new Set([
      ...current.filter((id) => !nextIdSet.has(id)),
      ...activeAutoLinkedCaseIds.filter((id) => !nextIdSet.has(id))
    ])]);
  };

  return (
    <div
      className="modal-backdrop modal-backdrop--scroll test-case-create-module-backdrop"
      onClick={closeModal}
      role="presentation"
    >
      <form
        aria-describedby="create-test-case-module-description"
        aria-labelledby="create-test-case-module-title"
        aria-modal="true"
        className="modal-card requirement-create-modal test-case-create-module-modal"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (
            !name.trim()
            || isSaving
            || isRequirementSelectionOverLimit
            || isResolvingRequirementCases
            || hasRequirementCaseResolutionError
          ) return;
          onSubmit({
            description,
            name: name.trim(),
            requirementIds: canSelectRequirements ? selectedRequirementIds : [],
            testCaseIds: canAssignCases ? selectedIds : []
          });
        }}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="test-case-create-module-header">
          <div className="test-case-create-module-title">
            <div>
              <div className="test-case-create-module-title-row">
                <span className="test-case-create-module-title-icon"><ModuleIcon size={20} /></span>
                <h2 className="dialog-title" id="create-test-case-module-title">Create module</h2>
              </div>
              <p id="create-test-case-module-description">
                {assignmentRetryName
                  ? `Finish assigning Test Cases to ${assignmentRetryName}.`
                  : "Define the module and optionally move Test Cases into it."}
              </p>
            </div>
          </div>
          <DialogCloseButton
            disabled={isSaving}
            label="Close create module"
            onClick={closeModal}
          />
        </div>

        <div className="test-case-create-module-body">
          <section className="test-case-create-module-details" aria-labelledby="module-details-heading">
            <div className="test-case-create-module-section-heading">
              <div>
                <h3 id="module-details-heading">Module Details</h3>
                <p>Define the core identity of your new testing module.</p>
              </div>
            </div>
            {assignmentRetryName ? (
              <div className="test-case-create-module-retry-note" role="status">
                <IconInfoCircle aria-hidden="true" size={16} stroke={1.8} />
                <span>
                  The module was created successfully. Its selected Test Cases still need to be assigned.
                </span>
              </div>
            ) : null}
            <div className="test-case-create-module-fields">
              <FormField className="test-case-create-module-name" label="Module name" required>
                <input
                  autoFocus
                  data-autofocus="true"
                  disabled={isSaving || Boolean(assignmentRetryName)}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g., Authentication Services"
                  required
                  value={name}
                />
              </FormField>
              <FormField className="test-case-create-module-description" label="Description">
                <RichTextEditor
                  appearance="canonical"
                  aria-label="Module description"
                  disabled={isSaving || Boolean(assignmentRetryName)}
                  onChange={setDescription}
                  placeholder="Describe the purpose and scope of this module..."
                  rows={12}
                  value={description}
                />
              </FormField>
            </div>
          </section>

          <section
            className="test-case-create-module-picker"
            aria-labelledby="module-test-cases-heading"
          >
            <ModuleRequirementPicker
              candidateRequirements={candidateRequirements}
              canSelectRequirements={canSelectRequirements}
              hasMoreRequirements={hasMoreRequirements}
              isLoadingMoreRequirements={isLoadingMoreRequirements}
              isLoadingRequirements={isLoadingRequirements}
              isLocked={Boolean(assignmentRetryName)}
              isSaving={isSaving}
              onLoadMoreRequirements={onLoadMoreRequirements}
              onSelectionChange={handleRequirementSelectionChange}
              selectedIds={selectedRequirementIds}
            />
            <div className={canAssignCases ? "sr-only" : "test-case-create-module-section-heading test-case-create-module-picker-heading"}>
              <div>
                <h3 id="module-test-cases-heading">Test Case Selection</h3>
                {!canAssignCases ? <p>Assigning Test Cases requires update permission.</p> : null}
              </div>
            </div>

            {canAssignCases && selectedRequirementIds.length ? (
              <div
                aria-atomic="true"
                aria-live={hasRequirementCaseResolutionError ? "assertive" : "polite"}
                className={hasRequirementCaseResolutionError
                  ? "test-case-create-module-auto-link-status is-error"
                  : isResolvingRequirementCases
                    ? "test-case-create-module-auto-link-status is-loading"
                    : "test-case-create-module-auto-link-status is-ready"}
                role={hasRequirementCaseResolutionError ? "alert" : "status"}
              >
                <IconInfoCircle aria-hidden="true" size={15} stroke={1.8} />
                <span>
                  {hasRequirementCaseResolutionError
                    ? `Linked Test Cases could not be loaded for ${activeFailedRequirementIds.length} Requirement${activeFailedRequirementIds.length === 1 ? "" : "s"}.`
                    : isResolvingRequirementCases
                      ? `Finding all linked Test Cases for ${activeResolvingRequirementIds.length} Requirement${activeResolvingRequirementIds.length === 1 ? "" : "s"}…`
                      : activeAutoLinkedCaseIds.length
                        ? `${selectedAutoLinkedCaseCount} of ${activeAutoLinkedCaseIds.length} linked Test Case${activeAutoLinkedCaseIds.length === 1 ? "" : "s"} selected.`
                        : "No linked Test Cases were found for the selected Requirements."}
                </span>
                {hasRequirementCaseResolutionError ? (
                  <button
                    className="ghost-button"
                    disabled={isResolvingRequirementCases || isSaving}
                    onClick={() => void resolveLinkedRequirementCases(activeFailedRequirementIds)}
                    type="button"
                  >
                    Retry
                  </button>
                ) : null}
              </div>
            ) : null}

            {canAssignCases ? (
              <TestCasePicker
                projectId={projectId}
                appTypeId={appTypeId}
                selectedIds={selectedIds}
                initialItems={candidateCasesWithLinkedCases}
                onChange={updateCaseSelection}
                disabled={isSaving || isResolvingRequirementCases}
                heading="Test Case Selection"
                presentation="inline"
                allowReorder
                emptyMessage="No Test Cases match this search."
              />
            ) : null}
          </section>
        </div>

        <div className="action-row requirement-create-modal-actions test-case-create-module-footer">
          <p
            className={isRequirementSelectionOverLimit || hasRequirementCaseResolutionError ? "is-error" : ""}
            role={isRequirementSelectionOverLimit || hasRequirementCaseResolutionError ? "alert" : undefined}
          >
            <IconInfoCircle aria-hidden="true" size={15} stroke={1.8} />
            <span>
              {assignmentRetryName
                ? `Retry the assignment without creating a duplicate of ${assignmentRetryName}.`
                : isResolvingRequirementCases
                  ? "Selecting every Test Case linked to the chosen Requirements…"
                : hasRequirementCaseResolutionError
                  ? "Retry linked Test Case selection or remove the affected Requirement before creating the module."
                : isRequirementSelectionOverLimit
                  ? `Select no more than ${MAX_CREATE_MODULE_REQUIREMENTS} Requirements before creating this module.`
                : selectedAssignedCaseCount
                  ? `${selectedAssignedCaseCount} selected Test Case${selectedAssignedCaseCount === 1 ? "" : "s"} will move from the current module into the new module.`
                  : selectedIds.length
                    ? "Selected Test Cases will be moved into the new module."
                    : "Create an empty module now and assign Test Cases later."}
            </span>
          </p>
          <button className="ghost-button" disabled={isSaving} onClick={closeModal} type="button">Cancel</button>
          <button
            className="primary-button"
            disabled={isSaving
              || !name.trim()
              || isRequirementSelectionOverLimit
              || isResolvingRequirementCases
              || hasRequirementCaseResolutionError}
            type="submit"
          >
            {isResolvingRequirementCases ? "Selecting linked cases…" : isSaving ? (assignmentRetryName ? "Assigning Test Cases…" : "Creating module…") : (
              <>
                <AddIcon size={16} />
                <span>{assignmentRetryName ? "Retry assignment" : "Create module"}</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
