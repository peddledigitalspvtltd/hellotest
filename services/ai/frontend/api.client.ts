import type { AiRichTextRephraseResponse, QualityInsightPreviewResponse } from "@hellotest/platform/frontend/src/types";
import { request, toQueryString } from "@hellotest/platform/frontend/src/lib/httpClient";



export const aiApi = {
ai: {
    qualityInsights: (query: { project_id: string; release?: string }) =>
      request<QualityInsightPreviewResponse>(`/ai/quality-insights${toQueryString(query)}`),
    rephraseRichText: (input: {
      project_id: string;
      content: string;
      content_html?: string;
      entity_type?: string;
      entity_id?: string;
      entity_title?: string;
      field_label?: string;
      app_type_id?: string;
      requirement_id?: string;
      module_id?: string;
      aria_label?: string;
      additional_context?: string;
    }) => request<AiRichTextRephraseResponse>("/ai/rich-text-rephrase", {
      method: "POST",
      body: JSON.stringify(input)
    })
  }
};

