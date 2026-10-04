import { ErrorCode, type AnswerResponse, type PatchCvResponse, type PatchOp } from '@cv/shared';
import { ApiRequestError, apiFetch } from '../api-fetch';
import { SaveError } from '../autosave';

/** Autosave's `save`: a 409 becomes a `SaveError` carrying the current state (AC-10.4). */
export async function patchCv(
  cvId: string,
  baseVersion: number,
  ops: PatchOp[],
): Promise<PatchCvResponse> {
  try {
    return await apiFetch<PatchCvResponse>(`/api/cvs/${cvId}`, {
      method: 'PATCH',
      json: { baseVersion, ops },
    });
  } catch (error) {
    if (error instanceof ApiRequestError && error.code === ErrorCode.VERSION_CONFLICT) {
      throw new SaveError(error.current ?? null);
    }
    throw new SaveError();
  }
}

export function answerQuestion(
  cvId: string,
  questionId: string,
  answer: string,
): Promise<AnswerResponse> {
  return apiFetch<AnswerResponse>(`/api/cvs/${cvId}/questions/${questionId}/answer`, {
    method: 'POST',
    json: { answer },
  });
}

export function dismissQuestion(cvId: string, questionId: string): Promise<void> {
  return apiFetch<void>(`/api/cvs/${cvId}/questions/${questionId}/dismiss`, { method: 'POST' });
}
