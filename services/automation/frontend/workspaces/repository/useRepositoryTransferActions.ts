import {useMutation,type QueryClient} from '@tanstack/react-query';
import {api} from '@hellotest/platform/frontend/src/lib/api';
import type {RepositoryWorkspaceState} from './useRepositoryWorkspaceState';
import type {RepositoryWorkspaceQueries} from './useRepositoryWorkspaceQueries';
type TransferPorts=Pick<RepositoryWorkspaceState,'repositoryImportPreview'|'setRepositoryImportPreview'|'setIsRepositoryImportModalOpen'>&Pick<RepositoryWorkspaceQueries,'appTypes'>&{appTypeId:string;queryClient:QueryClient;showSuccess:(message:string)=>void;showError:(error:unknown,fallback:string)=>void};
export function useRepositoryTransferActions({appTypeId,appTypes,queryClient,repositoryImportPreview,setRepositoryImportPreview,setIsRepositoryImportModalOpen,showSuccess,showError}:TransferPorts){
const exportRepositoryCsv = useMutation({
    mutationFn: () => {
        if (!appTypeId) {
            throw new Error("Select an application scope before exporting the repository.");
        }
        return api.testCases.exportLearningCacheCsv({ app_type_id: appTypeId });
    },
    onSuccess: (blob) => {
        const selectedApp = appTypes.find((item) => item.id === appTypeId)?.name || "object-repository";
        const fileName = `${selectedApp.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "object-repository"}-or.csv`;
        const downloadUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = downloadUrl;
        link.download = fileName;
        link.click();
        URL.revokeObjectURL(downloadUrl);
        showSuccess("Exported all object repository screens and fields as CSV. A TestOps batch process was recorded.");
    },
    onError: (error) => showError(error, "Unable to export object repository CSV.")
});
const importRepositoryEntries = useMutation({
    mutationFn: () => {
        if (!appTypeId) {
            throw new Error("Select an application scope before importing repository objects.");
        }
        if (!repositoryImportPreview?.entries.length) {
            throw new Error("Choose CSV, source, or ZIP files before importing.");
        }
        return api.testCases.importLearningCacheEntries({
            app_type_id: appTypeId,
            import_source: "or_file_import",
            entries: repositoryImportPreview.entries
        });
    },
    onSuccess: (response) => {
        void queryClient.invalidateQueries({ queryKey: ["automation-learning-cache"] });
        void queryClient.invalidateQueries({ queryKey: ["automation-repository-context"] });
        if (response.failed) {
            setRepositoryImportPreview((current) => current ? {
                ...current,
                warnings: [
                    ...current.warnings,
                    ...response.errors.slice(0, 8).map((error) => `${error.screen_name || "Entry"}: ${error.message}`)
                ]
            } : current);
            showError(new Error(`Imported ${response.created + response.updated} entries, but ${response.failed} could not be saved. Review the import warnings.`), "Some repository entries failed to import.");
            return;
        }
        setRepositoryImportPreview(null);
        setIsRepositoryImportModalOpen(false);
        showSuccess(`Object repository import completed in TestOps${response.transaction_id ? ` (${response.transaction_id.slice(0, 8)})` : ""}: ${response.created} new, ${response.updated} updated.`);
    },
    onError: (error) => showError(error, "Unable to import object repository entries.")
});

return {exportRepositoryCsv,importRepositoryEntries};
}
