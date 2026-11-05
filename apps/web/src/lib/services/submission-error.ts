import { m } from "#lib/paraglide/messages.js";
import type { SubmissionRequestError } from "./submission-service";

export function messageForSubmitError(error: SubmissionRequestError): string {
  switch (error.code) {
    case "client_test_custom_image":
      return m.editor_clientTestCustomImage();
    case "client_test_language":
      return m.editor_clientTestLanguage();
    case "browser_toolchain_unavailable":
      return m.editor_toolchainUnavailable();
    case "invalid_source":
      return m.editor_invalidSource();
    case "invalid_run_cases":
      return m.editor_invalidRunCases();
    case "request_too_large":
      return m.editor_requestTooLarge();
    case "SUBMISSION_TIMEOUT":
      return m.editor_requestTimedOut();
    case "daily_limit":
      return m.submit_error_dailyLimit();
    case "window_not_open":
    case "exam_not_started":
      return m.submit_error_windowNotOpen();
    case "window_closed":
      return m.submit_error_windowClosed();
    case "exam_ip_blocked":
    case "ip_blocked":
      return m.submit_error_ipBlocked();
    case "language_not_allowed":
      return m.submit_error_languageNotAllowed();
    case "submit_cooldown":
      return error.retryAfterSec
        ? m.submit_error_cooldown({ seconds: error.retryAfterSec })
        : error.message;
    case "session_required":
      return m.submit_error_sessionRequired();
    default:
      return error.message || m.editor_submitFailed();
  }
}
