import type { TestCase } from "../types";

type ReviewCase = Pick<TestCase, "review_status" | "reviewer_id" | "created_by" | "ai_generation_source" | "ai_generation_review_status">;

export function isPendingCaseReview(testCase: ReviewCase | null | undefined): boolean {
  if (!testCase) return false;
  if (testCase.review_status === "accepted" || testCase.review_status === "changes_requested") return false;
  return testCase.review_status === "pending"
    || Boolean(testCase.ai_generation_source && testCase.ai_generation_review_status === "pending");
}

export function ownsCaseReview(testCase: ReviewCase | null | undefined, userId: string): boolean {
  if (!testCase || !userId) return false;
  if (testCase.reviewer_id) return testCase.reviewer_id === userId;
  return Boolean(testCase.ai_generation_source && testCase.ai_generation_review_status === "pending" && testCase.created_by === userId);
}
