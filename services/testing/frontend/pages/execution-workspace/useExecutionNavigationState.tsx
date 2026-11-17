import { useRef, useState } from "react";

export function useExecutionNavigationState() {
const [selectedExecutionId, setSelectedExecutionId] = useState("");

const dismissedExecutionRouteRef = useRef("");

const dismissedScheduleRouteRef = useRef("");

const dismissedCaseRouteRef = useRef("");

const [selectedScheduleId, setSelectedScheduleId] = useState("");

const [selectedOperationId, setSelectedOperationId] = useState("");

const [focusedSuiteId, setFocusedSuiteId] = useState("");

const [focusedExecutionModuleId, setFocusedExecutionModuleId] = useState("");

const [inspectedExecutionCaseId, setInspectedExecutionCaseId] = useState("");

const [expandedExecutionSuiteIds, setExpandedExecutionSuiteIds] = useState<string[]>([]);

const [expandedExecutionModuleKeys, setExpandedExecutionModuleKeys] = useState<string[]>([]);

const [selectedTestCaseId, setSelectedTestCaseId] = useState("");

const [selectedCaseInstanceKey, setSelectedCaseInstanceKey] = useState("");
  return { selectedExecutionId, setSelectedExecutionId, dismissedExecutionRouteRef, dismissedScheduleRouteRef, dismissedCaseRouteRef, selectedScheduleId, setSelectedScheduleId, selectedOperationId, setSelectedOperationId, focusedSuiteId, setFocusedSuiteId, focusedExecutionModuleId, setFocusedExecutionModuleId, inspectedExecutionCaseId, setInspectedExecutionCaseId, expandedExecutionSuiteIds, setExpandedExecutionSuiteIds, expandedExecutionModuleKeys, setExpandedExecutionModuleKeys, selectedTestCaseId, setSelectedTestCaseId, selectedCaseInstanceKey, setSelectedCaseInstanceKey };
}
