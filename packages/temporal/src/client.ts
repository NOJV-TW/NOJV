import { Client, Connection } from "@temporalio/client";

import { temporalConnectionOptions } from "./connection-config";

interface ConnectingState {
  status: "connecting";
  connectionPromise: Promise<Connection>;
  clientPromise: Promise<Client>;
  cleanupPromise?: Promise<void>;
}

type ClientState =
  | { status: "idle" }
  | ConnectingState
  | { status: "ready"; connection: Connection; client: Client }
  | { status: "closing"; closePromise: Promise<void> }
  | { status: "closed"; closePromise: Promise<void> };

let state: ClientState = { status: "idle" };

function closedError(): Error {
  return new Error("Temporal client is closing or closed");
}

function asError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error("Non-Error thrown by Temporal client", { cause: error });
}

function connectTemporalClient(): Promise<Client> {
  let options: ReturnType<typeof temporalConnectionOptions>;
  try {
    options = temporalConnectionOptions();
  } catch (error) {
    return Promise.reject(asError(error));
  }

  const { address, namespace, tls, apiKey } = options;
  let connectionPromise: Promise<Connection>;
  try {
    connectionPromise = Connection.connect({
      address,
      ...(tls !== undefined ? { tls } : {}),
      ...(apiKey ? { apiKey } : {}),
    });
  } catch (error) {
    return Promise.reject(asError(error));
  }

  const clientPromise = connectionPromise.then(
    (connection): Client | Promise<Client> => {
      if (state !== connectingState) throw closedError();

      try {
        const client = new Client({ connection, namespace });
        state = { status: "ready", connection, client };
        return client;
      } catch (error) {
        const cleanupPromise = Promise.resolve().then(() => connection.close());
        connectingState.cleanupPromise = cleanupPromise;
        return cleanupPromise.then(
          () => {
            if (state === connectingState) state = { status: "idle" };
            throw asError(error);
          },
          (cleanupError: unknown) => {
            if (state === connectingState) {
              state = { status: "closed", closePromise: cleanupPromise };
            }
            throw new AggregateError(
              [error, cleanupError],
              "Failed to create Temporal client and close its connection",
            );
          },
        );
      }
    },
    (error: unknown) => {
      if (state === connectingState) state = { status: "idle" };
      throw asError(error);
    },
  );

  const connectingState: ConnectingState = {
    status: "connecting",
    connectionPromise,
    clientPromise,
  };
  state = connectingState;
  return clientPromise;
}

export function getTemporalClient(): Promise<Client> {
  switch (state.status) {
    case "idle":
      return connectTemporalClient();
    case "connecting":
      return state.clientPromise;
    case "ready":
      return Promise.resolve(state.client);
    case "closing":
    case "closed":
      return Promise.reject(closedError());
  }
}

function beginClose(workPromise: Promise<void>): Promise<void> {
  const closePromise = workPromise.then(
    () => {
      state = { status: "closed", closePromise };
    },
    (error: unknown) => {
      state = { status: "closed", closePromise };
      throw asError(error);
    },
  );
  state = { status: "closing", closePromise };
  return closePromise;
}

export function closeTemporalClient(): Promise<void> {
  switch (state.status) {
    case "idle": {
      const closePromise = Promise.resolve();
      state = { status: "closed", closePromise };
      return closePromise;
    }
    case "connecting": {
      const connectingState = state;
      const workPromise =
        connectingState.cleanupPromise ??
        connectingState.connectionPromise.then(
          (connection) => connection.close(),
          () => undefined,
        );
      return beginClose(workPromise);
    }
    case "ready": {
      const { connection } = state;
      return beginClose(Promise.resolve().then(() => connection.close()));
    }
    case "closing":
    case "closed":
      return state.closePromise;
  }
}
