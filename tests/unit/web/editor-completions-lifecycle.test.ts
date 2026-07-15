import { describe, expect, it, vi } from "vitest";

import { acquireCompletionProviders } from "$lib/components/features/problem/editor-completions";

describe("editor completion provider lifecycle", () => {
  it("shares one provider set and disposes it after the final lease", () => {
    const disposers = Array.from({ length: 8 }, () => vi.fn());
    let registration = 0;
    const registerCompletionItemProvider = vi
      .fn()
      .mockImplementation((_language: string, _provider: unknown) => ({
        dispose: disposers[registration++ % disposers.length],
      }));
    const monaco = {
      languages: { registerCompletionItemProvider },
    } as never;

    const releaseFirst = acquireCompletionProviders(monaco);
    const releaseSecond = acquireCompletionProviders(monaco);
    expect(registerCompletionItemProvider).toHaveBeenCalledTimes(8);

    releaseFirst();
    releaseFirst();
    expect(disposers.every((dispose) => dispose.mock.calls.length === 0)).toBe(true);

    releaseSecond();
    expect(disposers.every((dispose) => dispose.mock.calls.length === 1)).toBe(true);

    const releaseThird = acquireCompletionProviders(monaco);
    expect(registerCompletionItemProvider).toHaveBeenCalledTimes(16);
    releaseThird();
  });

  it("disposes partial registration and can retry after a provider throws", () => {
    const firstDispose = vi.fn();
    const registerCompletionItemProvider = vi
      .fn()
      .mockReturnValueOnce({ dispose: firstDispose })
      .mockImplementationOnce(() => {
        throw new Error("registration failed");
      });
    const monaco = { languages: { registerCompletionItemProvider } } as never;

    expect(() => acquireCompletionProviders(monaco)).toThrow("registration failed");
    expect(firstDispose).toHaveBeenCalledOnce();

    const retryDisposers = Array.from({ length: 8 }, () => vi.fn());
    let retryRegistration = 0;
    registerCompletionItemProvider.mockImplementation(() => ({
      dispose: retryDisposers[retryRegistration++],
    }));
    const release = acquireCompletionProviders(monaco);
    release();

    expect(retryDisposers.every((dispose) => dispose.mock.calls.length === 1)).toBe(true);
  });
});
