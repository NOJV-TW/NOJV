import { beforeEach, describe, expect, it, vi } from "vitest";

const { clientConstructorMock, connectMock, optionsMock } = vi.hoisted(() => ({
  clientConstructorMock: vi.fn(function ClientMock() {
    return {};
  }),
  connectMock: vi.fn(),
  optionsMock: vi.fn(),
}));

vi.mock("@temporalio/client", () => ({
  Client: clientConstructorMock,
  Connection: { connect: connectMock },
}));

vi.mock("../../../packages/temporal/src/connection-config", () => ({
  temporalConnectionOptions: optionsMock,
}));

interface TestConnection {
  close: ReturnType<typeof vi.fn>;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function connection(close = vi.fn().mockResolvedValue(undefined)): TestConnection {
  return { close };
}

async function importClient() {
  return import("../../../packages/temporal/src/client");
}

beforeEach(() => {
  vi.resetModules();
  clientConstructorMock.mockReset();
  connectMock.mockReset();
  optionsMock.mockReset();
  optionsMock.mockReturnValue({
    address: "temporal.example:7233",
    namespace: "nojv",
    tls: true,
    apiKey: "secret",
  });
});

describe("Temporal client lifecycle", () => {
  it("shares one connection and client across concurrent callers", async () => {
    const pendingConnection = deferred<TestConnection>();
    const temporalConnection = connection();
    connectMock.mockReturnValueOnce(pendingConnection.promise);
    const { getTemporalClient } = await importClient();

    const first = getTemporalClient();
    const second = getTemporalClient();

    expect(first).toBe(second);
    expect(connectMock).toHaveBeenCalledTimes(1);
    pendingConnection.resolve(temporalConnection);

    const [firstClient, secondClient] = await Promise.all([first, second]);
    expect(firstClient).toBe(secondClient);
    expect(clientConstructorMock).toHaveBeenCalledTimes(1);
    expect(clientConstructorMock).toHaveBeenCalledWith({
      connection: temporalConnection,
      namespace: "nojv",
    });
    expect(connectMock).toHaveBeenCalledWith({
      address: "temporal.example:7233",
      tls: true,
      apiKey: "secret",
    });
  });

  it("returns to idle after a connection failure so a later call can retry", async () => {
    const connectError = new Error("temporal unavailable");
    const temporalConnection = connection();
    connectMock.mockRejectedValueOnce(connectError).mockResolvedValueOnce(temporalConnection);
    const { getTemporalClient } = await importClient();

    await expect(getTemporalClient()).rejects.toBe(connectError);
    await expect(getTemporalClient()).resolves.toBeDefined();

    expect(connectMock).toHaveBeenCalledTimes(2);
    expect(clientConstructorMock).toHaveBeenCalledTimes(1);
  });

  it("makes close from idle terminal without opening a connection", async () => {
    const { closeTemporalClient, getTemporalClient } = await importClient();

    const firstClose = closeTemporalClient();
    const secondClose = closeTemporalClient();

    expect(secondClose).toBe(firstClose);
    await expect(firstClose).resolves.toBeUndefined();
    await expect(getTemporalClient()).rejects.toThrow("closing or closed");
    expect(connectMock).not.toHaveBeenCalled();
  });

  it("closes an eventual connection exactly once when close wins during connect", async () => {
    const pendingConnection = deferred<TestConnection>();
    const temporalConnection = connection();
    connectMock.mockReturnValueOnce(pendingConnection.promise);
    const { closeTemporalClient, getTemporalClient } = await importClient();

    const pendingClient = getTemporalClient();
    const clientResult = pendingClient.catch((error: unknown) => error);
    const closePromise = closeTemporalClient();

    await expect(getTemporalClient()).rejects.toThrow("closing or closed");
    pendingConnection.resolve(temporalConnection);

    await expect(closePromise).resolves.toBeUndefined();
    expect(await clientResult).toEqual(
      expect.objectContaining({ message: "Temporal client is closing or closed" }),
    );
    expect(temporalConnection.close).toHaveBeenCalledTimes(1);
    expect(clientConstructorMock).not.toHaveBeenCalled();
  });

  it("finishes terminal close when an in-flight connection attempt rejects", async () => {
    const pendingConnection = deferred<TestConnection>();
    const connectError = new Error("connect failed");
    connectMock.mockReturnValueOnce(pendingConnection.promise);
    const { closeTemporalClient, getTemporalClient } = await importClient();

    const pendingClient = getTemporalClient();
    const clientResult = pendingClient.catch((error: unknown) => error);
    const closePromise = closeTemporalClient();
    pendingConnection.reject(connectError);

    expect(await clientResult).toBe(connectError);
    await expect(closePromise).resolves.toBeUndefined();
    await expect(getTemporalClient()).rejects.toThrow("closing or closed");
    expect(clientConstructorMock).not.toHaveBeenCalled();
  });

  it("keeps a failed close terminal when close wins during connect", async () => {
    const pendingConnection = deferred<TestConnection>();
    const pendingClose = deferred<undefined>();
    const closeError = new Error("eventual close failed");
    const temporalConnection = connection(vi.fn(() => pendingClose.promise));
    connectMock.mockReturnValueOnce(pendingConnection.promise);
    const { closeTemporalClient, getTemporalClient } = await importClient();

    const pendingClient = getTemporalClient();
    const clientResult = pendingClient.catch((error: unknown) => error);
    const firstClose = closeTemporalClient();
    const closeResult = firstClose.catch((error: unknown) => error);
    const secondClose = closeTemporalClient();
    pendingConnection.resolve(temporalConnection);
    await Promise.resolve();
    await Promise.resolve();
    expect(temporalConnection.close).toHaveBeenCalledTimes(1);
    pendingClose.reject(closeError);

    expect(await clientResult).toEqual(
      expect.objectContaining({ message: "Temporal client is closing or closed" }),
    );
    expect(await closeResult).toBe(closeError);
    expect(secondClose).toBe(firstClose);
    expect(closeTemporalClient()).toBe(firstClose);
    await expect(getTemporalClient()).rejects.toThrow("closing or closed");
    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(temporalConnection.close).toHaveBeenCalledTimes(1);
  });

  it("deduplicates close from ready and rejects gets while closing", async () => {
    const pendingClose = deferred<undefined>();
    const temporalConnection = connection(vi.fn(() => pendingClose.promise));
    connectMock.mockResolvedValueOnce(temporalConnection);
    const { closeTemporalClient, getTemporalClient } = await importClient();
    await getTemporalClient();

    const firstClose = closeTemporalClient();
    const secondClose = closeTemporalClient();

    expect(secondClose).toBe(firstClose);
    await expect(getTemporalClient()).rejects.toThrow("closing or closed");
    await Promise.resolve();
    expect(temporalConnection.close).toHaveBeenCalledTimes(1);
    pendingClose.resolve(undefined);
    await expect(firstClose).resolves.toBeUndefined();
  });

  it("keeps a failed close terminal and observable without reconnecting", async () => {
    const pendingClose = deferred<undefined>();
    const closeError = new Error("close failed");
    const temporalConnection = connection(vi.fn(() => pendingClose.promise));
    connectMock.mockResolvedValueOnce(temporalConnection);
    const { closeTemporalClient, getTemporalClient } = await importClient();
    await getTemporalClient();

    const firstClose = closeTemporalClient();
    const firstResult = firstClose.catch((error: unknown) => error);
    const secondClose = closeTemporalClient();
    await Promise.resolve();
    expect(temporalConnection.close).toHaveBeenCalledTimes(1);
    pendingClose.reject(closeError);

    expect(secondClose).toBe(firstClose);
    expect(await firstResult).toBe(closeError);
    expect(closeTemporalClient()).toBe(firstClose);
    await expect(getTemporalClient()).rejects.toThrow("closing or closed");
    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(temporalConnection.close).toHaveBeenCalledTimes(1);
  });

  it("never resurrects after a successful close", async () => {
    const temporalConnection = connection();
    connectMock.mockResolvedValueOnce(temporalConnection);
    const { closeTemporalClient, getTemporalClient } = await importClient();
    await getTemporalClient();

    const closePromise = closeTemporalClient();
    await closePromise;

    expect(closeTemporalClient()).toBe(closePromise);
    await expect(getTemporalClient()).rejects.toThrow("closing or closed");
    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(temporalConnection.close).toHaveBeenCalledTimes(1);
  });

  it("leaves the singleton idle when connection configuration throws", async () => {
    const configError = new Error("invalid TLS files");
    const temporalConnection = connection();
    optionsMock.mockImplementationOnce(() => {
      throw configError;
    });
    connectMock.mockResolvedValueOnce(temporalConnection);
    const { getTemporalClient } = await importClient();

    await expect(getTemporalClient()).rejects.toBe(configError);
    await expect(getTemporalClient()).resolves.toBeDefined();

    expect(optionsMock).toHaveBeenCalledTimes(2);
    expect(connectMock).toHaveBeenCalledTimes(1);
  });

  it("leaves the singleton idle when Connection.connect throws synchronously", async () => {
    const connectError = new Error("invalid connection options");
    const temporalConnection = connection();
    connectMock
      .mockImplementationOnce(() => {
        throw connectError;
      })
      .mockResolvedValueOnce(temporalConnection);
    const { getTemporalClient } = await importClient();

    await expect(getTemporalClient()).rejects.toBe(connectError);
    await expect(getTemporalClient()).resolves.toBeDefined();

    expect(connectMock).toHaveBeenCalledTimes(2);
    expect(clientConstructorMock).toHaveBeenCalledTimes(1);
  });

  it("closes an acquired connection and permits retry when Client construction throws", async () => {
    const constructorError = new Error("invalid client options");
    const firstConnection = connection();
    const secondConnection = connection();
    connectMock.mockResolvedValueOnce(firstConnection).mockResolvedValueOnce(secondConnection);
    clientConstructorMock.mockImplementationOnce(function ClientFailure() {
      throw constructorError;
    });
    const { getTemporalClient } = await importClient();

    await expect(getTemporalClient()).rejects.toBe(constructorError);
    await expect(getTemporalClient()).resolves.toBeDefined();

    expect(firstConnection.close).toHaveBeenCalledTimes(1);
    expect(secondConnection.close).not.toHaveBeenCalled();
    expect(connectMock).toHaveBeenCalledTimes(2);
    expect(clientConstructorMock).toHaveBeenCalledTimes(2);
  });

  it("becomes terminal when Client construction and connection cleanup both fail", async () => {
    const constructorError = new Error("invalid client options");
    const cleanupError = new Error("cleanup failed");
    const pendingClose = deferred<undefined>();
    const temporalConnection = connection(vi.fn(() => pendingClose.promise));
    connectMock.mockResolvedValueOnce(temporalConnection);
    clientConstructorMock.mockImplementationOnce(function ClientFailure() {
      throw constructorError;
    });
    const { closeTemporalClient, getTemporalClient } = await importClient();

    const pendingClient = getTemporalClient();
    const clientResult = pendingClient.catch((error: unknown) => error);
    await Promise.resolve();
    await Promise.resolve();
    expect(temporalConnection.close).toHaveBeenCalledTimes(1);
    pendingClose.reject(cleanupError);

    const result = await clientResult;
    expect(result).toBeInstanceOf(AggregateError);
    expect((result as AggregateError).errors).toEqual([constructorError, cleanupError]);
    await expect(getTemporalClient()).rejects.toThrow("closing or closed");
    await expect(closeTemporalClient()).rejects.toBe(cleanupError);
    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(temporalConnection.close).toHaveBeenCalledTimes(1);
  });
});
