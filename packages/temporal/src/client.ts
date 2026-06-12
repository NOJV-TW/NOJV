import { Client, Connection } from "@temporalio/client";

let _clientPromise: Promise<Client> | undefined;
let _connection: Connection | undefined;

export async function getTemporalClient(): Promise<Client> {
  _clientPromise ??= (async () => {
    const address = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
    const namespace = process.env.TEMPORAL_NAMESPACE ?? "default";
    _connection = await Connection.connect({ address });
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
