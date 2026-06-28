import { Client, Connection } from "@temporalio/client";

import { temporalConnectionOptions } from "./connection-config";

let _clientPromise: Promise<Client> | undefined;
let _connection: Connection | undefined;

export async function getTemporalClient(): Promise<Client> {
  _clientPromise ??= (async () => {
    const { address, namespace, tls, apiKey } = temporalConnectionOptions();
    _connection = await Connection.connect({
      address,
      ...(tls !== undefined ? { tls } : {}),
      ...(apiKey ? { apiKey } : {}),
    });
    return new Client({ connection: _connection, namespace });
  })();
  return _clientPromise;
}

export async function closeTemporalClient(): Promise<void> {
  if (_connection) {
    await _connection.close();
    _connection = undefined;
    _clientPromise = undefined;
  }
}
