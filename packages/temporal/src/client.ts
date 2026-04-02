import { Client, Connection } from "@temporalio/client";

let _client: Client | undefined;
let _connection: Connection | undefined;

export async function getTemporalClient(): Promise<Client> {
  if (_client) return _client;
  const address = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
  const namespace = process.env.TEMPORAL_NAMESPACE ?? "default";
  _connection = await Connection.connect({ address });
  _client = new Client({ connection: _connection, namespace });
  return _client;
}

export async function closeTemporalClient(): Promise<void> {
  if (_connection) {
    await _connection.close();
    _connection = undefined;
    _client = undefined;
  }
}
