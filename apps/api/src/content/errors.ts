export type ContentDomainErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "INVALID_CONTENT_INPUT"
  | "INVALID_CONTENT_FILTER"
  | "CONTENT_NOT_FOUND"
  | "INVALID_CONTENT_STATE"
  | "NOT_AN_EVENT"
  | "EVENT_ENDED"
  | "EVENT_FULL"
  | "ALREADY_REGISTERED";

export class ContentDomainError extends Error {
  readonly code: ContentDomainErrorCode;
  readonly statusCode: number;

  constructor(code: ContentDomainErrorCode, statusCode: number, message: string) {
    super(message);
    this.name = "ContentDomainError";
    this.code = code;
    this.statusCode = statusCode;
  }
}
export function contentError(
  code: ContentDomainErrorCode,
  statusCode: number,
  message: string,
): never {
  throw new ContentDomainError(code, statusCode, message);
}
