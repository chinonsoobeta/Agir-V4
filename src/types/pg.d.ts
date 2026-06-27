declare module "pg" {
  export class Client {
    constructor(config: {
      connectionString: string;
      ssl?: false | { rejectUnauthorized?: boolean };
    });
    connect(): Promise<void>;
    query<T = Record<string, unknown>>(
      sql: string,
      values?: unknown[],
    ): Promise<{ rows: T[]; rowCount: number | null }>;
    end(): Promise<void>;
  }

  const pg: { Client: typeof Client };
  export default pg;
}
